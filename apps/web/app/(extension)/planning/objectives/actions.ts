"use server";

/**
 * The writes of the proposed objectives screen (design b0-vertical-slice.md,
 * criteria 8 and 17): a run of the objective agent, and a person confirming
 * who answers for a drafted objective.
 *
 * Each is one registry action, which decides access. A refusal comes back as
 * a sentence, and the list is asked again either way: a run that fails is
 * recorded before it is refused.
 */
import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { planningContext } from "../../../../lib/extension/planning.ts";
import { refusalOf } from "../../../../lib/refusal";
import type { PlanningWriteState } from "../write-state.ts";

const text = (form: FormData, name: string): string =>
  String(form.get(name) ?? "").trim();

async function run(
  write: (
    context: Awaited<ReturnType<typeof planningContext>>,
  ) => Promise<unknown>,
  /** What was chosen, handed back either way so a choice is not lost. */
  values?: Readonly<Record<string, string>>,
): Promise<PlanningWriteState> {
  try {
    await write(await planningContext());
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    revalidatePath("/planning/objectives");
    return { error: refusal, ...(values ? { values } : {}) };
  }
  revalidatePath("/planning/objectives");
  return { error: null, saved: true, ...(values ? { values } : {}) };
}

export async function draftObjectives(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  const cycleId = text(form, "cycle");
  return run(
    (context) =>
      callAction(context, "planning.runObjectiveAgent", {
        spaceId: text(form, "sector"),
        cycleId,
      }),
    { cycle: cycleId },
  );
}

export async function confirmOwner(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  return run((context) =>
    callAction(context, "strategy.confirmGoalOwner", {
      goalId: text(form, "goal"),
    }),
  );
}
