/**
 * Where a source document's file opens on one of its pages (criterion 7).
 * The browser's PDF viewer reads `#page=N`.
 */
export function originalHref(documentId: string, page: number): string {
  return `/api/planning/documents/${documentId}/file#page=${page}`;
}
