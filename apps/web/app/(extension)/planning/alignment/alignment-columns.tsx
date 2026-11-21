"use client";

import { useTranslations } from "@openokr/ui";
import { useState } from "react";
import { planningFormat } from "../../../../lib/extension/format.ts";

export interface AlignedGap {
  readonly id: string;
  readonly title: string;
}

export interface AlignedObjective {
  readonly id: string;
  readonly title: string;
  /** The gaps it answers. */
  readonly gapIds: readonly string[];
}

/**
 * The sector's gaps beside the objectives that answer them.
 *
 * Choosing an item brings out what it is tied to in the other column.
 * Colour is not the only sign: a tied item also says so in words, and the
 * chosen one is a pressed button.
 */
export function AlignmentColumns({
  gaps,
  objectives,
  locale,
}: {
  /** The reader's language, for the counts. */
  readonly locale: string;
  readonly gaps: readonly AlignedGap[];
  readonly objectives: readonly AlignedObjective[];
}) {
  const { t } = useTranslations();
  const { number } = planningFormat(locale, "UTC");
  const [chosen, setChosen] = useState<{
    readonly kind: "gap" | "objective";
    readonly id: string;
  } | null>(null);
  const choose = (kind: "gap" | "objective", id: string) =>
    setChosen((now) =>
      now?.kind === kind && now.id === id ? null : { kind, id },
    );

  const gapLinked = (gap: AlignedGap): boolean =>
    chosen?.kind === "objective" &&
    (objectives.find((one) => one.id === chosen.id)?.gapIds.includes(gap.id) ??
      false);
  const objectiveLinked = (objective: AlignedObjective): boolean =>
    chosen?.kind === "gap" && objective.gapIds.includes(chosen.id);
  const answered = new Set(objectives.flatMap((one) => one.gapIds));
  const linkedCount =
    chosen === null
      ? null
      : chosen.kind === "gap"
        ? objectives.filter(objectiveLinked).length
        : gaps.filter(gapLinked).length;

  const item = (linked: boolean, pressed: boolean) =>
    `flex flex-col gap-1 rounded-md border px-3 py-2 ${
      pressed
        ? "border-brand bg-brand-weak"
        : linked
          ? "border-brand bg-bg-2"
          : "border-line"
    }`;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-3">{t("planning.alignment.note")}</p>
      {/* Said aloud and in view: the tied items may be far down the other
          column, or below this one on a narrow screen. */}
      <p role="status" className="tabular text-sm font-medium text-ink-2">
        {linkedCount === null
          ? t("planning.alignment.chooseOne")
          : chosen?.kind === "gap"
            ? t("planning.alignment.linkedObjectives", {
                count: number(linkedCount),
              })
            : t("planning.alignment.linkedGaps", {
                count: number(linkedCount),
              })}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-labelledby="alignment-gaps"
          className="flex flex-col gap-2"
        >
          <h2 id="alignment-gaps" className="text-base font-bold text-ink">
            {t("planning.alignment.gaps")}
          </h2>
          <p className="tabular text-sm text-ink-3">
            {t("planning.alignment.count", { count: number(gaps.length) })}
          </p>
          <ul className="flex flex-col gap-2">
            {gaps.map((gap) => {
              const pressed = chosen?.kind === "gap" && chosen.id === gap.id;
              const linked = gapLinked(gap);
              return (
                <li
                  key={gap.id}
                  data-linked={linked ? "true" : undefined}
                  className={item(linked, pressed)}
                >
                  <button
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => choose("gap", gap.id)}
                    className="w-full text-start text-sm font-medium text-ink"
                  >
                    <bdi>{gap.title}</bdi>
                  </button>
                  {linked ? (
                    <span className="text-xs font-medium text-brand-text">
                      {t("planning.alignment.answeredByChosen")}
                    </span>
                  ) : null}
                  {answered.has(gap.id) ? null : (
                    <span className="text-xs font-medium text-warn">
                      {t("planning.alignment.uncovered")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <section
          aria-labelledby="alignment-objectives"
          className="flex flex-col gap-2"
        >
          <h2
            id="alignment-objectives"
            className="text-base font-bold text-ink"
          >
            {t("planning.alignment.objectives")}
          </h2>
          <p className="tabular text-sm text-ink-3">
            {t("planning.alignment.count", {
              count: number(objectives.length),
            })}
          </p>
          <ul className="flex flex-col gap-2">
            {objectives.map((objective) => {
              const pressed =
                chosen?.kind === "objective" && chosen.id === objective.id;
              const linked = objectiveLinked(objective);
              return (
                <li
                  key={objective.id}
                  data-linked={linked ? "true" : undefined}
                  className={item(linked, pressed)}
                >
                  <button
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => choose("objective", objective.id)}
                    className="w-full text-start text-sm font-medium text-ink"
                  >
                    <bdi>{objective.title}</bdi>
                  </button>
                  {linked ? (
                    <span className="text-xs font-medium text-brand-text">
                      {t("planning.alignment.answersChosen")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
