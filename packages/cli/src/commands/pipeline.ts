// acc's Agents commands that take a task on from its build: analyze, analysis, review, land, autopilot
// and sync.

import { AccError, alive, type Analysis, analyze, answerAnalysis, autoMergeFor, autoMergeOn, AUTOPILOT_MIN_EVERY_S, autopilotDoes, autopilotMode, autopilotPass, type AutopilotResult, type AutopilotStepName, clearBranchMoves, closesIssues, closeWords, ghToken, holdAutopilot, land, mergesWords, moveUrl, moveWords, openQuestions, readAnalysis, review, run, settleCloses, sleep, sync } from '../../../core/src/index.ts';
import { stateLabel, tone } from '../format.ts';
import { accBinDir, accCommand, actorFrom, type CommandArea, followingCards, now, type Opts, out, personOnly, project, stepWords } from '../shared.ts';
import { personOnlyUpdate } from './updates.ts';

function cmdReview(o: Opts, id: string): number {
  const { paths, config } = project(process.cwd());
  const { by } = actorFrom(o);
  const say = (line: string) => { if (!o.json) process.stderr.write(line + '\n'); };
  const r = followingCards(paths, config, () => review(paths, config, id.toUpperCase(), {
    run, now, env: process.env,
    onStart: (session, sha, name) => say(tone(`Reviewing ${id.toUpperCase()} at ${sha.slice(0, 7)}. The reviewer reads and changes nothing. Session ${session}, named ${name}.`, 'dim')),
  }, { by: `reviewer:${id.toUpperCase()} for ${by}` }));
  const v = r.verdict;
  const where = (f: { file?: string; line?: number }) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ''}  ` : '');
  out(o, () => [
    v.verdict === 'pass' ? tone(`✓ Review passed: ${v.summary}`, 'blue') : tone(`↺ Changes asked for: ${v.summary}`, 'orange'),
    ...(v.criteria.length ? ['', 'Acceptance criteria', ...v.criteria.map((c) => `  ${c.met ? '✓' : '✗'} ${c.text}${c.evidence ? tone(`  ${c.evidence}`, 'dim') : ''}`)] : []),
    ...(v.findings.length ? ['', 'Findings', ...v.findings.map((f) => `  ${f.must ? '!' : '·'} ${where(f)}${f.message}`)] : []),
    '',
    r.moved === 'rework' ? `${id.toUpperCase()} → ${stateLabel('rework')}. Re-dispatch it, and the builder gets these findings.` : `${id.toUpperCase()} stays in review, ready to land.`,
  ].join('\n'), r);
  return v.verdict === 'pass' ? 0 : 1;
}

/** An analysis as a person reads it: the gist, the questions, then what it found and how to build it. */
function analysisLines(a: Analysis): string[] {
  const head = a.verdict === 'ready' ? tone(`✓ Ready to build: ${a.summary}`, 'blue')
    : a.verdict === 'split' ? tone(`! Too big for one task: ${a.summary}`, 'orange')
    : tone(`? ${openQuestions(a).length} question${openQuestions(a).length === 1 ? '' : 's'} for you: ${a.summary}`, 'orange');
  const list = (title: string, xs: string[]) => (xs.length ? ['', title, ...xs.map((x) => `  - ${x}`)] : []);
  return [
    head,
    ...(a.questions.length ? ['', 'Questions', ...a.questions.map((q) => `  ${q.id}. ${q.question}${q.answer ? tone(`  → ${q.answer.text}`, 'blue') : tone(`  (suggested: ${q.suggested})`, 'dim')}`)] : []),
    ...list('Acceptance criteria', a.requirements.criteria),
    ...list('What is there now', a.findings.map((f) => `${f.area}: ${f.detail}${f.source ? tone(`  ${f.source}`, 'dim') : ''}`)),
    ...list('Approach', a.approach.plan),
    ...list('Refactors first', a.approach.refactors.map((r) => `${r.what}: ${r.why}`)),
    ...list('Risks', a.approach.risks),
    ...list('Tests', a.approach.tests),
    ...(a.split.length ? list('Split into', a.split) : []),
    '',
    tone(`Size ${a.approach.size}. ${a.orgs.length ? `Read ${a.orgs.join(', ')}. ` : ''}Session ${a.sessionId}.`, 'dim'),
  ];
}

function cmdAnalyze(o: Opts, id: string): number {
  const by = personOnly(o, 'analyze a task');
  const { paths, config } = project(process.cwd());
  const say = (line: string) => { if (!o.json) process.stderr.write(line + '\n'); };
  const a = analyze(paths, config, id.toUpperCase(), {
    run, now, env: process.env, accCommand: accCommand(),
    onStart: (session, name) => say(tone(`Analyzing ${id.toUpperCase()}. The analyst reads the ticket${config.profile === 'salesforce' ? ', the code and the orgs' : ' and the code'}, and changes nothing. Session ${session}, named ${name}.`, 'dim')),
  }, { by: `analyst:${id.toUpperCase()} for ${by}` });
  out(o, () => analysisLines(a).join('\n'), a);
  return a.verdict === 'ready' ? 0 : 1;
}

function cmdShowAnalysis(o: Opts, id: string): number {
  const { paths } = project(process.cwd());
  const a = readAnalysis(paths, id.toUpperCase());
  if (!a) throw new AccError('no-analysis', `${id.toUpperCase()} hasn't been analyzed yet: acc analyze ${id.toUpperCase()}.`);
  out(o, () => analysisLines(a).join('\n'), a);
  return 0;
}

function cmdAnswerAnalysis(o: Opts, id: string, q: string, text: string): number {
  const by = personOnly(o, 'answer an analysis\'s questions');
  const { paths } = project(process.cwd());
  const a = answerAnalysis(paths, id.toUpperCase(), q, text, by, now);
  const open = openQuestions(a);
  out(o, () => (open.length ? `Answered. ${open.length} to go: ${open.map((x) => x.id).join(', ')}.` : tone(`Answered. ${a.task} is ready to build: acc dispatch ${a.task}.`, 'blue')), a);
  return 0;
}

function cmdLand(o: Opts, id: string): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  if (actor === 'builder') throw new AccError('refused', 'A builder never lands its own work. A person does, once it\'s reviewed.');
  const r = followingCards(paths, config, () => land(paths, config, id.toUpperCase(), { run, now, env: process.env }, { actor, by }));
  out(o, () => [
    `${r.task.id}: ${r.opened ? 'opened' : 'updated'} pull request #${r.pr.number}  ${r.pr.url}`,
    r.update ? `  Drafted an update for ${r.update.key} (${r.update.id}). Nothing is posted until a person posts it: acc updates.` : '',
    r.updateError ? tone(`! No update was drafted for ${r.task.id}'s ticket: ${r.updateError}`, 'orange') : '',
    r.pr.conflicts?.length ? tone(`! Pull request #${r.pr.number} conflicts with ${r.task.environment} in ${r.pr.conflicts.join(', ')}. GitHub can't merge it until that's resolved.`, 'orange') : '',
    tone(autoMergeFor(config, r.task.environment) ? mergesWords(true) : 'It merges only when a person merges it on GitHub.', 'dim'),
  ].filter(Boolean).join('\n'), r);
  return 0;
}

/** One autopilot pass, as a person reads it: what it did, what failed, what waits, and the updates it drafted. */
function autopilotLines(r: AutopilotResult): string[] {
  const lines: string[] = [];
  for (const s of r.steps) {
    if (s.outcome === 'done') lines.push(`${tone(`✓ ${s.task}  ${s.reason}`, 'blue')}${s.pr ? `  ${s.pr.url}` : ''}`);
    else if (s.outcome === 'failed') lines.push(tone(`! ${s.task}  Couldn't ${stepWords(s.step!, s.sha ?? '')}: ${s.reason}`, 'orange'), tone(s.step === 'start' ? `    It isn't tried again until a person dispatches it, or stops it waiting: acc dispatch ${s.task} --stop-waiting` : '    It isn\'t tried again on this commit. Do it by hand, or a new commit lets autopilot try again.', 'dim'));
    else if (s.outcome === 'waiting') lines.push(tone(`… ${s.task}  Waiting: ${s.reason}`, 'dim'));
  }
  // Autopilot posts nothing: each land's update waits for a person (D-066).
  for (const u of r.updates) lines.push(`  Drafted an update for ${u.key} (${u.id}): acc updates`);
  const idle = r.steps.filter((s) => s.outcome === 'skipped').length;
  if (!lines.length) lines.push('Nothing for autopilot to do.');
  else if (idle) lines.push(tone(`${idle} other task${idle === 1 ? '' : 's'}: nothing to do.`, 'dim'));
  return lines;
}

/**
 * Autopilot (D-055): under "autonomy": "review", it reviews, lands, re-dispatches a rework once, sends a
 * pull request whose GitHub checks fail back to its builder once a commit (D-076), resumes a stopped
 * builder once a run (D-067), merges the base into a pull request that conflicts with it (D-058), and
 * starts a task a person dispatched once the files it waits for are free (D-093), as the orchestrator, up
 * to an open pull request. It merges a pull request only where auto-merge is on (GH-67), in turn through
 * the repo's merge queue (GH-73). One pass, or one every --every seconds until stopped.
 */
function cmdAutopilot(o: Opts): number {
  const role = process.env.ACC_ROLE;
  if (role === 'builder' || role === 'reviewer' || role === 'analyst') throw new AccError('refused', `A ${role} can't run autopilot. A person starts it.`);
  if (o.once && o.every !== undefined) throw new AccError('usage', '--once is one pass and --every repeats them: give one or the other.');
  const every = o.every === undefined ? 0 : Number(o.every);
  if (o.every !== undefined && (!Number.isInteger(every) || every < AUTOPILOT_MIN_EVERY_S)) {
    throw new AccError('usage', `--every takes whole seconds, at least ${AUTOPILOT_MIN_EVERY_S}: the gap between one pass ending and the next starting.`);
  }
  const start = project(process.cwd());
  const { paths } = start;
  const mode = autopilotMode(start.config);
  for (const w of mode.warnings) process.stderr.write(`warning: ${w}\n`);
  if (mode.refusal) throw new AccError('refused', mode.refusal);
  if (!mode.on) {
    out(o, () => `autonomy is "manual" in .acc/config.json, so autopilot does nothing. Set it to "review" for autopilot to act: it then ${autopilotDoes(autoMergeOn(start.config))}`,
      { autonomy: mode.autonomy, warnings: mode.warnings, steps: [], updates: [] });
    return 0;
  }
  if (!start.config.github) throw new AccError('no-github', 'Autopilot lands reviewed work as pull requests on GitHub, and this project has no "github" section in .acc/config.json.');
  const say = (line: string) => { if (!o.json) process.stderr.write(tone(line, 'dim') + '\n'); };
  const doing: Record<AutopilotStepName, string> = { review: 'Reviewing', land: 'Landing', dispatch: 'Re-dispatching', refresh: 'Updating', resume: 'Resuming', checks: 'Sending back', merge: 'Merging', start: 'Starting', queue: 'Taking' };
  const after: Record<AutopilotStepName, string> = { review: '. The reviewer reads and changes nothing.', land: '', dispatch: '', refresh: ' from its base, then running its checks.', resume: ': its builder stopped before acc done or acc block.', checks: ' to its builder: its checks failed on GitHub. Reading their logs.', merge: ': its review and checks passed. GitHub is asked again first.', start: ': a person dispatched it, and it waited for another task\'s files.', queue: ' through the merge queue: its base is merged in if it moved on, the full check runs once, then it\'s pushed, or merged.' };
  // Started by the Command Center (D-064): once that window's extension host has gone, it stops at the
  // next step or within a second of waiting, even if nothing stopped it. No window, no autopilot.
  const parent = Number(process.env.ACC_AUTOPILOT_PARENT);
  const orphaned = () => Number.isInteger(parent) && parent > 0 && !alive(parent);
  const closed = 'The Command Center that started autopilot closed, so it stops.';
  /** Waits out the gap a second at a time, and says whether to carry on. */
  const wait = (seconds: number): boolean => {
    for (let left = seconds * 1000; left > 0 && !orphaned(); left -= 1000) sleep(Math.min(1000, left));
    return !orphaned();
  };
  return holdAutopilot(paths, () => {
    let config = start.config;
    for (;;) {
      if (orphaned()) {
        say(closed);
        return 0;
      }
      const r = followingCards(paths, config, () => autopilotPass(paths, config, {
        run, now, env: process.env, accBinDir: accBinDir(), accCommand: accCommand(), stop: orphaned,
        onStep: (task, step, sha) => say(`… ${doing[step]} ${task}${sha ? ` at ${sha.slice(0, 7)}` : ''}${after[step]}`),
      }));
      const data = { autonomy: mode.autonomy, warnings: mode.warnings, steps: r.steps, updates: r.updates };
      if (!every) {
        out(o, () => autopilotLines(r).join('\n'), data);
        return r.steps.some((s) => s.outcome === 'failed') ? 1 : 0;
      }
      // Repeating: a line of JSON a pass, or the pass under its time.
      if (o.json) process.stdout.write(JSON.stringify({ at: now().toISOString(), ...data }) + '\n');
      else process.stdout.write([tone(`Autopilot pass at ${now().toLocaleTimeString()}`, 'dim'), ...autopilotLines(r)].join('\n') + '\n');
      if (!wait(every)) {
        say(closed);
        return 0;
      }
      // A person can stop it from the config: it's read again before each pass.
      config = project(process.cwd()).config;
      if (!autopilotMode(config).on) {
        say(`autonomy is "${config.autonomy}" now, so autopilot stops.`);
        return 0;
      }
    }
  });
}

function cmdSync(o: Opts): number {
  const closeDone = o['close-done'] === true;
  const plan = o.plan === true;
  if (plan && !closeDone) throw new AccError('usage', '--plan goes with --close-done: acc sync --close-done --plan');
  // Closing the issues of tasks already done is a person's: never a builder's, reviewer's, analyst's or autopilot's (D-082).
  const by = closeDone ? personOnlyUpdate(o, 'close the issues of tasks already done') : null;
  const { paths, config } = project(process.cwd());
  // A person has seen an environment branch's unexplained move (GH-69): it's cleared, and nothing else runs.
  if (o['branches-seen'] === true) {
    personOnlyUpdate(o, 'clear a branch\'s move');
    const cleared = clearBranchMoves(paths);
    out(o, () => (cleared.length ? `Cleared the move${cleared.length === 1 ? '' : 's'} on ${cleared.join(', ')}. The next sync starts from where each branch stands now.` : 'No environment branch has a move waiting for a person.'), { cleared });
    return 0;
  }
  // --plan only looks, so it doesn't sync either: a sync writes the ledger, and may close an issue.
  const r = closeDone && plan ? { checked: 0, changes: [], cloud: [], branches: [] } : followingCards(paths, config, () => sync(paths, config, { run, now, env: process.env }));
  const lines = [
    ...(r.checked ? [`Checked ${r.checked} open pull request${r.checked === 1 ? '' : 's'}.`] : []),
    ...r.changes.map((c) => `  ${c.task}: ${c.note}${c.moved ? ` → ${stateLabel(c.moved.to)}` : ''}${c.update ? `. Drafted an update for ${c.update.key} (${c.update.id})` : ''}`),
    // Each cloud builder's branch (GH-69), and each environment branch that moved by anything but acc's merges.
    ...r.cloud.filter((c) => c.outcome !== 'unchanged').map((c) => tone(`  ${c.task} (cloud): ${c.note}`, c.outcome === 'collect-failed' || c.outcome === 'unreachable' ? 'orange' : 'blue')),
    // Every move still waiting for a person, each run, until acc sync --branches-seen (GH-69).
    ...r.branches.map((m) => tone(`! ${moveWords(m)}${config.github ? ` ${moveUrl(config.github.repo, m)}` : ''} Once you have: acc sync --branches-seen`, 'orange')),
  ];
  if (!by) {
    out(o, () => (lines.length ? lines.join('\n') : 'No open pull requests, cloud builders or branch moves to follow.'), r);
    return 0;
  }
  if (!closesIssues(config)) {
    out(o, () => [...lines, 'No GitHub tracker here says "edits": true, so acc closes no issues.'].join('\n'), { ...r, closeDone: [] });
    return 0;
  }
  const env = { ...process.env, GH_TOKEN: ghToken(run, config.github!.account) };
  const closes = settleCloses(paths, config, { run, now, env }, { tidy: true, plan, actor: 'human', by });
  out(o, () => [
    ...lines,
    !closes.length ? 'No done task\'s issue is waiting to close.' : plan ? 'The done tasks whose issues the tidy would close (nothing is changed). A sync may also close those of tasks merged since it last ran:' : 'The issues of tasks already done:',
    ...closes.map((c) => `  ${c.task} (pull request #${c.pr}): ${closeWords(c, plan)}`),
    plan && closes.some((c) => c.outcome === 'to close') ? tone('Close them with acc sync --close-done.', 'dim') : '',
  ].filter(Boolean).join('\n'), { ...r, closeDone: closes, ...(plan ? { plan: true } : {}) });
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Agents',
    order: 31,
    lines: `  acc analyze <id>                      Before the build: a read-only analyst works out the requirements, what's
                                        there now (the code, and on Salesforce the orgs), the approach, and questions
  acc analysis <id>                     What the task's analysis found
  acc analysis answer <id> <q> "<text>" Answer one of its questions; when the last is answered, it's ready to build
  acc review <id>                       A read-only reviewer agent judges the task's latest commit:
                                        pass, or changes (back to rework, with its findings)
  acc land <id>                         Push a reviewed task's branch and open its pull request; it never merges it
  acc autopilot [--once | --every <seconds>]
                                        With "autonomy": "review", take each task's next step on its own: review it,
                                        land it, re-dispatch a rework once, resume a stopped builder once, or merge
                                        the base into a pull request that conflicts with it. It merges a pull request
                                        only where auto-merge is on: reviewed, its checks passed, nothing waiting on
                                        a person, in turn through the repo's merge queue. One pass, or one every
                                        <seconds> (at least 30) until stopped; --json then prints a line a pass
  acc sync                              Follow open pull requests: merged → done, closed → blocked, failing checks or conflicts → needs you.
                                        Where the GitHub tracker says "edits": true, a task's issue closes when it
                                        merges to done, with a comment naming the pull request
  acc sync --branches-seen              Clear the notice of an environment branch that moved by anything but acc's
                                        own merges, once a person has looked
  acc sync --close-done [--plan]        A person's one-off tidy: close the issues of tasks done before acc closed
                                        them, under the same rule, listing each. --plan lists them, changing nothing`,
  },
  options: {
    once: { type: 'boolean', default: false },
    every: { type: 'string' },
    plan: { type: 'boolean', default: false },
    'close-done': { type: 'boolean', default: false },
    'branches-seen': { type: 'boolean', default: false },
  },
  subcommands: { analysis: ['answer'] },
  commands: {
    analyze: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc analyze <id>');
      return cmdAnalyze(o, rest[0]);
    },
    analysis: (o, rest) => {
      if (rest[0] === 'answer') {
        if (!rest[1] || !rest[2] || !rest[3]) throw new AccError('usage', 'acc analysis answer <id> <q> "<answer>"');
        return cmdAnswerAnalysis(o, rest[1], rest[2], rest.slice(3).join(' '));
      }
      if (!rest[0]) throw new AccError('usage', 'acc analysis <id>');
      return cmdShowAnalysis(o, rest[0]);
    },
    review: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc review <id>');
      return cmdReview(o, rest[0]);
    },
    land: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc land <id>');
      return cmdLand(o, rest[0]);
    },
    autopilot: (o) => cmdAutopilot(o),
    sync: (o) => cmdSync(o),
  },
};
