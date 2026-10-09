import type { CardState, Config, Tracker } from './config.ts';
import type { Runner, RunResult } from './exec.ts';
import { ghToken } from './land.ts';
import { type CardMove, isReady, type Ledger, mutate, readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { pickProject, type ProjectNode } from './trackers/github.ts';

/**
 * A task's card on its GitHub Project follows the task (GH-146): as acc moves a task from one state to
 * another, it sets the card's Status to the column that stands for the new state. Only where the GitHub
 * tracker that owns GH- keys says "edits": true (D-066, D-082), only for a task from one of its issues,
 * and only as the repo's account (D-007). The one write is the card's Status field. A Project with no
 * column for the state, or an issue not on it, is left alone. acc moves a card once per state it enters,
 * so a card a person drags on the board stays where they put it until the task moves again. A move that
 * fails is kept on the task and said once; the task's own move stands.
 */

/** The columns a state's card goes to when "statusFor" doesn't say, by name, ignoring case: the first the Project has. */
export const CARD_COLUMNS: Record<CardState, string[]> = {
  todo: ['Todo'],
  ready: ['Todo'],
  running: ['In Progress'],
  rework: ['In Progress'],
  review: ['Testing', 'In Review'],
  blocked: ['Blocked'],
  done: ['Done'],
};

export interface StatusOption {
  id: string;
  name: string;
}

/** The state a task's card stands for: its own, or ready, a task to do whose deps are done. */
export const cardState = (ledger: Pick<Ledger, 'tasks'>, task: Task): CardState => (task.state === 'todo' && isReady(ledger as Ledger, task) ? 'ready' : task.state);

/** The column "statusFor" names for a state, if any: ready falls back to todo's, as a task ready is one to do. */
const namedFor = (state: CardState, statusFor: Record<string, string> | null): string | undefined =>
  statusFor?.[state] ?? (state === 'ready' ? statusFor?.todo : undefined);

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The Project's column for a state, matched by name ignoring case, or null when none stands for it. */
export function columnFor(state: CardState, options: StatusOption[], statusFor: Record<string, string> | null): StatusOption | null {
  const named = namedFor(state, statusFor);
  for (const want of named ? [named] : CARD_COLUMNS[state]) {
    const o = options.find((x) => same(x.name, want));
    if (o) return o;
  }
  return null;
}

/** The GitHub tracker whose cards follow their tasks: the one that owns GH- keys, where it says "edits" and the repo has an account. */
function cardTracker(config: Config): Tracker | null {
  const tracker = config.trackers.find((t) => t.kind === 'github');
  return tracker?.edits && config.github ? tracker : null;
}

/** Whether acc moves cards here at all. */
export const followsCards = (config: Config): boolean => !!cardTracker(config);

/** What became of one card. */
export interface CardResult {
  task: string;
  state: CardState;
  /** moved: its Status was set. already: it was in that column. left: no column, or no card, to move. */
  outcome: 'moved' | 'already' | 'left' | 'failed';
  /** The column it went to, or was in, or would have gone to. */
  column?: string;
  reason?: string;
}

/** How long each gh call may take, as acc sync's others do. */
const GH_CALL_MS = 60_000;

const CARD_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 10) { nodes { id number closed
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } }
    issue(number: $number) { projectItems(first: 20) { nodes { id project { id }
      fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } } } } }
  }
}`;

const MOVE_MUTATION = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } }
}`;

interface CardData {
  repository: {
    projectsV2: { nodes: ProjectNode[] };
    issue: { projectItems: { nodes: { id: string; project: { id: string }; fieldValueByName: { optionId?: string; name?: string } | null }[] } } | null;
  } | null;
}

/** What gh said, in one line. */
const firstLine = (r: RunResult): string => (r.stderr || r.stdout).trim().split('\n')[0] || `gh exited with ${r.code}.`;

/** One GraphQL call through gh: its data, or why it failed. */
function graphql<T>(run: Runner, env: NodeJS.ProcessEnv, query: string, vars: Record<string, string | number>): { data: T } | { error: string } {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
  const r = run('gh', args, { env, timeoutMs: GH_CALL_MS });
  if (r.code !== 0) {
    const why = firstLine(r);
    return { error: /scope|INSUFFICIENT_SCOPES/i.test(why) ? `${why}. Give the account access to Projects: gh auth refresh -h github.com -s project` : why };
  }
  try {
    const out = JSON.parse(r.stdout) as { data?: T; errors?: { message: string }[] };
    if (out.errors?.length) return { error: out.errors[0]!.message };
    return { data: out.data as T };
  } catch {
    return { error: 'gh\'s answer wasn\'t JSON' };
  }
}

/** Moves one task's card: reads where it is, then sets its Status when it's elsewhere. */
function moveCard(run: Runner, env: NodeJS.ProcessEnv, repo: string, tracker: Tracker, n: number, state: CardState): Pick<CardResult, 'outcome' | 'column' | 'reason'> {
  const [owner, name] = repo.split('/') as [string, string];
  const read = graphql<CardData>(run, env, CARD_QUERY, { owner, name, number: n });
  if ('error' in read) return { outcome: 'failed', reason: read.error };
  const r = read.data.repository;
  if (!r?.issue) return { outcome: 'left', reason: `GitHub can't find issue #${n} in ${repo}` };
  const board = typeof tracker.board === 'number' ? tracker.board : null;
  const project = pickProject(r.projectsV2.nodes, board);
  if (!project) return { outcome: 'left', reason: board != null ? `${repo} has no Project ${board} with a Status field` : `${repo} has no open Project with a Status field` };
  const item = r.issue.projectItems.nodes.find((x) => x.project.id === project.id);
  if (!item) return { outcome: 'left', reason: 'its issue isn\'t on the GitHub Project' };
  const column = columnFor(state, project.field!.options, tracker.statusFor);
  if (!column) {
    const named = namedFor(state, tracker.statusFor);
    return { outcome: 'left', reason: named ? `the GitHub Project has no column ${named}, which statusFor names for ${state}` : `the GitHub Project has no column for ${state}` };
  }
  if (item.fieldValueByName?.optionId === column.id) return { outcome: 'already', column: column.name };
  const moved = graphql<unknown>(run, env, MOVE_MUTATION, { project: project.id, item: item.id, field: project.field!.id, option: column.id });
  return 'error' in moved ? { outcome: 'failed', column: column.name, reason: moved.error } : { outcome: 'moved', column: column.name };
}

/**
 * Moves the cards of these tasks, which acc just moved, to the columns for their states now, and keeps on
 * each task where its card went, or why it couldn't (`card`). Only tasks from the card tracker's issues
 * count: any other is skipped, as is every task where no GitHub tracker says "edits": true, without a call
 * to gh. A failure never undoes the task's move. `env` is the process's: gh's token for the repo's account
 * is added here, once there's a card to move.
 */
export function followCards(paths: RepoPaths, config: Config, ids: string[], deps: { run: Runner; now: () => Date; env: NodeJS.ProcessEnv }): CardResult[] {
  const tracker = cardTracker(config);
  if (!tracker || !ids.length) return [];
  const ledger = readLedger(paths.ledger);
  const due = ledger.tasks.filter((t) => ids.includes(t.id) && t.source.kind === 'github' && /^GH-\d+$/.test(t.id));
  if (!due.length) return [];
  const repo = tracker.repo ?? config.github!.repo;
  let env: NodeJS.ProcessEnv | { error: string };
  try {
    env = { ...deps.env, GH_TOKEN: ghToken(deps.run, config.github!.account) };
  } catch (e) {
    env = { error: (e as Error).message };
  }
  const results: (CardResult & { from: Task['state'] })[] = due.map((t) => {
    const state = cardState(ledger, t);
    const base = { task: t.id, state, from: t.state };
    if ('error' in env) return { ...base, outcome: 'failed' as const, reason: env.error };
    return { ...base, ...moveCard(deps.run, env as NodeJS.ProcessEnv, repo, tracker, Number(t.id.slice(3)), state) };
  });
  const at = deps.now().toISOString();
  mutate(paths, deps.now, (l, emit) => {
    for (const r of results) {
      const t = l.tasks.find((x) => x.id === r.task);
      // Moved on again meanwhile: that move's own follow keeps its card.
      if (!t || t.state !== r.from) continue;
      let card: CardMove | null;
      if (r.outcome === 'left') {
        // Nothing to say about a card that wasn't moved, but an older failure isn't this state's.
        if (!t.card) continue;
        card = null;
      } else card = { state: t.state, column: r.column ?? null, at, ...(r.outcome === 'failed' ? { failed: r.reason ?? '' } : {}) };
      t.card = card;
      emit({ type: 'task.updated', task: t.id, actor: 'sync', by: 'acc cards', data: { card } });
    }
  });
  return results.map(({ from: _from, ...r }) => r);
}

/** A card's failure still to show on its task: one from the state it's in now. */
export const cardFailure = (task: Pick<Task, 'state' | 'card'>): string | null =>
  (task.card?.failed !== undefined && task.card.state === task.state ? task.card.failed : null);

/** A card that couldn't move, in words. */
export const cardWords = (r: CardResult): string =>
  `Couldn't move ${r.task}'s card${r.column ? ` to ${r.column}` : ''} on its GitHub Project: ${(r.reason ?? '').replace(/[.\s]+$/, '')}. ${r.task} is ${r.state} all the same.`;
