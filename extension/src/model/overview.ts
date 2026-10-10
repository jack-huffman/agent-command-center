/**
 * The Overview: what needs you, its stat tiles, and each project's merge queue.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { phaseWords } from '../../../packages/core/src/queue.ts';
import type { AnalysisAsk, TaskRow, Tone } from '../logic/shared.ts';
import type { ProgressModel } from '../progress.ts';
import type { HistoryItem } from './history.ts';
import type { QuestionCard } from './questions.ts';
import { type Action, type HomeSection, type HubLike, type Look, LOOK, type ModelArea, type Ref } from './shared.ts';
import type { RuleCard } from './rules.ts';
import type { UpdateCard } from './updates.ts';
import type { HomeInput } from './home.ts';
import type { LandingGroup, RowMenu } from './landing.ts';
import { autoMergeOn } from '../../../packages/core/src/config.ts';

export interface AttentionItem {
  key: string;
  look: Look;
  title: string;
  detail: string;
  /** More than the detail has room for, on hover: a conflict's files in full. */
  tip?: string;
  project: string;
  actions: Action[];
  /** A command that takes one argument, such as a tracker's sign-in. */
  extra?: { command: string; label: string; icon: string; arg: string };
  /** A section of the page to open, such as Setup. */
  go?: { section: HomeSection; label: string };
  /** A task's analysis's questions, answered right here (D-052), or sent to the client when it has a ticket (D-066). */
  analysis?: { project: string; task: string; questions: AnalysisAsk[]; canAsk?: boolean };
  /** An update for a ticket, to post or discard right here, or edit on its task's page (D-066). */
  update?: UpdateCard;
  /** A rule or check suggested by a review finding that keeps coming back, to accept or dismiss right here (GH-102). */
  rule?: RuleCard;
  /** Its line's ⋯ menu on the Overview, where its area names one (GH-160): an agent's, as on Agents, or the tidy-up's. */
  menu?: RowMenu;
}

export interface StatTile {
  label: string;
  value: string;
  icon: string;
  tone: Tone;
  section: HomeSection;
  hint: string;
}

export interface OverviewModel {
  projects: { name: string; root: string; branch: string | null; account: string | null; trackers: string[] }[];
  /** Agents' questions, answered right here. They come before everything else that needs you. */
  questions: QuestionCard[];
  attention: AttentionItem[];
  stats: StatTile[];
  ready: { project: string; id: string; title: string; environment: string; action: Action }[];
  /** Each project's merge queue, where auto-merge is on and it holds a pull request (GH-73). */
  queue: QueuePanel[];
  /** Everything that happened, newest first (D-037). */
  history: HistoryItem[];
  /** Every job under way, grouped by task, below Needs you (D-092). It never adds to the badge. */
  inProgress: ProgressModel;
  /** The page's lists, a line per item and five to a list, worked out from the rest (GH-160). */
  landing: LandingGroup[];
}

/** A project's merge queue on the Overview (GH-73): head first, each with its place and what it waits on. */
export interface QueuePanel {
  project: string;
  root: string;
  /** Autopilot isn't running for the repo, here or elsewhere, so the queue doesn't move. */
  off: boolean;
  /** tip: what the head waits on in full, when its words are the wait's own and may not fit. */
  rows: { place: number; id: string; title: string; ref: Ref; pr: { number: number; url: string } | null; look: Look; tip?: string }[];
}

/**
 * What a task in the merge queue waits on (GH-73), with an icon and words, in blue: the head's phase, or
 * the task ahead of it. Held, the head says why, in the wait's own words. With autopilot off, the head
 * says so. A task in the queue never needs you: one that would has left it.
 */
export function queueLook(q: NonNullable<TaskRow['queue']>, base: string, off = false): Look {
  if (q.ahead) return LOOK(`Behind ${q.ahead}`, 'arrow-up', 'blue');
  if (off) return LOOK('Autopilot is off', 'debug-pause', 'blue');
  const look: Record<NonNullable<TaskRow['queue']>['phase'], Look> = {
    waiting: LOOK('Next to merge', 'arrow-circle-right', 'blue'),
    refreshing: LOOK(`Merging ${base} in`, 'repo-pull', 'blue'),
    slot: LOOK('Waiting for a heavy-check slot', 'watch', 'blue'),
    checking: LOOK('Running the full check', 'sync~spin', 'blue'),
    github: LOOK('Waiting for GitHub\'s checks', 'github-action', 'blue'),
    held: LOOK(phaseWords('held', base, q.why), 'clock', 'blue'),
    merging: LOOK('Merging', 'git-merge', 'blue'),
  };
  return look[q.phase];
}

/** How many things need a person: each question, and each orange item. The badge and the Overview agree. */
export const needsYouCount = (o: Pick<OverviewModel, 'questions' | 'attention'>): number => o.questions.length + o.attention.filter((a) => a.look.tone === 'orange').length;

/** Each repo's merge queue, once, though two projects share a repo's ledger (GH-73). */
export function mergeQueues(hub: HubLike, autopilot: HomeInput['autopilot']): QueuePanel[] {
  const queue: QueuePanel[] = [];
  const shown = new Set<string>();
  for (const p of hub.projects) {
    if (!autoMergeOn(p.config)) continue;
    const inLine = hub.taskRows(p.root).filter((r) => r.queue && !shown.has(r.id)).sort((a, b) => a.queue!.place - b.queue!.place);
    if (!inLine.length) continue;
    for (const r of inLine) shown.add(r.id);
    // Autopilot runs for the repo, here or in another window, or the queue doesn't move.
    const off = !autopilot?.(p.root);
    queue.push({
      project: p.name, root: p.root, off,
      rows: inLine.map((r) => ({ place: r.queue!.place, id: r.id, title: r.title, ref: { project: p.root, task: r.id }, pr: r.pr ? { number: r.pr.number, url: r.pr.url } : null, look: queueLook(r.queue!, r.environment, off), ...(!off && !r.queue!.ahead && r.queue!.phase === 'held' && r.queue!.why ? { tip: r.queue!.why } : {}) })),
    });
  }
  return queue;
}

export const area: ModelArea = {
  commands: [
    // In progress (D-092): a job's Stop asks first; autopilot's output for its step.
    'acc.job.stop', 'acc.autopilot.output',
  ],
  home: {
    order: 0,
    nav({ questions, attention }) {
      const people = needsYouCount({ questions, attention });
      return { section: 'overview', label: 'Overview', icon: 'home', count: people || null, attention: people > 0, hint: people ? `${people} thing${people === 1 ? '' : 's'} need you` : 'Nothing needs you' };
    },
  },
};

