"use client";

import {
  SelectInput,
  SubmitButton,
  TextArea,
  TextInput,
  useTranslations,
} from "@openokr/ui";
import { type ReactNode, useActionState } from "react";
import {
  addSource,
  createGap,
  dismissGap,
  draftGaps,
  removeSource,
} from "./actions.ts";
import { type GapWriteState, NO_GAP_WRITE } from "./write-state.ts";

type Action = (
  previous: GapWriteState,
  form: FormData,
) => Promise<GapWriteState>;

function Refusal({ state }: { readonly state: GapWriteState }) {
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
function OneButton({
  action,
  fields,
  children,
}: {
  readonly action: Action;
  readonly fields: Readonly<Record<string, string>>;
  readonly children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NO_GAP_WRITE);
  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="flex flex-col gap-2"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div>
        <SubmitButton>{children}</SubmitButton>
      </div>
      <Refusal state={state} />
    </form>
  );
}

export function DraftGapsButton({ sectorId }: { readonly sectorId: string }) {
  const { t } = useTranslations();
  return (
    <OneButton action={draftGaps} fields={{ sector: sectorId }}>
      {t("planning.gaps.agent.run")}
    </OneButton>
  );
}

export function DismissGapButton({ gapId }: { readonly gapId: string }) {
  const { t } = useTranslations();
  return (
    <OneButton action={dismissGap} fields={{ gap: gapId }}>
      {t("planning.gaps.dismiss")}
    </OneButton>
  );
}

export function RemoveSourceButton({
  evidenceId,
}: {
  readonly evidenceId: string;
}) {
  const { t } = useTranslations();
  return (
    <OneButton action={removeSource} fields={{ evidence: evidenceId }}>
      {t("planning.gaps.source.remove")}
    </OneButton>
  );
}

/** A gap written by hand. It starts as a draft, with no agent involved. */
export function NewGapForm({ sectorId }: { readonly sectorId: string }) {
  const { t } = useTranslations();
  const [state, action, pending] = useActionState(createGap, NO_GAP_WRITE);
  const kept = state.values;
  return (
    <form
      action={action}
      aria-busy={pending}
      // Emptied by remounting once a gap is added, kept after a refusal.
      key={state.saved ? "saved" : "typing"}
      className="flex flex-col gap-3 sm:max-w-xl"
    >
      <input type="hidden" name="sector" value={sectorId} />
      <TextInput
        key={`title:${kept?.title ?? ""}`}
        label={t("planning.gaps.new.title")}
        name="title"
        defaultValue={kept?.title ?? ""}
        required
        maxLength={300}
      />
      <TextArea
        key={`description:${kept?.description ?? ""}`}
        label={t("planning.gaps.new.description")}
        name="description"
        defaultValue={kept?.description ?? ""}
        rows={3}
        maxLength={4000}
      />
      <Refusal state={state} />
      <div>
        <SubmitButton>{t("planning.gaps.new.submit")}</SubmitButton>
      </div>
    </form>
  );
}

/** A quotation for a gap: which document, which page, and the words. */
export function AddSourceForm({
  gapId,
  documents,
}: {
  readonly gapId: string;
  readonly documents: readonly {
    readonly id: string;
    readonly title: string;
  }[];
}) {
  const { t } = useTranslations();
  const [state, action, pending] = useActionState(addSource, NO_GAP_WRITE);
  const kept = state.values;
  if (documents.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        {t("planning.gaps.source.noDocuments")}
      </p>
    );
  }
  return (
    <form
      action={action}
      aria-busy={pending}
      key={state.saved ? "saved" : "typing"}
      className="flex flex-col gap-3 sm:max-w-xl"
    >
      <input type="hidden" name="gap" value={gapId} />
      <div className="flex flex-wrap gap-3">
        <SelectInput
          key={`document:${kept?.documentId ?? ""}`}
          label={t("planning.gaps.source.document")}
          name="documentId"
          defaultValue={kept?.documentId ?? documents[0]?.id}
        >
          {documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title}
            </option>
          ))}
        </SelectInput>
        <TextInput
          key={`page:${kept?.page ?? ""}`}
          label={t("planning.gaps.source.page")}
          name="page"
          inputMode="numeric"
          defaultValue={kept?.page ?? ""}
          required
          inputClassName="w-20"
        />
      </div>
      <TextArea
        key={`quote:${kept?.quote ?? ""}`}
        label={t("planning.gaps.source.quote")}
        description={t("planning.gaps.source.quoteHint")}
        name="quote"
        defaultValue={kept?.quote ?? ""}
        rows={2}
        maxLength={2000}
        required
        dir="auto"
      />
      <Refusal state={state} />
      <div>
        <SubmitButton>{t("planning.gaps.source.add")}</SubmitButton>
      </div>
    </form>
  );
}
