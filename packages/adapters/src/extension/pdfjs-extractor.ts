/**
 * The PDF reader, on pdfjs-dist (docs/extension/DEPENDENCIES.md).
 *
 * **It reads what each page draws, not the library's text layer.** The text
 * layer reverses the two letters of an Arabic joined pair, which breaks about
 * one word in twenty and with it any quotation checked against the page
 * (docs/extension/design/extraction-quality.md). The drawing instructions
 * still name each glyph's characters in the right order. So this driver
 * replays them, follows the text position the way a PDF viewer does, and
 * hands every glyph with its place to `page-layout.ts`, which rebuilds the page.
 *
 * **No page is ever drawn.** pdfjs-dist can draw through a native canvas
 * package, which this install leaves out on purpose. When it loads without
 * one it prints three warnings about drawing, once per process. They are
 * expected and say nothing about reading text.
 *
 * **A file that cannot be read is an answer, not a fault.** Bytes that are not
 * a PDF, a damaged file and a file that wants a password all come back as
 * `unreadable`. The driver throws only when the library itself cannot be
 * loaded, so the caller retries that and nothing else.
 *
 * **pdfjs-dist is loaded on first use, not when this module is**, for the
 * reason `sharp.ts` gives: the package index re-exports every driver, and a
 * process that never reads a PDF should not pay for the reader.
 */
/// <reference path="./pdfjs-worker.d.ts" />
import type {
  ExtractedPage,
  TextExtractionResult,
  TextExtractor,
} from "./extraction-port.ts";
import { type Glyph, pageText } from "./page-layout.ts";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type Page = Awaited<
  ReturnType<Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>["getPage"]>
>;

let loading: Promise<Pdfjs> | undefined;

/**
 * The library, imported once per process on the first document.
 *
 * **Its parser is imported here and handed to it.** Left alone, the library
 * loads the parser by a file path worked out at run time, which a bundled
 * server does not have: the web application is built into chunks and the file
 * is not where the library looks. The library first asks whether the parser
 * is already present under `globalThis.pdfjsWorker`, which is its own
 * documented way to be given one, so both files are ordinary imports a
 * bundler can follow.
 */
function loadPdfjs(): Promise<Pdfjs> {
  loading ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]).then(
    ([library, parser]) => {
      const host = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
      host.pdfjsWorker ??= parser;
      return library;
    },
    (error: unknown) => {
      loading = undefined;
      throw new Error(
        `Documents cannot be read: pdfjs-dist could not be loaded (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    },
  );
  return loading;
}

/** A PDF transform: [a, b, c, d, e, f]. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied first, then `n`. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const shift = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

function asMatrix(value: unknown): Matrix | undefined {
  if (
    (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    (value as ArrayLike<unknown>).length === 6
  ) {
    const numbers = Array.from(value as ArrayLike<number>);
    if (numbers.every((entry) => typeof entry === "number")) {
      return numbers as unknown as Matrix;
    }
  }
  return undefined;
}

const numberAt = (args: unknown, index: number): number => {
  const value = (args as readonly unknown[] | null)?.[index];
  return typeof value === "number" ? value : 0;
};

/**
 * One entry of a show-text instruction: a glyph, or a number that moves the
 * position. The library does not publish this type, so the three fields read
 * here are checked as they are read.
 */
interface DrawnGlyph {
  readonly unicode?: unknown;
  readonly width?: unknown;
  readonly isSpace?: unknown;
}

/** The text state a PDF keeps between instructions. */
interface TextState {
  ctm: Matrix;
  size: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  rise: number;
  /** Glyph widths are in font units; this turns them into text units. */
  fontScale: number;
}

/**
 * Replays the page's drawing instructions and returns every glyph with its
 * place. Only the instructions that move or draw text matter; the rest are
 * skipped.
 */
async function glyphsOf(pdfjs: Pdfjs, page: Page): Promise<Glyph[]> {
  const ops = pdfjs.OPS;
  const list = await page.getOperatorList();
  const glyphs: Glyph[] = [];

  let state: TextState = {
    ctm: IDENTITY,
    size: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    rise: 0,
    fontScale: 0.001,
  };
  const saved: TextState[] = [];
  let text: Matrix = IDENTITY;
  let line: Matrix = IDENTITY;

  const nextLine = () => {
    line = multiply(shift(0, state.leading), line);
    text = line;
  };

  const show = (entries: unknown) => {
    if (!Array.isArray(entries)) {
      return;
    }
    for (const entry of entries as readonly unknown[]) {
      if (typeof entry === "number") {
        const move = (-entry / 1000) * state.size * state.horizontalScale;
        text = multiply(shift(move, 0), text);
        continue;
      }
      if (entry === null || typeof entry !== "object") {
        continue;
      }
      const glyph = entry as DrawnGlyph;
      const width = typeof glyph.width === "number" ? glyph.width : 0;
      const placed = multiply(text, state.ctm);
      const origin = multiply(shift(0, state.rise), placed);
      const scale =
        Math.sqrt(Math.abs(origin[0] * origin[3] - origin[1] * origin[2])) || 1;
      const advance =
        (width * state.size * state.fontScale +
          state.charSpacing +
          (glyph.isSpace === true ? state.wordSpacing : 0)) *
        state.horizontalScale;
      const end = multiply(shift(advance, 0), placed);
      glyphs.push({
        u: typeof glyph.unicode === "string" ? glyph.unicode : "",
        x: origin[4],
        x2: end[4],
        y: origin[5],
        fs: Math.abs(state.size) * scale,
      });
      text = multiply(shift(advance, 0), text);
    }
  };

  for (let index = 0; index < list.fnArray.length; index++) {
    const args: unknown = list.argsArray[index];
    switch (list.fnArray[index]) {
      case ops.save:
        saved.push({ ...state });
        break;
      case ops.restore:
      case ops.paintFormXObjectEnd:
        state = saved.pop() ?? state;
        break;
      case ops.transform: {
        const matrix = asMatrix(args);
        if (matrix) {
          state.ctm = multiply(matrix, state.ctm);
        }
        break;
      }
      case ops.paintFormXObjectBegin: {
        saved.push({ ...state });
        const matrix = asMatrix((args as readonly unknown[] | null)?.[0]);
        if (matrix) {
          state.ctm = multiply(matrix, state.ctm);
        }
        break;
      }
      case ops.beginText:
        text = IDENTITY;
        line = IDENTITY;
        break;
      case ops.setFont: {
        state.size = numberAt(args, 1);
        state.fontScale = 0.001;
        const name = (args as readonly unknown[] | null)?.[0];
        try {
          // The font object is the library's own and untyped here. Only its
          // matrix is read, and only when it is the shape a matrix has.
          const font: unknown =
            typeof name === "string" ? page.commonObjs.get(name) : undefined;
          const matrix = (font as { fontMatrix?: unknown } | undefined)
            ?.fontMatrix;
          const first = (matrix as ArrayLike<unknown> | undefined)?.[0];
          if (typeof first === "number" && first !== 0) {
            state.fontScale = first;
          }
        } catch {
          // A font that has not resolved keeps the usual thousandth.
        }
        break;
      }
      case ops.setCharSpacing:
        state.charSpacing = numberAt(args, 0);
        break;
      case ops.setWordSpacing:
        state.wordSpacing = numberAt(args, 0);
        break;
      case ops.setHScale:
        state.horizontalScale = numberAt(args, 0) / 100;
        break;
      case ops.setLeading:
        state.leading = -numberAt(args, 0);
        break;
      case ops.setTextRise:
        state.rise = numberAt(args, 0);
        break;
      case ops.setTextMatrix: {
        const matrix =
          asMatrix(args) ?? asMatrix((args as readonly unknown[] | null)?.[0]);
        if (matrix) {
          text = matrix;
          line = matrix;
        }
        break;
      }
      case ops.moveText:
        line = multiply(shift(numberAt(args, 0), numberAt(args, 1)), line);
        text = line;
        break;
      case ops.setLeadingMoveText:
        state.leading = numberAt(args, 1);
        line = multiply(shift(numberAt(args, 0), numberAt(args, 1)), line);
        text = line;
        break;
      case ops.nextLine:
        nextLine();
        break;
      case ops.showText:
      case ops.showSpacedText:
        show((args as readonly unknown[] | null)?.[0]);
        break;
      case ops.nextLineShowText:
        nextLine();
        show((args as readonly unknown[] | null)?.[0]);
        break;
      case ops.nextLineSetSpacingShowText:
        state.wordSpacing = numberAt(args, 0);
        state.charSpacing = numberAt(args, 1);
        nextLine();
        show((args as readonly unknown[] | null)?.[2]);
        break;
      default:
        break;
    }
  }
  return glyphs;
}

export class PdfjsTextExtractor implements TextExtractor {
  async extract(body: Buffer): Promise<TextExtractionResult> {
    const pdfjs = await loadPdfjs();
    // A copy, because the library takes the buffer it is given for itself and
    // the caller's bytes would be left empty.
    const task = pdfjs.getDocument({
      data: new Uint8Array(body),
      verbosity: pdfjs.VerbosityLevel.ERRORS,
      // Nothing is drawn and nothing is fetched: no system fonts, no font
      // faces, no network.
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
    });
    try {
      const document = await task.promise;
      const pages: ExtractedPage[] = [];
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        pages.push({
          page: number,
          text: pageText(await glyphsOf(pdfjs, page)),
        });
        page.cleanup();
      }
      return { kind: "pages", pages };
    } catch {
      // Whatever the library could not get through is the file's fault: the
      // library loaded, so the reader is here.
      return { kind: "unreadable" };
    } finally {
      await task.destroy().catch(() => undefined);
    }
  }
}
