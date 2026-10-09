// The Overview: what needs you, the stat tiles, the merge queue, and History.

import type { HistoryItem } from '../src/model/history.ts';
import type { HomeModel } from '../src/model/home.ts';
import type { QueuePanel } from '../src/model/overview.ts';
import { analysisQuestion } from './analysis.ts';
import { actionButton, argButton, button, type Child, el, foldable, icon, linkTo, openable, sectionTitle, status, titled, toolbarButton, when } from './dom.ts';
import { renderInProgress } from './progress.ts';
import { questionCard } from './questions.ts';
import { api, go, memory, type PageArea, remember, state } from './state.ts';
import { ruleButtons, ruleDetail } from './rules.ts';
import { overviewUpdateButtons, posterLine, updateKey, updateNotes } from './updates.ts';

export function renderOverview(m: HomeModel): Node[] {
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
    const u = a.update;
    // An update posts as acc drafted it, or opens its task's page to edit it first (D-066).
    const buttons: Child[] = u ? overviewUpdateButtons(u, a.actions) : a.rule ? ruleButtons(a.rule) : a.actions.map(actionButton);
    if (a.extra) buttons.push(argButton(a.extra.command, a.extra.label, a.extra.icon, a.extra.arg, true));
    if (a.go) {
      const g = a.go;
      const b = el('button', 'btn', icon('arrow-right'), g.label) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => go(g.section));
      buttons.push(b);
    }
    inbox.append(el('div', `inbox-row tone-row-${a.look.tone}`, status(a.look), el('div', 'inbox-text', titled(el('div', 'strong inbox-title', a.title), a.title), Object.assign(el('div', 'muted small', a.detail), a.tip ? { title: a.tip } : {})), el('div', 'actions', ...buttons)));
    // An update's text, two lines then Show all, with who it posts as (D-066).
    // Edited on its task's page, it shows that edit: the text Post there would send (GH-46).
    if (u) inbox.append(el('div', 'inbox-update', foldable(`${updateKey(u.project, u.id)}:text`, el('div', 'inbox-update-text', u.edited ?? u.text), null, 2), posterLine(u), ...updateNotes(u)));
    // A rule or check suggested by a finding that keeps coming back, with each review it came from (GH-102).
    if (a.rule) inbox.append(ruleDetail(a.rule));
    // A task's analysis's questions, answered right here (D-052).
    const an = a.analysis;
    if (an) inbox.append(el('div', 'inbox-analysis', ...an.questions.map((q) => analysisQuestion(an.project, an.task, q, an.canAsk))));
  }
  out.push(inbox, renderInProgress(o.inProgress));

  // At a glance: each tile opens its section.
  const tiles = el('div', 'tiles');
  for (const s of o.stats) {
    const tile = el('button', `tile tone-edge-${s.tone}`, el('div', 'tile-top', icon(s.icon, s.tone === 'neutral' ? undefined : s.tone), el('span', 'tile-label', s.label)), el('div', 'tile-value', s.value), el('div', 'muted small', s.hint)) as HTMLButtonElement;
    tile.type = 'button';
    tile.addEventListener('click', () => go(s.section));
    tiles.append(tile);
  }
  out.push(tiles);

  // Each repo's merge queue, where auto-merge is on (GH-73): head first, with what each waits on.
  if (o.queue.length) out.push(renderQueue(o.queue, o.projects.length > 1));

  // Ready work beside what just happened.
  const ready = el('section', 'panel-box', el('h2', '', icon('rocket'), 'Ready for an agent', o.ready.length ? el('span', 'count', String(o.ready.length)) : null));
  if (!o.ready.length) ready.append(el('p', 'muted quiet', 'Nothing is ready to dispatch. Track a ticket from a board, or add a task.'));
  for (const r of o.ready.slice(0, 8)) {
    ready.append(el('div', 'list-row', openable(titled(el('div', 'list-text', el('span', 'tcard-key', r.id), el('span', '', r.title)), `${r.id} ${r.title}`), { type: 'run', command: 'acc.task.show', ref: r.action.ref }),
      el('span', 'chip', r.environment), actionButton(r.action)));
  }
  // Ready work, then the full history below it, with the width to read it.
  out.push(ready, renderHistory(o.history, o.projects.length > 1));
  return out;
}

/**
 * The merge queue (GH-73): pull requests that passed, in the order they'll merge, one repo's to a list.
 * Each row has its place, its task, its pull request, and what it waits on, in words with an icon.
 */
function renderQueue(queues: QueuePanel[], manyProjects: boolean): HTMLElement {
  const n = queues.reduce((k, q) => k + q.rows.length, 0);
  const box = el('section', 'panel-box queue', el('h2', '', icon('git-merge'), 'Merge queue', el('span', 'count', String(n))));
  for (const q of queues) {
    if (manyProjects || queues.length > 1) box.append(el('div', 'queue-project muted small', q.project));
    if (q.off) box.append(el('p', 'muted small queue-off', 'Autopilot is off, so the queue waits. Turn it on from the status bar.'));
    const list = el('ol', 'queue-list');
    list.setAttribute('aria-label', `${q.project}'s merge queue, next to merge first`);
    for (const r of q.rows) {
      const text = openable(titled(el('div', 'list-text', el('span', 'tcard-key', r.id), el('span', '', r.title)), `${r.id} ${r.title}`), { type: 'run', command: 'acc.task.show', ref: r.ref });
      list.append(el('li', 'list-row queue-row',
        Object.assign(el('span', 'queue-place', String(r.place)), { title: r.place === 1 ? 'Next to merge' : `${r.place} in line` }),
        text,
        r.pr ? linkTo(r.pr.url, el('span', 'chip', icon('git-pull-request'), ` #${r.pr.number}`)) : null,
        // A wait in its own words can be long: it ends in an ellipsis, and says it all on hover.
        r.tip ? Object.assign(el('span', `status tone-${r.look.tone} queue-why`, icon(r.look.icon, r.look.tone), el('span', 'queue-why-text', r.look.label)), { title: r.tip }) : status(r.look)));
    }
    box.append(list);
  }
  return box;
}

/** History filters: everything, or one kind. Remembered for the tab. Autopilot's steps are Tasks (D-064). */
const HISTORY_KINDS = [['all', 'All', 'list-flat'], ['answer', 'Your answers', 'comment-discussion'], ['move', 'Tasks', 'project'], ['run', 'Commands', 'terminal']] as const;
const historyKind = (i: HistoryItem): string => (i.kind === 'autopilot' ? 'move' : i.kind);

/**
 * Everything that happened, newest first, in its own scrolling box (D-037): your answers to agents'
 * questions, task moves, and the commands acc ran. An answered question leaves this record behind.
 */
function renderHistory(items: HistoryItem[], manyProjects: boolean): HTMLElement {
  const kind = memory().history ?? 'all';
  const filters = el('div', 'segmented history-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Show');
  for (const [k, label, ic] of HISTORY_KINDS) {
    const n = k === 'all' ? items.length : items.filter((i) => historyKind(i) === k).length;
    const b = el('button', `seg${kind === k ? ' on' : ''}`, icon(ic), label, n ? el('span', 'count', String(n)) : null) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(kind === k));
    b.addEventListener('click', () => { remember((m) => { m.history = k; }); if (state.last) state.draw(state.last); });
    filters.append(b);
  }
  const box = el('section', 'panel-box history', el('div', 'history-head', el('h2', '', icon('history'), 'History'), filters));
  const shown = items.filter((i) => kind === 'all' || historyKind(i) === kind);
  if (!shown.length) {
    box.append(el('p', 'muted quiet', kind === 'answer' ? 'When you answer an agent, it\'s kept here.' : kind === 'run' ? 'Commands acc runs for you are kept here.' : 'What agents and tasks do shows up here.'));
    return box;
  }
  const feed = el('ol', 'feed history-feed');
  feed.tabIndex = 0;
  feed.setAttribute('aria-label', 'History, newest first');
  const where = (project: string) => (manyProjects && project ? ` · ${project}` : '');
  for (const it of shown) {
    if (it.kind === 'move') {
      feed.append(el('li', '', el('span', 'feed-dot'), el('div', '',
        el('div', '', el('span', 'tcard-key', it.task), ' ', el('span', '', it.title)),
        el('div', 'muted small', when(it.at), ` · ${it.from ?? 'new'} → `, el('strong', '', it.to), ` · ${it.by.replace(/^human:/, '')}${where(it.project)}`))));
    } else if (it.kind === 'autopilot') {
      // A step autopilot took (D-064): its icon, and what it did in words, with its pull request a click away.
      const what = it.url ? linkTo(it.url, it.look.label) : el('span', '', it.look.label);
      feed.append(el('li', 'history-autopilot', el('span', `feed-icon tone-${it.look.tone}`, icon(it.look.icon)), el('div', 'history-step',
        el('div', '', el('span', 'tcard-key', it.task), ' ', el('span', '', it.title)),
        el('div', 'muted small', when(it.at), ' · ', el('strong', `tone-${it.look.tone}`, what), where(it.project)),
        it.detail ? clampedNote(it.detail) : null)));
    } else if (it.kind === 'answer') {
      const d = it.decision;
      // What it asked and what you decided, on the line itself; the full command and your words open below.
      const summary = el('summary', '', el('div', 'history-line', el('strong', '', it.who), el('span', '', ` ${d.asked}`), d.code ? el('code', 'tool-code', d.code.split('\n')[0]!) : null),
        el('div', 'muted small history-meta', when(it.at), where(it.project), el('span', 'sep', '·'), status(d.look)));
      const body = el('div', 'history-body',
        d.code ? el('pre', 'q-code', d.code) : null,
        d.detail ? el('div', 'history-detail', d.detail) : null,
        button('Watch', 'pulse', () => api.postMessage({ type: 'run', command: 'acc.agent.watch', ref: { session: it.session } }), 'ghost small'));
      feed.append(el('li', 'history-answer', el('span', `feed-icon tone-${d.look.tone}`, icon(d.icon)), el('details', 'history-item', summary, body)));
    } else {
      const summary = el('summary', '', el('span', '', el('strong', '', it.label)), el('div', 'muted small', when(it.at), ' · ', status(it.look)));
      feed.append(el('li', 'history-run', el('span', `feed-icon tone-${it.look.tone}`, icon('terminal')), el('details', 'history-item', summary,
        el('div', 'history-body', el('div', 'mono muted small', `$ ${it.command}`), it.lines.length ? el('pre', 'tool-pre history-out', it.lines.join('\n')) : null))));
    }
  }
  box.append(feed);
  return box;
}

/** A note under a History line, two lines at most; hovering it shows all of it. */
function clampedNote(text: string): HTMLElement {
  const n = el('div', 'muted small clamped history-note', text);
  n.title = text;
  return n;
}

export const area: PageArea = {
  sections: { overview: { draw: renderOverview } },
};
