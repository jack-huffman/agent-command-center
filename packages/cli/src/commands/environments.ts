// acc's Environments commands: promote and deploy.

import { createInterface } from 'node:readline/promises';
import { AccError, deploy, deployTask, lastDeploy, planDeploy, planPromotion, planTaskDeploy, promote, run, skipWarning, type TaskDeployPlan } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, personOnly, project, steps } from '../shared.ts';

function cmdPromote(o: Opts, from: string): number {
  const by = personOnly(o, 'promote');
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
  const r = promote(paths, config, from, o.to as string | undefined, { run, now, env: process.env, onStep: say, steps: steps() }, { allowDeletions: o['allow-deletions'] === true, validate: o['skip-validate'] !== true, by });
  out(o, () => [
    ...show(r.plan), '', r.pr ? `Opened pull request #${r.pr.number}  ${r.pr.url}` : r.stopped ?? '', r.pr ? tone('It merges only when a person merges it. Deploy after that with acc deploy.', 'dim') : '',
    r.warning ? tone(`! ${r.warning}`, 'orange') : '',
    // Its tasks' changes outside git (T-100): steps a person makes by hand, then marks.
    r.steps ? tone(`! ${r.steps} change${r.steps === 1 ? '' : 's'} outside git to make by hand in ${r.plan.to.name}, listed on the pull request. Mark each with acc change step once made.`, 'orange') : '',
    ...r.updates.map((u) => `  Drafted an update for ${u.key} (${u.id}).`),
    r.updates.length ? tone('Nothing is posted until a person posts it: acc updates.', 'dim') : '',
  ].filter(Boolean).join('\n'), r);
  const code = r.pr || !r.stopped?.startsWith('Validation') ? 0 : 1;
  steps().result(code === 0, r.pr ? `Opened pull request #${r.pr.number} into ${r.plan.to.name}.` : r.stopped ?? 'It finished.');
  return code;
}

function cmdDeploy(o: Opts, envName: string): number {
  const by = personOnly(o, 'deploy');
  const { paths, config } = project(process.cwd());
  const show = (p: ReturnType<typeof planDeploy>) => [
    `${p.env.name} (${p.org}): ${p.env.branch} from ${p.base.slice(0, 7)} to ${p.head.slice(0, 7)}${p.confirm ? tone('  protected: needs --confirm-production', 'orange') : ''}`,
    `  ${p.files.length} to deploy, tests: ${p.testLevel}${p.leftOut.length ? `, ${p.leftOut.length} environment-specific left out` : ''}${p.deployedBy.length ? `, ${p.deployedBy.length} already deployed by ${[...new Set(p.deployedBy.map((d) => d.task))].join(', ')}` : ''}${p.deleted.length ? tone(`, ${p.deleted.length} deleted (not deployed by acc)`, 'orange') : ''}`,
    ...p.files.slice(0, 20).map((f) => `    ${f}`), ...(p.files.length > 20 ? [`    …and ${p.files.length - 20} more`] : []),
  ];
  if (o.plan) {
    const p = planDeploy(paths, config, envName, { run }, { since: o.since as string | undefined, noTests: o['no-tests'] === true });
    out(o, () => show(p).join('\n'), { ...p, last: lastDeploy(paths, p.env.branch) });
    return 0;
  }
  const r = deploy(paths, config, envName, { run, now, steps: steps(), onWait: () => { if (!o.json) process.stderr.write(tone('Waiting for another heavy check or deploy on this machine to finish…\n', 'dim')); } }, { since: o.since as string | undefined, confirmed: o['confirm-production'] === true, noTests: o['no-tests'] === true, by });
  out(o, () => [
    ...show(r.plan), '', r.deployed ? tone(`✓ ${r.summary}`, 'blue') : r.summary,
    ...r.updates.map((u) => `  Drafted an update for ${u.key} (${u.id}).`),
    r.updates.length ? tone('Nothing is posted until a person posts it: acc updates.', 'dim') : '',
  ].filter(Boolean).join('\n'), r);
  const code = r.deployed || !r.plan.files.length ? 0 : 1;
  steps().result(code === 0, r.summary);
  return code;
}

/** A ticket's deploy plan as a person reads it: where, what, what's left out, what's by hand, and the check. */
export function taskPlanLines(p: TaskDeployPlan): string[] {
  const count = p.types.reduce((n, t) => n + t.members.length, 0);
  const c = p.check;
  return [
    `${p.task}: ${p.from.name} → ${p.to.name} (${p.org})${p.confirm ? tone(`  protected: type ${p.confirmName} to deploy`, 'orange') : ''}`,
    `  ${count} component${count === 1 ? '' : 's'} from ${p.commits.length} commit${p.commits.length === 1 ? '' : 's'} of its own. Tests: ${p.tests}.`,
    ...p.types.flatMap((t) => [`    ${t.name}`, ...t.members.map((m) => `      ${m}`)]),
    ...(p.gitOnly.length ? [tone(`  In its pull request, not deployed: ${p.gitOnly.join(', ')}`, 'dim')] : []),
    ...(p.leftOut.length ? [`  Left out, environment-specific: ${p.leftOut.join(', ')}`] : []),
    ...p.deletions.map((d) => tone(`  ! Delete by hand in ${p.to.name}: ${d.component}`, 'orange')),
    ...p.records.map((r) => tone(`  ! Make by hand in ${p.to.name}: ${r}`, 'orange')),
    '',
    !c ? 'Nothing of it deploys, so nothing was checked.'
      : c.passed ? tone(`✓ The check passed: ${c.summary}`, 'blue')
        : tone(`! The check failed: ${c.summary}`, 'orange'),
    ...(c && !c.passed ? c.problems.map((x) => `    ${x}`) : []),
  ];
}

/** Asks the person on the terminal, when there is one: a yes, or the org's name for a protected org. */
async function askYes(p: TaskDeployPlan): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const said = (await rl.question(p.confirm ? `${p.to.name} is protected. Type ${p.confirmName} to deploy ${p.task} to it: ` : `Deploy ${p.task} to ${p.to.name} (${p.org})? Type yes: `)).trim();
    return p.confirm ? (said === p.confirmName ? said : null) : (said.toLowerCase() === 'yes' ? 'yes' : null);
  } finally {
    rl.close();
  }
}

/** acc deploy [<env>] --task <id>: one ticket to its next environment, a check first, then the person's yes (T-137). */
async function cmdDeployTask(o: Opts, envName: string | undefined): Promise<number> {
  const by = personOnly(o, 'deploy a ticket');
  const { paths, config } = project(process.cwd());
  const id = String(o.task).trim().toUpperCase();
  if (!id) throw new AccError('usage', 'Say which task: --task <id>.');
  const deps = { run, now, env: process.env, steps: steps(), onWait: () => { if (!o.json) process.stderr.write(tone('Waiting for another deploy to this org to finish…\n', 'dim')); } };
  const noTests = o['no-tests'] === true;
  let checkId = o['deploy-check'] as string | undefined;
  let typed = o['confirm-name'] as string | undefined;
  if (o.plan || !checkId) {
    const p = planTaskDeploy(paths, config, id, envName, deps, { noTests, by });
    if (o.plan || o.json || !p.check?.passed) {
      out(o, () => [...taskPlanLines(p), p.check?.passed ? tone(`Nothing has changed. To deploy it: acc deploy ${p.to.branch} --task ${id} --yes ${p.check.id}${p.confirm ? ` --confirm-production ${p.confirmName}` : ''}`, 'dim') : ''].filter(Boolean).join('\n'), p);
      steps().result(!p.check || p.check.passed, p.check?.summary ?? 'Nothing of it deploys.');
      return !p.check || p.check.passed ? 0 : 1;
    }
    process.stdout.write(taskPlanLines(p).join('\n') + '\n');
    const yes = await askYes(p);
    if (!yes) {
      process.stdout.write(`Nothing was deployed. To deploy it: acc deploy ${p.to.branch} --task ${id} --yes ${p.check.id}${p.confirm ? ` --confirm-production ${p.confirmName}` : ''}\n`);
      return 0;
    }
    checkId = p.check.id!;
    if (p.confirm) typed = yes;
    envName = p.to.branch;
  }
  const r = deployTask(paths, config, id, envName, deps, { noTests, by, checkId, confirm: typed });
  out(o, () => [
    r.deployed ? tone(`✓ ${r.summary}`, 'blue') : r.summary,
    r.warning ? tone(`! ${r.warning}`, 'orange') : '',
    ...r.plan.deletions.map((d) => tone(`! Delete by hand in ${r.plan.to.name}: ${d.component}`, 'orange')),
    ...r.plan.records.map((x) => tone(`! Make by hand in ${r.plan.to.name}: ${x}`, 'orange')),
    r.update ? `  Drafted an update for ${r.update.key} (${r.update.id}). Nothing is posted until a person posts it.` : '',
  ].filter(Boolean).join('\n'), r);
  steps().result(r.deployed, r.summary);
  return r.deployed || !r.plan.files.length ? 0 : 1;
}

/**
 * For a ticket's deploy, its two flags that take a value here are given another name before they're parsed:
 * --yes and --confirm-production are on/off flags elsewhere.
 */
export function taskDeployArgv(argv: string[]): string[] {
  if (!argv.some((x) => x === '--task' || x.startsWith('--task='))) return argv;
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    const next = argv[i + 1];
    const named = x === '--yes' ? 'deploy-check' : x === '--confirm-production' ? 'confirm-name' : null;
    if (named && next !== undefined && !next.startsWith('-')) { out.push(`--${named}=${next}`); i++; }
    else out.push(x);
  }
  return out;
}

export const area: CommandArea = {
  help: {
    section: 'Environments',
    order: 50,
    lines: `  acc promote <env> [--to <env>] [--plan] [--allow-deletions] [--skip-validate]
                                        A pull request taking <env>'s merged changes to the next environment
  acc deploy <env> [--plan] [--since <commit>] [--confirm-production] [--no-tests]
                                        Deploy what changed on <env>'s branch since its last deploy to its org
  acc deploy [<env>] --task <id> [--plan] [--yes <check-id>] [--confirm-production <name>] [--no-tests]
                                        Deploy one ticket to its next environment: a check first, then your
                                        yes; its commits reach <env>'s branch by a pull request acc merges`,
  },
  options: {
    to: { type: 'string' },
    plan: { type: 'boolean', default: false },
    'allow-deletions': { type: 'boolean', default: false },
    'skip-validate': { type: 'boolean', default: false },
    since: { type: 'string' },
    'confirm-production': { type: 'boolean', default: false },
    'no-tests': { type: 'boolean', default: false },
    task: { type: 'string' },
    'deploy-check': { type: 'string' },
    'confirm-name': { type: 'string' },
  },
  argv: { deploy: taskDeployArgv },
  commands: {
    promote: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc promote <env> [--to <env>]');
      return cmdPromote(o, rest[0]);
    },
    deploy: (o, rest) => {
      if (o.task !== undefined) return cmdDeployTask(o, rest[0]);
      if (!rest[0]) throw new AccError('usage', 'acc deploy <env> [--since <commit>] [--confirm-production]');
      return cmdDeploy(o, rest[0]);
    },
  },
};
