/**
 * Builds the trial entity in a workspace that has nothing in it yet.
 *
 * Every write is an ordinary action called as the workspace's founder, so the
 * seed can hold nothing a person could not have made through the product, and
 * every row has its activity and audit rows. Nothing here inserts a row.
 *
 * The five people join the way an invited person joins: an account, then a
 * workspace invitation the founder issued, which is revoked before the
 * builder returns. That is the path `prepareUatPersonas` takes, reused rather
 * than widened, so no sign-up rule changes for the seed's sake.
 *
 * **Only in a workspace nobody works in.** It is refused where anybody but
 * the founder is a member, where a sector or an indicator exists, and where
 * one of the five addresses already has an account. The last is what stops a
 * second workspace on one instance from resetting the first one's passwords,
 * and stops the seed adopting an account somebody else registered.
 *
 * **Not resumable.** The people join first, so a run that stops halfway
 * leaves members the next run refuses. A preview instance is rebuilt from
 * nothing in that case, which is what it is for.
 */

import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import { callAction } from "../../actions/registry.ts";
import type { createAuth } from "../../auth/auth.ts";
import { accountFor } from "../../demo/personas.ts";
import { passwordProblem } from "../../demo/uat-personas.ts";
import { OperationError } from "../../operations/errors.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import {
  type AgencyKey,
  DOMAINS,
  INDICATORS,
  INITIATIVES,
  type IndicatorKey,
  OBJECTIVES,
  type ObjectiveKey,
  PEOPLE,
  type PersonKey,
  PLAN_YEAR,
  PREVIOUS_YEAR,
  ROLE_NAMES,
  SECTORS,
  type SeedRoleKey,
  type SpaceKey,
  STORY_DATE,
  TRIAL_MAIL_DOMAIN,
} from "./data.ts";

type Auth = ReturnType<typeof createAuth>;

export interface TrialEntityInput {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The founder. Every write is authorised as this person. */
  readonly adminUserId: string;
  readonly auth: Auth;
  /** Shared by the five people. There is deliberately no default. */
  readonly password: string;
}

export interface TrialEntityResult {
  readonly people: readonly {
    readonly key: PersonKey;
    readonly name: string;
    readonly title: string;
    readonly email: string;
    readonly userId: string;
  }[];
  readonly sectors: readonly {
    readonly key: string;
    readonly name: string;
    readonly spaceId: string;
  }[];
  readonly planCycleId: string;
  readonly domains: number;
  readonly agencies: number;
  readonly objectives: number;
  readonly indicators: number;
  readonly readings: number;
  readonly initiatives: number;
}

type Ctx = {
  pool: Pool;
  workspaceId: string;
  actor: { kind: "human"; userId: string };
};

const need = <Key, Value>(map: Map<Key, Value>, key: Key): Value => {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(
      `The trial entity's data names "${String(key)}" and nothing made it.`,
    );
  }
  return value;
};

export async function buildTrialEntity(
  input: TrialEntityInput,
): Promise<TrialEntityResult> {
  const problem = passwordProblem(input.password);
  if (problem) {
    throw new OperationError("forbidden", problem);
  }
  const admin: Ctx = {
    pool: input.pool,
    workspaceId: input.workspaceId,
    actor: { kind: "human", userId: input.adminUserId },
  };

  await refuseUnlessEmpty(input, admin);

  const { people, members } = await joinPeople(input, admin);
  await giveRoles(admin, members);

  for (const domain of DOMAINS) {
    await callAction(admin, "strategy.createDomain", {
      name: domain.name,
      description: domain.description,
    });
  }

  await annualCycle(admin, PREVIOUS_YEAR);
  const planCycleId = await annualCycle(admin, PLAN_YEAR);

  const { spaces, sectors } = await buildOrganisation(admin, members);
  const { kpis, readings } = await buildIndicators(admin, spaces);
  const keyResults = await buildObjectives(
    admin,
    planCycleId,
    spaces,
    members,
    kpis,
  );
  await buildInitiatives(admin, spaces, members, keyResults);

  return {
    people,
    sectors,
    planCycleId,
    domains: DOMAINS.length,
    agencies: SECTORS.reduce((sum, sector) => sum + sector.agencies.length, 0),
    objectives: OBJECTIVES.length,
    indicators: INDICATORS.length,
    readings,
    initiatives: INITIATIVES.length,
  };
}

async function refuseUnlessEmpty(
  input: TrialEntityInput,
  admin: Ctx,
): Promise<void> {
  const refuse = (what: string): never => {
    throw new OperationError(
      "conflict",
      `${what} The trial entity is only built in a workspace nobody works in yet.`,
    );
  };

  const humans = await withWorkspace(
    drizzle(input.pool),
    input.workspaceId,
    (tx) =>
      tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.kind, "human"),
            ),
          ),
        ),
  );
  const others = humans.filter((one) => one.userId !== input.adminUserId);
  if (others.length > 0) {
    refuse(
      `This workspace has ${others.length} member(s) besides its founder.`,
    );
  }

  const existing = await callAction(admin, "strategy.listOrgUnits", {});
  if (existing.sectors.length > 0) {
    refuse("This workspace already has sectors.");
  }
  const { kpis } = await callAction(admin, "kpis.list", {});
  if (kpis.length > 0) {
    refuse("This workspace already has indicators.");
  }

  // The instance, not the workspace: an account is one per address.
  const addresses = PEOPLE.map(
    (person) => `${person.mailbox}@${TRIAL_MAIL_DOMAIN}`,
  );
  const { rows } = await input.pool.query<{ email: string }>(
    "select email from users where lower(email) = any($1)",
    [addresses],
  );
  if (rows.length > 0) {
    refuse(
      `An account already exists for ${rows.map((row) => row.email).join(", ")}, so the trial entity was built on this instance before.`,
    );
  }
}

async function joinPeople(
  input: TrialEntityInput,
  admin: Ctx,
): Promise<{
  people: TrialEntityResult["people"];
  members: Map<PersonKey, string>;
}> {
  const link = await callAction(admin, "invitations.createWorkspaceLink", {
    maxUses: PEOPLE.length,
    expiresInDays: 1,
    allowedDomains: [TRIAL_MAIL_DOMAIN],
  });
  const people: TrialEntityResult["people"][number][] = [];
  try {
    for (const person of PEOPLE) {
      const email = `${person.mailbox}@${TRIAL_MAIL_DOMAIN}`;
      const userId = await accountFor(input, person.name, email);
      await callAction(
        { ...admin, actor: { kind: "human", userId } },
        "invitations.acceptLink",
        { token: link.token },
      );
      people.push({
        key: person.key,
        name: person.name,
        title: person.title,
        email,
        userId,
      });
    }
  } finally {
    // Revoked whether or not everybody made it, so a run that stopped
    // halfway leaves no link somebody else could join through.
    await callAction(admin, "invitations.revokeLink", { linkId: link.id });
  }

  const members = new Map<PersonKey, string>();
  for (const person of people) {
    const [row] = await withWorkspace(
      drizzle(input.pool),
      input.workspaceId,
      (tx) =>
        tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              and(
                eq(workspaceMembers.workspaceId, input.workspaceId),
                eq(workspaceMembers.userId, person.userId),
              ),
            ),
          )
          .limit(1),
    );
    if (!row) {
      throw new Error(
        `${person.email} accepted the invitation and is no member.`,
      );
    }
    members.set(person.key, row.id);
    await callAction(admin, "people.updateMember", {
      memberId: row.id,
      title: person.title,
    });
  }
  return { people, members };
}

/**
 * The two roles design §13.2 approved, made from the built-in ones as they
 * stand in this workspace rather than from a copy of their levels kept here.
 */
async function giveRoles(
  admin: Ctx,
  members: Map<PersonKey, string>,
): Promise<void> {
  const { roles } = await callAction(admin, "roles.list", {});
  const builtin = (key: string) => {
    const role = roles.find((one) => one.builtinKey === key);
    if (!role) {
      throw new Error(`The workspace has no built-in "${key}" role.`);
    }
    return new Map(role.permissions.map((p) => [p.domain, p.level]));
  };
  const member = builtin("member");
  const viewer = builtin("viewer");

  // The strategy office is a Member who may also submit for approval.
  const strategyOffice = new Map(member).set("approval", ACCESS_LEVELS.edit);
  // Leadership reads everything, comments, and decides. It writes nothing.
  const leadership = new Map(viewer)
    .set("comment", Math.max(viewer.get("comment") ?? 0, ACCESS_LEVELS.comment))
    .set("approval", ACCESS_LEVELS.full);

  const levels: Record<SeedRoleKey, Map<string, number>> = {
    strategyOffice,
    leadership,
  };
  const roleIds = new Map<SeedRoleKey, string>();
  for (const key of Object.keys(levels) as SeedRoleKey[]) {
    const created = await callAction(admin, "roles.create", {
      name: ROLE_NAMES[key],
      // `roles.list` answers a domain as a string and a level as a number,
      // where `roles.create` wants its own enums. Both came from this
      // workspace's built-in roles a moment ago, and the action validates
      // them again, so the narrowing is asserted rather than repeated here.
      permissions: [...levels[key]].map(([domain, level]) => ({
        domain: domain as never,
        level: level as never,
      })),
    });
    roleIds.set(key, created.id);
  }
  for (const person of PEOPLE) {
    if (person.role) {
      await callAction(admin, "roles.assign", {
        memberId: need(members, person.key),
        roleId: need(roleIds, person.role),
      });
    }
  }
}

/** The annual cycle of a year, made unless the workspace already has it. */
async function annualCycle(admin: Ctx, year: number): Promise<string> {
  const cycles = await callAction(admin, "cycles.list", {});
  const found = cycles.find(
    (cycle) =>
      cycle.mode === "annual" &&
      cycle.startsOn === `${year}-01-01` &&
      cycle.endsOn === `${year}-12-31`,
  );
  if (found) {
    return found.id;
  }
  const created = await callAction(admin, "cycles.create", {
    on: `${year}-06-01`,
    mode: "annual",
    firstCycle: false,
    asOf: STORY_DATE,
  });
  return created.id;
}

async function buildOrganisation(
  admin: Ctx,
  members: Map<PersonKey, string>,
): Promise<{
  spaces: Map<SpaceKey, string>;
  sectors: TrialEntityResult["sectors"];
}> {
  const spaces = new Map<SpaceKey, string>();
  const sectors: TrialEntityResult["sectors"][number][] = [];
  const strategyId = need(members, "strategy");

  for (const sector of SECTORS) {
    const leadId = sector.leadKey ? need(members, sector.leadKey) : undefined;
    const sectorSpace = await callAction(admin, "spaces.create", {
      name: sector.name,
      mission: sector.mission,
    });
    spaces.set(sector.key, sectorSpace.id);
    sectors.push({
      key: sector.key,
      name: sector.name,
      spaceId: sectorSpace.id,
    });
    await callAction(admin, "strategy.setSector", {
      spaceId: sectorSpace.id,
      ...(leadId ? { leadMemberId: leadId } : {}),
    });
    // Membership is what gives `edit` on a sector, and the strategy office
    // drafts and submits for every one of them.
    for (const memberId of new Set([strategyId, ...(leadId ? [leadId] : [])])) {
      await callAction(admin, "spaces.addMember", {
        spaceId: sectorSpace.id,
        memberId,
        role: "member",
      });
    }

    for (const agency of sector.agencies) {
      const agencySpace = await callAction(admin, "spaces.create", {
        name: agency.name,
        mission: agency.mission,
      });
      spaces.set(agency.key, agencySpace.id);
      await callAction(admin, "strategy.setAgency", {
        spaceId: agencySpace.id,
        sectorSpaceId: sectorSpace.id,
      });
      // Access is not inherited from a sector in the slice, so its lead is
      // made a member of each of its agencies (design §12.1).
      const agencyMembers = new Set([
        ...(leadId ? [leadId] : []),
        ...(agency.memberKeys ?? []).map((key) => need(members, key)),
      ]);
      for (const memberId of agencyMembers) {
        await callAction(admin, "spaces.addMember", {
          spaceId: agencySpace.id,
          memberId,
          role: "member",
        });
      }
    }
  }
  return { spaces, sectors };
}

const monthOf = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}-01`;

async function buildIndicators(
  admin: Ctx,
  spaces: Map<SpaceKey, string>,
): Promise<{ kpis: Map<IndicatorKey, string>; readings: number }> {
  const kpis = new Map<IndicatorKey, string>();
  let readings = 0;
  for (const indicator of INDICATORS) {
    const created = await callAction(admin, "kpis.create", {
      title: indicator.title,
      frequency: indicator.frequency,
      direction: indicator.direction,
      indicatorType: "lagging",
      // A percentage or a duration is a level, not a running total.
      aggregate: "avg",
      unit: indicator.unit,
      targetDefault: indicator.target2027,
      ...(indicator.agencyKey
        ? {
            ownerKind: "space" as const,
            spaceId: need(spaces, indicator.agencyKey as AgencyKey),
          }
        : { ownerKind: "workspace" as const }),
    });
    kpis.set(indicator.key, created.id);

    for (const reading of indicator.readings) {
      await callAction(admin, "kpis.record", {
        kpiId: created.id,
        on: monthOf(PREVIOUS_YEAR, reading.month),
        actualValue: reading.actual,
        targetValue: indicator.target2026,
        ...(reading.remark ? { remark: reading.remark } : {}),
      });
      readings += 1;
    }
  }
  return { kpis, readings };
}

/** The key results each objective got, which is what an initiative links to. */
async function buildObjectives(
  admin: Ctx,
  cycleId: string,
  spaces: Map<SpaceKey, string>,
  members: Map<PersonKey, string>,
  kpis: Map<IndicatorKey, string>,
): Promise<Map<ObjectiveKey, string[]>> {
  const keyResults = new Map<ObjectiveKey, string[]>();
  const championId = need(members, "strategy");
  const indicators = new Map(INDICATORS.map((one) => [one.key, one]));

  for (const objective of OBJECTIVES) {
    const created = await callAction(admin, "goals.create", {
      title: objective.title,
      description: richTextFromPlainText(objective.description),
      cycleId,
      level: objective.objectiveType === "sectoral" ? "department" : "team",
      ownerKind: "space",
      spaceId: need(spaces, objective.spaceKey),
      championId,
      weight: 1,
    });

    const ids: string[] = [];
    for (const measure of objective.measures) {
      const indicator = need(indicators, measure.indicatorKey);
      const added = await callAction(admin, "goals.addKeyResult", {
        goalId: created.id,
        title: indicator.title,
        unit: indicator.unit,
        kind: "metric",
        direction:
          indicator.direction === "higher_better" ? "increase" : "reduce",
        indicatorType: "lagging",
        // The product refuses a metric with no baseline. One the plan calls
        // undetermined is stored as zero, and the objective's profile is
        // what says it is not known, which is the field the plan reads.
        baselineValue: measure.baseline ?? 0,
        targetValue: indicator.target2027,
        weight: measure.weight,
        kpiId: need(kpis, measure.indicatorKey),
      });
      ids.push(added.id);
    }
    keyResults.set(objective.key, ids);

    await callAction(admin, "strategy.setGoalProfile", {
      goalId: created.id,
      objectiveType: objective.objectiveType,
      priority: objective.priority,
      planStatus: objective.planStatus,
      sourceKind: objective.sourceKind,
      baselineUndetermined: objective.baselineUndetermined,
    });
  }
  return keyResults;
}

async function buildInitiatives(
  admin: Ctx,
  spaces: Map<SpaceKey, string>,
  members: Map<PersonKey, string>,
  keyResults: Map<ObjectiveKey, string[]>,
): Promise<void> {
  for (const initiative of INITIATIVES) {
    const linked = initiative.objectiveKey
      ? need(keyResults, initiative.objectiveKey).slice(0, 1)
      : [];
    await callAction(admin, "initiatives.create", {
      spaceId: need(spaces, initiative.agencyKey),
      title: initiative.title,
      description: richTextFromPlainText(initiative.description),
      ownerId: need(members, initiative.ownerKey),
      startsOn: initiative.carried
        ? monthOf(PREVIOUS_YEAR, 3)
        : monthOf(PLAN_YEAR, 1),
      endsOn: `${PLAN_YEAR}-12-31`,
      status: initiative.carried ? "active" : "planned",
      ...(linked.length > 0 ? { keyResultIds: linked } : {}),
    });
  }
}
