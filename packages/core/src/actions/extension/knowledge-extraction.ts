/**
 * Reading an uploaded source document, page by page
 * (docs/extension/design/b0-vertical-slice.md §4 and §5).
 *
 * **Asynchronous, like the virus scan and for the same reason.** Reading a
 * long PDF inside the request that registered it would make the upload wait
 * on it. Registering writes a `knowledge.extract` outbox row in its own
 * transaction, and the relay delivers it here.
 *
 * **Every outcome is recorded.** A file with no text in it, a file the reader
 * cannot open and a file whose bytes are gone each leave the document
 * `failed` with the reason, so a person sees why and nothing waits for ever.
 * Only an extractor that throws is not an answer: the relay tries again.
 *
 * **The reader is handed in.** `packages/core` does not import
 * `packages/adapters`, so the PDF reader arrives as a function, the way the
 * scanner does.
 */
import {
  activeOnly,
  blobs,
  newId,
  type OutboxMessage,
  type SOURCE_DOCUMENT_FAILURES,
  sourceDocumentPages,
  sourceDocuments,
  withWorkspace,
} from "@openokr/db";
import { extractionQuality, normaliseArabic } from "@openokr/knowledge";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { OperationError } from "../../operations/errors.ts";
import { runOperation } from "../../operations/operation.ts";

/** The outbox topic registering a document writes. */
export const SOURCE_DOCUMENT_EXTRACT_TOPIC = "knowledge.extract";

export interface ExtractionJob {
  readonly workspaceId: string;
  readonly documentId: string;
}

/** The outbox row that asks the relay to read one document. */
export function extractionJobFor(
  workspaceId: string,
  documentId: string,
): OutboxMessage {
  return {
    topic: SOURCE_DOCUMENT_EXTRACT_TOPIC,
    payload: { workspaceId, documentId },
    // A document is registered once, so one row per document.
    idempotencyKey: `${SOURCE_DOCUMENT_EXTRACT_TOPIC}:${documentId}`,
  };
}

export function parseExtractionJob(payload: unknown): ExtractionJob | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const { workspaceId, documentId } = payload as Record<string, unknown>;
  if (typeof workspaceId !== "string" || typeof documentId !== "string") {
    return null;
  }
  return { workspaceId, documentId };
}

/**
 * What a reader answers. The extraction port's own shape, declared here
 * because `packages/core` does not import `packages/adapters`.
 */
type ExtractionOutcome =
  | {
      readonly kind: "pages";
      /** Every page of the file in order, counted from 1. */
      readonly pages: readonly {
        readonly page: number;
        readonly text: string;
      }[];
    }
  /** Not a file this reader can open: damaged, encrypted, or not the type it says. */
  | { readonly kind: "unreadable" };

/** Reads one file. Throws only when the reader itself is unavailable. */
export type ExtractPages = (body: Buffer) => Promise<ExtractionOutcome>;

type ExtractionFailure = (typeof SOURCE_DOCUMENT_FAILURES)[number];

export interface ExtractionJobDeps {
  readonly pool: Pool;
  /** The stored bytes, or null when the object is gone. */
  readonly getFile: (key: string) => Promise<Buffer | null>;
  readonly extractPages: ExtractPages;
}

export type ExtractionJobResult =
  | { readonly kind: "ready"; readonly pageCount: number }
  | { readonly kind: "failed"; readonly reason: ExtractionFailure }
  | { readonly kind: "skipped"; readonly reason: string };

type Recorded =
  | {
      readonly kind: "ready";
      readonly pages: readonly { page: number; text: string }[];
    }
  | { readonly kind: "failed"; readonly reason: ExtractionFailure };

/**
 * Reads one registered document and records what was found.
 *
 * **Safe to run twice.** A document that is no longer `pending` is left
 * alone, and the write is guarded on the status too, so two relays that raced
 * past the first check store the pages once.
 */
export async function runExtractionJob(
  job: ExtractionJob,
  deps: ExtractionJobDeps,
): Promise<ExtractionJobResult> {
  const [document] = await withWorkspace(
    drizzle(deps.pool),
    job.workspaceId,
    (tx) =>
      tx
        .select({
          status: sourceDocuments.processingStatus,
          storageKey: blobs.storageKey,
        })
        .from(sourceDocuments)
        .innerJoin(blobs, eq(blobs.id, sourceDocuments.blobId))
        .where(
          activeOnly(
            sourceDocuments,
            eq(sourceDocuments.workspaceId, job.workspaceId),
            eq(sourceDocuments.id, job.documentId),
          ),
        )
        .limit(1),
  );
  if (!document) {
    return { kind: "skipped", reason: "the document no longer exists" };
  }
  if (document.status !== "pending") {
    return {
      kind: "skipped",
      reason: `the document is already ${document.status}`,
    };
  }

  const recorded = await read(document.storageKey, deps);
  try {
    await record(deps.pool, job, recorded);
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") {
      return {
        kind: "skipped",
        reason: "another delivery read this document first",
      };
    }
    throw error;
  }
  return recorded.kind === "ready"
    ? { kind: "ready", pageCount: recorded.pages.length }
    : recorded;
}

async function read(
  storageKey: string,
  deps: ExtractionJobDeps,
): Promise<Recorded> {
  const bytes = await deps.getFile(storageKey);
  if (bytes === null) {
    return { kind: "failed", reason: "missing" };
  }
  const outcome = await deps.extractPages(bytes);
  if (outcome.kind === "unreadable" || outcome.pages.length === 0) {
    return { kind: "failed", reason: "unreadable" };
  }
  // A scanned document has pages and not a word on any of them. Reading it
  // takes character recognition, which this slice does not have, and saying
  // so is better than a document that looks read and answers nothing.
  if (outcome.pages.every((page) => page.text.trim() === "")) {
    return { kind: "failed", reason: "no_text" };
  }
  return { kind: "ready", pages: outcome.pages };
}

/**
 * Writes the pages or the failure, with its activity and audit rows.
 *
 * As the system rather than as the uploader: nobody chose this outcome. The
 * same principal the virus scan records its verdict as.
 */
async function record(
  pool: Pool,
  job: ExtractionJob,
  recorded: Recorded,
): Promise<void> {
  await runOperation(
    { pool },
    {
      action: "knowledge.recordExtraction",
      workspaceId: job.workspaceId,
      actor: { kind: "system" },
      async execute({ tx, workspaceId }) {
        // What was counted on each page, and their sum for the document
        // (criterion 19). Counted here, once, so every reader of a page
        // judges the same numbers.
        const pages =
          recorded.kind === "ready"
            ? recorded.pages.map((page) => ({
                ...page,
                quality: extractionQuality(page.text),
              }))
            : [];
        // openokr:allow-mutation: this is the operation's own execute, on the
        // transaction runOperation opened. Guarded on `pending` so a document
        // is read once.
        const updated = await tx
          .update(sourceDocuments)
          .set(
            recorded.kind === "ready"
              ? {
                  processingStatus: "ready" as const,
                  pageCount: recorded.pages.length,
                  arabicWords: pages.reduce(
                    (sum, page) => sum + page.quality.arabicWords,
                    0,
                  ),
                  suspectWords: pages.reduce(
                    (sum, page) => sum + page.quality.suspectWords,
                    0,
                  ),
                  updatedAt: new Date(),
                }
              : {
                  processingStatus: "failed" as const,
                  failureReason: recorded.reason,
                  updatedAt: new Date(),
                },
          )
          .where(
            activeOnly(
              sourceDocuments,
              eq(sourceDocuments.workspaceId, workspaceId),
              eq(sourceDocuments.id, job.documentId),
              eq(sourceDocuments.processingStatus, "pending"),
            ),
          )
          .returning({ id: sourceDocuments.id });
        if (updated.length === 0) {
          // Rolls the activity and audit rows back with it: nothing changed.
          throw new OperationError(
            "not_found",
            "No document waiting to be read with that id.",
          );
        }
        if (recorded.kind === "ready") {
          // openokr:allow-mutation: the same operation's transaction.
          await tx.insert(sourceDocumentPages).values(
            pages.map((page) => ({
              id: newId(),
              workspaceId,
              documentId: job.documentId,
              page: page.page,
              text: page.text,
              textNormalised: normaliseArabic(page.text),
              arabicWords: page.quality.arabicWords,
              suspectWords: page.quality.suspectWords,
            })),
          );
        }
        const payload =
          recorded.kind === "ready"
            ? { outcome: "ready" as const, pageCount: recorded.pages.length }
            : { outcome: "failed" as const, reason: recorded.reason };
        return {
          result: undefined,
          activity: {
            kind: "knowledge.document_read" as const,
            subjectType: "source_document" as const,
            subjectId: job.documentId,
            payload,
          },
          audit: {
            action: "knowledge.recordExtraction",
            targetType: "source_document",
            targetId: job.documentId,
            payload,
          },
        };
      },
    },
  );
}
