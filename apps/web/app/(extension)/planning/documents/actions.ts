"use server";

/**
 * Uploading a sector's source document (design b0-vertical-slice.md,
 * criterion 3).
 *
 * Two writes, in the order the files panel uses: the bytes are stored and
 * claimed, then the document is registered on the sector. Registering is what
 * queues the reading.
 *
 * **Everything that can be refused is refused before the bytes are stored.**
 * A stored file is claimed and counts against the workspace's storage, and
 * nothing removes one that no document names. So the title, the year, the
 * file's own first bytes and the member's access to the sector are all
 * checked first, and what is left to fail after the store is a fault, not an
 * ordinary answer.
 *
 * A refusal comes back as a sentence, with what was typed.
 */
import { callAction, storeUpload } from "@openokr/core";
import { revalidatePath } from "next/cache";
import {
  planningContext,
  refusedSector,
} from "../../../../lib/extension/planning.ts";
import { refusalOf } from "../../../../lib/refusal";
import { getStorage } from "../../../../lib/storage";
import { getTranslations } from "../../../../lib/translations";
import { UPLOAD_LIMIT_BYTES } from "../../../../lib/upload-limit";
import { getImageProcessor } from "../../../../lib/upload-ports";
import type { DocumentUploadState } from "./write-state.ts";

const KINDS = ["strategy", "sub_strategy", "previous_plan", "report"] as const;
type Kind = (typeof KINDS)[number];

/** The years `knowledge.registerDocument` takes. */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2200;

const PDF = "application/pdf";
/** How every PDF starts. A name and a declared type are the sender's word. */
const PDF_SIGNATURE = "%PDF-";

export async function uploadDocument(
  _previous: DocumentUploadState,
  formData: FormData,
): Promise<DocumentUploadState> {
  const { t } = await getTranslations();
  const values = {
    title: String(formData.get("title") ?? ""),
    kind: String(formData.get("kind") ?? ""),
    year: String(formData.get("year") ?? ""),
  };
  const refuse = (error: string): DocumentUploadState => ({ error, values });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return refuse(t("planning.documents.upload.chooseFirst"));
  }
  if (file.size > UPLOAD_LIMIT_BYTES) {
    return refuse(t("planning.documents.upload.tooLarge"));
  }
  const title = values.title.trim();
  if (title === "" || title.length > 300) {
    return refuse(t("planning.documents.upload.titleNeeded"));
  }
  const year = /^\d{4}$/.test(values.year.trim()) ? Number(values.year) : 0;
  if (year < FIRST_YEAR || year > LAST_YEAR) {
    return refuse(t("planning.documents.upload.yearRange"));
  }
  if (!(KINDS as readonly string[]).includes(values.kind)) {
    return refuse(t("planning.documents.upload.kindNeeded"));
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (
    bytes.subarray(0, PDF_SIGNATURE.length).toString("latin1") !== PDF_SIGNATURE
  ) {
    return refuse(t("planning.documents.upload.notPdf"));
  }

  const spaceId = String(formData.get("sector") ?? "");
  const context = await planningContext();
  try {
    // The address is the member's to edit, so the sector is looked up again:
    // it has to be a sector, and one this member may add to. The read is the
    // one the screen itself runs, and it answers for `edit` on the sector.
    const { sectors } = await callAction(context, "strategy.listOrgUnits", {});
    if (!sectors.some((sector) => sector.spaceId === spaceId)) {
      return refuse(t("planning.sector.denied"));
    }
    await callAction(context, "knowledge.listDocuments", { spaceId });
  } catch (error) {
    if (!refusedSector(error)) {
      throw error;
    }
    return refuse(t("planning.sector.denied"));
  }

  try {
    const stored = await storeUpload(
      context,
      { storage: getStorage(), images: getImageProcessor() },
      // Stored as a PDF because its bytes say so, whatever the browser
      // declared: some systems send no type at all for a PDF.
      { filename: file.name, contentType: PDF, bytes },
    );
    if (stored.status !== "ok") {
      // A virus scanner holds the file until it has answered, and this
      // screen does not wait for it yet.
      return refuse(t("planning.documents.upload.scanning"));
    }
    await callAction(context, "knowledge.registerDocument", {
      spaceId,
      blobId: stored.blobId,
      title,
      kind: values.kind as Kind,
      year,
    });
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    return refuse(refusal);
  }
  revalidatePath("/planning/documents");
  return { error: null, saved: true };
}
