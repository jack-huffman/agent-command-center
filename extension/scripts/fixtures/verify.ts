/**
 * ACME-21's verification (T-84): a developer, not acc, built its pull request, and a TA verifies it. One
 * that passes, one that needs changes, and the choice when two open pull requests name the ticket. The
 * QA comment waits in its Activity as an update draft.
 */
import type { Update } from '../../../packages/core/src/updates.ts';
import { type PrChoice, qaComment, type Verification, type VerifyPr } from '../../../packages/core/src/verify.ts';
import { MIN } from './shared.ts';

export type VerifySample = 'pass' | 'changes' | 'choice';

const SHA = '4c1e9a07d2b8f3e6a5c4b3a2918f7e6d5c4b3a29';

const PR: VerifyPr = {
  number: 142, url: 'https://github.com/acme/acme-service/pull/142', title: 'ACME-21 Add contact roles when a lead converts',
  head: 'feature/ACME-21-contact-roles', base: 'dev', sha: SHA,
};

const AGAIN: VerifyPr = { ...PR, number: 147, url: 'https://github.com/acme/acme-service/pull/147', title: 'ACME-21 Contact roles, second try', head: 'pat/acme-21-roles-v2', sha: 'b7d2e4f6a8c0e2f4a6b8d0f2e4a6c8e0f2a4b6c8' };

const CRITERIA = [
  { text: 'A converted lead\'s opportunity gets a contact role for the lead\'s contact.', met: true, evidence: 'LeadConvertService.cls:48 adds the role after the convert.' },
  { text: 'The role is Decision Maker when the lead\'s title holds "Director" or "VP".', met: true, evidence: 'ContactRoles.cls:21 reads the title.' },
];

export function sampleVerification(now: number, which: 'pass' | 'changes'): Verification {
  const pass = which === 'pass';
  const v = {
    pr: PR, sha: SHA, verdict: which,
    summary: pass
      ? 'Pass. The change gives each converted opportunity a contact role, and the tests cover both titles.'
      : 'The change needs work. A lead with no contact stops the convert with an error. Skip the role when the lead has no contact.',
    checks: pass
      ? [{ gate: 'format', status: 'pass' as const, summary: '3 changed files formatted.' }, { gate: 'static', status: 'pass' as const, summary: 'No violations at severity 2 or worse.' }, { gate: 'validate', status: 'pass' as const, summary: 'Validated in Acme Dev: LeadConvertServiceTest, 9 of 9 passing.' }]
      : [{ gate: 'format', status: 'pass' as const, summary: '3 changed files formatted.' }, { gate: 'static', status: 'fail' as const, summary: '1 violation at severity 2 or worse: ApexCRUDViolation in ContactRoles.cls.' }, { gate: 'validate', status: 'skip' as const, summary: 'It couldn\'t run here: dev has no org alias.' }],
    criteria: pass ? CRITERIA : [CRITERIA[0]!, { text: 'A lead with no contact converts with no error.', met: false, evidence: 'LeadConvertService.cls:52 reads the contact with no check for null.' }],
    findings: pass
      ? [{ message: 'Name the test method for the title it tests.', must: false, file: 'force-app/main/default/classes/LeadConvertServiceTest.cls', line: 30 }]
      : [
        { message: 'Skip the contact role when the lead has no contact. Today the convert stops with an error.', must: true, file: 'force-app/main/default/classes/LeadConvertService.cls', line: 52 },
        { message: 'Check the user can create the role before the insert.', must: true, file: 'force-app/main/default/classes/ContactRoles.cls', line: 34 },
      ],
  };
  return {
    v: 1, task: 'ACME-21', key: 'ACME-21', ...v, client: 'Converted opportunities get their contact roles.', update: 'ACME-21.2', comment: qaComment(v), wording: [],
    sessionId: 'vf-acme-21', name: 'Acme Service · ACME-21 · verify', at: new Date(now - 9 * MIN).toISOString(), durationMs: 412_000, costUsd: null,
  };
}

/** The QA comment as acc drafted it, waiting in the Activity for a person to edit and post. */
export function sampleQaUpdate(now: number, v: Verification): Update {
  return {
    v: 1, id: 'ACME-21.2', task: 'ACME-21', tracker: 'jira', key: 'ACME-21', url: 'https://acme.atlassian.net/browse/ACME-21', event: 'verify', state: 'draft',
    pr: { number: v.pr.number, url: v.pr.url }, text: v.comment, createdAt: v.at, by: 'human:jordan',
  };
}

/** Two open pull requests name ACME-21, so the person chooses which to verify. */
export const sampleChoice = (now: number): PrChoice => ({ v: 1, task: 'ACME-21', at: new Date(now - 3 * MIN).toISOString(), found: [PR, AGAIN] });
