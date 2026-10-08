// The builder's packet: every project's rules (GH-104) reach every builder, whatever the profile.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { shortPacket } from '../src/hooks.ts';
import { emptyLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { renderPacket } from '../src/packet.ts';
import { BASE_RULES, PROFILE_RULES, rulesText } from '../src/rules.ts';
import { GENERIC_CONFIG, makeRepo, SF_CONFIG } from './support.ts';

const now = () => new Date('2026-10-08T12:00:00Z');

/** Each rule's words a builder must see: the ticket's three rules. */
const PHRASES = ['in its own file', 'register it there with one line', 'acc block', 'don\'t edit its files', 'temp file', 'rename it into place', 'half-written'];

function packetFor(raw: unknown, own = '- Name tests after what they prove.\n'): string {
  const config = parseConfig(raw).config!;
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(raw), '.acc/rules.md': own });
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Add a thing', brief: 'b' }], 'human', 'human:test', () => {}, now);
  return renderPacket({ task: l.tasks[0]!, config, env: config.environments.find((e) => e.default)!, worktree: '/w', branch: 'b', rules: rulesText(repo, config.profile), environmentSpecific: [] });
}

test('a generic builder\'s packet has every project\'s three rules, before the repo\'s own', () => {
  const p = packetFor(GENERIC_CONFIG);
  let checked = 0;
  for (const phrase of PHRASES) {
    assert.ok(p.includes(phrase), phrase);
    checked++;
  }
  assert.equal(checked, PHRASES.length);
  assert.equal(BASE_RULES.length, 3);
  for (const r of BASE_RULES) assert.ok(p.includes(`- ${r}\n`), r);
  const at = ['## Rules', '### Every project\'s rules', BASE_RULES[2]!, '### This repo\'s own rules', 'Name tests after'].map((s) => p.indexOf(s));
  assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'every project\'s rules, then the repo\'s own');
  assert.ok(!p.includes('Apex'), 'and nothing of Salesforce\'s');
});

test('a Salesforce builder gets the same three rules, then Salesforce\'s own, unchanged', () => {
  const p = packetFor(SF_CONFIG);
  for (const phrase of PHRASES) assert.ok(p.includes(phrase), phrase);
  const base = p.indexOf('### Every project\'s rules');
  const sf = p.indexOf('### The Salesforce profile\'s rules');
  assert.ok(base > 0 && sf > base, 'every project\'s first, then the profile adds its own');
  assert.deepEqual(PROFILE_RULES.salesforce.map((r) => p.indexOf(`- ${r}\n`) > sf), [true, true, true, true]);
  assert.equal(p.split('### Every project\'s rules').length, 2, 'said once');
});

test('the short instructions after a resume or compaction name the three rules in one line', () => {
  const task = { id: 'T-1', title: 'Do the thing', run: { worktree: '/w/T-1', branch: 'task/T-1-a' } } as Task;
  const line = shortPacket(task, ['test']).split('\n').find((l) => l.startsWith('Rules: '));
  assert.ok(line, 'a Rules line');
  for (const phrase of ['its own file', 'one line', 'acc block', 'don\'t edit its files', 'temp file', 'rename']) assert.ok(line.includes(phrase), phrase);
});
