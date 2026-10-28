// Starting a Salesforce project checks this machine before Production's org is picked with sf (T-133), so a
// machine without the Salesforce CLI sees the machine's list first. Its own file: the built extension activates
// once in a process.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MACHINE_FIRST_PART } from '../src/model/setup.ts';
import { makeRepo } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

test('edge case: the Salesforce choice checks this machine before Production\'s org is picked, so no sf runs while the list is shown', { timeout: 240_000 }, async () => {
  const { restore } = sandboxEnv('machine-first-sf-');
  const repo = makeRepo();
  const fake = fakeVscode(repo);
  const started = activate(dist, fake);
  try {
    const run = (id: string, ...a: unknown[]) => fake.calls.commands.get(id)!(...a) as Promise<unknown>;
    await until(() => fake.calls.commands.has('acc.step.fix'), 20_000, 'the commands');
    const shown: string[][] = [];
    fake.calls.pick = (items) => {
      shown.push(items.map((i) => String((i as { label?: string }).label)));
      return items.find((i) => String((i as { label?: string }).label).includes('Salesforce project'));
    };
    const before = fake.calls.prompts;
    await run('acc.step.fix', 'B0.config');
    const opened = fake.calls.executed.filter(([id, args]) => id === 'acc.open.home' && args[0] === 'setup' && args[1] === MACHINE_FIRST_PART);
    assert.equal(opened.length, 1, 'Setup opens at the machine\'s list');
    assert.equal(fake.calls.prompts - before, 1, 'only the kind of project was asked: Production\'s pick, which lists orgs with sf, waits for Go on anyway');
    assert.equal(shown.length, 1);
    assert.ok(shown[0]!.some((l) => l.includes('Salesforce project')));
    await run('acc.start.notNow');
    assert.equal(existsSync(join(repo, '.acc', 'config.json')), false, 'nothing is written');
  } finally {
    started.stop();
    restore();
  }
});
