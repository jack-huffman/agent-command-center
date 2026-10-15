// The output panel: the commands acc runs for you, under every section.

import { pickerOf } from './run-picker.ts';
import type { RunCard } from '../src/model/runs.ts';
import { button, el, icon, keepFocus, keptInput, status, titled, work } from './dom.ts';
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

export function renderDock(list: RunCard[]): HTMLElement | null {
  if (!list.length) return null;
  const m = memory().dock;
  // A run that lasts as long as the window (autopilot) is in the list, but another is shown first.
  const run = list.find((r) => r.id === m.run) ?? list.find((r) => r.running && !r.background) ?? list.find((r) => !r.background) ?? list[0]!;
  const open = m.open;
  const toggle = () => { remember((x) => { x.dock.open = !open; x.dock.run = run.id; }); redrawDock(); };
  const lastLine = [...run.lines].reverse().find((l) => l.trim()) ?? (run.running ? 'Starting…' : 'No output');
  const bar = el('div', 'dock-bar');
  const head = el('button', 'dock-title', icon('terminal'), el('span', 'strong dock-label', run.label), status(run.look), open || run.prompt ? null : work(el('span', 'muted mono dock-last', lastLine), 'output')) as HTMLButtonElement;
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
  if (run.running) bar.append(tool('Stop it', 'debug-stop', () => control('stop')));
  bar.append(tool(run.running ? 'Stop it here and run it in a terminal, for a command that needs your keyboard' : 'Run it again in a terminal', 'terminal', () => control('terminal')));
  if (!run.running) bar.append(tool('Dismiss', 'close', () => { control('dismiss'); remember((x) => { x.dock.run = null; }); }));
  bar.append(tool(open ? 'Hide the output' : 'Show the output', open ? 'chevron-down' : 'chevron-up', toggle));

  const dock = el('section', `dock${open ? ' open' : ''}${run.prompt ? ' asking' : ''}`, bar);
  dock.setAttribute('aria-label', 'Command output');
  if (open) {
    const out = work(el('pre', 'dock-out', run.lines.join('\n')), 'output');
    out.dataset.run = run.id;
    out.tabIndex = 0;
    out.setAttribute('aria-label', `Output of ${run.label}`);
    out.setAttribute('aria-live', 'polite');
    dock.append(work(titled(el('div', 'dock-cmd mono muted', `$ ${run.command}`), `$ ${run.command}`), 'output'), out);
  }
  if (run.prompt) {
    const p = run.prompt;
    const key = `run:${run.id}`;
    const send = (text: string) => { remember((x) => { delete x.drafts[key]; }); api.postMessage({ type: 'run-input', run: run.id, text }); };
    const row = el('div', 'dock-ask', icon('bell', 'orange'), el('span', 'dock-ask-text', el('span', 'strong', 'It\'s asking: '), work(el('span', 'mono', p.text), 'output')));
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
  const box = old?.querySelector<HTMLElement>('.dock-out');
  const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  const top = box?.scrollTop ?? 0;
  const keep = keepFocus();
  const next = renderDock(state.runs);
  if (old && next) old.replaceWith(next);
  else if (old) old.remove();
  else if (next) document.querySelector('.home-col')?.append(next);
  const nbox = next?.querySelector<HTMLElement>('.dock-out');
  if (nbox) stickToBottom(nbox, atBottom || box?.dataset.run !== nbox.dataset.run, top);
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
