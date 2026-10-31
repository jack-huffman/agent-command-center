// A ticket's page: the ticket, its fields, its comments and its activity.

import type { Action, Look } from '../src/model/shared.ts';
import type { PersonChip } from '../src/model/boards.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import type { AgentNote } from '../src/logic/relayed.ts';
import { field, renderAgentPanel } from './agent-panel.ts';
import { renderAnalysis } from './analysis.ts';
import { renderCriteria } from './criteria.ts';
import { renderVerify } from './verify.ts';
import { renderChangesTab } from './changes.ts';
import { renderTeam } from './team.ts';
import { renderRecords } from './record-changes.ts';
import { renderField } from './changes-field.ts';
import { renderManifest } from './manifest.ts';
import { conversationLine } from './talk.ts';
import { drawNote } from './note.ts';
import { renderReview } from './review.ts';
import { collapsible, criteriaSummary, oneLine } from './collapse.ts';
import { afterTabs, askedComment, chooseTab, renderTabs } from './task-tabs.ts';
import { taskTabs } from './tab-rules.ts';
import { dayName } from './days.ts';
import { argButton, avatar, button, type Child, el, foldable, icon, labelChips, linkTo, md, openable, person, renderDoc, stateChip, status, typeMark, when, work } from './dom.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';
import { KIND_ICON, KIND_NAME } from './tasks.ts';
import { COMMENT_EMPTY, updateDraft } from './updates.ts';
import { upper } from './upper.ts';
import { FILLING, loadingLine } from './loading.ts';
import { addToWorkTitle, WORDS } from './plain-words.ts';

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

function composer(m: TicketModel): HTMLElement {
  const box = el('textarea', 'comment-box') as HTMLTextAreaElement;
  box.placeholder = 'Add a comment. Markdown works: **bold**, `code`, - lists, [links](https://…)';
  box.rows = 4;
  box.value = memory().drafts[`${m.project}#${m.key}`] ?? '';
  box.setAttribute('aria-label', `Comment on ${m.key}`);
  const send = el('button', 'btn primary', icon('comment'), 'Comment') as HTMLButtonElement;
  send.type = 'button';
  send.disabled = !box.value.trim();
  send.title = send.disabled ? COMMENT_EMPTY : '';
  const keys = navigator.platform.includes('Mac') ? '⌘ Enter to post' : 'Ctrl+Enter to post';
  // Who comments and how to post are two parts with a gap between them, not a dot in a run of text.
  const hint = el('span', 'muted small composer-hint', m.signedInAs ? el('span', 'acting', icon('account'), `Commenting as ${m.signedInAs}`) : null, el('span', '', keys));
  const post = () => {
    if (!box.value.trim() || send.disabled) return;
    send.disabled = true;
    send.title = 'Your comment is posting';
    box.disabled = true;
    send.replaceChildren(icon('sync~spin'), 'Posting');
    ticketAction('comment', box.value);
  };
  box.addEventListener('input', () => {
    send.disabled = !box.value.trim();
    send.title = send.disabled ? COMMENT_EMPTY : '';
    remember((s) => { s.drafts[`${m.project}#${m.key}`] = box.value; });
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } });
  send.addEventListener('click', post);
  return el('div', 'composer', box, el('div', 'composer-bar', hint, el('span', 'spacer'), send));
}

/** One fact in the ticket's head (T-91): an icon and the tracker's word, with what it is in its title. */
function fact(mark: HTMLElement | null, text: string, what: string): HTMLElement {
  return Object.assign(el('span', 'ticket-fact', mark, text), { title: `${what}: ${text}` });
}

/**
 * The ticket's related items (T-91), grouped by how they relate: each row its kind's icon, its key, its title
 * and its state chip, where its tracker says. A tracker's key opens that ticket's page in place.
 */
function renderRelated(m: TicketModel): HTMLElement {
  const groups = new Map<string, TicketModel['related']>();
  for (const r of m.related) groups.set(r.relation, [...(groups.get(r.relation) ?? []), r]);
  const section = el('section', 'block related-block', el('h2', '', 'Related'));
  for (const [relation, rows] of groups) {
    section.append(el('h3', 'related-group', upper(relation)), el('ul', 'related', ...rows.map((r) => {
      const name = /^[A-Z][A-Z0-9_]*-\d+$/i.test(r.key) ? openable(el('span', 'tcard-key', r.key), { type: 'ticket', project: m.project, tracker: m.tracker, key: r.key }) : el('span', 'tcard-key', r.key);
      const title = r.title ? Object.assign(el('span', 'related-title', r.title), { title: r.title }) : el('span', 'related-title');
      return el('li', 'related-row', el('span', 'related-type', r.typeIcon ? typeMark(r.typeIcon, r.typeColor) : null), name, title, r.status ? stateChip({ label: r.status.name, icon: r.status.icon, tone: r.status.tone, quiet: r.status.quiet }) : null);
    })));
  }
  return section;
}

export function renderTicket(m: TicketModel): Node[] {
  const sourceIcon = KIND_ICON[m.sourceKind] ?? 'checklist';
  // A field its tracker lacks, or one with nothing in it, leaves its place out (T-91): no line, no placeholder.
  const lack = (f: 'status' | 'assignee' | 'labels') => m.lacks.find((l) => l.field === f);
  const statusEl = m.status && !lack('status') ? stateChip({ label: m.status.name, icon: m.status.icon, tone: m.status.tone, quiet: m.status.quiet }) : null;
  let statusCtl: Child = statusEl;
  if (statusEl && m.can.status) {
    const b = el('button', 'btn status-btn', statusEl, icon('chevron-down')) as HTMLButtonElement;
    b.type = 'button';
    b.title = 'Change status';
    b.addEventListener('click', () => ticketAction('status'));
    statusCtl = b;
  }
  const type = m.type ? fact(typeMark(m.typeIcon, m.typeColor), m.type, 'Type') : null;
  const priority = m.priority ? fact(m.priorityIcon ? icon(m.priorityIcon) : null, m.priority, 'Priority') : null;
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
  // The head (T-91): the tracker's mark and the key, with the ticket's tools at the right; the title, large; then
  // one row of its state, kind and priority.
  const mark = Object.assign(el('span', 'ticket-mark', icon(sourceIcon)), { title: KIND_NAME[m.sourceKind] ?? 'A task kept by the Command Center' });
  const crumbs = el('div', 'crumbs', mark, el('span', 'crumb-source', m.sourceLabel), el('span', 'muted', '/'), m.url ? linkTo(m.url, m.key) : el('span', '', m.key));
  const facts = statusCtl || type || priority ? el('div', 'ticket-facts', statusCtl, type, priority) : null;
  const out: Node[] = [el('header', 'ticket-head', el('div', 'ticket-source', crumbs, el('span', 'spacer'), el('div', 'ticket-tools', ...tools)), el('h1', 'ticket-title', m.title), facts)];
  // The first draw (T-162): what's slower to read is still coming, and the next draw fills it.
  if (m.filling) out.push(loadingLine(FILLING));
  if (m.error) {
    const fix = m.connect ? argButton(m.connect.command, m.connect.label, 'plug', m.connect.arg, true) : null;
    out.push(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', m.error), fix));
  }
  // Outside the repo's place (D-072): said plainly, and only a person's call when acc keeps a task for it.
  if (m.outside) out.push(el('div', `notice${m.acc ? ' attention' : ''}`, icon(m.acc ? 'warning' : 'filter', m.acc ? 'orange' : undefined), el('span', '', m.outside)));

  // What needs the person first: why it's stuck, in one line (D-052), above everything else. Then the page's
  // content in tabs (T-134): Ticket, Plan, Changes and Verify. On a narrow page the notices still come first (T-41).
  const top = el('div', 'ticket-top');
  if (m.acc?.blocker) top.append(blockedNotice(`blocker:${m.project}#${m.key}`, m.acc.blocker));
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
  // The tab to show is chosen before its parts are drawn, so Ticket's activity knows a comment a link asked for.
  const tabs = taskTabs(m);
  const chosen = chooseTab(m, tabs);
  // Ticket: everything the ticket itself holds, together, as a tracker shows it. Where the tracker allows
  // edits, Edit opens the task sheet, which writes the ticket's title and description (T-80).
  const ticket: HTMLElement[] = [];
  const descHead = m.editText ? el('div', 'desc-head', el('h2', '', 'Description'), descEdit(m.editText)) : el('h2', '', 'Description');
  ticket.push(el('section', 'block', descHead, m.loading && !m.body.blocks.length ? el('p', 'muted', 'Loading…') : foldable(`desc:${m.project}#${m.key}`, renderDoc(m.body, 'No description.'), null, 6)));
  if (m.related.length) ticket.push(renderRelated(m));
  const activity = renderActivity(m);
  if (activity) ticket.push(activity);
  // The Command Center's sections, each folding to its header line (T-132), in the tab that holds them.
  const plan: HTMLElement[] = [];
  const changes: HTMLElement[] = [];
  const review: HTMLElement[] = [];
  const verify: HTMLElement[] = [];
  const add = (into: HTMLElement[], sec: HTMLElement | null, id: string, summary: string | null = null): void => { if (sec) into.push(collapsible(sec, id, m, summary)); };
  if (m.analysis) add(plan, renderAnalysis(m, m.analysis), 'plan', oneLine(m.analysis.note) ?? oneLine(m.analysis.summary));
  // A conversation before its plan is made (T-111): its one line, in a plan section of its own until the plan
  // comes. The conversation itself is in its panel, never here. Its state heads it, as the plan's does (T-136): the tab says Plan.
  const line = !m.analysis && m.talk ? conversationLine(m.project, m.talk) : null;
  if (line) add(plan, el('section', 'analysis plan-tab', el('div', 'an-head an-top', el('h2', '', status(m.talk!.look))), line), 'plan', oneLine(line.textContent));
  // Its drafted acceptance criteria (T-81).
  if (m.criteria) add(plan, renderCriteria(m, m.criteria), 'criteria', criteriaSummary(m.criteria.count) ?? oneLine(m.criteria.note));
  // What a person wrote for its builder (T-74), which a tracker's intake never changes.
  if (m.acc?.notes) add(plan, el('section', 'block', el('h2', '', 'Notes for the builder'), foldable(`notes:${m.project}#${m.key}`, renderDoc(m.acc.notes, ''), null, 6)), 'notes');
  add(plan, renderNote(m), 'note');
  // Changes (T-138): what changed, where it is and Deploy, the steps left; the rest under one closed More,
  // each part as before: the manifest (T-101), the tracker's field (T-105), record changes by hand (T-100) and the team (T-103).
  const more = [
    m.manifest ? renderManifest(m, m.manifest) : null,
    m.field ? renderField(m.field) : null,
    m.records ? renderRecords(m, m.records, true) : null,
    m.team ? renderTeam(m.team) : null,
  ].filter((x): x is HTMLElement => !!x);
  changes.push(...renderChangesTab(m, more));
  // Its review's findings (T-53), in a tab of their own (T-135).
  if (m.review) review.push(renderReview(m.review));
  // Verify the developer's work (T-84).
  if (m.verify) add(verify, renderVerify(m, m.verify), 'verify', oneLine(m.verify.summary) ?? oneLine(m.verify.note));
  const main = el('div', 'ticket-main', renderTabs(m, tabs, chosen, { ticket, plan, changes, review, verify }));

  // The side column: the ticket's fields, then acc's side of it. Details lists only the rows its tracker has
  // something for (T-91); a row with nothing in it stays only to hold its Change or Add.
  const people = (list: PersonChip[]) => el('span', 'people', ...list.map(person));
  const details = [
    ...(lack('assignee') || (!m.assignees.length && !m.can.assign) ? [] : field({ icon: 'account', name: m.assignees.length > 1 ? 'Assignees' : 'Assignee' }, m.assignees.length ? people(m.assignees) : null, m.can.assign ? editButton(m.assignees.length ? 'Change' : 'Assign', 'assign') : null)),
    ...(m.reporter ? field({ icon: 'person', name: 'Reporter' }, person(m.reporter)) : []),
    ...(lack('labels') || (!m.labels.length && !m.can.labels) ? [] : field({ icon: 'tag', name: 'Labels' }, m.labels.length ? el('span', 'labels', ...labelChips(m.labels)) : null, m.can.labels ? editButton(m.labels.length ? 'Edit' : 'Add', 'labels') : null)),
    ...(m.created ? field({ icon: 'calendar', name: 'Created' }, when(m.created)) : []),
    ...(m.updated ? field({ icon: 'history', name: 'Updated' }, when(m.updated)) : []),
  ];
  // Details and the Agent panel fold to their header line as the Command Center's sections do (T-132).
  const side = el('aside', 'ticket-side', details.length ? collapsible(el('section', 'side-details', el('h2', '', 'Details'), el('dl', 'fields details-list', ...details)), 'details', m, null) : null);
  if (m.acc) {
    const a = m.acc;
    side.append(collapsible(renderAgentPanel(m, a, (gate) => ticketAction('waive', gate)), 'agent', m, a.look.label));
  } else if (m.trackable) {
    // Adding… while it's on its way, from here or its card, so a second click starts nothing (D-074).
    const show = (on: boolean) => {
      track.replaceChildren(icon(on ? 'sync~spin' : 'add'), on ? 'Adding…' : WORDS.addToWork);
      track.disabled = on;
    };
    const track = el('button', 'btn ticket-track') as HTMLButtonElement;
    track.type = 'button';
    track.title = addToWorkTitle(KIND_NAME[m.sourceKind] ?? 'the tracker');
    show(m.tracking);
    track.addEventListener('click', () => {
      if (track.disabled) return;
      show(true);
      ticketAction('track');
    });
    side.append(collapsible(el('section', 'side-panel side-agent', el('h2', '', icon('hubot'), 'Agent'), el('p', 'muted', 'This ticket isn\'t in your work yet. Add it, and an agent can plan it and build it. The ticket itself isn\'t changed.'), el('div', 'actions', track)), 'agent', m, 'Not in your work yet'));
  }
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

/**
 * Why it's blocked, above the tabs (T-146): its headline, then a bullet per thing, each long one folding on its
 * own. A note with no shape is its paragraph, its first two lines and Show all, as before.
 */
function blockedNotice(key: string, n: AgentNote): HTMLElement {
  const lead = el('strong', '', 'Why it\'s blocked: ');
  if (!n.shape) return foldable(key, el('div', 'notice attention why', icon('circle-slash', 'orange'), el('div', 'why-text', lead, md(n.text))), 'why-text', 2);
  return el('div', 'notice attention why why-note', icon('circle-slash', 'orange'), drawNote(n, key, { lead }));
}

/**
 * A move's reason under it in the feed: a note with a shape as its headline and bullets (T-146); one without,
 * its first two lines, fading, with Show all under it, and a short one whole.
 */
function moveReason(key: string, n: AgentNote): HTMLElement {
  if (n.shape) return el('div', 'act-reason', drawNote(n, key));
  return foldable(key, el('div', 'act-reason', el('div', 'act-reason-text', md(n.text))), 'act-reason-text', 2);
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
  // A comment (T-91) is its own card on the rail, as a tracker draws one: its author's avatar on the rail, then
  // their name, with their email in its title, "commented" and when, and its body as reading text. acc's moves
  // and a person's edits stay light rows, so a conversation reads apart from acc's notes.
  for (const c of m.comments) {
    const name = Object.assign(el('strong', 'act-name', c.author.name), c.author.email ? { title: c.author.email } : {});
    const head = el('div', 'act-line act-card-head', name, el('span', 'muted', 'commented'), when(c.created),
      c.url ? el('span', 'act-card-link', linkTo(c.url, icon('link-external'))) : null);
    const card = el('article', 'act-body act-card', head, el('div', 'act-comment', renderDoc(c.body, '')));
    // A link that names this comment scrolls to it and focuses it (T-134).
    card.dataset.comment = c.id;
    card.tabIndex = -1;
    items.push({ at: c.created, node: el('li', 'act-item is-comment', el('span', 'act-icon act-avatar', avatar(c.author)), card) });
  }
  for (const h of m.acc?.history ?? []) {
    const f = moveFeed(h);
    const reason = h.reason ? moveReason(`reason:${m.project}#${m.key}@${h.at}`, h.reason) : null;
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
  // A comment a link asked for shows, wherever it is in the feed (T-134).
  const asked = askedComment();
  const all = memory().opened.includes(key) || (!!asked && m.comments.some((c) => c.id === asked));
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

const STATE_WORD: Record<string, string> = { todo: 'To do', running: 'Running', review: 'In review', rework: WORDS.sentBack, blocked: 'Blocked', done: 'Done' };

/** Who made a move, in plain words: its agent, the reviewer, GitHub, or a person's name. */
function whoMoved(by: string): string {
  if (/^builder:/.test(by)) return 'Its agent';
  if (/^reviewer:/.test(by)) return 'The reviewer';
  if (by === 'acc sync' || /^sync/.test(by)) return 'GitHub';
  return by.replace(/^human:/, '').replace(/^orchestrator.*/, 'The Command Center');
}

/** The width the page last told the extension (T-111), by task, so it says again only when it changes. */
let toldWidth = '';

/** Whether the page listens for its window's resizing yet: from its first drawn task on. */
let listening = false;

/** Tells the extension how wide a task's page is (T-111), so its conversation opens beside it, or as a tab when narrow. */
function tellWidth(): void {
  const m = state.last;
  if (m?.kind !== 'ticket') return;
  if (!listening) { listening = true; window.addEventListener('resize', tellWidth); }
  const said = `${m.project}#${m.key}:${window.innerWidth}`;
  if (said === toldWidth) return;
  toldWidth = said;
  api.postMessage({ type: 'page-width', project: m.project, task: m.key, width: window.innerWidth });
}

export const area: PageArea = {
  views: { ticket: renderTicket },
  after: () => {
    tellWidth();
    if (state.last?.kind === 'ticket') afterTabs();
  },
};
