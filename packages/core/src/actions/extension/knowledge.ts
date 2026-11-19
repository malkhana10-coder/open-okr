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
import { asc, eq } from "drizzle-orm";
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
      return { documents };
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
        .select({ text: sourceDocumentPages.text })
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
