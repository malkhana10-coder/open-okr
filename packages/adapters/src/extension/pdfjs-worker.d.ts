/**
 * pdfjs-dist ships its parser as a second file with no type declaration.
 * Only the one export the library looks for is named here.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
