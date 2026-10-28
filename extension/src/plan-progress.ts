// The planning agent's progress (T-131): while a plan is made, a reply comes, or Draft the plan runs, the task's
// conversation panel and its page show what the agent is doing, read from its session's transcript about once a
// second while either is on show, and not at all when neither is. Watch its session opens it on its page; Stop
// ends this window's own run, after the person says so, and isn't offered for a run started elsewhere.
import { join } from 'node:path';
import { analyzing, fileId } from '../../packages/core/src/analyze.ts';
import { talking } from '../../packages/core/src/plan-talk.ts';
import { planTimes, typicalPlanMs } from '../../packages/core/src/plan-times.ts';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { escapeRegExp } from '../../packages/core/src/text.ts';
import type { ExtensionArea } from './area.ts';
import { type PlanJob, PlanWatch } from './logic/plan-progress.ts';
import type { Making } from './model/talk.ts';
import type { Message, PlanProgress } from './model/plan-progress.ts';
import type { RunInput } from './model/runs.ts';
import { analysesOf } from './task-rows.ts';
import { claudeProjectsDir, transcriptFile } from './transcript.ts';

/** What a task's page and conversation panel ask of the progress: a task's now, and its two buttons. */
export interface PlanProgressActions {
  of(root: string, id: string): PlanProgress | null;
  act(m: Message): Promise<void>;
}

/** How often the progress is read while on show: about once a second, as the task asks. */
export const TICK_MS = 1_000;

/** This window's run for a task's plan or reply, while it runs: what Stop ends. */
export function planRun(runs: readonly RunInput[], id: string): RunInput | undefined {
  const re = new RegExp(`\\b(?:analyze|plan (?:talk|start)) ${escapeRegExp(id)}\\b`, 'i');
  return runs.find((r) => r.endedAt === null && re.test(r.command));
}

/** What the job's finding reads from this window: a plan it makes, since when, its runs, and whether it can watch a session. */
export interface WindowPlans {
  making: Making | null;
  since: number | null;
  runs: readonly RunInput[];
  canWatch: boolean;
  now: number;
}

/**
 * The job under way for a task, or null: a plan being made, by any acc (its marker) or this window (reading its
 * ticket first), else a reply (its marker). A plan's time counts from when this window began it, the ticket's
 * reading too. Stop is offered only for this window's own run; Watch its session only once there's a session.
 */
export function planJob(root: string, raw: string, paths: RepoPaths, w: WindowPlans): PlanJob | null {
  const id = raw.toUpperCase();
  const roots = [root, join(paths.analyses, `${fileId(id)}.work`)];
  const stop = !!planRun(w.runs, id);
  const a = analyzing(paths, id);
  if (a) return { kind: 'plan', phase: 'working', sessionId: a.sessionId, startedAt: w.since ?? Date.parse(a.startedAt), roots, watch: w.canWatch, stop };
  // Before acc has started the planning agent: reading its ticket, then starting it.
  if (w.making) return { kind: 'plan', phase: w.making === 'reading' ? 'reading' : 'working', sessionId: null, startedAt: w.since ?? w.now, roots, watch: false, stop };
  const t = talking(paths, id);
  if (t) return { kind: 'reply', phase: 'working', sessionId: t.sessionId ?? null, startedAt: Date.parse(t.startedAt), roots, watch: w.canWatch && !!t.sessionId, stop };
  return null;
}

export const area: ExtensionArea = {
  register({ vscode, hub, tickets, runs, sidebar, subscribe }) {
    const typical = new Map<string, { at: number; ms: number | null }>();
    const job = (root: string, id: string): PlanJob | null => {
      const p = hub.project(root);
      return p ? planJob(root, id, analysesOf(p), { making: tickets.making.of(root, id), since: tickets.making.since(root, id), runs: runs.views(), canWatch: !!sidebar.helpers.watch, now: Date.now() }) : null;
    };
    const watch = new PlanWatch({
      shown: () => tickets.shownTasks(),
      job,
      file: (sessionId, roots) => transcriptFile(claudeProjectsDir(), sessionId, [...roots]),
      // The recorded durations change once a plan ends: read again at most each minute.
      typical: (root) => {
        const p = hub.project(root);
        if (!p) return null;
        const was = typical.get(root);
        if (was && Date.now() - was.at < 60_000) return was.ms;
        const ms = typicalPlanMs(planTimes(analysesOf(p)));
        typical.set(root, { at: Date.now(), ms });
        return ms;
      },
      tell: (root, id, progress) => tickets.tell(root, id, { type: 'plan-progress', project: root, task: id, progress }),
      ended: (root) => tickets.refresh(root),
      now: () => Date.now(),
    });
    tickets.planProgress = {
      of: (root, id) => watch.progress(root, id),
      async act(m) {
        const j = job(m.project, m.task);
        if (!j) return;
        if (m.type === 'plan-watch') {
          if (!j.sessionId || !sidebar.helpers.watch) return;
          const still = () => job(m.project, m.task)?.sessionId === j.sessionId;
          sidebar.helpers.watch(j.sessionId, { cwd: m.project, kind: 'background', startedAt: j.startedAt, sessionId: j.sessionId, name: `Plan ${m.task.toUpperCase()}` }, still);
          return;
        }
        const run = planRun(runs.views(), m.task.toUpperCase());
        if (run) await vscode.commands.executeCommand('acc.job.stop', JSON.stringify({ kind: 'run', run: run.id, label: run.label }));
      },
    };
    const timer = setInterval(() => watch.tick(), TICK_MS);
    subscribe({ dispose: () => clearInterval(timer) });
  },
};
