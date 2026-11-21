import {
  type ActionCallContext,
  callAction,
  OperationError,
  trialEntityPlanner,
} from "@openokr/core";
import type { PlanningProvider } from "@openokr/planning-agents";
import { getPool } from "../pool";
import { getTranslations } from "../translations";
import { requireWorkspace } from "../workspace";
import { planningFormat } from "./format.ts";

/**
 * What every planning screen starts from: who is asking, and the provider the
 * two agents draft with.
 *
 * **The provider is the fixed one until a real model is connected** (design
 * b0-vertical-slice.md §9a). It needs no setting, and it is safe to hand to
 * every workspace: it drafts only for the trial entity's two invented
 * documents, which it recognises by their first page, and answers anything
 * else with nothing and the reason. A run it makes is listed as a sample.
 */
export async function planningContext(): Promise<ActionCallContext> {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human", userId: session.user.id },
    planner: planningProvider(),
  };
}

/**
 * The provider the planning agents draft with.
 *
 * `fixed` is what the screens read to say, before anybody presses a button,
 * that the output is a sample. A provider that asks a model is not fixed:
 * its buttons are AI affordances, which carry the AI mark and are hidden
 * when the workspace's AI is off. `planning-provider.test.ts` fails the day
 * this stops being a fixed provider, so that work cannot be forgotten.
 */
export function planningProvider(): PlanningProvider {
  return trialEntityPlanner();
}

export interface PlanningSector {
  readonly spaceId: string;
  readonly name: string;
}

/**
 * The sectors of the workspace, and whether the address names one of them.
 *
 * Every member may list the sectors. Whether this member may open one is
 * decided by the read that follows, which answers not-found for a sector
 * they hold no `edit` on, and `refusedSector` turns that into the screen's
 * own sentence.
 *
 * `wanted` is the address, which a person can edit: it is only ever a sector
 * when it is in the list. A space that is not a sector is not one because
 * the member happens to be allowed to edit it.
 */
async function sectorsFor(
  context: ActionCallContext,
  wanted: string | undefined,
): Promise<{
  readonly sectors: readonly PlanningSector[];
  /** The sector the address names, when it names one. */
  readonly named: string | null;
  /** True when the address names something that is not a sector. */
  readonly unknown: boolean;
}> {
  const { sectors } = await callAction(context, "strategy.listOrgUnits", {});
  const list = sectors.map((sector) => ({
    spaceId: sector.spaceId,
    name: sector.name,
  }));
  const asked = wanted === undefined || wanted === "" ? null : wanted;
  const named =
    asked !== null && list.some((sector) => sector.spaceId === asked)
      ? asked
      : null;
  return { sectors: list, named, unknown: asked !== null && named === null };
}

/**
 * Whether a read was refused because of the sector, which a screen says in
 * words. Anything else is a fault and goes to the error boundary.
 *
 * Only called around a read of a sector that `sectorsFor` found in the list,
 * so a not-found here is the member's access and not a missing workspace.
 */
export function refusedSector(error: unknown): boolean {
  return (
    error instanceof OperationError &&
    (error.code === "not_found" || error.code === "forbidden")
  );
}

export type OpenedSector<Data> =
  | { readonly state: "none"; readonly sectors: readonly PlanningSector[] }
  | {
      readonly state: "refused";
      readonly sectors: readonly PlanningSector[];
      /** The sector the address names, when it names one. */
      readonly named: string | null;
      /**
       * `denied` is a sector named and not open to this member, or an
       * address that names no sector. `noneOpen` is no sector named and none
       * this member may open.
       */
      readonly reason: "denied" | "noneOpen";
    }
  | {
      readonly state: "open";
      readonly sectors: readonly PlanningSector[];
      readonly sectorId: string;
      readonly data: Data;
    };

/**
 * The sector a planning screen shows, and the screen's first read of it.
 *
 * With a sector in the address, that one. With none, the first this member
 * may open: the list holds every sector, and a member is often in one of
 * them and not the first.
 *
 * `read` is one read of the screen's own, which answers for the member's
 * access, so there is no second rule here to drift from it. Keep it to one
 * cheap action: with no sector named it runs once per sector until one
 * opens. Whatever else the screen needs is read after, where a refusal is a
 * fault and not "no access".
 */
export async function openSector<Data>(
  context: ActionCallContext,
  wanted: string | undefined,
  read: (spaceId: string) => Promise<Data>,
): Promise<OpenedSector<Data>> {
  const { sectors, named, unknown } = await sectorsFor(context, wanted);
  if (sectors.length === 0) {
    return { state: "none", sectors };
  }
  if (unknown) {
    return { state: "refused", sectors, named: null, reason: "denied" };
  }
  for (const sectorId of named ? [named] : sectors.map((s) => s.spaceId)) {
    try {
      return { state: "open", sectors, sectorId, data: await read(sectorId) };
    } catch (error) {
      if (!refusedSector(error)) {
        throw error;
      }
    }
  }
  return {
    state: "refused",
    sectors,
    named,
    reason: named ? "denied" : "noneOpen",
  };
}

/** Numbers and dates in the reader's language and timezone. */
export async function planningFormatFor(
  context: ActionCallContext,
): Promise<ReturnType<typeof planningFormat>> {
  const [{ locale }, { settings }] = await Promise.all([
    getTranslations(),
    callAction(context, "settings.readForMember", {}),
  ]);
  return planningFormat(locale, String(settings.timezone ?? "UTC"));
}
