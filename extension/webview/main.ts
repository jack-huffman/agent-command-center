// Renders one editor tab. Every element is built with DOM calls and every string is set as text,
// so nothing from a ticket, branch or session can become markup. No HTML string is ever parsed.
//
// This is the entry: it draws what the extension sends and keeps the page's scroll. Each section, tab and
// message from the extension belongs to the area that registers it (D-099), gathered in areas.ts, which
// npm run build writes.

import type { HomeSection } from '../src/model/shared.ts';
import type { HomeModel, Model } from '../src/model/home.ts';
import { AREAS } from './areas.ts';
import { boardEdges, dragAutoScroll, wheelSideways } from './boards.ts';
import { renderDock, stickToBottom } from './dock.ts';
import { el, keepFocus } from './dom.ts';
import { renderNav } from './rail.ts';
import { api, app, memory, type PageArea, remember, setSection, state, view } from './state.ts';

type Section = NonNullable<PageArea['sections']>[HomeSection] & {};
type Draw = (m: never) => Node[];

/** Each area's sections, tabs and messages from the extension, by name. No two areas may claim one. */
const SECTIONS = new Map<string, Section>();
const VIEWS = new Map<string, Draw>();
const RECEIVE = new Map<string, (msg: never) => void>();
const claim = <T>(map: Map<string, T>, what: string, entries: [string, T | undefined][]): void => {
  for (const [name, it] of entries) {
    if (!it) continue;
    if (map.has(name)) throw new Error(`Two areas draw the ${what} ${name}.`);
    map.set(name, it);
  }
};
for (const a of AREAS) {
  claim(SECTIONS, 'section', Object.entries(a.sections ?? {}));
  claim(VIEWS, 'tab', Object.entries(a.views ?? {}) as [string, Draw | undefined][]);
  claim(RECEIVE, 'message', Object.entries(a.receive ?? {}));
}
/** Whatever no area claims is drawn as Setup always drew it. */
const FALLBACK = AREAS.find((a) => a.fallback);

// ---------------------------------------------------------------- the Command Center page (D-029)

function renderHome(m: HomeModel): Node[] {
  const current = state.section ?? m.section;
  // An area may draw over the section, as the Connect page does while it's open.
  const covers = AREAS.map((a) => a.cover?.(m) ?? null);
  const section = SECTIONS.get(current) ?? Object.values(FALLBACK?.sections ?? {})[0];
  const content = covers.find((c) => c !== null) ?? section!.draw(m);
  const main = el('div', 'home-main', ...content);
  main.tabIndex = -1;
  main.setAttribute('role', 'tabpanel');
  // One board on the page: it fills the height below its heading, so all of it scrolls sideways.
  if (section?.fill && main.querySelectorAll('.board').length === 1) main.classList.add('fill-board');
  // The output panel sits under the section, on every section, while there's output to show.
  return [el('div', 'home', renderNav(m, current), el('div', 'home-col', main, renderDock(state.runs)))];
}

let scrollSave: ReturnType<typeof setTimeout> | undefined;

/** Remembers where the page is scrolled, a moment after it stops moving, so a rebuilt page comes back there. */
function saveScroll(pageKey: string): void {
  clearTimeout(scrollSave);
  scrollSave = setTimeout(() => {
    const main = document.querySelector<HTMLElement>('.home-main') ?? document.scrollingElement as HTMLElement | null;
    const boards = [...document.querySelectorAll<HTMLElement>('.board')].map((b) => ({ x: b.scrollLeft, lanes: [...b.querySelectorAll<HTMLElement>('.column')].map((c) => c.scrollTop) }));
    remember((x) => { x.scroll = { ...(x.scroll ?? {}), [pageKey]: { y: main?.scrollTop ?? 0, boards } }; });
  }, 200);
}

export function render(model: Model): void {
  state.last = model;
  if (model.kind === 'home') state.runs = model.runs;
  const scroller = document.querySelector('.home-main') ?? document.querySelector('.timeline') ?? document.scrollingElement;
  // Each board, and each of its lanes, keeps where it was scrolled to. A page just rebuilt (its tab was
  // hidden) starts from where it was saved instead.
  const pageKey = model.kind === 'home' ? (model.connect ? 'home:connect' : `home:${model.section}`) : model.kind;
  const fresh = !app.hasChildNodes();
  const saved = fresh ? memory().scroll?.[pageKey] : undefined;
  const boards = saved?.boards ?? [...document.querySelectorAll<HTMLElement>('.board')].map((b) => ({ x: b.scrollLeft, lanes: [...b.querySelectorAll<HTMLElement>('.column')].map((c) => c.scrollTop) }));
  const scroll = { y: saved?.y ?? scroller?.scrollTop ?? 0 };
  // An agent's page follows its newest step, unless you've scrolled up to read.
  const following = model.kind === 'agent' && !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const dockBox = document.querySelector<HTMLElement>('.dock-out');
  const dockAtBottom = !dockBox || dockBox.scrollHeight - dockBox.scrollTop - dockBox.clientHeight < 24;
  const dockTop = dockBox?.scrollTop ?? 0;
  const keep = keepFocus();
  for (const a of AREAS) a.before?.(model);
  const draw = VIEWS.get(model.kind) ?? Object.values(FALLBACK?.views ?? {})[0] as Draw;
  const nodes = model.kind === 'home' ? renderHome(model) : draw(model as never);
  app.replaceChildren(...nodes);
  document.querySelectorAll<HTMLElement>('.board').forEach((b, i) => {
    const was = boards[i];
    if (was) {
      b.scrollLeft = was.x;
      b.querySelectorAll<HTMLElement>('.column').forEach((c, j) => { c.scrollTop = was.lanes[j] ?? 0; });
    }
    boardEdges(b);
    wheelSideways(b);
    dragAutoScroll(b);
    b.addEventListener('scroll', () => saveScroll(pageKey), { passive: true });
    b.querySelectorAll<HTMLElement>('.column').forEach((c) => c.addEventListener('scroll', () => saveScroll(pageKey), { passive: true }));
  });
  document.querySelector('.home-main')?.addEventListener('scroll', () => saveScroll(pageKey), { passive: true });
  const main = document.querySelector('.home-main');
  const timeline = document.querySelector<HTMLElement>('.timeline');
  if (main && !state.scrolledTo) main.scrollTop = scroll.y;
  else if (timeline) timeline.scrollTop = following ? timeline.scrollHeight : scroll.y;
  else if (!main) window.scrollTo(0, scroll.y);
  state.scrolledTo = false;
  const box = document.querySelector<HTMLElement>('.dock-out');
  if (box) stickToBottom(box, dockAtBottom, dockTop);
  keep();
  for (const a of AREAS) a.after?.(model);
}
state.draw = render;

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as { type?: string; model?: Model; action?: string; ok?: boolean; jump?: boolean; open?: string };
  if (msg?.type === 'state' && msg.model && msg.model.kind === view) {
    // The extension moves the page only when asked to open a section; otherwise it stays where you are.
    if (msg.model.kind === 'home' && (msg.jump || !state.section)) setSection(msg.model.section, false);
    // A part of it to open as well, such as the Agents settings from the status bar's Auto-merge.
    if (msg.open) { const part = msg.open; remember((x) => { if (!x.opened.includes(part)) x.opened = [...x.opened, part]; }); }
    render(msg.model);
  }
  if (typeof msg?.type === 'string') RECEIVE.get(msg.type)?.(msg as never);
});
api.postMessage({ type: 'ready' });
