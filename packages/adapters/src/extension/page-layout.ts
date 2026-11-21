/**
 * From the glyphs a PDF page draws to the text a person reads on it
 * (docs/extension/design/extraction-quality.md, the method called 3 there).
 *
 * **Why this exists rather than the library's own text.** A PDF holds no
 * lines, words or reading order, only glyphs and where each is drawn. The
 * library's text layer rebuilds the rest, and for Arabic it reverses the two
 * letters of a joined pair, so about one word in twenty comes out wrong and a
 * quotation checked against the page fails. Each glyph still names its own
 * characters in the right order. So this module starts from the glyphs and
 * rebuilds the page itself.
 *
 * **Pure.** Numbers in, a string out. No file, no library, so every rule here
 * is tested with glyphs laid out by hand.
 *
 * A PDF draws every line from left to right, whatever its language. "Visual
 * order" below means that: sorted by x. "Logical order" is the order the
 * characters are read and stored in.
 */

/** One drawn glyph. */
export interface Glyph {
  /** The characters the font says this glyph stands for, in logical order. */
  readonly u: string;
  /** Where its origin is and where the next glyph starts, in page units. */
  readonly x: number;
  readonly x2: number;
  /** Its baseline. Larger is higher on the page. */
  readonly y: number;
  /** Its font size in page units. */
  readonly fs: number;
}

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const LATIN_LETTER = /\p{Script=Latin}/u;
const DIGIT = /\p{Nd}/u;
const ARABIC_MARK = /[ؐ-ًؚ-ٰٟۖ-ۭ]/;

/** A glyph that is only vowel marks, with or without a lengthening stroke. */
function isMark(u: string): boolean {
  return /^[\p{M}ـ]+$/u.test(u) && /\p{M}/u.test(u);
}

const isBlank = (u: string) => u.trim() === "";

/**
 * What a font gives a glyph it has no character for: a control character, a
 * private-use code or the replacement character. None of them is text.
 */
const UNNAMED = /[\p{Cc}\p{Co}\uFFFD]/gu;

/**
 * Unicode has "isolated" vowel marks, such as a shadda with a fatha as one
 * character, that fonts use for the mark drawn on a letter. Unicode spells
 * each as a space and the marks, and that space would split the word. It is
 * the marks alone that are drawn.
 */
function standingMark(glyph: Glyph): Glyph {
  const spelled = glyph.u
    .replace(/[\t\n\r]/g, " ")
    .replace(UNNAMED, "")
    .normalize("NFKC");
  if (spelled === "") {
    return { ...glyph, u: "" };
  }
  return /^\s[\p{M}\u0640]+$/u.test(spelled)
    ? { ...glyph, u: spelled.trim() }
    : glyph;
}

/** A gap this wide, as a share of the font size, is a space the file left out. */
const SPACE_GAP = 0.22;

/**
 * Gives every vowel mark to the letter it is drawn on.
 *
 * A mark is drawn above or below a letter, not beside it, and often on a
 * slightly different baseline. Left alone it opens a gap inside its word, or
 * becomes a line of its own. So marks are placed before lines are built.
 *
 * A mark has no width. In right-to-left text its origin is the left edge of
 * its own letter, which is also where the letter before ends, so an Arabic
 * mark on that boundary goes to the letter on its right.
 */
function attachMarks(glyphs: readonly Glyph[]): Glyph[] {
  const bases: { glyph: Glyph; marks: string }[] = [];
  const marks: Glyph[] = [];
  for (const glyph of glyphs) {
    if (isMark(glyph.u)) {
      marks.push(glyph);
    } else {
      bases.push({ glyph, marks: "" });
    }
  }
  const loose: Glyph[] = [];
  for (const mark of marks) {
    const centre = (mark.x + mark.x2) / 2;
    const arabic = ARABIC_MARK.test(mark.u);
    let best: { glyph: Glyph; marks: string } | undefined;
    let bestAcross = Number.POSITIVE_INFINITY;
    let bestDown = Number.POSITIVE_INFINITY;
    for (const base of bases) {
      const { glyph } = base;
      if (isBlank(glyph.u)) {
        continue;
      }
      const down = Math.abs(glyph.y - mark.y);
      if (down > 0.8 * Math.max(glyph.fs, mark.fs)) {
        continue;
      }
      // The edge a mark may sit on without counting as outside the letter.
      const open = 0.01 * glyph.fs;
      const inside = arabic
        ? centre >= glyph.x - open && centre < glyph.x2 - open
        : centre > glyph.x + open && centre <= glyph.x2 + open;
      const across = inside
        ? 0
        : Math.max(glyph.x - centre, centre - glyph.x2, 0) + open;
      if (
        across < bestAcross - 1e-6 ||
        (Math.abs(across - bestAcross) <= 1e-6 && down < bestDown)
      ) {
        best = base;
        bestAcross = across;
        bestDown = down;
      }
    }
    if (best && bestAcross <= 1.5 * mark.fs) {
      best.marks += mark.u;
    } else {
      loose.push(mark);
    }
  }
  return [
    ...bases.map(({ glyph, marks: added }) =>
      added === "" ? glyph : { ...glyph, u: glyph.u + added },
    ),
    ...loose,
  ];
}

/**
 * Drops a glyph drawn a second time on top of itself.
 *
 * A file can fake a bold face, or a shadow, by drawing the same text again a
 * fraction of a point away. Read as it is drawn, every letter comes out
 * twice. A second glyph with the same characters within a seventh of the font
 * size of the first is the same letter.
 */
function withoutOverprint(glyphs: readonly Glyph[]): Glyph[] {
  const seen = new Map<string, Glyph[]>();
  const kept: Glyph[] = [];
  for (const glyph of glyphs) {
    const reach = 0.15 * Math.max(glyph.fs, 1);
    const cell = `${glyph.u}|${Math.round(glyph.y / (4 * reach))}`;
    const row = seen.get(cell) ?? [];
    const above = seen.get(
      `${glyph.u}|${Math.round(glyph.y / (4 * reach)) + 1}`,
    );
    const below = seen.get(
      `${glyph.u}|${Math.round(glyph.y / (4 * reach)) - 1}`,
    );
    const twice = [...row, ...(above ?? []), ...(below ?? [])].some(
      (other) =>
        Math.abs(other.x - glyph.x) <= reach &&
        Math.abs(other.y - glyph.y) <= reach &&
        Math.abs(other.fs - glyph.fs) <= reach,
    );
    if (twice && !isBlank(glyph.u)) {
      continue;
    }
    row.push(glyph);
    seen.set(cell, row);
    kept.push(glyph);
  }
  return kept;
}

/** What a run of glyphs is, for deciding which way it reads. */
type UnitKind = "rtl" | "latin" | "number" | "neutral";

interface Unit {
  /** In logical order. */
  text: string;
  kind: UnitKind;
}

/** Signs that belong to the number they touch: 90%, $5. */
const NUMBER_SIGN = /^[%٪‰$€£¥#°]$/;
/** Signs that stay inside a number when digits stand on both sides: 6.34, 2026/11. */
const NUMBER_JOINER = /^[.,:/\u066B\u066C]$/;
/** Signs that join two Western numbers and reorder two Arabic ones: 2026-2030. */
const NUMBER_BETWEEN = /^[+\-\u2013]$/;

const MIRRORED: Readonly<Record<string, string>> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "«": "»",
  "»": "«",
  "‹": "›",
  "›": "‹",
};

/** Bracket pairs by shape, as a left-to-right reader sees them. */
const CLOSING: Readonly<Record<string, string>> = {
  ")": "(",
  "]": "[",
  "}": "{",
  "\u00BB": "\u00AB",
};
const OPENING: ReadonlySet<string> = new Set(Object.values(CLOSING));

/**
 * A font stores a bracket by its shape. In right-to-left text the opening
 * bracket is drawn with the closing shape, so a bracket read right to left is
 * the mirror of the one the file names.
 */
function mirror(text: string): string {
  let out = "";
  for (const char of text) {
    out += MIRRORED[char] ?? char;
  }
  return out;
}

function kindOf(u: string): UnitKind {
  if (RTL_CHAR.test(u) && !/^[٠-٩۰-۹]+$/.test(u)) {
    return "rtl";
  }
  if (LATIN_LETTER.test(u)) {
    return "latin";
  }
  if (DIGIT.test(u)) {
    return "number";
  }
  return "neutral";
}

/**
 * The glyphs of one stretch of a line as units in visual order: letters one
 * by one, each number whole, and a space wherever the drawing leaves a gap.
 */
function unitsOf(glyphs: readonly Glyph[]): Unit[] {
  const visual = [...glyphs].sort((a, b) => a.x - b.x);
  const raw: Unit[] = [];
  visual.forEach((glyph, index) => {
    const previous = visual[index - 1];
    if (previous) {
      const gap = glyph.x - previous.x2;
      const last = raw[raw.length - 1];
      if (
        gap > SPACE_GAP * Math.max(glyph.fs, 1) &&
        !isBlank(glyph.u) &&
        last &&
        !isBlank(last.text)
      ) {
        raw.push({ text: " ", kind: "neutral" });
      }
    }
    raw.push({
      text: isBlank(glyph.u) ? " " : glyph.u,
      kind: isBlank(glyph.u) ? "neutral" : kindOf(glyph.u),
    });
  });

  // A number is read left to right whatever surrounds it, with the signs that
  // belong to it. Built in two passes: digits and what joins them, then the
  // signs that touch the result.
  const joined: Unit[] = [];
  for (let index = 0; index < raw.length; index++) {
    const unit = raw[index] as Unit;
    const last = joined[joined.length - 1];
    const next = raw[index + 1];
    if (unit.kind === "number" && last?.kind === "number") {
      last.text += unit.text;
    } else if (
      NUMBER_JOINER.test(unit.text) &&
      last?.kind === "number" &&
      next?.kind === "number"
    ) {
      last.text += unit.text;
    } else {
      joined.push({ ...unit });
    }
  }
  // Signs join a number only where the number reads as a Western one: on a
  // line with no Arabic, or after Latin text. After Arabic text the algorithm
  // treats digits as an Arabic number, which signs do not join, so "90%" is
  // drawn with the percent sign on the left and "2026-2030" with the later
  // year first. Left as separate units here, they come out right when the
  // line is read from the right.
  const hasRtl = joined.some((unit) => unit.kind === "rtl");
  const western = (index: number) =>
    !hasRtl || strongNear(joined, index, -1, true)?.kind === "latin";
  const units: Unit[] = [];
  for (let index = 0; index < joined.length; index++) {
    const unit = joined[index] as Unit;
    const last = units[units.length - 1];
    const next = joined[index + 1];
    const sign = NUMBER_SIGN.test(unit.text);
    const between = NUMBER_BETWEEN.test(unit.text);
    if (
      (sign || between) &&
      last?.kind === "number" &&
      (sign || next?.kind === "number") &&
      western(index)
    ) {
      last.text += unit.text;
      if (between && next) {
        last.text += next.text;
        index++;
      }
    } else if (sign && next?.kind === "number" && western(index)) {
      next.text = unit.text + next.text;
    } else {
      units.push(unit);
    }
  }
  return units;
}

/** The nearest unit before or after `from` that is not a space or a sign. */
function strongNear(
  units: readonly Unit[],
  from: number,
  step: 1 | -1,
  skipNumbers: boolean,
): Unit | undefined {
  for (
    let index = from + step;
    index >= 0 && index < units.length;
    index += step
  ) {
    const unit = units[index] as Unit;
    if (unit.kind === "neutral" || (skipNumbers && unit.kind === "number")) {
      continue;
    }
    return unit;
  }
  return undefined;
}

/**
 * Units in visual order to text in logical order.
 *
 * This is the Unicode bidirectional algorithm run backwards, cut down to what
 * a printed page holds. In a right-to-left line, Latin words and numbers keep
 * their own order and everything else is read from the right. A space or a
 * sign between two Latin words belongs to them; a number counts as Latin only
 * when Latin text comes before it, which is the algorithm's own rule and is
 * why "KPI 3" stays together and "60" between two Arabic words stands alone.
 * A left-to-right line that quotes Arabic is the mirror image.
 */
function logicalText(units: readonly Unit[], pageRtl: boolean): string {
  const rtlCount = units.filter((unit) => unit.kind === "rtl").length;
  const latinCount = units.filter((unit) => unit.kind === "latin").length;
  if (rtlCount === 0) {
    return units.map((unit) => unit.text).join("");
  }
  const baseRtl = pageRtl || rtlCount >= latinCount;

  // Whether each unit keeps the direction opposite to the line's.
  const against = units.map((unit, index) => {
    if (baseRtl) {
      if (unit.kind === "latin" || unit.kind === "number") {
        return true;
      }
      if (unit.kind === "rtl") {
        return false;
      }
      const latinLike = (near: Unit | undefined, at: number, step: 1 | -1) => {
        if (near?.kind === "latin") {
          return true;
        }
        if (near?.kind !== "number") {
          return false;
        }
        // A number is Latin when the strong text before it is.
        const position = units.indexOf(near, step === 1 ? at : 0);
        return strongNear(units, position, -1, true)?.kind === "latin";
      };
      return (
        latinLike(strongNear(units, index, -1, false), index, -1) &&
        latinLike(strongNear(units, index, 1, false), index, 1)
      );
    }
    if (unit.kind === "rtl") {
      return true;
    }
    if (unit.kind === "latin") {
      return false;
    }
    return (
      strongNear(units, index, -1, true)?.kind === "rtl" &&
      strongNear(units, index, 1, true)?.kind === "rtl"
    );
  });

  // A pair of brackets around Latin text reads with it: "Net (NPS)" keeps its
  // closing bracket even when Arabic follows. This is the algorithm's rule for
  // paired brackets, and without it the last bracket of the pair is taken for
  // one that belongs to the Arabic around it.
  if (baseRtl) {
    const open: number[] = [];
    units.forEach((unit, index) => {
      if (unit.kind !== "neutral") {
        return;
      }
      if (OPENING.has(unit.text)) {
        open.push(index);
        return;
      }
      const start = open[open.length - 1];
      if (start === undefined || CLOSING[unit.text] !== units[start]?.text) {
        return;
      }
      open.pop();
      const inside = units.slice(start + 1, index);
      if (
        inside.some((held) => held.kind === "latin") &&
        !inside.some((held) => held.kind === "rtl")
      ) {
        against[start] = true;
        against[index] = true;
      }
    });
  }

  const out: string[] = [];
  if (baseRtl) {
    for (let index = units.length - 1; index >= 0; index--) {
      if (!against[index]) {
        out.push(mirror((units[index] as Unit).text));
        continue;
      }
      let start = index;
      while (start > 0 && against[start - 1]) {
        start--;
      }
      for (let inner = start; inner <= index; inner++) {
        out.push((units[inner] as Unit).text);
      }
      index = start;
    }
  } else {
    for (let index = 0; index < units.length; index++) {
      if (!against[index]) {
        out.push((units[index] as Unit).text);
        continue;
      }
      let end = index;
      while (end < units.length - 1 && against[end + 1]) {
        end++;
      }
      for (let inner = end; inner >= index; inner--) {
        const unit = units[inner] as Unit;
        out.push(unit.kind === "neutral" ? mirror(unit.text) : unit.text);
      }
      index = end;
    }
  }
  return out.join("").replace(/\s+/g, " ").trim();
}

interface Line {
  y: number;
  glyphs: Glyph[];
}

/** One stretch of one line: a line of a column, a table cell, a heading. */
interface Segment {
  glyphs: Glyph[];
  x1: number;
  x2: number;
  y: number;
  fs: number;
}

interface Block {
  segments: Segment[];
  x1: number;
  x2: number;
  /** The edges of its last line, which the next line is compared with. */
  lastX1: number;
  lastX2: number;
  top: number;
  lastY: number;
  fs: number;
}

/** Glyphs on one baseline, within a third of the font size. */
function linesOf(glyphs: readonly Glyph[]): Line[] {
  const sorted = [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const glyph of sorted) {
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate.y - glyph.y) <= Math.max(1.5, 0.3 * glyph.fs),
    );
    if (line) {
      line.glyphs.push(glyph);
    } else {
      lines.push({ y: glyph.y, glyphs: [glyph] });
    }
  }
  return lines;
}

/**
 * Where the page is cut into columns.
 *
 * A strip that several lines all leave empty is the space between two
 * columns, however narrow it is. A gap only one line has is a wide word
 * space.
 */
function guttersOf(lines: readonly Line[]): number[] {
  const gaps: [number, number][] = [];
  for (const line of lines) {
    const inked = line.glyphs
      .filter((glyph) => !isBlank(glyph.u))
      .sort((a, b) => a.x - b.x);
    let right = inked[0]?.x2 ?? 0;
    for (const glyph of inked.slice(1)) {
      if (glyph.x - right > 0.9 * Math.max(glyph.fs, 6)) {
        gaps.push([right, glyph.x]);
      }
      right = Math.max(right, glyph.x2);
    }
  }
  gaps.sort((a, b) => a[0] - b[0]);
  const gutters: { lo: number; hi: number; lines: number }[] = [];
  for (const [lo, hi] of gaps) {
    const gutter = gutters.find(
      (candidate) =>
        Math.min(candidate.hi, hi) - Math.max(candidate.lo, lo) > 0,
    );
    if (gutter) {
      gutter.lo = Math.max(gutter.lo, lo);
      gutter.hi = Math.min(gutter.hi, hi);
      gutter.lines++;
    } else {
      gutters.push({ lo, hi, lines: 1 });
    }
  }
  return gutters
    .filter((gutter) => gutter.lines >= 3)
    .map((gutter) => (gutter.lo + gutter.hi) / 2);
}

function segmentsOf(
  lines: readonly Line[],
  cuts: readonly number[],
): Segment[] {
  const groups: Glyph[][] = [];
  for (const line of lines) {
    const sorted = [...line.glyphs].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    if (!first) {
      continue;
    }
    let current: Glyph[] = [first];
    let right = first.x2;
    for (const glyph of sorted.slice(1)) {
      const gap = glyph.x - right;
      const unit = Math.max(glyph.fs, 6);
      const wide = gap > 2 * unit;
      const atGutter =
        gap > 0.6 * unit && cuts.some((cut) => cut > right && cut < glyph.x);
      if (wide || atGutter) {
        groups.push(current);
        current = [];
        right = glyph.x2;
      }
      current.push(glyph);
      right = Math.max(right, glyph.x2);
    }
    groups.push(current);
  }
  return groups
    .filter((group) => group.some((glyph) => !isBlank(glyph.u)))
    .map((group) => ({
      glyphs: group,
      x1: Math.min(...group.map((glyph) => glyph.x)),
      x2: Math.max(...group.map((glyph) => glyph.x2)),
      y: (group[0] as Glyph).y,
      fs: Math.max(...group.map((glyph) => glyph.fs)),
    }));
}

/**
 * Lines into paragraphs.
 *
 * A line continues the block whose last line it sits under and shares an edge
 * with: the right edge in Arabic text, the left in Latin, both when the text
 * is justified. A heading across two columns shares an edge with one at most.
 */
function blocksOf(segments: readonly Segment[]): Block[] {
  const blocks: Block[] = [];
  for (const segment of [...segments].sort((a, b) => b.y - a.y)) {
    const block = blocks.find((candidate) => {
      const size = Math.max(segment.fs, candidate.fs);
      const drop = candidate.lastY - segment.y;
      const edge =
        Math.abs(candidate.lastX2 - segment.x2) <= 1.5 * size ||
        Math.abs(candidate.lastX1 - segment.x1) <= 1.5 * size;
      const similar = Math.abs(candidate.fs - segment.fs) <= 0.2 * size;
      return edge && similar && drop >= -1 && drop <= 2.2 * size;
    });
    if (block) {
      block.segments.push(segment);
      block.x1 = Math.min(block.x1, segment.x1);
      block.x2 = Math.max(block.x2, segment.x2);
      block.lastX1 = segment.x1;
      block.lastX2 = segment.x2;
      block.lastY = segment.y;
    } else {
      blocks.push({
        segments: [segment],
        x1: segment.x1,
        x2: segment.x2,
        lastX1: segment.x1,
        lastX2: segment.x2,
        top: segment.y,
        lastY: segment.y,
        fs: segment.fs,
      });
    }
  }
  return blocks;
}

/**
 * Blocks into reading order.
 *
 * The page is cut into horizontal bands: a band is a set of blocks whose
 * heights overlap, so two columns side by side are one band and a heading
 * across the page is a band of its own. Bands are read top to bottom. Inside
 * a band, blocks that stand above one another form a column, each column is
 * read to its end, and columns go right to left on an Arabic page.
 */
function inReadingOrder(blocks: readonly Block[], pageRtl: boolean): Block[] {
  const top = (block: Block) => block.top + 0.8 * block.fs;
  const bottom = (block: Block) => block.lastY - 0.2 * block.fs;
  const byTop = [...blocks].sort((a, b) => top(b) - top(a));

  const bands: { top: number; bottom: number; blocks: Block[] }[] = [];
  for (const block of byTop) {
    const band = bands[bands.length - 1];
    const overlap = band
      ? Math.min(band.top, top(block)) - Math.max(band.bottom, bottom(block))
      : 0;
    if (band && overlap > 0.3 * block.fs) {
      band.blocks.push(block);
      band.bottom = Math.min(band.bottom, bottom(block));
    } else {
      bands.push({ top: top(block), bottom: bottom(block), blocks: [block] });
    }
  }

  // Columns carry on across a band break. The paragraphs of two columns can
  // happen to end at the same height, which looks like a break across the
  // page and is not one: every block under it still sits inside one column.
  interface Column {
    x1: number;
    x2: number;
    blocks: Block[];
  }
  const shared = (column: Column, block: Block) =>
    Math.max(0, Math.min(column.x2, block.x2) - Math.max(column.x1, block.x1));
  const groups: Column[][] = [];
  for (const band of bands) {
    const previous = groups[groups.length - 1];
    if (previous && previous.length >= 2) {
      const homes = band.blocks.map((block) => {
        const width = Math.max(block.x2 - block.x1, 1);
        const inside = previous.filter(
          (column) => shared(column, block) > 0.1 * width,
        );
        const home = inside[0];
        return inside.length === 1 && home && shared(home, block) >= 0.8 * width
          ? home
          : undefined;
      });
      if (homes.every((home) => home !== undefined)) {
        band.blocks.forEach((block, index) => {
          homes[index]?.blocks.push(block);
        });
        continue;
      }
    }
    const columns: Column[] = [];
    for (const block of band.blocks) {
      const column = columns.find(
        (candidate) =>
          shared(candidate, block) >
          0.5 * Math.min(candidate.x2 - candidate.x1, block.x2 - block.x1),
      );
      if (column) {
        column.blocks.push(block);
        column.x1 = Math.min(column.x1, block.x1);
        column.x2 = Math.max(column.x2, block.x2);
      } else {
        columns.push({ x1: block.x1, x2: block.x2, blocks: [block] });
      }
    }
    columns.sort((a, b) => (pageRtl ? b.x2 - a.x2 : a.x1 - b.x1));
    groups.push(columns);
  }
  return groups.flatMap((columns) =>
    columns.flatMap((column) => column.blocks),
  );
}

/**
 * The text of one page, in reading order. Paragraphs are separated by an
 * empty line and the lines of a paragraph by a line break.
 */
export function pageText(glyphs: readonly Glyph[]): string {
  const drawn = attachMarks(
    withoutOverprint(
      glyphs.map(standingMark).filter((glyph) => glyph.u !== ""),
    ),
  );
  if (!drawn.some((glyph) => !isBlank(glyph.u))) {
    return "";
  }
  const rtl = drawn.filter((glyph) => kindOf(glyph.u) === "rtl").length;
  const latin = drawn.filter((glyph) => kindOf(glyph.u) === "latin").length;
  const pageRtl = rtl > latin;

  const lines = linesOf(drawn);
  const segments = segmentsOf(lines, guttersOf(lines));
  const blocks = inReadingOrder(blocksOf(segments), pageRtl);
  return blocks
    .map((block) =>
      block.segments
        .map((segment) => logicalText(unitsOf(segment.glyphs), pageRtl))
        .filter((line) => line !== "")
        .join("\n"),
    )
    .filter((paragraph) => paragraph !== "")
    .join("\n\n")
    .normalize("NFKC");
}
