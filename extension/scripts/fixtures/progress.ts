/** In progress on the Overview (D-092): busy, and with nothing running anywhere. */
import type { HubLike } from '../../src/model/shared.ts';
import type { RunInput } from '../../src/model/runs.ts';
import type { RepoJobs } from '../../src/progress.ts';
import type { LastStep } from '../../src/transcript.ts';
import { sampleHub } from './hub.ts';
import { MIN } from './shared.ts';

/**
 * In progress when it's busy (D-092): five builders of five, ACME-13 resumed by autopilot with its validate
 * in slot 1, ACME-12 asking you with its validate first in line, a promotion from Dev to QA validating in
 * slot 2, autopilot landing ACME-20, ACME-24's analysis, which this window started, and ACME-47's review in
 * the cloud (T-86). With `before`, it's the look 20 seconds earlier, while autopilot was still reviewing
 * ACME-20: the two looks leave its done line.
 */
export function sampleBusyHub(now = Date.now(), before = false): HubLike {
  const hub = sampleHub(now);
  const root = hub.projects[0]!.root;
  const at = (min: number) => new Date(now - min * MIN).toISOString();
  const jobs: RepoJobs = {
    repo: `${root}/.git/acc/ledger.json`, max: 5,
    jobs: [
      before ? { key: 'autopilot-ACME-20-4321-1', kind: 'autopilot', task: 'ACME-20', step: 'review', by: 'orchestrator:autopilot', pid: 4321, startedAt: at(6) }
        : { key: 'autopilot-ACME-20-4321-2', kind: 'autopilot', task: 'ACME-20', step: 'land', by: 'orchestrator:autopilot', pid: 4321, startedAt: at(0.3) },
      { key: 'promote-qa-5150-1', kind: 'promote', from: 'dev', env: 'qa', by: 'human:jordan', pid: 5150, startedAt: at(4), carries: ['ACME-10', 'ACME-15'] },
    ],
    reviews: [],
    analyses: [{ task: 'ACME-24', sessionId: 'an-acme-24', startedAt: at(3), pid: 5200 }],
    resumes: [{ task: 'ACME-13', sessionId: 's-acme-13', startedAt: at(14), by: 'orchestrator:autopilot', pid: 5300 }],
  };
  const steps: Record<string, LastStep> = {
    's-acme-13': { step: { icon: 'terminal', title: 'Run the Apex tests for the duplicate-lead batch', at: at(1) }, model: 'claude-opus-5-5' },
    's-acme-12': { step: { icon: 'edit', title: 'Edited force-app/main/default/classes/EscalationService.cls', at: at(2) }, model: 'claude-opus-5-5' },
    's-acme-14': { step: { icon: 'terminal', title: 'Validate the routing against the Dev org', at: at(3) }, model: 'claude-sonnet-5-5' },
  };
  // The tasks In progress is about, and nothing else, so Needs you above it stays short enough to see it.
  const shown = new Set(['ACME-14', 'ACME-12', 'ACME-13', 'ACME-28', 'ACME-20', 'ACME-24', 'ACME-16', 'ACME-15', 'ACME-10', 'ACME-47']);
  const rows = hub.taskRows(root).filter((r) => shown.has(r.id));
  return {
    ...hub,
    taskRows: () => rows,
    updates: () => [],
    heavy: {
      dir: '/Users/me/.acc/heavy', slots: 2,
      held: [
        { slot: 1, pid: 6001, at: now - 6 * MIN, what: 'validate', task: 'ACME-13', project: 'Acme Service', cwd: `${root}/.claude/worktrees/ACME-13` },
        { slot: 2, pid: 5150, at: now - 3 * MIN, what: 'Validate dev → qa', env: 'qa', project: 'Acme Service' },
      ],
      waiting: [{ pid: 6002, at: now - 2 * MIN, place: 1, what: 'validate', task: 'ACME-12', project: 'Acme Service' }],
    },
    machine: { load: 9.1, cpus: 10 },
    jobsOf: () => jobs,
    stepOf: (id) => steps[id] ?? null,
  };
}

/** The analysis this window started for ACME-24, for In progress's Stop. */
export const sampleAnalyzeRun = (now = Date.now()): RunInput => ({
  id: 'r-analyze', label: 'Analyze ACME-24', command: 'acc analyze ACME-24', cwd: '/Users/me/code/acme-service', startedAt: now - 3 * MIN, endedAt: null, code: null, stopped: false, step: null, lines: ['Analyzing ACME-24 against Dev…'], prompt: null,
});

/** In progress with nothing running anywhere: no builder, no check, no job, and the machine calm. */
export function sampleIdleHub(now = Date.now()): HubLike {
  const hub = sampleHub(now);
  const root = hub.projects[0]!.root;
  const rows = hub.taskRows(root).filter((r) => r.state !== 'running').map((r) => ({ ...r, analyzing: null }));
  return {
    ...hub, taskRows: () => rows, agents: hub.agents.filter((a) => a.kind === 'interactive'), questions: [],
    heavy: { dir: '/Users/me/.acc/heavy', slots: 2, held: [], waiting: [] }, machine: { load: 1.2, cpus: 10 },
    jobsOf: () => ({ repo: `${root}/.git/acc/ledger.json`, max: 5, jobs: [], reviews: [], analyses: [], resumes: [] }),
  };
}
