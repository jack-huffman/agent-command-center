/**
 * The screenshot run's geometry checks (GH-105). Tests can't see a broken layout and a screenshot needs
 * someone to read it, but some breakage is a matter of numbers: two controls drawn over each other, a
 * label cut off, the selected tab scrolled out of the rail, a page that scrolls sideways. Each page,
 * as the screenshot run draws it, measures itself with COLLECT_GEOMETRY and writes what it found into
 * the DOM Chrome dumps; judge() decides, with no browser, so its rules are unit-tested.
 *
 * Each check says how many elements it examined, and one that examined none fails: a page that drew
 * nothing can't pass.
 */

import { COLLECT_WORDS, type GeoSaid, judgeWords, WORK_DATA } from './words.ts';

export const CHECKS = ['overlap', 'clipped', 'tab', 'sideways', 'overview', 'words'] as const;
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
  /** Its sticky or fixed layer, which floats over the page by design, or null in the page's flow. */
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
   * data-overview-group, a line with data-overview-row. Null on any other page.
   */
  overview?: { groups: { what: string; rows: Box[] }[] } | null;
  /** Every string a person can read on the page, for the words check (GH-163, words.ts). */
  said?: GeoSaid[];
  /**
   * Every class on a visible element drawn at least partly inside the window, which is what the shot
   * holds, for the screenshots gate (T-5, looked.ts): a class a branch adds must be drawn in some shot.
   */
  drawn?: string[];
}

/**
 * The Overview is a landing page (GH-160): each line is one line high, no list shows more than five, and
 * each line stands apart from the next. The height is pinned for a line at the page's font size, with its
 * buttons, at every width the run draws.
 */
export const OVERVIEW_LINES = { maxHeight: 44, minGap: 4, maxRows: 5 } as const;

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
 * And no string outside work data names an acc command or path (words.ts, GH-163).
 */
export function judge(s: GeoSnapshot, home: boolean, exceptions = GEOMETRY_EXCEPTIONS): Verdict {
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
  for (const g of lines) {
    if (g.rows.length > OVERVIEW_LINES.maxRows) found.push({ check: 'overview', what: g.what, detail: `shows ${g.rows.length} lines, more than ${OVERVIEW_LINES.maxRows}` });
    const rows = [...g.rows].sort((a, b) => a.y - b.y);
    rows.forEach((r, i) => {
      if (r.h > OVERVIEW_LINES.maxHeight) found.push({ check: 'overview', what: g.what, detail: `line ${i + 1} is ${r.h} px high, more than one line's ${OVERVIEW_LINES.maxHeight}` });
      const next = rows[i + 1];
      if (next && next.y - (r.y + r.h) < OVERVIEW_LINES.minGap) found.push({ check: 'overview', what: g.what, detail: `lines ${i + 1} and ${i + 2} are ${next.y - (r.y + r.h)} px apart, less than ${OVERVIEW_LINES.minGap}` });
    });
  }
  if (s.doc.scroll > s.doc.view + 1) found.push({ check: 'sideways', what: 'the page', detail: `scrolls sideways by ${s.doc.scroll - s.doc.view} px` });
  for (const x of s.scrollers) if (!x.allowed && x.scroll > x.client + 1) found.push({ check: 'sideways', what: x.what, detail: `scrolls sideways by ${x.scroll - x.client} px` });

  // The words a person reads name processes, not acc's commands or paths (GH-163).
  const said = judgeWords(s.said ?? []);
  for (const f of said.findings) found.push({ check: 'words', what: f.what, detail: f.detail });

  const examined: Record<Check, number> = { overlap: cs.length, clipped: s.texts.length, tab: s.tab ? 1 : 0, sideways: 1 + s.scrollers.length, overview: lines.reduce((n, g) => n + g.rows.length, 0), words: said.examined };
  const excused: Record<string, number> = Object.fromEntries(exceptions.map((e) => [e.name, 0]));
  const violations = found.filter((v) => {
    const e = exceptions.find((x) => x.check === v.check && x.what.test(v.what));
    if (e) excused[e.name]!++;
    return !e;
  });
  if (!examined.overlap) violations.push({ check: 'overlap', what: 'the page', detail: 'examined no controls' });
  if (!examined.clipped) violations.push({ check: 'clipped', what: 'the page', detail: 'examined no text' });
  if (home && !examined.tab) violations.push({ check: 'tab', what: 'the page', detail: 'has no selected tab in the rail' });
  if (s.overview && !examined.overview) violations.push({ check: 'overview', what: 'the page', detail: 'is the Overview, and examined no lines on it' });
  if (!examined.words) violations.push({ check: 'words', what: 'the page', detail: 'gathered no words' });
  return { examined, violations, excused, held: said.held };
}

/** One drawing's verdict: its page, theme and width. */
export interface Render { page: string; theme: string; width: number; verdict: Verdict }

/**
 * The least a run of every page, both themes and all three widths examines, per check. Raised as the
 * pages grow, never lowered: a run below one has stopped looking.
 */
export const RUN_FLOOR: Record<Check, number> = { overlap: 13700, clipped: 41700, tab: 288, sideways: 1100, overview: 1200, words: 76400 };

/**
 * What fails a run: each finding, by page, theme, width and check. A whole run (full) also fails below
 * RUN_FLOOR, on an exception that excused nothing, and on a kind of work data no page drew (GH-163).
 */
export function runFailures(renders: Render[], full: boolean, exceptions = GEOMETRY_EXCEPTIONS, floor = RUN_FLOOR, regions = WORK_DATA): string[] {
  const out = renders.flatMap((r) => r.verdict.violations.map((v) => `${r.page} ${r.theme} ${r.width}px: ${v.check}: ${v.what}: ${v.detail}`));
  if (!renders.length) out.push('No page was drawn.');
  if (!full) return out;
  const total = examinedIn(renders);
  for (const c of CHECKS) if (total[c] < floor[c]) out.push(`The run examined ${total[c]} for ${c}, below its floor of ${floor[c]}.`);
  for (const e of exceptions) if (!renders.some((r) => r.verdict.excused[e.name])) out.push(`The exception for ${e.name} excused nothing: take it off GEOMETRY_EXCEPTIONS.`);
  for (const w of regions) if (!renders.some((r) => r.verdict.held?.[w.name])) out.push(`Work data "${w.name}" held no words on any page: draw it in a fixture, or take it off WORK_DATA.`);
  return out;
}

const examinedIn = (renders: Render[]): Record<Check, number> => Object.fromEntries(CHECKS.map((c) => [c, renders.reduce((n, r) => n + r.verdict.examined[c], 0)])) as Record<Check, number>;

/** What a run examined, per check, and how many findings each exception excused. */
export function geometrySummary(renders: Render[]): string {
  const total = examinedIn(renders);
  const excused = GEOMETRY_EXCEPTIONS.map((e) => `${e.name} ${renders.reduce((n, r) => n + (r.verdict.excused[e.name] ?? 0), 0)}`);
  const held = WORK_DATA.map((w) => `${w.name} ${renders.reduce((n, r) => n + (r.verdict.held?.[w.name] ?? 0), 0)}`);
  return `Geometry of ${renders.length} drawings: ${CHECKS.map((c) => `${c} examined ${total[c]}`).join(', ')}.${excused.length ? ` Excused: ${excused.join(', ')}.` : ''} Work data held: ${held.join(', ')}.`;
}

/** The geometry a --dump-dom of a measuring page holds, or null when it never measured. */
export function dumpedGeometry(dom: string): GeoSnapshot | null {
  const m = /<script[^>]*\bid="acc-geometry"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  return m ? (JSON.parse(m[1]!) as GeoSnapshot) : null;
}

/**
 * The page's side: measures itself once its fonts have loaded and two frames have drawn, and writes
 * what it found into a JSON script element, which Chrome's --dump-dom prints. The screenshot run puts it
 * in each page it draws. `<` is escaped in the JSON, so no text from the page can close the element.
 */
export const COLLECT_GEOMETRY = `
function collectGeometry() {
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
  const layerOf = (e) => { for (let p = e; p; p = p.parentElement) { const s = style(p).position; if (s === 'sticky' || s === 'fixed') { if (!layers.has(p)) layers.set(p, layers.size); return layers.get(p); } } return null; };
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
  const sel = document.querySelector('.rail [role=tab][aria-selected="true"]');
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
  // The Overview's lists, and each line's box, as the page marks them (GH-160).
  const home = document.querySelector('.home-main[data-section="overview"]');
  const overview = home ? { groups: [...home.querySelectorAll('[data-overview-group]')].filter(visible).map((g) => ({
    what: g.dataset.overviewGroup,
    rows: [...g.querySelectorAll('[data-overview-row]')].filter((r) => r.closest('[data-overview-group]') === g && visible(r)).map((r) => { const b = r.getBoundingClientRect(); return box(b.left, b.top, b.right, b.bottom); }),
  })) } : null;
  // Every string a person can read, for the words check (GH-163).${COLLECT_WORDS}
  // The classes drawn inside the window, which the shot holds, for the screenshots gate (T-5).
  const drawn = new Set();
  for (const e of document.querySelectorAll('body *')) {
    if (!e.classList.length || !visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
    for (const c of e.classList) drawn.add(c);
  }
  const out = document.createElement('script');
  out.type = 'application/json';
  out.id = 'acc-geometry';
  out.textContent = JSON.stringify({ controls: controls.map(({ e, ...c }) => c), texts, tab, doc, scrollers, overview, said, drawn: [...drawn] }).replace(/</g, '\\\\u003c');
  document.body.append(out);
}`;
