/** Agents' questions (D-030): the ones waiting for a person, and the ones that have ended. */
import type { HistoryRecord, Question } from '../../../packages/core/src/questions.ts';
import { MIN } from './shared.ts';

/** A permission prompt and a question with options, as `acc hook permission` leaves them. */
export function sampleQuestions(now: number, wt: (id: string) => string): Question[] {
  const q = (id: string, sessionId: string, cwd: string, ago: number, tool: string, input: Record<string, unknown>, suggestions: unknown[] = []): Question =>
    ({ v: 1, id, pid: 1, at: now - ago * MIN, sessionId, cwd, transcript: null, tool, input, suggestions });
  return [
    q('m1-aaaa0001', 's-acme-14', wt('ACME-14'), 3, 'Bash', { command: 'sf apex run test --class-names CaseRoutingTest --target-org "Acme Dev" --wait 20', description: 'Run the routing tests in the Dev org' },
      [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'sf apex run test:*' }], behavior: 'allow', destination: 'localSettings' }]),
    q('m1-aaaa0002', 's-acme-12', wt('ACME-12'), 1, 'AskUserQuestion', { questions: [{
      question: 'Premium cases escalate after how long without a reply?', header: 'Escalation', multiSelect: false,
      options: [{ label: '2 hours', description: 'Matches the premium SLA in the contract.' }, { label: '4 hours', description: 'What the standard tier uses today.' }, { label: 'Business hours only', description: 'Pause the clock outside the support hours.' }],
    }] }),
  ];
}

/** Questions that have ended, one of each kind of outcome, as acc hook permission records them. */
export function sampleAnswers(now: number, wt: (id: string) => string): HistoryRecord[] {
  const h = (id: string, sessionId: string, task: string, ago: number, tool: string, input: Record<string, unknown>, outcome: HistoryRecord['outcome'], extra: Partial<HistoryRecord> = {}): HistoryRecord =>
    ({ v: 1, id, sessionId, cwd: wt(task), tool, input, askedAt: now - (ago + 1) * MIN, endedAt: now - ago * MIN, outcome, ...extra });
  return [
    h('h1', 's-acme-14', 'ACME-14', 24, 'Bash', { command: 'npm run lint -- --fix', description: 'Fix the lint warnings' }, 'allowed-for-session'),
    h('h2', 's-acme-14', 'ACME-14', 15, 'Bash', { command: 'sf data query --query "SELECT Id FROM Group WHERE Type = \'Queue\'" --target-org "Acme Dev"', description: 'List the queues' }, 'allowed'),
    h('h3', 's-acme-12', 'ACME-12', 9, 'AskUserQuestion', { questions: [{ question: 'Which queue gets premium cases?', options: [{ label: 'Tier 2' }, { label: 'Premium Support' }] }] }, 'answered', { answers: { 'Which queue gets premium cases?': 'Premium Support' } }),
    h('h4', 's-acme-12', 'ACME-12', 6, 'Bash', { command: 'git push origin HEAD', description: 'Push the branch' }, 'denied', { message: 'Builders never push; acc land does that.' }),
    h('h5', 's-acme-11', 'ACME-11', 35, 'Bash', { command: 'sf org list', description: 'List orgs' }, 'no-window'),
  ];
}
