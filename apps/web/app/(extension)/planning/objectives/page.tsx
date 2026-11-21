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
import { PlanningTop } from "../planning-top.tsx";
import { RunReport } from "../run-report.tsx";
import {
  ConfirmOwnerButton,
  DraftObjectivesButton,
} from "./objective-forms.tsx";

export const generateMetadata = pageTitle("pageTitle.planningObjectives");

// Written out whole: the catalogue's coverage test finds a key by its text.
const STATE_KEYS = {
  draft: "planning.objectives.state.draft",
  awaiting_approval: "planning.objectives.state.awaiting_approval",
  live: "planning.objectives.state.live",
} as const;

const STATE_TONES = {
  draft: "agent",
  awaiting_approval: "info",
  live: "ok",
} as const;

const TYPE_KEYS = {
  sectoral: "planning.objectives.type.sectoral",
  operational: "planning.objectives.type.operational",
} as const;

const REASON_KEYS = {
  too_short: "planning.gaps.source.reason.too_short",
  not_on_page: "planning.gaps.source.reason.not_on_page",
} as const;

/**
 * The objectives an agent proposed for a sector (design
 * b0-vertical-slice.md, criteria 8 and 17).
 *
 * A proposed objective is not live, and nothing here makes it live: it goes
 * live when leadership approves the sector's request. What a person does
 * here is judge it, by its target, the gaps it answers and the pages it
 * quotes, and confirm who answers for it. An objective whose owner nobody
 * confirmed cannot be sent for approval.
 *
 * Everything comes from registry actions. The page runs no query.
 */
export default async function PlanningObjectivesPage({
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
      (await callAction(context, "planning.listObjectiveDrafts", { spaceId }))
        .objectives,
  );

  const top = (
    <PlanningTop
      tab="objectives"
      title={t("planning.objectives.title")}
      intro={t("planning.objectives.intro")}
      opened={opened}
    >
      {opened.state === "open" && opened.data.length === 0 ? (
        <p className="text-sm text-ink-3">{t("planning.objectives.empty")}</p>
      ) : null}
    </PlanningTop>
  );
  if (opened.state !== "open") {
    return <div className="stagger flex flex-col gap-4.5">{top}</div>;
  }

  const { sectorId, data: objectives } = opened;
  // The sector opened, so these are the member's to read: a refusal from
  // here on is a fault, and goes to the error boundary.
  const [{ runs: allRuns }, cycles] = await Promise.all([
    callAction(context, "planning.listRuns", { spaceId: sectorId }),
    callAction(context, "cycles.list", {}),
  ]);
  const runs = allRuns.filter((run) => run.agent === "objectives");
  // A plan is drafted into a cycle that has not closed. The annual one that
  // starts last is the plan year, and it is offered first.
  const open = cycles.filter((cycle) => cycle.status !== "closed");
  // A cycle that is closing has ended: it is still listed, and never the
  // one offered first.
  const ahead = open.filter((cycle) => cycle.status !== "closing");
  const planCycle =
    ahead
      .filter((cycle) => cycle.mode === "annual")
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0] ??
    ahead[0] ??
    open[0];
  const sample = planningProvider().fixed;
  const pageHref = (documentId: string, page: number) =>
    `/planning/documents?sector=${sectorId}&document=${documentId}&page=${page}`;

  return (
    <div className="stagger flex flex-col gap-4.5">
      {top}

      {objectives.length > 0 ? (
        <Card>
          <CardBody>
            <h2 className="sr-only">{t("planning.objectives.list")}</h2>
            <ul className="flex flex-col gap-3">
              {objectives.map((objective) => {
                const unverified = objective.evidence.filter(
                  (one) => one.verification !== "verified",
                ).length;
                return (
                  <li
                    key={objective.goalId}
                    className="flex flex-col gap-2 rounded-md border border-line px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-medium text-ink">
                        <bdi>{objective.title}</bdi>
                      </h3>
                      <span className="flex flex-wrap items-center gap-2">
                        <Chip tone="neutral">
                          {t(TYPE_KEYS[objective.objectiveType])}
                        </Chip>
                        <Chip tone={STATE_TONES[objective.state]}>
                          {t(STATE_KEYS[objective.state])}
                        </Chip>
                      </span>
                    </div>
                    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
                      <dt className="text-ink-3">
                        {t("planning.objectives.where")}
                      </dt>
                      <dd className="text-ink-2">
                        <bdi>{objective.spaceName}</bdi>
                      </dd>
                      {objective.proposedTarget ? (
                        <>
                          <dt className="text-ink-3">
                            {t("planning.objectives.target")}
                          </dt>
                          <dd dir="auto" className="text-ink-2">
                            {objective.proposedTarget}
                          </dd>
                        </>
                      ) : null}
                      <dt className="text-ink-3">
                        {t("planning.objectives.owner.label")}
                      </dt>
                      <dd className="flex flex-wrap items-center gap-2 text-ink-2">
                        <bdi>{objective.owner.name}</bdi>
                        {objective.ownerConfirmed ? (
                          <Chip tone="ok">
                            {t("planning.objectives.owner.confirmed")}
                          </Chip>
                        ) : (
                          <Chip tone="warn">
                            {t("planning.objectives.owner.unconfirmed")}
                          </Chip>
                        )}
                      </dd>
                    </dl>
                    {objective.state === "draft" &&
                    !objective.ownerConfirmed ? (
                      <ConfirmOwnerButton goalId={objective.goalId} />
                    ) : null}
                    {unverified > 0 ? (
                      <p className="text-sm font-medium text-warn">
                        {t("planning.gaps.source.unverifiedCount", {
                          count: fmt.number(unverified),
                        })}
                      </p>
                    ) : null}
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-brand">
                        {t("planning.objectives.details")}
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        {objective.rationale ? (
                          <div className="text-ink-2">
                            <p className="font-medium">
                              {t("planning.objectives.rationale")}
                            </p>
                            <p dir="auto">{objective.rationale}</p>
                          </div>
                        ) : null}
                        {objective.confidence === null ? null : (
                          <p className="text-ink-3">
                            {t("planning.gaps.confidence", {
                              percent: fmt.number(objective.confidence),
                            })}
                          </p>
                        )}
                        {objective.gaps.length > 0 ? (
                          <div className="text-ink-2">
                            <p className="font-medium">
                              {t("planning.objectives.answers")}
                            </p>
                            <ul className="list-disc ps-5">
                              {objective.gaps.map((gap) => (
                                <li key={gap.id}>
                                  <bdi>{gap.title}</bdi>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {objective.evidence.length > 0 ? (
                          <ul className="flex flex-col gap-2">
                            {objective.evidence.map((one) => (
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
                              </li>
                            ))}
                          </ul>
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
            {t("planning.objectives.agent.heading")}
          </h2>
          <p className="text-sm text-ink-3">
            {t("planning.objectives.agent.intro")}
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {sample ? (
            <p className="rounded-md bg-info-bg px-2.5 py-1.5 text-sm text-ink">
              {t("planning.runs.sample")}
            </p>
          ) : null}
          {planCycle ? (
            <DraftObjectivesButton
              sectorId={sectorId}
              cycles={open.map((cycle) => ({ id: cycle.id, name: cycle.name }))}
              cycleId={planCycle.id}
            />
          ) : (
            <p className="text-sm text-ink-2">
              {t("planning.objectives.agent.noCycle")}
            </p>
          )}
          <RunReport runs={runs} format={fmt} />
        </CardBody>
      </Card>
    </div>
  );
}
