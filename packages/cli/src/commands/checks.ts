// acc's Checks commands: gate run, list and waive, and drift.

import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  AccError, type ApexTest, autoMergeFor, builderGatesFor, type Config, drift, FLOORS_FILE, fullGates, gatesFor, gateTarget, loadConfig, mainCheckout, mutate, num, ratchetOf, readFloors, readLedger,
  receiptsAt, relaxFloor, requiredGates, run, runGates, satisfies, setBuilderGates, setRequiredGates, STRAY_FILES, type Task, testsText, valueOf, waiveGates,
} from '../../../core/src/index.ts';
import { gateLabel, table, tone } from '../format.ts';
import { actorFrom, type CommandArea, noAgent, now, type Opts, out, project } from '../shared.ts';

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

/**
 * Whether acc gate run may write a better floor here (GH-99): in a task's own worktree, on the task's
 * branch. Never on an environment's branch, and never in the main checkout.
 */
function raisesHere(root: string, config: Config, branch: string | null, task: Task | null): boolean {
  if (!branch || !task?.run?.branch || branch !== task.run.branch) return false;
  if (config.environments.some((e) => e.branch === branch)) return false;
  try {
    return realpathSync(mainCheckout(run, root)) !== realpathSync(root);
  } catch {
    return false;
  }
}

function cmdGateRun(o: Opts, names: string[]): number {
  const { paths, config, env, branch, task } = checkTarget(o);
  const say = (line: string) => { if (!o.json) process.stderr.write(line + '\n'); };
  const r = runGates(paths, config, env, names, apexTests(o), {
    run, now, ...(task ? { task: task.id } : {}), raise: raisesHere(paths.root, config, branch, task),
    onStart: (g) => say(tone(`  … ${g.name}${g.heavy ? ' (heavy)' : ''}`, 'dim')),
    onWait: (g) => say(tone(`  … ${g.name} is waiting for another heavy check on this machine to finish`, 'dim')),
  });
  // A raised floor isn't a failure: it's a file to commit (GH-99).
  const bad = r.results.filter((x) => !satisfies(x) && !ratchetOf(x)?.raised);
  const raised = r.raised.map((x) => `${x.label} ${x.from === null ? `${num(x.to)}, its first floor` : `${num(x.from)} → ${num(x.to)}`}`);
  // A hold is cleared by more tests, or by a person (GH-100), not by fixing the change.
  const held = bad.filter((x) => x.status === 'hold');
  const fix = bad.filter((x) => x.status !== 'hold');
  out(o, () => [
    `${branch ?? 'HEAD'} at ${r.sha.slice(0, 7)}, against ${r.env.name}${r.env.org ? ` (${r.env.org})` : ''}`,
    ...r.results.flatMap((x) => [
      `  ${gateLabel(x.status)}${x.gate.padEnd(11)} ${x.summary}${testsText(x) ? tone(` · tests: ${testsText(x)}`, 'dim') : ''}`,
      ...(x.countsNote ? [tone(`      ${x.countsNote}`, 'dim')] : []),
    ]),
    r.dirty ? tone('Not recorded: there are uncommitted changes, so these results can\'t vouch for a commit. Commit, then run acc gate run again.', 'orange') : '',
    fix.length ? `${fix.length} to fix: ${fix.map((x) => x.gate).join(', ')}.` : '',
    held.length ? `${held.length} ${held.length === 1 ? 'needs' : 'need'} a person: ${held.map((x) => x.gate).join(', ')}. Add the tests, or un-skip them. If the task asks for the skip, say so with acc block "<why>": only a person can waive it.` : '',
    raised.length ? tone(`Raised in ${FLOORS_FILE}: ${raised.join(', ')}. Commit that file, then run acc gate run again: acc done takes the commit that records it.`, 'orange') : '',
    bad.length || raised.length || r.dirty ? '' : 'All recorded. acc done will accept this commit.',
  ].filter(Boolean).join('\n'), r);
  return bad.length || raised.length ? 1 : 0;
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

/**
 * A person relaxes a ratchet's floor, with a reason (GH-99): in the task's worktree with --task, else in
 * this checkout. A builder never can, as it can't waive (D-031): it would be lowering its own bar.
 */
function cmdGateRelax(o: Opts, names: string[]): number {
  if (process.env.ACC_ROLE === 'builder') throw new AccError('refused', 'A builder can\'t relax a floor. If this change has to make a number worse, say why with acc block "<why>", and a person decides.');
  const { actor, by } = actorFrom(o);
  if (actor !== 'human') throw new AccError('refused', 'Only a person can relax a floor.');
  const [name, ...extra] = names;
  if (!name || extra.length) throw new AccError('usage', 'acc gate relax <ratchet> --to <n> --reason "<why>" [--task <id>]');
  const to = typeof o.to === 'string' && o.to.trim() ? Number(o.to) : NaN;
  if (!Number.isFinite(to)) throw new AccError('usage', `--to takes the new floor, a number: acc gate relax ${name} --to <n> --reason "<why>".`);
  const { paths, config, task } = checkTarget(o);
  const where = o.task ? task?.run?.worktree : paths.root;
  if (!where || !existsSync(where)) throw new AccError('usage', `${task?.id ?? String(o.task)} has no worktree on disk, so there's no floors file to relax.`);
  const record = relaxFloor(paths.relaxed, join(where, FLOORS_FILE), where, config, { ratchet: name, to, reason: (o.reason as string | undefined) ?? '', by, now, ...(o.task && task ? { task: task.id } : {}) });
  if (o.task && task) {
    mutate(paths, now, (l, emit) => {
      const t = l.tasks.find((x) => x.id === task.id);
      if (!t) return;
      t.updatedAt = now().toISOString();
      emit({ type: 'task.updated', task: task.id, actor, by, data: { relaxed: { ratchet: record.ratchet, limit: record.limit, to: record.to, was: record.was, reason: record.reason } } });
    });
  }
  out(o, () => [
    `Relaxed ${name}'s ${record.limit} from ${record.was === null ? 'nothing' : num(record.was)} to ${num(record.to)} in ${join(where, FLOORS_FILE)}: ${record.reason}`,
    // As DESIGN §9 has it: a worse floor passes at the number relaxed to or a better one, from the floor relaxed.
    tone(`Commit that file with the change. ${record.was === null
      ? `A branch with no ${record.limit} where it began passes at ${num(record.to)} or a better number.`
      : `A branch that began at ${record.limit} ${num(record.was)} now passes with its ${record.limit} at ${num(record.to)} or a better one, as acc's record of this relax says. One that began at another ${record.limit} isn't backed by it.`}`, 'dim'),
  ].join('\n'), record);
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
  // A ratchet's floor (GH-99), as this checkout's floors file has it.
  let floors: ReturnType<typeof readFloors> = {};
  try {
    floors = readFloors(paths.floors);
  } catch {
    // A broken floors file is the ratchet's own error, when it runs.
  }
  const floorOf = (name: string): string => {
    const spec = config.gates.ratchets?.[name];
    if (!spec) return '';
    const v = valueOf(floors[name], spec.limit);
    return v === null ? `; no ${spec.limit} yet` : `; ${spec.limit} ${num(v)}`;
  };
  const full = fullGates(config);
  const gates = gatesFor(config).map((g) => ({ name: g.name, about: g.about + floorOf(g.name), required: full.includes(g.name), builder: builder.includes(g.name), heavy: g.heavy, receipt: receipts[g.name] ?? null }));
  // What each check's tests ran on this commit, where any counted (GH-100).
  const counted = gates.some((g) => g.receipt && testsText(g.receipt));
  out(o, () => gates.length
    ? [`${branch ?? 'HEAD'} at ${head.slice(0, 7)}, against ${env.name}`, '', table([['Gate', 'Required', ...(lighter ? ['Builder'] : []), 'Heavy', 'This commit', ...(counted ? ['Tests'] : []), 'Checks'], ...gates.map((g) => [
      g.name, g.required ? 'yes' : '', ...(lighter ? [g.builder ? 'yes' : ''] : []), g.heavy ? 'yes' : '', g.receipt ? gateLabel(g.receipt.status).trimEnd() : tone('not run', 'dim'), ...(counted ? [g.receipt ? testsText(g.receipt) : ''] : []), g.about,
    ])]), ...(lighter ? ['', tone(`Builders run ${builder.join(', ')}, and acc done takes them. The required ones run once, in the merge queue, before the merge.`, 'dim')] : [])].join('\n')
    : 'No gates. List commands under "gates.commands" (or numbers that may only get better under "gates.ratchets") in .acc/config.json, and the required ones under "gates.required".', { sha: head, env: env.branch, gates });
  return 0;
}

/** The environments whose pull requests go through the merge queue, where builders may run lighter checks (D-096). */
const queueEnvs = (config: Config): string[] => config.environments.filter((e) => autoMergeFor(config, e.branch)).map((e) => e.branch);

/** The checks every task must pass (gates.required): shown, or set by a person in .acc/config.json (GH-111). */
function cmdGateRequired(o: Opts, names: string[]): number {
  const { paths } = project(process.cwd());
  const show = (set: boolean) => {
    const { config } = loadConfig(paths.config);
    const queue = queueEnvs(config);
    // What every task must pass, stray-files with them unless it's off (GH-103).
    const required = fullGates(config);
    out(o, () => [
      required.length ? `${set ? 'Required checks are now' : 'Required checks'}: ${required.join(', ')}.` : 'No required checks: acc done takes any commit.',
      queue.length && required.length ? `Where the merge queue runs (${queue.join(', ')}), they run once in it, before each merge${config.gates.builder?.length ? `, and builders run ${config.gates.builder.join(', ')}` : ''}.` : '',
      set ? 'Set in .acc/config.json: commit it to share it.' : '',
    ].filter(Boolean).join(' '), { required, gates: gatesFor(config).map((g) => g.name).filter((g) => g !== STRAY_FILES), queue });
  };
  if (!names.length) {
    show(false);
    return 0;
  }
  noAgent(o, 'change the checks a task must pass');
  setRequiredGates(paths.config, names);
  show(true);
  return 0;
}

/**
 * Builders' lighter checks where the merge queue runs the required ones (gates.builder, D-096): shown, or set
 * by a person in .acc/config.json, or taken out with --none so builders run the required checks (GH-111).
 */
function cmdGateBuilder(o: Opts, names: string[]): number {
  const { paths } = project(process.cwd());
  const show = (set: boolean) => {
    const { config } = loadConfig(paths.config);
    const queue = queueEnvs(config);
    const builder = config.gates.builder?.length ? config.gates.builder : null;
    const full = fullGates(config);
    const required = full.join(', ') || 'none';
    out(o, () => [
      !builder
        ? `${set ? 'Builders now run' : 'Builders run'} the required checks (${required}): no lighter ones are named.`
        : queue.length
          ? `${set ? 'Builders now run' : 'Builders run'} ${builder.join(', ')} where the merge queue runs (${queue.join(', ')}), and the required checks (${required}) run once in it, before each merge.`
          : `gates.builder names ${builder.join(', ')}${set ? ' now' : ''}, but no environment's pull requests go through the merge queue (auto-merge, under autonomy review), so builders run the required checks (${required}).`,
      set ? 'Set in .acc/config.json: commit it to share it.' : '',
    ].filter(Boolean).join(' '), { builder, required: full, queue, gates: gatesFor(config).map((g) => g.name).filter((g) => g !== STRAY_FILES) });
  };
  if (!names.length && o.none !== true) {
    show(false);
    return 0;
  }
  if (names.length && o.none === true) throw new AccError('usage', 'acc gate builder <name>…, or acc gate builder --none: not both.');
  noAgent(o, 'change the checks builders run');
  setBuilderGates(paths.config, o.none === true ? null : names);
  show(true);
  return 0;
}

function cmdDrift(o: Opts, envName: string): number {
  const { paths, config } = project(process.cwd());
  // Said once the environment is found, so a refusal is the only line it prints (GH-106).
  const onRetrieve = (env: { name: string }) => { if (!o.json) process.stderr.write(tone(`Retrieving the baseline from ${env.name}. This only reads the org.\n`, 'dim')); };
  const r = drift(paths, config, envName, { run, now, onRetrieve, onWait: () => { if (!o.json) process.stderr.write(tone('Waiting for another heavy check on this machine to finish…\n', 'dim')); } }, { manifest: o.manifest as string | undefined, keep: o.keep === true });
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
  acc gate relax <ratchet> --to <n> --reason "<why>" [--task <id>]
                                        A person relaxes a ratchet's floor here (or in the task's worktree), with a reason
  acc gate required [<gate>...]         The checks every task must pass; with names, set them in .acc/config.json.
                                        Where the merge queue runs, they run once in it, before each merge
  acc gate builder [<gate>...|--none]   Builders' lighter checks where the merge queue runs the required ones; with
                                        names, set them in .acc/config.json, or with --none take them out
  acc drift <environment> [--manifest <path>] [--keep]
                                        What changed in an org since its branch; prints nothing if none`,
  },
  options: {
    test: { type: 'string', multiple: true },
    env: { type: 'string' },
    task: { type: 'string' },
    reason: { type: 'string' },
    to: { type: 'string' },
    manifest: { type: 'string' },
    keep: { type: 'boolean', default: false },
    none: { type: 'boolean', default: false },
  },
  subcommands: { gate: ['run', 'list', 'waive', 'relax', 'required', 'builder'] },
  commands: {
    gate: (o, rest) => {
      const [sub, ...names] = rest;
      if (sub === 'run') return cmdGateRun(o, names);
      if (sub === 'list') return cmdGateList(o);
      if (sub === 'waive') return cmdGateWaive(o, names);
      if (sub === 'relax') return cmdGateRelax(o, names);
      if (sub === 'required') return cmdGateRequired(o, names);
      if (sub === 'builder') return cmdGateBuilder(o, names);
      throw new AccError('usage', 'acc gate run [<gate>...] | acc gate list | acc gate waive <gate>... --reason "<why>" | acc gate relax <ratchet> --to <n> --reason "<why>" | acc gate required [<gate>...] | acc gate builder [<gate>...|--none]');
    },
    drift: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc drift <environment>');
      return cmdDrift(o, rest[0]);
    },
  },
};
