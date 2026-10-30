// The wording check at the command line (T-151): acc plan approve refuses a plan whose requirements fail the Simplified
// Technical English check, and acc update ask refuses a question that fails it. A person's edit posts as they wrote it.
// acc runs from its source, in throwaway repos (support.ts). The plans are made up.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

/** A repo with ACME-7, a Jira ticket, and its plan with the requirements and question given. */
function planRepo(criteria: string[], question = 'Should Gold customers count as Premium?') {
  const dir = repoWithConfig(GENERIC_CONFIG);
  assert.equal(acc(dir, ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases' }])).code, 0);
  mkdirSync(join(dir, '.git', 'acc', 'analyses'), { recursive: true });
  writeFileSync(join(dir, '.git', 'acc', 'analyses', 'ACME-7.json'), JSON.stringify({
    v: 1, task: 'ACME-7', env: 'main', base: 'x', verdict: 'ready', summary: 'Escalate cases.', requirements: { goal: '', criteria, assumptions: [], outOfScope: [] },
    questions: [{ id: 'q1', question, why: '', suggested: 'No', askOf: 'author' }],
    findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [], orgs: [], sessionId: 's', at: '2026-10-29T10:00:00Z', durationMs: 0, costUsd: null,
  }));
  return dir;
}

const drafts = (dir: string): string[] => {
  const d = join(dir, '.git', 'acc', 'updates');
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')) : [];
};

test('acc plan approve refuses a plan whose requirements have a hard finding, with each finding and its fix, and approves it once they pass', () => {
  const dir = planRepo(['The rule runs; it logs.']);
  const r = acc(dir, ['plan', 'approve', 'ACME-7']);
  assert.equal(r.code, 1);
  assert.match(r.err, /ACME-7's requirements fail the Simplified Technical English check \(1 finding\), so the plan can't be approved\. Make a new plan with acc analyze ACME-7:\n- Criterion 1: STE bans the semicolon/);
  assert.equal(JSON.parse(readFileSync(join(dir, '.git', 'acc', 'analyses', 'ACME-7.json'), 'utf8')).approval, undefined, 'nothing approved');
  const clean = planRepo(['The rule runs, and it logs.']);
  assert.equal(acc(clean, ['plan', 'approve', 'ACME-7']).code, 0);
});

test('acc update ask drafts no question with a hard finding, and gives each finding; a person\'s edit posts as they wrote it', () => {
  const dir = planRepo(['The rule runs.'], 'Should we reach out to sales first?');
  const r = acc(dir, ['update', 'ask', 'ACME-7', 'q1']);
  assert.equal(r.code, 1);
  assert.match(r.err, /so acc wrote no draft\. Write each line again with its fix:\n- Question q1: /);
  assert.deepEqual(drafts(dir), [], 'no draft is written');
  // An edge case: a clean question is drafted, and the person's edit, which the check would refuse, posts as it is.
  const ok = planRepo(['The rule runs.']);
  assert.equal(acc(ok, ['update', 'ask', 'ACME-7', 'q1']).code, 0);
  assert.equal(acc(ok, ['update', 'posting', 'ACME-7.1']).code, 0);
  const text = join(ok, 'text.md');
  writeFileSync(text, 'We will reach out to sales; then we start.');
  const posted = acc(ok, ['update', 'posted', 'ACME-7.1', '--text-file', text, '--json']);
  assert.equal(posted.code, 0, posted.err);
  assert.equal(posted.json().posted.text, 'We will reach out to sales; then we start.');
});
