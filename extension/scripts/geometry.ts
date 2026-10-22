/**
 * The screenshot run's geometry checks (GH-105). Tests can't see a broken layout and a screenshot needs
 * someone to read it, but some breakage is a matter of numbers: two controls drawn over each other, a
 * label cut off, the selected tab scrolled out of the rail, a page that scrolls sideways. Each page,
 * as the screenshot run draws it, measures itself with COLLECT_GEOMETRY and writes what it found into
 * the DOM Chrome dumps; judge() decides, with no browser, so its rules are unit-tested.
 *
 * Each check says how many elements it examined. A page fails when its clipped or words check examined
 * none, or its overlap, tab or overview check where the page has what that check reads; a whole run fails
 * when a check's total is below RUN_FLOOR. So a page that drew nothing can't pass.
 */

import { COLLECT_WORDS, type GeoSaid, judgeWords, WORK_DATA } from './words.ts';
import { SELECTED_TAB } from './steady.ts';
import { A11Y_EXCEPTIONS, type GeoA11y, incompleteSummary, judgeA11y } from './a11y.ts';

export const CHECKS = ['overlap', 'clipped', 'tab', 'sideways', 'overview', 'buttons', 'words', 'covered', 'raw', 'a11y', 'actions'] as const;
export type Check = (typeof CHECKS)[number];

/** A box in the page's coordinates, in CSS pixels. */
export interface Box { x: number; y: number; w: number; h: number }

/** A control as drawn: the part of it its clipping ancestors show. */
export interface GeoControl {
  what: string;
  text: string;
  box: Box;
  /** The indexes of the controls it sits inside: a button in a card that opens is part of the card. */
  inside: number[];
  /** Its sticky or fixed layer, or the open menu it is in, such as a card's ⋯ (D-168), which floats over the page by design; null in the page's flow. */
  layer: number | null;
}

/** A run of text, and how far it reaches past what its clipping ancestors show. */
export interface GeoText {
  what: string;
  text: string;
  /** Pixels past the clipping box, on the worst side; 0 when it fits. */
  over: number;
  /** The box that clips it cuts it with an ellipsis. */
  ellipsis: boolean;
  /** Its element, or the control or cell it sits in, carries its full text in title or aria-label. */
  titled: boolean;
  /** It sits in a fold of a few lines with Show all, which cuts it on purpose. */
  folded: boolean;
}

/** What a page measured of itself. */
export interface GeoSnapshot {
  controls: GeoControl[];
  texts: GeoText[];
  /** The rail's selected tab and the part of the rail on screen, or null where there's no rail. */
  tab: { what: string; box: Box; rail: Box } | null;
  /** How wide the document is against the window. */
  doc: { scroll: number; view: number };
  /** Every element that may scroll sideways, how wide its content is against itself, and whether it's one that's meant to. */
  scrollers: { what: string; scroll: number; client: number; allowed: boolean }[];
  /**
   * The Overview's lists and the box of each line in them (GH-160), as the page marks them: a group with
   * data-overview-group, a line with data-overview-row; and each list's card (T-36), data-overview-card.
   * Null on any other page.
   */
  overview?: { groups: { what: string; rows: Box[] }[]; cards?: { what: string; box: Box }[] } | null;
  /**
   * Each row button the Overview draws (T-25): the title of its row and its aria-label, null when it has none.
   * Null on any other page.
   */
  buttons?: DrawnButton[] | null;
  /** Every string a person can read on the page, for the words check (GH-163, words.ts). */
  said?: GeoSaid[];
  /**
   * Every class on a visible element drawn at least partly inside the window, which is what the shot
   * holds, for the screenshots gate (T-5, looked.ts): a class a branch adds must be drawn in some shot.
   */
  drawn?: string[];
  /** Where the first column of a tracker's board starts, in CSS pixels down the page (T-42). Null where no tracker board is drawn. */
  boardTop?: number | null;
  /**
   * Each table cell with text, in a row that has a sticky cell (T-46), measured at the page's first scroll
   * position: the box its text fills, the row it is in, and whether it is the sticky cell itself.
   */
  cells?: GeoCell[];
  /** How many fonts the page loaded before it was sent its model (T-21, steady.ts): none means nothing waited on them. */
  fonts?: number;
  /** What axe found on the page (T-55, a11y.ts). */
  a11y?: GeoA11y;
  /** Each output panel drawn, and every block of raw output in it (T-64): the raw check fails on one. */
  panels?: { what: string; raw: string[] }[];
  /** Each set of a task's actions the page marks with data-action-set (D-168): its next step's box, and the rest's. */
  actionSets?: GeoActionSet[];
}

/** A task's actions as drawn: the next step, full width, and the rest in the grid under it. */
export interface GeoActionSet { what: string; next: Box[]; rest: Box[] }

/**
 * A task's actions share one size and one place (D-168): every button in a set is as high as the first,
 * the rest are each as wide as the first of them, and the next step is as wide as the grid under it.
 * Returns each finding.
 */
export function judgeActions(sets: GeoActionSet[]): { what: string; detail: string }[] {
  const out: { what: string; detail: string }[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  for (const s of sets) {
    const all = [...s.next, ...s.rest];
    const h = all[0]?.h;
    all.forEach((b, i) => { if (h !== undefined && !near(b.h, h)) out.push({ what: s.what, detail: `button ${i + 1} is ${b.h} px high, not ${h} as the first is` }); });
    const w = s.rest[0]?.w;
    s.rest.forEach((b, i) => { if (w !== undefined && !near(b.w, w)) out.push({ what: s.what, detail: `the grid's button ${i + 1} is ${b.w} px wide, not ${w} as the first is` }); });
    const left = Math.min(...s.rest.map((b) => b.x));
    const right = Math.max(...s.rest.map((b) => b.x + b.w));
    for (const n of s.next) if (s.rest.length && (!near(n.x, left) || !near(n.x + n.w, right))) out.push({ what: s.what, detail: `the next step spans ${n.x} to ${n.x + n.w} px, not the grid's ${left} to ${right}` });
  }
  return out;
}

/**
 * A block of raw output in the output panel (T-64): the pre.dock-out it showed a run's lines in as plain text
 * until then, or any other pre. The panel shows a run as rows, never as a block of raw lines.
 */
export const RAW_OUTPUT = '.dock pre, .dock .dock-out';

/** A table cell's text as drawn, in a row with a sticky cell. */
export interface GeoCell { what: string; text: string; row: number; sticky: boolean; box: Box }

/** A row button as drawn on the Overview, and as its row's model says it should be named. */
export interface DrawnButton { row: string; label: string | null }
export interface ExpectedButton { row: string; label: string }

/**
 * The Overview's row buttons (T-25), judged as drawn: each has an aria-label that isn't empty and is its
 * row's button label in the model. expected is null where the model isn't to hand (the label is then
 * only checked for being there). Returns a finding for each button that fails.
 */
export function judgeButtons(drawn: DrawnButton[], expected: ExpectedButton[] | null): string[] {
  const found: string[] = [];
  for (const b of drawn) {
    if (!b.label?.trim()) { found.push(`the button on "${b.row}" has no aria-label`); continue; }
    if (!expected) continue;
    const labels = expected.filter((e) => e.row === b.row).map((e) => e.label);
    if (!labels.includes(b.label)) found.push(`the button on "${b.row}" is named "${b.label}", not ${labels.length ? labels.map((l) => `"${l}"`).join(' or ') : 'by any button in the model'}`);
  }
  return found;
}

/**
 * The Overview is a landing page (GH-160): each line is one line high, Needs you shows three at most (T-36),
 * and each line stands apart from the next, on the page and in a list a detail shows over it. The height is pinned for a line at the page's font size, with its
 * buttons, at every width the run draws.
 */
export const OVERVIEW_LINES = { maxHeight: 44, minGap: 4, maxRows: 3 } as const;

/**
 * The Overview's cards line up in a grid (T-36): the cards in a row share their top and their height, every
 * card is as wide as the first, and each stands in one of the first row's columns. Returns each finding.
 */
export function judgeCards(cards: { what: string; box: Box }[]): string[] {
  const out: string[] = [];
  const first = cards[0];
  if (!first) return out;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const columns = cards.filter((c) => near(c.box.y, first.box.y)).map((c) => c.box.x);
  for (const c of cards) {
    if (!near(c.box.w, first.box.w)) out.push(`${c.what} is ${c.box.w} px wide, not ${first.box.w} as the first card is`);
    if (!columns.some((x) => near(x, c.box.x))) out.push(`${c.what} starts at ${c.box.x} px, in none of the first row's columns`);
    const row = cards.filter((o) => near(o.box.y, c.box.y));
    if (row.some((o) => !near(o.box.h, c.box.h))) out.push(`${c.what} is ${c.box.h} px high, not as high as the cards beside it`);
    if (cards.some((o) => o !== c && !near(o.box.y, c.box.y) && o.box.y < c.box.y + c.box.h && c.box.y < o.box.y + o.box.h)) out.push(`${c.what} is out of line with the cards beside it`);
  }
  return out;
}

/** The elements that scroll sideways by design: a board's lanes, a wide table, the rail's strip, code. */
export const SIDEWAYS = ['.board', '.table-wrap', '.rail', '.doc pre', '.table-scroll'];

/** A geometry check's finding: what it found and where. */
export interface Violation { check: Check; what: string; detail: string }

/**
 * What the checks allow, each with why. A run of every page fails on one that excused nothing, so the
 * list only shrinks.
 */
export const GEOMETRY_EXCEPTIONS: { name: string; check: Check; what: RegExp; reason: string }[] = [];

export interface Verdict {
  examined: Record<Check, number>;
  violations: Violation[];
  /** How many findings each exception excused, by its name. */
  excused: Record<string, number>;
  /** How many strings each work-data region held, by its name (GH-163). */
  held: Record<string, number>;
  /** Where the first column of a tracker's board starts (T-42), or null where none is drawn. */
  boardTop: number | null;
  /** How many nodes axe left incomplete, by rule (T-55): counted, never a finding. */
  incomplete: Record<string, number>;
}

/** The two boxes overlap by more than a pixel each way. */
const overlaps = (a: Box, b: Box): boolean => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
/** Box a lies inside b, give or take a pixel. */
const within = (a: Box, b: Box): boolean => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
const quote = (s: string): string => (s ? ` "${s.length > 40 ? `${s.slice(0, 39)}…` : s}"` : '');

/**
 * Judges one drawing of a page. home: it's one of the Command Center's sections, which have the rail.
 * No two controls overlap, unless one sits inside the other or one floats in a sticky layer. No text is
 * cut off: an ellipsis passes only with the full text in a title or aria-label. The rail's selected tab
 * is on screen. Nothing scrolls sideways but SIDEWAYS. On the Overview, its lines keep OVERVIEW_LINES.
 * And no string outside work data names an acc command or path (words.ts, GH-163). Nor does axe find a
 * violation that a11yExceptions doesn't excuse (a11y.ts, T-55). controls: the page has controls, which every
 * page but a still one, such as the loading screen, does (T-16).
 */
export function judge(s: GeoSnapshot, home: boolean, exceptions = GEOMETRY_EXCEPTIONS, controls = true, expected: ExpectedButton[] | null = null, a11yExceptions = A11Y_EXCEPTIONS): Verdict {
  const found: Violation[] = [];
  const cs = s.controls;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i]!;
      const b = cs[j]!;
      if (a.inside.includes(j) || b.inside.includes(i)) continue;
      if (a.layer !== b.layer && (a.layer !== null || b.layer !== null)) continue;
      if (overlaps(a.box, b.box)) found.push({ check: 'overlap', what: a.what, detail: `${quote(a.text).trim() || 'it'} overlaps ${b.what}${quote(b.text)}` });
    }
  }
  for (const t of s.texts) {
    if (t.folded || t.over <= 1 || (t.ellipsis && t.titled)) continue;
    found.push({ check: 'clipped', what: t.what, detail: t.ellipsis ? `${quote(t.text).trim()} is cut short with an ellipsis, and no title or aria-label holds it whole` : `${quote(t.text).trim()} is cut off by ${Math.round(t.over)} px` });
  }
  if (s.tab && !within(s.tab.box, s.tab.rail)) found.push({ check: 'tab', what: s.tab.what, detail: 'the selected tab is outside the rail\'s visible part' });
  const lines = s.overview?.groups ?? [];
  const cards = s.overview?.cards ?? [];
  for (const f of judgeCards(cards)) found.push({ check: 'overview', what: 'the cards', detail: f });
  for (const g of lines) {
    if (g.what === 'needs-you' && g.rows.length > OVERVIEW_LINES.maxRows) found.push({ check: 'overview', what: g.what, detail: `shows ${g.rows.length} lines, more than ${OVERVIEW_LINES.maxRows}` });
    const rows = [...g.rows].sort((a, b) => a.y - b.y);
    rows.forEach((r, i) => {
      if (r.h > OVERVIEW_LINES.maxHeight) found.push({ check: 'overview', what: g.what, detail: `line ${i + 1} is ${r.h} px high, more than one line's ${OVERVIEW_LINES.maxHeight}` });
      const next = rows[i + 1];
      if (next && next.y - (r.y + r.h) < OVERVIEW_LINES.minGap) found.push({ check: 'overview', what: g.what, detail: `lines ${i + 1} and ${i + 2} are ${next.y - (r.y + r.h)} px apart, less than ${OVERVIEW_LINES.minGap}` });
    });
  }
  // A sticky cell floats over its row, so it must not sit on another cell's text, whole or part (T-46).
  const cells = s.cells ?? [];
  const plain = cells.filter((c) => !c.sticky);
  for (const c of plain) {
    const over = cells.find((o) => o.sticky && o.row === c.row && overlaps(o.box, c.box));
    if (over) found.push({ check: 'covered', what: c.what, detail: `${quote(c.text).trim()} is covered by the sticky ${over.what}` });
  }
  // The output panel shows a run as rows, never as a block of raw lines (T-64).
  const panels = s.panels ?? [];
  for (const p of panels) for (const r of p.raw) found.push({ check: 'raw', what: r, detail: 'the output panel shows a block of raw output, not rows' });
  const buttons = s.buttons ?? [];
  for (const f of judgeButtons(buttons, expected)) found.push({ check: 'buttons', what: 'the Overview', detail: f });
  const actionSets = s.actionSets ?? [];
  for (const f of judgeActions(actionSets)) found.push({ check: 'actions', what: f.what, detail: f.detail });
  if (s.doc.scroll > s.doc.view + 1) found.push({ check: 'sideways', what: 'the page', detail: `scrolls sideways by ${s.doc.scroll - s.doc.view} px` });
  for (const x of s.scrollers) if (!x.allowed && x.scroll > x.client + 1) found.push({ check: 'sideways', what: x.what, detail: `scrolls sideways by ${x.scroll - x.client} px` });

  // The words a person reads name processes, not acc's commands or paths (GH-163).
  const said = judgeWords(s.said ?? []);
  for (const f of said.findings) found.push({ check: 'words', what: f.what, detail: f.detail });

  const a11y = judgeA11y(s.a11y, a11yExceptions);
  const examined: Record<Check, number> = { overlap: cs.length, clipped: s.texts.length, tab: s.tab ? 1 : 0, sideways: 1 + s.scrollers.length, overview: lines.reduce((n, g) => n + g.rows.length, 0) + cards.length, buttons: buttons.length, words: said.examined, covered: plain.length, raw: panels.length, a11y: a11y.examined, actions: actionSets.reduce((n, x) => n + x.next.length + x.rest.length, 0) };
  const excused: Record<string, number> = Object.fromEntries(exceptions.map((e) => [e.name, 0]));
  const violations = found.filter((v) => {
    const e = exceptions.find((x) => x.check === v.check && x.what.test(v.what));
    if (e) excused[e.name]!++;
    return !e;
  });
  // A page with no controls by design, such as the loading screen (T-16), is judged without them.
  if (controls && !examined.overlap) violations.push({ check: 'overlap', what: 'the page', detail: 'examined no controls' });
  if (!examined.clipped) violations.push({ check: 'clipped', what: 'the page', detail: 'examined no text' });
  if (home && !examined.tab) violations.push({ check: 'tab', what: 'the page', detail: 'has no selected tab in the rail' });
  if (s.overview && !examined.overview) violations.push({ check: 'overview', what: 'the page', detail: 'is the Overview, and examined no lines or cards on it' });
  if (!examined.words) violations.push({ check: 'words', what: 'the page', detail: 'gathered no words' });
  // What axe found that no exception excuses, and a page where it examined nothing (T-55).
  for (const f of a11y.findings) violations.push({ check: 'a11y', what: f.what, detail: f.detail });
  return { examined, violations, excused: { ...excused, ...a11y.excused }, held: said.held, boardTop: s.boardTop ?? null, incomplete: a11y.incomplete };
}

/**
 * The most a tracker board's first column may start down the page at 1000 px wide (T-42): the header above
 * it is the toolbar, the board's name with its buttons, one source line and the warning. It was about 330 with
 * four rows and a warning, and is 283 now; the run fails when the column starts lower than this.
 */
export const BOARD_TOP = { page: 'tasks', width: 1000, max: 283 } as const;

/** One drawing's verdict: its page, theme and width. */
export interface Render { page: string; theme: string; width: number; verdict: Verdict }

/**
 * The least a run of every page, both themes and all three widths examines, per check. Raised as the
 * pages grow, never lowered: a run below one has stopped looking.
 */
export const RUN_FLOOR: Record<Check, number> = { overlap: 22140, clipped: 41700, tab: 564, sideways: 1100, overview: 800, buttons: 450, words: 76400, covered: 1700, raw: 348, a11y: 190000, actions: 330 };

/**
 * What fails a run: each finding, by page, theme, width and check. A whole run (full) also fails below
 * RUN_FLOOR, on an exception that excused nothing, in GEOMETRY_EXCEPTIONS or A11Y_EXCEPTIONS (T-55), and on
 * a kind of work data no page drew (GH-163).
 */
export function runFailures(renders: Render[], full: boolean, exceptions = GEOMETRY_EXCEPTIONS, floor = RUN_FLOOR, regions = WORK_DATA, a11yExceptions = A11Y_EXCEPTIONS): string[] {
  const out = renders.flatMap((r) => r.verdict.violations.map((v) => `${r.page} ${r.theme} ${r.width}px: ${v.check}: ${v.what}: ${v.detail}`));
  if (!renders.length) out.push('No page was drawn.');
  for (const r of renders) {
    if (r.page !== BOARD_TOP.page || r.width !== BOARD_TOP.width) continue;
    if (r.verdict.boardTop === null) out.push(`${r.page} ${r.theme} ${r.width}px: board: no tracker board's first column was measured`);
    else if (r.verdict.boardTop > BOARD_TOP.max) out.push(`${r.page} ${r.theme} ${r.width}px: board: the first column starts ${r.verdict.boardTop} px down, below ${BOARD_TOP.max}`);
  }
  // The Overview pages drew lines, and none of them gave a button to check (T-25).
  const drewLines = renders.some((r) => r.verdict.examined.overview > 0);
  if (drewLines && !renders.some((r) => r.verdict.examined.buttons > 0)) out.push('The Overview pages gave no row button to check.');
  // A task's page drew no actions to measure (D-168).
  if (renders.some((r) => r.page.startsWith('ticket')) && !renders.some((r) => r.verdict.examined.actions > 0)) out.push('The task pages gave no action buttons to check.');
  if (!full) return out;
  const total = examinedIn(renders);
  for (const c of CHECKS) if (total[c] < floor[c]) out.push(`The run examined ${total[c]} for ${c}, below its floor of ${floor[c]}.`);
  for (const e of exceptions) if (!renders.some((r) => r.verdict.excused[e.name])) out.push(`The exception for ${e.name} excused nothing: take it off GEOMETRY_EXCEPTIONS.`);
  for (const e of a11yExceptions) if (!renders.some((r) => r.verdict.excused[e.name])) out.push(`The exception for ${e.name} excused nothing: take it off A11Y_EXCEPTIONS.`);
  for (const w of regions) if (!renders.some((r) => r.verdict.held?.[w.name])) out.push(`Work data "${w.name}" held no words on any page: draw it in a fixture, or take it off WORK_DATA.`);
  return out;
}

const examinedIn = (renders: Render[]): Record<Check, number> => Object.fromEntries(CHECKS.map((c) => [c, renders.reduce((n, r) => n + r.verdict.examined[c], 0)])) as Record<Check, number>;

/** What a run examined, per check, how many findings each exception excused, and axe's incomplete results by rule (T-55). */
export function geometrySummary(renders: Render[]): string {
  const total = examinedIn(renders);
  const excused = [...GEOMETRY_EXCEPTIONS, ...A11Y_EXCEPTIONS].map((e) => `${e.name} ${renders.reduce((n, r) => n + (r.verdict.excused[e.name] ?? 0), 0)}`);
  const held = WORK_DATA.map((w) => `${w.name} ${renders.reduce((n, r) => n + (r.verdict.held?.[w.name] ?? 0), 0)}`);
  return `Geometry of ${renders.length} drawings: ${CHECKS.map((c) => `${c} examined ${total[c]}`).join(', ')}.${excused.length ? ` Excused: ${excused.join(', ')}.` : ''} Work data held: ${held.join(', ')}. Incomplete in axe, by rule: ${incompleteSummary(renders.map((r) => r.verdict.incomplete ?? {}))}.`;
}

/** The geometry a --dump-dom of a measuring page holds, or null when it never measured. */
export function dumpedGeometry(dom: string): GeoSnapshot | null {
  const m = /<script[^>]*\bid="acc-geometry"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  return m ? (JSON.parse(m[1]!) as GeoSnapshot) : null;
}

/**
 * The page's side: measures itself when called, which pageFor does once its fonts have loaded, two frames
 * have drawn and the selected tab has settled, and writes
 * what it found into a JSON script element, which Chrome's --dump-dom prints. The screenshot run puts it
 * in each page it draws. `<` is escaped in the JSON, so no text from the page can close the element.
 * more, if given, is called once the page is measured, and resolves to more parts of the dump, such as
 * the a11y part (T-55): the element is written once it has.
 */
export const COLLECT_GEOMETRY = `
function collectGeometry(more) {
  const SIDEWAYS = ${JSON.stringify(SIDEWAYS)};
  const style = (e) => getComputedStyle(e);
  const name = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  const what = (e) => { const parts = []; for (let x = e; x && x !== document.body && parts.length < 3; x = x.parentElement) parts.unshift(name(x)); return parts.join(' > '); };
  const words = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const box = (l, t, r, b) => ({ x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(b - t) });
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  // The part of a rect that \`from\` and its ancestors show: each that clips an axis cuts it. A text is cut
  // only up to the first that scrolls it, since the rest scrolls into view; a control is drawn only where
  // every one of them shows it.
  function shown(from, r, scrolled) {
    const c = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    let x = true, y = true, ellipsis = false, folded = false;
    for (let p = from; p && (x || y); p = p.parentElement) {
      const s = style(p);
      if (s.webkitLineClamp && s.webkitLineClamp !== 'none') folded = true;
      const pr = p.getBoundingClientRect();
      if (x && s.overflowX !== 'visible') { if (!scrolled && scrolls(s.overflowX)) x = false; else { c.l = Math.max(c.l, pr.left); c.r = Math.min(c.r, pr.right); if (s.textOverflow === 'ellipsis') ellipsis = true; } }
      if (y && s.overflowY !== 'visible') { if (!scrolled && scrolls(s.overflowY)) y = false; else { c.t = Math.max(c.t, pr.top); c.b = Math.min(c.b, pr.bottom); } }
      if (s.position === 'fixed') break;
    }
    return { c, ellipsis, folded };
  }
  const layers = new Map();
  const layerOf = (e) => { for (let p = e; p; p = p.parentElement) { const s = style(p).position; if (s === 'sticky' || s === 'fixed' || p.getAttribute('role') === 'menu') { if (!layers.has(p)) layers.set(p, layers.size); return layers.get(p); } } return null; };
  const visible = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });

  const found = [...document.querySelectorAll('button, a[href], a.ext, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]')].filter(visible);
  const index = new Map();
  const controls = [];
  for (const e of found) {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const { c } = shown(e.parentElement, r, true);
    if (c.r - c.l < 1 || c.b - c.t < 1) continue;
    index.set(e, controls.length);
    controls.push({ e, what: what(e), text: words(e.getAttribute('aria-label') || e.textContent).slice(0, 60), box: box(c.l, c.t, c.r, c.b), inside: [], layer: layerOf(e) });
  }
  for (const c of controls) for (let p = c.e.parentElement; p; p = p.parentElement) if (index.has(p)) c.inside.push(index.get(p));

  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const e = n.parentElement;
    if (!e || !words(n.textContent) || e.closest('script, style, option, select, textarea') || !visible(e)) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const { c, ellipsis, folded } = shown(e, r, false);
    const over = Math.max(0, c.l - r.left, r.right - c.r, c.t - r.top, r.bottom - c.b);
    // The whole text the cut element holds, and whether a title or aria-label up to its control or cell carries it.
    const full = words(e.textContent);
    let titled = false;
    for (let p = e; p && p !== document.body; p = p.parentElement) {
      if (words(p.getAttribute('title')).includes(full) || words(p.getAttribute('aria-label')).includes(full)) { titled = true; break; }
      if (index.has(p) || p.tagName === 'TD' || p.tagName === 'TH') break;
    }
    texts.push({ what: what(e), text: words(n.textContent).slice(0, 60), over: Math.round(over), ellipsis, titled, folded });
  }

  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const sel = document.querySelector('${SELECTED_TAB}');
  let tab = null;
  if (sel) {
    const t = sel.getBoundingClientRect();
    const rr = sel.closest('.rail').getBoundingClientRect();
    tab = { what: what(sel), box: box(t.left, t.top, t.right, t.bottom), rail: box(Math.max(rr.left, 0), Math.max(rr.top, 0), Math.min(rr.right, vw), Math.min(rr.bottom, vh)) };
  }
  const scrollers = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!scrolls(style(e).overflowX)) continue;
    scrollers.push({ what: what(e), scroll: e.scrollWidth, client: e.clientWidth, allowed: SIDEWAYS.some((s) => e.matches(s)) });
  }
  const doc = { scroll: document.documentElement.scrollWidth, view: vw };
  // The Overview's lists, and each line's box, as the page marks them (GH-160), with the list a detail open
  // over it shows (T-36), and each list's card.
  const home = document.querySelector('.home-main[data-section="overview"]');
  const opened = document.querySelector('dialog.detail-modal[open]');
  const scopes = home ? [home, ...(opened ? [opened] : [])] : [];
  const overview = home ? { groups: scopes.flatMap((s) => [...s.querySelectorAll('[data-overview-group]')]).filter(visible).map((g) => ({
    what: g.dataset.overviewGroup,
    rows: [...g.querySelectorAll('[data-overview-row]')].filter((r) => r.closest('[data-overview-group]') === g && visible(r)).map((r) => { const b = r.getBoundingClientRect(); return box(b.left, b.top, b.right, b.bottom); }),
  })), cards: [...home.querySelectorAll('[data-overview-card]')].filter(visible).map((c) => { const b = c.getBoundingClientRect(); return { what: 'the ' + c.dataset.overviewCard + ' card', box: box(b.left, b.top, b.right, b.bottom) }; }) } : null;
  // Every string a person can read, for the words check (GH-163).${COLLECT_WORDS}
  // The Overview's row buttons and the names they carry (T-25).
  const buttons = home ? scopes.flatMap((s) => [...s.querySelectorAll('.lp-btn')]).filter(visible).map((b) => ({ row: words(b.closest('[data-overview-row]')?.querySelector('.lp-title')?.textContent), label: b.getAttribute('aria-label') })) : null;
  // The classes drawn inside the window, which the shot holds, for the screenshots gate (T-5).
  const drawn = new Set();
  for (const e of document.querySelectorAll('body *')) {
    if (!e.classList.length || !visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
    for (const c of e.classList) drawn.add(c);
  }
  // The text of each cell in a row with a sticky cell, at the first scroll position (T-46).
  const cells = [];
  [...document.querySelectorAll('tr')].forEach((tr, row) => {
    const tds = [...tr.children].filter((c) => (c.tagName === 'TD' || c.tagName === 'TH') && visible(c));
    if (!tds.some((c) => style(c).position === 'sticky')) return;
    for (const c of tds) {
      const rg = document.createRange();
      rg.selectNodeContents(c);
      const r = rg.getBoundingClientRect();
      const sticky = style(c).position === 'sticky';
      if (!words(c.textContent) || r.width < 1 || r.height < 1) { if (!sticky) continue; }
      const cb = c.getBoundingClientRect();
      // A cell that hides its overflow (td.clip) shows its text only inside itself, so that is all a sticky cell can cover.
      const cut = !sticky && style(c).overflowX !== 'visible';
      const cr = sticky ? cb : cut ? { left: Math.max(r.left, cb.left), top: r.top, right: Math.min(r.right, cb.right), bottom: r.bottom } : r;
      cells.push({ what: what(c), text: words(c.textContent).slice(0, 60), row, sticky, box: box(cr.left, cr.top, cr.right, cr.bottom) });
    }
  });
  // Where a tracker's first column starts (T-42).
  const firstCol = document.querySelector('.tracker .board:not(.agent-board) .column');
  const boardTop = firstCol && visible(firstCol) ? Math.round(firstCol.getBoundingClientRect().top + window.scrollY) : null;
  // Each output panel, and any block of raw output in it (T-64).
  const panels = [...document.querySelectorAll('.dock')].map((d) => ({ what: what(d), raw: [...d.querySelectorAll(${JSON.stringify(RAW_OUTPUT)})].map(what) }));
  // Each set of a task's actions (D-168): the next step's box, and each of the rest's.
  const boxOf = (e) => { const r = e.getBoundingClientRect(); return box(r.left, r.top, r.right, r.bottom); };
  const actionSets = [...document.querySelectorAll('[data-action-set]')].filter(visible).map((s) => ({ what: what(s), next: [...s.querySelectorAll(':scope > .ta-btn')].filter(visible).map(boxOf), rest: [...s.querySelectorAll(':scope > .ta-grid > .ta-btn')].filter(visible).map(boxOf) }));
  const measured = { controls: controls.map(({ e, ...c }) => c), texts, tab, doc, scrollers, overview, buttons, said, drawn: [...drawn], boardTop, cells, panels, actionSets, fonts: window.accFontsFirst ?? 0 };
  const write = (parts) => {
    const out = document.createElement('script');
    out.type = 'application/json';
    out.id = 'acc-geometry';
    out.textContent = JSON.stringify({ ...measured, ...parts }).replace(/</g, '\\\\u003c');
    document.body.append(out);
  };
  // The dump is written either way: a part that fails to come (or to serialise) is recorded, not waited for (T-55 review).
  Promise.resolve().then(() => more ? more() : {}).then(write, (e) => write({ a11y: { violations: [], examined: 0, incomplete: [], error: String(e) } }));
}`;
