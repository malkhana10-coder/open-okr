"use client";

import {
  SelectInput,
  SubmitButton,
  TextInput,
  useTranslations,
} from "@openokr/ui";
import { type FormEvent, useActionState, useState } from "react";
import { UPLOAD_LIMIT_BYTES } from "../../../../lib/upload-limit";
import { uploadDocument } from "./actions.ts";
import { NO_UPLOAD } from "./write-state.ts";

/** The form that adds a document to the sector being shown. */
export function UploadForm({
  sectorId,
  defaultYear,
}: {
  readonly sectorId: string;
  readonly defaultYear: number;
}) {
  const { t } = useTranslations();
  const [state, action, pending] = useActionState(uploadDocument, NO_UPLOAD);
  const [tooLarge, setTooLarge] = useState(false);
  const [chosenName, setChosenName] = useState<string | null>(null);
  // React empties the form once its action answers, refusal or not, and
  // the file field with it. The name shown beside the field goes too, or it
  // would name a file that is no longer chosen. Done while rendering, the
  // way React adjusts state to a changed value, rather than in an effect.
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    setChosenName(null);
  }
  const kept = state.values;

  // Said in the browser, before anything is sent: the server stops reading a
  // request a little past the limit, and a file that large would arrive as a
  // failed request with no sentence at all.
  const check = (event: FormEvent<HTMLFormElement>) => {
    const chosen = new FormData(event.currentTarget).get("file");
    const large = chosen instanceof File && chosen.size > UPLOAD_LIMIT_BYTES;
    setTooLarge(large);
    if (large) {
      event.preventDefault();
    }
  };
  const error = tooLarge
    ? t("planning.documents.upload.tooLarge")
    : state.error;

  return (
    <form
      action={action}
      onSubmit={check}
      aria-busy={pending}
      className="flex flex-col gap-3 sm:max-w-xl"
    >
      <input type="hidden" name="sector" value={sectorId} />
      {/* The browser writes its own file field in its own language, so the
          field is hidden and these words are the product's. The input stays
          in the label, focusable, and the label is its name. */}
      <label className="flex flex-col gap-1 text-sm text-ink-2">
        <span id={`${sectorId}-file-label`} className="font-medium">
          {t("planning.documents.upload.file")}
        </span>
        <span className="flex cursor-pointer items-center gap-3 rounded-md has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
          <span
            aria-hidden="true"
            className="rounded-md border border-line-2 bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 hover:border-ink-4"
          >
            {t("planning.documents.upload.choose")}
          </span>
          <span
            id={`${sectorId}-file-status`}
            className="truncate text-sm text-ink-3"
          >
            <bdi>{chosenName ?? t("planning.documents.upload.noFile")}</bdi>
          </span>
          <input
            type="file"
            name="file"
            accept="application/pdf,.pdf"
            // Named by the heading alone, with what is chosen as its
            // description, rather than by everything inside the label.
            aria-labelledby={`${sectorId}-file-label`}
            aria-describedby={`${sectorId}-file-status`}
            className="sr-only"
            onChange={(event) =>
              setChosenName(event.currentTarget.files?.[0]?.name ?? null)
            }
          />
        </span>
      </label>
      <TextInput
        // Remounted with what was typed when a refusal comes back.
        key={`title:${kept?.title ?? ""}`}
        label={t("planning.documents.upload.title")}
        name="title"
        defaultValue={kept?.title ?? ""}
        required
        maxLength={300}
      />
      <div className="flex flex-wrap gap-3">
        <SelectInput
          label={t("planning.documents.upload.kind")}
          key={`kind:${kept?.kind ?? ""}`}
          name="kind"
          defaultValue={kept?.kind ?? "sub_strategy"}
        >
          <option value="strategy">
            {t("planning.documents.kind.strategy")}
          </option>
          <option value="sub_strategy">
            {t("planning.documents.kind.sub_strategy")}
          </option>
          <option value="previous_plan">
            {t("planning.documents.kind.previous_plan")}
          </option>
          <option value="report">{t("planning.documents.kind.report")}</option>
        </SelectInput>
        {/* A year is a name, not a quantity: no digit grouping, no stepper.
            The server says what a year may be, so no pattern is set here. */}
        <TextInput
          label={t("planning.documents.upload.year")}
          name="year"
          inputMode="numeric"
          key={`year:${kept?.year ?? ""}`}
          defaultValue={kept?.year ?? String(defaultYear)}
          required
          inputClassName="w-24"
        />
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {error}
        </p>
      ) : state.saved ? (
        <p role="status" className="text-sm text-ink-2">
          {t("planning.documents.upload.saved")}
        </p>
      ) : null}
      <div>
        <SubmitButton>{t("planning.documents.upload.submit")}</SubmitButton>
      </div>
    </form>
  );
}
