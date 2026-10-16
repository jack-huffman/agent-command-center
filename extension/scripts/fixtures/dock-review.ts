/** Reviews in the output panel (T-63): one that passed, one that asked for changes, one still running, and one whose verdict file isn't JSON. */
import type { Verdict } from '../../../packages/core/src/review.ts';
import type { RunInput } from '../../src/model/runs.ts';
import { MIN, ROOT } from './shared.ts';

export type ReviewSample = 'passed' | 'changes' | 'reviewing' | 'unread';

/** The id of the review run the panel opens on. */
export const REVIEW_RUN = 'r-review';

const CLS = 'force-app/main/default/classes/WelcomeEmailService.cls';
const line = (n: number | null, mark: 'add' | 'del' | 'same', text: string, at = false) => ({ n, mark, text, at });

/** ACME-19's verdict: changes asked, one criterion not met, a must-fix finding and one worth a look. */
function changes(at: string): Verdict {
  return {
    v: 1, task: 'ACME-19', sha: '7c3e9a1', env: 'dev', verdict: 'changes', sessionId: 'rv-acme-19', name: 'Acme Service · ACME-19 · review', at, durationMs: 6 * MIN + 20_000, costUsd: null,
    summary: 'Marks each contact when its welcome email is sent, so a second run skips it. Contacts welcomed before this change have no mark, so they would get the email again.',
    client: 'New contacts get one welcome email, even when the flow runs twice in a day.',
    criteria: [
      { text: 'A contact gets the welcome email once, however often the flow runs.', met: true, evidence: `${CLS}:30` },
      { text: 'Contacts welcomed before the change don\'t get a second email.', met: false, evidence: 'Nothing reads Welcome_Sent__c any more, and no test covers a contact with only that set.' },
      { text: 'The service has a test for each path.', met: true, evidence: 'WelcomeEmailServiceTest: 6 tests.' },
      { text: 'The flow calls the service, not its own query.', met: true, evidence: 'force-app/main/default/flows/Welcome_Email.flow-meta.xml:88' },
    ],
    findings: [
      { message: 'Name the 24-hour window once, so the flow and the class agree on it.', must: false, file: CLS, line: 12, kind: 'magic number' },
      { message: 'Contacts welcomed before this change have no Welcome_Sent_At__c, so they get a second email. Treat Welcome_Sent__c as sent too, and test a contact with only that set.', must: true, file: CLS, line: 31, kind: 'untested edge case' },
    ],
  };
}

/** ACME-20's verdict: passed, every criterion met, and one finding worth a look. */
function passed(at: string): Verdict {
  return {
    v: 1, task: 'ACME-20', sha: 'e4f5a6b', env: 'dev', verdict: 'pass', sessionId: 'rv-acme-20', name: 'Acme Service · ACME-20 · review', at, durationMs: 4 * MIN + 5000, costUsd: null,
    summary: 'Adds the Renewal Date field to the Account layout, after Contract End, for the sales profiles only.',
    client: 'Sales can see each account\'s renewal date on its page.',
    criteria: [
      { text: 'The field shows on the Account layout.', met: true, evidence: 'force-app/main/default/layouts/Account-Account Layout.layout-meta.xml:41' },
      { text: 'Only the sales profiles can see it.', met: true, evidence: 'Field permissions on Sales User and Sales Manager.' },
      { text: 'The field sits after Contract End.', met: true, evidence: 'Account-Account Layout.layout-meta.xml:40' },
    ],
    findings: [{ message: 'The help text repeats the label; say what the date is for.', must: false, file: 'force-app/main/default/objects/Account/fields/Renewal_Date__c.field-meta.xml', line: 6, kind: 'help text' }],
  };
}

/** A review run in the output panel: still running, or ended with its verdict and the lines around its findings. */
export function sampleReviewRun(now: number, kind: ReviewSample): RunInput {
  const startedAt = now - (kind === 'reviewing' ? 2 * MIN + 14_000 : 8 * MIN);
  const task = kind === 'passed' ? 'ACME-20' : kind === 'changes' ? 'ACME-19' : 'ACME-12';
  const sha = kind === 'passed' ? 'e4f5a6b' : kind === 'changes' ? '7c3e9a1' : 'b2c3d4e';
  const base: RunInput = {
    id: REVIEW_RUN, label: `Review ${task}`, command: `acc review ${task}`, startedAt, endedAt: null, code: null, stopped: false, step: null, prompt: null, cwd: ROOT,
    lines: [`Reviewing ${task} at ${sha}. The reviewer reads and changes nothing. Session rv-${task.toLowerCase()}.`],
    review: { project: ROOT, task, sha },
  };
  if (kind === 'reviewing') return base;
  // Its verdict file was cut off mid-write: the panel shows its lines, and why.
  if (kind === 'unread') {
    return { ...base, endedAt: startedAt + 6 * MIN, code: 1, lines: [...base.lines, 'The review finished, but its verdict file was cut off.'], review: { ...base.review!, read: { ok: false, why: 'Its verdict file isn\'t JSON, so it can\'t be shown. Its output is below.' } } };
  }
  const at = new Date(startedAt + 6 * MIN).toISOString();
  const verdict = kind === 'passed' ? passed(at) : changes(at);
  const excerpts = kind === 'passed'
    ? [{ kind: 'diff' as const, lines: [line(5, 'same', '    <label>Renewal Date</label>'), line(6, 'add', '    <inlineHelpText>Renewal Date</inlineHelpText>', true), line(7, 'same', '    <type>Date</type>')] }]
    : [
      { kind: 'unchanged' as const, lines: [line(11, 'same', '    List<Contact> queue = new List<Contact>();'), line(12, 'same', '    Integer hours = 24;', true), line(13, 'same', '    Datetime since = System.now().addHours(-hours);')] },
      { kind: 'diff' as const, lines: [
        line(29, 'same', '    for (Contact c : contacts) {'),
        line(null, 'del', '      if (c.Welcome_Sent__c) continue;'),
        line(30, 'add', '      if (c.Welcome_Sent_At__c >= since) continue;'),
        line(31, 'add', '      c.Welcome_Sent_At__c = System.now();', true),
        line(32, 'same', '      queue.add(c);'),
      ] },
    ];
  const out = verdict.verdict === 'pass' ? `✓ Review passed: ${verdict.summary}` : `↺ Changes asked for: ${verdict.summary}`;
  return {
    ...base, endedAt: startedAt + 6 * MIN, code: verdict.verdict === 'pass' ? 0 : 1, ok: true, lines: [...base.lines, out, '', `${task} ${verdict.verdict === 'pass' ? 'stays in review, ready to land.' : '→ Rework. Re-dispatch it, and the builder gets these findings.'}`],
    review: { ...base.review!, read: { ok: true, verdict, checkout: true, excerpts } },
  };
}
