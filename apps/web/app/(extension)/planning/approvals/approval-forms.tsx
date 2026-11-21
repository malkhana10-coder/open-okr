"use client";

import { SubmitButton, TextArea, useTranslations } from "@openokr/ui";
import { useActionState } from "react";
import { OneButton, Refusal } from "../one-button.tsx";
import { NO_PLANNING_WRITE } from "../write-state.ts";
import { approveRequest, returnRequest, sendForApproval } from "./actions.ts";

export function SendForApprovalButton({
  sectorId,
}: {
  readonly sectorId: string;
}) {
  const { t } = useTranslations();
  return (
    <OneButton action={sendForApproval} fields={{ sector: sectorId }}>
      {t("planning.approvals.send.submit")}
    </OneButton>
  );
}

/**
 * Approving a request. It makes every objective in it live and cannot be
 * taken back, so it is two deliberate acts: a tick that says what is being
 * approved, then the button. Both name the sector, because a decider with
 * several requests otherwise hears the same word once for each.
 */
export function ApproveForm({
  requestId,
  sector,
  gaps,
  objectives,
}: {
  readonly requestId: string;
  readonly sector: string;
  /** Already written in the reader's digits and separators. */
  readonly gaps: string;
  readonly objectives: string;
}) {
  const { t } = useTranslations();
  const [state, action, pending] = useActionState(
    approveRequest,
    NO_PLANNING_WRITE,
  );
  return (
    <form action={action} aria-busy={pending} className="flex flex-col gap-2">
      <input type="hidden" name="request" value={requestId} />
      <label className="flex items-start gap-2 text-sm text-ink-2">
        <input type="checkbox" name="confirmed" required className="mt-1" />
        <span>
          {t("planning.approvals.decide.confirm", {
            sector,
            gaps,
            objectives,
          })}
        </span>
      </label>
      <div>
        <SubmitButton
          aria-label={t("planning.approvals.decide.approveNamed", { sector })}
        >
          {t("planning.approvals.decide.approve")}
        </SubmitButton>
      </div>
      <Refusal state={state} />
    </form>
  );
}

/** A request sent back, with what has to change. */
export function ReturnForm({
  requestId,
  sector,
}: {
  readonly requestId: string;
  readonly sector: string;
}) {
  const { t } = useTranslations();
  const [state, action, pending] = useActionState(
    returnRequest,
    NO_PLANNING_WRITE,
  );
  return (
    <form
      action={action}
      aria-busy={pending}
      className="flex flex-col gap-2 sm:max-w-xl"
    >
      <input type="hidden" name="request" value={requestId} />
      <TextArea
        key={state.values?.comment ?? ""}
        label={t("planning.approvals.decide.commentNamed", { sector })}
        name="comment"
        required
        defaultValue={state.values?.comment ?? ""}
        rows={2}
        maxLength={2000}
        dir="auto"
      />
      <div>
        <SubmitButton
          aria-label={t("planning.approvals.decide.returnNamed", { sector })}
        >
          {t("planning.approvals.decide.return")}
        </SubmitButton>
      </div>
      <Refusal state={state} />
    </form>
  );
}
