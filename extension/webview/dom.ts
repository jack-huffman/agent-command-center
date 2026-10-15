// Building the page: every element is built with DOM calls and every string is set as text, so nothing
// from a ticket, branch or session can become markup. No HTML string is ever parsed.

import type { Action, Look, Ref } from '../src/model/shared.ts';
import type { PersonChip } from '../src/model/boards.ts';
import type { Block, Doc, Inline } from '../../packages/core/src/trackers/doc.ts';
import { api, go, memory, remember, state } from './state.ts';
import { panelLook } from './looks.ts';
import { inlineMarks } from './inline.ts';

export type Child = Node | string | null | undefined | false;

export function el(tag: string, cls = '', ...children: Child[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) if (c) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

/**
 * The kinds of work data (GH-163): words that are the work's own, and stay as they are, such as a changed
 * file's path or the command a builder ran. Everything else on the page speaks in processes. WORK_DATA in
 * extension/scripts/words.ts says why each kind stays literal; extension/test/words.test.ts pins where each
 * is marked.
 */
export type WorkData = 'files' | 'branch' | 'transcript' | 'output' | 'agent-text';

/** Marks an element as work data: the screenshot run's words check counts its words and leaves them as they are. */
export function work<T extends HTMLElement>(e: T, kind: WorkData): T {
  e.dataset.work = kind;
  return e;
}

export function icon(name: string, tone?: string): HTMLElement {
  const i = el('span', `codicon codicon-${name.replace(/~spin$/, '')}${name.endsWith('~spin') ? ' codicon-modifier-spin' : ''}${tone && tone !== 'neutral' ? ` tone-${tone}` : ''}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** A status always has words; the icon and colour only add to them. */
export function status(look: Look): HTMLElement {
  return el('span', `status tone-${look.tone}`, icon(look.icon, look.tone), look.label);
}

export function actionButton(a: Action): HTMLElement {
  const b = el('button', `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`, icon(a.icon), a.label) as HTMLButtonElement;
  b.type = 'button';
  b.title = a.label;
  b.addEventListener('click', () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }));
  return b;
}

export function toolbarButton(command: string, label: string, iconName: string, project?: string, primary = false): HTMLElement {
  const b = el('button', `btn${primary ? ' primary' : ''}`, icon(iconName), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => api.postMessage({ type: 'toolbar', command, project }));
  return b;
}

export function header(title: string, summary: string, ...tools: Child[]): HTMLElement {
  return pageHeader(title, summary, ...tools, refreshButton());
}

/** A header's Refresh: the extension reads again what the section shows. */
export function refreshButton(): HTMLElement {
  const refresh = el('button', 'btn ghost', icon('refresh'), 'Refresh') as HTMLButtonElement;
  refresh.type = 'button';
  refresh.addEventListener('click', () => refreshPage());
  return refresh;
}

/** A page's header with only the tools it's given: the Overview's puts Refresh in its ⋯ menu (T-36). */
export function pageHeader(title: string, summary: string, ...tools: Child[]): HTMLElement {
  return el('header', 'page-header', el('div', 'titles', el('h1', '', title), el('p', 'summary', summary)), el('div', 'toolbar', ...tools));
}

/** Refresh: the extension reads again what the section shows. */
export const refreshPage = (): void => api.postMessage({ type: 'refresh' });

export function empty(text: string, ...tools: Child[]): HTMLElement {
  return el('div', 'empty', el('p', '', text), el('div', 'toolbar', ...tools));
}

/** A link from a ticket. It opens in the browser through the extension, which opens only web links. */
export function linkTo(url: string, ...children: Child[]): HTMLElement {
  const a = el('a', 'ext', ...children) as HTMLAnchorElement;
  a.href = '#';
  a.title = url;
  a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); api.postMessage({ type: 'open', url }); });
  return a;
}

export function avatar(p: PersonChip): HTMLElement {
  const a = el('span', 'avatar', p.initials);
  a.title = p.name;
  a.setAttribute('aria-label', p.name);
  return a;
}

/** A label chip: its name always, plus the tracker's colour as a dot when it has one. */
export function labelChip(l: { name: string; color: string | null }): HTMLElement {
  const dot = el('span', 'label-dot');
  if (l.color && /^[0-9a-f]{6}$/i.test(l.color)) dot.style.background = `#${l.color}`;
  return el('span', 'label', l.color ? dot : null, l.name);
}

export function when(iso: string | null): HTMLElement {
  const ms = iso ? Date.parse(iso) : NaN;
  const t = el('time', 'muted', Number.isFinite(ms) ? since(ms) : '');
  if (Number.isFinite(ms)) t.title = new Date(ms).toLocaleString();
  return t;
}

function renderInlines(c: Inline[]): Node[] {
  return c.map((i): Node => {
    if (i.t === 'br') return el('br');
    if (i.t === 'mention') return el('span', 'mention', i.text);
    if (i.t === 'image') return i.href ? linkTo(i.href, icon('file-media'), i.alt) : el('span', 'media-inline', icon('file-media'), i.alt);
    let node: Node = document.createTextNode(i.text);
    for (const m of i.marks ?? []) node = el(m === 'strong' ? 'strong' : m === 'em' ? 'em' : m === 'code' ? 'code' : m === 'strike' ? 's' : 'u', '', node);
    return i.href ? linkTo(i.href, node) : node;
  });
}

/** A plain line drawn with its `code` and **bold** marks (inline.ts). */
export const md = (s: string): HTMLElement => el('span', 'md', ...renderInlines(inlineMarks(s)));

/** An icon and its words, kept on one line and centred together. */
export const iconed = (name: string, text: string): HTMLElement => el('span', 'iconed', icon(name), text);

function renderBlocks(bs: Block[]): Node[] {
  return bs.map((b): Node => {
    switch (b.t) {
      case 'p': return el('p', '', ...renderInlines(b.c));
      case 'h': return el(`h${Math.min(6, b.level + 2)}`, `doc-h${b.level}`, ...renderInlines(b.c));
      case 'list': {
        const list = el(b.ordered ? 'ol' : 'ul', b.items.some((i) => i.checked !== undefined) ? 'tasks' : '');
        if (b.ordered && b.start) (list as HTMLOListElement).start = b.start;
        for (const it of b.items) {
          const li = el('li', it.checked === undefined ? '' : it.checked ? 'task done' : 'task');
          if (it.checked !== undefined) {
            const box = icon(it.checked ? 'pass-filled' : 'circle-large-outline', it.checked ? 'blue' : undefined);
            // A span may carry a name only with a role (axe's aria-prohibited-attr, T-55): the icon is an image of its state.
            box.setAttribute('role', 'img');
            box.setAttribute('aria-label', it.checked ? 'Done' : 'Not done');
            box.removeAttribute('aria-hidden');
            li.append(box);
          }
          li.append(...renderBlocks(it.c));
          list.append(li);
        }
        return list;
      }
      case 'code': {
        // A long line scrolls the block sideways, so the keyboard can reach it to scroll it (axe's scrollable-region-focusable, T-55).
        const pre = el('pre', '', el('code', '', b.text));
        pre.tabIndex = 0;
        return el('div', 'code', b.lang ? el('div', 'code-lang', b.lang) : null, pre);
      }
      case 'quote': {
        const kind = panelLook(b.label ?? '');
        return el('blockquote', b.label ? `panel tone-edge-${kind.tone}` : '', b.label ? el('div', 'panel-label', icon(kind.icon, kind.tone), b.label) : null, ...renderBlocks(b.c));
      }
      case 'hr': return el('hr');
      case 'table': {
        const table = el('table', 'doc-table');
        if (b.head) table.append(el('thead', '', el('tr', '', ...b.head.map((c) => el('th', '', ...renderInlines(c))))));
        table.append(el('tbody', '', ...b.rows.map((r) => el('tr', '', ...r.map((c) => el('td', '', ...renderInlines(c)))))));
        return el('div', 'table-scroll', table);
      }
      case 'media': return el('p', 'media', b.href ? linkTo(b.href, icon('file-media'), b.label) : el('span', '', icon('file-media'), b.label, el('span', 'muted', ' (attachment, open the ticket to see it)')));
    }
  });
}

export function renderDoc(doc: Doc, emptyText: string): HTMLElement {
  const d = el('div', 'doc', ...renderBlocks(doc.blocks));
  if (!doc.blocks.length) d.append(el('p', 'muted', emptyText));
  return d;
}

/** A cell that truncates with an ellipsis and shows the full text on hover. */
export function clipped(text: string, cls = ''): HTMLElement {
  const td = el('td', `clip ${cls}`.trim(), text);
  td.title = text;
  return td;
}

/** An element that shows more on hover, such as a card's agent line naming its builder (D-087). */
export function titled(node: HTMLElement, text: string | null): HTMLElement {
  if (text) node.title = text;
  return node;
}

/** A cell that spans several columns, such as a group's heading row. */
export function span(cell: HTMLElement, columns: number): HTMLElement {
  (cell as HTMLTableCellElement).colSpan = columns;
  return cell;
}

/** Tables scroll sideways in a narrow tab instead of squeezing or wrapping their cells. */
export const wrap = (table: HTMLElement): HTMLElement => el('div', 'table-wrap', table);

/**
 * A caret that opens the row's native VSCode context menu. VSCode builds the menu from the row's
 * data-vscode-context when a contextmenu event reaches it, so the caret dispatches one.
 */
export function menuButton(label: string): HTMLElement {
  const b = el('button', 'btn icon-only menu-caret', icon('chevron-down')) as HTMLButtonElement;
  b.type = 'button';
  b.title = `Actions for ${label}`;
  b.setAttribute('aria-label', `Actions for ${label}`);
  b.setAttribute('aria-haspopup', 'menu');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom + 2, button: 2 }));
  });
  return b;
}

/**
 * Gives a row VSCode's own context menu: right-click anywhere on it, or its caret. package.json picks
 * the items under webview/context by section and flags; the command gets `accRef` back.
 */
export function withMenu(row: HTMLElement, section: string, ref: Ref, flags: Record<string, boolean>): HTMLElement {
  row.dataset.vscodeContext = JSON.stringify({ webviewSection: section, preventDefaultContextMenuItems: true, ...flags, accRef: ref });
  return row;
}

export function since(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// A copy of `plural` in packages/core/src/text.ts, on purpose: the page imports no values from outside
// extension/webview, because that bundles host code into the page (D-121). extension/test/webview-imports.test.ts
// gives both the same inputs and fails when the outputs differ.
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Makes an element open a ticket page on click or Enter, like a link. */
export function openable(e: HTMLElement, msg: unknown): HTMLElement {
  e.classList.add('openable');
  e.tabIndex = 0;
  e.setAttribute('role', 'link');
  const go = (ev: Event) => {
    if ((ev.target as HTMLElement).closest('button, a.ext')) return;
    ev.preventDefault();
    api.postMessage(msg);
  };
  e.addEventListener('click', go);
  e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(ev); });
  return e;
}

/** What marks a card that opens a task in the modal over the board, so focus goes back to it (GH-158). */
export const peekKey = (project: string, key: string): string => `${project}#${key.toUpperCase()}`;

/**
 * A card that opens its task in the modal over the board, not in a tab (GH-158). tracker is the tracker
 * board's; the agent board gives none, so the key decides, as acc.task.show does.
 */
export function peekable(e: HTMLElement, project: string, key: string, tracker?: number | null): HTMLElement {
  e.dataset.peek = peekKey(project, key);
  return openable(e, { type: 'task-modal-open', project, key, ...(tracker === undefined ? {} : { tracker }) });
}

/**
 * Shows the first few lines of something long, with Show all to open the rest. `inner` names the part
 * that's cut, when it isn't the whole element. Remembered per tab, by key.
 */
export function foldable(key: string, content: HTMLElement, inner: string | null, lines: number): HTMLElement {
  const open = memory().opened.includes(key);
  const target = inner ? content.querySelector<HTMLElement>(`.${inner}`) ?? content : content;
  const wrapEl = el('div', 'foldable', content);
  if (open) target.classList.remove('clamped');
  else { target.classList.add('clamped'); target.style.setProperty('--lines', String(lines)); }
  const toggle = button(open ? 'Show less' : 'Show all', open ? 'chevron-up' : 'chevron-down', () => {
    remember((x) => { x.opened = open ? x.opened.filter((y) => y !== key) : [...x.opened, key]; });
    if (state.last) state.draw(state.last);
  }, 'ghost small fold-toggle');
  wrapEl.append(toggle);
  // A short one needs no toggle: checked once it's on the page.
  requestAnimationFrame(() => { if (!open && target.scrollHeight <= target.clientHeight + 2) toggle.remove(); });
  return wrapEl;
}

/**
 * A Settings row's explanation (T-40): in view, or, when the model folds it, under "What this means", closed
 * at first; the tab remembers each one opened as the page redraws. None when it's empty.
 */
export function whatThisMeans(id: string, text: string, folded: readonly string[]): HTMLElement | null {
  if (!text) return null;
  if (!folded.includes(id)) return el('p', 'muted small settings-meaning', text);
  const key = `settings-meaning:${id}`;
  const d = el('details', 'settings-fold', el('summary', 'muted small', el('span', 'tool-chev', icon('chevron-right')), el('span', '', 'What this means')),
    el('p', 'muted small settings-meaning', text)) as HTMLDetailsElement;
  d.dataset.fold = id;
  d.open = memory().opened.includes(key);
  d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, key])].slice(-200) : x.opened.filter((y) => y !== key); }));
  return d;
}

export function clippedSpan(text: string): HTMLElement {
  const s = el('span', 'mono clip-inline', text);
  s.title = text;
  return s;
}

export function button(label: string, iconName: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', `btn ${cls}`.trim(), icon(iconName), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/** A text box that keeps its words, and its place, when the page redraws. */
export function keptInput(key: string, value: string, placeholder: string, onInput: (v: string) => void, onEnter?: () => void, type = 'text'): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.className = 'text-input';
  i.value = value;
  i.placeholder = placeholder;
  i.dataset.keep = key;
  i.setAttribute('aria-label', placeholder);
  if (type === 'password') i.autocomplete = 'off';
  i.addEventListener('input', () => onInput(i.value));
  if (onEnter) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } });
  return i;
}

/** Remembers which text box had focus, and puts it back after a redraw. */
export function keepFocus(): () => void {
  const a = document.activeElement as HTMLInputElement | null;
  const key = a?.dataset?.keep;
  const start = a?.selectionStart ?? null;
  const end = a?.selectionEnd ?? null;
  return () => {
    if (!key) return;
    const again = document.querySelector<HTMLInputElement>(`[data-keep="${CSS.escape(key)}"]`);
    if (!again) return;
    again.focus({ preventScroll: true });
    if (start !== null && end !== null) try { again.setSelectionRange(start, end); } catch { /* not a text box */ }
  };
}

/** A row of choices, one on: the tracker's kind, a project, or a way to sign in. */
export function segmented(label: string, items: { key: string; label: string; icon: string; on: boolean }[], pick: (key: string) => void): HTMLElement {
  const g = el('div', 'segmented');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', label);
  for (const i of items) {
    const b = el('button', `seg${i.on ? ' on' : ''}`, icon(i.icon), i.label) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i.on));
    b.addEventListener('click', () => { if (!i.on) pick(i.key); });
    g.append(b);
  }
  return g;
}


/** A button that runs a command with one argument, such as the project it's for. */
export function argButton(command: string, label: string, iconName: string, arg: string, primary = false): HTMLElement {
  const b = el('button', `btn${primary ? ' primary' : ''}`, icon(iconName), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => api.postMessage({ type: 'toolbar', command, arg }));
  return b;
}
