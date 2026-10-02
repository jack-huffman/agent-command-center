// Renders one editor tab. Every element is built with DOM calls and every string is set as text,
// so nothing from a ticket, branch or session can become markup. No HTML string is ever parsed.
import type {
  Action, AgentModel, AgentsModel, EntryView, EnvironmentsModel, HomeModel, HomeSection, IdentityCard, Look, Model, PersonChip, QuestionCard, Ref, RunCard, SetupModel, TasksModel, TicketModel, TrackerBoard, TrackerCard, ViewKind, WorktreesModel,
} from '../src/model.ts';
import type { Block, Doc, Inline } from '../../packages/core/src/trackers/doc.ts';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const api = acquireVsCodeApi();
const app = document.getElementById('app')!;
const view = document.body.dataset.view as ViewKind | 'ticket' | 'home' | 'agent';

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

/** A half-made answer to an agent's question, kept while the page redraws. */
interface Draft { picks: Record<number, string[]>; other: Record<number, string>; denying: boolean; reason: string; sent: boolean }

/**
 * Per-tab memory that survives re-renders and the tab being hidden: board modes, comment drafts, answers
 * being written, the output panel, and which of an agent's steps are opened.
 */
interface Memory {
  modes: Record<string, 'tracker' | 'agents'>;
  drafts: Record<string, string>;
  section?: HomeSection;
  answers: Record<string, Draft>;
  dock: { open: boolean; run: string | null };
  opened: string[];
}
function memory(): Memory {
  const s = (api.getState() as Partial<Memory> | undefined) ?? {};
  return { modes: s.modes ?? {}, drafts: s.drafts ?? {}, section: s.section, answers: s.answers ?? {}, dock: s.dock ?? { open: false, run: null }, opened: s.opened ?? [] };
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
      el('h2', '', icon(KIND_ICON[b.kind] ?? 'issues'), b.title, b.source ? el('span', 'chip', SOURCE_LABEL[b.source] ?? b.source) : null, b.signedInAs ? el('span', 'acting', icon('account'), `as ${b.signedInAs}`) : null, b.loading ? el('span', 'muted loading', icon('sync~spin'), 'Loading') : null),
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
  const keys = navigator.platform.includes('Mac') ? '⌘ Enter to post' : 'Ctrl+Enter to post';
  const hint = el('span', 'muted small', m.signedInAs ? el('span', 'acting', icon('account'), `Commenting as ${m.signedInAs}`) : null, m.signedInAs ? ' · ' : null, keys);
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

// ---------------------------------------------------------------- agents' questions (D-030)

function draftOf(id: string): Draft {
  return memory().answers[id] ?? { picks: {}, other: {}, denying: false, reason: '', sent: false };
}
function saveDraft(id: string, change: (d: Draft) => void): void {
  remember((m) => { const d = m.answers[id] ?? { picks: {}, other: {}, denying: false, reason: '', sent: false }; change(d); m.answers[id] = d; });
}

/** Sends an answer, and shows it's on its way until the question leaves the page. */
function sendAnswer(q: QuestionCard, msg: Record<string, unknown>): void {
  saveDraft(q.id, (d) => { d.sent = true; });
  api.postMessage({ type: 'answer', id: q.id, ...msg });
  if (last) render(last);
}

function button(label: string, iconName: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', `btn ${cls}`.trim(), icon(iconName), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/** A text box that keeps its words, and its place, when the page redraws. */
function keptInput(key: string, value: string, placeholder: string, onInput: (v: string) => void, onEnter?: () => void, type = 'text'): HTMLInputElement {
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

/**
 * An agent's question, to answer where it's shown: Allow or Deny for a permission prompt, its options for
 * a question. "In the terminal" hands it back to Claude Code's own prompt.
 */
function questionCard(q: QuestionCard, opts: { watch: boolean }): HTMLElement {
  const d = draftOf(q.id);
  // The bell and the words say it needs you; the orange edge only adds to them.
  const head = el('div', 'q-head',
    el('div', 'q-who', icon('bell', 'orange'), el('strong', '', q.who), el('span', '', q.title), q.projectName ? el('span', 'muted', `· ${q.projectName}`) : null),
    when(new Date(q.askedAt).toISOString()));
  const card = el('article', `question${d.sent ? ' sent' : ''}`, head);
  card.setAttribute('aria-label', `${q.who} ${q.title}`);
  const tools: Child[] = [];
  const watch = opts.watch ? button('Watch', 'pulse', () => api.postMessage({ type: 'run', command: 'acc.agent.watch', ref: { session: q.session } }), 'ghost small') : null;
  const terminal = button('In the terminal', 'terminal', () => sendAnswer(q, { decision: 'terminal' }), 'ghost small');
  terminal.title = 'Answer in Claude Code\'s own prompt instead: a terminal attaches to the session';

  if (q.kind === 'permission') {
    if (q.detail && q.code) card.append(el('p', 'q-detail', q.detail));
    if (q.code) card.append(el('pre', 'q-code', q.code));
    else if (q.detail) card.append(el('div', 'q-detail q-plan', q.detail));
    if (d.denying) {
      const send = () => sendAnswer(q, { decision: 'deny', message: draftOf(q.id).reason });
      const reason = keptInput(`deny:${q.id}`, d.reason, 'Tell it why, or what to do instead (optional)', (v) => saveDraft(q.id, (x) => { x.reason = v; }), send);
      card.append(el('div', 'q-deny', reason, el('div', 'actions',
        button('Deny', 'close', send, 'primary'),
        button('Back', 'arrow-left', () => { saveDraft(q.id, (x) => { x.denying = false; }); if (last) render(last); }))));
      requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) reason.focus(); });
    } else {
      tools.push(button('Allow', 'check', () => sendAnswer(q, { decision: 'allow' }), 'primary'));
      if (q.always) tools.push(button(q.always, 'check-all', () => sendAnswer(q, { decision: 'allow', always: true })));
      tools.push(button('Deny…', 'close', () => { saveDraft(q.id, (x) => { x.denying = true; }); if (last) render(last); }));
      tools.push(el('span', 'q-aside', terminal, watch));
    }
  } else {
    const answered = (i: number) => (d.picks[i]?.length ?? 0) > 0 || !!d.other[i]?.trim();
    q.questions.forEach((x, i) => {
      const set = el('fieldset', 'q-set', el('legend', '', x.header ? el('span', 'chip q-chip', x.header) : null, el('span', 'q-question', x.question)));
      const opts = el('div', 'q-options');
      opts.setAttribute('role', x.multiSelect ? 'group' : 'radiogroup');
      for (const o of x.options) {
        const on = d.picks[i]?.includes(o.label) ?? false;
        const b = el('button', `q-option${on ? ' on' : ''}`, icon(x.multiSelect ? (on ? 'pass-filled' : 'circle-large-outline') : (on ? 'circle-filled' : 'circle-large-outline'), on ? 'blue' : undefined),
          el('span', 'q-option-text', el('span', 'strong', o.label), o.description ? el('span', 'muted small', o.description) : null)) as HTMLButtonElement;
        b.type = 'button';
        b.setAttribute('role', x.multiSelect ? 'checkbox' : 'radio');
        b.setAttribute('aria-checked', String(on));
        b.addEventListener('click', () => {
          saveDraft(q.id, (dd) => {
            const now = dd.picks[i] ?? [];
            dd.picks[i] = x.multiSelect ? (now.includes(o.label) ? now.filter((l) => l !== o.label) : [...now, o.label]) : [o.label];
            if (!x.multiSelect) dd.other[i] = '';
          });
          if (last) render(last);
        });
        opts.append(b);
      }
      const other = keptInput(`other:${q.id}:${i}`, d.other[i] ?? '', 'Or type your own answer', (v) => {
        saveDraft(q.id, (dd) => { dd.other[i] = v; if (v.trim() && !x.multiSelect) dd.picks[i] = []; });
        const sendBtn = card.querySelector<HTMLButtonElement>('.q-send');
        if (sendBtn) sendBtn.disabled = !q.questions.every((_, k) => (k === i ? !!v.trim() || (draftOf(q.id).picks[k]?.length ?? 0) > 0 : answered(k)));
      });
      set.append(opts, other);
      card.append(set);
    });
    const send = button(q.questions.length > 1 ? 'Send answers' : 'Send answer', 'send', () => {
      const dd = draftOf(q.id);
      const answers: Record<string, string> = {};
      q.questions.forEach((x, i) => { answers[x.question] = dd.other[i]?.trim() || (dd.picks[i] ?? []).join(', '); });
      sendAnswer(q, { decision: 'allow', answers });
    }, 'primary q-send');
    send.disabled = !q.questions.every((_, i) => answered(i));
    const decide = button('Let it decide', 'sparkle', () => sendAnswer(q, { decision: 'deny', message: 'They chose not to answer: decide for yourself, and say what you chose.' }));
    tools.push(send, decide, el('span', 'q-aside', terminal, watch));
  }
  if (d.sent) card.append(el('div', 'q-sending muted', icon('sync~spin'), 'Sending your answer…'));
  else if (tools.length) card.append(el('div', 'actions q-actions', ...tools));
  return card;
}

// ---------------------------------------------------------------- the output panel (D-030)

let runs: RunCard[] = [];

/** Keeps the output pinned to its newest line, unless you've scrolled up to read. */
function stickToBottom(box: HTMLElement, wasAtBottom: boolean, top: number): void {
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

function renderDock(list: RunCard[]): HTMLElement | null {
  if (!list.length) return null;
  const m = memory().dock;
  const run = list.find((r) => r.id === m.run) ?? list.find((r) => r.running) ?? list[0]!;
  const open = m.open;
  const toggle = () => { remember((x) => { x.dock.open = !open; x.dock.run = run.id; }); redrawDock(); };
  const lastLine = [...run.lines].reverse().find((l) => l.trim()) ?? (run.running ? 'Starting…' : 'No output');
  const bar = el('div', 'dock-bar');
  const head = el('button', 'dock-title', icon('terminal'), el('span', 'strong dock-label', run.label), status(run.look), open || run.prompt ? null : el('span', 'muted mono dock-last', lastLine)) as HTMLButtonElement;
  head.type = 'button';
  head.title = `${run.command}\n\n${open ? 'Hide' : 'Show'} the output`;
  head.setAttribute('aria-expanded', String(open));
  head.addEventListener('click', toggle);
  bar.append(head, el('span', 'spacer'));
  if (list.length > 1) {
    const pick = document.createElement('select');
    pick.className = 'dock-pick';
    pick.setAttribute('aria-label', 'Which command');
    for (const r of list) {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = `${r.running ? '● ' : ''}${r.label.length > 36 ? `${r.label.slice(0, 36)}…` : r.label}`;
      o.selected = r.id === run.id;
      pick.append(o);
    }
    pick.title = 'Show another command\'s output';
    pick.addEventListener('change', () => { remember((x) => { x.dock.run = pick.value; x.dock.open = true; }); redrawDock(); });
    bar.append(el('span', 'muted small dock-count', `${list.indexOf(run) + 1} of ${list.length}`), pick);
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
    const out = el('pre', 'dock-out', run.lines.join('\n'));
    out.dataset.run = run.id;
    out.tabIndex = 0;
    out.setAttribute('aria-label', `Output of ${run.command}`);
    out.setAttribute('aria-live', 'polite');
    dock.append(el('div', 'dock-cmd mono muted', `$ ${run.command}`), out);
  }
  if (run.prompt) {
    const p = run.prompt;
    const key = `run:${run.id}`;
    const send = (text: string) => { remember((x) => { delete x.drafts[key]; }); api.postMessage({ type: 'run-input', run: run.id, text }); };
    const row = el('div', 'dock-ask', icon('bell', 'orange'), el('span', 'dock-ask-text', el('span', 'strong', 'It\'s asking: '), el('span', 'mono', p.text)));
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
function redrawDock(): void {
  const old = document.querySelector<HTMLElement>('.dock');
  const box = old?.querySelector<HTMLElement>('.dock-out');
  const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  const top = box?.scrollTop ?? 0;
  const keep = keepFocus();
  const next = renderDock(runs);
  if (old && next) old.replaceWith(next);
  else if (old) old.remove();
  else if (next) document.querySelector('.home-col')?.append(next);
  const nbox = next?.querySelector<HTMLElement>('.dock-out');
  if (nbox) stickToBottom(nbox, atBottom || box?.dataset.run !== nbox.dataset.run, top);
  keep();
}

/** Remembers which text box had focus, and puts it back after a redraw. */
function keepFocus(): () => void {
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

// ---------------------------------------------------------------- an agent's page (D-030)

function toolEntry(e: Extract<EntryView, { k: 'tool' }>): HTMLElement {
  const look = e.status === 'running' ? { icon: 'sync~spin', tone: 'blue', label: 'Running' } : e.status === 'error' ? { icon: 'warning', tone: 'orange', label: 'Failed' } : { icon: 'pass', tone: 'neutral', label: 'Done' };
  // Done is the usual case and needs no mark; running and failed say so, in words for screen readers.
  const mark = e.status === 'done' ? null : status({ label: look.label, icon: look.icon, tone: look.tone as Look['tone'] });
  const more = !!(e.code?.includes('\n') || e.result || (e.code && e.code.length > 80));
  const line = (...lead: Child[]) => [...lead, icon(e.icon), el('span', 'tool-title', e.title), e.code && !e.code.includes('\n') ? el('code', 'tool-code', e.code) : null, el('span', 'spacer'), mark];
  if (!more) return el('li', `entry tool static${e.status === 'error' ? ' failed' : ''}`, el('div', 'tool-line', ...line(el('span', 'tool-chev'))));
  const summary = el('summary', 'tool-line', ...line(el('span', 'tool-chev', icon('chevron-right'))));
  const details = el('details', 'tool-details', summary,
    e.code ? el('pre', 'tool-pre', e.code) : null,
    e.result ? el('pre', `tool-pre result${e.status === 'error' ? ' failed' : ''}`, e.result) : null,
    e.more ? el('div', 'muted small', `… ${plural(e.more, 'more line')}`) : null) as HTMLDetailsElement;
  details.open = memory().opened.includes(e.id);
  details.addEventListener('toggle', () => remember((m) => { m.opened = details.open ? [...new Set([...m.opened, e.id])].slice(-200) : m.opened.filter((x) => x !== e.id); }));
  return el('li', `entry tool${e.status === 'error' ? ' failed' : ''}`, details);
}

function renderAgent(m: AgentModel): Node[] {
  // A builder's page names its task, which opens the task's own page.
  const name = m.task ? openable(el('span', 'tcard-key', m.task.id), { type: 'run', command: 'acc.task.show', ref: { project: m.task.project, task: m.task.id } }) : el('span', '', m.name);
  const crumbs = el('div', 'crumbs', icon('hubot'), el('span', '', m.task ? 'Builder' : 'Agent'), el('span', 'muted', '/'), name, m.task && m.name !== m.task.id ? el('span', 'muted', `· ${m.name}`) : null);
  const facts = el('div', 'agent-facts muted small',
    m.startedAt ? el('span', '', `Started ${since(m.startedAt)}`) : null,
    m.lastAt ? el('span', '', el('span', 'sep', '·'), 'last active ', when(m.lastAt)) : null,
    m.where ? el('span', '', el('span', 'sep', '·'), el('span', 'mono', m.where)) : null);
  const out: Node[] = [el('header', 'ticket-head agent-head', crumbs, el('h1', 'ticket-title', m.task?.title ?? m.name), facts,
    el('div', 'ticket-bar', status(m.look), el('span', 'spacer'), el('div', 'actions', ...m.actions.map(actionButton))))];
  if (m.questions.length) out.push(el('section', 'agent-asks', ...m.questions.map((q) => questionCard(q, { watch: false }))));
  const recap = [...m.entries].reverse().find((e) => e.k === 'recap');
  if (recap && recap.k === 'recap') out.push(el('div', 'notice recap', icon('info', 'blue'), el('span', '', el('strong', '', 'Where it got to: '), recap.text)));
  if (!m.readable) {
    out.push(empty(m.live ? 'Its activity will show here as it works. Nothing is recorded yet.' : 'There\'s no record of this session\'s activity to show.',
      ...m.actions.filter((a) => a.command === 'acc.agent.attach').map(actionButton)));
    return out;
  }
  const list = el('ol', 'timeline');
  if (m.hidden) list.append(el('li', 'entry muted small', `${plural(m.hidden, 'earlier step')} not shown.`));
  for (const e of m.entries) {
    if (e.k === 'recap') continue;
    if (e.k === 'tool') { list.append(toolEntry(e)); continue; }
    if (e.k === 'prompt' && e.instructions) {
      const d = el('details', 'prompt-details', el('summary', '', icon('note'), el('strong', '', 'Task instructions'), el('span', 'muted small', ' · what it was given to do')), renderDoc(e.body, '')) as HTMLDetailsElement;
      d.open = memory().opened.includes(e.id);
      d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, e.id])] : x.opened.filter((y) => y !== e.id); }));
      list.append(el('li', 'entry prompt', d));
      continue;
    }
    list.append(el('li', `entry ${e.k}`, el('div', 'entry-who', icon(e.k === 'prompt' ? 'account' : 'hubot'), el('span', 'strong', e.k === 'prompt' ? 'Asked' : 'Agent'), e.at ? when(e.at) : null), renderDoc(e.body, '')));
  }
  const tail = m.look.tone === 'blue' && m.live ? el('li', 'entry live', icon('sync~spin', 'blue'), el('span', '', 'Working…'))
    : m.look.tone === 'orange' && !m.questions.length ? el('li', 'entry live', icon('bell', 'orange'), el('span', '', `${m.look.label}. It's waiting in its own terminal.`), ...m.actions.filter((a) => a.command === 'acc.agent.attach').map(actionButton))
      : !m.live ? el('li', 'entry live muted', icon('circle-slash'), el('span', '', 'The session has ended.')) : null;
  if (tail) list.append(tail);
  out.push(list);
  return out;
}

// ---------------------------------------------------------------- the Command Center page (D-029)

let section: HomeSection | null = memory().section ?? null;
let scrolledTo = false;

function setSection(s: HomeSection, tell = true): void {
  if (s !== section) scrolledTo = true;
  section = s;
  remember((m) => { m.section = s; });
  if (tell) api.postMessage({ type: 'nav', section: s });
}

function go(s: HomeSection): void {
  setSection(s);
  if (last) render(last);
  document.querySelector<HTMLElement>('.home-main')?.focus({ preventScroll: true });
}

function logo(): HTMLElement {
  const wrap = el('span', 'brand-mark');
  for (const theme of ['dark', 'light'] as const) {
    const src = document.body.dataset[theme === 'dark' ? 'logoDark' : 'logoLight'];
    if (!src) continue;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.className = `logo-${theme}`;
    wrap.append(img);
  }
  return wrap;
}

function renderNav(m: HomeModel, current: HomeSection): HTMLElement {
  const list = el('div', 'nav-list');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-orientation', 'vertical');
  for (const n of m.nav) {
    const on = n.section === current;
    const b = el('button', `nav-item${on ? ' on' : ''}`, icon(n.icon), el('span', 'nav-label', n.label),
      n.count !== null ? el('span', `nav-count${n.attention ? ' attention' : ''}`, String(n.count)) : n.attention ? el('span', 'nav-count attention', icon('warning')) : null) as HTMLButtonElement;
    b.type = 'button';
    b.title = n.hint;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(on));
    b.setAttribute('aria-label', `${n.label}: ${n.hint}`);
    b.tabIndex = on ? 0 : -1;
    b.addEventListener('click', () => go(n.section));
    list.append(b);
  }
  // Arrow keys move between sections, as in any tab list.
  list.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll<HTMLButtonElement>('.nav-item')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (next === null || i < 0) return;
    e.preventDefault();
    const target = items[(next + items.length) % items.length]!;
    target.focus();
    target.click();
  });
  const people = m.overview.projects.filter((p) => p.account).map((p) => {
    const b = el('button', 'rail-account', icon('github'), el('span', 'rail-account-name', p.account!), m.overview.projects.length > 1 ? el('span', 'muted small', p.name) : null) as HTMLButtonElement;
    b.type = 'button';
    b.title = `${p.name} works as ${p.account} on GitHub. Switch account`;
    b.addEventListener('click', () => api.postMessage({ type: 'toolbar', command: 'acc.github.switch', arg: p.root }));
    return b;
  });
  return el('nav', 'rail', el('div', 'brand', logo(), el('div', 'brand-text', el('span', 'brand-name', 'Command Center'),
    el('span', 'muted small', m.overview.projects.map((p) => p.name).join(', ') || 'No project yet'))), list, el('div', 'rail-foot', ...people));
}

function sectionTitle(title: string, summary: string, ...tools: Child[]): HTMLElement {
  return header(title, summary, ...tools);
}

function renderOverview(m: HomeModel): Node[] {
  const o = m.overview;
  const people = o.questions.length + o.attention.filter((a) => a.look.tone === 'orange').length;
  const project = o.projects[0];
  const summary = [
    people ? `${people} thing${people === 1 ? '' : 's'} need${people === 1 ? 's' : ''} you` : 'Nothing needs you right now',
    project ? `${project.name}${project.branch ? ` on ${project.branch}` : ''}` : '',
    project?.trackers.length ? project.trackers.join(' and ') : '',
  ].filter(Boolean).join(' · ');
  const root = project?.root;
  const tools: Child[] = root ? [
    toolbarButton('acc.task.add', 'Add task', 'add', root, true),
    toolbarButton('acc.agent.new', 'Start an agent', 'hubot', root),
    toolbarButton('acc.trackers.add', 'Add a tracker', 'plug', root),
  ] : [toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true)];
  const out: Node[] = [sectionTitle('Overview', summary, ...tools)];

  // What needs a person, first and alone at the top. Work waiting for review follows, as its own group.
  const inbox = el('section', `inbox${people ? ' attention' : ''}`, el('h2', '', icon(people ? 'bell-dot' : 'pass', people ? 'orange' : 'blue'), people ? 'Needs you' : 'All clear',
    people ? el('span', 'count', String(people)) : null));
  if (!people) inbox.append(el('p', 'muted quiet', 'No agent is waiting, nothing is blocked, and setup is done.'));
  // Questions first, each answered right here.
  for (const q of o.questions) inbox.append(questionCard(q, { watch: true }));
  let captioned = false;
  for (const a of o.attention) {
    if (a.look.tone !== 'orange' && !captioned) {
      captioned = true;
      inbox.append(el('div', 'inbox-caption', 'Waiting on you, when you have a moment'));
    }
    const buttons: Child[] = a.actions.map(actionButton);
    if (a.extra) buttons.push(argButton(a.extra.command, a.extra.label, a.extra.icon, a.extra.arg, true));
    if (a.go) {
      const g = a.go;
      const b = el('button', 'btn', icon('arrow-right'), g.label) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => go(g.section));
      buttons.push(b);
    }
    inbox.append(el('div', `inbox-row tone-row-${a.look.tone}`, status(a.look), el('div', 'inbox-text', el('div', 'strong inbox-title', a.title), el('div', 'muted small', a.detail)), el('div', 'actions', ...buttons)));
  }
  out.push(inbox);

  // At a glance: each tile opens its section.
  const tiles = el('div', 'tiles');
  for (const s of o.stats) {
    const tile = el('button', `tile tone-edge-${s.tone}`, el('div', 'tile-top', icon(s.icon, s.tone === 'neutral' ? undefined : s.tone), el('span', 'tile-label', s.label)), el('div', 'tile-value', s.value), el('div', 'muted small', s.hint)) as HTMLButtonElement;
    tile.type = 'button';
    tile.addEventListener('click', () => go(s.section));
    tiles.append(tile);
  }
  out.push(tiles);

  // Ready work beside what just happened.
  const ready = el('section', 'panel-box', el('h2', '', icon('rocket'), 'Ready for an agent', o.ready.length ? el('span', 'count', String(o.ready.length)) : null));
  if (!o.ready.length) ready.append(el('p', 'muted quiet', 'Nothing is ready to dispatch. Track a ticket from a board, or add a task.'));
  for (const r of o.ready.slice(0, 8)) {
    ready.append(el('div', 'list-row', openable(el('div', 'list-text', el('span', 'tcard-key', r.id), el('span', '', r.title)), { type: 'run', command: 'acc.task.show', ref: r.action.ref }),
      el('span', 'chip', r.environment), actionButton(r.action)));
  }
  const activity = el('section', 'panel-box', el('h2', '', icon('history'), 'Recent activity'));
  if (!o.activity.length) activity.append(el('p', 'muted quiet', 'Moves tasks make show up here.'));
  const feed = el('ol', 'feed');
  for (const a of o.activity) {
    feed.append(el('li', '', el('span', 'feed-dot'), el('div', '',
      el('div', '', el('span', 'tcard-key', a.task), ' ', el('span', '', a.title)),
      el('div', 'muted small', when(a.at), ` · ${a.from ?? 'new'} → `, el('strong', '', a.to), ` · ${a.by.replace(/^human:/, '')}`, o.projects.length > 1 ? ` · ${a.project}` : ''))));
  }
  if (o.activity.length) activity.append(feed);
  out.push(el('div', 'two-up', ready, activity));
  return out;
}

function renderHome(m: HomeModel): Node[] {
  const current = section ?? m.section;
  const content = current === 'overview' ? renderOverview(m)
    : current === 'tasks' ? renderTasks(m.tasks)
      : current === 'agents' ? renderAgents(m.agents)
        : current === 'worktrees' ? renderWorktrees(m.worktrees)
          : current === 'environments' ? renderEnvironments(m.environments)
            : renderSetup(m.setup, m.runs);
  const main = el('div', 'home-main', ...content);
  main.tabIndex = -1;
  main.setAttribute('role', 'tabpanel');
  // The output panel sits under the section, on every section, while there's output to show.
  return [el('div', 'home', renderNav(m, current), el('div', 'home-col', main, renderDock(runs)))];
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
        openable(clipped(a.name, 'strong name'), { type: 'run', command: 'acc.agent.watch', ref: { session: a.key } }), el('td', 'nowrap', status(a.look)), el('td', 'nowrap muted kind', a.kind), clipped(a.where, 'mono'), el('td', 'nowrap muted started', since(a.startedAt)),
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

/** A button that runs a command with one argument, such as the project it's for. */
function argButton(command: string, label: string, iconName: string, arg: string, primary = false): HTMLElement {
  const b = el('button', `btn${primary ? ' primary' : ''}`, icon(iconName), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => api.postMessage({ type: 'toolbar', command, arg }));
  return b;
}

/**
 * Who this repo is on GitHub: the account, where that's set, and whether gh and git push agree. Anything
 * wrong says so in words and with an icon, and the card gains an orange edge.
 */
function identityCard(root: string, repo: string, id: IdentityCard): HTMLElement {
  const big = el('span', 'avatar avatar-lg', id.initials);
  big.setAttribute('aria-hidden', 'true');
  const where = el('span', `chip${id.from === 'clone' ? ' chip-blue' : ''}`, id.from === 'clone' ? 'This clone' : 'Project default');
  where.title = id.from === 'clone' ? `Chosen for this clone only, in git config. The project's account is ${id.projectAccount}.` : 'From .acc/config.json';
  const line = (iconName: string, tone: string | undefined, ...text: Child[]) => el('div', 'id-line', icon(iconName, tone), el('span', '', ...text));
  const pushOk = !id.pushesAs || id.pushesAs.toLowerCase() === id.account.toLowerCase();
  const profile = el('button', 'btn ghost', icon('link-external'), 'Profile') as HTMLButtonElement;
  profile.type = 'button';
  profile.addEventListener('click', () => api.postMessage({ type: 'open', url: id.profile }));
  return el('article', `identity${id.problem ? ' attention' : ''}`,
    el('div', 'id-head', big, el('div', 'id-who',
      el('div', 'id-name', el('span', 'strong', id.account), where),
      el('div', 'muted small', `GitHub account for ${repo || 'this repo'}${id.from === 'clone' ? ` · the project's is ${id.projectAccount}` : ''}`))),
    el('div', 'id-lines',
      id.signedIn
        ? line('pass', 'blue', 'gh is signed in', id.scopes.length ? el('span', 'scopes', ...id.scopes.map((s) => el('span', `scope${s === 'project' ? ' scope-on' : ''}`, s))) : null)
        : line('warning', 'orange', el('strong', '', `gh isn't signed in as ${id.account}`)),
      id.signedIn && !id.projects ? line('info', undefined, el('span', 'muted', 'No GitHub Projects access yet, which a Project\'s board needs. Sign in again to add it.')) : null,
      id.pushesAs ? line(pushOk ? 'repo-push' : 'warning', pushOk ? undefined : 'orange', pushOk ? `git push as ${id.pushesAs}` : el('strong', '', `git push would use ${id.pushesAs}`)) : line('warning', 'orange', 'git push isn\'t set up by acc for this repo'),
      id.commit ? line('git-commit', undefined, `Commits as ${id.commit}`) : line('warning', 'orange', 'No commit identity set for this repo')),
    el('div', 'actions',
      argButton('acc.github.switch', id.others ? 'Switch account' : 'Add or switch account', 'arrow-swap', root, true),
      !id.signedIn ? argButton('acc.github.signIn', 'Sign in', 'github', root) : !id.projects ? argButton('acc.github.signIn', 'Add Projects access', 'github', root) : null,
      profile));
}

function renderEnvironments(m: EnvironmentsModel): Node[] {
  if (!m.projects.length) return [header('Environments', 'No onboarded project in this workspace.'), empty('Environments appear here once this folder is an onboarded project.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  const out: Node[] = [header('Environments', 'Each environment has its own branch, named after it. Changes move between them by pull request.')];
  for (const p of m.projects) {
    const section = el('section', 'block', el('h2', '', icon('repo'), p.name, p.identity ? null : p.github ? el('span', 'muted', ` · ${p.github}`) : null));
    if (p.identity) section.append(identityCard(p.root, p.github?.split(' as ')[0] ?? '', p.identity));
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

/** A step's fix while it runs, or how it ended: one line, and a way to its output. */
function stepRun(r: RunCard | undefined, open: boolean): HTMLElement | null {
  // A failed run matters only while its step is still to do.
  if (!r || (!r.running && !(open && r.look.tone === 'orange'))) return null;
  const show = button('Show output', 'output', () => { remember((x) => { x.dock = { open: true, run: r.id }; }); redrawDock(); }, 'ghost small');
  return el('div', `step-run tone-row-${r.look.tone}`, status(r.look), el('span', 'muted mono step-run-cmd', r.command), show);
}

function renderSetup(m: SetupModel, live: RunCard[] = []): Node[] {
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
        stepRun(live.find((r) => r.step === s.id), s.look.tone === 'orange'),
        el('div', 'actions', ...s.actions.map(actionButton))));
    }
    out.push(el('section', 'block', el('h2', '', icon(part.part === 'machine' ? 'device-desktop' : 'repo'), part.label, el('span', 'count', part.todo ? `${part.todo} to do` : 'all done')), list));
  }
  return out;
}

let last: Model | null = null;

function render(model: Model): void {
  last = model;
  if (model.kind === 'home') runs = model.runs;
  const scroller = document.querySelector('.home-main') ?? document.scrollingElement;
  const scroll = { x: document.querySelector('.board')?.scrollLeft ?? 0, y: scroller?.scrollTop ?? 0 };
  // An agent's page follows its newest step, unless you've scrolled up to read.
  const following = model.kind === 'agent' && !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const dockBox = document.querySelector<HTMLElement>('.dock-out');
  const dockAtBottom = !dockBox || dockBox.scrollHeight - dockBox.scrollTop - dockBox.clientHeight < 24;
  const dockTop = dockBox?.scrollTop ?? 0;
  const keep = keepFocus();
  const nodes = model.kind === 'home' ? renderHome(model)
    : model.kind === 'agent' ? renderAgent(model)
    : model.kind === 'tasks' ? renderTasks(model)
    : model.kind === 'ticket' ? renderTicket(model)
    : model.kind === 'agents' ? renderAgents(model)
      : model.kind === 'worktrees' ? renderWorktrees(model)
        : model.kind === 'environments' ? renderEnvironments(model)
          : renderSetup(model);
  app.replaceChildren(...nodes);
  const board = document.querySelector('.board');
  if (board) board.scrollLeft = scroll.x;
  const main = document.querySelector('.home-main');
  if (main && !scrolledTo) main.scrollTop = scroll.y;
  else if (following) window.scrollTo(0, document.body.scrollHeight);
  else if (!main) window.scrollTo(0, scroll.y);
  scrolledTo = false;
  const box = document.querySelector<HTMLElement>('.dock-out');
  if (box) stickToBottom(box, dockAtBottom, dockTop);
  keep();
  // Half-written answers to questions that have gone are dropped.
  const asked = model.kind === 'home' ? model.overview.questions : model.kind === 'agent' ? model.questions : null;
  if (asked) {
    const ids = new Set(asked.map((q) => q.id));
    if (Object.keys(memory().answers).some((k) => !ids.has(k))) remember((x) => { for (const k of Object.keys(x.answers)) if (!ids.has(k)) delete x.answers[k]; });
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as { type?: string; model?: Model; action?: string; ok?: boolean; jump?: boolean };
  if (msg?.type === 'state' && msg.model && msg.model.kind === view) {
    // The extension moves the page only when asked to open a section; otherwise it stays where you are.
    if (msg.model.kind === 'home' && (msg.jump || !section)) setSection(msg.model.section, false);
    render(msg.model);
  }
  if (msg?.type === 'done') onDone(msg);
  // Output from a command acc is running: only the output panel redraws.
  if (msg?.type === 'runs' && view === 'home') {
    const m = msg as unknown as { runs: RunCard[]; focus?: string };
    runs = m.runs;
    if (last?.kind === 'home') last = { ...last, runs };
    if (m.focus) remember((x) => { x.dock = { open: true, run: m.focus! }; });
    redrawDock();
  }
});
api.postMessage({ type: 'ready' });
