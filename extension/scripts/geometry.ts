/**
 * The screenshot run's geometry checks (GH-105). Tests can't see a broken layout and a screenshot needs
 * someone to read it, but some breakage is a matter of numbers: two controls drawn over each other, a
 * label cut off, the selected tab scrolled out of the rail, a page that scrolls sideways. Each page,
 * as the screenshot run draws it, measures itself with COLLECT_GEOMETRY and writes what it found into
 * the DOM Chrome dumps; judge() decides, with no browser, so its rules are unit-tested.
 *
 * Each check says how many elements it examined. A page fails when its clipped or words check examined
 * none, or its overlap, tab or overview check where the page has what that check reads; a whole run fails
 * when a check's total is below runFloor(). So a page that drew nothing can't pass.
 */

import { COLLECT_WORDS, type GeoSaid, judgeWords, WORK_DATA } from './words.ts';
import { SELECTED_TAB } from './steady.ts';
import { A11Y_EXCEPTIONS, type GeoA11y, incompleteSummary, judgeA11y } from './a11y.ts';
import { join } from 'node:path';
import { FLOORS_FILE, type Floors, readFloors, valueOf } from '../../packages/core/src/ratchets.ts';
import { PAGES, type Page, STILL, viewOf, WIDTHS } from './pages.ts';
import { PALETTE_THEMES } from './styles.ts';

export const CHECKS = ['overlap', 'clipped', 'tab', 'sideways', 'overview', 'buttons', 'words', 'covered', 'raw', 'a11y', 'actions', 'disabled', 'sizes'] as const;
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
  /** Its sticky or fixed layer, or the open menu it is in, such as a card's ⋯ (D-168) or the board switch's list with its box to find a board (T-127, a .more-menu), or a Connect modal dropdown's list (T-140, a .cdrop-pop), which floats over the page by design; null in the page's flow. */
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
  /** Each disabled button drawn (T-121): the disabled check fails on one drawn as clear as an enabled button. */
  disabled?: GeoDisabled[];
  /** Each text button drawn, with the container it sits in (T-144): the sizes check fails two side by side that differ in size. */
  sized?: GeoSized[];
  /**
   * The chat (T-160): its scrolling box, and each layer kept over it or under it, the person's pinned message and
   * the foot with the message card, with whether its background hides what scrolls under it. Null with no chat.
   */
  chat?: GeoChat | null;
  /** The task page's tab whose panel was on show when it was measured (T-134), or null on a page with none. */
  panel?: string | null;
  /**
   * A later measure of a task page, of another tab's panel (T-134): it holds only what is inside that panel, and
   * the page itself isn't counted again for sideways, so what's outside the tabs counts once per drawing.
   */
  scoped?: boolean;
}

/** A task's actions as drawn: the next step, full width, and the rest in the grid under it. */
export interface GeoActionSet { what: string; next: Box[]; rest: Box[] }

/** A disabled button as drawn (T-121): its computed opacity and cursor, which an enabled one doesn't have. */
export interface GeoDisabled { what: string; text: string; opacity: number; cursor: string; why: boolean }

/**
 * A text button as drawn (T-144): its box, its font size, the element it sits in (parent) and the one around that (up),
 * each numbered per drawing. Icon-only buttons, menu carets and the status button are not text buttons and are not collected.
 */
export interface GeoSized { what: string; text: string; parent: number; up: number; box: Box; font: number }

/** How far apart, across, two buttons may sit and still be one row (T-144), and how much their heights may differ. */
export const SAME_ROW = { gap: 16, heightDiff: 1, fontDiff: 0.5 } as const;

/**
 * The findings for text buttons side by side (T-144): two in one wrapper (the same parent, or one's parent the other's grandparent: the conversation line inside the
 * plan's actions) whose boxes overlap vertically and
 * sit within SAME_ROW.gap of each other must be as high as each other and have one font size, so a primary
 * differs from a secondary in colour, never in size. Returns each finding, and how many pairs it compared.
 */
export function judgeSizes(drawn: GeoSized[]): { found: { what: string; detail: string }[]; compared: number } {
  const found: { what: string; detail: string }[] = [];
  let compared = 0;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i]!;
      const b = drawn[j]!;
      if (a.parent !== b.parent && a.parent !== b.up && a.up !== b.parent) continue;
      const rows = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y) > 1;
      const across = Math.max(a.box.x, b.box.x) - Math.min(a.box.x + a.box.w, b.box.x + b.box.w);
      if (!rows || across > SAME_ROW.gap) continue;
      compared++;
      const high = Math.abs(a.box.h - b.box.h) > SAME_ROW.heightDiff;
      const font = Math.abs(a.font - b.font) > SAME_ROW.fontDiff;
      if (high || font) found.push({ what: a.what, detail: `${quote(a.text).trim() || 'it'} (${a.box.h} px high, ${a.font} px type) sits beside ${b.what}${quote(b.text)} (${b.box.h} px high, ${b.font} px type): buttons in one row are one size` });
    }
  }
  return { found, compared };
}

/** Disabled buttons whose reason is in the text beside them, not in a title (T-121): a button's words, and why each is named. */
export const REASON_BESIDE: Record<string, string> = {};

/** The most opacity a disabled button is drawn with, and the cursor it shows: the shared rule in styles.css (T-121). */
export const DISABLED_LOOK = { maxOpacity: 0.7, cursor: 'not-allowed' } as const;

/** A chat as drawn (T-160): the box that scrolls, and its pinned messages and foot. */
export interface GeoChat { log: Box; layers: { what: string; kind: 'pin' | 'foot'; box: Box; opaque: boolean }[] }

/** The most of the chat's height a pinned message may take (T-160), so the reply under it still has room to read. */
export const PIN_MAX_SHARE = 0.5;

/**
 * The findings for a chat (T-160): the chat scrolls under its pinned message, never behind it, so a pin is opaque
 * and takes at most PIN_MAX_SHARE of the chat; and it stops above its foot, so the message card lies over none of it.
 */
export function judgeChat(chat: GeoChat | null | undefined): { what: string; detail: string }[] {
  const out: { what: string; detail: string }[] = [];
  if (!chat) return out;
  for (const l of chat.layers) {
    if (l.kind === 'pin' && !l.opaque) out.push({ what: l.what, detail: 'the pinned message lets the chat show through it' });
    if (l.kind === 'pin' && l.box.h > chat.log.h * PIN_MAX_SHARE) out.push({ what: l.what, detail: `the pinned message is ${l.box.h} px high, more than ${Math.round(PIN_MAX_SHARE * 100)}% of the chat's ${chat.log.h} px` });
    if (l.kind === 'foot' && overlaps(l.box, chat.log)) out.push({ what: l.what, detail: 'the message card lies over the chat' });
  }
  return out;
}

/** The findings for the disabled buttons a page drew: each must be drawn dimmer than an enabled one, with the not-allowed cursor (T-121). */
export function judgeDisabled(drawn: GeoDisabled[]): { what: string; detail: string }[] {
  const out: { what: string; detail: string }[] = [];
  for (const d of drawn) {
    if (d.opacity > DISABLED_LOOK.maxOpacity) out.push({ what: d.what, detail: `${quote(d.text).trim() || 'it'} is disabled and drawn at opacity ${d.opacity}, as clear as an enabled button` });
    if (d.cursor !== DISABLED_LOOK.cursor) out.push({ what: d.what, detail: `${quote(d.text).trim() || 'it'} is disabled and shows the ${d.cursor} cursor, not ${DISABLED_LOOK.cursor}` });
    if (!d.why && !Object.hasOwn(REASON_BESIDE, d.text)) out.push({ what: d.what, detail: `${quote(d.text).trim() || 'it'} is disabled and gives no reason: no title or aria-description, and it isn't in REASON_BESIDE` });
  }
  return out;
}

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

/** The elements that scroll sideways by design: a board's lanes, a wide table, the rail's strip, code, and the Connect modal's board (T-140). */
export const SIDEWAYS = ['.board', '.table-wrap', '.rail', '.doc pre', '.table-scroll', '.cpreview-cols'];

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
 * A task page's tab panel that has no controls by design, measured on its own (T-134): the tab, and a class only that
 * empty panel draws, so the same tab with its controls is judged as any other. Each with why.
 */
export const PANELS_WITHOUT_CONTROLS: readonly { panel: string; drawn: string; reason: string }[] = [
  { panel: 'testing', drawn: 'test-empty', reason: 'Before its builder\'s deploy passed, the Testing tab only says why it is empty (T-161): there is nothing to open yet.' },
];

/** Whether a measure is of a tab panel that PANELS_WITHOUT_CONTROLS names, drawn empty. */
export const emptyByDesign = (s: Pick<GeoSnapshot, 'scoped' | 'panel' | 'drawn'>): boolean =>
  !!s.scoped && PANELS_WITHOUT_CONTROLS.some((p) => p.panel === s.panel && !!s.drawn?.includes(p.drawn));

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
  // The chat scrolls under its pinned message and stops above its card, never behind either (T-160).
  const chatLayers = s.chat?.layers.length ?? 0;
  for (const f of judgeChat(s.chat)) found.push({ check: 'covered', what: f.what, detail: f.detail });
  // The output panel shows a run as rows, never as a block of raw lines (T-64).
  const panels = s.panels ?? [];
  for (const p of panels) for (const r of p.raw) found.push({ check: 'raw', what: r, detail: 'the output panel shows a block of raw output, not rows' });
  const buttons = s.buttons ?? [];
  for (const f of judgeButtons(buttons, expected)) found.push({ check: 'buttons', what: 'the Overview', detail: f });
  const actionSets = s.actionSets ?? [];
  const sizes = judgeSizes(s.sized ?? []);
  for (const f of sizes.found) found.push({ check: 'sizes', what: f.what, detail: f.detail });
  const disabled = s.disabled ?? [];
  for (const f of judgeDisabled(disabled)) found.push({ check: 'disabled', what: f.what, detail: f.detail });
  for (const f of judgeActions(actionSets)) found.push({ check: 'actions', what: f.what, detail: f.detail });
  if (s.doc.scroll > s.doc.view + 1) found.push({ check: 'sideways', what: 'the page', detail: `scrolls sideways by ${s.doc.scroll - s.doc.view} px` });
  for (const x of s.scrollers) if (!x.allowed && x.scroll > x.client + 1) found.push({ check: 'sideways', what: x.what, detail: `scrolls sideways by ${x.scroll - x.client} px` });

  // The words a person reads name processes, not acc's commands or paths (GH-163).
  const said = judgeWords(s.said ?? []);
  for (const f of said.findings) found.push({ check: 'words', what: f.what, detail: f.detail });

  const a11y = judgeA11y(s.a11y, a11yExceptions);
  const examined: Record<Check, number> = { overlap: cs.length, clipped: s.texts.length, tab: s.tab ? 1 : 0, sideways: (s.scoped ? 0 : 1) + s.scrollers.length, overview: lines.reduce((n, g) => n + g.rows.length, 0) + cards.length, buttons: buttons.length, words: said.examined, covered: plain.length + chatLayers, raw: panels.length, a11y: a11y.examined, actions: actionSets.reduce((n, x) => n + x.next.length + x.rest.length, 0), disabled: disabled.length, sizes: sizes.compared };
  const excused: Record<string, number> = Object.fromEntries(exceptions.map((e) => [e.name, 0]));
  const violations = found.filter((v) => {
    const e = exceptions.find((x) => x.check === v.check && x.what.test(v.what));
    if (e) excused[e.name]!++;
    return !e;
  });
  // A page with no controls by design, such as the loading screen (T-16), is judged without them.
  // So is a tab panel PANELS_WITHOUT_CONTROLS names, drawn empty (T-161).
  if (controls && !examined.overlap && !emptyByDesign(s)) violations.push({ check: 'overlap', what: 'the page', detail: 'examined no controls' });
  if (!examined.clipped) violations.push({ check: 'clipped', what: 'the page', detail: 'examined no text' });
  // A later measure of a task modal's tab panel (T-134) holds only the panel, not the rail the first measure checked.
  if (home && !s.scoped && !examined.tab) violations.push({ check: 'tab', what: 'the page', detail: 'has no selected tab in the rail' });
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

/** The checks whose floor follows the pages (T-102), worked out from them, never set by hand. */
export const PAGE_CHECKS = ['overlap', 'tab', 'words'] as const;
/** The least each drawing examines for overlap (controls) and words (strings, GH-163). */
export const PER_DRAWING = { overlap: 30, words: 100 } as const;
/** How many drawings a page makes in a whole run: each theme at each width. */
export const DRAWINGS = PALETTE_THEMES.length * WIDTHS.length;

/**
 * The floors that follow the pages: 30 controls and 100 strings a drawing, and the selected tab on every
 * drawing of a page with a rail, which the loading screen has not (T-16). A new page raises them itself.
 */
export function pageFloors(pages: readonly Page[] = PAGES): Record<(typeof PAGE_CHECKS)[number], number> {
  const renders = pages.length * DRAWINGS;
  return { overlap: PER_DRAWING.overlap * renders, words: PER_DRAWING.words * renders, tab: pages.filter((p) => viewOf(p) === 'home' && !STILL.includes(p)).length * DRAWINGS };
}

/** Where the floors file keeps the floor of a check that doesn't follow the pages: `screenshots.a11y`. */
export const floorName = (c: Check): string => `screenshots.${c}`;
/**
 * The CI run's own floor of a check (T-108), beside the Mac's: `screenshots.ci.a11y`. GitHub's Linux runner
 * draws with other fonts, so a count can differ from the Mac's; where one can't match, a person adds its CI
 * floor, and only a clean CI run raises it. The Mac's run never reads or raises one.
 */
export const ciFloorName = (c: Check): string => `screenshots.ci.${c}`;
/** What the CI workflow sets for a run held to the CI floors, where it has them (T-108). */
export const CI_FLOORS_ENV = 'ACC_CI_FLOORS';
export const isCiRun = (env: NodeJS.ProcessEnv = process.env): boolean => env[CI_FLOORS_ENV] === '1';
/** The project's floors file, which the run reads and raises. */
export const FLOORS_PATH = join(import.meta.dirname, '..', '..', FLOORS_FILE);

/**
 * The floor of a check the floors file has no entry for yet (T-144): a new check starts at one row compared, so
 * a run that compared none fails, and the first clean run's raisedFloors writes its entry. It is read only
 * while there is no entry; once the file has one, the file's floor, which only goes up, is the floor.
 */
export const SEED_FLOORS: Partial<Record<Check, number>> = { sizes: 1 };

/**
 * The least a run of every page, both themes and all three widths examines, per check. The page checks'
 * floors are pageFloors; each other check's is its floor in the floors file, which only goes up: a run
 * below one has stopped looking. A check with no floor there is an error, never a floor of nothing.
 */
export function runFloor(floors: Floors = readFloors(FLOORS_PATH), pages: readonly Page[] = PAGES, ci = isCiRun()): Record<Check, number> {
  const derived: Partial<Record<Check, number>> = pageFloors(pages);
  return Object.fromEntries(CHECKS.map((c) => {
    if (derived[c] !== undefined) return [c, derived[c]];
    // A CI run is held to its own floor where it has one, else to the Mac's (T-108).
    const v = (ci ? valueOf(floors[ciFloorName(c)], 'floor') : null) ?? valueOf(floors[floorName(c)], 'floor') ?? SEED_FLOORS[c] ?? null;
    if (v === null) throw new Error(`${FLOORS_FILE} has no floor for the screenshot run's ${c} check ("${floorName(c)}").`);
    return [c, v];
  })) as Record<Check, number>;
}

/**
 * How far below a clean run's count a raised floor is stored, in hundredths (T-108): counts vary by a few
 * between runs of one commit, so a floor at one run's exact count fails the next. A page that loses real
 * content still falls more than this below it.
 */
export const FLOOR_MARGIN_PERCENT = 1;
/** The floor a clean run's count stores: about 1% below it, rounded down (T-108). */
export const storedFloor = (examined: number): number => Math.floor((examined * (100 - FLOOR_MARGIN_PERCENT)) / 100);

/**
 * The floors file with each stored check raised to storedFloor() of what a clean whole run examined, where
 * that beats it: only ever up, as the tests ratchet's is (GH-99). Null when none rose. Merged by the floors
 * driver (T-102). A CI run raises only the CI floors it has, never the Mac's, nor makes one (T-108).
 */
export function raisedFloors(floors: Floors, examined: Record<Check, number>, ci = isCiRun()): Floors | null {
  const out: Floors = { ...floors };
  let raised = false;
  for (const c of CHECKS) {
    if ((PAGE_CHECKS as readonly Check[]).includes(c)) continue;
    const name = ci ? ciFloorName(c) : floorName(c);
    const v = valueOf(floors[name], 'floor');
    const next = storedFloor(examined[c]);
    // A check with no entry yet starts at its seed, and the clean Mac run that beats it writes the entry; a CI run makes no CI floor of its own (T-144, T-108).
    const at = v ?? (ci ? null : SEED_FLOORS[c] ?? null);
    if (at !== null && next > at) [out[name], raised] = [{ floor: next }, true];
  }
  return raised ? out : null;
}

/**
 * What fails a run: each finding, by page, theme, width and check. A whole run (full) also fails below
 * runFloor() (read only then), on an exception that excused nothing, in GEOMETRY_EXCEPTIONS or
 * A11Y_EXCEPTIONS (T-55), and on
 * a kind of work data no page drew (GH-163).
 */
export function runFailures(renders: Render[], full: boolean, exceptions = GEOMETRY_EXCEPTIONS, floor?: Record<Check, number>, regions = WORK_DATA, a11yExceptions = A11Y_EXCEPTIONS): string[] {
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
  const least = floor ?? runFloor();
  for (const c of CHECKS) if (total[c] < least[c]) out.push(`The run examined ${total[c]} for ${c}, below its floor of ${least[c]}.`);
  for (const e of exceptions) if (!renders.some((r) => r.verdict.excused[e.name])) out.push(`The exception for ${e.name} excused nothing: take it off GEOMETRY_EXCEPTIONS.`);
  for (const e of a11yExceptions) if (!renders.some((r) => r.verdict.excused[e.name])) out.push(`The exception for ${e.name} excused nothing: take it off A11Y_EXCEPTIONS.`);
  for (const w of regions) if (!renders.some((r) => r.verdict.held?.[w.name])) out.push(`Work data "${w.name}" held no words on any page: draw it in a fixture, or take it off WORK_DATA.`);
  return out;
}

/** What a run examined, per check, over every drawing. */
export const examinedIn = (renders: Render[]): Record<Check, number> => Object.fromEntries(CHECKS.map((c) => [c, renders.reduce((n, r) => n + r.verdict.examined[c], 0)])) as Record<Check, number>;

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
 * Every measure a --dump-dom holds, in the order taken (T-134): the page as drawn, then each other tab's panel
 * of a task page that MEASURE_TABS showed in turn. Empty when the page never measured.
 */
export function dumpedGeometries(dom: string): GeoSnapshot[] {
  return [...dom.matchAll(/<script[^>]*\bid="acc-geometry(?:-\d+)?"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as GeoSnapshot);
}

/**
 * The classes a drawing's shot holds, for the screenshots gate (T-5): the first measure's only, as it is the page
 * the PNG shows (T-134). A tab MEASURE_TABS showed for a moment, then hid, isn't in the shot.
 */
export const drawnIn = (shots: readonly GeoSnapshot[]): string[] => [...new Set(shots[0]?.drawn ?? [])].sort();

/**
 * One drawing's verdict from each measure of it (T-134): what each examined, added up, and every finding, each
 * after the first naming the tab its panel was measured in. The first measure is the page as drawn, so its
 * board's top stands. Each later one holds only its tab's panel (scoped), so nothing is counted twice.
 */
export function mergedVerdict(measures: { panel?: string | null; verdict: Verdict }[]): Verdict {
  const [first, ...rest] = measures;
  if (!first) throw new Error('A drawing has no measure to judge.');
  const add = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  return rest.reduce<Verdict>((v, m) => ({
    examined: add(v.examined, m.verdict.examined) as Record<Check, number>,
    violations: [...v.violations, ...m.verdict.violations.map((x) => ({ ...x, what: `the ${m.panel ?? 'other'} tab: ${x.what}` }))],
    excused: add(v.excused, m.verdict.excused),
    held: add(v.held, m.verdict.held),
    boardTop: v.boardTop,
    incomplete: add(v.incomplete, m.verdict.incomplete),
  }), first.verdict);
}

/**
 * The page's side, after it's measured as drawn (T-134): a task page shows only one tab's panel, so each other
 * tab is shown in turn and measured, two frames after it's drawn, and then the tab and scroll that were on show
 * come back, as the shot draws the page as it opened. measure(panel, then) measures inside the tab's panel once and
 * calls then.
 */
export const MEASURE_TABS = `
function measureTabs(measure) {
  const tabs = [...document.querySelectorAll('.task-tabs > [role="tab"]')];
  const was = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
  const rest = tabs.filter((t) => t !== was);
  const kept = [document.scrollingElement, ...document.querySelectorAll('*')].filter((e) => e && (e.scrollTop || e.scrollLeft)).map((e) => [e, e.scrollTop, e.scrollLeft]);
  const step = () => {
    const t = rest.shift();
    if (!t) {
      was?.click();
      for (const [e, top, left] of kept) { e.scrollTop = top; e.scrollLeft = left; }
      return;
    }
    t.click();
    requestAnimationFrame(() => requestAnimationFrame(() => measure(document.getElementById(t.getAttribute('aria-controls')), step)));
  };
  step();
}`;

/**
 * The page's side: measures itself when called, which pageFor does once its fonts have loaded, two frames
 * have drawn and the selected tab has settled, and writes
 * what it found into a JSON script element, which Chrome's --dump-dom prints. The screenshot run puts it
 * in each page it draws. `<` is escaped in the JSON, so no text from the page can close the element.
 * more, if given, is called once the page is measured, and resolves to more parts of the dump, such as
 * the a11y part (T-55): the element is written once it has.
 */
export const COLLECT_GEOMETRY = `
function collectGeometry(more, then, within) {
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
  const layerOf = (e) => { for (let p = e; p; p = p.parentElement) { const s = style(p).position; if (s === 'sticky' || s === 'fixed' || p.getAttribute('role') === 'menu' || p.classList.contains('more-menu') || p.classList.contains('cdrop-pop')) { if (!layers.has(p)) layers.set(p, layers.size); return layers.get(p); } } return null; };
  const visible = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  // A later measure, of another tab's panel (T-134), looks only inside that panel: what's outside it (the
  // notices, the side column, the header, the rail) was measured as drawn, so it's counted once per drawing.
  const scope = within || document;
  const root = within || document.body;
  const all = within ? [within, ...within.querySelectorAll('*')] : [...document.querySelectorAll('body *')];

  const found = [...scope.querySelectorAll('button, a[href], a.ext, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]')].filter(visible);
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
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
  const sel = within ? null : document.querySelector('${SELECTED_TAB}');
  let tab = null;
  if (sel) {
    const t = sel.getBoundingClientRect();
    const rr = sel.closest('.rail').getBoundingClientRect();
    tab = { what: what(sel), box: box(t.left, t.top, t.right, t.bottom), rail: box(Math.max(rr.left, 0), Math.max(rr.top, 0), Math.min(rr.right, vw), Math.min(rr.bottom, vh)) };
  }
  const scrollers = [];
  for (const e of all) {
    if (!scrolls(style(e).overflowX)) continue;
    scrollers.push({ what: what(e), scroll: e.scrollWidth, client: e.clientWidth, allowed: SIDEWAYS.some((s) => e.matches(s)) });
  }
  const doc = { scroll: document.documentElement.scrollWidth, view: vw };
  // The Overview's lists, and each line's box, as the page marks them (GH-160), with the list a detail open
  // over it shows (T-36), and each list's card.
  const home = within ? null : document.querySelector('.home-main[data-section="overview"]');
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
  for (const e of all) {
    if (!e.classList.length || !visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
    for (const c of e.classList) drawn.add(c);
  }
  // The text of each cell in a row with a sticky cell, at the first scroll position (T-46).
  const cells = [];
  [...scope.querySelectorAll('tr')].forEach((tr, row) => {
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
  const firstCol = within ? null : document.querySelector('.tracker .board:not(.agent-board) .column');
  const boardTop = firstCol && visible(firstCol) ? Math.round(firstCol.getBoundingClientRect().top + window.scrollY) : null;
  // Each output panel, and any block of raw output in it (T-64).
  const panels = [...scope.querySelectorAll('.dock')].map((d) => ({ what: what(d), raw: [...d.querySelectorAll(${JSON.stringify(RAW_OUTPUT)})].map(what) }));
  // Each set of a task's actions (D-168): the next step's box, and each of the rest's.
  const boxOf = (e) => { const r = e.getBoundingClientRect(); return box(r.left, r.top, r.right, r.bottom); };
  // The chat (T-160): its scrolling box, its pinned messages and its foot, with whether each one's background hides what's under it.
  const alpha = (c) => { if (c === 'transparent') return 0; const m = c.match(/\\/\\s*([\\d.]+)%?\\s*\\)$/) || c.match(/^rgba\\([^)]*,\\s*([\\d.]+)\\)$/); return m ? Number(m[1]) : 1; };
  const logEl = within ? null : document.querySelector('.chat-log');
  const chat = logEl && visible(logEl) ? { log: boxOf(logEl), layers: [...document.querySelectorAll('.chat-pin, .chat-foot')].filter(visible).map((e) => ({ what: what(e), kind: e.classList.contains('chat-pin') ? 'pin' : 'foot', box: boxOf(e), opaque: alpha(style(e).backgroundColor) >= 1 })) } : null;
  const actionSets = [...scope.querySelectorAll('[data-action-set]')].filter(visible).map((s) => ({ what: what(s), next: [...s.querySelectorAll(':scope > .ta-btn')].filter(visible).map(boxOf), rest: [...s.querySelectorAll(':scope > .ta-grid > .ta-btn')].filter(visible).map(boxOf) }));
  // Each disabled button, as drawn (T-121): a .btn that is disabled, or kept focusable with .is-disabled.
  const disabled = [...scope.querySelectorAll('.btn:disabled, .btn.is-disabled')].filter(visible).map((b) => ({ what: what(b), text: words(b.getAttribute('aria-label') || b.textContent).slice(0, 60), opacity: Number(style(b).opacity), cursor: style(b).cursor, why: !!(b.getAttribute('title') || b.getAttribute('aria-description')) }));
  // Each text button, and the element it sits in and the one around that (T-144): a row runs across one wrapper, such as the conversation line inside the plan's actions, but not across a dialog laid over the page.
  const parents = new Map();
  const sized = [...scope.querySelectorAll('.btn:not(.icon-only):not(.menu-caret):not(.status-btn)')].filter(visible).map((b) => {
    const r = b.getBoundingClientRect();
    const up = b.parentElement?.parentElement;
    for (const x of [b.parentElement, up]) if (!parents.has(x)) parents.set(x, parents.size);
    return { what: what(b), text: words(b.getAttribute('aria-label') || b.textContent).slice(0, 60), parent: parents.get(b.parentElement), up: parents.get(up), box: box(r.left, r.top, r.right, r.bottom), font: Math.round(parseFloat(style(b).fontSize) * 10) / 10 };
  }).filter((b) => b.box.w >= 1 && b.box.h >= 1);
  const measured = { sized, controls: controls.map(({ e, ...c }) => c), texts, tab, doc, scrollers, overview, buttons, said, drawn: [...drawn], boardTop, cells, panels, actionSets, disabled, chat, fonts: window.accFontsFirst ?? 0, panel: document.querySelector('.task-tabs > [role="tab"][aria-selected="true"]')?.dataset.tab ?? null, scoped: !!within };
  // The first measure is acc-geometry; a later one, of another tab's panel (T-134), is numbered after it. then, if given, runs once it's written.
  const write = (parts) => {
    const out = document.createElement('script');
    out.type = 'application/json';
    const n = document.querySelectorAll('script[id^="acc-geometry"]').length;
    out.id = n ? 'acc-geometry-' + n : 'acc-geometry';
    out.textContent = JSON.stringify({ ...measured, ...parts }).replace(/</g, '\\\\u003c');
    document.body.append(out);
    if (then) then();
  };
  // The dump is written either way: a part that fails to come (or to serialise) is recorded, not waited for (T-55 review).
  Promise.resolve().then(() => more ? more() : {}).then(write, (e) => write({ a11y: { violations: [], examined: 0, incomplete: [], error: String(e) } }));
}`;
