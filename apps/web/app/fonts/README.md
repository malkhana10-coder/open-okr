# Fonts

Geist Sans, vendored. UIUX-PLAN.md §2: "Geist, self-hosted."

|         |                                                                                      |
| ------- | ------------------------------------------------------------------------------------ |
| File    | `Geist-Variable.woff2`, 68 KB                                                        |
| Weights | 100 to 900, one variable file                                                        |
| Version | Geist 1.7.2, the `geist` npm package's `dist/fonts/geist-sans/Geist-Variable.woff2`  |
| Source  | <https://vercel.com/font>, published by Vercel in collaboration with basement.studio |
| SHA-256 | `a369fcf5628ea2aa4e1b9e2ec6a5b3624e365bda588e1f0f2f12b564f728fbb8`                   |
| Licence | SIL Open Font License 1.1, `LICENSE.txt` in this directory                           |

## Why the file is committed rather than fetched

`next/font/google` also self-hosts: it downloads at build time and serves from
this origin, so a browser never reaches Google. But it downloads **at build
time**, and an air-gapped build has no network. The plan's own constraint for
`packages/ui` is "no runtime dependency, no network call, safe for an
air-gapped install"; a build that cannot run without reaching fonts.googleapis
.com fails that in the one place it matters most.

Committing the file also pins what ships. A Google-hosted revision can change
metrics under a stable family name; this one changes when somebody replaces
the file and says so in the change.

`geist` is not a dependency of this repository. The file was extracted from the
published package once, and the version, source and checksum above are how you
verify it. To update, `npm pack geist@<version>`, copy
`package/dist/fonts/geist-sans/Geist-Variable.woff2` here, and update this
table.

## Licence obligations

The OFL requires the copyright notice and licence to travel with the font, so
`LICENSE.txt` sits beside it and ships in the Docker image the same way. Geist
declares **no Reserved Font Name**, so the family keeps its name.

The OFL is a font licence and imposes nothing on the AGPL-3.0 work that embeds
it. `pnpm check:licences` reads `pnpm licenses list`, which only sees npm
dependencies, so it will not report this file — that is why the provenance is
written down here instead.

## What is deliberately absent

- **Italic.** A few lines are set in italic: the quote on the cycle's
  guidance rail, two empty-state lines on the check-in timeline and the goal
  page, and italic text in the rich text editor. The browser slants the
  upright face for them. Adding `Geist-Italic[wght].woff2` costs another 71 KB
  for that.
- **Geist Mono.** Nothing uses it yet. Code in the rich text editor and the
  screens that show tokens and identifiers use the system's monospace face,
  and whichever first wants Geist Mono can bring the file with it.
- **Subsetting.** The Google build splits the family by `unicode-range` so a
  latin-only reader fetches roughly a fifth of this. This file is the whole
  character set in one 68 KB request. Worth revisiting if the font ever shows
  up in a performance budget, but not worth a build-time subsetting step now.

## IBM Plex Sans Arabic

Geist has no Arabic glyphs. IBM Plex Sans Arabic is vendored beside it for the
Arabic interface, for the same reason Geist is: an air-gapped build has no
network. It leads the font stack and its `@font-face` carries a
`unicode-range` of the Arabic blocks, so Arabic text is Plex and everything
else stays Geist. It is not preloaded: a browser fetches a face when a glyph
needs it, so an English page downloads none of these files.

|         |                                                                                      |
| ------- | ------------------------------------------------------------------------------------ |
| Files   | `IBMPlexSansArabic-Regular.woff2`, `-Medium`, `-SemiBold`, `-Bold`, about 74 KB each |
| Weights | 400, 500, 600 and 700, the four the interface uses                                   |
| Version | 1.1.0, the `@ibm/plex-sans-arabic` npm package's `fonts/complete/woff2/`             |
| Source  | <https://github.com/IBM/plex>, published by IBM                                      |
| Licence | SIL Open Font License 1.1, `LICENSE-IBM-Plex.txt` in this directory                  |

| File                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `IBMPlexSansArabic-Regular.woff2`  | `74112e1b7bf2e2c547989a4e947a60cba6cd1f9156e0065670134636e717199d` |
| `IBMPlexSansArabic-Medium.woff2`   | `c72f6986f50ded745d06e71e508096209c52a55a6b3a81029954e33c52ba1dd2` |
| `IBMPlexSansArabic-SemiBold.woff2` | `869b2acd0a9660607a2025f0fe1c640110bf23d33417509328f07722922b8063` |
| `IBMPlexSansArabic-Bold.woff2`     | `db6650a05969c144ab5ab9bb6c3beca6ca4dbb3537bb5f2311c878dd293875b4` |

`@ibm/plex-sans-arabic` is not a dependency of this repository. The files were
extracted from the published package once. To update, `npm pack
@ibm/plex-sans-arabic@<version>`, copy the four files here, and update the
version and the checksums above and in `test/extension/arabic-font.test.ts`.
