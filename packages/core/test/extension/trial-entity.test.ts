import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callAction } from "../../src/actions/registry.ts";
import { createAuth } from "../../src/auth/auth.ts";
import {
  buildTrialEntity,
  type TrialEntityResult,
} from "../../src/extension/trial-entity/builder.ts";
import {
  DOMAINS,
  INDICATORS,
  INITIATIVES,
  OBJECTIVES,
  PEOPLE,
  ROLE_NAMES,
  SECTORS,
  TRIAL_MAIL_DOMAIN,
} from "../../src/extension/trial-entity/data.ts";
import { OperationError } from "../../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * The trial entity's seed (design §12.3, the specification in
 * `docs/extension/SEED-AND-MODEL-INPUTS.md` part 2).
 *
 * Two kinds of claim. The counts say the seed is the one the specification
 * asks for. The access checks say the five people are real members: each
 * signs in, and each may do what the role in the specification does and no
 * more.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const OWNER = "trial-owner";
const PASSWORD = "a-password-for-the-trial";

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;
let workspaceId: string;
let built: TrialEntityResult;
/** What building in a workspace somebody already works in answered. */
let inUse: { code: string | null; personas: number };

const pool = async () => (await workerDb()).appPool;
const as = async (userId: string) => ({
  pool: await pool(),
  workspaceId,
  actor: { kind: "human" as const, userId },
});
const sql = async <Row extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> =>
  (await (await workerDb()).admin.query<Row>(text, values)).rows;

const userOf = (key: string): string => {
  const person = built.people.find((one) => one.key === key);
  if (!person) {
    throw new Error(`The seed returned nobody for "${key}".`);
  }
  return person.userId;
};

const build = async (
  target: { workspaceId: string; adminUserId: string } = {
    workspaceId,
    adminUserId: OWNER,
  },
  password = PASSWORD,
) => buildTrialEntity({ pool: await pool(), ...target, auth, password });

const codeOf = async (attempt: Promise<unknown>): Promise<string | null> => {
  try {
    await attempt;
    return null;
  } catch (error) {
    return error instanceof OperationError ? error.code : "not an operation";
  }
};

const personaAccounts = async (): Promise<number> =>
  (
    await sql<{ id: string }>("select id from users where email like $1", [
      `%@${TRIAL_MAIL_DOMAIN}`,
    ])
  ).length;

async function workspaceOf(userId: string, name: string): Promise<string> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, name, `${userId}@example.com`],
  );
  return (await provisionWorkspaceForUser(wb.appPool, { id: userId, name }))
    .workspaceId;
}

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "مسؤول النظام", "trial-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "الجهة الحكومية التجريبية",
    })
  ).workspaceId;
  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
  });

  // Before anybody of the cast exists: a workspace with a second person in
  // it is somebody's, and must be left alone.
  const busy = await workspaceOf("busy-owner", "جهة يعمل فيها أحد");
  await wb.admin.query(
    "insert into users (id, name, email) values ('busy-colleague', 'زميل', 'busy-colleague@example.com')",
  );
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, 'busy-colleague', 'زميل', 'active', 'human')`,
    [busy],
  );
  inUse = {
    code: await codeOf(build({ workspaceId: busy, adminUserId: "busy-owner" })),
    personas: await personaAccounts(),
  };

  built = await build();
}, 240_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the text of the seed", () => {
  const ARABIC = /[ء-ي]/;
  const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;
  const sentences = [
    ...DOMAINS.flatMap((d) => [d.name, d.description]),
    ...SECTORS.flatMap((s) => [
      s.name,
      s.mission,
      ...s.agencies.flatMap((a) => [a.name, a.mission]),
    ]),
    ...PEOPLE.flatMap((p) => [p.name, p.title]),
    ...OBJECTIVES.flatMap((o) => [o.title, o.description]),
    ...INITIATIVES.flatMap((i) => [i.title, i.description]),
    ...INDICATORS.flatMap((k) => [
      k.title,
      ...k.readings.flatMap((r) => (r.remark ? [r.remark] : [])),
    ]),
  ];

  it("is Arabic, with Western digits", () => {
    expect(sentences.length).toBeGreaterThan(100);
    for (const sentence of sentences) {
      expect(sentence, sentence).toMatch(ARABIC);
      expect(sentence, sentence).not.toMatch(ARABIC_INDIC_DIGITS);
    }
  });

  it("has the specification's mix of indicators", () => {
    expect(INDICATORS).toHaveLength(14);
    const by = (frequency: string) =>
      INDICATORS.filter(
        (k) => k.frequency === frequency && !k.halfYearlyInSpecification,
      ).length;
    expect(by("monthly")).toBe(5);
    expect(by("quarterly")).toBe(6);
    expect(by("yearly")).toBe(1);
    expect(INDICATORS.filter((k) => k.halfYearlyInSpecification)).toHaveLength(
      2,
    );
    expect(
      INDICATORS.filter((k) => k.direction === "lower_better"),
    ).toHaveLength(2);
    expect(INDICATORS.filter((k) => k.agencyKey)).toHaveLength(5);
  });

  it("has fifteen initiatives, six of them carried over", () => {
    expect(INITIATIVES).toHaveLength(15);
    expect(INITIATIVES.filter((i) => i.carried)).toHaveLength(6);
  });
});

describe("the organisation", () => {
  it("has three sectors holding seven agencies", async () => {
    const { sectors } = await callAction(
      await as(OWNER),
      "strategy.listOrgUnits",
      {},
    );
    expect(
      sectors
        .map((s) => ({ name: s.name, agencies: s.agencies.length }))
        .sort((a, b) => a.name.localeCompare(b.name, "ar")),
    ).toEqual(
      [
        { name: "قطاع التخطيط والتطوير", agencies: 2 },
        { name: "قطاع الخدمات المساندة", agencies: 2 },
        { name: "قطاع الخدمات والتراخيص", agencies: 3 },
      ].sort((a, b) => a.name.localeCompare(b.name, "ar")),
    );
    const services = sectors.find((s) => s.name === "قطاع الخدمات والتراخيص");
    expect(services?.agencies.map((a) => a.name).sort()).toEqual(
      [
        "وكالة التراخيص",
        "وكالة الرقابة والامتثال",
        "وكالة تجربة المستفيد",
      ].sort(),
    );
  });

  it("names the business owner as the lead of the services sector", async () => {
    const { sectors } = await callAction(
      await as(OWNER),
      "strategy.listOrgUnits",
      {},
    );
    const services = sectors.find((s) => s.name === "قطاع الخدمات والتراخيص");
    const [member] = await sql<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, userOf("businessOwner")],
    );
    expect(services?.leadMemberId).toBe(member?.id);
  });

  it("has the five domains", async () => {
    const { domains } = await callAction(
      await as(OWNER),
      "strategy.listDomains",
      {},
    );
    expect(domains.map((d) => d.name).sort()).toEqual(
      [
        "التحول الرقمي",
        "الاستدامة المالية",
        "التراخيص والامتثال",
        "رأس المال البشري",
        "تجربة المستفيد",
      ].sort(),
    );
  });

  it("has the plan year being planned, and the year before it", async () => {
    const cycles = await sql<{
      starts_on: string;
      ends_on: string;
      status: string;
      id: string;
    }>(
      `select id, status, starts_on::text, ends_on::text from cycles
        where workspace_id = $1 and deleted_at is null
          and ends_on - starts_on > 300
        order by starts_on`,
      [workspaceId],
    );
    expect(cycles.map((c) => c.starts_on.slice(0, 4))).toEqual([
      "2026",
      "2027",
    ]);
    // Neither is published: the plan year is what the product is shown
    // planning, and the year before holds no objectives, only readings.
    expect(cycles.map((c) => c.status)).toEqual(["planning", "planning"]);
    expect(built.planCycleId).toBe(cycles[1]?.id);
  });
});

describe("the people", () => {
  it("are five members with accounts on the reserved domain", async () => {
    const rows = await sql<{ name: string; title: string; email: string }>(
      `select wm.name, wm.title, u.email
         from workspace_members wm join users u on u.id = wm.user_id
        where wm.workspace_id = $1 and wm.deleted_at is null
          and wm.kind = 'human' and u.id <> $2
        order by u.email`,
      [workspaceId, OWNER],
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.email.endsWith(`@${TRIAL_MAIL_DOMAIN}`)).toBe(true);
    }
    expect(rows.map((r) => r.title).sort()).toEqual(
      PEOPLE.map((p) => p.title).sort(),
    );
  });

  it("each sign in with the password given", async () => {
    for (const person of built.people) {
      const signedIn = await auth.api.signInEmail({
        body: { email: person.email, password: PASSWORD },
      });
      expect(signedIn.user.id).toBe(person.userId);
    }
  });

  it("refuses the wrong password", async () => {
    await expect(
      auth.api.signInEmail({
        body: {
          email: built.people[0]?.email as string,
          password: "not-the-password-given",
        },
      }),
    ).rejects.toThrow();
  });

  it("leaves no usable invitation behind", async () => {
    const live = await sql(
      `select id from invite_links
        where workspace_id = $1 and revoked_at is null and deleted_at is null`,
      [workspaceId],
    );
    expect(live).toHaveLength(0);
  });

  it("gives the two approved roles their approval levels", async () => {
    const { roles } = await callAction(await as(OWNER), "roles.list", {});
    const level = (name: string, domain: string) =>
      roles
        .find((r) => r.name === name)
        ?.permissions.find((p) => p.domain === domain)?.level;
    const builtin = (key: string, domain: string) =>
      roles
        .find((r) => r.builtinKey === key)
        ?.permissions.find((p) => p.domain === domain)?.level;

    expect(level(ROLE_NAMES.strategyOffice, "approval")).toBe(70);
    expect(level(ROLE_NAMES.leadership, "approval")).toBe(100);
    // Design §13.2: the rest of the strategy office is the Member role, and
    // the rest of leadership is the Viewer role with comment.
    const domains = roles
      .find((r) => r.builtinKey === "member")
      ?.permissions.map((p) => p.domain) as string[];
    expect(domains).toContain("workspace");
    for (const domain of domains.filter((d) => d !== "approval")) {
      expect(level(ROLE_NAMES.strategyOffice, domain), domain).toBe(
        builtin("member", domain),
      );
      if (domain !== "comment") {
        expect(level(ROLE_NAMES.leadership, domain), domain).toBe(
          builtin("viewer", domain),
        );
      }
    }
    expect(level(ROLE_NAMES.leadership, "comment")).toBe(40);

    const holders = await sql<{ title: string; role: string }>(
      `select wm.title, r.name as role
         from workspace_members wm join workspace_roles r on r.id = wm.role_id
        where wm.workspace_id = $1 and r.builtin_key is null`,
      [workspaceId],
    );
    expect(holders.sort((a, b) => a.role.localeCompare(b.role))).toEqual(
      [
        { title: "مكتب الاستراتيجية", role: ROLE_NAMES.strategyOffice },
        { title: "القيادة", role: ROLE_NAMES.leadership },
      ].sort((a, b) => a.role.localeCompare(b.role)),
    );
  });
});

describe("what each person may do", () => {
  const sectorId = (name: string) => {
    const id = built.sectors.find((s) => s.name === name)?.spaceId;
    if (!id) {
      throw new Error(`No sector "${name}".`);
    }
    return id;
  };

  it("lets the strategy office read every sector's plan", async () => {
    for (const sector of built.sectors) {
      const plan = await callAction(
        await as(userOf("strategy")),
        "strategy.listSectorPlan",
        { spaceId: sector.spaceId },
      );
      expect(plan.objectives.length).toBeGreaterThan(0);
    }
  });

  it("answers not found to somebody outside the sector", async () => {
    for (const key of ["performance", "pmo", "leadership"]) {
      await expect(
        callAction(await as(userOf(key)), "strategy.listSectorPlan", {
          spaceId: sectorId("قطاع الخدمات والتراخيص"),
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    }
  });

  it("lets the strategy office submit and leadership decide, not the reverse", async () => {
    const spaceId = sectorId("قطاع الخدمات المساندة");
    const gap = await callAction(
      await as(userOf("strategy")),
      "strategy.createGap",
      {
        spaceId,
        title: "لا مستهدف معتمد لنسبة شغل الوظائف القيادية",
        description: "الوظائف القيادية المعتمدة لا يُعرف كم منها مشغول اليوم.",
      },
    );
    expect(gap.id).toBeTruthy();

    // The sector lead may edit the sector and still may not submit: what
    // is missing is the approval level, which only the two roles carry.
    const services = sectorId("قطاع الخدمات والتراخيص");
    await callAction(await as(userOf("businessOwner")), "strategy.createGap", {
      spaceId: services,
      title: "لا دليل موحد منشور لاشتراطات التراخيص",
    });
    expect(
      await codeOf(
        callAction(await as(userOf("businessOwner")), "governance.submit", {
          spaceId: services,
        }),
      ),
    ).toBe("forbidden");
    expect(
      await codeOf(
        callAction(await as(userOf("leadership")), "governance.submit", {
          spaceId,
        }),
      ),
    ).toBe("not_found");

    const submitted = await callAction(
      await as(userOf("strategy")),
      "governance.submit",
      { spaceId },
    );
    expect(submitted.gaps).toBe(1);

    // Nobody but leadership decides: not the one who sent it, and not a
    // Member who had no part in it.
    for (const key of ["strategy", "pmo", "performance", "businessOwner"]) {
      expect(
        await codeOf(
          callAction(await as(userOf(key)), "governance.decide", {
            requestId: submitted.requestId,
            decision: "approve",
          }),
        ),
        key,
      ).toMatch(/^(forbidden|not_found)$/);
    }
    const [open] = await sql<{ status: string }>(
      "select status from strategic_gaps where id = $1",
      [gap.id],
    );
    expect(open?.status).toBe("in_review");

    const waiting = await callAction(
      await as(userOf("leadership")),
      "governance.myNext",
      {},
    );
    expect(waiting.toDecide.map((r) => r.requestId)).toContain(
      submitted.requestId,
    );

    await callAction(await as(userOf("leadership")), "governance.decide", {
      requestId: submitted.requestId,
      decision: "approve",
    });
    const [row] = await sql<{ status: string }>(
      "select status from strategic_gaps where id = $1",
      [gap.id],
    );
    expect(row?.status).toBe("approved");
  });
});

describe("leadership", () => {
  it("writes nothing: no objective, no gap, no setting", async () => {
    const leader = await as(userOf("leadership"));
    const spaceId = built.sectors[0]?.spaceId as string;
    expect(
      await codeOf(
        callAction(leader, "strategy.createGap", { spaceId, title: "فجوة" }),
      ),
    ).not.toBeNull();
    expect(
      await codeOf(
        callAction(leader, "goals.create", {
          title: "هدف",
          cycleId: built.planCycleId,
          level: "department",
          ownerKind: "space",
          spaceId,
          weight: 1,
        }),
      ),
    ).not.toBeNull();
    expect(
      await codeOf(
        callAction(leader, "strategy.createDomain", { name: "مجال سادس" }),
      ),
    ).not.toBeNull();
  });
});

describe("the sector lead", () => {
  it("is a member of the sector and of each of its agencies", async () => {
    const rows = await sql<{ space: string }>(
      `select s.name as space
         from space_members sm
         join spaces s on s.id = sm.space_id
         join workspace_members wm on wm.id = sm.member_id
        where sm.workspace_id = $1 and wm.user_id = $2 and sm.deleted_at is null`,
      [workspaceId, userOf("businessOwner")],
    );
    expect(rows.map((r) => r.space).sort()).toEqual(
      [
        "قطاع الخدمات والتراخيص",
        "وكالة التراخيص",
        "وكالة الرقابة والامتثال",
        "وكالة تجربة المستفيد",
      ].sort(),
    );
  });
});

describe("the twelve items of the plan", () => {
  const whole = async () => {
    const plans = [];
    for (const sector of built.sectors) {
      plans.push(
        await callAction(await as(OWNER), "strategy.listSectorPlan", {
          spaceId: sector.spaceId,
        }),
      );
    }
    return {
      objectives: plans.flatMap((p) => p.objectives),
      indicators: plans.flatMap((p) => p.indicators),
    };
  };

  it("are five sector objectives, two operational ones and five indicators", async () => {
    const { objectives, indicators } = await whole();
    const profiles = objectives.map((o) => o.profile);
    expect(profiles.every((p) => p !== null)).toBe(true);
    const count = (test: (p: NonNullable<(typeof profiles)[0]>) => boolean) =>
      profiles.filter((p) => p !== null && test(p)).length;

    expect(objectives).toHaveLength(7);
    expect(count((p) => p.objectiveType === "sectoral")).toBe(5);
    expect(count((p) => p.objectiveType === "operational")).toBe(2);
    expect(indicators).toHaveLength(5);

    expect(count((p) => p.priority === "priority")).toBe(3);
    expect(
      count((p) => p.objectiveType === "sectoral" && p.planStatus === "new"),
    ).toBeGreaterThan(0);
    expect(
      count(
        (p) => p.objectiveType === "sectoral" && p.planStatus === "carried",
      ),
    ).toBeGreaterThan(0);
    expect(count((p) => p.baselineUndetermined)).toBe(2);
    expect(count((p) => p.sourceKind === "sub_strategy")).toBe(5);
    expect(count((p) => p.sourceKind === "proposed")).toBe(1);
    expect(count((p) => p.sourceKind === "leadership_directive")).toBe(1);
  });

  it("sit in the plan year, on the space the specification names", async () => {
    const rows = await sql<{ title: string; space: string; cycle_id: string }>(
      `select g.title, s.name as space, g.cycle_id
         from goals g join spaces s on s.id = g.space_id
        where g.workspace_id = $1 and g.deleted_at is null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.cycle_id).toBe(built.planCycleId);
    }
    expect(
      rows.find((r) => r.title.startsWith("إقفال الحسابات الشهرية"))?.space,
    ).toBe("وكالة الشؤون المالية");
  });
});

describe("the indicators and their readings", () => {
  it("are fourteen, measured as the specification says", async () => {
    const rows = await sql<{
      frequency: string;
      direction: string;
      owner_kind: string;
    }>(
      `select frequency, direction, owner_kind from kpis
        where workspace_id = $1 and deleted_at is null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(14);
    expect(rows.filter((r) => r.frequency === "monthly")).toHaveLength(5);
    expect(rows.filter((r) => r.frequency === "quarterly")).toHaveLength(8);
    expect(rows.filter((r) => r.frequency === "yearly")).toHaveLength(1);
    expect(rows.filter((r) => r.direction === "lower_better")).toHaveLength(2);
    expect(rows.filter((r) => r.owner_kind === "space")).toHaveLength(5);
  });

  it("carry the weights: two pairs of a half, one three of a third, to the two decimals the product keeps", async () => {
    const rows = await sql<{ title: string; weights: string[] }>(
      `select g.title, array_agg(kr.weight::float8::text order by kr.weight) as weights
         from key_results kr join goals g on g.id = kr.goal_id
        where kr.workspace_id = $1 and kr.deleted_at is null
          and kr.kpi_id is not null
        group by g.title`,
      [workspaceId],
    );
    const shapes = rows.map((r) => r.weights.join("+")).sort();
    expect(shapes).toEqual(
      ["0.5+0.5", "0.5+0.5", "0.33+0.33+0.33", "1", "1"].sort(),
    );
  });

  const readings = async (title: string) =>
    sql<{ period: string; actual: string | null; remark: string | null }>(
      `select r.period_start::text as period, r.actual_value::text as actual, r.remark
         from kpi_records r join kpis k on k.id = r.kpi_id
        where r.workspace_id = $1 and k.title = $2 and r.deleted_at is null
        order by r.period_start`,
      [workspaceId, title],
    );

  it("run from January to October of the year before", async () => {
    const rows = await readings(
      "نسبة التراخيص الصادرة خلال اتفاقية مستوى الخدمة",
    );
    expect(rows.map((r) => r.period)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ]);
    expect(rows.at(-1)?.remark).toContain("431 من أصل 490");
  });

  it("hold a due period with no reading", async () => {
    const rows = await readings("متوسط زمن الرد على استفسارات المستفيدين");
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.period)).not.toContain("2026-07-01");
  });

  it("hold an indicator added in April", async () => {
    const rows = await readings("نسبة المعاملات المنجزة عبر القنوات الرقمية");
    expect(rows[0]?.period).toBe("2026-04-01");
    expect(rows).toHaveLength(7);
  });

  it("hold an indicator whose guide is not approved, with no values", async () => {
    const rows = await readings("نسبة الأنظمة المتكاملة عبر منصة التكامل");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.actual).toBeNull();
      expect(row.remark).toBe("لم يُعتمد دليل المؤشر بعد.");
    }
  });

  it("hold nothing for the yearly indicator, which is not due", async () => {
    expect(await readings("مؤشر نضج التحول الرقمي")).toHaveLength(0);
  });

  it("quarters are read three times", async () => {
    const rows = await readings("نسبة الامتثال في الجولات الرقابية");
    expect(rows.map((r) => r.period)).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
    ]);
  });
});

describe("what the database holds against the data file", () => {
  it("every reading, with its value and the 2026 target", async () => {
    const rows = await sql<{
      title: string;
      period: string;
      actual: number | null;
      target: number | null;
    }>(
      `select k.title, r.period_start::text as period,
              r.actual_value::float8 as actual, r.target_value::float8 as target
         from kpi_records r join kpis k on k.id = r.kpi_id
        where r.workspace_id = $1 and r.deleted_at is null`,
      [workspaceId],
    );
    const expected = INDICATORS.flatMap((k) =>
      k.readings.map((r) => ({
        title: k.title,
        // A quarter is read at its end and stored at its start.
        period: `2026-${String(
          k.frequency === "quarterly" ? r.month - 2 : r.month,
        ).padStart(2, "0")}-01`,
        actual: r.actual,
        target: k.target2026,
      })),
    );
    const key = (r: { title: string; period: string }) =>
      `${r.title} ${r.period}`;
    expect(rows.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      expected.sort((a, b) => key(a).localeCompare(key(b))),
    );
    expect(rows).toHaveLength(68);
  });

  it("every indicator's plan-year target", async () => {
    const rows = await sql<{ title: string; target: number }>(
      `select title, target_default::float8 as target from kpis
        where workspace_id = $1 and deleted_at is null`,
      [workspaceId],
    );
    expect(Object.fromEntries(rows.map((r) => [r.title, r.target]))).toEqual(
      Object.fromEntries(INDICATORS.map((k) => [k.title, k.target2027])),
    );
  });

  it("every measure: its objective, its indicator, baseline and target", async () => {
    const rows = await sql<{
      objective: string;
      indicator: string;
      baseline: number;
      target: number;
      level: string;
    }>(
      `select g.title as objective, k.title as indicator, g.level,
              kr.baseline_value::float8 as baseline, kr.target_value::float8 as target
         from key_results kr
         join goals g on g.id = kr.goal_id
         join kpis k on k.id = kr.kpi_id
        where kr.workspace_id = $1 and kr.deleted_at is null`,
      [workspaceId],
    );
    const indicators = new Map(INDICATORS.map((k) => [k.key, k]));
    const expected = OBJECTIVES.flatMap((o) =>
      o.measures.map((m) => ({
        objective: o.title,
        indicator: indicators.get(m.indicatorKey)?.title,
        baseline: m.baseline ?? 0,
        target: indicators.get(m.indicatorKey)?.target2027,
        level: "department",
      })),
    );
    const key = (r: { indicator?: string }) => r.indicator ?? "";
    expect(rows.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      expected.sort((a, b) => key(a).localeCompare(key(b))),
    );
    // A measure whose baseline is its target can never score.
    for (const row of rows) {
      expect(row.baseline, row.indicator).not.toBe(row.target);
    }
  });

  it("every initiative: its agency, owner, dates and status", async () => {
    const rows = await sql<{
      title: string;
      space: string;
      owner: string;
      starts: string;
      ends: string;
      status: string;
    }>(
      `select i.title, s.name as space, wm.title as owner, i.status,
              i.starts_on::text as starts, i.ends_on::text as ends
         from initiatives i
         join spaces s on s.id = i.space_id
         join workspace_members wm on wm.id = i.owner_id
        where i.workspace_id = $1 and i.deleted_at is null`,
      [workspaceId],
    );
    const agencies = new Map(
      SECTORS.flatMap((s) => s.agencies.map((a) => [a.key, a.name] as const)),
    );
    const titles = new Map(PEOPLE.map((p) => [p.key, p.title]));
    const expected = INITIATIVES.map((i) => ({
      title: i.title,
      space: agencies.get(i.agencyKey),
      owner: titles.get(i.ownerKey),
      status: i.carried ? "active" : "planned",
      starts: i.carried ? "2026-03-01" : "2027-01-01",
      ends: "2027-12-31",
    }));
    const key = (r: { title: string }) => r.title;
    expect(rows.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      expected.sort((a, b) => key(a).localeCompare(key(b))),
    );
  });
});

describe("the initiatives", () => {
  it("are fifteen, each in an agency", async () => {
    const rows = await sql<{ space: string }>(
      `select s.name as space
         from initiatives i join spaces s on s.id = i.space_id
        where i.workspace_id = $1 and i.deleted_at is null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(15);
    for (const row of rows) {
      expect(row.space.startsWith("وكالة")).toBe(true);
    }
  });

  it("serve every sector objective but one", async () => {
    const rows = await sql<{ title: string; initiatives: string }>(
      `select g.title, count(distinct ikr.initiative_id)::text as initiatives
         from goals g
         join goal_strategy_profiles p on p.goal_id = g.id
         left join key_results kr on kr.goal_id = g.id and kr.deleted_at is null
         left join initiative_key_results ikr on ikr.key_result_id = kr.id
        where g.workspace_id = $1 and p.objective_type = 'sectoral'
        group by g.title`,
      [workspaceId],
    );
    expect(rows).toHaveLength(5);
    const bare = rows.filter((r) => r.initiatives === "0");
    expect(bare.map((r) => r.title)).toEqual([
      "رفع نسبة الامتثال في الجولات الرقابية إلى 95%",
    ]);
  });

  it("hold two that are alike in one agency", async () => {
    const rows = await sql<{ title: string }>(
      `select i.title from initiatives i join spaces s on s.id = i.space_id
        where i.workspace_id = $1 and s.name = 'وكالة التراخيص'
          and i.title like '%إجراءات إصدار التراخيص'`,
      [workspaceId],
    );
    expect(rows).toHaveLength(2);
  });
});

describe("a workspace that is not empty", () => {
  it("is refused when somebody else is a member, and no account is made", () => {
    expect(inUse).toEqual({ code: "conflict", personas: 0 });
  });

  it("is refused when the five addresses are taken, and leaves their passwords", async () => {
    const fresh = await workspaceOf("second-owner", "جهة ثانية");
    expect(
      await codeOf(
        build(
          { workspaceId: fresh, adminUserId: "second-owner" },
          "another-password-entirely",
        ),
      ),
    ).toBe("conflict");
    const person = built.people[0];
    const signedIn = await auth.api.signInEmail({
      body: { email: person?.email as string, password: PASSWORD },
    });
    expect(signedIn.user.id).toBe(person?.userId);
    const joined = await sql(
      `select id from workspace_members where workspace_id = $1 and user_id <> 'second-owner' and kind = 'human'`,
      [fresh],
    );
    expect(joined).toHaveLength(0);
  });
});

describe("a second run", () => {
  it("is refused, and writes nothing", async () => {
    const before = await sql<{ goals: string; members: string }>(
      `select (select count(*) from goals where workspace_id = $1)::text as goals,
              (select count(*) from workspace_members where workspace_id = $1)::text as members`,
      [workspaceId],
    );
    await expect(build()).rejects.toMatchObject({ code: "conflict" });
    const after = await sql<{ goals: string; members: string }>(
      `select (select count(*) from goals where workspace_id = $1)::text as goals,
              (select count(*) from workspace_members where workspace_id = $1)::text as members`,
      [workspaceId],
    );
    expect(after).toEqual(before);
  });

  it("refuses a password shorter than the sign-up page allows", async () => {
    await expect(
      buildTrialEntity({
        pool: await pool(),
        workspaceId,
        adminUserId: OWNER,
        auth,
        password: "short",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
