// Where a ticket's work is, on its page (T-155): the path line takes in what the orgs were found to hold, each
// stop carries its reading and when it was read, and the readings are read behind the page, never waited on.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Config, Environment } from '../../packages/core/src/config.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { type EnvWhere, keepWhere, type TicketWhere, WHERE_MAX_AGE_MS } from '../../packages/core/src/where-kept.ts';
import { WhereReads } from '../src/logic/where.ts';
import { deployOff, foundAt, ticketDeploy, ticketPath, WHERE_LOOK } from '../src/model/ticket-deploy.ts';

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

test('work found in an org outside acc moves the path line on, and each stop carries what was found and when', () => {
  const w = where(read('dev', 'deployed'), read('qa', 'partly', { differs: ['Apex Class: Helper'] }), read('uat', 'deployed', { notes: ['It\'s in UAT\'s org, with no deploy of it on record: it got there another way.'] }), read('production', 'unknown', { why: 'This machine has no access to Production: acme-production isn\'t logged in here.' }));
  const p = ticketPath(config, task(), w);
  assert.deepEqual(p.map((s) => [s.name, s.look.label]), [['Dev', 'merged'], ['QA', 'deployed'], ['UAT', 'deployed'], ['Production', 'next']]);
  assert.deepEqual(p.map((s) => s.found?.look.label), ['in the org', 'partly deployed', 'in the org', 'can\'t tell']);
  assert.deepEqual(p[1]!.found?.differs, ['Apex Class: Helper']);
  assert.match(p[1]!.found!.words, /QA: partly deployed\. Apex Class: Helper differs\./);
  assert.match(p[3]!.found!.words, /can't tell\. This machine has no access to Production/);
  assert.equal(p[2]!.found!.at, AT, 'when it was read');
  const d = ticketDeploy({ config, task: task(), tasks: [task()], running: false, run: null, where: w })!;
  assert.equal(d.deploy?.label, 'Deploy to Production', 'the next deploy goes on from where the org holds it');
  assert.equal(deployOff({ config, task: task(), tasks: [task()], running: false, run: null, where: w }, ENVS[3]!), null);
});

test('before the first reading, the line is today\'s line and each stop has nothing found', () => {
  const p = ticketPath(config, task());
  assert.deepEqual(p.map((s) => [s.look.label, s.found]), [['merged', null], ['next', null], ['later', null], ['later', null]]);
  assert.equal(foundAt(null, 'qa'), null);
  assert.equal(foundAt(where(read('qa', 'deployed')), 'uat'), null, 'an environment not read yet');
  assert.deepEqual(Object.values(WHERE_LOOK).map((l) => l.tone), ['blue', 'orange', 'orange', 'neutral'], 'orange against blue, each with words');
});

test('a reading of not deployed never takes the line back from what acc recorded', () => {
  const t = task({ promotions: [{ from: 'dev', to: 'qa', pr: { number: 4, url: 'u' }, state: 'merged', at: AT, mergedAt: AT }] });
  const p = ticketPath(config, t, where(read('qa', 'not-deployed', { notes: ['Its deploy record says it reached QA on 2026-10-30, but the org doesn\'t hold it now.'] })));
  assert.deepEqual(p.map((s) => s.look.label), ['merged', 'deployed', 'next', 'later']);
  assert.match(p[1]!.found!.words, /not deployed\. Its deploy record says it reached QA/);
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
  const stateDir = mkdtempSync(join(tmpdir(), 'acc-where-x-'));
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
  const stateDir = mkdtempSync(join(tmpdir(), 'acc-where-y-'));
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

test('a ticket that can\'t be read starts no read, and a read that fails still draws the page again', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'acc-where-z-'));
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
