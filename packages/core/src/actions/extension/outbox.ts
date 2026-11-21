/**
 * The planning extension's outbox handlers, spread into the relay's dispatch
 * table by one line (docs/extension/UPSTREAM-DIFF.md).
 */
// A type-only import: the handlers module imports this one for its table.
import type { OutboxHandler } from "../../outbox/handlers.ts";
import { PermanentDispatchError } from "../../outbox/permanent.ts";
import {
  parseExtractionJob,
  runExtractionJob,
  SOURCE_DOCUMENT_EXTRACT_TOPIC,
} from "./knowledge-extraction.ts";

/**
 * Reads a registered source document.
 *
 * **Nothing here decides a document cannot be read.** A relay with no reader
 * or no storage throws, and the relay backs off and tries again: the document
 * stays `pending`, which is true. Marking it failed because this one process
 * lacked a reader would fail every upload on a replica configured differently
 * from the rest.
 */
const extractSourceDocument: OutboxHandler = async (delivery, deps) => {
  const job = parseExtractionJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      `${delivery.topic} has no workspace and document on its payload, so nothing can be read.`,
    );
  }
  if (!deps.getFile) {
    throw new Error(
      "A source document is waiting to be read and this relay has no file storage to read it from.",
    );
  }
  if (!deps.extractPages) {
    throw new Error(
      "A source document is waiting to be read and no document reader is configured where this relay runs.",
    );
  }
  const outcome = await runExtractionJob(job, {
    pool: deps.pool,
    getFile: deps.getFile,
    extractPages: deps.extractPages,
  });
  if (outcome.kind === "skipped") {
    deps.onSkipped?.(delivery, outcome.reason);
  }
};

export const EXTENSION_OUTBOX_HANDLERS: Readonly<
  Record<string, OutboxHandler>
> = {
  [SOURCE_DOCUMENT_EXTRACT_TOPIC]: extractSourceDocument,
};
