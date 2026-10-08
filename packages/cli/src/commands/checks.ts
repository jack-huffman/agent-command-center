// acc's Checks commands: gate run, list and waive, and drift.

import { AccError, type ApexTest, builderGatesFor, drift, fullGates, gatesFor, gateTarget, readLedger, receiptsAt, requiredGates, run, runGates, satisfies, waiveGates } from '../../../core/src/index.ts';
import { gateLabel, table, tone } from '../format.ts';
import { actorFrom, type CommandArea, now, type Opts, out, project } from '../shared.ts';

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
  const { paths, config, env, branch, task } = checkTarget(o);
  const say = (line: string) => { if (!o.json) process.stderr.write(line + '\n'); };
  const r = runGates(paths, config, env, names, apexTests(o), {
    run, now, ...(task ? { task: task.id } : {}),
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
  // Where the merge queue runs the full check, builders run the lighter ones (GH-73).
  const lighter = builderGatesFor(config, env.branch);
  const builder = requiredGates(config, env.branch, 'builder');
  const full = fullGates(config);
  const gates = gatesFor(config).map((g) => ({ name: g.name, about: g.about, required: full.includes(g.name), builder: builder.includes(g.name), heavy: g.heavy, receipt: receipts[g.name] ?? null }));
  out(o, () => gates.length
    ? [`${branch ?? 'HEAD'} at ${head.slice(0, 7)}, against ${env.name}`, '', table([['Gate', 'Required', ...(lighter ? ['Builder'] : []), 'Heavy', 'This commit', 'Checks'], ...gates.map((g) => [
      g.name, g.required ? 'yes' : '', ...(lighter ? [g.builder ? 'yes' : ''] : []), g.heavy ? 'yes' : '', g.receipt ? gateLabel(g.receipt.status).trimEnd() : tone('not run', 'dim'), g.about,
    ])]), ...(lighter ? ['', tone(`Builders run ${builder.join(', ')}, and acc done takes them. The required ones run once, in the merge queue, before the merge.`, 'dim')] : [])].join('\n')
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

export const area: CommandArea = {
  help: {
    section: 'Checks',
    order: 70,
    lines: `  acc gate run [<gate>...] [--test <ApexTest>=<why>]... [--env <name>] [--task <id>]
                                        Run the required checks (or the ones named) on this commit
  acc gate list [--env <name>] [--task <id>]
                                        The project's checks, and their results on this commit
  acc gate waive <gate>... --reason "<why>" [--task <id>]
                                        A person sets checks aside on this commit (or the task's), with a reason
  acc drift <environment> [--manifest <path>] [--keep]
                                        What changed in an org since its branch; prints nothing if none`,
  },
  options: {
    test: { type: 'string', multiple: true },
    env: { type: 'string' },
    task: { type: 'string' },
    reason: { type: 'string' },
    manifest: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
  commands: {
    gate: (o, rest) => {
      const [sub, ...names] = rest;
      if (sub === 'run') return cmdGateRun(o, names);
      if (sub === 'list') return cmdGateList(o);
      if (sub === 'waive') return cmdGateWaive(o, names);
      throw new AccError('usage', 'acc gate run [<gate>...] | acc gate list | acc gate waive <gate>... --reason "<why>"');
    },
    drift: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc drift <environment>');
      return cmdDrift(o, rest[0]);
    },
  },
};
