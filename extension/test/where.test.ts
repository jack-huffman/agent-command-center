// Where a ticket's work is, on its page (T-155): the environment rows (T-158) take in what the orgs were found to
// hold, each row carries its reading and when it was read, and the readings are read behind the page, never waited on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Config, Environment } from '../../packages/core/src/config.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { type EnvWhere, keepWhere, type TicketWhere, WHERE_MAX_AGE_MS } from '../../packages/core/src/where-kept.ts';
import { WhereReads } from '../src/logic/where.ts';
import { deployOff, envRows, ticketDeploy, WHERE_LOOK } from '../src/model/ticket-deploy.ts';

const env = (name: string, more: Partial<Environment> = {}): Environment => ({ name, branch: name.toLowerCase(), type: 'sandbox' as Environment['type'], org: `acme-${name.toLowerCase()}`, default: false, protected: false, promotesTo: [], ...more });
const ENVS = [env('Dev', { default: true, promotesTo: ['qa'] }), env('QA', { promotesTo: ['uat'] }), env('UAT', { promotesTo: ['production'] }), env('Production', { type: 'production' as Environment['type'], protected: true })];
const config: Pick<Config, 'profile' | 'environments' | 'github'> = { profile: 'salesforce', environments: ENVS, github: { repo: 'acme/app', account: 'jordan-kim' } };
const AT = '2026-10-30T10:00:00.000Z';
const task = (more: Partial<Task> = {}): Task => ({
  id: 'ACME-7', title: 'x', brief: '', source: { kind: 'manual', key: null, url: null }, environment: 'dev', deps: [], labels: [], state: 'done', blocker: null,
  run: { branch: 'task/acme-7' }, pr: { number: 3, url: 'u', state: 'merged' }, history: [], createdAt: AT, updatedAt: AT, ...more,
} as unknown as Task);
const read = (e: string, state: EnvWhere['state'], more: Partial<EnvWhere> = {}): EnvWhere => {
  const r = { state, differs: [], why: null, at: AT };
  return { env: e, name: ENVS.find((x) => x.branch === e)!.name, ...r, git: r, org: r, leftOut: [], unchecked: [], notes: [], ...more };
};
const where = (...envs: EnvWhere[]): TicketWhere => ({ v: 1, task: 'ACME-7', envs });

test('work found in an org outside acc moves the rows on, and each row carries what was found, why, and when it was read (T-158)', () => {
  const w = where(read('dev', 'deployed'), read('qa', 'partly', { differs: ['Apex Class: Helper'] }), read('uat', 'deployed', { notes: ['It\'s in UAT\'s org, with no deploy of it on record: it got there another way.'] }), read('production', 'unknown', { why: 'This machine has no access to Production: acme-production isn\'t logged in here.' }));
  const rows = envRows(config, task(), w);
  assert.deepEqual(rows.map((r) => [r.name, r.look.label, r.next?.label ?? null]), [['Dev', 'Deployed', null], ['QA', 'Partly deployed', null], ['UAT', 'Deployed', null], ['Production', 'Can\'t tell', 'Next']]);
  assert.deepEqual([rows[1]!.detail, rows[1]!.differs], ['1 component differs', ['Apex Class: Helper']]);
  assert.match(rows[3]!.detail!, /^This machine has no access to Production/);
  assert.deepEqual(rows[2]!.notes, ['It\'s in UAT\'s org, with no deploy of it on record: it got there another way.']);
  assert.equal(rows[2]!.readAt, AT, 'when it was read');
  const d = ticketDeploy({ config, task: task(), tasks: [task()], deploying: null, where: w })!;
  assert.deepEqual(d.pick?.choices.map((c) => c.name), ['Production'], 'Deploy… goes on from where the org holds it');
  assert.equal(deployOff({ config, task: task(), tasks: [task()], deploying: null, where: w }, ENVS[3]!), null);
});

test('edge case: before the first reading, each row says it hasn\'t been read, and Check again is there to read it (T-158)', () => {
  const rows = envRows(config, task());
  assert.deepEqual(rows.map((r) => [r.look.label, r.readAt, r.notes]), [['Can\'t tell', null, []], ['Can\'t tell', null, []], ['Can\'t tell', null, []], ['Can\'t tell', null, []]]);
  assert.deepEqual(envRows(config, task(), where(read('qa', 'deployed'))).map((r) => r.readAt), [null, AT, null, null], 'an environment not read yet');
  assert.deepEqual(Object.values(WHERE_LOOK).map((l) => l.tone), ['blue', 'orange', 'orange', 'neutral'], 'orange against blue, each with words');
});

test('a reading of not deployed never takes the rows back from what acc recorded, and says where they disagree (T-158)', () => {
  const t = task({ promotions: [{ from: 'dev', to: 'qa', pr: { number: 4, url: 'u' }, state: 'merged', at: AT, mergedAt: AT }] });
  const rows = envRows(config, t, where(read('qa', 'not-deployed', { notes: ['Its deploy record says it reached QA on 2026-10-30, but the org doesn\'t hold it now.'] })));
  assert.deepEqual(rows.map((r) => [r.look.label, !!r.next]), [['Can\'t tell', false], ['Not deployed', false], ['Can\'t tell', true], ['Can\'t tell', false]]);
  assert.match(rows[1]!.notes[0]!, /Its deploy record says it reached QA/);
});

/** A host whose acc answers when told, and that counts each read and each draw. */
function host(start = new Date(AT)) {
  let now = start;
  const reads: string[][] = [];
  const done: string[] = [];
  let answer: () => void = () => {};
  const h = {
    acc: (args: string[]) => { reads.push(args); return new Promise<{ code: number; stdout: string; stderr: string }>((res, rej) => { answer = () => (args[1] === 'FAIL-1' ? rej(new Error('acc stopped')) : res({ code: 0, stdout: '{}', stderr: '' })); }); },
    done: (_root: string, id: string) => { done.push(id); },
    now: () => now,
  };
  return { h, reads, done, answer: () => answer(), at: (d: Date) => { now = d; } };
}

test('a page draw reads the kept readings and never waits: a due one is read behind it, once at a time', async () => {
  const stateDir = tempDir('acc-where-x-');
  const x = host();
  const r = new WhereReads(x.h);
  assert.equal(r.kept('/p', stateDir, config, task()), null, 'none yet: the draw goes on with nothing');
  assert.deepEqual(x.reads, [['where', 'ACME-7', '--json']]);
  assert.ok(r.reading('/p', 'ACME-7'));
  r.kept('/p', stateDir, config, task());
  void r.read('/p', 'ACME-7');
  assert.equal(x.reads.length, 1, 'one read at a time for a ticket');
  x.answer();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(x.done, ['ACME-7'], 'the page draws again once it\'s back');
  assert.ok(!r.reading('/p', 'ACME-7'));
});

test('a fresh reading isn\'t read again, a draw doesn\'t retry a read within the hour, and a deploy since reads it again', async () => {
  const stateDir = tempDir('acc-where-y-');
  keepWhere({ stateDir }, 'ACME-7', ['dev', 'qa', 'uat', 'production'].map((e) => read(e, 'deployed')));
  const x = host();
  const r = new WhereReads(x.h);
  assert.equal(r.kept('/p', stateDir, config, task())?.envs.length, 4);
  assert.equal(x.reads.length, 0, 'fresh');
  x.at(new Date(Date.parse(AT) + WHERE_MAX_AGE_MS + 1));
  r.kept('/p', stateDir, config, task());
  assert.equal(x.reads.length, 1, 'too old');
  x.answer();
  await new Promise((res) => setImmediate(res));
  r.kept('/p', stateDir, config, task());
  assert.equal(x.reads.length, 1, 'a read that kept nothing new isn\'t retried by the next draw');
  r.kept('/p', stateDir, config, task({ deploys: [{ env: 'qa', at: new Date(Date.parse(AT) + WHERE_MAX_AGE_MS + 5).toISOString() }] as unknown as Task['deploys'] }));
  assert.equal(x.reads.length, 2, 'a deploy since reads it again');
});

test('edge case: a row\'s Check again reads its own environment alone, once at a time, and a read of every environment covers each row (T-158)', async () => {
  const x = host();
  const r = new WhereReads(x.h);
  void r.read('/p', 'ACME-7', 'uat');
  assert.deepEqual(x.reads, [['where', 'ACME-7', '--env', 'uat', '--json']]);
  assert.deepEqual([r.reading('/p', 'ACME-7', 'uat'), r.reading('/p', 'ACME-7', 'qa'), r.reading('/p', 'ACME-7')], [true, false, false], 'only UAT\'s row waits');
  void r.read('/p', 'ACME-7', 'uat');
  assert.equal(x.reads.length, 1, 'one read of UAT at a time');
  x.answer();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual([r.reading('/p', 'ACME-7', 'uat'), x.done], [false, ['ACME-7']], 'back, and the page draws again');
  void r.read('/p', 'ACME-7');
  assert.ok(r.reading('/p', 'ACME-7', 'qa'), 'a read of every environment covers QA\'s row');
  void r.read('/p', 'ACME-7', 'qa');
  assert.equal(x.reads.length, 2, 'so QA isn\'t read again beside it');
  x.answer();
  await new Promise((res) => setImmediate(res));
});

test('a ticket that can\'t be read starts no read, and a read that fails still draws the page again', async () => {
  const stateDir = tempDir('acc-where-z-');
  const x = host();
  const r = new WhereReads(x.h);
  assert.equal(r.kept('/p', stateDir, config, task({ pr: null, run: null })), null);
  assert.equal(r.kept('/p', stateDir, { ...config, profile: 'generic' }, task()), null);
  assert.equal(x.reads.length, 0);
  const p = r.read('/p', 'FAIL-1');
  x.answer();
  await p;
  assert.deepEqual(x.done, ['FAIL-1']);
});
