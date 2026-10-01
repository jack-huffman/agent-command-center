import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ACTORS, AccError, type Actor, configureRepoAccess, displayState, isReady, loadConfig, makeContext, moveTask, mutate,
  cleanup, dispatch, githubIssuesToTasks, planInit, type Profile, readLedger, STEPS, receiptHooks, repoPaths, run, runSteps, type State, type StepResult, type TaskInput,
  upsertTasks, writeConfig,
} from '../../core/src/index.ts';
import { checkLabel, stateLabel, table, tone } from './format.ts';

const VERSION = '0.1.0';
const now = () => new Date();

const HELP = `acc ${VERSION}: Agent Command Center

Setup
  acc doctor [--part machine|project] [--step <id>]...
                                        Check the onboarding steps and print the fixes
  acc onboard                           The same checks as a guided list, with the next step to do
  acc init --profile salesforce --production-org <alias> [--project <name>] [--github-repo <o/r>]
           [--github-account <a>] [--commit-name <n> --commit-email <e>] [--configure-git]
           [--jira-site <site> --jira-project <key>] [--dry-run] [--force]
  acc init --profile generic [...]

Tasks
  acc add "<title>" [--brief <text>] [--dep <id>]... [--env <branch>] [--key <T-n>]
  acc import [--file <tasks.json>]      Add or refresh tasks from JSON (stdin by default)
  acc intake github [--label <l>]       Add or refresh tasks from the repo's open GitHub issues
  acc list [--state <state>]
  acc ready
  acc show <id>
  acc set <id> <state> [--reason <text>] [--force] [--as <actor>] [--by <name>]

Agents
  acc dispatch <id> [--foreground]      Worktree, setup, instructions, and a background builder session
  acc done [<id>]                       A builder's finish line: moves its task to review
  acc block [<id>] "<reason>"           A builder's way out when stuck
  acc cleanup <id>                      Remove a finished task's worktree, only if nothing would be lost

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
  const { config, warnings } = loadConfig(paths.config);
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  return { paths, config };
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

function upsert(o: Opts, inputs: TaskInput[]): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const res = mutate(paths, now, (ledger, emit) => upsertTasks(ledger, config, inputs, actor, by, emit, now));
  out(o, () => [
    res.added.length ? `Added ${res.added.join(', ')}` : '',
    res.updated.length ? `Updated ${res.updated.join(', ')}` : '',
    res.unchanged.length ? `Unchanged ${res.unchanged.join(', ')}` : '',
    ...res.errors.map((e) => tone(`✗ ${e}`, 'orange')),
  ].filter(Boolean).join('\n') || 'Nothing to do.', res);
  return res.errors.length ? 1 : 0;
}

/** Reads open issues as the repo's own GitHub account (D-007) and upserts them. Never changes GitHub. */
function cmdIntakeGithub(o: Opts): number {
  const { config } = project(process.cwd());
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json.');
  const token = run('gh', ['auth', 'token', '-u', gh.account]);
  if (token.code !== 0) throw new AccError('no-github', `gh isn't logged in as ${gh.account}. Run: gh auth login`);
  const args = ['issue', 'list', '-R', gh.repo, '--state', 'open', '--limit', '500', '--json', 'number,title,body,url,labels'];
  if (o.label) args.push('--label', o.label as string);
  const r = run('gh', args, { env: { ...process.env, GH_TOKEN: token.stdout.trim() } });
  if (r.code !== 0) throw new AccError('github', `Couldn't list issues on ${gh.repo}: ${r.stderr.trim().split('\n')[0]}`);
  return upsert(o, githubIssuesToTasks(JSON.parse(r.stdout)));
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

function cmdDispatch(o: Opts, id: string): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  if (o.foreground && !o.json) process.stdout.write(`Starting ${id.toUpperCase()} in this terminal. Leave the session when it's done.\n`);
  const r = dispatch(paths, config, id.toUpperCase(), { run, now, accBinDir: accBinDir(), env: process.env }, { actor, by, foreground: o.foreground === true });
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

function cmdShow(o: Opts, id: string): number {
  const { paths } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const t = ledger.tasks.find((x) => x.id === id.toUpperCase());
  if (!t) throw new AccError('no-task', `No task ${id}.`);
  out(o, () => [
    `${t.id}  ${stateLabel(displayState(ledger, t))}  ${t.title}`,
    `Environment: ${t.environment}   Source: ${t.source.kind}${t.source.url ? ` ${t.source.url}` : ''}`,
    t.deps.length ? `Depends on: ${t.deps.join(', ')}` : '',
    t.blocker ? `Blocked: ${t.blocker}` : '',
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
    case 'cleanup': {
      if (!rest[0]) throw new AccError('usage', 'acc cleanup <id>');
      return cmdCleanup(o, rest[0]);
    }
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
