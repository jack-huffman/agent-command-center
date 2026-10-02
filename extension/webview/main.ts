// Renders one editor tab. Every element is built with DOM calls and every string is set as text,
// so nothing from a ticket, branch or session can become markup. No HTML string is ever parsed.
import type {
  Action, AgentsModel, EnvironmentsModel, Look, Model, PersonChip, Ref, SetupModel, TasksModel, TicketModel, TrackerBoard, TrackerCard, ViewKind, WorktreesModel,
} from '../src/model.ts';
import type { Block, Doc, Inline } from '../../packages/core/src/trackers/doc.ts';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const api = acquireVsCodeApi();
const app = document.getElementById('app')!;
const view = document.body.dataset.view as ViewKind | 'ticket';

type Child = Node | string | null | undefined | false;

function el(tag: string, cls = '', ...children: Child[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) if (c) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function icon(name: string, tone?: string): HTMLElement {
  const i = el('span', `codicon codicon-${name.replace(/~spin$/, '')}${name.endsWith('~spin') ? ' codicon-modifier-spin' : ''}${tone && tone !== 'neutral' ? ` tone-${tone}` : ''}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** A status always has words; the icon and colour only add to them. */
function status(look: Look): HTMLElement {
  return el('span', `status tone-${look.tone}`, icon(look.icon, look.tone), look.label);
}

function actionButton(a: Action): HTMLElement {
  const b = el('button', `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`, icon(a.icon), a.label) as HTMLButtonElement;
  b.type = 'button';
  b.title = a.label;
  b.addEventListener('click', () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }));
  return b;
}

function toolbarButton(command: string, label: string, iconName: string, project?: string, primary = false): HTMLElement {
  const b = el('button', `btn${primary ? ' primary' : ''}`, icon(iconName), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => api.postMessage({ type: 'toolbar', command, project }));
  return b;
}

function header(title: string, summary: string, ...tools: Child[]): HTMLElement {
  const refresh = el('button', 'btn ghost', icon('refresh'), 'Refresh') as HTMLButtonElement;
  refresh.type = 'button';
  refresh.addEventListener('click', () => api.postMessage({ type: 'refresh' }));
  return el('header', 'page-header', el('div', 'titles', el('h1', '', title), el('p', 'summary', summary)), el('div', 'toolbar', ...tools, refresh));
}

function empty(text: string, ...tools: Child[]): HTMLElement {
  return el('div', 'empty', el('p', '', text), el('div', 'toolbar', ...tools));
}

/** Per-tab memory that survives re-renders and the tab being hidden: board modes and comment drafts. */
interface Memory { modes: Record<string, 'tracker' | 'agents'>; drafts: Record<string, string> }
function memory(): Memory {
  const s = (api.getState() as Partial<Memory> | undefined) ?? {};
  return { modes: s.modes ?? {}, drafts: s.drafts ?? {} };
}
function remember(change: (m: Memory) => void): void {
  const m = memory();
  change(m);
  api.setState(m);
}

/** A link from a ticket. It opens in the browser through the extension, which opens only web links. */
function linkTo(url: string, ...children: Child[]): HTMLElement {
  const a = el('a', 'ext', ...children) as HTMLAnchorElement;
  a.href = '#';
  a.title = url;
  a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); api.postMessage({ type: 'open', url }); });
  return a;
}

function avatar(p: PersonChip): HTMLElement {
  const a = el('span', 'avatar', p.initials);
  a.title = p.name;
  a.setAttribute('aria-label', p.name);
  return a;
}

/** A label chip: its name always, plus the tracker's colour as a dot when it has one. */
function labelChip(l: { name: string; color: string | null }): HTMLElement {
  const dot = el('span', 'label-dot');
  if (l.color && /^[0-9a-f]{6}$/i.test(l.color)) dot.style.background = `#${l.color}`;
  return el('span', 'label', l.color ? dot : null, l.name);
}

function when(iso: string | null): HTMLElement {
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

/** Jira's panels: orange for the ones that ask for care, blue for the rest, and each with its own icon. */
const PANEL: Record<string, { icon: string; tone: string }> = {
  Info: { icon: 'info', tone: 'blue' }, Note: { icon: 'note', tone: 'blue' }, Tip: { icon: 'lightbulb', tone: 'blue' }, Success: { icon: 'pass', tone: 'blue' },
  Warning: { icon: 'warning', tone: 'orange' }, Error: { icon: 'error', tone: 'orange' }, Details: { icon: 'chevron-right', tone: 'neutral' },
};

/** An icon and its words, kept on one line and centred together. */
const iconed = (name: string, text: string): HTMLElement => el('span', 'iconed', icon(name), text);

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
            box.setAttribute('aria-label', it.checked ? 'Done' : 'Not done');
            box.removeAttribute('aria-hidden');
            li.append(box);
          }
          li.append(...renderBlocks(it.c));
          list.append(li);
        }
        return list;
      }
      case 'code': return el('div', 'code', b.lang ? el('div', 'code-lang', b.lang) : null, el('pre', '', el('code', '', b.text)));
      case 'quote': {
        const kind = PANEL[b.label ?? ''] ?? { icon: 'info', tone: 'blue' };
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

function renderDoc(doc: Doc, emptyText: string): HTMLElement {
  const d = el('div', 'doc', ...renderBlocks(doc.blocks));
  if (!doc.blocks.length) d.append(el('p', 'muted', emptyText));
  return d;
}

/** A cell that truncates with an ellipsis and shows the full text on hover. */
function clipped(text: string, cls = ''): HTMLElement {
  const td = el('td', `clip ${cls}`.trim(), text);
  td.title = text;
  return td;
}

/** A cell that spans several columns, such as a group's heading row. */
function span(cell: HTMLElement, columns: number): HTMLElement {
  (cell as HTMLTableCellElement).colSpan = columns;
  return cell;
}

/** Tables scroll sideways in a narrow tab instead of squeezing or wrapping their cells. */
const wrap = (table: HTMLElement): HTMLElement => el('div', 'table-wrap', table);

/**
 * A caret that opens the row's native VSCode context menu. VSCode builds the menu from the row's
 * data-vscode-context when a contextmenu event reaches it, so the caret dispatches one.
 */
function menuButton(label: string): HTMLElement {
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
function withMenu(row: HTMLElement, section: string, ref: Ref, flags: Record<string, boolean>): HTMLElement {
  row.dataset.vscodeContext = JSON.stringify({ webviewSection: section, preventDefaultContextMenuItems: true, ...flags, accRef: ref });
  return row;
}

function since(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- views

function renderTasks(m: TasksModel): Node[] {
  if (!m.projects.length) return [header('Tasks', 'No onboarded project in this workspace.'), empty('Onboard this folder to start tracking tasks.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  return m.projects.map((p) => {
    const tools: Child[] = [toolbarButton('acc.task.add', 'Add task', 'add', p.root, true)];
    // With a tracker's board on show, its tickets come from the board ("Track in acc"), not an import.
    if (!p.boards.length) {
      if (p.github) tools.push(toolbarButton('acc.task.importGithub', 'Import GitHub issues', 'github', p.root));
      tools.push(toolbarButton('acc.task.importJira', 'Jira', 'cloud-download', p.root));
    }
    const ready = p.columns.find((c) => c.group === 'ready')?.cards.length ?? 0;
    const needs = p.columns.find((c) => c.group === 'needs-you')?.cards.length ?? 0;
    const summary = p.total ? `${p.name}: ${plural(p.total, 'task')}, ${ready} ready${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}.` : `${p.name}: no tasks yet.`;
    if (p.boards.length) {
      const mode = memory().modes[p.root] ?? 'tracker';
      const toggle = el('div', 'segmented');
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', 'Which board');
      for (const [m, label, ic] of [['tracker', p.boards.length === 1 ? p.boards[0]!.title : 'Tracker boards', KIND_ICON[p.boards[0]!.kind] ?? 'issues'], ['agents', 'Agent board', 'hubot']] as const) {
        const b = el('button', `seg${mode === m ? ' on' : ''}`, icon(ic), label) as HTMLButtonElement;
        b.type = 'button';
        b.setAttribute('aria-pressed', String(mode === m));
        b.addEventListener('click', () => { remember((s) => { s.modes[p.root] = m; }); if (last) render(last); });
        toggle.append(b);
      }
      tools.unshift(toggle);
      if (mode === 'tracker') {
        const cards = p.boards.reduce((n, b) => n + b.columns.reduce((k, c) => k + c.cards.length, 0), 0);
        const head = header(m.projects.length > 1 ? `Tasks · ${p.name}` : 'Tasks', `${p.name}: ${plural(cards, 'ticket')} on the board${ready ? `, ${ready} ready for an agent` : ''}${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}.`, ...tools);
        return el('div', 'project', head, ...p.boards.map((b) => renderTrackerBoard(p.root, b)));
      }
    }
    const board = el('div', 'board');
    for (const c of p.columns) {
      const col = el('section', `column tone-edge-${c.tone}`, el('h2', '', icon(c.icon, c.tone), c.label, el('span', 'count', String(c.cards.length))));
      col.setAttribute('aria-label', `${c.label}: ${plural(c.cards.length, 'task')}`);
      if (!c.cards.length) col.append(el('p', 'muted', 'Nothing here'));
      for (const card of c.cards) {
        col.append(el('article', `card${c.group === 'done' ? ' done' : ''}`,
          el('div', 'card-id', card.id, el('span', 'chip', card.environment)),
          openable(el('div', 'card-title', card.title), { type: 'run', command: 'acc.task.show', ref: { project: p.root, task: card.id } }),
          card.waitingOn.length ? el('div', 'card-note', icon('clock'), `Waiting on ${card.waitingOn.join(', ')}`) : null,
          card.agent ? el('div', 'card-agent', el('span', 'muted', 'Agent: '), status(card.agent)) : null,
          card.worktree ? el('div', 'card-where mono muted', icon('git-branch'), card.worktree.split('/').slice(-2).join('/')) : null,
          el('div', 'actions', ...card.actions.map(actionButton)),
        ));
      }
      board.append(col);
    }
    return el('div', 'project', header(m.projects.length > 1 ? `Tasks · ${p.name}` : 'Tasks', summary, ...tools), p.total ? board : empty('Tasks are tickets for agents to work on.', ...tools));
  });
}

/** Makes an element open a ticket page on click or Enter, like a link. */
function openable(e: HTMLElement, msg: unknown): HTMLElement {
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

const SOURCE_LABEL: Record<string, string> = { 'jira-board': 'Jira board', 'github-project': 'GitHub Project', 'github-state': 'Open and closed', 'azure-board': 'Azure board' };
const KIND_ICON: Record<string, string> = { github: 'github', jira: 'issues', azure: 'azure-devops', acc: 'checklist' };
const KIND_NAME: Record<string, string> = { github: 'GitHub', jira: 'Jira', azure: 'Azure DevOps' };

function trackerCard(root: string, b: TrackerBoard, c: TrackerCard): HTMLElement {
  const kind = el('span', 'tcard-type', icon(c.typeIcon));
  kind.title = c.type ?? 'Issue';
  const prio = c.priorityIcon ? el('span', 'tcard-prio', icon(c.priorityIcon)) : null;
  if (prio) prio.title = `Priority: ${c.priority}`;
  const card = el('article', `card tcard${c.acc?.needsYou ? ' attention' : ''}`,
    el('div', 'tcard-top', kind, el('span', 'tcard-key', c.key), prio, el('span', 'spacer'), ...c.assignees.slice(0, 3).map(avatar)),
    el('div', 'card-title', c.title),
    c.labels.length ? el('div', 'labels', ...c.labels.slice(0, 4).map(labelChip)) : null,
    c.acc ? el('div', 'tcard-acc', status(c.acc.look), el('span', 'spacer'), c.acc.action ? actionButton(c.acc.action) : null) : null,
  );
  card.dataset.key = c.key;
  card.draggable = true;
  card.setAttribute('aria-label', `${c.key}: ${c.title}. ${c.status}. Press Enter to open, or drag to another column.`);
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/x-acc-card', c.key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return openable(card, { type: 'ticket', project: root, tracker: b.index, key: c.key });
}

function renderTrackerBoard(root: string, b: TrackerBoard): HTMLElement {
  const tools: Child[] = [];
  if (b.url) {
    const open = el('button', 'btn ghost', icon('link-external'), `Open in ${KIND_NAME[b.kind] ?? 'the tracker'}`) as HTMLButtonElement;
    open.type = 'button';
    open.addEventListener('click', () => api.postMessage({ type: 'open', url: b.url }));
    tools.push(open);
  }
  const out = el('section', 'tracker',
    el('div', 'tracker-head',
      el('h2', '', icon(KIND_ICON[b.kind] ?? 'issues'), b.title, b.source ? el('span', 'chip', SOURCE_LABEL[b.source] ?? b.source) : null, b.loading ? el('span', 'muted loading', icon('sync~spin'), 'Loading') : null),
      el('div', 'toolbar', ...tools)));
  if (b.error) {
    const fix = b.connect ? el('button', 'btn primary', icon('plug'), b.connect.label) as HTMLButtonElement : null;
    if (fix && b.connect) { fix.type = 'button'; const c = b.connect; fix.addEventListener('click', () => api.postMessage({ type: 'toolbar', command: c.command, arg: c.arg })); }
    out.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', b.error), fix));
  }
  if (b.notice) out.append(el('div', 'notice', icon('info'), el('span', '', b.notice)));
  if (!b.columns.length) {
    if (!b.error) out.append(el('p', 'muted', b.loading ? 'Loading the board…' : 'This board has no columns.'));
    return out;
  }
  const board = el('div', 'board');
  for (const c of b.columns) {
    const col = el('section', `column tone-edge-${c.tone}${c.done ? ' done-col' : ''}`, el('h2', '', c.name, el('span', 'count', String(c.cards.length))));
    col.setAttribute('aria-label', `${c.name}: ${plural(c.cards.length, 'ticket')}`);
    col.dataset.col = c.id;
    for (const card of c.cards) col.append(trackerCard(root, b, card));
    if (!c.cards.length) col.append(el('p', 'muted drop-hint', 'Nothing here'));
    col.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('text/x-acc-card')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drop-target');
    });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget as Node)) col.classList.remove('drop-target'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop-target');
      const key = e.dataTransfer?.getData('text/x-acc-card');
      const moved = key ? board.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
      if (!key || !moved || moved.closest('.column') === col) return;
      // Shown in place at once; the board reloads from the tracker, or snaps back if the move is refused.
      col.querySelector('.drop-hint')?.remove();
      col.append(moved);
      api.postMessage({ type: 'move', project: root, tracker: b.index, key, to: c.id });
    });
    board.append(col);
  }
  out.append(board);
  return out;
}

// ---------------------------------------------------------------- a ticket's page (D-026)

function ticketAction(action: string, text?: string): void {
  api.postMessage({ type: 'ticket-action', action, ...(text !== undefined ? { text } : {}) });
}

function editButton(label: string, action: string): HTMLElement {
  const b = el('button', 'btn ghost small', icon('edit'), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => ticketAction(action));
  return b;
}

function field(name: string, ...value: Child[]): HTMLElement[] {
  return [el('dt', '', name), el('dd', '', ...value)];
}

function composer(m: TicketModel): HTMLElement {
  const box = el('textarea', 'comment-box') as HTMLTextAreaElement;
  box.placeholder = 'Add a comment. Markdown works: **bold**, `code`, - lists, [links](https://…)';
  box.rows = 4;
  box.value = memory().drafts[`${m.project}#${m.key}`] ?? '';
  box.setAttribute('aria-label', `Comment on ${m.key}`);
  const send = el('button', 'btn primary', icon('comment'), 'Comment') as HTMLButtonElement;
  send.type = 'button';
  send.disabled = !box.value.trim();
  const hint = el('span', 'muted small', navigator.platform.includes('Mac') ? '⌘ Enter to post' : 'Ctrl+Enter to post');
  const post = () => {
    if (!box.value.trim() || send.disabled) return;
    send.disabled = true;
    box.disabled = true;
    send.replaceChildren(icon('sync~spin'), 'Posting');
    ticketAction('comment', box.value);
  };
  box.addEventListener('input', () => {
    send.disabled = !box.value.trim();
    remember((s) => { s.drafts[`${m.project}#${m.key}`] = box.value; });
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } });
  send.addEventListener('click', post);
  return el('div', 'composer', box, el('div', 'composer-bar', hint, el('span', 'spacer'), send));
}

/** The extension says how a write went. A posted comment clears its draft; a refused one keeps it. */
function onDone(msg: { action?: string; ok?: boolean }): void {
  if (msg.action !== 'comment') return;
  const box = document.querySelector<HTMLTextAreaElement>('.comment-box');
  if (msg.ok && last?.kind === 'ticket') { const m = last; remember((s) => { delete s.drafts[`${m.project}#${m.key}`]; }); if (box) box.value = ''; }
  if (box) box.disabled = false;
  const send = document.querySelector<HTMLButtonElement>('.composer .btn.primary');
  if (send) { send.replaceChildren(icon('comment'), 'Comment'); send.disabled = !box?.value.trim(); }
}

function renderTicket(m: TicketModel): Node[] {
  const sourceIcon = KIND_ICON[m.sourceKind] ?? 'checklist';
  const crumbs = el('div', 'crumbs', icon(sourceIcon), el('span', '', m.sourceLabel), el('span', 'muted', '/'), m.url ? linkTo(m.url, m.key) : el('span', '', m.key));
  const statusEl = m.status ? el('span', `pill tone-${m.status.tone}`, m.status.name) : null;
  let statusCtl: Child = statusEl;
  if (statusEl && m.can.status) {
    const b = el('button', 'btn status-btn', statusEl, icon('chevron-down')) as HTMLButtonElement;
    b.type = 'button';
    b.title = 'Change status';
    b.addEventListener('click', () => ticketAction('status'));
    statusCtl = b;
  }
  const type = m.type ? el('span', 'chip-lg', icon(m.typeIcon), m.type) : null;
  const tools: Child[] = [];
  if (m.url) {
    const open = el('button', 'btn ghost', icon('link-external'), KIND_NAME[m.sourceKind] ? `Open in ${KIND_NAME[m.sourceKind]}` : 'Open ticket') as HTMLButtonElement;
    open.type = 'button';
    open.addEventListener('click', () => api.postMessage({ type: 'open', url: m.url }));
    tools.push(open);
  }
  const refresh = el('button', 'btn ghost', icon(m.loading ? 'sync~spin' : 'refresh'), m.loading ? 'Loading' : 'Refresh') as HTMLButtonElement;
  refresh.type = 'button';
  refresh.addEventListener('click', () => ticketAction('refresh'));
  tools.push(refresh);
  const out: Node[] = [el('header', 'ticket-head', crumbs, el('h1', 'ticket-title', m.title), el('div', 'ticket-bar', statusCtl, type, el('span', 'spacer'), ...tools))];
  if (m.error) {
    const fix = m.connect ? el('button', 'btn primary', icon('plug'), m.connect.label) as HTMLButtonElement : null;
    if (fix && m.connect) { fix.type = 'button'; const c = m.connect; fix.addEventListener('click', () => api.postMessage({ type: 'toolbar', command: c.command, arg: c.arg })); }
    out.push(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', m.error), fix));
  }

  // The main column: description, related tickets, then activity.
  const main = el('div', 'ticket-main', el('section', 'block', el('h2', '', 'Description'), m.loading && !m.body.blocks.length ? el('p', 'muted', 'Loading…') : renderDoc(m.body, 'No description.')));
  if (m.related.length) {
    main.append(el('section', 'block', el('h2', '', 'Related'), el('ul', 'related', ...m.related.map((r) => {
      const name = /^[A-Z][A-Z0-9_]*-\d+$/i.test(r.key) ? openable(el('span', 'tcard-key', r.key), { type: 'ticket', project: m.project, tracker: m.tracker, key: r.key }) : el('span', 'tcard-key', r.key);
      return el('li', '', el('span', 'muted rel', r.relation), name, r.title ? el('span', '', r.title) : null);
    }))));
  }
  const activity = el('section', 'block activity', el('h2', '', 'Activity'));
  if (m.can.comment || m.comments.length) {
    activity.append(el('h3', '', `Comments (${m.comments.length})`));
    if (!m.comments.length) activity.append(el('p', 'muted', 'No comments yet.'));
    for (const c of m.comments) {
      activity.append(el('article', 'comment', avatar(c.author), el('div', 'comment-body',
        el('div', 'comment-head', el('strong', '', c.author.name), when(c.created), c.url ? linkTo(c.url, icon('link-external')) : null),
        renderDoc(c.body, ''))));
    }
    if (m.can.comment) activity.append(composer(m));
  }
  if (m.acc?.history.length) {
    activity.append(el('h3', '', 'History in acc'), el('ol', 'history', ...m.acc.history.map((h) => el('li', '',
      when(h.at), el('span', '', `${h.from ?? 'new'} → `), el('strong', '', h.to), el('span', 'muted', ` by ${h.by}`), h.reason ? el('div', 'muted small', h.reason) : null))));
  }
  if (activity.childElementCount > 1) main.append(activity);

  // The side column: the ticket's fields, then acc's side of it.
  const people = (list: PersonChip[]) => (list.length ? el('span', 'people', ...list.map((p) => el('span', 'person', avatar(p), p.name))) : el('span', 'muted', 'Unassigned'));
  const details = el('dl', 'fields',
    ...field('Status', m.status ? el('span', `pill tone-${m.status.tone}`, m.status.name) : el('span', 'muted', '—')),
    ...field(m.assignees.length > 1 ? 'Assignees' : 'Assignee', people(m.assignees), m.can.assign ? editButton('Change', 'assign') : null),
    ...(m.reporter ? field('Reporter', el('span', 'person', avatar(m.reporter), m.reporter.name)) : []),
    ...field('Labels', m.labels.length ? el('span', 'labels', ...m.labels.map(labelChip)) : el('span', 'muted', 'None'), m.can.labels ? editButton('Edit', 'labels') : null),
    ...(m.priority ? field('Priority', m.priorityIcon ? iconed(m.priorityIcon, m.priority) : el('span', '', m.priority)) : []),
    ...(m.type ? field('Type', iconed(m.typeIcon, m.type)) : []),
    ...field('Created', when(m.created)),
    ...field('Updated', when(m.updated)),
  );
  const side = el('aside', 'ticket-side', el('section', 'side-panel', el('h2', '', 'Details'), details));
  if (m.acc) {
    const a = m.acc;
    side.append(el('section', `side-panel${a.look.tone === 'orange' ? ' attention' : ''}`, el('h2', '', icon('hubot'), 'Agent'),
      el('dl', 'fields',
        ...field('State', status(a.look)),
        ...field('Environment', el('span', 'mono', a.environment)),
        ...(a.waitingOn.length ? field('Waiting on', a.waitingOn.join(', ')) : []),
        ...(a.blocker ? field('Blocked', el('span', 'tone-orange', a.blocker)) : []),
        ...(a.agent && a.agent.label !== a.look.label ? field('Session', status(a.agent)) : []),
        ...(a.branch ? field('Branch', clippedSpan(a.branch)) : []),
        ...(a.worktree ? field('Worktree', clippedSpan(a.worktree.split('/').slice(-2).join('/'))) : []),
      ),
      a.checks.length ? el('div', 'checks', el('h3', '', 'Checks'), ...a.checks.map((c) => el('div', 'check',
        status({ label: c.status === 'skip' ? (c.summary.startsWith('Not run') ? 'not run' : 'skip') : c.status, icon: c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'error' : c.status === 'error' ? 'warning' : 'circle-slash', tone: c.status === 'pass' ? 'blue' : c.status === 'skip' ? 'neutral' : 'orange' }),
        el('span', 'mono', c.gate), Object.assign(el('span', 'muted small check-sum', c.summary), { title: c.summary })))) : null,
      el('div', 'actions', ...a.actions.map(actionButton))));
  } else if (m.trackable) {
    const track = el('button', 'btn primary', icon('add'), 'Track in acc') as HTMLButtonElement;
    track.type = 'button';
    track.addEventListener('click', () => ticketAction('track'));
    side.append(el('section', 'side-panel', el('h2', '', icon('hubot'), 'Agent'), el('p', 'muted', 'acc isn\'t keeping this ticket yet. Track it to dispatch an agent to it. The ticket itself isn\'t changed.'), el('div', 'actions', track)));
  }
  out.push(el('div', 'ticket-grid', main, side));
  return out;
}

function clippedSpan(text: string): HTMLElement {
  const s = el('span', 'mono clip-inline', text);
  s.title = text;
  return s;
}

function renderAgents(m: AgentsModel): Node[] {
  const all = m.places.flatMap((p) => p.agents);
  const needs = all.filter((a) => a.needsYou).length;
  const out: Node[] = [header('Agents', m.error ?? `${plural(all.length, 'session')} on this machine${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}.`, toolbarButton('acc.agent.new', 'Start a background agent', 'add', m.places.find((p) => p.root)?.root ?? undefined, true))];
  if (!all.length) {
    out.push(empty('No Claude Code sessions are running. Background agents keep working when the terminal closes, and edit in their own worktree.'));
    return out;
  }
  // One table with a heading row per place, so the columns line up all the way down.
  const table = el('table', 'grid');
  table.append(el('thead', '', el('tr', '', ...[['Session', ''], ['State', ''], ['Kind', 'kind'], ['Where', 'wide'], ['Started', 'started'], ['', '']].map(([h, c]) => el('th', c!, h!)))));
  for (const place of m.places) {
    if (!place.agents.length && !place.root) continue;
    const body = el('tbody');
    body.append(el('tr', 'group', span(el('th', '', icon(place.root ? 'repo' : 'device-desktop'), place.label, el('span', 'count', String(place.agents.length))), 6)));
    if (!place.agents.length) body.append(el('tr', 'none', span(el('td', 'muted', 'No agent sessions in this project right now.'), 6)));
    for (const a of place.agents) {
      const row = el('tr', a.needsYou ? 'attention' : '',
        clipped(a.name, 'strong name'), el('td', 'nowrap', status(a.look)), el('td', 'nowrap muted kind', a.kind), clipped(a.where, 'mono'), el('td', 'nowrap muted started', since(a.startedAt)),
        el('td', 'actions', menuButton(a.name)));
      body.append(withMenu(row, 'agent', { session: a.key }, { agentBackground: a.background }));
    }
    table.append(body);
  }
  out.push(wrap(table));
  return out;
}

function renderWorktrees(m: WorktreesModel): Node[] {
  if (!m.projects.length) return [header('Worktrees', 'No onboarded project in this workspace.'), empty('Worktrees appear here once this folder is an onboarded project.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  const out: Node[] = [header('Worktrees', 'Each checkout of the repo. Agents get their own, so your folder stays as you left it.')];
  // One table with a heading row per project, like Agents, so the columns line up.
  const table = el('table', 'grid');
  table.append(el('thead', '', el('tr', '', ...[['Branch', ''], ['Location', 'wide'], ['Changes', ''], ['', '']].map(([h, c]) => el('th', c!, h!)))));
  for (const p of m.projects) {
    const body = el('tbody');
    body.append(el('tr', 'group', span(el('th', '', icon('repo'), p.name, el('span', 'count', String(p.worktrees.length))), 4)));
    for (const w of p.worktrees) {
      const branch = el('td', 'clip name strong', icon(w.main ? 'repo' : 'git-branch'), w.branch);
      branch.title = w.branch;
      const row = el('tr', w.state.tone === 'orange' ? 'attention' : '',
        branch, clipped(w.place, 'mono'), el('td', 'nowrap', status(w.state)), el('td', 'actions', menuButton(w.branch)));
      body.append(withMenu(row, 'worktree', { project: p.root, worktree: w.path }, { worktreeLinked: !w.main }));
    }
    table.append(body);
  }
  out.push(wrap(table));
  return out;
}

function renderEnvironments(m: EnvironmentsModel): Node[] {
  if (!m.projects.length) return [header('Environments', 'No onboarded project in this workspace.'), empty('Environments appear here once this folder is an onboarded project.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  const out: Node[] = [header('Environments', 'Each environment has its own branch, named after it. Changes move between them by pull request.')];
  for (const p of m.projects) {
    const section = el('section', 'block', el('h2', '', icon('repo'), p.name, p.github ? el('span', 'muted', ` · ${p.github}`) : null));
    if (p.paths.length) {
      const flow = el('div', 'flows');
      for (const path of p.paths) {
        const line = el('div', 'flow');
        path.forEach((b, i) => {
          if (i) line.append(el('span', 'arrow', icon('arrow-right')));
          line.append(el('span', 'flow-node', b));
        });
        flow.append(line);
      }
      section.append(el('h3', '', 'Promotion paths'), flow);
    }
    const cards = el('div', 'env-cards');
    for (const e of p.envs) {
      cards.append(el('article', `env-card${e.current ? ' current' : ''}`,
        el('div', 'env-head', icon(e.icon, e.current ? 'blue' : 'neutral'), el('span', 'strong', e.name), el('span', 'chip', e.type === 'none' ? 'branch' : e.type.replace('_', ' '))),
        el('dl', '',
          el('dt', '', 'Branch'), el('dd', 'mono', e.branch),
          el('dt', '', 'Org'), el('dd', 'mono', e.org ?? (e.type === 'none' ? '–' : 'no alias')),
          el('dt', '', 'Promotes to'), el('dd', 'mono', e.promotesTo.length ? e.promotesTo.join(', ') : '–')),
        e.badges.length ? el('div', 'badges', ...e.badges.map((b) => el('span', `badge${b === 'checked out' ? ' tone-blue' : ''}`, b))) : null,
        el('div', 'actions', ...e.actions.map(actionButton)),
      ));
    }
    section.append(cards);
    out.push(section);
  }
  return out;
}

function renderSetup(m: SetupModel): Node[] {
  const todo = m.total - m.done;
  const out: Node[] = [header('Setup', m.total ? `${m.done} of ${m.total} steps done${todo ? `. ${plural(todo, 'step')} to do.` : '. Everything is set up.'}` : 'Checking…',
    toolbarButton('acc.openProjectWalkthrough', 'Walkthrough', 'checklist'))];
  if (m.total) {
    const bar = el('div', 'progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(m.done));
    bar.setAttribute('aria-valuemax', String(m.total));
    const fill = el('div', 'progress-fill');
    fill.style.width = `${Math.round((m.done / m.total) * 100)}%`;
    bar.append(fill);
    out.push(bar);
  }
  for (const part of m.parts) {
    const list = el('ul', 'steps');
    for (const s of part.steps) {
      list.append(el('li', `step${s.look.tone === 'orange' ? ' attention' : ''}`,
        el('div', 'step-head', status(s.look), el('span', 'strong', s.title), el('span', 'muted mono', s.id)),
        el('p', 'detail', s.detail),
        s.look.tone === 'orange' && s.why ? el('p', 'why', s.why) : null,
        s.fix && s.look.tone === 'orange' ? el('pre', 'fix', s.fix) : null,
        el('div', 'actions', ...s.actions.map(actionButton))));
    }
    out.push(el('section', 'block', el('h2', '', icon(part.part === 'machine' ? 'device-desktop' : 'repo'), part.label, el('span', 'count', part.todo ? `${part.todo} to do` : 'all done')), list));
  }
  return out;
}

let last: Model | null = null;

function render(model: Model): void {
  last = model;
  const scroll = { x: document.querySelector('.board')?.scrollLeft ?? 0, y: window.scrollY };
  const nodes = model.kind === 'tasks' ? renderTasks(model)
    : model.kind === 'ticket' ? renderTicket(model)
    : model.kind === 'agents' ? renderAgents(model)
      : model.kind === 'worktrees' ? renderWorktrees(model)
        : model.kind === 'environments' ? renderEnvironments(model)
          : renderSetup(model);
  app.replaceChildren(...nodes);
  const board = document.querySelector('.board');
  if (board) board.scrollLeft = scroll.x;
  window.scrollTo(0, scroll.y);
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as { type?: string; model?: Model; action?: string; ok?: boolean };
  if (msg?.type === 'state' && msg.model && msg.model.kind === view) render(msg.model);
  if (msg?.type === 'done') onDone(msg);
});
api.postMessage({ type: 'ready' });
