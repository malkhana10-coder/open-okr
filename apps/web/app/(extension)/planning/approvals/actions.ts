"use server";

/**
 * The writes of the approvals screen (design b0-vertical-slice.md, criteria
 * 9, 10 and 11): a sector's request sent, and a request approved or
 * returned.
 *
 * Each is one registry action, which decides who may do it: sending needs
 * `edit` on the sector and on approvals, deciding needs `full` on the
 * request and that the decider is not its sender. A refusal comes back as a
 * sentence.
 */
import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { planningContext } from "../../../../lib/extension/planning.ts";
import { refusalOf } from "../../../../lib/refusal";
import type { PlanningWriteState } from "../write-state.ts";

/**
 * Every planning screen. A request changes what each shows of the sector.
 * The route group is part of a layout's path, though not of the address.
 */
const PLANNING = "/(extension)/planning";

const text = (form: FormData, name: string): string =>
  String(form.get(name) ?? "").trim();

async function run(
  write: (
    context: Awaited<ReturnType<typeof planningContext>>,
  ) => Promise<unknown>,
  values?: Readonly<Record<string, string>>,
): Promise<PlanningWriteState> {
  try {
    await write(await planningContext());
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    revalidatePath(PLANNING, "layout");
    return { error: refusal, ...(values ? { values } : {}) };
  }
  revalidatePath(PLANNING, "layout");
  return { error: null, saved: true };
}

export async function sendForApproval(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  return run((context) =>
    callAction(context, "governance.submit", {
      spaceId: text(form, "sector"),
    }),
  );
}

export async function approveRequest(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  return run((context) =>
    callAction(context, "governance.decide", {
      requestId: text(form, "request"),
      decision: "approve",
    }),
  );
}

export async function returnRequest(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  const comment = text(form, "comment");
  return run(
    (context) =>
      callAction(context, "governance.decide", {
        requestId: text(form, "request"),
        decision: "return",
        ...(comment ? { comment } : {}),
      }),
    { comment },
  );
}
