/**
 * What keeps the screenshot run's verdict about layout, not about a busy machine (GH-167). While builders
 * run their checks, Chrome can take longer than usual to draw a page, and the rail's selected tab can still
 * move when the page measures itself: a later state message draws the rail again, at scrollLeft 0 until its
 * next frame's showSelected, and fonts arriving late shift it. A drawing that times out is drawn once more, and
 * the run says which; the page measures once the selected tab has stopped moving.
 */

/** How long one drawing may take unless ACC_SHOT_TIMEOUT says otherwise, in seconds. */
export const DEFAULT_SHOT_TIMEOUT = 60;

/** How long one drawing may take, in milliseconds: ACC_SHOT_TIMEOUT's whole seconds if it's 1 or more, else DEFAULT_SHOT_TIMEOUT. */
export function shotTimeout(env: NodeJS.ProcessEnv = process.env): number {
  const s = Math.floor(Number(env.ACC_SHOT_TIMEOUT));
  return (s >= 1 ? s : DEFAULT_SHOT_TIMEOUT) * 1000;
}

/** A drawing's outcome, as spawnSync gives it: an error when Chrome couldn't be run or didn't finish in time. */
export interface Drawn { error?: Error }

const timedOut = (r: Drawn): boolean => (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';

/**
 * Runs one drawing, and once more if it timed out, adding what it drew to retried and saying so. Any
 * other error, or a second timeout, is returned as it came, for the run to fail on.
 */
export function drawRetrying<T extends Drawn>(draw: () => T, what: string, retried: string[], say: (line: string) => void = console.log): T {
  const first = draw();
  if (!timedOut(first)) return first;
  retried.push(what);
  say(`Chrome didn't finish ${what} in ${shotTimeout() / 1000} s, so it's drawn once more.`);
  return draw();
}

/** drawRetrying for a drawing that runs without blocking (T-58): drawn again in its own job when it timed out. */
export async function drawRetried<T extends Drawn>(draw: () => Promise<T>, what: string, retried: string[], say: (line: string) => void = console.log): Promise<T> {
  const first = await draw();
  if (!timedOut(first)) return first;
  retried.push(what);
  say(`Chrome didn't finish ${what} in ${shotTimeout() / 1000} s, so it's drawn once more.`);
  return draw();
}

/** The summary's words for the drawings drawn twice: how many, and which. Empty when none were. */
export const retriedSummary = (retried: string[]): string => (retried.length ? ` Retried ${retried.length} drawing${retried.length === 1 ? '' : 's'} that timed out: ${retried.join('; ')}.` : ' Retried no drawings.');

/**
 * The page's side (T-21): loads every font its stylesheets name, then calls then. The page waits on it
 * before it's sent its model, so the rail first draws with the icon font in place. The icon font loads only
 * once a glyph needs it: drawn first, the rail scrolled its selected tab into view at the fallback font's
 * widths, the font then widened every tab, and the tab sat past the strip's edge on a busy machine, where
 * the font came late. Its count is kept in accFontsFirst, which the geometry carries: none means nothing waited.
 * A font that fails to load leaves then uncalled, so the page measures nothing and the run fails it as measuring no geometry.
 * Its error is kept in accFontsFailed for a person looking at the page; the run doesn't report it.
 */
export const FONTS_FIRST = `
function fontsFirst(fonts, then) {
  const faces = [...fonts];
  Promise.all(faces.map((f) => f.load())).then(() => { window.accFontsFirst = faces.length; then(); }, (e) => { window.accFontsFailed = String(e); });
}`;

/** Why a drawing's measure can't be trusted when its page loaded no fonts before its model (T-21), else null. */
export const fontsUnwaited = (what: string, fonts: number | undefined): string | null => (fonts ? null : `${what} loaded no fonts before its model, so a font that comes late could move what it measured.`);

/** Frames in a row the selected tab must hold still before the page is measured. */
export const SETTLE_FRAMES = 3;
/** Frames to wait at most: a tab still moving then is measured where it is, so a real misplacement still fails. */
export const SETTLE_LIMIT = 60;

/** The rail's selected tab, as the settle waits on it and the geometry check judges it: one selector for both. */
export const SELECTED_TAB = '.rail [role=tab][aria-selected="true"]';

/**
 * The page's side: calls done once read() has given the same answer SETTLE_FRAMES frames in a row, or
 * after SETTLE_LIMIT frames. read() says where the rail's selected tab is, or '' where there's none.
 */
export const SETTLE = `
function settle(read, frame, done) {
  let last = read(), still = 0, frames = 0;
  const step = () => {
    const now = read();
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= ${SETTLE_FRAMES} || ++frames >= ${SETTLE_LIMIT}) done();
    else frame(step);
  };
  frame(step);
}
function selectedTab() {
  const sel = document.querySelector('${SELECTED_TAB}');
  if (!sel) return '';
  const t = sel.getBoundingClientRect();
  return [t.left, t.top, t.right, t.bottom, sel.closest('.rail').scrollLeft].join(',');
}`;
