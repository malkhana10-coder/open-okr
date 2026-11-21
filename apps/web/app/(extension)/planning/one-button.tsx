"use client";

import { SubmitButton } from "@openokr/ui";
import { type ReactNode, useActionState } from "react";
import { NO_PLANNING_WRITE, type PlanningWriteState } from "./write-state.ts";

type Action = (
  previous: PlanningWriteState,
  form: FormData,
) => Promise<PlanningWriteState>;

/** A refusal, in the place the person is looking. */
export function Refusal({ state }: { readonly state: PlanningWriteState }) {
  return state.error ? (
    <p
      role="alert"
      className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
    >
      {state.error}
    </p>
  ) : null;
}

/** A form of one button: the write, and its refusal beside it. */
export function OneButton({
  action,
  fields,
  children,
  before,
}: {
  readonly action: Action;
  readonly fields: Readonly<Record<string, string>>;
  readonly children: ReactNode;
  /** Fields drawn before the button, such as a choice the write needs. */
  readonly before?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    NO_PLANNING_WRITE,
  );
  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="flex flex-col gap-2"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {before}
      <div>
        <SubmitButton>{children}</SubmitButton>
      </div>
      <Refusal state={state} />
    </form>
  );
}
