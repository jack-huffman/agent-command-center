/**
 * The deploy gate (D-206): a Salesforce builder deploys its change to its environment's org, checks each
 * component is there, and runs the Apex tests it named in the org, before it hands back. Each Apex class and
 * trigger the change adds or changes must then reach the coverage floor in the org (T-159). It supersedes
 * D-011 for an environment that isn't protected: a builder validates, then deploys, through this gate only.
 * Where it goes is read from the project's settings in the main checkout, or committed on the environment's
 * branch (origin's copy first), never from the task's worktree, and Salesforce is asked which org that is before anything goes: a
 * production org is refused whatever the settings say. Two builders on one org take turns, with a lock per
 * org (by its username) beside the heavy-check slots, and a builder whose changed files another task in
 * flight also changes stops and waits until that task merges or is set aside, never deploying over its
 * work: the person's choice. A task in flight whose files can't be read stops it too. A real deploy stays a
 * person's everywhere else: a protected org, production, an environment-specific file, a deletion, and
 * `acc deploy` after a merge.
 */
import { join } from 'node:path';
import { changedApex, type ClassCoverage, coverageFloor, coverageQueryArgs, coverageWords, readCoverage, underFloor } from './apex-coverage.ts';
import type { Environment } from './config.ts';
import { DEPLOY_GATE } from './deploy-commands.ts';
import type { RunResult } from './exec.ts';
import { APEX, type ApexTest, deployProblems, type Exec, type Gate, type GateInput, type GateRunInfo, lastLine, listed, listLines, type Outcome, outcome, packageDirs, parseDeployJson, under } from './gates.ts';
import { recordDeployFailure } from './deploy-record.ts';
import { mutate, readLedger } from './ledger.ts';
import { parseOrgUrl } from './onboarding/helpers.ts';
import { inFlightFilesStrict, overlaps, sharedFiles, sharesWords, taskList, waitWords } from './overlap.ts';
import type { RepoPaths } from './paths.ts';
import { readReceipt, satisfies } from './receipts.ts';
import { heavyDir, withSlot } from './semaphore.ts';
import { sfComponent } from './sf-metadata.ts';
import { trustedSettings } from './trusted-settings.ts';
import type { TestCounts } from './test-counts.ts';
import { plural } from './text.ts';

/** A deploy a task made to its environment's org (D-206), kept on the task, so its ticket says "Deployed to <org>". */
export interface TaskDeploy {
  env: string;
  org: string;
  /** The org's username, as Salesforce said it before the deploy. Not kept by a deploy from before this was asked. */
  username?: string;
  /** The commit deployed. */
  sha: string;
  at: string;
  jobId: string | null;
  /** The source paths deployed. */
  paths: string[];
  /** Each component as a person reads it, "Apex Class: Foo"; a path the profile can't name is listed as itself. */
  components: string[];
  /** How many of the components the org listed after the deploy. The rest couldn't be checked. */
  verified: number;
  /** The Apex tests run in the org, or null when no Apex changed and none ran. */
  tests: DeployTests | null;
  /** A person's deploy of the ticket to a next environment (T-137): who said yes, to which check, and its pull request. */
  by?: string;
  checkId?: string;
  pr?: { number: number; url: string };
}

export interface DeployTests {
  names: string[];
  outcome: 'pass' | 'fail';
  ran: number;
  failed: number;
  /** The run's coverage as sf reports it, such as "87%", or null when it didn't say. */
  coverage: string | null;
  /**
   * Each Apex class and trigger the ticket changes, with its coverage in the org after the run, and the floor
   * each had to reach (T-159). Not kept by a deploy from before this was asked, nor when the tests failed.
   */
  classes?: ClassCoverage[];
  floor?: number;
}

/** The deploy's sf arguments: a real deploy of the changed source, with the named tests, or none when no Apex changed. */
export function deployGateArgs(org: string, source: string[], tests: ApexTest[]): string[] {
  return [
    'project', 'deploy', 'start', '--target-org', org, '--wait', '90', '--json',
    ...source.flatMap((f) => ['--source-dir', f]),
    '--test-level', tests.length ? 'RunSpecifiedTests' : 'NoTestRun',
    ...tests.flatMap((t) => ['--tests', t.name]),
  ];
}

// ---------------------------------------------------------------- which org that is, as Salesforce says

/** How Salesforce is asked which org an alias is: `sf org display`, which says its username and My Domain URL. */
export const orgDisplayArgs = (org: string): string[] => ['org', 'display', '--target-org', org, '--json'];

/** What Salesforce said an org is: its username, its id, its URL, and what kind of org the URL says (D-015). */
export interface OrgShown {
  username: string;
  id: string | null;
  instanceUrl: string;
  kind: ReturnType<typeof parseOrgUrl>['kind'];
}

/** Reads `sf org display --json`, or null when sf gave no org: not logged in, or no such alias. */
export function readOrgDisplay(r: RunResult): OrgShown | null {
  try {
    const j = parseDeployJson<{ status?: number; result?: { username?: string; id?: string; instanceUrl?: string } }>(r);
    const res = j.result;
    if (j.status !== 0 || !res || typeof res.username !== 'string' || typeof res.instanceUrl !== 'string') return null;
    return { username: res.username, id: typeof res.id === 'string' ? res.id : null, instanceUrl: res.instanceUrl, kind: parseOrgUrl(res.instanceUrl).kind };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- is it there

/** A deployed component the org can be asked for: its type, the name the org uses, and its paths. */
export interface DeployedComponent {
  type: string;
  label: string;
  name: string;
  paths: string[];
}

/** The deployed paths as components, each once, and the paths the salesforce profile can't name. */
export function deployedComponents(paths: string[]): { known: DeployedComponent[]; unknown: string[] } {
  const known = new Map<string, DeployedComponent>();
  const unknown: string[] = [];
  for (const p of paths) {
    const c = sfComponent(p);
    if (!c) {
      unknown.push(p);
      continue;
    }
    const key = `${c.type}:${c.name}`;
    const have = known.get(key);
    if (have) have.paths.push(p);
    else known.set(key, { type: c.type, label: c.label, name: c.name, paths: [p] });
  }
  return { known: [...known.values()], unknown };
}

/** A foldered type's folder is listed as a type of its own: a report folder isn't a report. */
const FOLDER_TYPES: Record<string, string> = { Report: 'ReportFolder', Dashboard: 'DashboardFolder', EmailTemplate: 'EmailFolder', Document: 'DocumentFolder' };

/** How the org is asked whether a component is there: `sf org list metadata`, by type, and by folder for a report, dashboard, email template or document. */
export function listMetadataArgs(org: string, c: Pick<DeployedComponent, 'type' | 'name'>): string[] {
  const folderType = FOLDER_TYPES[c.type];
  const folder = folderType && c.name.includes('/') ? c.name.slice(0, c.name.indexOf('/')) : null;
  const type = folderType && !folder ? folderType : c.type;
  return ['org', 'list', 'metadata', '--metadata-type', type, '--target-org', org, '--json', ...(folder ? ['--folder', folder] : [])];
}

/** The names `sf org list metadata --json` listed, or null when it gave no list. */
export function readListed(r: RunResult): string[] | null {
  try {
    const j = parseDeployJson<{ status?: number; result?: { fullName?: string }[] | { fullName?: string } }>(r);
    const list = Array.isArray(j.result) ? j.result : j.result ? [j.result] : null;
    return list && j.status === 0 ? list.map((m) => m.fullName).filter((n): n is string => typeof n === 'string') : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the tests, in the org

/** The Apex test run's sf arguments: the named classes, with coverage, waited for. */
export function apexTestArgs(org: string, tests: ApexTest[]): string[] {
  return ['apex', 'run', 'test', '--target-org', org, ...tests.flatMap((t) => ['--class-names', t.name]), '--result-format', 'json', '--code-coverage', '--wait', '60', '--json'];
}

interface ApexRunJson {
  status?: number;
  message?: string;
  result?: {
    summary?: { outcome?: string; testsRan?: number; passing?: number; failing?: number; skipped?: number; testRunCoverage?: string; testRunId?: string };
    tests?: { ApexClass?: { Name?: string }; MethodName?: string; Outcome?: string; Message?: string }[];
  };
}

/** What the org's test run came to, read from `sf apex run test --json`: null when sf gave no run. */
export function readApexRun(r: RunResult, names: string[]): { tests: DeployTests; counts: TestCounts; failures: string[]; runId: string | null } | null {
  let j: ApexRunJson;
  try {
    j = parseDeployJson<ApexRunJson>(r);
  } catch {
    return null;
  }
  const s = j.result?.summary;
  if (!s || typeof s.testsRan !== 'number') return null;
  const failed = s.failing ?? 0;
  const failures = (j.result?.tests ?? []).filter((t) => t.Outcome && t.Outcome !== 'Pass').map((t) => `${t.ApexClass?.Name ?? '?'}.${t.MethodName ?? '?'}: ${t.Message ?? t.Outcome}`);
  const tests: DeployTests = { names, outcome: failed === 0 && s.outcome !== 'Failed' ? 'pass' : 'fail', ran: s.testsRan, failed, coverage: typeof s.testRunCoverage === 'string' ? s.testRunCoverage : null };
  const counts: TestCounts = { run: s.testsRan, passed: s.passing ?? Math.max(s.testsRan - failed, 0), failed, skipped: s.skipped ?? 0, todo: 0, runner: 'apex' };
  return { tests, counts, failures, runId: s.testRunId ?? null };
}

// ---------------------------------------------------------------- taking turns, and the record

/**
 * Where an org's deploys take turns: a one-slot folder beside the heavy-check slots, named for the org's
 * username (never its alias, which any settings file can give any org). In acc's own slot folder, which no
 * environment variable and no caller moves: a builder's run can't choose another and dodge the lock.
 */
export const orgLockDir = (orgKey: string): string => join(heavyDir({}), 'orgs', orgKey.replace(/[^\w.-]+/g, '_'));

/** Keeps a deploy on its task (D-206), so the ticket's Changes say "Deployed to <org>". Nothing without a task. */
export function recordDeploy(paths: RepoPaths, now: () => Date, task: string | undefined, deploy: TaskDeploy): TaskDeploy | null {
  if (!task) return null;
  return mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === task);
    if (!t) return null;
    t.deploys = [...(t.deploys ?? []), deploy];
    emit({ type: 'task.updated', task: t.id, actor: 'builder', by: `builder:${t.id}`, data: { deploy } });
    return deploy;
  });
}

/** The latest deploy a task made to each org, newest first. */
export function latestDeploys(deploys: TaskDeploy[] | null | undefined): TaskDeploy[] {
  const latest = new Map<string, TaskDeploy>();
  for (const d of deploys ?? []) {
    const have = latest.get(d.org);
    if (!have || d.at >= have.at) latest.set(d.org, d);
  }
  return [...latest.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The words for a deploy's tests, as the receipt and the ticket say them: "2 tests passed in the org, 91%
 * coverage", then each changed class's figure: "; OrderService 88%, 4 lines not covered".
 */
export const testsWords = (t: DeployTests | null): string =>
  t ? (t.outcome === 'pass' ? `${plural(t.ran, 'test')} passed in the org${t.coverage ? `, ${t.coverage} coverage` : ''}${t.classes?.length ? `; ${t.classes.map(coverageWords).join('; ')}` : ''}` : `${plural(t.failed, 'test')} of ${t.ran} failed in the org`) : 'no tests: no Apex changed';

type DeployJson = { status?: number; message?: string; result?: Parameters<typeof deployProblems>[0] & { id?: string; success?: boolean; status?: string; numberComponentsTotal?: number } };

/** What the gate runs, once it's allowed to: which org, the other tasks, the deploy, the check that it's there, and the tests, one org at a time. */
function deploySteps(input: GateInput, run: GateRunInfo, exec: Exec, env: Environment, source: string[], tests: ApexTest[], floor: number): Outcome {
  const org = env.org!;
  const { pass, fail, error, listOf } = outcome;
  // Which org this really is: Salesforce says, whatever the settings say. Production is never a builder's.
  const shown = readOrgDisplay(exec('sf', orgDisplayArgs(org)));
  if (!shown) return error(`Couldn't ask Salesforce which org ${org} is (sf org display): is it logged in on this machine? Nothing was deployed.`);
  if (shown.kind === 'production') return error(`${org} is a production org (${shown.username} at ${shown.instanceUrl}), whatever the settings say. A builder never deploys to production (D-018): nothing was deployed.`);
  const orgDetails = { org, username: shown.username, orgId: shown.id, instanceUrl: shown.instanceUrl, orgKind: shown.kind };
  // Another task in flight changes a file this one does: stop, and never deploy over its work (the person's choice).
  // One whose files can't be read stops it too: a deploy never goes over work it couldn't see.
  const flying = inFlightFilesStrict(run.paths, readLedger(run.paths.ledger), run.runner, { except: run.task });
  if (flying.unreadable.length) {
    return error(`Couldn't read what ${taskList(flying.unreadable.map((u) => u.task))} changed, so this deploy can't tell whether it would go over their work: ${flying.unreadable.map((u) => `${u.task}, ${u.why}`).join('; ')}. Nothing was deployed. Run acc gate run deploy again once their branches are here, or block and say so: acc block "Waiting to deploy: can't read ${taskList(flying.unreadable.map((u) => u.task))}'s changes"`);
  }
  const shares = overlaps(input.changes.files, flying.shares, sharedFiles(input.config));
  if (shares.length) {
    const who = taskList(shares.map((s) => s.task));
    return fail(`${waitWords(shares)}. Deploying now would put this branch's copy over ${who}'s work in ${org}. Wait until ${who} ${shares.length === 1 ? 'merges or is' : 'merge or are'} set aside, then run acc gate run deploy again. If that's long, block and say so: acc block "Waiting to deploy: ${sharesWords(shares)}"`, { ...orgDetails, waitsFor: shares });
  }
  const owner = { what: `Deploy to ${org}`, ...(run.task ? { task: run.task } : {}), env: env.branch, project: input.config.project, cwd: input.root };
  const lock = { dir: orgLockDir(shown.username), slots: 1, owner, onWait: run.onWait, ...(run.slots?.timeoutMs !== undefined ? { timeoutMs: run.slots.timeoutMs } : {}), ...(run.slots?.pollMs !== undefined ? { pollMs: run.slots.pollMs } : {}) };
  return withSlot(() => {
    const r = exec('sf', deployGateArgs(org, source, tests));
    let read: DeployJson;
    try {
      read = parseDeployJson<DeployJson>(r);
    } catch {
      return error(lastLine(r.stderr || r.stdout) || `sf exited with ${r.code} and printed no JSON.`);
    }
    const res = read.result;
    if (!res?.id) return error(read.message?.trim() || lastLine(r.stderr) || 'sf returned no deploy result.');
    const details: Record<string, unknown> = { jobId: res.id, ...orgDetails, testLevel: tests.length ? 'RunSpecifiedTests' : 'NoTestRun', tests };
    if (!res.success) {
      const problems = deployProblems(res);
      const why = problems.length ? `The deploy to ${org} failed (job ${res.id}), ${plural(problems.length, 'problem')}: ${listOf(problems, 2)}` : (read.message?.trim() || `The deploy to ${org} ${res.status ?? 'failed'} (job ${res.id}).`);
      // Kept on the task (T-167), so its environment's row says the deploy failed, and why.
      recordDeployFailure(run.paths, run.now, run.task, { env: env.branch, org, at: run.now().toISOString(), reason: why });
      return fail(why, { ...details, problems });
    }
    // It's in the org: each component the profile can name is asked for by type; one the org doesn't list is a failure.
    const { known, components, verified, unchecked, missing } = askOrgFor(exec, org, source);
    Object.assign(details, { components, verified, unchecked, missing });
    const at = run.now().toISOString();
    const record = (t: DeployTests | null) => recordDeploy(run.paths, run.now, run.task, { env: env.branch, org, username: shown.username, sha: run.sha, at, jobId: res.id!, paths: source, components, verified, tests: t });
    // The named tests run in the org, where the change now is: what they find is the deploy's result too.
    let ran: ReturnType<typeof readApexRun> = null;
    if (tests.length) {
      const t = exec('sf', apexTestArgs(org, tests));
      ran = readApexRun(t, tests.map((x) => x.name));
      if (!ran) {
        record(null);
        return error(`Deployed to ${org} (job ${res.id}), but the test run gave no result: ${lastLine(t.stderr || t.stdout) || `sf exited with ${t.code}`}.`);
      }
      // Each class and trigger the ticket changes, as the org covers it now: the deploy cleared what it had before.
      const apex = ran.tests.outcome === 'pass' ? changedApex(input.root, source) : [];
      if (apex.length) {
        const names = apex.map((a) => a.name);
        let q = exec('sf', coverageQueryArgs(org, names));
        let classes = readCoverage(q, names);
        // The Tooling API may refuse Coverage on several rows at once: ask for one class at a time instead.
        if (!classes && names.length > 1) {
          const each: ClassCoverage[] = [];
          for (const name of names) {
            q = exec('sf', coverageQueryArgs(org, [name]));
            const one = readCoverage(q, [name]);
            if (!one) { each.length = 0; break; }
            each.push(...one);
          }
          if (each.length === names.length) classes = each;
        }
        if (!classes) {
          record(ran.tests);
          return withCountsOf(ran, error(`Deployed to ${org} (job ${res.id}) and the tests passed, but the org gave no coverage for ${listOf(apex.map((a) => a.name))}: ${lastLine(q.stderr || q.stdout) || `sf exited with ${q.code}`}.`));
        }
        ran.tests = { ...ran.tests, classes, floor };
      }
      Object.assign(details, { testRun: { id: ran.runId, ...ran.tests, failures: ran.failures } });
    }
    record(ran?.tests ?? null);
    const withCounts = (o: Outcome): Outcome => withCountsOf(ran, o);
    const n = res.numberComponentsTotal ?? known.length;
    if (missing.length) return withCounts(fail(`Deployed ${plural(n, 'component')} to ${org} (job ${res.id}), but the org doesn't list ${listOf(missing)}. Check the org, and the component's name in its source.`, details));
    if (ran && ran.tests.outcome !== 'pass') return withCounts(fail(`Deployed ${plural(n, 'component')} to ${org} (job ${res.id}), but ${plural(ran.tests.failed, 'test')} failed in the org: ${listOf(ran.failures, 2)}`, details));
    // A changed class or trigger under the floor: name each, with its figure and its lines, so the builder can add tests.
    const short = underFloor(ran?.tests.classes ?? [], floor);
    if (short.length) return withCounts(fail(`Deployed ${plural(n, 'component')} to ${org} (job ${res.id}) and the tests passed, but ${short.length === 1 ? 'a changed class is' : `${short.length} changed classes are`} under the ${floor}% coverage floor: ${short.join('; ')}. Add tests that cover those lines, name them with --test, and run acc gate run deploy again.`, details));
    const checked = unchecked.length ? `, ${plural(unchecked.length, 'component')} acc couldn't ask the org for` : '';
    return withCounts(pass(`Deployed ${plural(n, 'component')} to ${org} (job ${res.id}): ${verified} listed in the org${checked}; ${testsWords(ran?.tests ?? null)}.`, details));
  }, lock);
}

/** An outcome with the test run's counts, when there was a run. */
const withCountsOf = (ran: { counts: TestCounts } | null, o: Outcome): Outcome => (ran ? { ...o, counts: ran.counts } : o);

/** What the org lists of a deploy's components, by asking it for each one's type: those it lists, those it doesn't, and those acc can't ask for. */
export function askOrgFor(exec: (cmd: string, args: string[]) => RunResult, org: string, source: string[]): { known: DeployedComponent[]; components: string[]; verified: number; unchecked: string[]; missing: string[] } {
  const { known, unknown } = deployedComponents(source);
  const missing: string[] = [];
  const unchecked: string[] = [...unknown];
  const listedNames = new Map<string, string[] | null>();
  for (const c of known) {
    const args = listMetadataArgs(org, c);
    const key = args.join(' ');
    if (!listedNames.has(key)) listedNames.set(key, readListed(exec('sf', args)));
    const names = listedNames.get(key)!;
    if (names === null) unchecked.push(`${c.label}: ${c.name}`);
    else if (!names.includes(c.name)) missing.push(`${c.label}: ${c.name}`);
  }
  const components = [...known.map((c) => `${c.label}: ${c.name}`), ...unknown];
  return { known, components, verified: known.length - missing.length - (unchecked.length - unknown.length), unchecked, missing };
}

/**
 * Why a builder's own run mustn't deploy to the environment it names, or null when it may: a task deploys only
 * to its own environment, the one it builds from and lands on, never one chosen with --env (D-206).
 */
export function deployEnvProblem(task: { id: string; environment: string } | null, env: { name: string; branch: string }): string | null {
  if (!task) return null;
  return task.environment === env.branch ? null
    : `${task.id} builds on ${task.environment}, so it deploys only to that environment's org, never to ${env.name}. Nothing was deployed.`;
}

/** Where the deploy gate runs, said by the skip every other run records (D-206). */
export const DEPLOY_ELSEWHERE = 'the task\'s own worktree, on its branch, with acc gate run deploy';

/**
 * The gate. A run that isn't the builder's own (a refresh, a verify, the merge queue) skips; a cloud collect
 * is the task's own run, and deploys. One that isn't saying where it runs: the skip satisfies that run, never acc done. The builder's own run
 * decides without deploying where it mustn't: settings it can't read, no org, a protected or production
 * environment, an environment-specific file, a deletion, Apex without its tests, an uncommitted tree, or
 * validate not passed on this commit.
 */
export const deployGate: Gate = {
  name: DEPLOY_GATE, heavy: true, changeBound: true, about: 'deploys changed source to the environment\'s org, checks it\'s there, runs the named Apex tests in the org, and holds each changed Apex class to the coverage floor',
  plan(input) {
    const { root, changes, tests, run } = input;
    const { fail, error, skip, listOf } = outcome;
    if (!run?.deploys) return { outcome: { ...skip(`Not run here: a builder deploys from ${DEPLOY_ELSEWHERE}. This run checks without deploying, and acc done still waits for that deploy.`), elsewhere: DEPLOY_ELSEWHERE } };
    // Where it goes: the project's settings, never this worktree's copy of them.
    const trusted = trustedSettings(run, input.env);
    if ('problem' in trusted) return { outcome: error(`${trusted.problem} Nothing was deployed.`) };
    const env = trusted.config.environments.find((e) => e.branch === input.env.branch);
    if (!env) return { outcome: error(`${input.env.name} isn't an environment in ${trusted.from}, so there's nowhere to deploy.`) };
    if (!env.org) return { outcome: error(`${env.name} has no org alias in ${trusted.from}, so there's nowhere to deploy.`) };
    if (env.type === 'production' || env.protected) {
      return { outcome: error(`${env.name} is ${env.type === 'production' ? 'production' : 'protected'} in ${trusted.from}. A builder deploys only to its own unprotected build org (D-018); a protected org gets its deploy after a person merges, with acc deploy.`) };
    }
    // Environment-specific files, as this branch lists them and as the project's trusted copy of the list does (D-016).
    const trustedList = trusted.config.environmentSpecific ? listLines(trusted.read(trusted.config.environmentSpecific) ?? '') : [];
    const envSpecific = [...new Set([...changes.envSpecific, ...changes.files.filter((f) => listed(f, trustedList))])];
    if (envSpecific.length) {
      return { outcome: fail(`This branch changes environment-specific files, which differ by design in every org and are never deployed by a task (D-016): ${listOf(envSpecific)}. Undo those changes.`) };
    }
    if (changes.deleted.length) {
      return { outcome: fail(`Deletions (and renames) stay a person's: ${listOf(changes.deleted)}. acc never deploys a deletion. Restore them, or block the task and say what should be deleted.`) };
    }
    const source = under(changes.files, packageDirs(root));
    if (!source.length) return { outcome: skip('No Salesforce source has changed, so there\'s nothing to deploy.') };
    const apex = source.filter((f) => APEX.test(f));
    if (apex.length && !tests.length) {
      return { outcome: fail(`Apex changed (${listOf(apex)}). Name the test classes that cover it, as validate asks: acc gate run deploy --test <TestClass>="<why it covers the change>"`) };
    }
    if (run.dirty) return { outcome: fail('There are uncommitted changes. What goes to the org must be what\'s committed: commit, then run acc gate run deploy again.') };
    if (!satisfies(readReceipt(run.paths, run.sha, 'validate'))) return { outcome: fail('validate hasn\'t passed on this commit. Run acc gate run validate first: a deploy follows a check-only one.') };
    return { tests: tests.length > 0, steps: (exec) => deploySteps(input, run, exec, env, source, tests, coverageFloor(trusted.config)) };
  },
};
