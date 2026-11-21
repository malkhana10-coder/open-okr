/**
 * Evidence: a quotation, the document it is from and the page it is on
 * (docs/extension/design/b0-vertical-slice.md §4, §5.1, criteria 5, 6, 19).
 *
 * **The verdict is computed here and nowhere else.** `knowledge.addEvidence`
 * takes a quotation and a page and stores what `verifyCitation` finds. It has
 * no field for a verdict, so neither a person nor an agent, nor text injected
 * into a document an agent read, can produce a verified source for something
 * the page does not say.
 *
 * **An unverified quotation is kept, not refused.** A reviewer has to see
 * what was claimed and that it did not check out. Refusing it would hide the
 * claim, and an agent's run would fail on its first loose quotation.
 *
 * Measured on the sector of what the evidence supports, at `edit`, like the
 * gap itself. The document must be filed under that same sector: evidence
 * drawn from a document the sector's people cannot open is not evidence they
 * can check.
 */
import {
  activeOnly,
  EVIDENCE_UNVERIFIED_REASONS,
  EVIDENCE_VERIFICATIONS,
  evidence,
  newId,
  sourceDocumentPages,
  sourceDocuments,
  strategicGaps,
  withContext,
} from "@openokr/db";
import { isLowQuality, verifyCitation } from "@openokr/knowledge";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import {
  OperationError,
  type OperationTx,
} from "../../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "../define.ts";
import { actingMemberId } from "./acting-member.ts";
import { gapForChange, inSector, refuseUnlessOpen } from "./gaps.ts";

/**
 * What evidence can support today. A drafted objective joins when objectives
 * are drafted; the table already allows it.
 */
const subjectType = z.enum(["gap"]);

const notFound = () =>
  new OperationError(
    "not_found",
    "No such evidence, or you do not have access to it.",
  );

export const addEvidence = defineWriteAction({
  name: "knowledge.addEvidence",
  summary:
    "Attaches a quotation from a page of a source document to a gap, and records whether the quotation is really on that page.",
  input: z.object({
    subjectType,
    subjectId: z.uuid(),
    documentId: z.uuid(),
    /** Counted from 1. */
    page: z.number().int().min(1),
    quote: z.string().trim().min(1).max(2000),
  }),
  output: z.object({
    id: z.uuid(),
    /** The quotation as it was kept, in the page's wording when verified. */
    quote: z.string(),
    verification: z.enum(EVIDENCE_VERIFICATIONS),
    unverifiedReason: z.enum(EVIDENCE_UNVERIFIED_REASONS).nullable(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const gap = await gapForChange(
        tx,
        workspaceId,
        memberId,
        input.subjectId,
      );
      refuseUnlessOpen(gap.status);

      const [page] = await tx
        .select({ text: sourceDocumentPages.text })
        .from(sourceDocumentPages)
        .innerJoin(
          sourceDocuments,
          eq(sourceDocuments.id, sourceDocumentPages.documentId),
        )
        .where(
          activeOnly(
            sourceDocumentPages,
            activeOnly(
              sourceDocuments,
              and(
                eq(sourceDocuments.workspaceId, workspaceId),
                eq(sourceDocuments.id, input.documentId),
                // The sector's own documents, and only once they are read.
                eq(sourceDocuments.spaceId, gap.spaceId),
                eq(sourceDocuments.processingStatus, "ready"),
                eq(sourceDocumentPages.page, input.page),
              ),
            ),
          ),
        )
        .limit(1);
      if (!page) {
        throw new OperationError(
          "not_found",
          "No such page in this sector's documents.",
        );
      }

      const verdict = verifyCitation({
        quote: input.quote,
        pageText: page.text,
      });
      const unverifiedReason =
        verdict.status === "unverified" ? verdict.reason : null;
      // What is kept is what the page says. Where the check put the page's
      // "و" or "ف" back on the first word, that wording replaces the
      // caller's. An unverified quotation is kept as it was given.
      const quote = verdict.status === "verified" ? verdict.quote : input.quote;
      const id = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(evidence).values({
        id,
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        documentId: input.documentId,
        page: input.page,
        quote,
        verification: verdict.status,
        unverifiedReason,
        createdBy: memberId,
      });
      return {
        result: { id, quote, verification: verdict.status, unverifiedReason },
        activity: {
          kind: "knowledge.evidence_added" as const,
          subjectType: "space" as const,
          subjectId: gap.spaceId,
          payload: { page: input.page, verification: verdict.status },
        },
        audit: {
          action: "knowledge.addEvidence",
          targetType: "evidence",
          targetId: id,
          payload: {
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            documentId: input.documentId,
            page: input.page,
            verification: verdict.status,
          },
        },
      };
    },
  }),
});

export const removeEvidence = defineWriteAction({
  name: "knowledge.removeEvidence",
  summary: "Removes a quotation from what it was attached to.",
  // A removal, so it needs the destructive scope like every other one. A
  // default token, which is what an agent holds, cannot take a source away
  // from a claim.
  safety: "destructive",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [row] = await tx
        .select({ subjectId: evidence.subjectId, page: evidence.page })
        .from(evidence)
        .where(
          activeOnly(
            evidence,
            eq(evidence.workspaceId, workspaceId),
            eq(evidence.id, input.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw notFound();
      }
      const gap = await gapForChange(tx, workspaceId, memberId, row.subjectId);
      refuseUnlessOpen(gap.status);
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(evidence)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(activeOnly(evidence, eq(evidence.id, input.id)));
      return {
        result: { id: input.id },
        activity: {
          kind: "knowledge.evidence_removed" as const,
          subjectType: "space" as const,
          subjectId: gap.spaceId,
          payload: { page: row.page },
        },
        audit: {
          action: "knowledge.removeEvidence",
          targetType: "evidence",
          targetId: input.id,
          payload: { subjectId: row.subjectId },
        },
      };
    },
  }),
});

const evidenceRow = {
  id: z.uuid(),
  documentId: z.uuid(),
  documentTitle: z.string(),
  page: z.number().int(),
  quote: z.string(),
  verification: z.enum(EVIDENCE_VERIFICATIONS),
  unverifiedReason: z.enum(EVIDENCE_UNVERIFIED_REASONS).nullable(),
  /** The page it comes from was read poorly, so a miss may be the file's. */
  weakPage: z.boolean(),
};

/**
 * Every gap's quotations in a sector, in one read.
 *
 * A screen that lists a sector's gaps needs the quotations of all of them.
 * Asking gap by gap is a transaction and an access check for each, all at
 * once, which is more connections than the pool holds for a sector with
 * forty gaps. This asks once, for somebody who may edit the sector.
 */
export const listSectorEvidence = defineReadAction({
  name: "knowledge.listSectorEvidence",
  summary:
    "The quotations every gap of a sector rests on, each naming its gap, its document, its page and whether it was found there.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({
    evidence: z.array(z.object({ gapId: z.uuid(), ...evidenceRow })),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMemberId(tx, context.workspaceId, userId);
        // Decides access: not found unless the caller may edit the sector.
        await inSector(tx, context.workspaceId, memberId, input.spaceId);
        const rows = await tx
          .select({
            gapId: strategicGaps.id,
            id: evidence.id,
            documentId: evidence.documentId,
            documentTitle: sourceDocuments.title,
            page: evidence.page,
            quote: evidence.quote,
            verification: evidence.verification,
            unverifiedReason: evidence.unverifiedReason,
            arabicWords: sourceDocumentPages.arabicWords,
            suspectWords: sourceDocumentPages.suspectWords,
          })
          .from(evidence)
          .innerJoin(
            strategicGaps,
            and(
              eq(strategicGaps.id, evidence.subjectId),
              activeOnly(strategicGaps),
            ),
          )
          .innerJoin(
            sourceDocuments,
            eq(sourceDocuments.id, evidence.documentId),
          )
          .leftJoin(
            sourceDocumentPages,
            and(
              eq(sourceDocumentPages.documentId, evidence.documentId),
              eq(sourceDocumentPages.page, evidence.page),
            ),
          )
          .where(
            activeOnly(
              evidence,
              eq(evidence.workspaceId, context.workspaceId),
              eq(evidence.subjectType, "gap"),
              eq(strategicGaps.workspaceId, context.workspaceId),
              eq(strategicGaps.spaceId, input.spaceId),
            ),
          )
          .orderBy(asc(evidence.createdAt), asc(evidence.id));
        return {
          evidence: rows.map(({ arabicWords, suspectWords, ...row }) => ({
            ...row,
            weakPage:
              arabicWords !== null &&
              suspectWords !== null &&
              isLowQuality({ arabicWords, suspectWords }),
          })),
        };
      },
    );
  },
});

export const listEvidence = defineReadAction({
  name: "knowledge.listEvidence",
  summary:
    "The quotations a gap rests on, each with its document, its page and whether it was found there.",
  input: z.object({ subjectType, subjectId: z.uuid() }),
  output: z.object({
    evidence: z.array(
      z.object({
        id: z.uuid(),
        documentId: z.uuid(),
        documentTitle: z.string(),
        page: z.number().int(),
        quote: z.string(),
        verification: z.enum(EVIDENCE_VERIFICATIONS),
        unverifiedReason: z.enum(EVIDENCE_UNVERIFIED_REASONS).nullable(),
        /** The page it comes from was read poorly, so a miss may be the file's. */
        weakPage: z.boolean(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMemberId(tx, context.workspaceId, userId);
        // Decides access: not found unless the caller is in the gap's sector.
        await gapForChange(tx, context.workspaceId, memberId, input.subjectId);
        const rows = await tx
          .select({
            id: evidence.id,
            documentId: evidence.documentId,
            documentTitle: sourceDocuments.title,
            page: evidence.page,
            quote: evidence.quote,
            verification: evidence.verification,
            unverifiedReason: evidence.unverifiedReason,
            arabicWords: sourceDocumentPages.arabicWords,
            suspectWords: sourceDocumentPages.suspectWords,
          })
          .from(evidence)
          .innerJoin(
            sourceDocuments,
            eq(sourceDocuments.id, evidence.documentId),
          )
          .leftJoin(
            sourceDocumentPages,
            and(
              eq(sourceDocumentPages.documentId, evidence.documentId),
              eq(sourceDocumentPages.page, evidence.page),
            ),
          )
          .where(
            activeOnly(
              evidence,
              eq(evidence.workspaceId, context.workspaceId),
              eq(evidence.subjectType, input.subjectType),
              eq(evidence.subjectId, input.subjectId),
            ),
          )
          .orderBy(asc(evidence.createdAt), asc(evidence.id));
        return {
          evidence: rows.map(({ arabicWords, suspectWords, ...row }) => ({
            ...row,
            weakPage:
              arabicWords !== null &&
              suspectWords !== null &&
              isLowQuality({ arabicWords, suspectWords }),
          })),
        };
      },
    );
  },
});
