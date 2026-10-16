// The output panel: the commands acc runs for you, under every section.

import { pickerOf } from './looks.ts';
import type { RunCard } from '../src/model/runs.ts';
import { moreMenu } from './boards.ts';
import { button, el, icon, keepFocus, keptInput, status, titled, work } from './dom.ts';
import { clock, openKey, renderDockReview, showsLines, tick } from './dock-review.ts';
import { renderRunRows } from './run-view.ts';
import { api, memory, type PageArea, remember, state, view } from './state.ts';

// ---------------------------------------------------------------- the output panel (D-030)

/** Keeps the output pinned to its newest line, unless you've scrolled up to read. */
export function stickToBottom(box: HTMLElement, wasAtBottom: boolean, top: number): void {
  if (wasAtBottom) box.scrollTop = box.scrollHeight;
  else box.scrollTop = top;
}

/** An icon button whose name shows on hover and is read out, for a toolbar with no room for words. */
function tool(name: string, iconName: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'btn icon-only', icon(iconName)) as HTMLButtonElement;
  b.type = 'button';
  b.title = name;
  b.setAttribute('aria-label', name);
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/** What the tab remembers a run's Details opened by (T-64). */
const detailsKey = (run: string): string => `dock-details:${run}`;

/** The header line's time: a running run's clock, which moves on each second, or how long an ended one took. */
function runTime(run: RunCard): HTMLElement {
  if (run.took) return titled(el('span', 'muted dock-clock', run.took), `It took ${run.took}.`);
  const time = el('span', 'muted dock-clock', clock(Date.now() - run.startedAt));
  time.dataset.start = String(run.startedAt);
  time.title = 'How long it has run so far';
  tick();
  return time;
}

/** Details, opened from the header's menu: the command it runs, where, and since when. The panel shows the command nowhere else (T-64). */
function details(run: RunCard): HTMLElement {
  const item = (term: string, value: HTMLElement) => [el('dt', 'muted', term), el('dd', '', value)];
  return el('dl', 'dock-details',
    ...item('Command', work(el('code', 'dock-cmd', run.command), 'output')),
    ...(run.cwd ? item('Folder', work(el('span', 'dock-where', run.cwd), 'files')) : []),
    ...item('Started', el('span', '', new Date(run.startedAt).toLocaleString())));
}

export function renderDock(list: RunCard[]): HTMLElement | null {
  if (!list.length) return null;
  const m = memory().dock;
  // A run that lasts as long as the window (autopilot) is in the list, but another is shown first.
  const run = list.find((r) => r.id === m.run) ?? list.find((r) => r.running && !r.background) ?? list.find((r) => !r.background) ?? list[0]!;
  const open = m.open;
  const toggle = () => { remember((x) => { x.dock.open = !open; x.dock.run = run.id; }); redrawDock(); };
  const review = run.review;
  // Closed, a finished review's line is its count, not its last row (T-63).
  const lastLine = review?.phase === 'done' ? review.count : run.rows.at(-1)?.text ?? (run.running ? 'Starting…' : 'No output');
  const bar = el('div', 'dock-bar');
  // Open on a review, its header line says the verdict and its clock, so the bar doesn't say them again (T-63).
  const reviewShown = open && !!review && review.phase !== 'unread' && !showsLines(run.id);
  const head = el('button', 'dock-title', reviewShown ? icon('terminal') : status(run.look), el('span', 'strong dock-label', run.label), reviewShown ? null : runTime(run),
    open || run.prompt ? null : work(el('span', 'muted dock-last', lastLine), 'output')) as HTMLButtonElement;
  head.type = 'button';
  head.title = `${run.label}\n\n${open ? 'Hide' : 'Show'} the output`;
  head.setAttribute('aria-expanded', String(open));
  head.addEventListener('click', toggle);
  bar.append(head, el('span', 'spacer'));
  if (list.length > 1) {
    const pick = document.createElement('select');
    pick.className = 'dock-pick';
    pick.setAttribute('aria-label', 'Which command');
    // Closed it reads "1 of 4", for the head already names the run; while it's open its list names every run.
    const fill = (listing: boolean) => {
      const { options, title } = pickerOf(list, run.id, listing);
      pick.replaceChildren(...options.map((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.text; o.selected = c.selected; return o; }));
      pick.title = `${title}\n\nShow another command's output`;
    };
    fill(false);
    pick.addEventListener('mousedown', () => fill(true));
    pick.addEventListener('focus', () => fill(true));
    pick.addEventListener('blur', () => fill(false));
    pick.addEventListener('change', () => { remember((x) => { x.dock.run = pick.value; x.dock.open = true; }); redrawDock(); });
    bar.append(pick);
  }
  const control = (action: string) => api.postMessage({ type: 'run-control', run: run.id, action });
  // A toolbar like VSCode's own panels: icons, each with its name on hover and for screen readers.
  // A review shows its rows on Show output, and its review again after (T-63). One with no verdict shows only its rows.
  if (review && review.phase !== 'unread') {
    const lines = showsLines(run.id);
    const show = tool(lines ? 'Show the review' : 'Show output', lines ? 'checklist' : 'output', () => {
      remember((x) => { const k = openKey(run.id, 'lines'); x.opened = lines ? x.opened.filter((y) => y !== k) : [...x.opened, k]; x.dock.open = true; x.dock.run = run.id; });
      redrawDock();
    });
    show.classList.add('dock-lines');
    bar.append(show);
  }
  if (run.running) bar.append(tool('Stop it', 'debug-stop', () => control('stop')));
  // The header's menu (T-64): Details, which holds the command, Copy log, and the run in a terminal.
  const shown = memory().opened.includes(detailsKey(run.id));
  const empty = !run.rows.length && !run.hidden;
  const menu = moreMenu(`dock:${run.id}`, run.label, [
    { command: 'details', label: shown ? 'Hide details' : 'Show details', icon: 'info', ref: {} },
    { command: 'copy', label: 'Copy log', icon: 'copy', ref: {}, ...(empty ? { disabled: 'It hasn\'t printed anything yet.' } : {}) },
    { command: 'terminal', label: run.running ? 'Stop it here and run it in a terminal' : 'Run it again in a terminal', icon: 'terminal', ref: {} },
  ], (a) => {
    if (a.command !== 'details') { control(a.command); return; }
    remember((x) => { const k = detailsKey(run.id); x.opened = shown ? x.opened.filter((y) => y !== k) : [...x.opened, k]; x.dock.open = true; x.dock.run = run.id; });
    redrawDock();
  });
  if (menu) bar.append(menu);
  if (!run.running) bar.append(tool('Dismiss', 'close', () => { control('dismiss'); remember((x) => { x.dock.run = null; }); }));
  bar.append(tool(open ? 'Hide the output' : 'Show the output', open ? 'chevron-down' : 'chevron-up', toggle));

  const dock = el('section', `dock${open ? ' open' : ''}${run.prompt ? ' asking' : ''}`, bar);
  dock.setAttribute('aria-label', 'Command output');
  if (open && shown) dock.append(details(run));
  const body = open && review ? renderDockReview(run.id, review, redrawDock) : null;
  if (body?.above) dock.append(body.above);
  if (open && (!body || body.lines)) dock.append(renderRunRows(run));
  if (run.prompt) {
    const p = run.prompt;
    const key = `run:${run.id}`;
    const send = (text: string) => { remember((x) => { delete x.drafts[key]; }); api.postMessage({ type: 'run-input', run: run.id, text }); };
    const row = el('div', 'dock-ask', icon('bell', 'orange'), el('span', 'dock-ask-text', el('span', 'strong', 'It\'s asking: '), work(el('span', '', p.text), 'output')));
    if (p.kind === 'yesno') {
      row.append(el('div', 'actions', button('Yes', 'check', () => send('y'), 'primary'), button('No', 'close', () => send('n'))));
    } else {
      const input = keptInput(key, memory().drafts[key] ?? '', p.kind === 'secret' ? 'Type it here. It goes only to the command, and isn\'t shown or saved.' : 'Type your answer', (v) => {
        if (p.kind !== 'secret') remember((x) => { x.drafts[key] = v; });
      }, () => send(input.value), p.kind === 'secret' ? 'password' : 'text');
      row.append(input, button('Send', 'send', () => send(input.value), 'primary'));
    }
    dock.append(row);
  }
  return dock;
}

/** Redraws the output panel alone: output arrives many times a second, and the page shouldn't jump. */
export function redrawDock(): void {
  const old = document.querySelector<HTMLElement>('.dock');
  const box = old?.querySelector<HTMLElement>('.dock-body');
  const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  const top = box?.scrollTop ?? 0;
  const keep = keepFocus();
  const next = renderDock(state.runs);
  if (old && next) old.replaceWith(next);
  else if (old) old.remove();
  else if (next) document.querySelector('.home-col')?.append(next);
  const nbox = next?.querySelector<HTMLElement>('.dock-body');
  if (nbox) stickToBottom(nbox, atBottom || box?.dataset.run !== nbox.dataset.run, top);
  // A review opened in place keeps where it was scrolled, for the same run (T-63).
  const was = old?.querySelector<HTMLElement>('.dr');
  const now = next?.querySelector<HTMLElement>('.dr');
  if (was && now && was.dataset.run === now.dataset.run) now.scrollTop = was.scrollTop;
  keep();
}

export const area: PageArea = {
  receive: {
    // Output from a command acc is running: only the output panel redraws.
    runs: (msg) => {
      if (view !== 'home') return;
      const m = msg as unknown as { runs: RunCard[]; focus?: string };
      state.runs = m.runs;
      if (state.last?.kind === 'home') state.last = { ...state.last, runs: state.runs };
      if (m.focus) remember((x) => { x.dock = { open: true, run: m.focus! }; });
      redrawDock();
    },
  },
};
