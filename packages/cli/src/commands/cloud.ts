// acc's Cloud commands (GH-69): opting a project in to cloud builders, the routine's token, what the cloud
// still needs, and collecting a cloud builder's work. A person's, never an agent's.

import { AccError, BUILDER_PLACE_LOOK, type BuilderPlace, cloudNeeds, cloudReason, cloudReviewWait, cloudWait, collect, commitGuard, type Config, deleteCloudToken, disableCloud, enableCloud, environmentProtection, guardCommitted, guardPlace, installGuard, loadConfig, pushGuard, readLedger, run, ROUTINES_URL, writeCloudToken } from '../../../core/src/index.ts';
import { stateLabel, tone } from '../format.ts';
import { actorFrom, type CommandArea, followingCards, noAgent, now, type Opts, out, project, readFileArg } from '../shared.ts';

/** What the cloud still needs, each need on a line, with its fix in dim. */
function needLines(needs: ReturnType<typeof cloudNeeds>): string[] {
  return needs.map((n) => (n.ok ? tone(`✓ ${n.label}`, 'blue') : [tone(`! ${n.label}`, 'orange'), tone(`    ${n.fix}`, 'dim')].join('\n')));
}

/** The branch acc takes as the one a cloud session clones when origin names no default (T-145). */
const firstBranch = (config: Config): string => config.environments[0]?.branch ?? 'main';

function cmdStatus(o: Opts): number {
  const { paths, config } = project(process.cwd());
  const needs = cloudNeeds(config, run, process.env);
  const cloud = config.agents.cloud;
  const ledger = readLedger(paths.ledger);
  const running = ledger.tasks.filter((t) => t.state === 'running' && t.run?.where === 'cloud');
  // Reviews under way in the cloud (T-86), beside the builders.
  const reviewing = ledger.tasks.filter((t) => t.state === 'review' && t.cloudReview && !t.cloudReview.failed);
  const reason = cloudReason(needs);
  // The guard as a cloud session would see it: in HEAD's tree, not the files on disk (GH-69).
  const guard = guardCommitted(run, paths.root, 'HEAD');
  // GitHub's rules behind the guard, per environment branch: a warning where it enforces none, never a refusal.
  // The guard on the branch the cloud clones, here and on GitHub (T-145): Set up cloud builders' last step.
  const place = guardPlace(run, paths.root, firstBranch(config));
  const protection = cloud && config.github ? environmentProtection(run, config.github.repo, config.github.account, config.environments.map((e) => e.branch), process.env) : [];
  out(o, () => [
    cloud
      ? `Cloud builders: on for this project. Default ${BUILDER_PLACE_LOOK[cloud.default].label}${cloud.default === 'cloud' ? ' (acc dispatch --local keeps a task on this Mac)' : ' (acc dispatch --cloud sends a task to the cloud)'}; up to ${cloud.max} at once, reviews among them; a task needs you after ${cloud.quietMinutes} minutes with no push. Reviews: ${BUILDER_PLACE_LOOK[cloud.review].label}${cloud.review === 'cloud' ? ' (acc review --local keeps one on this Mac)' : ' (acc review --cloud sends one to the cloud)'}.`
      : 'Cloud builders: off for this project. A local builder is the default everywhere: acc cloud enable opts in.',
    reason ? tone(`  ${reason}.`, 'orange') : tone('  Everything the cloud needs is there.', 'blue'),
    guard.ok ? tone('  The push guard is committed on HEAD, in .claude/hooks/ and .claude/settings.json.', 'dim') : cloud ? tone(`  ! ${guard.why}`, 'orange') : '',
    ...needLines(needs),
    ...protection.map((p) => (p.state === 'enforced' ? tone(`  ✓ ${p.why}`, 'blue') : tone(`  ! ${p.why}${p.state === 'unknown' ? ' Whether a push the guard didn\'t catch would be prevented isn\'t known.' : ''}`, 'orange'))),
    ...running.map((t) => tone(`  ${t.id} runs in the cloud: ${t.run?.cloud?.url ?? ''}${cloudWait(t, config, now()) ? ` (${cloudWait(t, config, now())})` : ''}`, 'blue')),
    ...reviewing.map((t) => tone(`  ${t.id} is reviewed in the cloud: ${t.cloudReview?.url ?? ''}${cloudReviewWait(t, config, now()) ? ` (${cloudReviewWait(t, config, now())})` : ''}`, 'blue')),
  ].filter(Boolean).join('\n'), { cloud, needs, reason, guard: guard.ok, guardWhy: guard.why, guardPlace: place, protection, running: running.map((t) => ({ id: t.id, url: t.run?.cloud?.url ?? null, wait: cloudWait(t, config, now()) })), reviewing: reviewing.map((t) => ({ id: t.id, url: t.cloudReview?.url ?? null, wait: cloudReviewWait(t, config, now()) })) });
  return 0;
}

function cmdEnable(o: Opts): number {
  noAgent(o, 'opt a project in to cloud builders');
  const { paths, config } = project(process.cwd());
  if (!config.github) throw new AccError('refused', 'Cloud builders need the repo on GitHub: a cloud session clones it from there and pushes its branch back. Add the "github" section to .acc/config.json first.');
  const num = (k: string): number | undefined => (o[k] === undefined ? undefined : /^\d+$/.test(String(o[k])) ? Number(o[k]) : NaN);
  enableCloud(paths.config, {
    ...(typeof o.routine === 'string' ? { routine: o.routine.trim() } : {}),
    ...(typeof o['default-place'] === 'string' ? { default: o['default-place'] as BuilderPlace } : {}),
    ...(num('quiet-minutes') !== undefined ? { quietMinutes: num('quiet-minutes')! } : {}),
    ...(num('max') !== undefined ? { max: num('max')! } : {}),
    ...(typeof o.review === 'string' ? { review: o.review as BuilderPlace } : {}),
  }, config.agents.cloud);
  // The guard the cloud session runs (GH-69): committed with the config, so it loads there.
  const guard = installGuard(paths.root);
  const after = loadConfig(paths.config).config;
  const needs = cloudNeeds(after, run, process.env);
  out(o, () => [
    `Cloud builders are on for ${config.project}: acc dispatch <id> --cloud sends a task to the cloud${after.agents.cloud?.default === 'cloud' ? ', and so does a plain dispatch now' : ', and a plain dispatch stays on this Mac'}.`,
    guard.written.length ? `  Wrote ${guard.written.join(' and ')}: the push guard a cloud session runs. Commit them with .acc/config.json.` : '  The push guard is already committed.',
    ...needLines(needs),
  ].join('\n'), { cloud: after.agents.cloud, guard: guard.written, needs });
  return 0;
}

function cmdDisable(o: Opts): number {
  noAgent(o, 'turn cloud builders off');
  const { paths, config } = project(process.cwd());
  disableCloud(paths.config);
  out(o, () => `Cloud builders are off for ${config.project}. Every dispatch goes to this Mac. The routine's token stays in the keychain: acc cloud token --forget takes it out.`, { cloud: null });
  return 0;
}

/** The scheduled task's token into a Mac's keychain, from stdin or the environment, never from the command line. */
function cmdToken(o: Opts): number {
  noAgent(o, 'keep the routine\'s token');
  const { config } = project(process.cwd());
  if (!config.github) throw new AccError('refused', 'Cloud builders need the repo on GitHub. Add the "github" section to .acc/config.json first.');
  const repo = config.github.repo;
  if (o.forget === true) {
    const gone = deleteCloudToken(run, repo, process.env);
    out(o, () => (gone ? `Took the routine's token for ${repo} out of the keychain.` : `There was no token for ${repo} in the keychain.`), { forgotten: gone });
    return 0;
  }
  const token = (o['from-env'] === true ? process.env.ACC_CLOUD_TOKEN_NEW ?? '' : readFileArg(0)).trim();
  if (!token) throw new AccError('usage', 'Paste the token on stdin: acc cloud token < token.txt, or echo "$TOKEN" | acc cloud token. It never goes on the command line.');
  writeCloudToken(run, repo, token, process.env);
  out(o, () => `Kept the scheduled task's token for ${repo} in this Mac's keychain (${repo}, service acc-cloud-routine). It's never written to .acc/config.json or git.`, { kept: true });
  return 0;
}

/**
 * The push guard on the branch the cloud clones (T-145): where it stands, committing it there (the three files
 * only), or pushing that branch. A person's, never an agent's: Set up cloud builders asks before a push.
 */
function cmdGuard(o: Opts, sub: string | undefined): number {
  const { paths, config } = project(process.cwd());
  const main = firstBranch(config);
  if (sub === 'commit') {
    noAgent(o, 'commit the push guard');
    const r = commitGuard(run, paths.root, main);
    out(o, () => (r.committed ? `Committed the push guard on ${r.base}. Push ${r.base} so the cloud clones it.` : `The push guard is already committed on ${r.base}.`), r);
    return 0;
  }
  if (sub === 'push') {
    noAgent(o, 'push the branch the cloud clones');
    const r = pushGuard(run, paths.root, main, process.env);
    out(o, () => (r.pushed ? `Pushed ${r.base} to GitHub, with the push guard.` : `GitHub's ${r.base} has the push guard already.`), r);
    return 0;
  }
  if (sub !== undefined) throw new AccError('usage', 'acc cloud guard [commit|push]');
  const place = guardPlace(run, paths.root, main);
  out(o, () => [
    `The cloud clones ${place.base}.`,
    place.local.ok ? tone(`  ✓ The push guard is committed on ${place.base} here.`, 'blue') : tone(`  ! ${place.local.why}`, 'orange'),
    place.pushed.ok ? tone(`  ✓ GitHub's ${place.base} has it.`, 'blue') : tone(`  ! ${place.pushed.why}`, 'orange'),
  ].join('\n'), place);
  return 0;
}

/** Collects a cloud builder's work into its worktree, runs the checks here, and moves it to review (GH-69). */
function cmdCollect(o: Opts, id: string | undefined): number {
  if (!id) throw new AccError('usage', 'acc collect <id>');
  noAgent(o, 'collect a cloud builder\'s work');
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const r = followingCards(paths, config, () => collect(paths, config, id.toUpperCase(), { run, now, env: process.env }, { actor, by }));
  out(o, () => [
    `${r.task.id} → ${stateLabel('review')}`,
    `  ${r.reason}`,
    ...r.checks.map((c) => `  ${c.status === 'pass' || c.status === 'skip' ? '✓' : '!'} ${c.gate}: ${c.summary}`),
  ].join('\n'), r);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Agents',
    order: 32,
    lines: `  acc cloud                             Whether this project's builders may run in the cloud, what that still
                                        needs, and each task running there
  acc cloud enable [--routine <trig_id>] [--default-place local|cloud] [--max <n>] [--quiet-minutes <n>] [--review local|cloud]
                                        Opt the project in: "agents.cloud" in .acc/config.json, and the push guard
                                        in .claude/settings.json, both to commit. Needs the repo on GitHub, a
                                        scheduled task for it (claude.ai/code/routines), its token (acc cloud token), and
                                        claude auth login. Local stays the default unless --default-place cloud;
                                        reviews stay on this Mac unless --review cloud
  acc cloud disable                     Turn cloud builders off for the project
  acc cloud token [--forget]            Keep the scheduled task's API token in this Mac's keychain, read from stdin,
                                        never from the command line; --forget takes it out. On Windows the Command
                                        Center keeps it, and hands it to acc when it builds or reviews
  acc cloud guard [commit|push]         Whether the push guard is committed on the branch the cloud clones, and on
                                        GitHub; commit commits its three files there; push pushes that branch
  acc collect <id>                      Bring a cloud builder's branch into its worktree, run the required checks
                                        here, and move the task to review: what acc sync does on its own once the
                                        builder's last commit carries Acc-Done: <id>`,
  },
  options: {
    routine: { type: 'string' },
    'default-place': { type: 'string' },
    max: { type: 'string' },
    'quiet-minutes': { type: 'string' },
    review: { type: 'string' },
    forget: { type: 'boolean', default: false },
    'from-env': { type: 'boolean', default: false },
  },
  subcommands: { cloud: ['status', 'enable', 'disable', 'token', 'guard'] },
  commands: {
    cloud: (o, rest) => {
      const sub = rest[0] ?? 'status';
      if (sub === 'status') return cmdStatus(o);
      if (sub === 'enable') return cmdEnable(o);
      if (sub === 'disable') return cmdDisable(o);
      if (sub === 'token') return cmdToken(o);
      if (sub === 'guard') return cmdGuard(o, rest[1]);
      throw new AccError('usage', 'acc cloud [status|enable|disable|token|guard]');
    },
    collect: (o, rest) => cmdCollect(o, rest[0]),
  },
};
