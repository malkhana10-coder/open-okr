"use server";

/**
 * The writes of the gaps screen (design b0-vertical-slice.md, criteria 4, 5,
 * 13 and 16): a gap written by hand, a quotation added to one or taken off,
 * a gap set aside, and a run of the gap agent.
 *
 * Each is one registry action, which decides access and checks the
 * quotation. A refusal comes back as a sentence with what was typed.
 */
import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { planningContext } from "../../../../lib/extension/planning.ts";
import { refusalOf } from "../../../../lib/refusal";
import { getTranslations } from "../../../../lib/translations";
import type { PlanningWriteState } from "../write-state.ts";

const text = (form: FormData, name: string): string =>
  String(form.get(name) ?? "").trim();

const kept = (
  form: FormData,
  keep: readonly string[],
): Record<string, string> =>
  Object.fromEntries(keep.map((name) => [name, text(form, name)]));

/** Eastern Arabic and Persian digits, which an Arabic keyboard types. */
const WESTERN: Readonly<Record<string, string>> = Object.fromEntries(
  [..."٠١٢٣٤٥٦٧٨٩"].flatMap((digit, value) => [
    [digit, String(value)],
    [String.fromCodePoint(0x06f0 + value), String(value)],
  ]),
);

/** A page number as typed, or null when it is not one. */
function pageOf(typed: string): number | null {
  const digits = [...typed].map((char) => WESTERN[char] ?? char).join("");
  if (!/^[0-9]{1,5}$/.test(digits)) {
    return null;
  }
  const page = Number(digits);
  return page >= 1 ? page : null;
}

async function run(
  form: FormData,
  keep: readonly string[],
  write: (
    context: Awaited<ReturnType<typeof planningContext>>,
  ) => Promise<unknown>,
): Promise<PlanningWriteState> {
  try {
    await write(await planningContext());
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    // A refusal can still have written: a run that fails is recorded before
    // it is refused, and a refusal is often news that the list is stale.
    revalidatePath("/planning/gaps");
    return { error: refusal, values: kept(form, keep) };
  }
  revalidatePath("/planning/gaps");
  return { error: null, saved: true };
}

export async function createGap(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  const description = text(form, "description");
  return run(form, ["title", "description"], (context) =>
    callAction(context, "strategy.createGap", {
      spaceId: text(form, "sector"),
      title: text(form, "title"),
      ...(description ? { description } : {}),
    }),
  );
}

export async function addSource(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  const keep = ["documentId", "page", "quote"];
  const page = pageOf(text(form, "page"));
  if (page === null) {
    const { t } = await getTranslations();
    return {
      error: t("planning.gaps.source.pageInvalid"),
      values: kept(form, keep),
    };
  }
  return run(form, keep, (context) =>
    callAction(context, "knowledge.addEvidence", {
      subjectType: "gap",
      subjectId: text(form, "gap"),
      documentId: text(form, "documentId"),
      page,
      quote: text(form, "quote"),
    }),
  );
}

export async function removeSource(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  return run(form, [], (context) =>
    callAction(context, "knowledge.removeEvidence", {
      id: text(form, "evidence"),
    }),
  );
}

export async function dismissGap(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  return run(form, [], (context) =>
    callAction(context, "strategy.dismissGap", { id: text(form, "gap") }),
  );
}

export async function draftGaps(
  _previous: PlanningWriteState,
  form: FormData,
): Promise<PlanningWriteState> {
  return run(form, [], (context) =>
    callAction(context, "planning.runGapAgent", {
      spaceId: text(form, "sector"),
    }),
  );
}
