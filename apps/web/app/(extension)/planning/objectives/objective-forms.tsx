"use client";

import { SelectInput, SubmitButton, useTranslations } from "@openokr/ui";
import { useActionState } from "react";
import { OneButton, Refusal } from "../one-button.tsx";
import { NO_PLANNING_WRITE } from "../write-state.ts";
import { confirmOwner, draftObjectives } from "./actions.ts";

/** Runs the objective agent for the sector, into the cycle chosen. */
export function DraftObjectivesButton({
  sectorId,
  cycles,
  cycleId,
}: {
  readonly sectorId: string;
  readonly cycles: readonly { readonly id: string; readonly name: string }[];
  /** The cycle offered first: the plan the sector is working on. */
  readonly cycleId: string;
}) {
  const { t } = useTranslations();
  const [state, action, pending] = useActionState(
    draftObjectives,
    NO_PLANNING_WRITE,
  );
  // React empties a form when its action returns. The cycle somebody chose
  // is put back, or the next press would draft into the default one.
  const chosen = state.values?.cycle ?? cycleId;
  return (
    <form action={action} aria-busy={pending} className="flex flex-col gap-2">
      <input type="hidden" name="sector" value={sectorId} />
      <SelectInput
        key={chosen}
        label={t("planning.objectives.agent.cycle")}
        name="cycle"
        defaultValue={chosen}
        inputClassName="w-auto min-w-56"
      >
        {cycles.map((cycle) => (
          <option key={cycle.id} value={cycle.id}>
            {cycle.name}
          </option>
        ))}
      </SelectInput>
      <div>
        <SubmitButton>{t("planning.objectives.agent.run")}</SubmitButton>
      </div>
      <Refusal state={state} />
    </form>
  );
}

/** A person saying the owner an objective was given is the right one. */
export function ConfirmOwnerButton({ goalId }: { readonly goalId: string }) {
  const { t } = useTranslations();
  return (
    <OneButton action={confirmOwner} fields={{ goal: goalId }}>
      {t("planning.objectives.owner.confirm")}
    </OneButton>
  );
}
