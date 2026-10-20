// A ticket's page: the ticket, its fields, its comments and its activity.

import type { Action, Look } from '../src/model/shared.ts';
import type { PersonChip } from '../src/model/boards.ts';
import type { TicketModel, TicketRatchet } from '../src/model/task-page.ts';
import { renderAnalysis } from './analysis.ts';
import { renderReview } from './review.ts';
import { taskActions } from './task-actions.ts';
import { dayName } from './days.ts';
import { argButton, avatar, button, type Child, clippedSpan, el, foldable, icon, iconed, labelChip, linkTo, md, openable, renderDoc, status, when, work } from './dom.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';
import { KIND_ICON, KIND_NAME } from './tasks.ts';
import { updateDraft } from './updates.ts';

// ---------------------------------------------------------------- a ticket's page (D-026)

function ticketAction(action: string, text?: string): void {
  api.postMessage({ type: 'ticket-action', action, ...(text !== undefined ? { text } : {}) });
}

/**
 * A ratchet's numbers (GH-99), "669 → 674 (+5)" beside its name, with an arrow for the way it went: blue
 * when it got better or held, orange when it got worse. The numbers say it; the arrow and its colour only
 * add to them. Hovered, it says them with its label, then what the check said.
 */
function ratchetNumbers(r: TicketRatchet, summary: string): HTMLElement {
  const diff = r.diff ?? 0;
  const better = r.limit === 'floor' ? diff >= 0 : diff <= 0;
  return Object.assign(el('span', 'small check-sum check-ratchet', icon(diff > 0 ? 'arrow-up' : diff < 0 ? 'arrow-down' : 'arrow-right', better ? 'blue' : 'orange'), r.numbers ?? ''), { title: `${r.line}. ${summary}` });
}

function editButton(label: string, action: string): HTMLElement {
  const b = el('button', 'btn ghost small', icon('edit'), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => ticketAction(action));
  return b;
}

/** The description's Edit (T-80): it opens the task sheet over this page; one that can't be used now is off, with why. */
function descEdit(a: Action): HTMLElement {
  const b = el('button', 'btn ghost small', icon(a.icon), a.label) as HTMLButtonElement;
  b.type = 'button';
  b.title = a.disabled ? `${a.label}: ${a.disabled}` : 'Edit its title and description';
  b.setAttribute('aria-label', 'Edit its title and description');
  if (a.disabled) {
    b.disabled = true;
    b.setAttribute('aria-description', a.disabled);
  }
  b.addEventListener('click', () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }));
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
  // A field its tracker lacks gets one muted line in place of its control (T-28).
  const lack = (f: 'status' | 'assignee' | 'labels') => m.lacks.find((l) => l.field === f);
  const statusEl = m.status && !lack('status') ? el('span', `pill tone-${m.status.tone}`, icon(m.status.icon, m.status.tone), m.status.name) : null;
  // No pill (the tracker can't give a status, or none came) says so in the head, now Details no longer has the row.
  let statusCtl: Child = statusEl ?? (lack('status') ? el('span', 'muted', lack('status')!.line) : el('span', 'muted', '—'));
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
    const fix = m.connect ? argButton(m.connect.command, m.connect.label, 'plug', m.connect.arg, true) : null;
    out.push(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', m.error), fix));
  }
  // Outside the repo's place (D-072): said plainly, and only a person's call when acc keeps a task for it.
  if (m.outside) out.push(el('div', `notice${m.acc ? ' attention' : ''}`, icon(m.acc ? 'warning' : 'filter', m.acc ? 'orange' : undefined), el('span', '', m.outside)));

  // Summary first, details on demand: why it's stuck, in one line, then its analysis (D-052). On a narrow
  // page it follows the Agent panel, which holds what needs the person (T-41). The main column follows:
  // description, related tickets, then activity.
  const top = el('div', 'ticket-top');
  if (m.acc?.blocker) top.append(foldable(`blocker:${m.project}#${m.key}`, el('div', 'notice attention why', icon('circle-slash', 'orange'), el('div', 'why-text', el('strong', '', 'Why it\'s blocked: '), m.acc.blocker)), 'why-text', 2));
  if (m.acc?.conflicts) {
    const [head, ...files] = m.acc.conflicts.split(': ');
    top.append(foldable(`conflicts:${m.project}#${m.key}`, el('div', 'notice attention why', icon('warning', 'orange'), el('div', 'why-text conflict', el('strong', '', `${head}: `), work(el('span', '', files.join(': ')), 'files'))), 'why-text', 2));
  }
  // Its checks failed on GitHub, or autopilot sent it back for them (D-076), in orange with an icon.
  if (m.acc?.failedChecks) {
    const [head, ...names] = m.acc.failedChecks.split(': ');
    top.append(foldable(`checks:${m.project}#${m.key}`, el('div', 'notice attention why', icon('github-action', 'orange'), el('div', 'why-text conflict', el('strong', '', `${head}: `), names.join(': '))), 'why-text', 2));
  }
  // acc couldn't move its card on its GitHub Project as it entered this state (D-126): orange, with why.
  if (m.acc?.cardFailed) {
    top.append(foldable(`card:${m.project}#${m.key}`, el('div', 'notice attention why', icon('project', 'orange'), el('div', 'why-text conflict', el('strong', '', 'Its card couldn\'t move on its GitHub Project: '), m.acc.cardFailed)), 'why-text', 2));
  }
  // Its files beside other tasks', each file in full (D-093): the icon and the words, in the look's tone.
  if (m.acc?.files) {
    const f = m.acc.files;
    const [head, ...rest] = f.label.split(': ');
    const tone = f.tone === 'orange' ? ' attention' : f.tone === 'blue' ? ' waits' : '';
    top.append(foldable(`files:${m.project}#${m.key}`, el('div', `notice${tone} why`, icon(f.icon, f.tone), el('div', 'why-text', el('strong', '', rest.length ? `${head}: ` : head), work(el('span', '', rest.join(': ')), 'files'))), 'why-text', 2));
  }
  if (m.analysis) top.append(renderAnalysis(m, m.analysis));
  const main = el('div', 'ticket-main');
  // Where the tracker allows edits, Edit opens the task sheet, which writes the ticket's title and description (T-80).
  const descHead = m.editText ? el('div', 'desc-head', el('h2', '', 'Description'), descEdit(m.editText)) : el('h2', '', 'Description');
  main.append(el('section', 'block', descHead, m.loading && !m.body.blocks.length ? el('p', 'muted', 'Loading…') : foldable(`desc:${m.project}#${m.key}`, renderDoc(m.body, 'No description.'), null, 6)));
  // What a person wrote for its builder (T-74), which a tracker's intake never changes.
  if (m.acc?.notes) main.append(el('section', 'block', el('h2', '', 'Notes for the builder'), foldable(`notes:${m.project}#${m.key}`, renderDoc(m.acc.notes, ''), null, 6)));
  const note = renderNote(m);
  if (note) main.append(note);
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
    ...field(m.assignees.length > 1 ? 'Assignees' : 'Assignee', lack('assignee') ? el('span', 'muted', lack('assignee')!.line) : people(m.assignees), m.can.assign ? editButton('Change', 'assign') : null),
    ...(m.reporter ? field('Reporter', el('span', 'person', avatar(m.reporter), m.reporter.name)) : []),
    ...field('Labels', lack('labels') ? el('span', 'muted', lack('labels')!.line) : m.labels.length ? el('span', 'labels', ...m.labels.map(labelChip)) : el('span', 'muted', 'None'), m.can.labels ? editButton('Edit', 'labels') : null),
    ...(m.priority ? field('Priority', m.priorityIcon ? iconed(m.priorityIcon, m.priority) : el('span', '', m.priority)) : []),
    ...(m.type ? field('Type', iconed(m.typeIcon, m.type)) : []),
    ...field('Created', when(m.created)),
    ...field('Updated', when(m.updated)),
  );
  const side = el('aside', 'ticket-side', el('section', 'side-panel side-details', el('h2', '', 'Details'), details));
  if (m.acc) {
    const a = m.acc;
    side.append(el('section', `side-panel side-agent${a.look.tone === 'orange' ? ' attention' : ''}`, el('h2', '', icon('hubot'), 'Agent'),
      el('dl', 'fields',
        ...field('State', status(a.look)),
        ...field('Environment', el('span', 'mono', a.environment)),
        ...(a.waitingOn.length ? field('Waiting on', a.waitingOn.join(', ')) : []),

        ...(a.agent && a.agent.label !== a.look.label ? field('Session', status(a.agent)) : []),
        // Its effort beside it, when it isn't the model's default (D-128).
        ...(a.agent && a.model ? field('Model', el('span', '', el('span', 'mono', a.model), a.effort ? el('span', 'muted', ` · ${a.effort} effort`) : null)) : []),
        // What its builder is called, in Claude Code and the Command Center alike (D-087).
        ...(a.agentName ? field('Builder', el('span', 'agent-name', a.agentName)) : []),
        // Where it runs (GH-69): This Mac or Cloud, and a cloud builder's page on claude.ai.
        ...(a.place ? field('Runs on', a.cloudUrl ? el('span', '', status(a.place), ' ', linkTo(a.cloudUrl, 'its session on claude.ai')) : status(a.place)) : []),
        ...(a.branch ? field('Branch', work(clippedSpan(a.branch), 'branch')) : []),
        ...(a.worktree ? field('Worktree', work(clippedSpan(a.worktree.split('/').slice(-2).join('/')), 'branch')) : []),
      ),
      a.checks.length ? el('div', 'checks', el('h3', '', 'Checks'), ...a.checks.map((c) => el('div', 'check',
        // Its state and name on a line of their own, so a long state such as "needs a person" leaves room (GH-100).
        el('span', 'check-head', status(c.look),
          // A builder's lighter check, or the full one the merge queue runs once (GH-73).
          el('span', 'check-gate', el('span', 'mono', c.gate),
            c.scope ? Object.assign(el('span', 'chip', c.scope === 'builder' ? 'builder' : 'merge queue'), { title: c.scope === 'builder' ? 'One of the lighter checks a builder runs before it finishes the task' : 'The full check, run once in the merge queue before the merge' }) : null)),
        // Its summary under them, beside Waive…, then what its tests ran. A ratchet shows its numbers (GH-99).
        work(c.ratchet?.numbers ? ratchetNumbers(c.ratchet, c.summary) : Object.assign(el('span', 'muted small check-sum', c.summary), { title: c.summary }), 'output'),
        // A person can set a failing check, or one that needs them, aside, with a reason (D-031). Not a ratchet:
        // a person relaxes its floor instead (GH-99).
        c.waivable ? Object.assign(button('Waive…', 'debug-step-over', () => ticketAction('waive', c.gate), 'ghost small check-waive'), { title: `Set ${c.gate} aside on this commit, with a reason` }) : null,
        c.counts ? Object.assign(el('span', 'muted small check-tests', icon('beaker'), `Tests: ${c.counts}`), { title: c.countsNote ?? `Tests: ${c.counts}` }) : null))) : null,
      // Its actions in one size and place (D-168): the next step full width, the rest in two equal columns.
      taskActions(a.actions)));
  } else if (m.trackable) {
    // Tracking… while it's on its way, from here or its card, so a second click starts nothing (D-074).
    const show = (on: boolean) => {
      track.replaceChildren(icon(on ? 'sync~spin' : 'add'), on ? 'Tracking…' : 'Track in acc');
      track.disabled = on;
    };
    const track = el('button', 'btn ticket-track') as HTMLButtonElement;
    track.type = 'button';
    show(m.tracking);
    track.addEventListener('click', () => {
      if (track.disabled) return;
      show(true);
      ticketAction('track');
    });
    side.append(el('section', 'side-panel side-agent', el('h2', '', icon('hubot'), 'Agent'), el('p', 'muted', 'acc isn\'t keeping this ticket yet. Track it to dispatch an agent to it. The ticket itself isn\'t changed.'), el('div', 'actions', track)));
  }
  // Its review's findings, under the Agent panel (T-53).
  if (m.review) side.append(renderReview(m.review));
  out.push(el('div', 'ticket-grid', top.childElementCount ? top : null, main, side));
  return out;
}

/**
 * Its builder's handoff note (D-106): what landed, which numbers moved and what's still open, each part with
 * its icon and its words, and a Make a task beside each still-open line. A run that ended without one says so.
 */
function renderNote(m: TicketModel): HTMLElement | null {
  const a = m.acc;
  if (!a?.note) return a?.noteMissing ? el('section', 'block note', el('h2', '', 'Builder\'s note'), el('div', 'notice attention why', icon('warning', 'orange'), el('div', 'why-text', a.noteMissing))) : null;
  const n = a.note;
  const part = (key: string, iconName: string, tone: string | undefined, label: string, lines: string[], tool?: (line: string) => HTMLElement) =>
    el('div', `note-part note-${key}`, el('h3', '', icon(iconName, tone), label),
      lines.length ? el('ul', 'note-lines', ...lines.map((l) => el('li', '', work(el('span', 'note-line', md(l)), 'transcript'), tool?.(l) ?? null))) : el('p', 'muted note-none', 'None'));
  const makeTask = (line: string) => {
    const b = button('Make a task', 'add', () => ticketAction('task', line), 'ghost small note-task');
    b.title = 'Draft a task from this line, to edit and confirm before it\'s added';
    b.setAttribute('aria-label', `Make a task: ${line}`);
    return b;
  };
  return el('section', 'block note', el('h2', '', 'Builder\'s note'),
    el('p', 'muted small note-who', `${n.fromLast ? 'From its last run, in' : 'In'} its builder's own words as it ${n.ended === 'blocked' ? 'blocked' : 'finished'}, `, when(n.at), '. The review checks the change itself.'),
    part('landed', 'pass', 'blue', 'What landed', n.landed),
    part('moved', 'graph', undefined, 'Numbers that moved', n.moved),
    part('open', 'issues', n.open.length ? 'orange' : undefined, 'Still open', n.open, makeTask));
}

/**
 * What a move did, as the feed's icon and verb: the state it reached shows as a pill after the verb, as core's
 * DISPLAY shows it, which the model sends with each move (GH-105).
 */
function moveFeed(h: { from: string | null; to: string; by: string; look: Look }): { icon: string; tone: Look['tone']; verb: string; pill: boolean } {
  const sync = /^sync|^acc sync/.test(h.by);
  if (!h.from) return { icon: 'add', tone: 'neutral', verb: 'added it', pill: false };
  if (h.to === 'running') return h.from === 'rework' ? { icon: 'debug-restart', tone: 'blue', verb: 'sent it back to its agent', pill: false } : { icon: 'rocket', tone: 'blue', verb: 'started its agent', pill: false };
  // Autopilot's own send-back, for checks that failed on GitHub (D-076) or from the merge queue (GH-73), is the
  // orchestrator's move to rework: core's sentBackByAutopilot, which this page can't import. A review made for it isn't.
  if (h.to === 'rework' && h.from === 'review' && h.by === 'orchestrator:autopilot') return { icon: 'github-action', tone: 'orange', verb: 'sent it back to its builder', pill: false };
  if (h.to === 'rework') return { icon: 'request-changes', tone: 'orange', verb: 'asked for changes', pill: false };
  if (h.to === 'blocked') return { icon: 'circle-slash', tone: 'orange', verb: 'blocked it', pill: false };
  if (h.to === 'done') return { icon: sync ? 'git-merge' : 'check', tone: 'blue', verb: sync ? 'merged its pull request:' : 'moved it to', pill: true };
  return { icon: h.look.icon, tone: h.look.tone, verb: 'moved it to', pill: true };
}

/** One entry in the feed: its icon on the rail, a line saying who did what, and what came with it. */
function feedItem(bubble: HTMLElement, line: Child[], extra: HTMLElement | null = null): HTMLElement {
  return el('li', 'act-item', bubble, el('div', 'act-body', el('div', 'act-line', ...line), extra));
}

const FEED_FIRST = 6;

/**
 * The ticket's activity as one feed, newest first: comments, acc's moves and a person's edits together, each
 * with an icon, who did it, and the state it reached or the fields it changed; a move's reason shows under it, two lines and Show all.
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
    // A long reason shows its first two lines, fading, with Show all under it; a short one shows whole.
    const reason = h.reason ? foldable(`reason:${m.project}#${m.key}@${h.at}`, el('div', 'act-reason', el('div', 'act-reason-text', h.reason)), 'act-reason-text', 2) : null;
    items.push({ at: h.at, node: feedItem(el('span', `act-icon tone-${f.tone}`, icon(f.icon, f.tone)),
      [el('strong', '', whoMoved(h.by)), el('span', '', f.verb), f.pill ? status(h.look) : null, el('span', 'muted', '·'), when(h.at)], reason) });
  }
  // A person's edits (T-74): who changed which fields, apart from its moves.
  for (const e of m.acc?.edits ?? []) {
    items.push({ at: e.at, node: feedItem(el('span', 'act-icon tone-neutral', icon('edit', 'neutral')),
      [el('strong', '', whoMoved(e.by)), el('span', '', `edited its ${e.fields}`), el('span', 'muted', '·'), when(e.at)]) });
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
  const now = Date.now();
  // The feed's day headings are History's day names (D-170).
  for (const it of all ? items : items.slice(0, FEED_FIRST)) {
    const d = dayName(it.at, now);
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
