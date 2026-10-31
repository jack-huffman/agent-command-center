import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parseConfig, type Config, type Environment } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { manifestXml } from '../src/manifest.ts';
import { repoPaths } from '../src/paths.ts';
import { sfComponent } from '../src/sf-metadata.ts';
import { listLinesAt, taskDeployRoute, ticketPlace } from '../src/task-deploy.ts';
import * as real from '../src/where.ts';
import { componentWords, readGit, readingOf, readOrg, recordedAt, sameText, ticketWork, WHERE_COMMAND, whereEnabled, whereIs, whereNotes, whereRetrieveArgs, whereWords } from '../src/where.ts';
import { type EnvWhere, furthestRead, isAfter, keepWhere, pathFrom, readWhere, ticketEnvironments, WHERE_MAX_AGE_MS, WHERE_STATES, whereDue, wherePath } from '../src/where-kept.ts';
import { whereLines } from '../../cli/src/commands/where.ts';
import { gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

type Mod = typeof real;
const now = () => new Date('2026-10-30T12:00:00Z');
const D = 'force-app/main/default';
const INVOICE = `${D}/classes/Invoice.cls`;
const HELPER = `${D}/classes/Helper.cls`;
const OLD = `${D}/classes/Old.cls`;
const SPECIFIC = `${D}/namedCredentials/Api.namedCredential-meta.xml`;
const config = (over: Record<string, unknown> = {}): Config => {
  const r = parseConfig({ ...SF_CONFIG, ...over });
  assert.deepEqual(r.errors, []);
  return r.config!;
};
const write = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

/** The ticket's content: what the org holds when the ticket is there. */
const ITS = { [INVOICE]: 'public class Invoice {}\n', [HELPER]: 'public class Helper {}\n' };

/**
 * production, uat and dev on a bare origin. On dev, ACME-1 adds Invoice.cls and Helper.cls, deletes Old.cls,
 * and changes the environment-specific named credential and a note; it's merged (squash). Someone cherry-picked
 * its commit onto uat by hand, outside acc, so uat holds its content under another commit id. production has none of it.
 */
function repo() {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }),
    'manifest/environment-specific.txt': `${SPECIFIC}\n`,
    [OLD]: 'public class Old {}\n',
    [SPECIFIC]: '<url>https://prod</url>\n',
    'NOTES.md': 'notes\n',
  });
  gitIn(dir, 'branch', '-M', 'production');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  for (const b of ['uat', 'dev']) gitIn(dir, 'branch', b);
  gitIn(dir, 'checkout', '-q', 'dev');
  for (const [f, text] of Object.entries(ITS)) write(dir, f, text);
  rmSync(join(dir, OLD));
  write(dir, SPECIFIC, '<url>https://dev</url>\n');
  write(dir, 'NOTES.md', 'notes, and ACME-1\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'ACME-1 (#1)');
  const one = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'checkout', '-q', 'uat');
  write(dir, 'README.md', '# uat\n');
  gitIn(dir, 'commit', '-q', '-am', 'UAT\'s own note');
  gitIn(dir, 'cherry-pick', one);
  const picked = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'checkout', '-q', 'dev');
  gitIn(dir, 'push', '-q', 'origin', 'production', 'uat', 'dev');
  const paths = repoPaths(dir, run);
  const c = config();
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, [{ source: { kind: 'jira' as const, key: 'ACME-1', url: 'https://acme.atlassian.net/browse/ACME-1' }, title: 'Invoices', environment: 'dev' }], 'human', 'human:test', emit, now);
    Object.assign(l.tasks.find((t) => t.id === 'ACME-1')!, { state: 'done', pr: { number: 1, url: 'https://github.com/acme-co/acme-salesforce/pull/1', state: 'merged', mergeSha: one } });
  });
  return { dir, origin, paths, c, one, picked };
}

/** Each org's fixed answer: the files a retrieve writes, the names it lists, and whether it's logged in. */
type Org = { files?: Record<string, string>; listed?: string[]; away?: boolean; silent?: boolean };
const ANSWER = (over: Record<string, Org> = {}): Record<string, Org> => ({
  'Acme Dev': { files: ITS, listed: [] },
  'Acme UAT': { files: ITS, listed: [] },
  'Acme Production': { away: true },
  ...over,
});

/** Salesforce's CLI, faked from each org's fixed answer; git is real. Each sf call is kept, with the folder it ran in. */
function fake(orgs: Record<string, Org>, calls: { line: string; cwd: string }[]) {
  const sfSays = (o: unknown): RunResult => ok(JSON.stringify(o));
  return (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd === 'git') return run(cmd, args, opts);
    calls.push({ line: `${cmd} ${args.join(' ')}`, cwd: opts?.cwd ?? '' });
    const sub = args.slice(0, 3).join(' ');
    const flag = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]!] : []));
    const org = orgs[flag('--target-org')[0] ?? ''] ?? {};
    if (sub === 'org display --target-org') return org.away ? { code: 1, stdout: JSON.stringify({ status: 1, message: 'No authorization information found' }), stderr: '' } : sfSays({ status: 0, result: { username: `${args[3]!.replace(/\s/g, '.')}@acme.test`, id: '00D1', instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' } });
    if (sub === 'project generate manifest') {
      const types = new Map<string, string[]>();
      for (const p of flag('--source-dir')) { const c = sfComponent(p)!; types.set(c.type, [...new Set([...(types.get(c.type) ?? []), c.name])]); }
      const file = join(flag('--output-dir')[0]!, 'package.xml');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, manifestXml([...types].map(([name, members]) => ({ name, members })), '62.0'));
      return sfSays({ status: 0, result: { path: file } });
    }
    if (sub === 'project retrieve start') {
      if (org.silent) return { code: 1, stdout: '', stderr: 'Error: socket hang up' };
      for (const [f, text] of Object.entries(org.files ?? {})) write(opts!.cwd!, f, text);
      return sfSays({ status: 0, result: { files: Object.keys(org.files ?? {}).map((filePath) => ({ filePath, state: 'Changed' })) } });
    }
    if (sub === 'org list metadata') return sfSays({ status: 0, result: (org.listed ?? []).map((fullName) => ({ fullName })) });
    return { code: 127, stdout: '', stderr: `no fixture for ${cmd} ${args.join(' ')}` };
  };
}

const deps = (orgs: Record<string, Org>, calls: { line: string; cwd: string }[] = []) => ({ run: fake(orgs, calls), now, slots: { dir: tempDir('slots-') }, orgLocks: tempDir('orgs-') });
const envOf = (w: { envs: EnvWhere[] }, b: string) => w.envs.find((e) => e.env === b)!;
const taskIn = (paths: ReturnType<typeof repoPaths>): Task => readLedger(paths.ledger).tasks.find((t) => t.id === 'ACME-1')!;

// ---------------------------------------------------------------- scenarios, run on acc's module and on a mutant

/** UAT's org holds Invoice as the ticket has it, and Helper as it was before: partly deployed, naming Helper alone. Returns what's wrong. */
function partlyNamesHelper(m: Mod): string[] {
  const { paths, c } = repo();
  const w = m.whereIs(paths, c, 'ACME-1', 'uat', deps(ANSWER({ 'Acme UAT': { files: { ...ITS, [HELPER]: 'public class Helper { /* older */ }\n' }, listed: [] } })));
  const u = envOf(w, 'uat');
  const wrong: string[] = [];
  if (u.state !== 'partly') wrong.push(`says ${u.state}`);
  if (u.differs.join() !== 'Apex Class: Helper') wrong.push(`names ${u.differs.join(', ') || 'nothing'}`);
  return wrong;
}

test('each environment on the path gets one state, read from git and its org, with when it was read', () => {
  const { paths, c } = repo();
  const calls: { line: string; cwd: string }[] = [];
  const w = whereIs(paths, c, 'ACME-1', undefined, deps(ANSWER(), calls));
  assert.deepEqual(w.envs.map((e) => [e.env, e.state]), [['dev', 'deployed'], ['uat', 'deployed'], ['production', 'unknown']]);
  for (const e of w.envs) assert.equal(e.at, now().toISOString(), `${e.env} keeps when it was read`);
  assert.ok(WHERE_STATES.includes(envOf(w, 'production').state));
  assert.deepEqual(readWhere(paths, 'ACME-1'), w, 'the readings are kept beside the ledger');
  assert.ok(wherePath(paths, 'ACME-1').startsWith(paths.stateDir));
});

test('a ticket cherry-picked onto a branch counts as there: git compares content, not commit ids', () => {
  const { paths, c, one, picked } = repo();
  assert.notEqual(one, picked, 'the cherry-pick made another commit');
  const work = ticketWork(run, paths.root, taskIn(paths));
  assert.equal(work.tip, one);
  assert.deepEqual(work.files.map((f) => [f.path, f.blob === null]).sort(), [[HELPER, false], [INVOICE, false], ['NOTES.md', false], [OLD, true], [SPECIFIC, false]].sort());
  const files = work.files.filter((f) => f.path !== SPECIFIC);
  assert.equal(readGit(run, paths.root, 'uat', files, now().toISOString()).state, 'deployed');
  const prod = readGit(run, paths.root, 'production', files, now().toISOString());
  assert.equal(prod.state, 'not-deployed');
  assert.deepEqual(prod.differs.sort(), ['Apex Class: Helper', 'Apex Class: Invoice', 'Apex Class: Old', 'NOTES.md'], 'production still has Old.cls, which the ticket deletes');
});

test('the org is read by retrieving only the ticket\'s components into a folder outside the repo, and nothing is deployed', () => {
  const { dir, paths, c } = repo();
  const calls: { line: string; cwd: string }[] = [];
  whereIs(paths, c, 'ACME-1', 'uat', deps(ANSWER(), calls));
  const retrieves = calls.filter((x) => x.line.startsWith('sf project retrieve start'));
  assert.equal(retrieves.length, 1);
  assert.ok(retrieves[0]!.cwd.startsWith(tmpdir()) && !retrieves[0]!.cwd.startsWith(dir), `retrieved in ${retrieves[0]!.cwd}`);
  const manifest = calls.find((x) => x.line.startsWith('sf project generate manifest'))!.line;
  assert.ok(manifest.includes(INVOICE) && manifest.includes(HELPER), 'its own components are in the manifest');
  assert.ok(!manifest.includes(SPECIFIC) && !manifest.includes('NOTES.md'), 'environment-specific and non-source files stay out');
  assert.deepEqual(calls.filter((x) => /deploy|delete/.test(x.line)), [], 'nothing deploys or deletes');
  assert.ok(!whereRetrieveArgs('Acme UAT', 'm.xml').includes('deploy'));
  assert.equal(gitIn(dir, 'status', '--porcelain'), '', 'the main checkout is untouched');
  assert.equal(gitIn(dir, 'worktree', 'list').split('\n').length, 1, 'the scratch worktree is gone');
});

test('a partly deployed state names each component that differs', () => {
  assert.deepEqual(partlyNamesHelper(real), []);
});

test('an org that lacks the ticket\'s components, and still lists one it deletes, is not deployed', () => {
  const { paths, c } = repo();
  const w = whereIs(paths, c, 'ACME-1', 'uat', deps(ANSWER({ 'Acme UAT': { files: {}, listed: ['Old'] } })));
  const u = envOf(w, 'uat');
  assert.equal(u.state, 'not-deployed');
  assert.deepEqual(u.differs.sort(), ['Apex Class: Helper', 'Apex Class: Invoice', 'Apex Class: Old']);
  assert.ok(u.notes.some((n) => /branch holds it, but UAT's org doesn't/.test(n)), u.notes.join(' '));
});

test('a cannot-tell state says why in words: no org, not logged in, no access to Production, Salesforce not answering', () => {
  const { paths } = repo();
  const noOrg = config({ environments: SF_CONFIG.environments.map((e) => (e.name === 'UAT' ? { ...e, org: undefined } : e)) });
  const why = (cfg: Config, orgs: Record<string, Org>, env: string) => envOf(whereIs(paths, cfg, 'ACME-1', env, deps(orgs)), env).why;
  assert.equal(why(noOrg, ANSWER(), 'uat'), 'UAT has no org in the project\'s settings.');
  assert.equal(why(config(), ANSWER({ 'Acme UAT': { away: true } }), 'uat'), 'Acme UAT isn\'t logged in on this machine.');
  assert.equal(why(config(), ANSWER(), 'production'), 'This machine has no access to Production: Acme Production isn\'t logged in here.');
  assert.match(why(config(), ANSWER({ 'Acme UAT': { silent: true } }), 'uat')!, /^Salesforce didn't answer for Acme UAT: Error: socket hang up/);
  const w = readWhere(paths, 'ACME-1')!;
  assert.equal(envOf(w, 'uat').git.state, 'deployed', 'git is still read when the org can\'t be');
});

test('environment-specific files are left out of both readings, and said', () => {
  const { paths, c } = repo();
  const u = envOf(whereIs(paths, c, 'ACME-1', 'uat', deps(ANSWER())), 'uat');
  assert.deepEqual(u.leftOut, [SPECIFIC]);
  assert.match(whereWords(u), /Environment-specific, left out: .*Api\.namedCredential-meta\.xml/);
  assert.deepEqual(listLinesAt(run, paths.root, 'origin/uat', 'manifest/environment-specific.txt'), [SPECIFIC]);
  assert.deepEqual(listLinesAt(run, paths.root, 'origin/uat', 'manifest/none.txt'), [], 'a list the branch lacks is empty');
});

test('work that reached an org outside acc moves where the ticket is now, and its next deploy', () => {
  const { paths, c } = repo();
  const t = taskIn(paths);
  assert.equal(ticketPlace(c, t)!.at.name, 'Dev', 'acc\'s own records alone');
  const w = whereIs(paths, c, 'ACME-1', undefined, deps(ANSWER()));
  assert.equal(ticketPlace(c, t, w)!.at.name, 'UAT');
  assert.equal(taskDeployRoute(c, { ...t, id: 'ACME-1' }, undefined, w).to.name, 'Production');
  assert.ok(envOf(w, 'uat').notes.some((n) => /no deploy of it on record/.test(n)));
});

test('a reading never takes the ticket back: acc\'s record still counts, and the disagreement is said', () => {
  const { paths, c } = repo();
  mutate(paths, now, (l, emit) => {
    l.tasks.find((t) => t.id === 'ACME-1')!.promotions = [{ from: 'dev', to: 'uat', pr: { number: 7, url: 'https://github.com/acme-co/acme-salesforce/pull/7' }, state: 'merged', at: '2026-10-28T09:00:00Z', mergedAt: '2026-10-28T09:00:00Z' }];
    emit({ type: 'task.updated', task: 'ACME-1', actor: 'human', by: 'human:test', data: {} });
  });
  const t = taskIn(paths);
  const w = whereIs(paths, c, 'ACME-1', 'uat', deps(ANSWER({ 'Acme UAT': { files: {}, listed: ['Old'] } })));
  assert.equal(ticketPlace(c, t, w)!.at.name, 'UAT');
  assert.deepEqual(envOf(w, 'uat').notes.filter((n) => n.startsWith('Its deploy record')), ['Its deploy record says it reached UAT on 2026-10-28, but the org doesn\'t hold it now.']);
  assert.equal(recordedAt(t, 'uat'), '2026-10-28T09:00:00Z');
  assert.equal(recordedAt(t, 'production'), null);
});

test('an environment off the ticket\'s path is refused, and one read keeps the others', () => {
  const { paths, c } = repo();
  whereIs(paths, c, 'ACME-1', undefined, deps(ANSWER()));
  const later = () => new Date('2026-10-30T13:00:00Z');
  whereIs(paths, c, 'ACME-1', 'uat', { ...deps(ANSWER()), now: later });
  const w = readWhere(paths, 'ACME-1')!;
  assert.deepEqual(w.envs.map((e) => [e.env, e.at]).sort(), [['dev', now().toISOString()], ['production', now().toISOString()], ['uat', later().toISOString()]]);
  const other = config({ environments: [...SF_CONFIG.environments, { name: 'QA', type: 'partial', org: 'Acme QA' }] });
  assert.throws(() => whereIs(paths, other, 'ACME-1', 'qa', deps(ANSWER())), /QA isn't on ACME-1's path: Dev, UAT, Production/);
});

test('the command has an id, its params, and an enabled rule that says why it can\'t run', () => {
  assert.equal(WHERE_COMMAND.id, 'acc.task.where');
  assert.match(WHERE_COMMAND.params, /task's id/);
  const c = config();
  const t = { id: 'ACME-1', environment: 'dev', pr: { state: 'merged' }, run: null } as unknown as Task;
  assert.deepEqual(WHERE_COMMAND.enabled({ config: c, task: t }), { ok: true });
  assert.match((WHERE_COMMAND.enabled({ config: config({ profile: 'generic' }), task: t }) as { why: string }).why, /isn't a Salesforce project/);
  assert.deepEqual(whereEnabled(c, undefined), { ok: false, why: 'There\'s no such task.' });
  assert.match((whereEnabled(c, { ...t, pr: null }) as { why: string }).why, /has no work yet/);
  assert.match((whereEnabled(c, { ...t, environment: 'nowhere' }) as { why: string }).why, /isn't in the project's settings/);
});

test('the command\'s JSON is the readings, and its lines say each state', () => {
  const { paths, c } = repo();
  const w = whereIs(paths, c, 'ACME-1', undefined, deps(ANSWER()));
  assert.deepEqual(JSON.parse(JSON.stringify(w)), w);
  const lines = whereLines(w).join('\n');
  assert.match(lines, /Dev: deployed/);
  assert.match(lines, /Production: can't tell\. This machine has no access to Production/);
  assert.match(lines, /Read 2026-10-30 12:00/);
});

test('a reading is due before the first, when it\'s old, and after a deploy acc recorded since', () => {
  const at = now().toISOString();
  const r: EnvWhere = { env: 'uat', name: 'UAT', state: 'deployed', differs: [], why: null, at, git: readingOf([], at), org: readingOf([], at), leftOut: [], unchecked: [], notes: [] };
  const w = { v: 1 as const, task: 'ACME-1', envs: [r] };
  assert.deepEqual(whereDue(null, {}, ['uat'], now()), ['uat'], 'none yet');
  assert.deepEqual(whereDue(w, {}, ['uat', 'production'], now()), ['production']);
  assert.deepEqual(whereDue(w, {}, ['uat'], new Date(now().getTime() + WHERE_MAX_AGE_MS + 1)), ['uat'], 'too old');
  const deployed = { deploys: [{ env: 'uat', at: '2026-10-30T12:30:00Z' }] } as unknown as Task;
  assert.deepEqual(whereDue(w, deployed, ['uat'], new Date('2026-10-30T12:31:00Z')), ['uat'], 'a deploy since');
});

test('kept readings that are missing or not acc\'s read as none', () => {
  const stateDir = tempDir('state-');
  assert.equal(readWhere({ stateDir }, 'ACME-1'), null, 'before the first');
  mkdirSync(join(stateDir, 'where'), { recursive: true });
  writeFileSync(wherePath({ stateDir }, 'ACME-1'), '{"v":2}');
  assert.equal(readWhere({ stateDir }, 'ACME-1'), null);
  keepWhere({ stateDir }, 'ACME-1', []);
  assert.deepEqual(readWhere({ stateDir }, 'ACME-1'), { v: 1, task: 'ACME-1', envs: [] });
  assert.ok(readFileSync(wherePath({ stateDir }, 'ACME-1'), 'utf8').endsWith('\n'));
});

test('a reading with nothing to compare can\'t tell, and a component counts only when all its files match', () => {
  assert.equal(readingOf([], 'x').state, 'unknown');
  assert.deepEqual(readingOf([{ path: INVOICE, same: true }, { path: `${INVOICE}-meta.xml`, same: false }], 'x'), { state: 'not-deployed', differs: ['Apex Class: Invoice'], why: null, at: 'x' });
  assert.equal(componentWords('NOTES.md'), 'NOTES.md');
  assert.ok(sameText('a\r\nb\n', 'a\nb'), 'line endings and a trailing newline don\'t count');
  assert.ok(!sameText('a', 'b'));
});

test('the path, what comes after, and the furthest reading', () => {
  const c = config();
  assert.deepEqual(pathFrom(c.environments, 'dev').map((e) => e.branch), ['dev', 'uat', 'production']);
  assert.deepEqual(pathFrom(c.environments, 'nowhere'), []);
  const dev = c.environments.find((e) => e.branch === 'dev')!;
  const uat = c.environments.find((e) => e.branch === 'uat')!;
  assert.ok(isAfter(c, dev, 'production') && isAfter(c, uat, 'production'));
  assert.ok(!isAfter(c, uat, 'dev'), 'never backwards');
  const read = (env: string, state: EnvWhere['state']) => ({ env, state }) as EnvWhere;
  assert.equal(furthestRead(c, dev, { envs: [read('production', 'deployed'), read('uat', 'deployed')] }).branch, 'production');
  assert.equal(furthestRead(c, uat, { envs: [read('production', 'partly')] }).branch, 'uat', 'partly doesn\'t move it');
  assert.equal(furthestRead(c, dev, null).branch, 'dev');
});

test('a ticket\'s environments are its path, then each off the usual way it can still reach; edge case: none for an environment not in the settings (T-158)', () => {
  const env = (branch: string, promotesTo: string[], more: Partial<Environment> = {}): Environment => ({ name: branch.toUpperCase(), branch, type: 'sandbox', org: branch, default: false, protected: false, promotesTo, ...more } as Environment);
  const c = { environments: [env('dev', ['qa'], { default: true }), env('qa', ['uat', 'hotfix']), env('uat', ['production']), env('hotfix', []), env('production', [])] };
  assert.deepEqual(ticketEnvironments(c, 'dev').map((e) => e.branch), ['dev', 'qa', 'uat', 'production', 'hotfix']);
  assert.deepEqual(ticketEnvironments(c, 'uat').map((e) => e.branch), ['uat', 'production'], 'from UAT, Hotfix is behind it');
  assert.deepEqual(ticketEnvironments(c, 'nowhere'), []);
});

test('readOrg and whereNotes, called alone', () => {
  const { paths, c } = repo();
  const uat = c.environments.find((e) => e.branch === 'uat')!;
  const work = ticketWork(run, paths.root, taskIn(paths));
  const r = readOrg(deps(ANSWER()), paths, c, 'ACME-1', uat, work.tip, work.files.filter((f) => f.path === 'NOTES.md'));
  assert.equal(r.reading.why, 'None of its changes go to an org.');
  const at = now().toISOString();
  assert.deepEqual(whereNotes(taskIn(paths), uat, { state: 'not-deployed', differs: [], why: null, at }, { state: 'deployed', differs: [], why: null, at }), [
    'It\'s in UAT\'s org, with no deploy of it on record: it got there another way.',
    'It\'s in UAT\'s org, but the uat branch doesn\'t hold all of it.',
  ]);
});

// ---------------------------------------------------------------- mutants: the checks above catch them

/** where.ts with one change, imported from a folder of its own; its imports still reach acc's modules. */
async function mutant(from: string, to: string): Promise<Mod> {
  const src = new URL('../src/where.ts', import.meta.url);
  const text = readFileSync(src, 'utf8');
  assert.ok(text.includes(from), `the mutant's line is still in where.ts: ${from}`);
  const changed = text.replace(from, to).replace(/from '\.\/([\w-]+\.ts)'/g, (_, f: string) => `from '${new URL(`../src/${f}`, import.meta.url).href}'`);
  const file = join(tempDir('mutant-'), 'where.ts');
  writeFileSync(file, changed);
  return await import(pathToFileURL(file).href) as Mod;
}

test('a mutant that says deployed when one file differs is caught', async () => {
  const m = await mutant('existsSync(file) && sameText(readFileSync(file, \'utf8\'), want[f.path]!)', 'existsSync(file)');
  assert.notDeepEqual(partlyNamesHelper(m), [], 'the mutant called UAT deployed, and the check saw it');
});
