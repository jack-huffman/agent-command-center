// A ticket's page: the ticket, its fields, its comments and its activity.

import type { Look } from '../src/model/shared.ts';
import type { PersonChip } from '../src/model/boards.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { renderAnalysis } from './analysis.ts';
import { actionButton, avatar, button, type Child, clippedSpan, el, foldable, icon, iconed, labelChip, linkTo, openable, renderDoc, status, when } from './dom.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';
import { KIND_ICON, KIND_NAME } from './tasks.ts';
import { updateDraft } from './updates.ts';

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

export function renderTicket(m: TicketModel): Node[] {
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
  // Outside the repo's place (D-072): said plainly, and only a person's call when acc keeps a task for it.
  if (m.outside) out.push(el('div', `notice${m.acc ? ' attention' : ''}`, icon(m.acc ? 'warning' : 'filter', m.acc ? 'orange' : undefined), el('span', '', m.outside)));

  // Summary first, details on demand: why it's stuck, in one line, before anything else, then its
  // analysis (D-052). The main column follows: description, related tickets, then activity.
  const top = el('div', `ticket-top${m.analysis?.look.tone === 'orange' ? ' attention' : ''}`);
  if (m.acc?.blocker) top.append(foldable(`blocker:${m.project}#${m.key}`, el('div', 'notice attention why', icon('circle-slash', 'orange'), el('div', 'why-text', el('strong', '', 'Why it\'s blocked: '), m.acc.blocker)), 'why-text', 2));
  if (m.acc?.conflicts) {
    const [head, ...files] = m.acc.conflicts.split(': ');
    top.append(foldable(`conflicts:${m.project}#${m.key}`, el('div', 'notice attention why', icon('warning', 'orange'), el('div', 'why-text conflict', el('strong', '', `${head}: `), files.join(': '))), 'why-text', 2));
  }
  // Its checks failed on GitHub, or autopilot sent it back for them (D-076), in orange with an icon.
  if (m.acc?.failedChecks) {
    const [head, ...names] = m.acc.failedChecks.split(': ');
    top.append(foldable(`checks:${m.project}#${m.key}`, el('div', 'notice attention why', icon('github-action', 'orange'), el('div', 'why-text conflict', el('strong', '', `${head}: `), names.join(': '))), 'why-text', 2));
  }
  // Its files beside other tasks', each file in full (D-093): the icon and the words, in the look's tone.
  if (m.acc?.files) {
    const f = m.acc.files;
    const [head, ...rest] = f.label.split(': ');
    const tone = f.tone === 'orange' ? ' attention' : f.tone === 'blue' ? ' waits' : '';
    top.append(foldable(`files:${m.project}#${m.key}`, el('div', `notice${tone} why`, icon(f.icon, f.tone), el('div', 'why-text', el('strong', '', rest.length ? `${head}: ` : head), rest.join(': '))), 'why-text', 2));
  }
  if (m.analysis) top.append(renderAnalysis(m, m.analysis));
  const main = el('div', 'ticket-main');
  main.append(el('section', 'block', el('h2', '', 'Description'), m.loading && !m.body.blocks.length ? el('p', 'muted', 'Loading…') : foldable(`desc:${m.project}#${m.key}`, renderDoc(m.body, 'No description.'), null, 6)));
  if (m.related.length) {
    main.append(el('section', 'block', el('h2', '', 'Related'), el('ul', 'related', ...m.related.map((r) => {
      const name = /^[A-Z][A-Z0-9_]*-\d+$/i.test(r.key) ? openable(el('span', 'tcard-key', r.key), { type: 'ticket', project: m.project, tracker: m.tracker, key: r.key }) : el('span', 'tcard-key', r.key);
      return el('li', '', el('span', 'muted rel', r.relation), name, r.title ? el('span', '', r.title) : null);
    }))));
  }
  const activity = renderActivity(m);
  if (activity) main.append(activity);

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

        ...(a.agent && a.agent.label !== a.look.label ? field('Session', status(a.agent)) : []),
        ...(a.agent && a.model ? field('Model', el('span', 'mono', a.model)) : []),
        // What its builder is called, in Claude Code and the Command Center alike (D-087).
        ...(a.agentName ? field('Builder', el('span', 'agent-name', a.agentName)) : []),
        ...(a.branch ? field('Branch', clippedSpan(a.branch)) : []),
        ...(a.worktree ? field('Worktree', clippedSpan(a.worktree.split('/').slice(-2).join('/'))) : []),
      ),
      a.checks.length ? el('div', 'checks', el('h3', '', 'Checks'), ...a.checks.map((c) => el('div', 'check',
        status({ label: c.waived ? 'waived' : c.status === 'skip' ? (c.summary.startsWith('Not run') ? 'not run' : 'skip') : c.status, icon: c.waived ? 'debug-step-over' : c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'error' : c.status === 'error' ? 'warning' : 'circle-slash', tone: c.status === 'pass' ? 'blue' : c.status === 'skip' ? 'neutral' : 'orange' }),
        // A builder's lighter check, or the full one the merge queue runs once (GH-73).
        el('span', 'check-gate', el('span', 'mono', c.gate),
          c.scope ? Object.assign(el('span', 'chip', c.scope === 'builder' ? 'builder' : 'merge queue'), { title: c.scope === 'builder' ? 'One of the lighter checks a builder runs before acc done' : 'The full check, run once in the merge queue before the merge' }) : null),
        Object.assign(el('span', 'muted small check-sum', c.summary), { title: c.summary }),
        // A person can set a failing check aside, with a reason (D-031).
        (c.status === 'fail' || c.status === 'error') && a.branch ? Object.assign(button('Waive…', 'debug-step-over', () => ticketAction('waive', c.gate), 'ghost small check-waive'), { title: `Set ${c.gate} aside on this commit, with a reason` }) : null))) : null,
      el('div', 'actions', ...a.actions.map(actionButton))));
  } else if (m.trackable) {
    // Tracking… while it's on its way, from here or its card, so a second click starts nothing (D-074).
    const show = (on: boolean) => {
      track.replaceChildren(icon(on ? 'sync~spin' : 'add'), on ? 'Tracking…' : 'Track in acc');
      track.disabled = on;
    };
    const track = el('button', 'btn primary ticket-track') as HTMLButtonElement;
    track.type = 'button';
    show(m.tracking);
    track.addEventListener('click', () => {
      if (track.disabled) return;
      show(true);
      ticketAction('track');
    });
    side.append(el('section', 'side-panel', el('h2', '', icon('hubot'), 'Agent'), el('p', 'muted', 'acc isn\'t keeping this ticket yet. Track it to dispatch an agent to it. The ticket itself isn\'t changed.'), el('div', 'actions', track)));
  }
  out.push(el('div', 'ticket-grid', top.childElementCount ? top : null, main, side));
  return out;
}

/** How each state reads in the feed: its word, its icon, and orange or blue (never red against green). */
const STATE_LOOK: Record<string, Look> = {
  todo: { label: 'To do', icon: 'circle-outline', tone: 'neutral' },
  running: { label: 'Running', icon: 'sync', tone: 'blue' },
  review: { label: 'In review', icon: 'eye', tone: 'blue' },
  rework: { label: 'Rework', icon: 'debug-restart', tone: 'orange' },
  blocked: { label: 'Blocked', icon: 'circle-slash', tone: 'orange' },
  done: { label: 'Done', icon: 'check', tone: 'blue' },
};

/** What a move did, as the feed's icon and verb: the state it reached shows as a pill after the verb. */
function moveFeed(h: { from: string | null; to: string; by: string }): { icon: string; tone: Look['tone']; verb: string; pill: boolean } {
  const sync = /^sync|^acc sync/.test(h.by);
  if (!h.from) return { icon: 'add', tone: 'neutral', verb: 'added it', pill: false };
  if (h.to === 'running') return h.from === 'rework' ? { icon: 'debug-restart', tone: 'blue', verb: 'sent it back to its agent', pill: false } : { icon: 'rocket', tone: 'blue', verb: 'started its agent', pill: false };
  // Only autopilot's send-back for checks that failed on GitHub is the orchestrator's move to rework (D-076).
  // Core's sentBackForChecks (D-076), which this page can't import: autopilot's own move, not a review made for it.
  if (h.to === 'rework' && h.from === 'review' && h.by === 'orchestrator:autopilot') return { icon: 'github-action', tone: 'orange', verb: 'sent it back to its builder', pill: false };
  if (h.to === 'rework') return { icon: 'request-changes', tone: 'orange', verb: 'asked for changes', pill: false };
  if (h.to === 'blocked') return { icon: 'circle-slash', tone: 'orange', verb: 'blocked it', pill: false };
  if (h.to === 'done') return { icon: sync ? 'git-merge' : 'check', tone: 'blue', verb: sync ? 'merged its pull request:' : 'moved it to', pill: true };
  const look = STATE_LOOK[h.to];
  return { icon: look?.icon ?? 'arrow-right', tone: look?.tone ?? 'neutral', verb: 'moved it to', pill: true };
}

/** "Today", "Yesterday", or the date: the feed's day headings. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/** One entry in the feed: its icon on the rail, a line saying who did what, and what came with it. */
function feedItem(bubble: HTMLElement, line: Child[], extra: HTMLElement | null = null): HTMLElement {
  return el('li', 'act-item', bubble, el('div', 'act-body', el('div', 'act-line', ...line), extra));
}

const FEED_FIRST = 6;

/**
 * The ticket's activity as one feed, newest first: comments and acc's moves together, each with an
 * icon, who did it, and the state it reached; a move's reason shows under it, two lines and Show all.
 */
function renderActivity(m: TicketModel): HTMLElement | null {
  const items: { at: string; node: HTMLElement }[] = [];
  for (const c of m.comments) {
    items.push({ at: c.created, node: feedItem(el('span', 'act-icon act-avatar', avatar(c.author)),
      [el('strong', '', c.author.name), el('span', 'muted', 'commented'), el('span', 'muted', '·'), when(c.created), c.url ? linkTo(c.url, icon('link-external')) : null],
      el('div', 'act-comment', renderDoc(c.body, ''))) });
  }
  for (const h of m.acc?.history ?? []) {
    const f = moveFeed(h);
    const look = STATE_LOOK[h.to];
    // A long reason shows its first two lines, fading, with Show all under it; a short one shows whole.
    const reason = h.reason ? foldable(`reason:${m.project}#${m.key}@${h.at}`, el('div', 'act-reason', el('div', 'act-reason-text', h.reason)), 'act-reason-text', 2) : null;
    items.push({ at: h.at, node: feedItem(el('span', `act-icon tone-${f.tone}`, icon(f.icon, f.tone)),
      [el('strong', '', whoMoved(h.by)), el('span', '', f.verb), f.pill && look ? status(look) : null, el('span', 'muted', '·'), when(h.at)], reason) });
  }
  if (!items.length && !m.can.comment && !m.updates.length) return null;
  const section = el('section', 'block activity', el('h2', '', 'Activity'));
  // Updates acc drafted for the ticket come first: nothing reaches the ticket until a person posts it (D-066).
  if (m.updates.length) section.append(el('div', 'act-drafts', ...m.updates.map(updateDraft)));
  if (m.can.comment) section.append(composer(m));
  if (!items.length) { section.append(el('p', 'muted', 'Nothing yet.')); return section; }
  items.sort((a, b) => b.at.localeCompare(a.at));
  const key = `history:${m.project}#${m.key}`;
  const all = memory().opened.includes(key);
  const list = el('ol', 'act-feed');
  let day = '';
  for (const it of all ? items : items.slice(0, FEED_FIRST)) {
    const d = dayLabel(it.at);
    if (d !== day) { list.append(el('li', 'act-day', d)); day = d; }
    list.append(it.node);
  }
  section.append(list);
  if (items.length > FEED_FIRST) {
    section.append(button(all ? 'Show fewer' : `Show all ${items.length}`, all ? 'chevron-up' : 'chevron-down', () => { remember((x) => { x.opened = all ? x.opened.filter((y) => y !== key) : [...x.opened, key]; }); if (state.last) state.draw(state.last); }, 'ghost small act-more'));
  }
  return section;
}

const STATE_WORD: Record<string, string> = { todo: 'To do', running: 'Running', review: 'In review', rework: 'Rework', blocked: 'Blocked', done: 'Done' };

/** Who made a move, in plain words: its agent, the reviewer, GitHub, or a person's name. */
function whoMoved(by: string): string {
  if (/^builder:/.test(by)) return 'Its agent';
  if (/^reviewer:/.test(by)) return 'The reviewer';
  if (by === 'acc sync' || /^sync/.test(by)) return 'GitHub';
  return by.replace(/^human:/, '').replace(/^orchestrator.*/, 'acc');
}

export const area: PageArea = {
  views: { ticket: renderTicket },
};
