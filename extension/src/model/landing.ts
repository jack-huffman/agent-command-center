/**
 * The Overview as a landing page (GH-160): it says what's going on and where to look, one line per item,
 * and the detail opens on a click. Each line is a card with its state, its task's key and title, two short
 * facts at most and one button; the rest of what it did is in its ⋯ menu or in the detail it opens. Things
 * of one kind collapse into one line: every suggested rule, every update draft. No list shows more than
 * CAP lines: Show all opens the rest, in the modal or on the section's own page.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { DISPLAY, type DisplayState } from '../../../packages/core/src/ledger.ts';
import type { Tone } from '../logic/shared.ts';
import { ordinal } from '../../../packages/core/src/queue.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { elapsed, type ProgressAction, type ProgressGroup, type ProgressModel } from '../progress.ts';
import type { HistoryItem } from './history.ts';
import { type AttentionItem, needsYouCount, type OverviewModel, type QueuePanel } from './overview.ts';
import type { QuestionCard } from './questions.ts';
import { displayLook, type HomeSection, type Look, LOOK, type Ref } from './shared.ts';

/** The most lines a list shows on the Overview; Show all opens the rest. */
export const CAP = 5;

export type GroupKey = 'needs-you' | 'moment' | 'progress' | 'queue' | 'ready' | 'history';

/** What a line's button, a click on the line, or Show all does on the page. */
export type RowDo =
  /** Runs an acc.* command on a ref, as an action's button does. */
  | { kind: 'run'; command: string; ref: Ref }
  /** Runs a command with one argument, such as a tracker's sign-in, or Stop on a job. */
  | { kind: 'toolbar'; command: string; arg: string }
  /** Moves to a section of the page. */
  | { kind: 'go'; section: HomeSection }
  /** Opens a task in the modal over the page (GH-158, D-129). */
  | { kind: 'task'; project: string; key: string }
  /** Opens a detail in the modal: a question, the suggested rules, the update drafts, a list in full, or History. */
  | { kind: 'detail'; detail: Detail }
  /** Opens a web link, such as a pull request. */
  | { kind: 'link'; url: string };

/** A detail the modal shows. Rules and updates show one at a time, from `at`. History opens at `item`, its index. */
export type Detail =
  | { kind: 'question'; id: string }
  | { kind: 'rules'; at?: number }
  | { kind: 'updates'; at?: number }
  | { kind: 'list'; group: GroupKey }
  | { kind: 'history'; item?: number };

/** A line's button. Only Needs you's are primary, the blue fill; every other list's are outlined (D-147). */
export interface RowButton { label: string; icon: string; tip?: string; primary?: boolean; do: RowDo }

/**
 * A line's ⋯ menu: VSCode's own, built from the row's context (package.json's webview/context). The commands
 * get the ref back. A task line's flags are TASK_MENU's; an agent's are its own (`agent`), as on Agents.
 */
export interface RowMenu { section: 'task' | 'agent' | 'tidy' | 'branch'; ref: Record<string, string>; flags: Record<string, boolean> }

/** A short fact on a line, cut with an ellipsis where there's no room: all of it on hover. */
export interface Fact { text: string }

export interface LandingRow {
  key: string;
  /** Its state, in words with an icon. */
  look: Look;
  /** Its task's key, in a chip, or null for a line that isn't one task's. */
  id: string | null;
  title: string;
  /** Two at most, each a few words. */
  facts: Fact[];
  /** The one button on the line, or none. */
  action: RowButton | null;
  /** The rest of what it does, in its ⋯ menu, or none. */
  menu: RowMenu | null;
  /** What a click on the line opens, or nothing. */
  open: RowDo | null;
  /** What no longer shows on the line, on hover: the whole detail. */
  tip: string | null;
  /** A job that ended in the last minute: its line fades from this many seconds in (D-092). */
  fading?: number;
}

export interface LandingGroup {
  key: GroupKey;
  title: string;
  icon: string;
  tone: Tone;
  /** The heading's number: what the list stands for, which a collapsed line can hold several of. */
  count: number;
  /** The lines the page shows: CAP at most. */
  rows: LandingRow[];
  /** How many lines there are in all. */
  total: number;
  /** Show all N, where there are more than CAP: the list in the modal, or the section's own page. */
  more: { label: string; do: RowDo } | null;
  /** Every line, where Show all opens them in the modal. */
  all: LandingRow[] | null;
  /** What the list says with no lines, or null where it isn't shown then. */
  empty: string | null;
}

/**
 * The commands a task's line may hold in its ⋯ menu, each behind the flag its row's context sets.
 * package.json's webview/context lists the same, under webviewSection 'task', and a test holds them to it.
 */
export const TASK_MENU: Record<string, string> = {
  'acc.task.watch': 'taskWatch',
  'acc.task.watchReview': 'taskReview',
  'acc.task.watchAnalysis': 'taskAnalysis',
  'acc.autopilot.output': 'taskOutput',
  'acc.task.openInClaude': 'taskClaude',
  'acc.task.openPr': 'taskPr',
  'acc.job.stop': 'taskStop',
};

/** How the Overview's own lines show: a question, the collapsed update drafts and rules, and a move it couldn't name. */
export const LANDING_LOOK: Record<'permission' | 'question' | 'stale' | 'drafts' | 'posting' | 'rules' | 'moved', Look> = {
  permission: LOOK('Asks permission', 'bell', 'orange'),
  question: LOOK('Asks a question', 'question', 'orange'),
  stale: LOOK('May have posted', 'warning', 'orange'),
  drafts: LOOK('Drafts to post', 'comment-draft', 'orange'),
  posting: LOOK('Posting', 'sync~spin', 'blue'),
  rules: LOOK('Rules suggested', 'law', 'neutral'),
  moved: LOOK('Moved', 'arrow-swap', 'neutral'),
};

const facts = (...xs: (string | null | undefined | false)[]): Fact[] => xs.filter((x): x is string => !!x && !!x.trim()).slice(0, 2).map((text) => ({ text }));
const detail = (d: Detail): RowDo => ({ kind: 'detail', detail: d });

/** The collapsed update drafts' state: one that may have posted first, then a draft to post, then posting. */
export function updatesLook(items: Pick<AttentionItem, 'update'>[]): Look {
  const cards = items.flatMap((a) => (a.update ? [a.update] : []));
  if (cards.some((c) => c.stale)) return LANDING_LOOK.stale;
  return cards.some((c) => c.state === 'draft') ? LANDING_LOOK.drafts : LANDING_LOOK.posting;
}

/** A move's line in History: the state it reached, as everywhere (core's DISPLAY), or Moved for one it doesn't name. */
export function moveLook(to: string): Look {
  return to in DISPLAY ? displayLook(to as DisplayState) : LANDING_LOOK.moved;
}

/** An agent's question: what it asks, and Answer, which opens it in the modal with its options and its answer box. */
function questionRow(q: QuestionCard, now: number, many: boolean): LandingRow {
  const asks = q.kind === 'question' ? q.questions.map((x) => x.question).join(' · ') || q.title : q.code ? `${q.title}: ${q.code.split('\n')[0]}` : q.detail ?? q.title;
  const title = q.task ? asks : `${q.who} ${asks}`;
  const open = detail({ kind: 'question', id: q.id });
  return {
    key: `q:${q.id}`, look: q.kind === 'question' ? LANDING_LOOK.question : LANDING_LOOK.permission, id: q.task, title,
    facts: facts(`${elapsed(now - q.askedAt)} ago`, many ? q.projectName : null),
    action: { label: 'Answer', icon: 'reply', tip: 'Open the question, with its answers', do: open }, menu: null, open, tip: title,
  };
}

/** One item that needs you, or waits on you: its button, the rest of its buttons in ⋯, and its task's page on a click. */
function attentionRow(a: AttentionItem, many: boolean): LandingRow {
  const task = a.key.startsWith('t:') ? a.actions.find((x) => x.command === 'acc.task.show')?.ref : undefined;
  const id = task?.task ?? null;
  const title = id && a.title.startsWith(`${id} `) ? a.title.slice(id.length + 1) : a.title;
  const said = a.project && a.detail.startsWith(`${a.project} · `) ? a.detail.slice(a.project.length + 3) : a.detail;
  const modal: RowDo | null = task?.project && id ? { kind: 'task', project: task.project, key: id } : null;
  const rest = a.actions.filter((x) => x.command !== 'acc.task.show');
  const first = rest.find((x) => x.primary) ?? rest[0];
  let action: RowButton | null = null;
  if (a.analysis && modal) action = { label: 'Answer', icon: 'question', tip: 'Open the task, with its analysis\'s questions to answer', do: modal };
  else if (first) action = { label: first.label, icon: first.icon, tip: first.label, do: { kind: 'run', command: first.command, ref: first.ref } };
  else if (a.extra) action = { label: a.extra.label, icon: a.extra.icon, tip: a.extra.label, do: { kind: 'toolbar', command: a.extra.command, arg: a.extra.arg } };
  else if (a.go) action = { label: a.go.label, icon: 'arrow-right', tip: a.go.label, do: { kind: 'go', section: a.go.section } };
  else if (modal) action = { label: 'Open', icon: 'go-to-file', tip: 'Open the task over the page', do: modal };
  // The rest of a task's buttons in its ⋯ menu; an agent's and the tidy-up's say their own.
  const flags = Object.fromEntries(rest.filter((x) => x !== first && TASK_MENU[x.command]).map((x) => [TASK_MENU[x.command]!, true]));
  const menu: RowMenu | null = a.menu ?? (task && Object.keys(flags).length ? { section: 'task', ref: { project: task.project!, task: id! }, flags } : null);
  return { key: a.key, look: a.look, id, title, facts: facts(said, many ? a.project : null), action, menu, open: modal, tip: [a.title, a.tip ?? a.detail].join('\n') };
}

/** Every update draft, as one line: Review opens them one at a time, each with its text, Post, Edit and Discard. */
function updatesRow(items: AttentionItem[]): LandingRow {
  const keys = [...new Set(items.map((a) => a.update!.key))];
  const open = detail({ kind: 'updates' });
  const title = `${plural(items.length, 'update draft')} waiting to post`;
  return {
    key: 'updates', look: updatesLook(items), id: null, title, facts: facts(keys.join(', ')),
    action: { label: 'Review', icon: 'eye', tip: 'Read each draft, then post, edit or discard it', do: open }, menu: null, open,
    tip: items.map((a) => `${a.title}: ${a.update!.about}`).join('\n'),
  };
}

/** Every suggested rule and check, as one line: Review opens them one at a time, each with the reviews it came from. */
function rulesRow(items: AttentionItem[]): LandingRow {
  const open = detail({ kind: 'rules' });
  const reviews = new Set(items.flatMap((a) => a.rule!.sources.map((s) => `${s.task}@${s.sha}`))).size;
  return {
    key: 'rules', look: LANDING_LOOK.rules, id: null, title: `${plural(items.length, 'suggested rule')}, from repeated review findings`, facts: facts(`from ${plural(reviews, 'review')}`),
    action: { label: 'Review', icon: 'eye', tip: 'Read each, with the reviews it came from, then accept or dismiss it', do: open }, menu: null, open,
    tip: items.map((a) => a.rule!.line).join('\n'),
  };
}

/** What a task's checks are doing, as one fact: "near-tests running", "2 checks running", "2 checks, 1 waiting". */
export function checksFact(g: Pick<ProgressGroup, 'jobs'>): string | null {
  const checks = g.jobs.filter((j) => j.kind === 'check');
  if (!checks.length) return null;
  const waiting = checks.filter((j) => j.look.label !== 'Running');
  if (checks.length === 1) return `${checks[0]!.label.replace(/^Check: /, '')} ${waiting.length ? waiting[0]!.look.label.toLowerCase() : 'running'}`;
  if (!waiting.length) return `${checks.length} checks running`;
  return waiting.length === checks.length ? `${checks.length} checks waiting` : `${checks.length} checks, ${waiting.length} waiting`;
}

/** A button from one of In progress's: Answer opens its question here; the rest run their command. */
function progressButton(a: ProgressAction): RowButton {
  const run: RowDo = a.question ? detail({ kind: 'question', id: a.question }) : a.ref && a.command ? { kind: 'run', command: a.command, ref: a.ref } : { kind: 'toolbar', command: a.command ?? '', arg: a.arg ?? '' };
  return { label: a.label, icon: a.icon, tip: a.question ? 'Open its question, with its answers' : a.tip, do: run };
}

/**
 * A task with something under way, as one line (D-092): what its first job is doing, how long, and its
 * checks as one fact. Its page opens on a click; Watch, Open in Claude Code, Stop and the rest are in ⋯.
 */
function progressRow(g: ProgressGroup): LandingRow {
  const first = g.jobs[0];
  const ended = g.done.at(-1);
  const acts = g.jobs.flatMap((j) => j.actions.map((a) => ({ j, a })));
  const pick = acts.find((x) => x.a.question) ?? acts.find((x) => x.a.command !== 'acc.job.stop') ?? acts[0];
  const stops = acts.filter((x) => x.a.command === 'acc.job.stop' && x.a.arg).map((x) => ({ label: `${x.j.label}: ${x.a.label}`, tip: x.a.tip, arg: x.a.arg! }));
  const flags = Object.fromEntries(acts.filter((x) => TASK_MENU[x.a.command ?? '']).map((x) => [TASK_MENU[x.a.command!]!, true]));
  const others = g.jobs.slice(1).filter((j) => j.kind !== 'check').map((j) => j.label);
  const second = checksFact(g) ?? (others.length ? `and ${others.join(', ')}` : first?.detail || null);
  const tip = [g.ref ? `${g.id} ${g.title}` : `${g.id}: ${g.title}`, ...g.jobs.map((j) => `${j.label}: ${j.look.label}${j.detail ? `, ${j.detail}` : ''}${j.since ? ` (${j.since})` : ''}`), ...g.done.map((d) => d.text), g.note, g.project].filter(Boolean).join('\n');
  return {
    key: g.key, look: first?.look ?? ended?.look ?? g.look, id: g.ref ? g.id : null, title: g.ref ? g.title : g.id,
    facts: first ? facts(g.since, second) : facts(ended?.text),
    action: pick ? progressButton(pick.a) : null,
    menu: g.ref && Object.keys(flags).length ? { section: 'task', ref: { project: g.ref.project!, task: g.ref.task!, ...(stops.length ? { stops: JSON.stringify(stops) } : {}) }, flags } : null,
    open: g.ref?.project && g.ref.task ? { kind: 'task', project: g.ref.project, key: g.ref.task } : null,
    tip, ...(!first && ended ? { fading: ended.age } : {}),
  };
}

/** A pull request in a merge queue (GH-73): what it waits on, its place, its pull request, and its task on a click. */
function queueRows(q: QueuePanel, many: boolean): LandingRow[] {
  return q.rows.map((r) => ({
    key: `queue:${q.root}:${r.id}`, look: r.look, id: r.id, title: r.title, facts: facts(r.place === 1 ? 'next to merge' : `${ordinal(r.place)} in line`, many ? q.project : null),
    action: r.pr ? { label: `#${r.pr.number}`, icon: 'git-pull-request', tip: `Open pull request #${r.pr.number} on GitHub`, do: { kind: 'link', url: r.pr.url } } : null,
    menu: null, open: { kind: 'task', project: q.root, key: r.id },
    tip: [r.tip ?? r.look.label, q.off ? 'Autopilot is off, so the queue waits. Turn it on from the status bar.' : ''].filter(Boolean).join('\n'),
  }));
}

/** One thing in History: a move, a step autopilot took, your answer or a command acc ran; its task or its detail on a click. */
function historyRow(it: HistoryItem, index: number, now: number, roots: Map<string, string>, many: boolean): LandingRow {
  const ago = `${elapsed(now - Date.parse(it.at))} ago`;
  const where = many && 'project' in it ? it.project : null;
  const task = (key: string, project: string): RowDo | null => (roots.has(project) ? { kind: 'task', project: roots.get(project)!, key } : null);
  const own = detail({ kind: 'history', item: index });
  switch (it.kind) {
    case 'move':
      return { key: `h:${index}`, look: moveLook(it.to), id: it.task, title: it.title, facts: facts(ago, it.by.replace(/^human:/, '')), action: null, menu: null, open: task(it.task, it.project), tip: `${it.from ?? 'new'} → ${it.to}, by ${it.by.replace(/^human:/, '')}` };
    case 'autopilot':
      return {
        key: `h:${index}`, look: it.look, id: it.task, title: it.title, facts: facts(ago, where), menu: null, open: task(it.task, it.project), tip: [it.look.label, it.detail].filter(Boolean).join('\n'),
        action: it.url ? { label: 'Pull request', icon: 'git-pull-request', tip: 'Open its pull request on GitHub', do: { kind: 'link', url: it.url } } : null,
      };
    case 'answer':
      return {
        key: `h:${index}`, look: it.decision.look, id: null, title: `${it.who} ${it.decision.asked}`, facts: facts(ago, where), menu: null, open: own,
        action: { label: 'Watch', icon: 'pulse', tip: 'Follow what it does, step by step', do: { kind: 'run', command: 'acc.agent.watch', ref: { session: it.session } } },
        tip: [it.decision.code, it.decision.detail].filter(Boolean).join('\n') || null,
      };
    case 'run':
      return { key: `h:${index}`, look: it.look, id: null, title: it.label, facts: facts(ago), action: null, menu: null, open: own, tip: `$ ${it.command}` };
  }
}

/**
 * A list, capped: its first CAP lines, and Show all N, which opens `all` in the modal or goes to `to`. Its
 * buttons are primary in Needs you only, so what needs you stands out; elsewhere they're outlined (D-147).
 */
function group(g: Omit<LandingGroup, 'rows' | 'total' | 'more' | 'all'>, listed: LandingRow[], total = listed.length, to?: RowDo): LandingGroup {
  const over = total > CAP;
  const rows = listed.map((r) => (r.action ? { ...r, action: { ...r.action, primary: g.key === 'needs-you' } } : r));
  return {
    ...g, rows: rows.slice(0, CAP), total,
    more: over ? { label: `Show all ${total}`, do: to ?? detail({ kind: 'list', group: g.key }) } : null,
    all: over && !to ? rows : null,
  };
}

/**
 * The Overview's lists, in the order the page draws them: what needs you, what waits on you when you
 * have a moment, what's in progress, each merge queue, what's ready, and History. The tiles sit after In
 * progress. Questions come first in Needs you, then the collapsed lines, so they're seen within the cap.
 */
export function landing(o: Omit<OverviewModel, 'landing'>, now = Date.now()): LandingGroup[] {
  const many = o.projects.length > 1;
  const orange = (a: AttentionItem) => a.look.tone === 'orange';
  const updates = o.attention.filter((a) => a.update);
  const rules = o.attention.filter((a) => a.rule);
  const singles = o.attention.filter((a) => !a.update && !a.rule);
  const drafts = updates.length ? updatesRow(updates) : null;
  const people = needsYouCount(o);
  const needs = [...o.questions.map((q) => questionRow(q, now, many)), ...(drafts?.look.tone === 'orange' ? [drafts] : []), ...singles.filter(orange).map((a) => attentionRow(a, many))];
  const moment = [...(drafts && drafts.look.tone !== 'orange' ? [drafts] : []), ...(rules.length ? [rulesRow(rules)] : []), ...singles.filter((a) => !orange(a)).map((a) => attentionRow(a, many))];
  const p: ProgressModel = o.inProgress;
  const roots = new Map(o.projects.map((x) => [x.name, x.root]));
  const queue = o.queue.flatMap((q) => queueRows(q, many || o.queue.length > 1));
  const ready = o.ready.map((r): LandingRow => ({
    key: `ready:${r.action.ref.project}:${r.id}`, look: displayLook('ready'), id: r.id, title: r.title, facts: facts(r.environment, many ? r.project : null),
    action: { label: r.action.label, icon: r.action.icon, tip: r.action.label, do: { kind: 'run', command: r.action.command, ref: r.action.ref } },
    menu: null, open: r.action.ref.project ? { kind: 'task', project: r.action.ref.project, key: r.id } : null, tip: `${r.id} ${r.title}`,
  }));
  return [
    group({ key: 'needs-you', title: people ? 'Needs you' : 'All clear', icon: people ? 'bell-dot' : 'pass', tone: people ? 'orange' : 'blue', count: people, empty: 'No agent is waiting, nothing is blocked, and setup is done.' }, needs),
    group({ key: 'moment', title: 'When you have a moment', icon: 'inbox', tone: 'neutral', count: o.attention.filter((a) => !orange(a)).length, empty: null }, moment),
    group({ key: 'progress', title: 'In progress', icon: 'pulse', tone: p.count ? 'blue' : 'neutral', count: p.count, empty: p.empty ?? 'No task here has anything under way.' }, p.groups.map(progressRow)),
    group({ key: 'queue', title: 'Merge queue', icon: 'git-merge', tone: 'neutral', count: queue.length, empty: null }, queue),
    group({ key: 'ready', title: 'Ready for an agent', icon: 'rocket', tone: 'neutral', count: ready.length, empty: 'Nothing is ready to dispatch. Track a ticket from a board, or add a task.' }, ready, ready.length, { kind: 'go', section: 'tasks' }),
    group({ key: 'history', title: 'History', icon: 'history', tone: 'neutral', count: o.history.length, empty: 'What agents and tasks do shows up here.' },
      o.history.slice(0, CAP).map((it, i) => historyRow(it, i, now, roots, many)), o.history.length, detail({ kind: 'history' })),
  ];
}
