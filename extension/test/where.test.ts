// Where a ticket's work is, on its page (T-155, T-167): each environment row's state is acc's own record, and a
// row's Check this org reads that one environment, its result a note beside the row that never changes its state.
// A draw, a refresh and a due time start no read: a mutant that starts one when the page draws is caught.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { Config, Environment } from '../../packages/core/src/config.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { type EnvWhere, keepWhere, type TicketWhere } from '../../packages/core/src/where-kept.ts';
import * as logic from '../src/logic/where.ts';
import { DEPLOYER_WORDS, envCheck, envRows, RECORD_LOOK, ticketDeploy, WHERE_LOOK } from '../src/model/ticket-deploy.ts';

const { WhereReads } = logic;
const env = (name: string, more: Partial<Environment> = {}): Environment => ({ name, branch: name.toLowerCase(), type: 'sandbox' as Environment['type'], org: `acme-${name.toLowerCase()}`, default: false, protected: false, promotesTo: [], ...more });
const ENVS = [env('Dev', { default: true, promotesTo: ['qa'] }), env('QA', { promotesTo: ['uat', 'hotfix'] }), env('UAT', { promotesTo: ['production'] }), env('Hotfix'), env('Production', { type: 'production' as Environment['type'], protected: true })];
const config: Pick<Config, 'profile' | 'environments' | 'github'> = { profile: 'salesforce', environments: ENVS, github: { repo: 'acme/app', account: 'jordan-kim' } };
const AT = '2026-10-30T10:00:00.000Z';
const LATER = '2026-10-30T11:00:00.000Z';
const task = (more: Partial<Task> = {}): Task => ({
  id: 'ACME-7', title: 'x', brief: '', source: { kind: 'manual', key: null, url: null }, environment: 'dev', deps: [], labels: [], state: 'done', blocker: null,
  run: { branch: 'task/acme-7' }, pr: { number: 3, url: 'u', state: 'merged' }, history: [], createdAt: AT, updatedAt: AT, ...more,
} as unknown as Task);
const deploy = (e: string, at: string, more: Record<string, unknown> = {}) => ({ env: e, org: `acme-${e}`, sha: 's', at, jobId: '0Af', paths: [], components: [], verified: 0, tests: null, ...more });
const read = (e: string, state: EnvWhere['state'], more: Partial<EnvWhere> = {}): EnvWhere => {
  const r = { state, differs: [], why: null, at: LATER, ...more };
  return { env: e, name: ENVS.find((x) => x.branch === e)!.name, ...r, git: r, org: r, leftOut: [], unchecked: [], notes: [], ...more };
};
const where = (...envs: EnvWhere[]): TicketWhere => ({ v: 1, task: 'ACME-7', envs });
/** Dev deployed by its builder, QA by the deploy guide, UAT's deploy failed, Production merged by a promotion, Hotfix not deployed. */
const recorded = (): Task => task({
  deploys: [deploy('dev', AT), deploy('qa', AT, { checkId: '0AfC', by: 'human:jordan' })] as unknown as Task['deploys'],
  deployFailures: [{ env: 'uat', org: 'acme-uat', at: AT, reason: 'The deploy to acme-uat failed (job 0Af2), 1 problem: Helper.cls:3: Missing ;\nsf said more', checkId: '0AfD', by: 'human:jordan' }],
  promotions: [{ from: 'dev', to: 'qa', pr: { number: 4, url: 'u' }, state: 'merged', at: AT, mergedAt: AT }, { from: 'uat', to: 'production', pr: { number: 9, url: 'u' }, state: 'merged', at: AT, mergedAt: AT }],
});

test('each row\'s state is acc\'s record: deployed with when and who, deploy failed with why on one line, merged, or not deployed (T-167)', () => {
  const rows = envRows(config, recorded(), null, null, [ENVS[3]!]);
  assert.deepEqual(rows.map((r) => [r.name, r.look, r.at, r.by]), [
    ['Dev', RECORD_LOOK.deployed, AT, DEPLOYER_WORDS.builder], ['QA', RECORD_LOOK.deployed, AT, DEPLOYER_WORDS.guide],
    ['UAT', RECORD_LOOK.failed, AT, DEPLOYER_WORDS.guide], ['Production', RECORD_LOOK.merged, AT, null], ['Hotfix', RECORD_LOOK['not-deployed'], null, null],
  ]);
  assert.deepEqual([DEPLOYER_WORDS.builder, DEPLOYER_WORDS.guide], ['by the builder', 'by the deploy guide']);
  assert.equal(rows[2]!.detail, 'The deploy to acme-uat failed (job 0Af2), 1 problem: Helper.cls:3: Missing ;', 'failed: why, on one line');
  assert.equal(rows[3]!.detail, 'In the production branch, with no deploy on record');
  assert.deepEqual(rows.map((r) => r.check), [null, null, null, null, null], 'no check yet: no note');
  assert.deepEqual(Object.values(RECORD_LOOK).map((l) => [l.label, l.tone]), [['Deployed', 'blue'], ['Deploy failed', 'orange'], ['Merged', 'blue'], ['Not deployed', 'neutral']], 'orange against blue, each with words');
});

test('edge case: the development environment merged with no deploy is merged, and its merge line is not said twice; before there\'s work, every row is not deployed (T-167)', () => {
  const dev = envRows(config, task())[0]!;
  assert.deepEqual([dev.look, dev.at, dev.merged], [RECORD_LOOK.merged, null, null]);
  const none = envRows(config, task({ pr: null, run: null, state: 'todo' }));
  assert.deepEqual(none.map((r) => r.look.label), ['Not deployed', 'Not deployed', 'Not deployed', 'Not deployed']);
  assert.equal(none[0]!.merged?.words, 'No work to merge yet');
  assert.ok(none.every((r) => r.checkOff && /has no work yet/.test(r.checkOff)), 'Check this org is off, with why, before there\'s work');
});

test('a check\'s result is a note under its row, with its time: it never changes the row\'s state or where the ticket is (T-167)', () => {
  const t = recorded();
  const w = where(read('dev', 'not-deployed', { differs: ['Apex Class: Helper'] }), read('qa', 'partly', { differs: ['Apex Class: Helper', 'Flow: Route'] }), read('uat', 'deployed', { notes: ['It\'s in UAT\'s org, with no deploy of it on record: it got there another way.'] }), read('hotfix', 'unknown', { why: 'This machine isn\'t logged in to acme-hotfix.' }));
  const plain = ticketDeploy({ config, task: t, tasks: [t], deploying: null })!;
  const noted = ticketDeploy({ config, task: t, tasks: [t], deploying: null, where: w })!;
  assert.deepEqual(noted.rows.map((r) => [r.look, r.at, r.by, r.next]), plain.rows.map((r) => [r.look, r.at, r.by, r.next]), 'the same states and the same next step');
  assert.deepEqual(noted.pick, plain.pick, 'Deploy… offers the same: a reading moves nothing');
  assert.deepEqual(noted.rows.map((r) => r.check && [r.check.look.label, r.check.at, r.check.detail]), [
    ['Differs', LATER, '1 component not in Dev'], ['Differs', LATER, '2 components differ'], ['Matches', LATER, null], null, ['Can\'t tell', LATER, 'This machine isn\'t logged in to acme-hotfix.'],
  ]);
  assert.deepEqual(noted.rows[1]!.check!.differs, ['Apex Class: Helper', 'Flow: Route'], 'which components differ');
  assert.deepEqual(noted.rows[2]!.check!.notes, ['It\'s in UAT\'s org, with no deploy of it on record: it got there another way.']);
  assert.deepEqual(envCheck(read('qa', 'not-deployed'), 'QA').detail, 'Not in QA', 'edge case: not there, with no component named');
  assert.deepEqual(Object.values(WHERE_LOOK).map((l) => l.tone), ['blue', 'orange', 'orange', 'neutral'], 'orange against blue, each with words');
});

test('edge case: Check this org is off with why for an environment with no org; a check under way waits on its own row alone (T-167)', () => {
  const noOrg = { ...config, environments: ENVS.map((e) => (e.branch === 'hotfix' ? { ...e, org: null } : e)) };
  const rows = ticketDeploy({ config: noOrg, task: task(), tasks: [], deploying: null, reading: (b) => b === 'uat' })!.rows;
  assert.deepEqual(rows.map((r) => [r.branch, r.checkOff, r.checking]), [['dev', null, false], ['qa', null, false], ['uat', null, true], ['production', null, false], ['hotfix', 'Hotfix has no org in the project\'s settings.', false]]);
});

/** A host whose acc answers when told, and that counts each read. */
function host() {
  const reads: string[][] = [];
  const done: string[] = [];
  let answer: () => void = () => {};
  const h = {
    acc: (args: string[]) => { reads.push(args); return new Promise<{ code: number; stdout: string; stderr: string }>((res, rej) => { answer = () => (args[1] === 'FAIL-1' ? rej(new Error('acc stopped')) : res({ code: 0, stdout: '{}', stderr: '' })); }); },
    done: (_root: string, id: string) => { done.push(id); },
  };
  return { h, reads, done, answer: () => answer() };
}

/** The reads a page's draws start: the kept readings, for each draw and each refresh, of a ticket with old readings and a deploy since. Each draw reads none. */
function drawReads(m: typeof logic): number {
  const stateDir = tempDir('acc-where-draw-');
  const x = host();
  const r = new m.WhereReads(x.h);
  const t = task({ deploys: [deploy('qa', LATER, { checkId: '0AfC' })] as unknown as Task['deploys'] });
  for (let i = 0; i < 3; i++) ticketDeploy({ config, task: t, tasks: [t], deploying: null, where: r.kept(stateDir, 'acme-7'), reading: (b) => r.reading('/p', t.id, b) });
  keepWhere({ stateDir }, 'ACME-7', [read('dev', 'deployed', { at: '2020-01-01T00:00:00.000Z' })]);
  for (let i = 0; i < 3; i++) ticketDeploy({ config, task: t, tasks: [t], deploying: null, where: r.kept(stateDir, 'acme-7'), reading: (b) => r.reading('/p', t.id, b) });
  return x.reads.length;
}

test('a draw and a refresh start no read of a branch or an org: the kept readings are only read from their file (T-167)', () => {
  assert.equal(drawReads(logic), 0, 'before the first reading, and with an old one and a deploy since');
  const stateDir = tempDir('acc-where-kept-');
  const r = new WhereReads(host().h);
  assert.equal(r.kept(stateDir, 'ACME-7'), null, 'edge case: none yet');
  keepWhere({ stateDir }, 'ACME-7', [read('qa', 'deployed')]);
  assert.deepEqual(r.kept(stateDir, 'acme-7')?.envs.map((e) => e.env), ['qa'], 'its key, whatever its case');
  // The extension's page: Refresh draws again, and the only read is a row's Check this org.
  const ticket = readFileSync(new URL('../src/ticket.ts', import.meta.url), 'utf8');
  const deploys = readFileSync(new URL('../src/ticket-deploy.ts', import.meta.url), 'utf8');
  assert.match(ticket, /case 'refresh': return this\.load\(o\);/, 'Refresh only draws again');
  assert.ok(!/reread|reads\.read\(/.test(ticket), 'the page starts no read itself');
  assert.deepEqual(deploys.match(/reads\.read\(/g)?.length, 1, 'one read in the extension');
  assert.match(deploys, /if \(m\.type === 'where-check'\) \{\n[^\n]*\n\s*void reads\.read\(m\.project, m\.task, m\.env\);/, 'and it is Check this org\'s');
});

test('a mutant that starts a read when the page draws is caught (T-167)', async () => {
  const src = new URL('../src/logic/where.ts', import.meta.url);
  const text = readFileSync(src, 'utf8');
  const from = '    return readWhere({ stateDir }, id.toUpperCase());';
  assert.ok(text.includes(from), 'the mutant\'s line is still in where.ts');
  const changed = text.replace(from, `    void this.read(stateDir, id, 'dev');\n${from}`).replace(/from '(\.{1,2}\/[^']+\.ts)'/g, (_, f: string) => `from '${new URL(f, src).href}'`);
  const file = join(tempDir('mutant-'), 'where.ts');
  writeFileSync(file, changed);
  const m = await import(pathToFileURL(file).href) as typeof logic;
  assert.ok(drawReads(m) > 0, 'the mutant read when the page drew, and the check saw it');
});

test('Check this org reads its own environment alone, once at a time, and the page draws again once it\'s back (T-167)', async () => {
  const x = host();
  const r = new WhereReads(x.h);
  void r.read('/p', 'ACME-7', 'uat');
  assert.deepEqual(x.reads, [['where', 'ACME-7', '--env', 'uat', '--json']]);
  assert.deepEqual([r.reading('/p', 'ACME-7', 'uat'), r.reading('/p', 'ACME-7', 'qa')], [true, false], 'only UAT\'s row waits');
  void r.read('/p', 'ACME-7', 'uat');
  assert.equal(x.reads.length, 1, 'edge case: a second click while UAT is read reads nothing more');
  x.answer();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual([r.reading('/p', 'ACME-7', 'uat'), x.done], [false, ['ACME-7']], 'back, and the page draws again');
});

test('edge case: a check that fails still draws the page again, and its row stops waiting', async () => {
  const x = host();
  const r = new WhereReads(x.h);
  const p = r.read('/p', 'FAIL-1', 'qa');
  x.answer();
  await p;
  assert.deepEqual([x.done, r.reading('/p', 'FAIL-1', 'qa')], [['FAIL-1'], false]);
});
