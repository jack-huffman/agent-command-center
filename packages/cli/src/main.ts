import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ACTORS, AccError, type Actor, type ApexTest, configureRepoAccess, DISPLAY, type DisplayState, displayState, drift, gatesFor, gateTarget, isReady, loadConfig, makeContext, moveTask, mutate,
  cleanup, dispatch, githubIdentity, intakeGithub, planInit, useGithubAccount, withCloneAccount, type Profile, readLedger, receiptsAt, STEPS, receiptHooks, repoPaths, run, runGates, runSteps, satisfies, type State, type StepResult, type TaskInput, type UpsertResult,
  upsertTasks, writeConfig, ask, hookOutput, parseHookInput, waiveGates, review, land, sync, planPromotion, promote, skipWarning, planDeploy, deploy, lastDeploy,
  buildBaseline, seedBranches, draftLists, writeReadme, parseEventInput, preToolUseHook, sessionStartHook, stopHook, AGENT_ROLES, type AgentRole, profileView, setProfile, withCloneAgents, type ProfileChange,
  analyze, type Analysis, answerAnalysis, openQuestions, readAnalysis,
  AUTOPILOT_MIN_EVERY_S, type AutopilotResult, type AutopilotStepName, autopilotFailure, autopilotMode, autopilotPass, holdAutopilot, sleep, alive, setAutonomy,
} from '../../core/src/index.ts';
import { checkLabel, gateLabel, stateLabel, table, tone } from './format.ts';

const VERSION = '0.1.0';
const now = () => new Date();

const HELP = `acc ${VERSION}: Agent Command Center

Setup
  acc doctor [--part machine|project] [--step <id>]...
                                        Check the onboarding steps and print the fixes
  acc onboard                           The same checks as a guided list, with the next step to do
  acc setup baseline                    B5: one manifest of every component on every environment branch
  acc setup branches [--push]           B6: make each missing environment branch, seeded from its org
  acc setup lists                       B9: draft the environment-specific and known-drift lists
  acc setup readme                      B10: write the README's environments table
  acc init --profile salesforce --production-org <alias> [--project <name>] [--github-repo <o/r>]
           [--github-account <a>] [--commit-name <n> --commit-email <e>] [--configure-git]
           [--jira-site <site> --jira-project <key>] [--dry-run] [--force]
  acc init --profile generic [...]

Tasks
  acc add "<title>" [--brief <text>] [--dep <id>]... [--env <branch>] [--key <T-n>]
  acc import [--file <tasks.json>]      Add or refresh tasks from JSON (stdin by default)
  acc intake github [--label <l>]       Add or refresh tasks from the repo's open GitHub issues. A task not
                                        started yet leaves the board when its issue closes or has a skipLabels label
  acc status                            One line: how many tasks are in each state
  acc list [--state <state>]
  acc ready
  acc show <id>
  acc set <id> <state> [--reason <text>] [--force] [--as <actor>] [--by <name>]

Agents
  acc dispatch <id> [--foreground] [--without-analysis]
                                        Worktree, setup, instructions, and a background builder session
  acc done [<id>]                       A builder's finish line: moves its task to review
  acc block [<id>] "<reason>"           A builder's way out when stuck
  acc cleanup <id>                      Remove a finished task's worktree, only if nothing would be lost
  acc agents                            The model and effort builders and reviewers run with, and where each is set
  acc agents set <builder|reviewer> [--model <m>] [--effort <low|medium|high|xhigh|max>] [--fallback-model <m>]
                [--clear <model|effort|fallback-model>]... [--project]
                                        Change them for this clone, or with --project in .acc/config.json
  acc agents autonomy [manual|review]   What autopilot may do on its own, or change it in .acc/config.json
  acc analyze <id>                      Before the build: a read-only analyst works out the requirements, what's
                                        there now (the code, and on Salesforce the orgs), the approach, and questions
  acc analysis <id>                     What the task's analysis found
  acc analysis answer <id> <q> "<text>" Answer one of its questions; when the last is answered, it's ready to build
  acc review <id>                       A read-only reviewer agent judges the task's latest commit:
                                        pass, or changes (back to rework, with its findings)
  acc land <id>                         Push a reviewed task's branch and open its pull request; never merges
  acc autopilot [--once | --every <seconds>]
                                        With "autonomy": "review", take each task's next step on its own: review it,
                                        land it, re-dispatch a rework once, or merge the base into a pull request
                                        that conflicts with it. Never merges a pull request. One pass, or one every
                                        <seconds> (at least 30) until stopped; --json then prints a line a pass
  acc sync                              Follow open pull requests: merged → done, closed → blocked, failing checks or conflicts → needs you

Environments
  acc promote <env> [--to <env>] [--plan] [--allow-deletions] [--skip-validate]
                                        A pull request taking <env>'s merged changes to the next environment
  acc deploy <env> [--plan] [--since <commit>] [--confirm-production] [--no-tests]
                                        Deploy what changed on <env>'s branch since its last deploy to its org
  acc hook permission                   Claude Code's PermissionRequest hook: puts an agent's prompt in the
                                        Command Center, when one is open, and waits for the answer

GitHub
  acc github status                     Which account this repo works as, and whether gh and git push agree
  acc github use <account> | --default  Work as another logged-in account in this clone only; nothing committed changes

Checks
  acc gate run [<gate>...] [--test <ApexTest>=<why>]... [--env <name>] [--task <id>]
                                        Run the required checks (or the ones named) on this commit
  acc gate list [--env <name>] [--task <id>]
                                        The project's checks, and their results on this commit
  acc gate waive <gate>... --reason "<why>" [--task <id>]
                                        A person sets checks aside on this commit (or the task's), with a reason
  acc drift <environment> [--manifest <path>] [--keep]
                                        What changed in an org since its branch; prints nothing if none

Every command takes --json. Docs: docs/ONBOARDING.md, docs/DESIGN.md.`;

interface Opts {
  json: boolean;
  [k: string]: unknown;
}

function out(o: Opts, human: () => string, data: unknown): void {
  if (o.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else process.stdout.write(human() + '\n');
}

function project(cwd: string) {
  const paths = repoPaths(cwd, run);
  const { config: loaded, warnings } = loadConfig(paths.config);
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  // This clone's own choice of GitHub account, when it made one (D-028).
  // This clone's own choices of agent model and effort (D-036).
  return { paths, config: withCloneAgents(withCloneAccount(loaded, paths.root, run), paths.root, run) };
}

/** Builders are identified by ACC_ROLE, set when they're dispatched. Everyone else is a person. */
function actorFrom(o: Opts): { actor: Actor; by: string } {
  const role = (o.as as string | undefined) || process.env.ACC_ROLE || 'human';
  if (!(ACTORS as readonly string[]).includes(role)) throw new AccError('usage', `--as must be one of ${ACTORS.join(', ')}.`);
  const by = (o.by as string | undefined) ?? (role === 'builder' && process.env.ACC_TASK ? `builder:${process.env.ACC_TASK}` : `${role}:${process.env.USER ?? 'unknown'}`);
  return { actor: role as Actor, by };
}

// ---------------------------------------------------------------- setup

function renderSteps(results: StepResult[], guided: boolean): string {
  const lines: string[] = [];
  let part = '';
  for (const { step, result } of results) {
    if (step.part !== part) {
      part = step.part;
      lines.push('', part === 'machine' ? 'This machine' : 'This project');
    }
    lines.push(`  ${checkLabel(result.status)}  ${step.id.padEnd(18)} ${step.title}`);
    if (result.status !== 'pass' && result.status !== 'skip') lines.push(`      ${result.detail}`);
    else if (!guided) lines.push(tone(`      ${result.detail}`, 'dim'));
    if (result.status === 'fail' || result.status === 'unknown') {
      const fix = result.fix ?? step.fix?.command ?? step.fix?.text;
      if (fix) lines.push(`      fix: ${fix}`);
      if (result.open) lines.push(`      open: ${result.open}`);
      if (step.fix?.docs) lines.push(`      docs: ${step.fix.docs}`);
    }
  }
  const failing = results.filter((r) => r.result.status === 'fail');
  const byHand = results.filter((r) => r.result.status === 'unknown');
  const passed = results.filter((r) => r.result.status === 'pass').length;
  lines.push('', `${passed} passed, ${failing.length} failing, ${byHand.length} to check by hand.`);
  if (guided && failing[0]) {
    const { step, result } = failing[0];
    lines.push('', tone(`Next: ${step.id}, ${step.title}`, 'orange'), `  Why: ${step.why}`, `  Do:  ${result.fix ?? step.fix?.command ?? step.fix?.text ?? `see ${step.fix?.docs ?? 'docs/ONBOARDING.md'}`}`);
  }
  return lines.join('\n').replace(/^\n/, '');
}

function cmdDoctor(o: Opts, guided: boolean): number {
  const ctx = makeContext(process.cwd(), run);
  const part = o.part as 'machine' | 'project' | undefined;
  if (part && part !== 'machine' && part !== 'project') throw new AccError('usage', '--part must be machine or project.');
  const only = (o.step as string[] | undefined) ?? [];
  const unknownIds = only.filter((id) => !STEPS.some((s) => s.id === id));
  if (unknownIds.length) throw new AccError('usage', `No step ${unknownIds.join(', ')}. Run acc doctor to see them all.`);
  const results = runSteps(ctx, part, only);
  out(o, () => renderSteps(results, guided), results.map(({ step, result }) => ({
    id: step.id, part: step.part, group: step.group, title: step.title, why: step.why, planned: step.planned ?? null,
    status: result.status, detail: result.detail, fix: result.fix ?? null, howTo: step.fix ?? null, open: result.open ?? null,
  })));
  return results.some((r) => r.result.status === 'fail') ? 1 : 0;
}

function cmdInit(o: Opts): number {
  const paths = repoPaths(process.cwd(), run);
  const profile = (o.profile as Profile | undefined) ?? 'generic';
  if (profile !== 'generic' && profile !== 'salesforce') throw new AccError('usage', '--profile must be generic or salesforce.');
  if (existsSync(paths.config) && !o.force && !o['dry-run']) throw new AccError('exists', `${paths.config} already exists. Use --force to replace it.`);
  const plan = planInit(run, {
    root: paths.root,
    profile,
    project: o.project as string | undefined,
    productionOrg: o['production-org'] as string | undefined,
    githubRepo: o['github-repo'] as string | undefined,
    githubAccount: o['github-account'] as string | undefined,
    commitName: o['commit-name'] as string | undefined,
    commitEmail: o['commit-email'] as string | undefined,
    jiraSite: o['jira-site'] as string | undefined,
    jiraProject: o['jira-project'] as string | undefined,
  });
  if (!o['dry-run']) {
    writeConfig(paths.config, plan.config);
    if (o['configure-git'] && plan.config.github) configureRepoAccess(run, paths.root, plan.config.github.account, plan.config.commitIdentity);
  }
  out(o, () => {
    const c = plan.config;
    const rows = [['Environment', 'Branch', 'Type', 'Org alias', 'Promotes to'], ...c.environments.map((e) => [
      e.name + (e.default ? ' (default)' : '') + (e.protected ? ' (protected)' : ''), e.branch, e.type, e.org ?? '(not logged in)', e.promotesTo.join(', ') || '–',
    ])];
    return [
      `${o['dry-run'] ? 'Would write' : 'Wrote'} ${paths.config}`,
      '',
      table(rows),
      '',
      `GitHub: ${c.github ? `${c.github.repo} as ${c.github.account}` : '(none)'}   Commits: ${c.commitIdentity ? `${c.commitIdentity.name} <${c.commitIdentity.email}>` : '(not set)'}`,
      ...plan.notes.map((n) => `note: ${n}`),
      '',
      'Next: acc doctor',
    ].join('\n');
  }, { written: !o['dry-run'], path: paths.config, config: plan.config, notes: plan.notes });
  return 0;
}

// ---------------------------------------------------------------- tasks

function readInput(file: string | undefined): unknown {
  const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AccError('usage', `The input isn't valid JSON: ${(e as Error).message}`);
  }
}

const upsertLines = (res: UpsertResult): string[] => [
  res.added.length ? `Added ${res.added.join(', ')}` : '',
  res.updated.length ? `Updated ${res.updated.join(', ')}` : '',
  res.unchanged.length ? `Unchanged ${res.unchanged.join(', ')}` : '',
  ...res.errors.map((e) => tone(`✗ ${e}`, 'orange')),
];

function upsert(o: Opts, inputs: TaskInput[]): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const res = mutate(paths, now, (ledger, emit) => upsertTasks(ledger, config, inputs, actor, by, emit, now));
  out(o, () => upsertLines(res).filter(Boolean).join('\n') || 'Nothing to do.', res);
  return res.errors.length ? 1 : 0;
}

/** Reads open issues as the repo's own GitHub account (D-007), upserts them, and follows closed and skipped ones (D-048). Never changes GitHub. */
function cmdIntakeGithub(o: Opts): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const res = intakeGithub(paths, config, { run, now, env: process.env }, { label: o.label as string | undefined, actor, by });
  out(o, () => [
    ...upsertLines(res),
    res.closed.length ? `Done ${res.closed.join(', ')}: closed on GitHub before work started` : '',
    res.removed.length ? `Removed ${res.removed.join(', ')}: their issues have a label in skipLabels` : '',
    ...res.leftAlone.map((l) => tone(`! ${l.note}`, 'orange')),
  ].filter(Boolean).join('\n') || 'Nothing to do.', res);
  return res.errors.length ? 1 : 0;
}

/** The task a command is about: the argument, or the builder session's own task. */
function taskIdFrom(arg: string | undefined): string {
  const id = arg ?? process.env.ACC_TASK;
  if (!id) throw new AccError('usage', 'Name the task, for example: acc done GH-12. Builders get it from ACC_TASK.');
  return id;
}

/** acc's own folder, so builders can run it with no install (D-012). */
const accBinDir = (): string => {
  try {
    return dirname(realpathSync(process.argv[1]!));
  } catch {
    return dirname(process.argv[1] ?? '.');
  }
};

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** How a shell runs this same acc: by this runtime, so it works where node isn't on PATH (VSCode's own). */
const accCommand = (): string => {
  let script = process.argv[1] ?? '';
  try {
    script = realpathSync(script);
  } catch {
    // keep the path as given
  }
  return `${process.versions.electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}${shellQuote(process.execPath)} ${shellQuote(script)}`;
};

async function readStdin(limit = 4 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += (c as Buffer).length;
    if (size > limit) break;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The PermissionRequest hook (D-030). It never blocks a tool by failing: on anything unexpected it prints
 * nothing and exits 0, so Claude Code asks in its own prompt as usual.
 */
/**
 * The plugin's hooks (D-042). Like the permission hook, they never block by failing: anything unexpected
 * prints nothing, and Claude Code carries on as it would without acc.
 */
async function cmdHookEvent(event: 'session-start' | 'pre-tool-use' | 'stop'): Promise<number> {
  try {
    const input = parseEventInput(await readStdin());
    if (!input) return 0;
    const ctx = { cwd: input.cwd || process.cwd(), env: process.env, run, now };
    const out = event === 'session-start' ? sessionStartHook(input, ctx) : event === 'pre-tool-use' ? preToolUseHook(input, ctx) : stopHook(input, ctx);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (e) {
    process.stderr.write(`acc hook ${event}: ${(e as Error).message}\n`);
  }
  return 0;
}

async function cmdHookPermission(): Promise<number> {
  const stop = new AbortController();
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => stop.abort());
  try {
    const input = parseHookInput(await readStdin());
    if (!input) return 0;
    const r = await ask(input, { signal: stop.signal });
    const output = r ? hookOutput(r.question, r.answer) : null;
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (e) {
    process.stderr.write(`acc hook permission: ${(e as Error).message}\n`);
  }
  return 0;
}

function cmdReview(o: Opts, id: string): number {
  const { paths, config } = project(process.cwd());
  const { by } = actorFrom(o);
  const say = (line: string) => { if (!o.json) process.stderr.write(line + '\n'); };
  const r = review(paths, config, id.toUpperCase(), {
    run, now, env: process.env,
    onStart: (session, sha) => say(tone(`Reviewing ${id.toUpperCase()} at ${sha.slice(0, 7)}. The reviewer reads and changes nothing. Session ${session}.`, 'dim')),
  }, { by: `reviewer:${id.toUpperCase()} for ${by}` });
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
    onStart: (session) => say(tone(`Analyzing ${id.toUpperCase()}. The analyst reads the ticket${config.profile === 'salesforce' ? ', the code and the orgs' : ' and the code'}, and changes nothing. Session ${session}.`, 'dim')),
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
  const r = land(paths, config, id.toUpperCase(), { run, now, env: process.env }, { actor, by });
  out(o, () => [
    `${r.task.id}: ${r.opened ? 'opened' : 'updated'} pull request #${r.pr.number}  ${r.pr.url}`,
    r.commented ? `  Commented on the GitHub issue.` : '',
    r.commentUnconfirmed ? tone(`! The comment on ${r.task.id}'s issue isn't confirmed: ${r.commentUnconfirmed.replace(/([^.!?])$/, '$1.')} Look at the issue before you post it again.`, 'orange') : '',
    r.comment ? `  Post this on ${r.comment.key} (the extension does it for you):\n    ${r.comment.text.replace(/\n/g, '\n    ')}` : '',
    r.pr.conflicts?.length ? tone(`! Pull request #${r.pr.number} conflicts with ${r.task.environment} in ${r.pr.conflicts.join(', ')}. GitHub can't merge it until that's resolved.`, 'orange') : '',
    tone('It merges only when a person merges it on GitHub.', 'dim'),
  ].filter(Boolean).join('\n'), r);
  return 0;
}

const STEP_WORD: Record<AutopilotStepName, string> = { review: 'review', land: 'land', dispatch: 're-dispatch', refresh: 'update' };

/** A step autopilot couldn't take, in words: "land abc1234", "update abc1234 from its base". */
const stepWords = (step: AutopilotStepName, sha: string): string => {
  const what = [STEP_WORD[step], sha.slice(0, 7)].filter(Boolean).join(' ');
  return step === 'refresh' ? `${what} from its base` : what;
};

/** One autopilot pass, as a person reads it: what it did, what failed, what waits, and comments to post. */
function autopilotLines(r: AutopilotResult): string[] {
  const lines: string[] = [];
  for (const s of r.steps) {
    if (s.outcome === 'done') lines.push(`${tone(`✓ ${s.task}  ${s.reason}`, 'blue')}${s.pr ? `  ${s.pr.url}` : ''}`);
    else if (s.outcome === 'failed') lines.push(tone(`! ${s.task}  Couldn't ${stepWords(s.step!, s.sha ?? '')}: ${s.reason}`, 'orange'), tone('    It isn\'t tried again on this commit. Do it by hand, or a new commit lets autopilot try again.', 'dim'));
    else if (s.outcome === 'waiting') lines.push(tone(`… ${s.task}  Waiting: ${s.reason}`, 'dim'));
    if (s.commentUnconfirmed) lines.push(tone(`! The comment on ${s.task}'s issue isn't confirmed: ${s.commentUnconfirmed.replace(/([^.!?])$/, '$1.')} Look at the issue before you post it again.`, 'orange'));
  }
  for (const c of r.pendingComments) lines.push(tone(`! Post this on ${c.key}`, 'orange') + ` for ${c.task}. Autopilot can't post on ${c.kind === 'jira' ? 'Jira' : 'Azure DevOps'} as you:`, `    ${c.text.replace(/\n/g, '\n    ')}`);
  const idle = r.steps.filter((s) => s.outcome === 'skipped').length;
  if (!lines.length) lines.push('Nothing for autopilot to do.');
  else if (idle) lines.push(tone(`${idle} other task${idle === 1 ? '' : 's'}: nothing to do.`, 'dim'));
  return lines;
}

/**
 * Autopilot (D-055): under "autonomy": "review", it reviews, lands and re-dispatches a rework once, as
 * the orchestrator, up to an open pull request. One pass, or one every --every seconds until stopped.
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
    out(o, () => 'autonomy is "manual" in .acc/config.json, so autopilot does nothing. Set it to "review" for autopilot to review, land, and re-dispatch a rework once.',
      { autonomy: mode.autonomy, warnings: mode.warnings, steps: [], pendingComments: [] });
    return 0;
  }
  if (!start.config.github) throw new AccError('no-github', 'Autopilot lands reviewed work as pull requests on GitHub, and this project has no "github" section in .acc/config.json.');
  const say = (line: string) => { if (!o.json) process.stderr.write(tone(line, 'dim') + '\n'); };
  const doing = { review: 'Reviewing', land: 'Landing', dispatch: 'Re-dispatching', refresh: 'Updating' };
  const after = { review: '. The reviewer reads and changes nothing.', land: '', dispatch: '', refresh: ' from its base, then running its checks.' };
  // Started by the Command Center (GH-35): once that window's extension host has gone, it stops at the
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
      const r = autopilotPass(paths, config, {
        run, now, env: process.env, accBinDir: accBinDir(), accCommand: accCommand(), stop: orphaned,
        onStep: (task, step, sha) => say(`… ${doing[step]} ${task}${sha ? ` at ${sha.slice(0, 7)}` : ''}${after[step]}`),
      });
      const data = { autonomy: mode.autonomy, warnings: mode.warnings, steps: r.steps, pendingComments: r.pendingComments };
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
  const { paths, config } = project(process.cwd());
  const r = sync(paths, config, { run, now, env: process.env });
  out(o, () => (r.checked
    ? [`Checked ${r.checked} open pull request${r.checked === 1 ? '' : 's'}.`, ...r.changes.map((c) => `  ${c.task}: ${c.note}${c.moved ? ` → ${stateLabel(c.moved.to)}` : ''}`)].join('\n')
    : 'No open pull requests to follow.'), r);
  return 0;
}

/** Builders' and reviewers' model and effort (D-036). */
function cmdAgents(o: Opts, sub: string | undefined, roleArg: string | undefined): number {
  const { paths } = project(process.cwd());
  // Shown from the project's own config, so where each value comes from is clear.
  const { config: projectConfig } = loadConfig(paths.config);
  const views = () => Object.fromEntries(AGENT_ROLES.map((r) => [r, profileView(projectConfig, run, paths.root, r)]));
  if (sub === 'autonomy') return cmdAutonomy(o, paths.config, roleArg);
  if (!sub || sub === 'show') {
    const v = views();
    const from = { clone: ' (this clone)', project: ' (project)', default: '' };
    out(o, () => AGENT_ROLES.map((r) => {
      const p = v[r]!;
      return `${r.padEnd(9)} model ${p.model ?? 'Claude Code\'s default'}${from[p.from.model]}, effort ${p.effort ?? 'default'}${from[p.from.effort]}${p.fallbackModel ? `, falls back to ${p.fallbackModel}${from[p.from.fallbackModel]}` : ''}`;
    }).join('\n'), v);
    return 0;
  }
  if (sub !== 'set' || !roleArg || !(AGENT_ROLES as readonly string[]).includes(roleArg)) throw new AccError('usage', 'acc agents set <builder|reviewer> [--model <m>] [--effort <e>] [--fallback-model <m>] [--clear <field>] [--project] | acc agents autonomy [manual|review]');
  personOnly(o, 'change what agents run with');
  const change: ProfileChange = {};
  if (o.model !== undefined) change.model = o.model as string;
  if (o.effort !== undefined) change.effort = o.effort as never;
  if (o['fallback-model'] !== undefined) change.fallbackModel = o['fallback-model'] as string;
  for (const f of (o.clear as string[] | undefined) ?? []) {
    const key = f === 'model' ? 'model' : f === 'effort' ? 'effort' : f === 'fallback-model' ? 'fallbackModel' : null;
    if (!key) throw new AccError('usage', '--clear takes model, effort or fallback-model.');
    change[key] = null;
  }
  if (!Object.keys(change).length) throw new AccError('usage', 'Say what to change: --model, --effort, --fallback-model or --clear.');
  setProfile(run, paths.root, paths.config, roleArg as AgentRole, change, o.project ? 'project' : 'clone');
  const after = profileView(loadConfig(paths.config).config, run, paths.root, roleArg as AgentRole);
  out(o, () => `${roleArg}: model ${after.model ?? 'Claude Code\'s default'}, effort ${after.effort ?? 'default'}${after.fallbackModel ? `, falls back to ${after.fallbackModel}` : ''}. ${o.project ? 'Set in .acc/config.json: commit it to share it.' : 'Set for this clone only.'} The next ${roleArg} uses it.`, after);
  return 0;
}

const AUTONOMY_WORDS: Record<string, string> = {
  manual: 'nothing happens on its own.',
  review: 'autopilot reviews finished work, lands work whose review passed, and re-dispatches a rework once. It never merges.',
  dispatch: 'as review, and it also starts Ready tasks. Not built yet: autopilot refuses.',
  full: 'read as dispatch. Not built yet: autopilot refuses.',
};

/** What autopilot may do on its own (D-055): shown, or set in .acc/config.json by a person. */
function cmdAutonomy(o: Opts, configFile: string, value: string | undefined): number {
  if (value === undefined) {
    const { config } = loadConfig(configFile);
    out(o, () => `autonomy ${config.autonomy} (project): ${AUTONOMY_WORDS[config.autonomy] ?? ''}`.trim(), { autonomy: config.autonomy });
    return 0;
  }
  const role = process.env.ACC_ROLE;
  if (role === 'builder' || role === 'reviewer' || role === 'analyst') throw new AccError('refused', `${role === 'analyst' ? 'An' : 'A'} ${role} can't change what autopilot may do. A person does that.`);
  personOnly(o, 'change what autopilot may do');
  setAutonomy(configFile, value);
  const { config } = loadConfig(configFile);
  out(o, () => `autonomy ${config.autonomy}: ${AUTONOMY_WORDS[config.autonomy]} Set in .acc/config.json: commit it to share it.`, { autonomy: config.autonomy });
  return 0;
}

/** The walkthrough's guided steps (D-035). */
function cmdSetup(o: Opts, what: string | undefined): number {
  const { paths, config } = project(process.cwd());
  const say = (line: string) => { if (!o.json) process.stderr.write(tone(line, 'dim') + '\n'); };
  const deps = { run, now, onStep: say };
  if (what === 'baseline') {
    const r = buildBaseline(paths, config, deps);
    out(o, () => `Wrote ${r.file}: ${r.members} components of ${r.types} types, from ${r.from.join(', ')}.\nCommit it on every environment's branch, so each is retrieved with the same list.`, r);
    return 0;
  }
  if (what === 'branches') {
    personOnly(o, 'make environment branches');
    const r = seedBranches(paths, config, deps, { push: o.push === true });
    out(o, () => (r.length ? r.map((b) => `  ${b.status === 'made' ? '✓' : '✗'} ${b.branch.padEnd(16)} ${b.note}${b.differs !== null ? `; ${b.differs} files differ from production` : ''}`).join('\n') : 'Every environment already has its branch.'), r);
    return r.some((b) => b.status === 'failed') ? 1 : 0;
  }
  if (what === 'lists') {
    const r = draftLists(paths, config, deps);
    const show = (label: string, d: typeof r.knownDrift) => `${d.written ? 'Wrote' : 'Kept'} ${d.file}${d.written ? ` with ${d.entries.length} ${label}` : d.entries.length ? `; consider adding ${d.entries.length}: ${d.entries.slice(0, 5).join(', ')}${d.entries.length > 5 ? ', …' : ''}` : ''}.`;
    out(o, () => [
      show('environment-specific paths', r.environmentSpecific), show('known-drift paths', r.knownDrift),
      ...r.unexplained.map((u) => `  ${u.branch}: ${u.files.length} other difference${u.files.length === 1 ? '' : 's'} from production that neither list explains: real drift, or work in progress. ${u.files.slice(0, 5).join(', ')}${u.files.length > 5 ? ', …' : ''}`),
      'Read both lists before committing them: each line keeps a file out of promotions (environment-specific) or out of drift checks (known drift).',
    ].join('\n'), r);
    return 0;
  }
  if (what === 'readme') {
    const r = writeReadme(paths, config);
    out(o, () => `${r.created ? 'Wrote' : r.replaced ? 'Updated the environments section of' : 'Added an environments section to'} ${r.file}. Keep it the same on every non-production branch.`, r);
    return 0;
  }
  throw new AccError('usage', 'acc setup baseline | branches [--push] | lists | readme');
}

/** Promotion and deploys are a person's: an agent never moves work between environments (D-011, D-034). */
function personOnly(o: Opts, what: string): string {
  const role = process.env.ACC_ROLE;
  if (role === 'builder' || role === 'reviewer') throw new AccError('refused', `A ${role} can't ${what}. A person does that.`);
  const { actor, by } = actorFrom(o);
  if (actor !== 'human') throw new AccError('refused', `Only a person can ${what}.`);
  return by;
}

function cmdPromote(o: Opts, from: string): number {
  personOnly(o, 'promote');
  const { paths, config } = project(process.cwd());
  const say = (line: string) => { if (!o.json) process.stderr.write(tone(line, 'dim') + '\n'); };
  const show = (p: ReturnType<typeof planPromotion>) => [
    `${p.from.name} (${p.from.branch} at ${p.fromSha.slice(0, 7)}) → ${p.to.name} (${p.to.branch} at ${p.toSha.slice(0, 7)})`,
    ...skipWarning(p).map((l) => tone(`  ! ${l}`, 'orange')),
    `  ${p.files.length} to bring over${p.deleted.length ? tone(`, ${p.deleted.length} to delete`, 'orange') : ''}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ''}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`), ...(p.files.length > 20 ? [`    …and ${p.files.length - 20} more`] : []),
    ...p.deleted.map((f) => tone(`    deletes ${f}`, 'orange')),
  ];
  if (o.plan) {
    const p = planPromotion(paths, config, from, o.to as string | undefined, { run });
    out(o, () => show(p).join('\n'), p);
    return 0;
  }
  const r = promote(paths, config, from, o.to as string | undefined, { run, now, env: process.env, onStep: say }, { allowDeletions: o['allow-deletions'] === true, validate: o['skip-validate'] !== true });
  out(o, () => [...show(r.plan), '', r.pr ? `Opened pull request #${r.pr.number}  ${r.pr.url}` : r.stopped ?? '', r.pr ? tone('It merges only when a person merges it. Deploy after that with acc deploy.', 'dim') : ''].filter(Boolean).join('\n'), r);
  return r.pr || !r.stopped?.startsWith('Validation') ? 0 : 1;
}

function cmdDeploy(o: Opts, envName: string): number {
  const by = personOnly(o, 'deploy');
  const { paths, config } = project(process.cwd());
  const show = (p: ReturnType<typeof planDeploy>) => [
    `${p.env.name} (${p.org}): ${p.env.branch} from ${p.base.slice(0, 7)} to ${p.head.slice(0, 7)}${p.confirm ? tone('  protected: needs --confirm-production', 'orange') : ''}`,
    `  ${p.files.length} to deploy, tests: ${p.testLevel}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ''}${p.deleted.length ? tone(`, ${p.deleted.length} deleted (not deployed by acc)`, 'orange') : ''}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`), ...(p.files.length > 20 ? [`    …and ${p.files.length - 20} more`] : []),
  ];
  if (o.plan) {
    const p = planDeploy(paths, config, envName, { run }, { since: o.since as string | undefined, noTests: o['no-tests'] === true });
    out(o, () => show(p).join('\n'), { ...p, last: lastDeploy(paths, p.env.branch) });
    return 0;
  }
  const r = deploy(paths, config, envName, { run, now, onWait: () => { if (!o.json) process.stderr.write(tone('Waiting for another heavy check or deploy on this machine to finish…\n', 'dim')); } }, { since: o.since as string | undefined, confirmed: o['confirm-production'] === true, noTests: o['no-tests'] === true, by });
  out(o, () => [...show(r.plan), '', r.deployed ? tone(`✓ ${r.summary}`, 'blue') : r.summary].join('\n'), r);
  return r.deployed || !r.plan.files.length ? 0 : 1;
}

function cmdDispatch(o: Opts, id: string): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  if (o.foreground && !o.json) process.stdout.write(`Starting ${id.toUpperCase()} in this terminal. Leave the session when it's done.\n`);
  const r = dispatch(paths, config, id.toUpperCase(), { run, now, accBinDir: accBinDir(), accCommand: accCommand(), env: process.env }, { actor, by, foreground: o.foreground === true, withoutAnalysis: o['without-analysis'] === true });
  out(o, () => [
    `${r.task.id} → ${stateLabel('running')}`,
    `  worktree: ${r.worktree}${r.reused ? ' (reused)' : ''}`,
    `  branch:   ${r.branch}`,
    `  agent:    ${r.bgId ? `background session ${r.bgId}. Watch it with: claude attach ${r.bgId}` : o.foreground ? 'ran in this terminal' : 'started; it will appear in claude agents shortly'}`,
    `  packet:   ${r.packetPath}`,
  ].join('\n'), r);
  return 0;
}

function cmdCleanup(o: Opts, id: string): number {
  const { paths, config } = project(process.cwd());
  const r = cleanup(paths, config, id.toUpperCase(), run, now);
  out(o, () => (r.removed ? `Removed ${r.worktree}.` : `Kept ${r.worktree ?? 'the worktree'}:\n- ${r.reasons.join('\n- ')}`), r);
  return r.removed ? 0 : 1;
}

function cmdList(o: Opts, onlyReady: boolean): number {
  const { paths } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const want = o.state as string | undefined;
  const tasks = ledger.tasks.filter((t) => (onlyReady ? isReady(ledger, t) : !want || t.state === want || displayState(ledger, t) === want));
  out(o, () => {
    if (!tasks.length) return onlyReady ? 'Nothing is ready.' : 'No tasks.';
    return table([['Id', 'State', 'Env', 'Title', 'Waiting on'], ...tasks.map((t) => [
      t.id, stateLabel(displayState(ledger, t)), t.environment, t.title,
      t.deps.filter((d) => ledger.tasks.find((x) => x.id === d)?.state !== 'done').join(', '),
    ])]);
  }, tasks.map((t) => ({ ...t, display: displayState(ledger, t), ready: isReady(ledger, t) })));
  return 0;
}

function cmdStatus(o: Opts): number {
  const { paths } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  // In the order the line reads: work in flight, then what waits to start.
  const counts: Record<DisplayState, number> = { running: 0, 'needs-you': 0, review: 0, rework: 0, blocked: 0, ready: 0, todo: 0, done: 0 };
  // The ledger alone, without session info, so this never starts claude.
  for (const t of ledger.tasks) counts[displayState(ledger, t)]++;
  out(o, () => {
    const parts = (Object.keys(counts) as DisplayState[])
      .filter((s) => s !== 'done' && counts[s] > 0)
      .map((s) => tone(`${counts[s]} ${DISPLAY[s].label.toLowerCase()}`, DISPLAY[s].tone));
    return parts.length ? parts.join(' · ') : 'Nothing in play.';
  }, { counts });
  return 0;
}

function cmdShow(o: Opts, id: string): number {
  const { paths } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const t = ledger.tasks.find((x) => x.id === id.toUpperCase());
  if (!t) throw new AccError('no-task', `No task ${id}.`);
  const failed = autopilotFailure(t);
  out(o, () => [
    `${t.id}  ${stateLabel(displayState(ledger, t))}  ${t.title}`,
    `Environment: ${t.environment}   Source: ${t.source.kind}${t.source.url ? ` ${t.source.url}` : ''}`,
    t.deps.length ? `Depends on: ${t.deps.join(', ')}` : '',
    t.blocker ? `Blocked: ${t.blocker}` : '',
    failed ? tone(`! Autopilot couldn't ${stepWords(failed.step, failed.sha || 'it')}: ${failed.reason}`, 'orange') : '',
    t.brief ? `\n${t.brief}\n` : '',
    'History:',
    ...t.history.map((h) => `  ${h.at}  ${h.from ?? '–'} → ${h.to}  by ${h.by}${h.reason ? `: ${h.reason}` : ''}${h.override ? ' (override)' : ''}`),
  ].filter(Boolean).join('\n'), t);
  return 0;
}

function cmdSet(o: Opts, id: string, to: string): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const { task, entry } = moveTask(paths, config, id.toUpperCase(), {
    to: to as State, actor, by, reason: (o.reason as string | undefined) ?? null, force: o.force === true,
  }, receiptHooks(paths, config, run), now);
  out(o, () => `${task.id}: ${entry.from} → ${stateLabel(displayState(readLedger(paths.ledger), task))}${entry.override ? ' (override recorded)' : ''}`, { task, entry });
  return 0;
}

// ---------------------------------------------------------------- GitHub identity (D-028)

function renderIdentity(id: NonNullable<ReturnType<typeof githubIdentity>>): string {
  const scopes = id.accounts?.find((a) => a.login.toLowerCase() === id.account.toLowerCase())?.scopes ?? [];
  return [
    `${id.repo} works as ${id.account}${id.from === 'clone' ? ` (this clone's choice; the project's is ${id.projectAccount})` : ' (the project\'s account)'}`,
    `  gh:      ${id.signedIn ? `${tone('✓', 'blue')} logged in${scopes.length ? `, ${scopes.join(', ')}` : ''}` : tone(`✗ not logged in as ${id.account}`, 'orange')}`,
    `  push:    ${id.pushesAs ? (id.pushesAs.toLowerCase() === id.account.toLowerCase() ? `${tone('✓', 'blue')} as ${id.pushesAs}` : tone(`✗ as ${id.pushesAs}`, 'orange')) : tone('? not set up by acc', 'orange')}`,
    `  commits: ${id.commit.name || id.commit.email ? `${id.commit.name ?? '?'} <${id.commit.email ?? '?'}>` : tone('no identity set for this repo', 'orange')}`,
    id.accounts && id.accounts.length > 1 ? `  others:  ${id.accounts.filter((a) => a.login !== id.account).map((a) => a.login).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function cmdGithub(o: Opts, sub: string | undefined, arg: string | undefined): number {
  const paths = repoPaths(process.cwd(), run);
  const { config } = loadConfig(paths.config);
  if (sub === 'status' || !sub) {
    const id = githubIdentity(config, paths.root, run);
    if (!id) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json.');
    out(o, () => renderIdentity(id), id);
    return id.signedIn && id.pushesAs?.toLowerCase() === id.account.toLowerCase() ? 0 : 1;
  }
  if (sub === 'use') {
    if (!arg && !o.default) throw new AccError('usage', 'acc github use <account>, or --default for the project\'s account');
    const id = useGithubAccount(config, paths.root, run, o.default ? null : arg!);
    out(o, () => renderIdentity(id), id);
    return 0;
  }
  throw new AccError('usage', 'acc github status | acc github use <account> | acc github use --default');
}

// ---------------------------------------------------------------- checks

function currentBranch(root: string): string | null {
  const r = run('git', ['branch', '--show-current'], { cwd: root });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** `--test Name=why` (repeatable). The reason goes in the receipt, so a reviewer sees the builder's thinking. */
function apexTests(o: Opts): ApexTest[] {
  return ((o.test as string[] | undefined) ?? []).map((t) => {
    const [name, ...why] = t.split('=');
    if (!name?.trim() || !/^[A-Za-z_][\w.]*$/.test(name.trim())) throw new AccError('usage', `--test takes an Apex test class and why it covers the change: --test AccountServiceTest="covers the new discount rule". Got "${t}".`);
    return { name: name.trim(), reason: why.join('=').trim() };
  });
}

function checkTarget(o: Opts) {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const branch = currentBranch(paths.root);
  const { env, task } = gateTarget(config, ledger, branch, { env: o.env as string | undefined, task: (o.task as string | undefined) ?? process.env.ACC_TASK ?? undefined });
  return { paths, config, env, task, branch };
}

function cmdGateRun(o: Opts, names: string[]): number {
  const { paths, config, env, branch } = checkTarget(o);
  const say = (line: string) => { if (!o.json) process.stderr.write(line + '\n'); };
  const r = runGates(paths, config, env, names, apexTests(o), {
    run, now,
    onStart: (g) => say(tone(`  … ${g.name}${g.heavy ? ' (heavy)' : ''}`, 'dim')),
    onWait: (g) => say(tone(`  … ${g.name} is waiting for another heavy check on this machine to finish`, 'dim')),
  });
  const bad = r.results.filter((x) => !satisfies(x));
  out(o, () => [
    `${branch ?? 'HEAD'} at ${r.sha.slice(0, 7)}, against ${r.env.name}${r.env.org ? ` (${r.env.org})` : ''}`,
    ...r.results.map((x) => `  ${gateLabel(x.status)}${x.gate.padEnd(11)} ${x.summary}`),
    r.dirty ? tone('Not recorded: there are uncommitted changes, so these results can\'t vouch for a commit. Commit, then run acc gate run again.', 'orange') : '',
    bad.length ? `${bad.length} to fix: ${bad.map((x) => x.gate).join(', ')}.` : r.dirty ? '' : 'All recorded. acc done will accept this commit.',
  ].filter(Boolean).join('\n'), r);
  return bad.length ? 1 : 0;
}

/**
 * A person waives gates on a commit (D-031): the task's latest commit with --task, else this checkout's.
 * A builder never can, whatever it claims to be: it would be waiving its own checks.
 */
function cmdGateWaive(o: Opts, names: string[]): number {
  if (process.env.ACC_ROLE === 'builder') throw new AccError('refused', 'A builder can\'t waive its own checks. If one can\'t pass, say why with acc block "<why>", and a person decides.');
  const { actor, by } = actorFrom(o);
  if (actor !== 'human') throw new AccError('refused', 'Only a person can waive a check.');
  const { paths, config, env, task } = checkTarget(o);
  const branch = o.task ? task?.run?.branch : undefined;
  if (o.task && !branch) throw new AccError('usage', `${task?.id ?? o.task} has no branch yet, so there's no commit to waive checks on.`);
  const sha = run('git', ['rev-parse', '--verify', '--quiet', branch ? `refs/heads/${branch}` : 'HEAD'], { cwd: paths.root }).stdout.trim();
  if (!sha) throw new AccError('git', branch ? `The branch ${branch} isn't in this clone.` : 'This checkout has no commit yet.');
  const waived = waiveGates(paths, config, { sha, env, gates: names, reason: (o.reason as string | undefined) ?? '', by, now });
  out(o, () => [
    `${branch ?? 'HEAD'} at ${sha.slice(0, 7)}, against ${env.name}`,
    ...waived.map((r) => `  ${gateLabel('skip')}${r.gate.padEnd(11)} waived${r.waived?.was ? ` (it was ${r.waived.was})` : ''}: ${r.waived?.reason}`),
    tone('Waived for this commit only. A new commit needs its checks again.', 'dim'),
  ].join('\n'), { sha, env: env.branch, waived });
  return 0;
}

function cmdGateList(o: Opts): number {
  const { paths, config, env, branch: here, task } = checkTarget(o);
  // With --task, the task's latest commit, wherever this is run from.
  const branch = o.task && task?.run?.branch ? task.run.branch : here;
  const head = run('git', ['rev-parse', '--verify', '--quiet', o.task && task?.run?.branch ? `refs/heads/${task.run.branch}` : 'HEAD'], { cwd: paths.root }).stdout.trim();
  const receipts = head ? receiptsAt(paths, head) : {};
  const gates = gatesFor(config).map((g) => ({ name: g.name, about: g.about, required: config.gates.required.includes(g.name), heavy: g.heavy, receipt: receipts[g.name] ?? null }));
  out(o, () => gates.length
    ? [`${branch ?? 'HEAD'} at ${head.slice(0, 7)}, against ${env.name}`, '', table([['Gate', 'Required', 'Heavy', 'This commit', 'Checks'], ...gates.map((g) => [
      g.name, g.required ? 'yes' : '', g.heavy ? 'yes' : '', g.receipt ? gateLabel(g.receipt.status).trimEnd() : tone('not run', 'dim'), g.about,
    ])])].join('\n')
    : 'No gates. List commands under "gates.commands" in .acc/config.json, and the required ones under "gates.required".', { sha: head, env: env.branch, gates });
  return 0;
}

function cmdDrift(o: Opts, envName: string): number {
  const { paths, config } = project(process.cwd());
  if (!o.json) process.stderr.write(tone(`Retrieving the baseline from ${envName}. This only reads the org.\n`, 'dim'));
  const r = drift(paths, config, envName, { run, now, onWait: () => { if (!o.json) process.stderr.write(tone('Waiting for another heavy check on this machine to finish…\n', 'dim')); } }, { manifest: o.manifest as string | undefined, keep: o.keep === true });
  const found = r.changed.length + r.added.length + r.missing.length;
  if (o.json) {
    out(o, () => '', r);
    return found ? 1 : 0;
  }
  // Notes on the manifest aren't drift: they go to stderr, so a matching org prints nothing on stdout.
  if (r.unretrievable.length) process.stderr.write([tone(`Not drift, but the retrieve couldn't fetch these; check the baseline manifest (${r.unretrievable.length}):`, 'dim'), ...r.unretrievable.map((f) => tone(`  ${f}`, 'dim'))].join('\n') + '\n');
  if (found || r.kept) {
    process.stdout.write([
      found ? `${r.org} differs from ${r.env} at ${r.base.slice(0, 7)}${r.ignored ? ` (${r.ignored} expected differences left out)` : ''}:` : '',
      ...(r.changed.length ? ['', `Changed in the org (${r.changed.length}):`, ...r.changed.map((f) => `  ${f}`)] : []),
      ...(r.added.length ? ['', `Only in the org (${r.added.length}):`, ...r.added.map((f) => `  ${f}`)] : []),
      ...(r.missing.length ? ['', `In the branch but not the org (${r.missing.length}):`, ...r.missing.map((f) => `  ${f}`)] : []),
      r.kept ? `\nKept the retrieved copy at ${r.kept}. Remove it with: git worktree remove --force "${r.kept}"` : '',
    ].filter((l) => l !== '').join('\n') + '\n');
  }
  return found ? 1 : 0;
}

// ---------------------------------------------------------------- entry

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
      part: { type: 'string' },
      step: { type: 'string', multiple: true },
      profile: { type: 'string' },
      project: { type: 'string' },
      'production-org': { type: 'string' },
      'github-repo': { type: 'string' },
      'github-account': { type: 'string' },
      'commit-name': { type: 'string' },
      'commit-email': { type: 'string' },
      'configure-git': { type: 'boolean', default: false },
      'jira-site': { type: 'string' },
      'jira-project': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      brief: { type: 'string' },
      dep: { type: 'string', multiple: true },
      env: { type: 'string' },
      key: { type: 'string' },
      file: { type: 'string' },
      state: { type: 'string' },
      reason: { type: 'string' },
      as: { type: 'string' },
      by: { type: 'string' },
      label: { type: 'string' },
      foreground: { type: 'boolean', default: false },
      'without-analysis': { type: 'boolean', default: false },
      'no-tests': { type: 'boolean', default: false },
      test: { type: 'string', multiple: true },
      task: { type: 'string' },
      manifest: { type: 'string' },
      keep: { type: 'boolean', default: false },
      default: { type: 'boolean', default: false },
      to: { type: 'string' },
      plan: { type: 'boolean', default: false },
      'allow-deletions': { type: 'boolean', default: false },
      'skip-validate': { type: 'boolean', default: false },
      since: { type: 'string' },
      'confirm-production': { type: 'boolean', default: false },
      push: { type: 'boolean', default: false },
      model: { type: 'string' },
      effort: { type: 'string' },
      'fallback-model': { type: 'string' },
      clear: { type: 'string', multiple: true },
      once: { type: 'boolean', default: false },
      every: { type: 'string' },
    },
  });
  const o = values as Opts;
  const [cmd, ...rest] = positionals;
  if (values.version) { process.stdout.write(`${VERSION}\n`); return 0; }
  if (!cmd || values.help || cmd === 'help') { process.stdout.write(HELP + '\n'); return cmd ? 0 : (values.help ? 0 : 2); }
  switch (cmd) {
    case 'doctor': return cmdDoctor(o, false);
    case 'onboard': return cmdDoctor(o, true);
    case 'init': return cmdInit(o);
    case 'setup': return cmdSetup(o, rest[0]);
    case 'agents': return cmdAgents(o, rest[0], rest[1]);
    case 'add': {
      const title = rest.join(' ').trim();
      if (!title) throw new AccError('usage', 'acc add "<title>"');
      return upsert(o, [{ source: { kind: 'manual', key: (o.key as string | undefined) ?? null }, title, brief: o.brief as string | undefined, deps: (o.dep as string[] | undefined) ?? [], environment: o.env as string | undefined }]);
    }
    case 'import': {
      const data = readInput(o.file as string | undefined);
      if (!Array.isArray(data)) throw new AccError('usage', 'acc import expects a JSON list of tasks.');
      return upsert(o, data as TaskInput[]);
    }
    case 'intake': {
      if (rest[0] !== 'github') throw new AccError('usage', 'acc intake github [--label <label>]. Jira intake runs through the plugin\'s skill (M6).');
      return cmdIntakeGithub(o);
    }
    case 'dispatch': {
      if (!rest[0]) throw new AccError('usage', 'acc dispatch <id> [--foreground]');
      return cmdDispatch(o, rest[0]);
    }
    case 'done': return cmdSet(o, taskIdFrom(rest[0]), 'review');
    case 'block': {
      const [first, ...more] = rest;
      const looksLikeId = !!first && /^[A-Z][A-Z0-9_]*-\d+$/i.test(first) && more.length > 0;
      const id = taskIdFrom(looksLikeId ? first : undefined);
      const reason = (o.reason as string | undefined) ?? (looksLikeId ? more : rest).join(' ').trim();
      if (!reason) throw new AccError('usage', 'acc block "<what you need>"');
      return cmdSet({ ...o, reason }, id, 'blocked');
    }
    case 'analyze': {
      if (!rest[0]) throw new AccError('usage', 'acc analyze <id>');
      return cmdAnalyze(o, rest[0]);
    }
    case 'analysis': {
      if (rest[0] === 'answer') {
        if (!rest[1] || !rest[2] || !rest[3]) throw new AccError('usage', 'acc analysis answer <id> <q> "<answer>"');
        return cmdAnswerAnalysis(o, rest[1], rest[2], rest.slice(3).join(' '));
      }
      if (!rest[0]) throw new AccError('usage', 'acc analysis <id>');
      return cmdShowAnalysis(o, rest[0]);
    }
    case 'review': {
      if (!rest[0]) throw new AccError('usage', 'acc review <id>');
      return cmdReview(o, rest[0]);
    }
    case 'land': {
      if (!rest[0]) throw new AccError('usage', 'acc land <id>');
      return cmdLand(o, rest[0]);
    }
    case 'autopilot': return cmdAutopilot(o);
    case 'sync': return cmdSync(o);
    case 'promote': {
      if (!rest[0]) throw new AccError('usage', 'acc promote <env> [--to <env>]');
      return cmdPromote(o, rest[0]);
    }
    case 'deploy': {
      if (!rest[0]) throw new AccError('usage', 'acc deploy <env> [--since <commit>] [--confirm-production]');
      return cmdDeploy(o, rest[0]);
    }
    case 'cleanup': {
      if (!rest[0]) throw new AccError('usage', 'acc cleanup <id>');
      return cmdCleanup(o, rest[0]);
    }
    case 'gate': {
      const [sub, ...names] = rest;
      if (sub === 'run') return cmdGateRun(o, names);
      if (sub === 'list') return cmdGateList(o);
      if (sub === 'waive') return cmdGateWaive(o, names);
      throw new AccError('usage', 'acc gate run [<gate>...] | acc gate list | acc gate waive <gate>... --reason "<why>"');
    }
    case 'github': return cmdGithub(o, rest[0], rest[1]);
    case 'hook': {
      if (rest[0] === 'permission') return cmdHookPermission();
      if (rest[0] === 'session-start' || rest[0] === 'pre-tool-use' || rest[0] === 'stop') return cmdHookEvent(rest[0]);
      // Exit 1, never 2: for a hook, 2 would block the tool.
      process.stderr.write('acc hook takes permission, session-start, pre-tool-use or stop.\n');
      return 1;
    }
    case 'drift': {
      if (!rest[0]) throw new AccError('usage', 'acc drift <environment>');
      return cmdDrift(o, rest[0]);
    }
    case 'status': return cmdStatus(o);
    case 'list': return cmdList(o, false);
    case 'ready': return cmdList(o, true);
    case 'show': {
      if (!rest[0]) throw new AccError('usage', 'acc show <id>');
      return cmdShow(o, rest[0]);
    }
    case 'set': {
      if (!rest[0] || !rest[1]) throw new AccError('usage', 'acc set <id> <state> [--reason <text>]');
      return cmdSet(o, rest[0], rest[1]);
    }
    default:
      throw new AccError('usage', `Unknown command "${cmd}". Run acc help.`);
  }
}

const isEntry = (() => {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
})();
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      const err = e as Error & { code?: string };
      const json = process.argv.includes('--json');
      if (json) process.stdout.write(JSON.stringify({ error: err.code ?? 'error', message: err.message }) + '\n');
      else process.stderr.write(tone(`✗ ${err.message}`, 'orange') + '\n');
      const usage = err.code === 'usage' || String(err.code ?? '').startsWith('ERR_PARSE_ARGS');
      process.exit(usage ? 2 : err instanceof AccError ? 1 : 3);
    },
  );
}
