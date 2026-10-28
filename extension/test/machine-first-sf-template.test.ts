// Starting a project from a Salesforce team template checks this machine before Production's org is picked with
// sf (T-133): the template is read and confirmed, then the machine's list shows, and the org waits for Go on
// anyway. Its own file: the built extension activates once in a process.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MACHINE_FIRST_PART } from '../src/model/setup.ts';
import { makeRepo } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

test('edge case: a Salesforce team template checks this machine before Production\'s org is picked, so no sf runs while the list is shown', { timeout: 240_000 }, async () => {
  const { restore } = sandboxEnv('machine-first-sf-template-');
  const repo = makeRepo();
  const template = join(repo, '..', 'acme-template.json');
  writeFileSync(template, JSON.stringify({ schema: 1, name: 'ACME Salesforce', profile: 'salesforce', environments: [{ name: 'Production' }, { name: 'Int', default: true, promotesTo: ['production'] }] }));
  const fake = fakeVscode(repo);
  const started = activate(dist, fake);
  try {
    const run = (id: string, ...a: unknown[]) => fake.calls.commands.get(id)!(...a) as Promise<unknown>;
    await until(() => fake.calls.commands.has('acc.step.fix'), 20_000, 'the commands');
    const shown: string[] = [];
    fake.calls.pick = (items) => {
      shown.push(items.map((i) => String((i as { label?: string }).label)).join(' | '));
      return items.find((i) => String((i as { label?: string }).label).includes('From a team template'));
    };
    fake.calls.input = template;
    fake.calls.infoPick = (buttons) => buttons.find((b) => b === 'Start the project');
    await run('acc.step.fix', 'B0.config');
    assert.ok(fake.calls.info.some((m) => m.includes('ACME Salesforce')), 'the template was read and confirmed');
    const opened = fake.calls.executed.filter(([id, args]) => id === 'acc.open.home' && args[0] === 'setup' && args[1] === MACHINE_FIRST_PART);
    assert.equal(opened.length, 1, 'Setup opens at the machine\'s list');
    assert.equal(shown.length, 1, 'only the kind of project was picked: Production\'s pick, which lists orgs with sf, waits for Go on anyway');
    assert.ok(!shown.some((s) => s.includes('Production')));
    await run('acc.start.notNow');
    assert.equal(existsSync(join(repo, '.acc', 'config.json')), false, 'nothing is written');
  } finally {
    started.stop();
    restore();
  }
});
