/**
 * Knowledge actions of the planning extension: the source documents a sector
 * plans from (docs/extension/design/b0-vertical-slice.md §5).
 *
 * A document belongs to a sector, and every action here is measured on the
 * sector itself through the access getter, at `edit`, for the list and a page
 * as well as for the upload.
 *
 * **Why reading asks for `edit`.** Every human member of a workspace holds
 * `view` on every space: a space has no privacy of its own
 * (`packages/core/src/spaces/service.ts`). `edit` is what being in the space
 * gives, and what an Owner and an Admin hold by their role. A sector's source
 * documents are for the people who work in it, so somebody who can only see
 * that the sector exists is answered not-found
 * (docs/extension/design/b0-vertical-slice.md §5 and §9 criterion 12).
 */
import {
  activeOnly,
  blobs,
  newId,
  SOURCE_DOCUMENT_FAILURES,
  SOURCE_DOCUMENT_KINDS,
  SOURCE_DOCUMENT_STATUSES,
  sourceDocumentPages,
  sourceDocuments,
  withContext,
} from "@openokr/db";
import { isLowQuality } from "@openokr/knowledge";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import { getAccessScoped } from "../../access/reads.ts";
import {
  OperationError,
  type OperationTx,
} from "../../operations/operation.ts";
import {
  type ActionCallContext,
  defineReadAction,
  defineWriteAction,
} from "../define.ts";
import { actingMemberId } from "./acting-member.ts";
import { extractionJobFor } from "./knowledge-extraction.ts";

/** The one file type this slice reads. Word documents arrive with phase D. */
const READABLE_CONTENT_TYPE = "application/pdf";

export const registerSourceDocument = defineWriteAction({
  name: "knowledge.registerDocument",
  summary:
    "Files an uploaded PDF under a sector as a source document, and asks for it to be read page by page.",
  input: z.object({
    spaceId: z.uuid(),
    /** The uploaded file, already claimed. */
    blobId: z.uuid(),
    title: z.string().trim().min(1).max(300),
    kind: z.enum(SOURCE_DOCUMENT_KINDS),
    year: z.number().int().min(1900).max(2200),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      // Measured on the sector, and on the file: filing a document is a way
      // of showing a file to everybody in the sector.
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.edit,
      });
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "blob",
        resourceId: input.blobId,
      });

      const [blob] = await tx
        .select({ contentType: blobs.contentType, status: blobs.status })
        .from(blobs)
        .where(
          activeOnly(
            blobs,
            eq(blobs.workspaceId, workspaceId),
            eq(blobs.id, input.blobId),
          ),
        )
        .limit(1);
      if (!blob || blob.status !== "ok") {
        throw new OperationError(
          "not_found",
          "No such file, or it is not ready to be used yet.",
        );
      }
      if (blob.contentType !== READABLE_CONTENT_TYPE) {
        throw new OperationError(
          "forbidden",
          "A source document is a PDF. This file is not one.",
        );
      }

      const id = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(sourceDocuments).values({
        id,
        workspaceId,
        spaceId: input.spaceId,
        blobId: input.blobId,
        title: input.title,
        kind: input.kind,
        year: input.year,
        uploadedBy: memberId,
      });
      const payload = {
        title: input.title,
        kind: input.kind,
        year: input.year,
      };
      return {
        result: { id },
        activity: {
          kind: "knowledge.document_registered" as const,
          subjectType: "space" as const,
          subjectId: input.spaceId,
          payload,
        },
        audit: {
          action: "knowledge.registerDocument",
          targetType: "source_document",
          targetId: id,
          payload: { ...payload, spaceId: input.spaceId },
        },
        outbox: [extractionJobFor(workspaceId, id)],
      };
    },
  }),
});

export const listSourceDocuments = defineReadAction({
  name: "knowledge.listDocuments",
  summary:
    "A sector's source documents, with how far reading each one has got.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({
    documents: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        kind: z.enum(SOURCE_DOCUMENT_KINDS),
        year: z.number().int(),
        processingStatus: z.enum(SOURCE_DOCUMENT_STATUSES),
        failureReason: z.enum(SOURCE_DOCUMENT_FAILURES).nullable(),
        pageCount: z.number().int().nullable(),
        /**
         * How well the text came out of the file. Null until the document
         * has been read, and when reading failed.
         */
        quality: z
          .object({
            arabicWords: z.number().int(),
            suspectWords: z.number().int(),
            /** The document as a whole is over the threshold. */
            low: z.boolean(),
            /** The pages that are over it, whatever the document is. */
            lowPages: z.array(z.number().int()),
          })
          .nullable(),
      }),
    ),
  }),
  // `view` on the workspace, which every member holds; the sector decides
  // below, at `edit`.
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    return inSector(context, async (tx, memberId) => {
      await getAccessScoped(tx, {
        workspaceId: context.workspaceId,
        memberId,
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.edit,
      });
      const documents = await tx
        .select({
          id: sourceDocuments.id,
          title: sourceDocuments.title,
          kind: sourceDocuments.kind,
          year: sourceDocuments.year,
          processingStatus: sourceDocuments.processingStatus,
          failureReason: sourceDocuments.failureReason,
          pageCount: sourceDocuments.pageCount,
          arabicWords: sourceDocuments.arabicWords,
          suspectWords: sourceDocuments.suspectWords,
        })
        .from(sourceDocuments)
        .where(
          activeOnly(
            sourceDocuments,
            eq(sourceDocuments.workspaceId, context.workspaceId),
            eq(sourceDocuments.spaceId, input.spaceId),
          ),
        )
        .orderBy(asc(sourceDocuments.createdAt), asc(sourceDocuments.id));
      const read = documents.filter(
        (document) => document.arabicWords !== null,
      );
      const pages =
        read.length === 0
          ? []
          : await tx
              .select({
                documentId: sourceDocumentPages.documentId,
                page: sourceDocumentPages.page,
                arabicWords: sourceDocumentPages.arabicWords,
                suspectWords: sourceDocumentPages.suspectWords,
              })
              .from(sourceDocumentPages)
              .where(
                activeOnly(
                  sourceDocumentPages,
                  eq(sourceDocumentPages.workspaceId, context.workspaceId),
                  inArray(
                    sourceDocumentPages.documentId,
                    read.map((document) => document.id),
                  ),
                ),
              )
              .orderBy(asc(sourceDocumentPages.page));
      return {
        documents: documents.map(
          ({ arabicWords, suspectWords, ...document }) => ({
            ...document,
            quality:
              arabicWords === null || suspectWords === null
                ? null
                : {
                    arabicWords,
                    suspectWords,
                    low: isLowQuality({ arabicWords, suspectWords }),
                    lowPages: pages
                      .filter(
                        (page) =>
                          page.documentId === document.id &&
                          isLowPage(page.arabicWords, page.suspectWords),
                      )
                      .map((page) => page.page),
                  },
          }),
        ),
      };
    });
  },
});

export const readSourceDocumentPage = defineReadAction({
  name: "knowledge.readPage",
  summary: "The text of one page of a source document.",
  input: z.object({
    documentId: z.uuid(),
    /** Counted from 1. */
    page: z.number().int().min(1),
  }),
  output: z.object({
    page: z.number().int(),
    pageCount: z.number().int(),
    text: z.string(),
    /** What was counted on this page, and whether it is over the threshold. */
    quality: z.object({
      arabicWords: z.number().int(),
      suspectWords: z.number().int(),
      low: z.boolean(),
    }),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    return inSector(context, async (tx, memberId) => {
      const notFound = () =>
        new OperationError(
          "not_found",
          "No such page, or you do not have access to it.",
        );
      const [document] = await tx
        .select({
          spaceId: sourceDocuments.spaceId,
          pageCount: sourceDocuments.pageCount,
        })
        .from(sourceDocuments)
        .where(
          activeOnly(
            sourceDocuments,
            eq(sourceDocuments.workspaceId, context.workspaceId),
            eq(sourceDocuments.id, input.documentId),
          ),
        )
        .limit(1);
      if (!document) {
        throw notFound();
      }
      // The sector decides, after the document is found and before anything
      // about it is said, so a document somebody may not see reads as absent.
      await getAccessScoped(tx, {
        workspaceId: context.workspaceId,
        memberId,
        resourceType: "space",
        resourceId: document.spaceId,
        requires: ACCESS_LEVELS.edit,
      });
      const [page] = await tx
        .select({
          text: sourceDocumentPages.text,
          arabicWords: sourceDocumentPages.arabicWords,
          suspectWords: sourceDocumentPages.suspectWords,
        })
        .from(sourceDocumentPages)
        .where(
          activeOnly(
            sourceDocumentPages,
            eq(sourceDocumentPages.documentId, input.documentId),
            eq(sourceDocumentPages.page, input.page),
          ),
        )
        .limit(1);
      if (!page || document.pageCount === null) {
        throw notFound();
      }
      return {
        page: input.page,
        pageCount: document.pageCount,
        text: page.text,
        quality: {
          arabicWords: page.arabicWords ?? 0,
          suspectWords: page.suspectWords ?? 0,
          low: isLowPage(page.arabicWords, page.suspectWords),
        },
      };
    });
  },
});

/** A page with no counts was read before they existed, and is not judged. */
function isLowPage(
  arabicWords: number | null,
  suspectWords: number | null,
): boolean {
  return (
    arabicWords !== null &&
    suspectWords !== null &&
    isLowQuality({ arabicWords, suspectWords })
  );
}

/**
 * Where a source document's file is kept, for somebody who may read the
 * document (criterion 7: a quotation's source opens on its page).
 *
 * The product's own download gives a file to whoever uploaded it and to
 * readers of what it hangs on. A source document hangs on nothing, so a
 * sector member who did not upload it would be refused. This answers by the
 * rule that already gives them every page of its text: `edit` on the
 * document's sector. The same people, and also while the document is still
 * being read or could not be read, when its pages are not there yet.
 *
 * Only a file that is `ok` is given, as the product's own download gives
 * only that: one being scanned or set aside by the scanner is never served.
 */
export const openDocumentFile = defineReadAction({
  name: "knowledge.openDocumentFile",
  summary:
    "Where a source document's file is kept, its name and type, for somebody who may read the document.",
  input: z.object({ documentId: z.uuid() }),
  output: z.object({
    storageKey: z.string(),
    filename: z.string(),
    contentType: z.string(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    return inSector(context, async (tx, memberId) => {
      const notFound = () =>
        new OperationError(
          "not_found",
          "No such document, or you do not have access to it.",
        );
      const [document] = await tx
        .select({
          spaceId: sourceDocuments.spaceId,
          storageKey: blobs.storageKey,
          filename: blobs.filename,
          contentType: blobs.contentType,
        })
        .from(sourceDocuments)
        .innerJoin(
          blobs,
          and(
            eq(blobs.id, sourceDocuments.blobId),
            eq(blobs.workspaceId, context.workspaceId),
            eq(blobs.status, "ok"),
            activeOnly(blobs),
          ),
        )
        .where(
          activeOnly(
            sourceDocuments,
            eq(sourceDocuments.workspaceId, context.workspaceId),
            eq(sourceDocuments.id, input.documentId),
          ),
        )
        .limit(1);
      if (!document) {
        throw notFound();
      }
      await getAccessScoped(tx, {
        workspaceId: context.workspaceId,
        memberId,
        resourceType: "space",
        resourceId: document.spaceId,
        requires: ACCESS_LEVELS.edit,
      });
      return {
        storageKey: document.storageKey,
        filename: document.filename,
        contentType: document.contentType,
      };
    });
  },
});

/** Runs a read in the workspace, as the member the call was made as. */
async function inSector<T>(
  context: ActionCallContext,
  read: (tx: OperationTx, memberId: string) => Promise<T>,
): Promise<T> {
  const userId = context.actor.userId;
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return withContext(
    drizzle(context.pool),
    { workspaceId: context.workspaceId, userId },
    async (rawTx) => {
      const tx = rawTx as OperationTx;
      return read(tx, await actingMemberId(tx, context.workspaceId, userId));
    },
  );
}
