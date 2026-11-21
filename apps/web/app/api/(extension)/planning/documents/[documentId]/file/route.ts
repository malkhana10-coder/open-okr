import { callAction, OperationError } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../../../../lib/auth";
import { getStorage } from "../../../../../../../lib/storage";
import { requireWorkspace } from "../../../../../../../lib/workspace";

export const dynamic = "force-dynamic";

/**
 * A source document's file, opened in the browser (design
 * b0-vertical-slice.md, criterion 7). A link adds `#page=N`, which the
 * browser's PDF viewer opens on.
 *
 * Who may have it is `knowledge.openDocumentFile`'s answer: whoever may read
 * the document's pages. Anybody else gets the same not-found as for a
 * document that does not exist.
 *
 * Shown in the browser rather than saved, because a quotation is checked by
 * looking at the page. The bytes are untrusted: the type is the stored one
 * and the browser may not guess another. What may run where they open is
 * the app's own content security policy, which the proxy sets on every
 * response, this one included: no script without the page's nonce, and no
 * plugin content.
 *
 * **Not verified in a browser with a PDF viewer.** The headless browser here
 * has none and downloads the file instead. Whether a browser shows it in
 * place under that policy is checked on the preview instance
 * (DECISIONS-LOG ت-56).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;

  let workspaceId: string;
  let userId: string;
  try {
    const { session, workspace } = await requireWorkspace();
    workspaceId = workspace.workspaceId;
    userId = session.user.id;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  let file: { storageKey: string; filename: string; contentType: string };
  try {
    file = await callAction(
      { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
      "knowledge.openDocumentFile",
      { documentId },
    );
  } catch (error) {
    // Not found and not allowed are the same answer. Anything else is a
    // fault, and is left to fail loudly where it is logged.
    if (
      error instanceof OperationError &&
      (error.code === "not_found" || error.code === "forbidden")
    ) {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }

  const bytes = await getStorage().get(file.storageKey);
  // A header carries bytes, not letters, so a name in Arabic cannot go in it
  // as written. A plain fallback for old clients, and the name itself in
  // its encoded form (RFC 6266), which every current browser reads.
  const printable = [...file.filename].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
  const fallback =
    printable
      .map((char) => ((char.codePointAt(0) ?? 0) < 0x7f ? char : "_"))
      .filter((char) => char !== '"' && char !== "\\")
      .join("")
      .trim() || "document.pdf";
  const encoded = encodeURIComponent(printable.join(""));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
