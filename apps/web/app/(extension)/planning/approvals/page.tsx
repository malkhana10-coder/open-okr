import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import Link from "next/link";
import {
  openSector,
  planningContext,
  planningFormatFor,
} from "../../../../lib/extension/planning.ts";
import { pageTitle } from "../../../../lib/page-title.ts";
import { getTranslations } from "../../../../lib/translations";
import { PlanningTop } from "../planning-top.tsx";
import {
  ApproveForm,
  ReturnForm,
  SendForApprovalButton,
} from "./approval-forms.tsx";

export const generateMetadata = pageTitle("pageTitle.planningApprovals");

/** What a sector may still change, and so what its next request would hold. */
const OPEN_GAP = new Set(["draft", "ai_draft", "returned"]);

/**
 * Approvals (design b0-vertical-slice.md, criteria 9, 10 and 11).
 *
 * Two people use it. Whoever drafts for a sector sees what the sector's next
 * request would hold and what holds it back, and sends it. Whoever decides
 * sees the requests waiting for them, and approves one or returns it with
 * what has to change. The one who sent a request is never offered its
 * decision.
 *
 * Approving is what makes a drafted objective live. Nothing an agent wrote
 * reaches the plan before a person does that.
 *
 * Everything comes from registry actions. The page runs no query.
 */
export default async function PlanningApprovalsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly sector?: string }>;
}) {
  const { t } = await getTranslations();
  const search = await searchParams;
  const context = await planningContext();
  const fmt = await planningFormatFor(context);
  const [next, opened] = await Promise.all([
    callAction(context, "governance.myNext", {}),
    openSector(
      context,
      search.sector,
      async (spaceId) =>
        (await callAction(context, "strategy.listGaps", { spaceId })).gaps,
    ),
  ]);

  const mine = (
    <Card>
      <section aria-labelledby="planning-next-action">
        <CardHeader>
          <h2
            id="planning-next-action"
            className="text-base font-bold text-ink"
          >
            {t("planning.approvals.next.heading")}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {next.toDecide.length === 0 && next.returned.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("planning.approvals.next.nothing")}
            </p>
          ) : null}
          {next.toDecide.map((request) => (
            <div
              key={request.requestId}
              className="flex flex-col gap-3 rounded-md border border-line px-3 py-2.5"
            >
              <h3 dir="auto" className="font-medium text-ink">
                {request.spaceName}
              </h3>
              <p className="text-sm text-ink-2">
                {t("planning.approvals.next.toDecide", {
                  gaps: fmt.number(request.gaps),
                  objectives: fmt.number(request.objectives),
                })}
              </p>
              <Link
                href={`/planning/gaps?sector=${request.spaceId}`}
                className="text-sm font-medium text-brand hover:underline"
              >
                {t("planning.approvals.next.open")}
              </Link>
              <ApproveForm
                requestId={request.requestId}
                sector={request.spaceName}
                gaps={fmt.number(request.gaps)}
                objectives={fmt.number(request.objectives)}
              />
              <ReturnForm
                requestId={request.requestId}
                sector={request.spaceName}
              />
            </div>
          ))}
          {next.returned.map((request) => (
            <div
              key={request.requestId}
              className="flex flex-col gap-2 rounded-md border border-line px-3 py-2.5"
            >
              <h3 dir="auto" className="font-medium text-ink">
                {request.spaceName}
              </h3>
              <p className="text-sm text-ink-2">
                {t("planning.approvals.next.returned")}
              </p>
              <blockquote
                dir="auto"
                className="rounded-md bg-bg-2 px-3 py-2 text-sm text-ink"
              >
                {request.comment}
              </blockquote>
              <Link
                href={`/planning/gaps?sector=${request.spaceId}`}
                className="text-sm font-medium text-brand hover:underline"
              >
                {t("planning.approvals.next.open")}
              </Link>
            </div>
          ))}
        </CardBody>
      </section>
    </Card>
  );

  const top = (
    <PlanningTop
      tab="approvals"
      title={t("planning.approvals.title")}
      intro={t("planning.approvals.intro")}
      opened={opened}
      // Somebody with a request to decide is here for that, and need not be
      // in any sector. Anybody else in no sector is told so.
      sectorOptional={next.toDecide.length > 0}
    />
  );
  if (opened.state !== "open") {
    return (
      <div className="stagger flex flex-col gap-4.5">
        {top}
        {mine}
      </div>
    );
  }

  // The sector opened, so these are the member's to read.
  const { sectorId } = opened;
  const [{ evidence }, { objectives }] = await Promise.all([
    callAction(context, "knowledge.listSectorEvidence", { spaceId: sectorId }),
    callAction(context, "planning.listObjectiveDrafts", { spaceId: sectorId }),
  ]);
  const gaps = opened.data.filter((gap) => OPEN_GAP.has(gap.status));
  const gapIds = new Set(gaps.map((gap) => gap.id));
  const drafts = objectives.filter((one) => one.state === "draft");
  const unverified =
    evidence.filter(
      (one) => gapIds.has(one.gapId) && one.verification !== "verified",
    ).length +
    drafts
      .flatMap((one) => one.evidence)
      .filter((one) => one.verification !== "verified").length;
  const unconfirmed = drafts.filter((one) => !one.ownerConfirmed).length;
  const waitingGaps = opened.data.filter(
    (gap) => gap.status === "in_review",
  ).length;
  const waitingObjectives = objectives.filter(
    (one) => one.state === "awaiting_approval",
  ).length;
  const waiting = waitingGaps + waitingObjectives > 0;
  const returned = opened.data.filter(
    (gap) => gap.status === "returned",
  ).length;

  return (
    <div className="stagger flex flex-col gap-4.5">
      {top}
      {mine}
      <Card>
        <section aria-labelledby="planning-send">
          <CardHeader>
            <h2 id="planning-send" className="text-base font-bold text-ink">
              {t("planning.approvals.send.heading")}
            </h2>
            <p className="text-sm text-ink-3">
              {t("planning.approvals.send.intro")}
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {waiting ? (
              <div className="rounded-md bg-info-bg px-3 py-2 text-sm text-ink">
                <p className="font-medium">
                  {t("planning.approvals.send.waiting")}
                </p>
                <p className="tabular">
                  {t("planning.approvals.send.waitingGaps", {
                    count: fmt.number(waitingGaps),
                  })}
                </p>
                <p className="tabular">
                  {t("planning.approvals.send.waitingObjectives", {
                    count: fmt.number(waitingObjectives),
                  })}
                </p>
              </div>
            ) : gaps.length + drafts.length === 0 ? (
              <p className="text-sm text-ink-3">
                {t("planning.approvals.send.nothing")}
              </p>
            ) : (
              <>
                <ul className="tabular flex flex-col gap-1 text-sm text-ink-2">
                  <li>
                    {t("planning.approvals.send.gaps", {
                      count: fmt.number(gaps.length),
                    })}
                  </li>
                  <li>
                    {t("planning.approvals.send.objectives", {
                      count: fmt.number(drafts.length),
                    })}
                  </li>
                </ul>
                {unverified + unconfirmed === 0 ? (
                  <p className="text-sm text-ink-2">
                    {t("planning.approvals.send.clear")}
                  </p>
                ) : (
                  <div className="rounded-md bg-warn-bg px-3 py-2 text-sm text-ink">
                    <p className="font-medium">
                      {t("planning.approvals.send.held")}
                    </p>
                    <ul className="tabular list-disc ps-5">
                      {unverified > 0 ? (
                        <li>
                          {t("planning.approvals.send.unverified", {
                            count: fmt.number(unverified),
                          })}
                        </li>
                      ) : null}
                      {unconfirmed > 0 ? (
                        <li>
                          {t("planning.approvals.send.unconfirmed", {
                            count: fmt.number(unconfirmed),
                          })}
                        </li>
                      ) : null}
                    </ul>
                  </div>
                )}
                {returned > 0 ? (
                  <p className="text-sm text-ink-2">
                    {t("planning.approvals.send.returnedBefore", {
                      count: fmt.number(returned),
                    })}
                  </p>
                ) : null}
                {next.maySubmit ? (
                  <SendForApprovalButton sectorId={sectorId} />
                ) : (
                  <p className="text-sm text-ink-2">
                    {t("planning.approvals.send.notYours")}
                  </p>
                )}
              </>
            )}
          </CardBody>
        </section>
      </Card>
    </div>
  );
}
