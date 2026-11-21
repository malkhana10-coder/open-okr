import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import {
  openSector,
  planningContext,
  planningFormatFor,
  planningProvider,
} from "../../../../lib/extension/planning.ts";
import { pageTitle } from "../../../../lib/page-title.ts";
import { getTranslations } from "../../../../lib/translations";
import { originalHref } from "../original.ts";
import { PlanningTop } from "../planning-top.tsx";
import { RunReport } from "../run-report.tsx";
import {
  AddSourceForm,
  DismissGapButton,
  DraftGapsButton,
  NewGapForm,
  RemoveSourceButton,
} from "./gap-forms.tsx";

export const generateMetadata = pageTitle("pageTitle.planningGaps");

// Written out whole: the catalogue's coverage test finds a key by its text.
const STATUS_KEYS = {
  draft: "planning.gaps.status.draft",
  ai_draft: "planning.gaps.status.ai_draft",
  in_review: "planning.gaps.status.in_review",
  approved: "planning.gaps.status.approved",
  returned: "planning.gaps.status.returned",
  dismissed: "planning.gaps.status.dismissed",
} as const;

const STATUS_TONES = {
  draft: "neutral",
  ai_draft: "agent",
  in_review: "info",
  approved: "ok",
  returned: "warn",
  dismissed: "neutral",
} as const;

const REASON_KEYS = {
  too_short: "planning.gaps.source.reason.too_short",
  not_on_page: "planning.gaps.source.reason.not_on_page",
} as const;

/** A gap can still be changed while nobody has been asked to approve it. */
const OPEN = new Set(["draft", "ai_draft", "returned"]);

/**
 * A sector's strategic gaps (design b0-vertical-slice.md, criteria 4, 5, 13
 * and 16): what the sector's documents show is missing, each with the page
 * it rests on.
 *
 * A gap an agent drafted says so and stays a draft: nothing here makes one
 * live. A quotation that is not on its page is kept and marked, because the
 * person who reviews it needs to see what was claimed.
 *
 * Everything comes from registry actions. The page runs no query.
 */
export default async function PlanningGapsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly sector?: string }>;
}) {
  const { t } = await getTranslations();
  const search = await searchParams;
  const context = await planningContext();
  const fmt = await planningFormatFor(context);
  const opened = await openSector(
    context,
    search.sector,
    async (spaceId) =>
      (await callAction(context, "strategy.listGaps", { spaceId })).gaps,
  );

  const top = (
    <PlanningTop
      tab="gaps"
      title={t("planning.gaps.title")}
      intro={t("planning.gaps.intro")}
      opened={opened}
    >
      {opened.state === "open" && opened.data.length === 0 ? (
        <p className="text-sm text-ink-3">{t("planning.gaps.empty")}</p>
      ) : null}
    </PlanningTop>
  );
  if (opened.state !== "open") {
    return <div className="stagger flex flex-col gap-4.5">{top}</div>;
  }

  const { sectorId } = opened;
  // The sector opened, so these are the member's to read: a refusal from
  // here on is a fault, and goes to the error boundary.
  const [{ evidence }, { documents }, { runs: allRuns }, { domains: named }] =
    await Promise.all([
      callAction(context, "knowledge.listSectorEvidence", {
        spaceId: sectorId,
      }),
      callAction(context, "knowledge.listDocuments", { spaceId: sectorId }),
      callAction(context, "planning.listRuns", { spaceId: sectorId }),
      callAction(context, "strategy.listDomains", {}),
    ]);
  const gaps = opened.data.map((gap) => ({
    ...gap,
    evidence: evidence.filter((one) => one.gapId === gap.id),
  }));
  const runs = allRuns.filter((run) => run.agent === "gaps");
  const domains = new Map(named.map((domain) => [domain.id, domain.name]));
  const sample = planningProvider().fixed;
  const readable = documents
    .filter((document) => document.processingStatus === "ready")
    .map((document) => ({ id: document.id, title: document.title }));
  const pageHref = (documentId: string, page: number) =>
    `/planning/documents?sector=${sectorId}&document=${documentId}&page=${page}`;

  return (
    <div className="stagger flex flex-col gap-4.5">
      {top}

      {gaps.length > 0 ? (
        <Card>
          <CardBody>
            <h2 className="sr-only">{t("planning.gaps.list")}</h2>
            <ul className="flex flex-col gap-3">
              {gaps.map((gap) => {
                const unverified = gap.evidence.filter(
                  (one) => one.verification !== "verified",
                ).length;
                const domain = gap.domainId ? domains.get(gap.domainId) : null;
                return (
                  <li
                    key={gap.id}
                    className="flex flex-col gap-2 rounded-md border border-line px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 dir="auto" className="font-medium text-ink">
                        {gap.title}
                      </h3>
                      <span className="flex flex-wrap items-center gap-2">
                        {domain ? <Chip tone="neutral">{domain}</Chip> : null}
                        <Chip tone={STATUS_TONES[gap.status]}>
                          {t(STATUS_KEYS[gap.status])}
                        </Chip>
                      </span>
                    </div>
                    {gap.description ? (
                      <p dir="auto" className="text-sm text-ink-2">
                        {gap.description}
                      </p>
                    ) : null}
                    <p className="text-sm text-ink-3">
                      {gap.evidence.length === 0
                        ? t("planning.gaps.source.none")
                        : gap.evidence.length === 1
                          ? t("planning.gaps.source.countOne", {
                              count: fmt.number(gap.evidence.length),
                            })
                          : t("planning.gaps.source.countOther", {
                              count: fmt.number(gap.evidence.length),
                            })}
                      {unverified > 0 ? (
                        <>
                          {" "}
                          <span className="font-medium text-warn">
                            {t("planning.gaps.source.unverifiedCount", {
                              count: fmt.number(unverified),
                            })}
                          </span>
                        </>
                      ) : null}
                    </p>
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-brand">
                        {t("planning.gaps.details")}
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        {gap.rationale ? (
                          <div className="text-ink-2">
                            <p className="font-medium">
                              {t("planning.gaps.rationale")}
                            </p>
                            <p dir="auto">{gap.rationale}</p>
                          </div>
                        ) : null}
                        {gap.confidence === null ? null : (
                          <p className="text-ink-3">
                            {t("planning.gaps.confidence", {
                              percent: fmt.number(gap.confidence),
                            })}
                          </p>
                        )}
                        {gap.evidence.length > 0 ? (
                          <ul className="flex flex-col gap-2">
                            {gap.evidence.map((one) => (
                              <li
                                key={one.id}
                                className="flex flex-col gap-1.5 rounded-md bg-bg-2 px-3 py-2"
                              >
                                <blockquote dir="auto" className="text-ink">
                                  {one.quote}
                                </blockquote>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Link
                                    href={pageHref(one.documentId, one.page)}
                                    className="font-medium text-brand hover:underline"
                                  >
                                    {t("planning.gaps.source.where", {
                                      title: one.documentTitle,
                                      page: fmt.number(one.page),
                                    })}
                                  </Link>
                                  <a
                                    href={originalHref(
                                      one.documentId,
                                      one.page,
                                    )}
                                    target="_blank"
                                    rel="noopener"
                                    aria-label={t(
                                      "planning.gaps.source.originalNamed",
                                      {
                                        title: one.documentTitle,
                                        page: fmt.number(one.page),
                                      },
                                    )}
                                    className="text-brand hover:underline"
                                  >
                                    {t("planning.gaps.source.original")}
                                  </a>
                                  {one.verification === "verified" ? (
                                    <Chip tone="ok">
                                      {t("planning.gaps.source.verified")}
                                    </Chip>
                                  ) : (
                                    <Chip tone="warn">
                                      {t("planning.gaps.source.unverified")}
                                    </Chip>
                                  )}
                                  {one.unverifiedReason ? (
                                    <span className="text-ink-2">
                                      {t(REASON_KEYS[one.unverifiedReason])}
                                    </span>
                                  ) : null}
                                </div>
                                {one.weakPage ? (
                                  <p className="text-ink-2">
                                    {t("planning.gaps.source.weakPage")}
                                  </p>
                                ) : null}
                                {OPEN.has(gap.status) ? (
                                  <RemoveSourceButton evidenceId={one.id} />
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {OPEN.has(gap.status) ? (
                          <>
                            <AddSourceForm
                              gapId={gap.id}
                              documents={readable}
                            />
                            <DismissGapButton gapId={gap.id} />
                          </>
                        ) : null}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">
            {t("planning.gaps.agent.heading")}
          </h2>
          <p className="text-sm text-ink-3">{t("planning.gaps.agent.intro")}</p>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {sample ? (
            <p className="rounded-md bg-info-bg px-2.5 py-1.5 text-sm text-ink">
              {t("planning.runs.sample")}
            </p>
          ) : null}
          <DraftGapsButton sectorId={sectorId} />
          <RunReport runs={runs} format={fmt} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">
            {t("planning.gaps.new.heading")}
          </h2>
          <p className="text-sm text-ink-3">{t("planning.gaps.new.intro")}</p>
        </CardHeader>
        <CardBody>
          <NewGapForm sectorId={sectorId} />
        </CardBody>
      </Card>
    </div>
  );
}
