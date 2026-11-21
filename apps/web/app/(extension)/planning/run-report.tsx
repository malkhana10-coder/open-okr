import { getTranslations } from "../../../lib/translations";

interface Run {
  readonly status: "succeeded" | "failed";
  readonly failure: string | null;
  readonly createdAt: string;
  readonly report: {
    readonly read: readonly string[];
    readonly excluded: readonly string[];
  };
}

/**
 * What an agent's last run read and what it left out.
 *
 * A reviewer judges a draft by knowing what the agent looked at. A failed
 * run read nothing worth listing, so only the failure is said.
 */
export async function RunReport({
  runs,
  format,
}: {
  /** One agent's runs on the sector, newest first. */
  readonly runs: readonly Run[];
  readonly format: {
    readonly number: (value: number) => string;
    readonly date: (iso: string) => string;
  };
}) {
  const { t } = await getTranslations();
  const last = runs[0];
  if (!last) {
    return null;
  }
  return (
    <section
      aria-labelledby="planning-last-run"
      className="flex flex-col gap-2 rounded-md bg-bg-2 px-3 py-2.5 text-sm"
    >
      <h3 id="planning-last-run" className="font-bold text-ink">
        {t("planning.runs.last")}
      </h3>
      <p className="text-ink-3">
        {t("planning.runs.when", { date: format.date(last.createdAt) })}
      </p>
      <p className="tabular text-ink-3">
        {t("planning.runs.count", { count: format.number(runs.length) })}
      </p>
      {last.status === "failed" ? (
        <p className="text-bad">
          {last.failure
            ? t("planning.runs.failedBecause", { reason: last.failure })
            : t("planning.runs.failed")}
        </p>
      ) : (
        <>
          {last.report.read.length > 0 ? (
            <div>
              <p className="font-medium text-ink-2">
                {t("planning.runs.read")}
              </p>
              <ul className="list-disc ps-5 text-ink-2">
                {[...new Set(last.report.read)].map((line) => (
                  <li key={line}>
                    <bdi>{line}</bdi>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-ink-2">{t("planning.runs.readNothing")}</p>
          )}
          {last.report.excluded.length > 0 ? (
            <div>
              <p className="font-medium text-ink-2">
                {t("planning.runs.excluded")}
              </p>
              <ul className="list-disc ps-5 text-ink-2">
                {[...new Set(last.report.excluded)].map((line) => (
                  <li key={line}>
                    <bdi>{line}</bdi>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
