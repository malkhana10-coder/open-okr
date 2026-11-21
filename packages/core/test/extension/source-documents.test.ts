import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  type ExtractPages,
  parseExtractionJob,
  runExtractionJob,
  SOURCE_DOCUMENT_EXTRACT_TOPIC,
} from "../../src/actions/extension/knowledge-extraction.ts";
import { callAction } from "../../src/actions/registry.ts";
import { storeUpload } from "../../src/blobs/upload.ts";
import { OUTBOX_HANDLERS } from "../../src/outbox/handlers.ts";
import { PermanentDispatchError } from "../../src/outbox/permanent.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * Source documents and their pages
 * (docs/extension/design/b0-vertical-slice.md §4, §5 and §9 criteria 2, 3
 * and 12).
 *
 * A source document is an uploaded file a sector plans from: a strategy, a
 * previous plan, a report. It is read page by page in the background, because
 * a claim an agent drafts later names a page, and the page's text is what the
 * claim's quotation is checked against.
 */

const OWNER = "source-owner";
const OUTSIDER = "source-outsider";
const COLLEAGUE = "source-colleague";

let workspaceId: string;
let spaceId: string;

const as = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

function memoryStorage() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    port: {
      async put(key: string, body: Buffer) {
        objects.set(key, body);
        return { key, size: body.byteLength };
      },
    },
    getFile: async (key: string) => objects.get(key) ?? null,
  };
}

const noImages = {
  async process(): Promise<never> {
    throw new Error("A PDF is not an image.");
  },
};

const PAGES = [
  "رؤية الجهة ورسالتها للأعوام ٢٠٢٦ إلى ٢٠٣٠.",
  "تهدف الجهة إلى رَفْعِ نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل.",
  "",
];

/** An extractor that answers the pages above, whatever the bytes. */
const threePages: ExtractPages = async () => ({
  kind: "pages",
  pages: PAGES.map((text, index) => ({ page: index + 1, text })),
});

async function upload(
  storage: ReturnType<typeof memoryStorage>,
  contentType = "application/pdf",
) {
  const wb = await workerDb();
  return storeUpload(
    { pool: wb.appPool, ...as(OWNER) },
    { storage: storage.port, images: noImages },
    {
      filename: "strategy.pdf",
      contentType,
      bytes: Buffer.from("%PDF-1.7 the strategy"),
    },
  );
}

async function register(blobId: string, userId = OWNER) {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...as(userId) },
    "knowledge.registerDocument",
    {
      spaceId,
      blobId,
      title: "الخطة الاستراتيجية للجهة",
      kind: "strategy",
      year: 2026,
    },
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Owner', 'source-owner@example.com'),
       ($2, 'Outsider', 'source-outsider@example.com')`,
    [OWNER, OUTSIDER],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  spaceId = (
    await callAction({ pool: wb.appPool, ...as(OWNER) }, "spaces.create", {
      name: "قطاع التراخيص والامتثال",
    })
  ).id;

  // A member of the workspace who is not in the sector, holding the Viewer
  // role. **Every member can see that a sector exists**: a space has no
  // privacy of its own. What they cannot do is read what the sector plans
  // from, which asks for `edit` on it, the level being in the sector gives.
  const outsider = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, 'Outsider', 'active', 'human') returning id`,
    [workspaceId, OUTSIDER],
  );
  const { roles } = await callAction(
    { pool: wb.appPool, ...as(OWNER) },
    "roles.list",
    {},
  );
  await callAction({ pool: wb.appPool, ...as(OWNER) }, "roles.assign", {
    memberId: outsider.rows[0]?.id as string,
    roleId: roles.find((role) => role.builtinKey === "viewer")?.id as string,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("knowledge.registerDocument", () => {
  it("files an uploaded PDF under its sector, waiting to be read", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const stored = await upload(storage);

    const registered = await register(stored.blobId);

    const { documents } = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "knowledge.listDocuments",
      { spaceId },
    );
    expect(documents).toEqual([
      {
        id: registered.id,
        title: "الخطة الاستراتيجية للجهة",
        kind: "strategy",
        year: 2026,
        processingStatus: "pending",
        failureReason: null,
        pageCount: null,
        quality: null,
      },
    ]);
  });

  it("asks for the file to be read, in the same transaction", async () => {
    const wb = await workerDb();
    const stored = await upload(memoryStorage());
    const registered = await register(stored.blobId);

    const outbox = await wb.admin.query<{ payload: unknown }>(
      "select payload from outbox where topic = $1",
      [SOURCE_DOCUMENT_EXTRACT_TOPIC],
    );
    expect(outbox.rows.map((row) => parseExtractionJob(row.payload))).toEqual([
      { workspaceId, documentId: registered.id },
    ]);
  });

  it("refuses a file that is not a PDF", async () => {
    const stored = await upload(memoryStorage(), "text/plain");
    await expect(register(stored.blobId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("answers not found to somebody who is not in the sector", async () => {
    const stored = await upload(memoryStorage());
    await expect(register(stored.blobId, OUTSIDER)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("reading a source document", () => {
  it("stores every page of the file, with its text made comparable", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);

    const outcome = await runExtractionJob(
      { workspaceId, documentId: registered.id },
      { pool: wb.appPool, getFile: storage.getFile, extractPages: threePages },
    );
    expect(outcome).toEqual({ kind: "ready", pageCount: 3 });

    const { documents } = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "knowledge.listDocuments",
      { spaceId },
    );
    expect(documents[0]).toMatchObject({
      processingStatus: "ready",
      pageCount: 3,
    });

    const page = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "knowledge.readPage",
      { documentId: registered.id, page: 2 },
    );
    expect(page).toEqual({
      page: 2,
      pageCount: 3,
      text: PAGES[1],
      quality: { arabicWords: 12, suspectWords: 0, low: false },
    });

    // The comparable form is stored beside the text, not computed on read.
    const stored = await wb.admin.query<{ text_normalised: string }>(
      "select text_normalised from source_document_pages where document_id = $1 and page = 2",
      [registered.id],
    );
    expect(stored.rows[0]?.text_normalised).toBe(
      "تهدف الجهه الي رفع نسبه انجاز طلبات التراخيص خلال خمسه ايام عمل.",
    );
  });

  it("does nothing the second time the same file is delivered", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);
    const job = { workspaceId, documentId: registered.id };
    const deps = {
      pool: wb.appPool,
      getFile: storage.getFile,
      extractPages: threePages,
    };

    await runExtractionJob(job, deps);
    expect(await runExtractionJob(job, deps)).toEqual({
      kind: "skipped",
      reason: "the document is already ready",
    });
    const pages = await wb.admin.query(
      "select 1 from source_document_pages where document_id = $1",
      [registered.id],
    );
    expect(pages.rowCount).toBe(3);
  });

  it("fails a file with no text in it, and says why", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);

    const outcome = await runExtractionJob(
      { workspaceId, documentId: registered.id },
      {
        pool: wb.appPool,
        getFile: storage.getFile,
        // A scanned document: pages, and not a word on any of them.
        extractPages: async () => ({
          kind: "pages",
          pages: [
            { page: 1, text: "" },
            { page: 2, text: "  \n " },
          ],
        }),
      },
    );
    expect(outcome).toEqual({ kind: "failed", reason: "no_text" });

    const { documents } = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "knowledge.listDocuments",
      { spaceId },
    );
    expect(documents[0]).toMatchObject({
      processingStatus: "failed",
      failureReason: "no_text",
      pageCount: null,
    });
  });

  it("fails a file the reader cannot open, and one whose bytes are gone", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const unreadable = await register((await upload(storage)).blobId);
    expect(
      await runExtractionJob(
        { workspaceId, documentId: unreadable.id },
        {
          pool: wb.appPool,
          getFile: storage.getFile,
          extractPages: async () => ({ kind: "unreadable" }),
        },
      ),
    ).toEqual({ kind: "failed", reason: "unreadable" });

    const missing = await register((await upload(storage)).blobId);
    expect(
      await runExtractionJob(
        { workspaceId, documentId: missing.id },
        {
          pool: wb.appPool,
          getFile: async () => null,
          extractPages: threePages,
        },
      ),
    ).toEqual({ kind: "failed", reason: "missing" });
  });
});

describe("the quality of what was read (criterion 19)", () => {
  // Forty words, every fourth with a letter that lost its dots: a page out of
  // a file whose character table is broken.
  const WEAK = Array.from({ length: 40 }, (_, index) =>
    index % 4 === 0 ? "ال\u066Eرخيص" : "الجهة",
  ).join(" ");
  const SOUND = Array.from({ length: 40 }, () => "الجهة").join(" ");
  // Too few words to judge, though every one of them is damaged.
  const SHORT = "ال\u066Eرخيص \u06A1ي";

  const read = async (texts: readonly string[]) => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);
    await runExtractionJob(
      { workspaceId, documentId: registered.id },
      {
        pool: wb.appPool,
        getFile: storage.getFile,
        extractPages: async () => ({
          kind: "pages",
          pages: texts.map((text, index) => ({ page: index + 1, text })),
        }),
      },
    );
    const { documents } = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "knowledge.listDocuments",
      { spaceId },
    );
    return { wb, id: registered.id, document: documents[0] };
  };

  it("stores the counts for the document and for every page", async () => {
    const { wb, id } = await read([SOUND, WEAK]);
    const stored = await wb.admin.query(
      `select d.arabic_words, d.suspect_words,
              array(select p.arabic_words || '/' || p.suspect_words
                      from source_document_pages p
                     where p.document_id = d.id order by p.page) as pages
         from source_documents d where d.id = $1`,
      [id],
    );
    expect(stored.rows[0]).toEqual({
      arabic_words: 80,
      suspect_words: 10,
      pages: ["40/0", "40/10"],
    });
  });

  it("flags a document over the threshold, and names its weak pages", async () => {
    const { document } = await read([SOUND, WEAK, SHORT]);
    expect(document?.quality).toEqual({
      arabicWords: 82,
      suspectWords: 12,
      low: true,
      lowPages: [2],
    });
  });

  it("does not flag a sound document, and still names one weak page in it", async () => {
    const { document } = await read([
      SOUND,
      SOUND,
      SOUND,
      SOUND,
      SOUND,
      SOUND,
      SOUND,
      SOUND,
      SOUND,
      WEAK,
    ]);
    // 10 suspect words in 400 is under three in a hundred.
    expect(document?.quality).toEqual({
      arabicWords: 400,
      suspectWords: 10,
      low: false,
      lowPages: [10],
    });
  });

  it("says whether the page being read is a weak one", async () => {
    const { wb, id } = await read([SOUND, WEAK]);
    const weak = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "knowledge.readPage",
      { documentId: id, page: 2 },
    );
    expect(weak.quality).toEqual({
      arabicWords: 40,
      suspectWords: 10,
      low: true,
    });
    const sound = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "knowledge.readPage",
      { documentId: id, page: 1 },
    );
    expect(sound.quality.low).toBe(false);
  });

  it("leaves a weak document ready and readable", async () => {
    const { document } = await read([WEAK]);
    expect(document).toMatchObject({ processingStatus: "ready", pageCount: 1 });
  });

  it("has no quality for a document that is not read yet, or that failed", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    await register((await upload(storage)).blobId);
    const { documents } = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "knowledge.listDocuments",
      { spaceId },
    );
    expect(documents[0]?.quality).toBeNull();
  });
});

describe("knowledge.openDocumentFile (criterion 7)", () => {
  /** A member of the sector who did not upload the file. */
  async function colleague(): Promise<void> {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, 'Colleague', 'source-colleague@example.com')",
      [COLLEAGUE],
    );
    const row = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
       values (gen_random_uuid(), $1, $2, 'Colleague', 'active', 'human') returning id`,
      [workspaceId, COLLEAGUE],
    );
    const { roles } = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "roles.list",
      {},
    );
    const memberId = row.rows[0]?.id as string;
    await callAction({ pool: wb.appPool, ...as(OWNER) }, "roles.assign", {
      memberId,
      roleId: roles.find((role) => role.builtinKey === "viewer")?.id as string,
    });
    await callAction({ pool: wb.appPool, ...as(OWNER) }, "spaces.addMember", {
      spaceId,
      memberId,
      role: "member",
    });
  }

  const open = async (userId: string, documentId: string) =>
    callAction(
      { pool: (await workerDb()).appPool, ...as(userId) },
      "knowledge.openDocumentFile",
      { documentId },
    );

  it("gives a member of the sector the file, though somebody else uploaded it", async () => {
    const storage = memoryStorage();
    const stored = await upload(storage);
    const document = await register(stored.blobId);
    await colleague();

    const file = await open(COLLEAGUE, document.id);
    expect(file.contentType).toBe("application/pdf");
    expect(file.filename).toBe("strategy.pdf");
    expect(storage.objects.get(file.storageKey)?.toString()).toBe(
      "%PDF-1.7 the strategy",
    );
    // The product's own download refuses them: it is not their upload and
    // it hangs on nothing they read. That is why this read exists.
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...as(COLLEAGUE) },
        "blobs.getForDownload",
        { blobId: stored.blobId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("answers not found to somebody who is not in the sector", async () => {
    const stored = await upload(memoryStorage());
    const document = await register(stored.blobId);
    await expect(open(OUTSIDER, document.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("never serves a file the scanner holds or set aside", async () => {
    const stored = await upload(memoryStorage());
    const document = await register(stored.blobId);
    const wb = await workerDb();
    await wb.admin.query(
      "update blobs set status = 'quarantined' where id = $1",
      [stored.blobId],
    );
    await expect(open(OWNER, document.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("answers not found for a document that does not exist", async () => {
    await expect(
      open(OWNER, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the relay's handler for a registered document", () => {
  const deliver = async (
    payload: Record<string, unknown>,
    deps: Record<string, unknown>,
  ) => {
    const wb = await workerDb();
    const handler = OUTBOX_HANDLERS[SOURCE_DOCUMENT_EXTRACT_TOPIC];
    expect(handler).toBeDefined();
    return handler?.(
      {
        topic: SOURCE_DOCUMENT_EXTRACT_TOPIC,
        payload,
        idempotencyKey: "test",
      } as never,
      { pool: wb.appPool, ...deps } as never,
    );
  };

  const status = async (documentId: string) => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ processing_status: string }>(
      "select processing_status from source_documents where id = $1",
      [documentId],
    );
    return rows[0]?.processing_status;
  };

  it("reads the document with the reader and the storage it is given", async () => {
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);

    await deliver(
      { workspaceId, documentId: registered.id },
      { getFile: storage.getFile, extractPages: threePages },
    );
    expect(await status(registered.id)).toBe("ready");
  });

  it("throws, so the relay tries again, where no reader is configured", async () => {
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);

    await expect(
      deliver(
        { workspaceId, documentId: registered.id },
        { getFile: storage.getFile },
      ),
    ).rejects.toThrow(/no document reader/);
    // Nothing was decided: the document still waits.
    expect(await status(registered.id)).toBe("pending");
  });

  it("fails for good on a payload that names no document", async () => {
    await expect(
      deliver({ workspaceId }, { extractPages: threePages }),
    ).rejects.toBeInstanceOf(PermanentDispatchError);
  });
});

describe("knowledge.readPage and knowledge.listDocuments", () => {
  it("answer not found to somebody who is not in the sector", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);
    await runExtractionJob(
      { workspaceId, documentId: registered.id },
      { pool: wb.appPool, getFile: storage.getFile, extractPages: threePages },
    );

    await expect(
      callAction({ pool: wb.appPool, ...as(OUTSIDER) }, "knowledge.readPage", {
        documentId: registered.id,
        page: 1,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      callAction(
        { pool: wb.appPool, ...as(OUTSIDER) },
        "knowledge.listDocuments",
        { spaceId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("let somebody in once they are added to the sector", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);
    await runExtractionJob(
      { workspaceId, documentId: registered.id },
      { pool: wb.appPool, getFile: storage.getFile, extractPages: threePages },
    );
    // They could already see that the sector exists.
    await expect(
      callAction({ pool: wb.appPool, ...as(OUTSIDER) }, "spaces.read", {
        id: spaceId,
      }),
    ).resolves.toMatchObject({ name: "قطاع التراخيص والامتثال" });

    const member = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OUTSIDER],
    );
    await callAction({ pool: wb.appPool, ...as(OWNER) }, "spaces.addMember", {
      spaceId,
      memberId: member.rows[0]?.id as string,
      role: "member",
    });

    await expect(
      callAction({ pool: wb.appPool, ...as(OUTSIDER) }, "knowledge.readPage", {
        documentId: registered.id,
        page: 1,
      }),
    ).resolves.toMatchObject({ page: 1, text: PAGES[0] });
  });

  it("answers not found for a page the document does not have", async () => {
    const wb = await workerDb();
    const storage = memoryStorage();
    const registered = await register((await upload(storage)).blobId);
    await runExtractionJob(
      { workspaceId, documentId: registered.id },
      { pool: wb.appPool, getFile: storage.getFile, extractPages: threePages },
    );

    await expect(
      callAction({ pool: wb.appPool, ...as(OWNER) }, "knowledge.readPage", {
        documentId: registered.id,
        page: 4,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
