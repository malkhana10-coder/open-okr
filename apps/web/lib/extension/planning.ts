import {
  type ActionCallContext,
  callAction,
  OperationError,
  trialEntityPlanner,
} from "@openokr/core";
import { getPool } from "../pool";
import { requireWorkspace } from "../workspace";

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
    planner: trialEntityPlanner(),
  };
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
export async function sectorsFor(
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
