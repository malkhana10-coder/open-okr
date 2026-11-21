import { Card, CardBody, CardHeader } from "@openokr/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import type { OpenedSector } from "../../../lib/extension/planning.ts";
import { getTranslations } from "../../../lib/translations";
import { SectorPicker } from "./sector-picker.tsx";

/** The planning screens, in the order a plan is made. */
const TABS = [
  {
    id: "documents",
    href: "/planning/documents",
    key: "planning.tabs.documents",
  },
  { id: "gaps", href: "/planning/gaps", key: "planning.tabs.gaps" },
  {
    id: "objectives",
    href: "/planning/objectives",
    key: "planning.tabs.objectives",
  },
] as const;

export type PlanningTab = (typeof TABS)[number]["id"];

/**
 * The top of every planning screen: where the reader is among the screens,
 * what this one is, and which sector it shows.
 *
 * When the sector could not be opened it says why, in the place the list
 * would have been, and the screen draws nothing under it.
 */
export async function PlanningTop({
  tab,
  title,
  intro,
  opened,
  children,
}: {
  readonly tab: PlanningTab;
  readonly title: string;
  readonly intro: string;
  readonly opened: OpenedSector<unknown>;
  /** The screen's own content, drawn only for a sector that opened. */
  readonly children?: ReactNode;
}) {
  const { t } = await getTranslations();
  const here = TABS.find((one) => one.id === tab)?.href ?? "/planning";
  const sectorId =
    opened.state === "open"
      ? opened.sectorId
      : opened.state === "refused"
        ? opened.named
        : null;
  const query = sectorId ? `?sector=${sectorId}` : "";
  const refusal =
    opened.state === "none"
      ? t("planning.sector.none")
      : opened.state === "refused"
        ? opened.reason === "noneOpen"
          ? t("planning.sector.noneOpen")
          : t("planning.sector.denied")
        : null;

  return (
    <Card>
      <nav
        aria-label={t("planning.tabs.label")}
        className="flex gap-1 border-b border-line px-3 pt-2"
      >
        {TABS.map((one) => (
          <Link
            key={one.id}
            href={`${one.href}${query}`}
            aria-current={one.id === tab ? "page" : undefined}
            className={
              one.id === tab
                ? "rounded-t-md border-b-2 border-brand px-3 py-1.5 text-sm font-bold text-ink"
                : "rounded-t-md border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-ink-3 hover:text-ink"
            }
          >
            {t(one.key)}
          </Link>
        ))}
      </nav>
      <CardHeader>
        <h1 className="text-lg font-bold text-ink">{title}</h1>
        <p className="text-sm text-ink-3">{intro}</p>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {opened.state === "none" ? null : (
          <SectorPicker
            action={here}
            sectors={opened.sectors}
            sectorId={sectorId}
          />
        )}
        {refusal ? <p className="text-sm text-ink-2">{refusal}</p> : children}
      </CardBody>
    </Card>
  );
}
