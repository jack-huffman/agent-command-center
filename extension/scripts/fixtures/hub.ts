/** The sample project, as the hub holds it: what every section of the Command Center draws from. */
import type { Environment } from '../../../packages/core/src/config.ts';
import { tieSession } from '../../../packages/core/src/ledger.ts';
import { askingLabel, repoRoot } from '../../src/logic/agents.ts';
import { isUnder } from '../../src/logic/shared.ts';
import type { HubLike, ProjectLike } from '../../src/model/shared.ts';
import { REPOS, SESSION_MODELS, sampleAgents, sampleLedgers } from './agents.ts';
import { sampleAutopilot, sampleHistory } from './history.ts';
import { sampleLimits } from './limits.ts';
import { sampleAnswers, sampleQuestions } from './questions.ts';
import { CLIENTS, ROOT, wt } from './shared.ts';
import { sampleTasks } from './tasks.ts';
import { sampleTidy } from './tidy.ts';
import { sampleUpdates } from './updates.ts';

export function sampleHub(now = Date.now()): HubLike {
  const root = ROOT;
  const environments: Environment[] = [
    { name: 'Production', branch: 'production', type: 'production', org: 'Acme Production', default: false, protected: true, promotesTo: [] },
    { name: 'QA', branch: 'qa', type: 'partial', org: 'Acme QA', default: false, protected: false, promotesTo: ['production'] },
    { name: 'Dev', branch: 'dev', type: 'developer', org: 'Acme Dev', default: true, protected: false, promotesTo: ['qa', 'production'] },
  ];
  const project: ProjectLike = {
    name: 'Acme Service', root, branch: 'dev',
    agents: {
      // Nobody chose the builder's model, so it's acc's default (D-086).
      builder: { model: 'claude-opus-5-5', effort: 'high', fallbackModel: 'claude-sonnet-5-5', from: { model: 'acc', effort: 'project', fallbackModel: 'project' } },
      reviewer: { model: 'claude-sonnet-5-5', effort: null, fallbackModel: null, from: { model: 'clone', effort: 'default', fallbackModel: 'default' } },
    },
    // Autopilot may review, land, re-dispatch a rework once (D-055), resume a stopped builder once (D-067) and
    // merge the base into a conflicting pull request (D-058); it runs while a person has it on (D-064).
    // Its one tracker, the board below: which tracker owns a ticket's key is who its update posts as (D-066).
    config: { github: { repo: 'acme/service', account: 'jordan-kim' }, environments, profile: 'salesforce', autonomy: 'review', trackers: [{ kind: 'jira', project: 'ACME', prefix: null }] },
    worktrees: [
      { path: root, head: 'a1b2c3d', branch: 'dev', main: true, changed: 0, locked: false, prunable: false },
      { path: wt('ACME-12'), head: 'b2c3d4e', branch: 'task/ACME-12-case-escalation-rules', main: false, changed: 4, locked: false, prunable: false },
      { path: wt('ACME-15'), head: 'c3d4e5f', branch: 'task/ACME-15-a-very-long-branch-name-that-has-to-truncate-cleanly', main: false, changed: 0, locked: true, prunable: false },
      { path: wt('ACME-9'), head: 'd4e5f6a', branch: 'task/ACME-9-retired', main: false, changed: 0, locked: false, prunable: true },
    ],
  };
  const tasks = sampleTasks(now);
  const agents = sampleAgents(now);
  const { here, clients } = sampleLedgers(now, tasks);
  const questions = sampleQuestions(now, wt);
  const answers = sampleAnswers(now, wt);
  return {
    projects: [project], agents, agentsError: null, questions, answers,
    askingFor: (s) => { const q = questions.find((x) => x.sessionId === s.sessionId); return q ? askingLabel(q.tool) : null; },
    tieFor: (s) => (isUnder(s.cwd, root) ? tieSession(s, here) : isUnder(s.cwd, CLIENTS) ? tieSession(s, clients) : null),
    // What each session last answered with, or was started with; a dash for one not known yet (D-086).
    modelFor: (s) => tasks.find((t) => t.run?.bgId && t.run.bgId === s.id)?.model ?? SESSION_MODELS[s.sessionId ?? ''] ?? null,
    taskRows: () => tasks,
    projectFor: (p: string) => (p === root || p.startsWith(`${root}/`) ? project : undefined),
    home: '/Users/me',
    repoFor: (p: string) => repoRoot(p, '/Users/me', (d) => REPOS.has(d)),
    // Another window's Command Center shows ~/clients/Acme Service (GH-119).
    otherWindows: [CLIENTS, `${CLIENTS}/.claude/worktrees/ACME-42`],
    autopilotLog: () => sampleAutopilot(now),
    updates: () => sampleUpdates(now),
    tidy: sampleTidy,
    history: () => sampleHistory(now),
    limits: () => sampleLimits(),
  };
}
