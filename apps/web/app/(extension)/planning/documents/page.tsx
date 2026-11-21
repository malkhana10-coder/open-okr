import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import {
  openSector,
  planningContext,
  planningFormatFor,
  refusedSector,
} from "../../../../lib/extension/planning.ts";
import { pageTitle } from "../../../../lib/page-title.ts";
import { getTranslations } from "../../../../lib/translations";
import { originalHref } from "../original.ts";
import { PlanningTop } from "../planning-top.tsx";
import { PendingRefresh } from "./pending-refresh.tsx";
import { UploadForm } from "./upload-form.tsx";

export const generateMetadata = pageTitle("pageTitle.planningDocuments");

type Search = {
  readonly sector?: string;
  readonly document?: string;
  readonly page?: string;
};

const HERE = "/planning/documents";

// Written out whole: the catalogue's coverage test finds a key by its text.
const KIND_KEYS = {
  strategy: "planning.documents.kind.strategy",
  sub_strategy: "planning.documents.kind.sub_strategy",
  previous_plan: "planning.documents.kind.previous_plan",
  report: "planning.documents.kind.report",
} as const;

const FAILURE_KEYS = {
  no_text: "planning.documents.failed.no_text",
  unreadable: "planning.documents.failed.unreadable",
  missing: "planning.documents.failed.missing",
} as const;

/**
 * A sector's source documents (design b0-vertical-slice.md, criteria 3 and
 * 19): what was uploaded, whether it has been read, how well, and each page
 * as the product read it.
 *
 * The page a quotation is checked against is the page shown here. A person
 * who doubts a "verified" mark reads the same text the check read.
 *
 * Everything comes from registry actions. The page runs no query.
 */
export default async function PlanningDocumentsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Search>;
}) {
  const { t, locale } = await getTranslations();
  const search = await searchParams;
  const context = await planningContext();
  const fmt = await planningFormatFor(context);
  const opened = await openSector(
    context,
    search.sector,
    async (spaceId) =>
      (await callAction(context, "knowledge.listDocuments", { spaceId }))
        .documents,
  );
  if (opened.state !== "open") {
    return (
      <div className="stagger flex flex-col gap-4.5">
        <PlanningTop
          tab="documents"
          title={t("planning.documents.title")}
          intro={t("planning.documents.intro")}
          opened={opened}
        />
      </div>
    );
  }
  const { sectorId, data: documents } = opened;

  const open = documents.find((document) => document.id === search.document);
  const pageNumber = Math.max(1, Number.parseInt(search.page ?? "1", 10) || 1);
  const pageCount = open?.pageCount ?? 0;
  let reading: Awaited<
    ReturnType<typeof callAction<"knowledge.readPage">>
  > | null = null;
  if (open && open.processingStatus === "ready" && pageCount > 0) {
    try {
      reading = await callAction(context, "knowledge.readPage", {
        documentId: open.id,
        page: Math.min(pageNumber, pageCount),
      });
    } catch (error) {
      // Removed between the two reads: the list is still right, and the
      // reader is simply not drawn.
      if (!refusedSector(error)) {
        throw error;
      }
    }
  }
  const pageHref = (documentId: string, page: number) =>
    `${HERE}?sector=${sectorId}&document=${documentId}&page=${page}`;
  const pages = (count: number) =>
    count === 1
      ? t("planning.documents.status.pagesOne", { count: fmt.number(count) })
      : t("planning.documents.status.pagesOther", { count: fmt.number(count) });
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const pending = documents.some(
    (document) => document.processingStatus === "pending",
  );

  return (
    <div className="stagger flex flex-col gap-4.5">
      {pending ? <PendingRefresh /> : null}
      <PlanningTop
        tab="documents"
        title={t("planning.documents.title")}
        intro={t("planning.documents.intro")}
        opened={opened}
      >
        {documents.length === 0 ? (
          <p className="text-sm text-ink-3">{t("planning.documents.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
              >
                <span className="flex min-w-0 flex-col">
                  {/* A title is in its own language, whatever the screen's. */}
                  <bdi className="font-medium text-ink">{document.title}</bdi>
                  <span className="flex gap-2 text-sm text-ink-3">
                    <span>{t(KIND_KEYS[document.kind])}</span>
                    <span className="tabular">{document.year}</span>
                  </span>
                  {document.quality?.low ? (
                    <span className="text-sm text-ink-2">
                      {t("planning.documents.lowPages", {
                        pages: list.format(
                          document.quality.lowPages.map(fmt.number),
                        ),
                      })}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {document.quality?.low ? (
                    <Chip tone="warn">
                      {t("planning.documents.lowQuality")}
                    </Chip>
                  ) : null}
                  {document.processingStatus === "pending" ? (
                    <Chip tone="neutral">
                      {t("planning.documents.status.pending")}
                    </Chip>
                  ) : document.processingStatus === "failed" ? (
                    <Chip tone="bad">
                      {t(FAILURE_KEYS[document.failureReason ?? "unreadable"])}
                    </Chip>
                  ) : (
                    <>
                      <span className="tabular text-sm text-ink-3">
                        {pages(document.pageCount ?? 0)}
                      </span>
                      <Link
                        href={pageHref(document.id, 1)}
                        className="text-sm font-medium text-brand hover:underline"
                      >
                        {t("planning.documents.read")}
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PlanningTop>

      {open && reading ? (
        <Card>
          <section aria-labelledby="planning-page-heading">
            <CardHeader>
              <h2
                id="planning-page-heading"
                className="flex flex-wrap gap-x-2 text-base font-bold text-ink"
              >
                <bdi>{open.title}</bdi>
                <span className="font-medium text-ink-3">
                  {t("planning.page.position", {
                    page: fmt.number(reading.page),
                    count: fmt.number(reading.pageCount),
                  })}
                </span>
              </h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              {reading.quality.low ? (
                <p className="rounded-md bg-warn-bg px-2.5 py-1.5 text-sm text-ink">
                  {t("planning.page.weak")}
                </p>
              ) : null}
              {/* The document's own language decides the direction, not the
                  reader's: an Arabic page reads right to left in an English
                  workspace too. */}
              <div
                dir="auto"
                className="whitespace-pre-wrap rounded-md bg-bg-2 px-4 py-3 text-sm leading-7 text-ink"
              >
                {reading.text}
              </div>
              <nav
                aria-label={t("planning.page.pages")}
                className="flex items-center gap-4 text-sm"
              >
                {reading.page > 1 ? (
                  <Link
                    href={pageHref(open.id, reading.page - 1)}
                    className="font-medium text-brand hover:underline"
                  >
                    {t("planning.page.previous")}
                  </Link>
                ) : null}
                {reading.page < reading.pageCount ? (
                  <Link
                    href={pageHref(open.id, reading.page + 1)}
                    className="font-medium text-brand hover:underline"
                  >
                    {t("planning.page.next")}
                  </Link>
                ) : null}
                {/* The file itself, on this page: the check compared a quotation
                    with the text above, and a reader may want the page as it
                    was printed. A plain link, so the browser's PDF viewer
                    opens it where it opens files. */}
                <a
                  href={originalHref(open.id, reading.page)}
                  target="_blank"
                  rel="noopener"
                  className="font-medium text-brand hover:underline"
                >
                  {t("planning.page.original")}
                </a>
                <Link
                  href={`${HERE}?sector=${sectorId}`}
                  className="text-ink-3 hover:underline"
                >
                  {t("planning.page.close")}
                </Link>
              </nav>
            </CardBody>
          </section>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-ink">
            {t("planning.documents.upload.heading")}
          </h2>
        </CardHeader>
        <CardBody>
          <UploadForm
            sectorId={sectorId}
            defaultYear={new Date().getUTCFullYear() + 1}
          />
        </CardBody>
      </Card>
    </div>
  );
}
