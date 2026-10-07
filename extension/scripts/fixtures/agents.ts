/**
 * The sessions Claude Code lists, and what each repo's ledger says about them (D-095): the sample project's
 * builders and reviewer, sessions elsewhere on the machine, and a repo that isn't open here.
 */
import type { RepoAgents, State } from '../../../packages/core/src/ledger.ts';
import type { AgentSession, TaskRow } from '../../src/logic/shared.ts';
import { sampleAnalyses } from './analysis.ts';
import { CLIENTS, MIN, N10, N12, N12a, N13, N14, N28, N29, N38, R20, ROOT, wt } from './shared.ts';

export function sampleAgents(now = Date.now()): AgentSession[] {
  const root = ROOT;
  return [
    { cwd: wt('ACME-14'), kind: 'background', startedAt: now - 27 * MIN, id: 'bg14', sessionId: 's-acme-14', name: N14, state: 'working', pid: 4010 },
    { cwd: wt('ACME-12'), kind: 'background', startedAt: now - 12 * MIN, id: 'bg12', sessionId: 's-acme-12', name: N12, state: 'working', pid: 4012 },
    { cwd: wt('ACME-13'), kind: 'background', startedAt: now - 9 * MIN, id: 'bg13', sessionId: 's-acme-13', name: N13, state: 'working', pid: 4013 },
    // Stopped builders: their sessions keep their last state once their process has gone.
    { cwd: root, kind: 'background', startedAt: now - 95 * MIN, id: 'bg28', sessionId: 's-acme-28', name: N28, state: 'blocked' },
    { cwd: root, kind: 'background', startedAt: now - 70 * MIN, id: 'bg29', sessionId: 's-acme-29', name: N29, state: 'blocked' },
    // A builder dispatched before agents were named for their project, task and role (D-087). acc can't tie
    // it to a task, so it reads as Claude Code says: it needs you.
    { cwd: wt('ACME-11'), kind: 'background', startedAt: now - 40 * MIN, id: 'bg11', sessionId: 's-acme-11', name: 'ACME-11', state: 'blocked', waitingFor: 'permission prompt', pid: 4011 },
    // Finished (D-095): ACME-10's builder, left waiting at its prompt after its task was done; ACME-12's first
    // builder, before the rework; and ACME-20's reviewer, whose verdict is recorded.
    { cwd: wt('ACME-10'), kind: 'background', startedAt: now - 3 * 24 * 60 * MIN, id: 'bg10', sessionId: 's-acme-10', name: N10, state: 'blocked', status: 'waiting', pid: 4020 },
    { cwd: wt('ACME-12'), kind: 'background', startedAt: now - 26 * 60 * MIN, id: 'bg12a', sessionId: 's-acme-12a', name: N12a, state: 'blocked', pid: 4021 },
    { cwd: wt('ACME-20'), kind: 'interactive', startedAt: now - 8 * MIN, sessionId: 'rv-acme-20', name: R20, status: 'idle' },
    { cwd: root, kind: 'interactive', startedAt: now - 120 * MIN, sessionId: '0e02-main', name: 'acme-dev', status: 'busy', pid: 4100 },
    { cwd: '/Users/me/code/side-project', kind: 'interactive', startedAt: now - 30 * 60 * MIN, sessionId: '7c1d-side', name: 'side-project', status: 'idle', pid: 4200 },
    { cwd: '/Users/me/Documents/a folder with a long name/docs-site', kind: 'background', startedAt: now - 7 * 24 * 60 * MIN, id: 'bg3', name: 'docs-site', state: 'done' },
    // Elsewhere, each kind of folder (GH-83): two repos of one name, a builder's worktree of one, a folder
    // inside a repo, home, and a folder in no repo. None is working or needs you, so the counts hold.
    { cwd: '/Users/me/clients/Acme Service', kind: 'interactive', startedAt: now - 3 * 60 * MIN, sessionId: '5a2e-client', name: 'acme-support', status: 'idle', pid: 4300 },
    { cwd: '/Users/me/personal/Acme Service', kind: 'interactive', startedAt: now - 5 * 60 * MIN, sessionId: '6b3f-personal', name: 'acme-fork', status: 'idle', pid: 4301 },
    { cwd: '/Users/me/clients/Acme Service/.claude/worktrees/ACME-40', kind: 'background', startedAt: now - 4 * 60 * MIN, id: 'bg40', sessionId: 's-acme-40', name: 'ACME-40', state: 'done' },
    { cwd: '/Users/me/code/side-project/force-app/main', kind: 'interactive', startedAt: now - 6 * 60 * MIN, sessionId: '8d4a-flows', name: 'side-flows', status: 'idle', pid: 4302 },
    { cwd: '/Users/me', kind: 'interactive', startedAt: now - 8 * 60 * MIN, sessionId: '9e5b-home', name: 'dotfiles', status: 'idle', pid: 4303 },
    { cwd: '/Users/me/Downloads/scratch', kind: 'interactive', startedAt: now - 10 * 60 * MIN, sessionId: 'af6c-scratch', name: 'scratch', status: 'idle' },
    // Finished elsewhere (D-095): two builders of tasks done in that repo's own ledger. One from before names
    // lost its process and is still listed, blocked, in the main checkout; the other waits in its worktree.
    { cwd: CLIENTS, kind: 'background', startedAt: now - 2 * 24 * 60 * MIN, id: 'bg37', sessionId: 's-acme-37', name: 'ACME-37', state: 'blocked' },
    { cwd: `${CLIENTS}/.claude/worktrees/ACME-38`, kind: 'background', startedAt: now - 20 * 60 * MIN, id: 'bg38', sessionId: 's-acme-38', name: N38, state: 'blocked', status: 'waiting', pid: 4310 },
  ];
}

/** What each repo's ledger says about its agents (D-095): this project's, from its tasks, and the one in ~/clients/Acme Service, which isn't open here. */
export function sampleLedgers(now: number, tasks: TaskRow[]): { here: RepoAgents; clients: RepoAgents } {
  const analyses = sampleAnalyses(now);
  const here: RepoAgents = {
    tasks: tasks.map((t) => ({ id: t.id, state: t.state as State, run: t.run ?? null })),
    runs: [{ task: 'ACME-12', bgId: 'bg12a', sessionId: 's-acme-12a', name: N12a, n: 1 }, ...tasks.flatMap((t) => (t.run ? [{ task: t.id, ...t.run }] : []))],
    verdicts: [{ task: 'ACME-20', sessionId: 'rv-acme-20' }],
    analyses: Object.values(analyses).map((a) => ({ task: a.task, sessionId: a.sessionId })),
    live: [{ task: 'ACME-24', sessionId: 'an-acme-24', role: 'analysis' }],
  };
  const clients: RepoAgents = {
    tasks: [{ id: 'ACME-37', state: 'done', run: { bgId: 'bg37', sessionId: 's-acme-37' } }, { id: 'ACME-38', state: 'done', run: { bgId: 'bg38', sessionId: 's-acme-38', name: N38, n: 1 } }],
    runs: [{ task: 'ACME-37', bgId: 'bg37', sessionId: 's-acme-37' }, { task: 'ACME-38', bgId: 'bg38', sessionId: 's-acme-38', name: N38, n: 1 }],
    verdicts: [], analyses: [], live: [],
  };
  return { here, clients };
}

/** The folders holding .git, for the repo each session elsewhere is in. */
export const REPOS = new Set([ROOT, CLIENTS, '/Users/me/personal/Acme Service', '/Users/me/code/side-project']);

/** What sessions no task ran last answered with, or were started with (D-086). */
export const SESSION_MODELS: Record<string, string> = { '0e02-main': 'claude-opus-5-5', '7c1d-side': 'claude-haiku-4-5-20251001' };
