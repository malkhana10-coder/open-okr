import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runExtractionJob } from "../../src/actions/extension/knowledge-extraction.ts";
import { callAction } from "../../src/actions/registry.ts";
import { storeUpload } from "../../src/blobs/upload.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * Evidence: a quotation, the document it is from and the page it is on
 * (docs/extension/design/b0-vertical-slice.md §4, criteria 5, 6 and 19).
 *
 * The quotation is checked against the stored text of that page when it is
 * saved, by a pure function. Nobody, and no model, is asked whether it is
 * true.
 */
const OWNER = "evidence-owner";
const OUTSIDER = "evidence-outsider";

let workspaceId: string;
let sectorId: string;
let gapId: string;
let documentId: string;

const as = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});
const owner = async () => ({ pool: (await workerDb()).appPool, ...as(OWNER) });

const SOUND =
  "تهدف الجهة إلى رَفْعِ نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل إلى 90% بنهاية عام 2027.";
// Forty words, every fourth damaged: a page from a file with a broken table.
const WEAK = Array.from({ length: 40 }, (_, index) =>
  index % 4 === 0 ? "الٮرخيص" : "الجهة",
).join(" ");
const PAGES = [SOUND, WEAK];

async function fileDocument(spaceId: string, pages: readonly string[] = PAGES) {
  const wb = await workerDb();
  const files = new Map<string, Buffer>();
  const stored = await storeUpload(
    await owner(),
    {
      storage: {
        async put(key: string, body: Buffer) {
          files.set(key, body);
          return { key, size: body.byteLength };
        },
      },
      images: {
        async process(): Promise<never> {
          throw new Error("A PDF is not an image.");
        },
      },
    },
    {
      filename: "strategy.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7 the strategy"),
    },
  );
  const registered = await callAction(
    await owner(),
    "knowledge.registerDocument",
    {
      spaceId,
      blobId: stored.blobId,
      title: "الاستراتيجية الفرعية للتراخيص والامتثال",
      kind: "sub_strategy",
      year: 2027,
    },
  );
  await runExtractionJob(
    { workspaceId, documentId: registered.id },
    {
      pool: wb.appPool,
      getFile: async (key) => files.get(key) ?? null,
      extractPages: async () => ({
        kind: "pages",
        pages: pages.map((text, index) => ({ page: index + 1, text })),
      }),
    },
  );
  return registered.id;
}

async function sector(name: string) {
  const id = (await callAction(await owner(), "spaces.create", { name })).id;
  await callAction(await owner(), "strategy.setSector", { spaceId: id });
  return id;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Owner', 'evidence-owner@example.com'),
       ($2, 'Outsider', 'evidence-outsider@example.com')`,
    [OWNER, OUTSIDER],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  sectorId = await sector("قطاع الخدمات والتراخيص");
  gapId = (
    await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      title: "إنجاز الطلبات يتجاوز خمسة أيام عمل",
    })
  ).id;
  documentId = await fileDocument(sectorId);
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, 'Outsider', 'active', 'human') returning id`,
    [workspaceId, OUTSIDER],
  );
  const { roles } = await callAction(await owner(), "roles.list", {});
  await callAction(await owner(), "roles.assign", {
    memberId: second.rows[0]?.id as string,
    roleId: roles.find((role) => role.builtinKey === "member")?.id as string,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const add = async (quote: string, page = 1, document = documentId) =>
  callAction(await owner(), "knowledge.addEvidence", {
    subjectType: "gap",
    subjectId: gapId,
    documentId: document,
    page,
    quote,
  });

const listed = async () =>
  (
    await callAction(await owner(), "knowledge.listEvidence", {
      subjectType: "gap",
      subjectId: gapId,
    })
  ).evidence;

describe("knowledge.addEvidence", () => {
  it("verifies a quotation that is on the page it names", async () => {
    const added = await add("إنجاز طلبات التراخيص خلال خمسة أيام عمل");
    expect(added.verification).toBe("verified");
    expect(await listed()).toEqual([
      {
        id: added.id,
        documentId,
        documentTitle: "الاستراتيجية الفرعية للتراخيص والامتثال",
        page: 1,
        quote: "إنجاز طلبات التراخيص خلال خمسة أيام عمل",
        verification: "verified",
        unverifiedReason: null,
        weakPage: false,
      },
    ]);
  });

  it("verifies through vowel marks, hamza forms and digits written the other way (criterion 6)", async () => {
    const added = await add(
      "الي رفع نسبة انجاز طلبات التراخيص خلال خمسه ايام عمل الى ٩٠",
    );
    expect(added.verification).toBe("verified");
  });

  it("verifies a quotation that dropped the page's leading conjunction, and keeps the page's wording", async () => {
    const withConjunction = await fileDocument(sectorId, [
      "تعتمد المعالجة على إجراءات ورقية، ولا يوجد نظام موحد يربط الفروع بالمركز الرئيس.",
    ]);
    const added = await add(
      "لا يوجد نظام موحد يربط الفروع",
      1,
      withConjunction,
    );
    expect(added).toMatchObject({
      verification: "verified",
      quote: "ولا يوجد نظام موحد يربط الفروع",
    });
    expect((await listed())[0]?.quote).toBe("ولا يوجد نظام موحد يربط الفروع");
  });

  it("does not verify a quotation that dropped a joined preposition", async () => {
    const withPreposition = await fileDocument(sectorId, [
      "تُرفع التقارير للقطاع المعني بمتابعة المستهدف كل ربع.",
    ]);
    const added = await add(
      "القطاع المعني بمتابعة المستهدف",
      1,
      withPreposition,
    );
    expect(added.verification).toBe("unverified");
  });

  it("keeps a quotation that is not on the page, marked unverified, and says why (criterion 5)", async () => {
    const added = await add("تهدف الجهة إلى مضاعفة عدد الفروع خلال عامين");
    expect(added).toMatchObject({
      verification: "unverified",
      unverifiedReason: "not_on_page",
    });
    expect((await listed())[0]).toMatchObject({
      verification: "unverified",
      unverifiedReason: "not_on_page",
    });
  });

  it("does not verify a quotation of fewer than four words", async () => {
    const added = await add("طلبات التراخيص");
    expect(added).toMatchObject({
      verification: "unverified",
      unverifiedReason: "too_short",
    });
  });

  it("does not verify a quotation that is on another page of the same document", async () => {
    const added = await add("إنجاز طلبات التراخيص خلال خمسة أيام عمل", 2);
    expect(added.verification).toBe("unverified");
  });

  it("says when the page it comes from was read poorly (criterion 19)", async () => {
    await add("الجهة الجهة الجهة الجهة", 2);
    expect((await listed())[0]).toMatchObject({ page: 2, weakPage: true });
  });

  it("answers not found for a page the document does not have", async () => {
    await expect(
      add("إنجاز طلبات التراخيص خلال خمسة أيام عمل", 9),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("answers not found for a document filed under another sector", async () => {
    const other = await sector("قطاع الخدمات المساندة");
    const elsewhere = await fileDocument(other);
    await expect(
      add("إنجاز طلبات التراخيص خلال خمسة أيام عمل", 1, elsewhere),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses new evidence on a gap that has been sent for approval", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update strategic_gaps set status = 'in_review' where id = $1",
      [gapId],
    );
    await expect(
      add("إنجاز طلبات التراخيص خلال خمسة أيام عمل"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("knowledge.removeEvidence and access", () => {
  it("removes a piece of evidence", async () => {
    const added = await add("إنجاز طلبات التراخيص خلال خمسة أيام عمل");
    await callAction(await owner(), "knowledge.removeEvidence", {
      id: added.id,
    });
    expect(await listed()).toEqual([]);
  });

  it("answers not found to somebody who is not in the sector, for every action", async () => {
    const wb = await workerDb();
    const outsider = { pool: wb.appPool, ...as(OUTSIDER) };
    const added = await add("إنجاز طلبات التراخيص خلال خمسة أيام عمل");
    const refused = { code: "not_found" };
    await expect(
      callAction(outsider, "knowledge.listEvidence", {
        subjectType: "gap",
        subjectId: gapId,
      }),
    ).rejects.toMatchObject(refused);
    await expect(
      callAction(outsider, "knowledge.addEvidence", {
        subjectType: "gap",
        subjectId: gapId,
        documentId,
        page: 1,
        quote: "إنجاز طلبات التراخيص خلال خمسة أيام عمل",
      }),
    ).rejects.toMatchObject(refused);
    await expect(
      callAction(outsider, "knowledge.removeEvidence", { id: added.id }),
    ).rejects.toMatchObject(refused);
  });

  it("stores the verdict, so nothing can claim one the check did not give", async () => {
    // The action takes no verdict from its caller.
    const wb = await workerDb();
    await callAction(await owner(), "knowledge.addEvidence", {
      subjectType: "gap",
      subjectId: gapId,
      documentId,
      page: 1,
      quote: "تهدف الجهة إلى مضاعفة عدد الفروع خلال عامين",
      // Ignored: not part of the input.
      verification: "verified",
    } as never);
    const stored = await wb.admin.query(
      "select verification from evidence where subject_id = $1",
      [gapId],
    );
    expect(stored.rows).toEqual([{ verification: "unverified" }]);
  });
});

describe("knowledge.listSectorEvidence", () => {
  const ofSector = async (who = owner()) =>
    (
      await callAction(await who, "knowledge.listSectorEvidence", {
        spaceId: sectorId,
      })
    ).evidence;

  it("answers every gap's quotations in one read, each naming its gap", async () => {
    await add("إنجاز طلبات التراخيص خلال خمسة أيام عمل");
    await add("كلمات ليست في الصفحة على الإطلاق");
    const other = await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      title: "فجوة ثانية",
    });
    await callAction(await owner(), "knowledge.addEvidence", {
      subjectType: "gap",
      subjectId: other.id,
      documentId,
      page: 1,
      quote: "إنجاز طلبات التراخيص خلال خمسة أيام عمل",
    });

    const all = await ofSector();
    expect(all).toHaveLength(3);
    expect(all.filter((one) => one.gapId === gapId)).toHaveLength(2);
    expect(all.filter((one) => one.gapId === other.id)).toHaveLength(1);
    // The same rows the per-gap read answers, in the same order.
    expect(
      all
        .filter((one) => one.gapId === gapId)
        .map(({ gapId: _, ...row }) => row),
    ).toEqual(await listed());
  });

  it("leaves out a quotation that was removed", async () => {
    const added = await add("إنجاز طلبات التراخيص خلال خمسة أيام عمل");
    await callAction(await owner(), "knowledge.removeEvidence", {
      id: added.id,
    });
    expect(await ofSector()).toEqual([]);
  });

  it("answers not found to somebody who is not in the sector", async () => {
    const wb = await workerDb();
    await add("إنجاز طلبات التراخيص خلال خمسة أيام عمل");
    await expect(
      callAction(
        { pool: wb.appPool, ...as(OUTSIDER) },
        "knowledge.listSectorEvidence",
        { spaceId: sectorId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
