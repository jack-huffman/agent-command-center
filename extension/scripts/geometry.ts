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

export const CHECKS = ['overlap', 'clipped', 'tab', 'sideways'] as const;
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
 * is on screen. Nothing scrolls sideways but SIDEWAYS.
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
  if (s.doc.scroll > s.doc.view + 1) found.push({ check: 'sideways', what: 'the page', detail: `scrolls sideways by ${s.doc.scroll - s.doc.view} px` });
  for (const x of s.scrollers) if (!x.allowed && x.scroll > x.client + 1) found.push({ check: 'sideways', what: x.what, detail: `scrolls sideways by ${x.scroll - x.client} px` });

  const examined: Record<Check, number> = { overlap: cs.length, clipped: s.texts.length, tab: s.tab ? 1 : 0, sideways: 1 + s.scrollers.length };
  const excused: Record<string, number> = Object.fromEntries(exceptions.map((e) => [e.name, 0]));
  const violations = found.filter((v) => {
    const e = exceptions.find((x) => x.check === v.check && x.what.test(v.what));
    if (e) excused[e.name]!++;
    return !e;
  });
  if (!examined.overlap) violations.push({ check: 'overlap', what: 'the page', detail: 'examined no controls' });
  if (!examined.clipped) violations.push({ check: 'clipped', what: 'the page', detail: 'examined no text' });
  if (home && !examined.tab) violations.push({ check: 'tab', what: 'the page', detail: 'has no selected tab in the rail' });
  return { examined, violations, excused };
}

/** One drawing's verdict: its page, theme and width. */
export interface Render { page: string; theme: string; width: number; verdict: Verdict }

/**
 * The least a run of every page, both themes and all three widths examines, per check. Raised as the
 * pages grow, never lowered: a run below one has stopped looking.
 */
export const RUN_FLOOR: Record<Check, number> = { overlap: 8700, clipped: 27000, tab: 216, sideways: 900 };

/**
 * What fails a run: each finding, by page, theme, width and check. A whole run (full) also fails below
 * RUN_FLOOR, and on an exception that excused nothing.
 */
export function runFailures(renders: Render[], full: boolean, exceptions = GEOMETRY_EXCEPTIONS, floor = RUN_FLOOR): string[] {
  const out = renders.flatMap((r) => r.verdict.violations.map((v) => `${r.page} ${r.theme} ${r.width}px: ${v.check}: ${v.what}: ${v.detail}`));
  if (!renders.length) out.push('No page was drawn.');
  if (!full) return out;
  const total = examinedIn(renders);
  for (const c of CHECKS) if (total[c] < floor[c]) out.push(`The run examined ${total[c]} for ${c}, below its floor of ${floor[c]}.`);
  for (const e of exceptions) if (!renders.some((r) => r.verdict.excused[e.name])) out.push(`The exception for ${e.name} excused nothing: take it off GEOMETRY_EXCEPTIONS.`);
  return out;
}

const examinedIn = (renders: Render[]): Record<Check, number> => Object.fromEntries(CHECKS.map((c) => [c, renders.reduce((n, r) => n + r.verdict.examined[c], 0)])) as Record<Check, number>;

/** What a run examined, per check, and how many findings each exception excused. */
export function geometrySummary(renders: Render[]): string {
  const total = examinedIn(renders);
  const excused = GEOMETRY_EXCEPTIONS.map((e) => `${e.name} ${renders.reduce((n, r) => n + (r.verdict.excused[e.name] ?? 0), 0)}`);
  return `Geometry of ${renders.length} drawings: ${CHECKS.map((c) => `${c} examined ${total[c]}`).join(', ')}.${excused.length ? ` Excused: ${excused.join(', ')}.` : ''}`;
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
  const out = document.createElement('script');
  out.type = 'application/json';
  out.id = 'acc-geometry';
  out.textContent = JSON.stringify({ controls: controls.map(({ e, ...c }) => c), texts, tab, doc, scrollers }).replace(/</g, '\\\\u003c');
  document.body.append(out);
}`;
