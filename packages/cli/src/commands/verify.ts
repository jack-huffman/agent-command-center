// acc verify (T-84): verify a developer's pull request for a tracked ticket. acc finds it, checks its head
// out with no branch, runs the project's checks there, has a read-only agent review it against the
// ticket's criteria, and drafts a QA comment for a person to edit and post. Nothing is posted or pushed.

import { AccError, clearVerification, latestVerification, prWords, pruneVerifications, readPrChoice, run, type Verification, verify } from '../../../core/src/index.ts';
import { gateLabel, tone } from '../format.ts';
import { type CommandArea, noAgent, now, type Opts, out, project, steps } from '../shared.ts';

/** A verification as a person reads it: the verdict, the pull request, each check, criterion and finding, and the QA comment. */
function verificationLines(v: Verification): string[] {
  return [
    `${v.task}: ${v.verdict === 'pass' ? tone('pass', 'blue') : tone('changes needed', 'orange')}. ${v.summary}`,
    `Pull request ${prWords(v.pr)}, at ${v.sha.slice(0, 7)}: ${v.pr.url}`,
    '',
    'Checks:',
    ...(v.checks.length ? v.checks.map((c) => `  ${gateLabel(c.status)}${c.gate}: ${c.summary}`) : ['  none ran']),
    '',
    'Acceptance criteria:',
    ...(v.criteria.length ? v.criteria.map((c) => `  ${c.met ? tone('✓ met    ', 'blue') : tone('✗ not met', 'orange')} ${c.text}${c.evidence ? tone(` (${c.evidence})`, 'dim') : ''}`) : ['  none listed']),
    '',
    'Findings:',
    ...(v.findings.length ? v.findings.map((f) => `  ${f.must ? tone('! must change', 'orange') : tone('- look at    ', 'dim')} ${f.message}${f.file ? tone(` (${f.file}${f.line ? `:${f.line}` : ''})`, 'dim') : ''}`) : ['  none']),
    '',
    ...(v.wording.length ? [tone(`! Wording: ${v.wording.length} finding${v.wording.length === 1 ? '' : 's'} in the QA comment`, 'orange'), ...v.wording.map((f) => `  - Line ${f.line}: ${f.message} [${f.match}]`), ''] : []),
    v.update
      ? tone(`The QA comment is drafted as ${v.update}. Edit it and post it: nothing is on ${v.key} or GitHub yet.`, 'dim')
      : tone(`${v.key} can't take an update, so no QA comment was drafted.`, 'dim'),
  ];
}

function cmdVerify(o: Opts, raw: string): number {
  const by = noAgent(o, 'verify a developer\'s pull request');
  const { paths, config } = project(process.cwd());
  // A task that left the board takes its verification with it.
  pruneVerifications(paths, config, run);
  const id = raw.toUpperCase();
  const pr = o.pr as string | undefined;
  if (pr !== undefined && !pr.trim()) throw new AccError('usage', '--pr takes a pull request\'s number or its GitHub link.');
  const say = (line: string) => { if (!o.json) process.stderr.write(line + '\n'); };
  const v = verify(paths, config, id, {
    run, now, env: process.env, steps: steps(),
    onStart: (session, name, p) => say(tone(`Verifying #${p.number} for ${id}. The verifier reads and changes nothing. Session ${session}, named ${name}.`, 'dim')),
  }, { by, ...(pr ? { pr } : {}) });
  out(o, () => verificationLines(v).join('\n'), v);
  steps().result(true, v.verdict === 'pass' ? `${id}'s pull request passes. The QA comment is drafted.` : `${id}'s pull request needs changes. The QA comment is drafted.`);
  return 0;
}

function cmdShow(o: Opts, raw: string): number {
  const { paths } = project(process.cwd());
  const id = raw.toUpperCase();
  const v = latestVerification(paths, id);
  if (v) {
    out(o, () => verificationLines(v).join('\n'), v);
    return 0;
  }
  // None yet, but acc found none or several: the choice is what there is to show.
  const choice = readPrChoice(paths, id);
  if (!choice) throw new AccError('no-verification', `${id} hasn't been verified yet: acc verify ${id}.`);
  out(o, () => [
    choice.found.length ? `${choice.found.length} open pull requests name ${id}. Name one: acc verify ${id} --pr <number>.` : `No open pull request names ${id}. Name it: acc verify ${id} --pr <number>.`,
    ...choice.found.map((p) => `  ${prWords(p)}: ${p.url}`),
  ].join('\n'), { choice });
  return 0;
}

function cmdClear(o: Opts, raw: string): number {
  noAgent(o, 'clear a verification');
  const { paths, config } = project(process.cwd());
  const id = raw.toUpperCase();
  const r = clearVerification(paths, config, id, run);
  out(o, () => (r.worktree || r.removed
    ? `Cleared ${id}'s verification: ${[r.worktree ? 'its worktree' : '', r.removed ? `${r.removed} stored result${r.removed === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}. Its QA comment's draft stays, to post or discard.`
    : `${id} has no verification to clear.`), r);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Ticket updates (acc drafts them; only a person posts)',
    order: 63,
    lines: `  acc verify <id> [--pr <n|url>]        Verify the developer's pull request for a tracked ticket: check out its head
                                        with no branch, run the checks, review it against the ticket's criteria
                                        with a read-only agent, and draft a QA comment. Nothing is posted or pushed.
                                        --pr names the pull request when acc finds none, or several
  acc verify show <id>                  The task's latest verification, or the pull requests to choose from
  acc verify clear <id>                 Remove the verification's worktree and what it kept`,
  },
  options: { pr: { type: 'string' } },
  subcommands: { verify: ['show', 'clear'] },
  commands: {
    verify: (o, rest) => {
      const usage = 'acc verify <id> [--pr <n|url>] | acc verify show <id> | acc verify clear <id>';
      if (rest[0] === 'show' || rest[0] === 'clear') {
        if (!rest[1]) throw new AccError('usage', usage);
        return rest[0] === 'show' ? cmdShow(o, rest[1]) : cmdClear(o, rest[1]);
      }
      if (!rest[0] || rest.length > 1) throw new AccError('usage', usage);
      return cmdVerify(o, rest[0]);
    },
  },
};
