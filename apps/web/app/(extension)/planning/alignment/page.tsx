import { callAction } from "@openokr/core";
import { Card, CardBody } from "@openokr/ui";
import {
  openSector,
  planningContext,
} from "../../../../lib/extension/planning.ts";
import { pageTitle } from "../../../../lib/page-title.ts";
import { getTranslations } from "../../../../lib/translations";
import { PlanningTop } from "../planning-top.tsx";
import { AlignmentColumns } from "./alignment-columns.tsx";

export const generateMetadata = pageTitle("pageTitle.planningAlignment");

/**
 * A sector's gaps beside the objectives proposed for them (design
 * b0-vertical-slice.md, criterion 15).
 *
 * The question it answers is coverage: is there a gap nothing answers. A gap
 * that was set aside is not asked about, and neither is an objective that
 * has no draft behind it, because nothing ties such an objective to a gap.
 *
 * Everything comes from registry actions. The page runs no query.
 */
export default async function PlanningAlignmentPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly sector?: string }>;
}) {
  const { t } = await getTranslations();
  const search = await searchParams;
  const context = await planningContext();
  const opened = await openSector(
    context,
    search.sector,
    async (spaceId) =>
      (await callAction(context, "strategy.listGaps", { spaceId })).gaps,
  );
  const top = (
    <PlanningTop
      tab="alignment"
      title={t("planning.alignment.title")}
      intro={t("planning.alignment.intro")}
      opened={opened}
    />
  );
  if (opened.state !== "open") {
    return <div className="stagger flex flex-col gap-4.5">{top}</div>;
  }

  // The sector opened, so this is the member's to read.
  const { objectives } = await callAction(
    context,
    "planning.listObjectiveDrafts",
    { spaceId: opened.sectorId },
  );
  const gaps = opened.data.filter((gap) => gap.status !== "dismissed");
  const known = new Set(gaps.map((gap) => gap.id));

  return (
    <div className="stagger flex flex-col gap-4.5">
      {top}
      <Card>
        <CardBody>
          {gaps.length === 0 && objectives.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("planning.alignment.empty")}
            </p>
          ) : (
            <AlignmentColumns
              gaps={gaps.map((gap) => ({ id: gap.id, title: gap.title }))}
              objectives={objectives.map((objective) => ({
                id: objective.goalId,
                title: objective.title,
                gapIds: objective.gaps
                  .map((gap) => gap.id)
                  .filter((id) => known.has(id)),
              }))}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
