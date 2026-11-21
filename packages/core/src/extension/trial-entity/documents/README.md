# The trial entity's two documents

Two invented sub-strategies of the invented government body, thirteen pages
each. They are what a preview instance is shown reading: a person uploads
them on the documents screen, and the fixed provider in `../planner.ts`
drafts gaps and objectives that quote their pages.

Everything in them is fiction. No name, figure or sentence comes from a real
body, and each says so on its first and last page.

| File                                  | What it is                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `licensing-compliance.html`, `.pdf`   | The licensing and compliance sub-strategy, for the services and licensing sector |
| `digital-transformation.html`, `.pdf` | The digital transformation sub-strategy, for the planning and development sector |

The PDF is the HTML printed to A4 by Chromium, with IBM Plex Sans Arabic
(SIL Open Font License) put in place of `FONT_REGULAR` and `FONT_BOLD`. Each
`<section>` is one page.

**Change the HTML and the PDF together.** The quotations in `../planner.ts`
name a page and its exact words, and
`apps/web/test/extension/trial-drafts.test.ts` reads the PDFs through the
product's own reader and fails when a quotation no longer matches.
