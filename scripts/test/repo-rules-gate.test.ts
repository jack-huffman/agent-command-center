// T-26: every builder runs the repo-wide rule tests in scripts/test/ before it finishes. T-24 passed every
// builder check, then broke two of them on main. This pins that .acc/config.json names the repo-rules check,
// that its command runs those files, and that it sits in the builder, heavy and tests lists.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

type Gates = { builder: string[]; commands: Record<string, string>; heavy: string[]; tests: string[] };

/** The gates block of a config's text, failing when there is none. */
const gatesOf = (text: string): Gates => {
  const gates = JSON.parse(text).gates as Gates | undefined;
  assert.ok(gates, 'the config has no gates block');
  return gates;
};

/** Why a gates block doesn't make every builder run the repo-wide rule tests, or null when it does. */
const repoRulesProblem = (gates: Gates): string | null => {
  const at = gates.builder.indexOf('repo-rules');
  const near = gates.builder.indexOf('near-tests');
  if (at < 0) return 'repo-rules is not in gates.builder';
  if (near < 0 || at < near) return 'repo-rules is not after near-tests in gates.builder';
  const command = gates.commands['repo-rules'];
  if (!command) return 'gates.commands has no repo-rules';
  if (!/--test\b/.test(command) || !command.includes('scripts/test/*.test.ts')) return `repo-rules does not run the files in scripts/test/: ${command}`;
  for (const list of ['heavy', 'tests'] as const) if (!gates[list].includes('repo-rules')) return `repo-rules is not in gates.${list}`;
  return null;
};

const config = (): Gates => gatesOf(readFileSync(join(ROOT, '.acc', 'config.json'), 'utf8'));

test('the repo runs repo-rules in every builder after near-tests, over the files in scripts/test/', () => {
  const gates = config();
  assert.equal(repoRulesProblem(gates), null);
  assert.equal(gates.commands['repo-rules'], 'node --no-warnings --test "scripts/test/*.test.ts"');
  assert.deepEqual(gates.builder.slice(0, 3), ['typecheck', 'near-tests', 'repo-rules']);
});

test('a config without repo-rules in gates.builder, or with a command that misses scripts/test/, fails', () => {
  const copy = (): Gates => JSON.parse(JSON.stringify(config()));
  const noBuilder = copy();
  noBuilder.builder = noBuilder.builder.filter((c) => c !== 'repo-rules');
  assert.match(repoRulesProblem(noBuilder) ?? '', /not in gates\.builder/);
  const before = copy();
  before.builder = ['repo-rules', 'typecheck', 'near-tests'];
  assert.match(repoRulesProblem(before) ?? '', /not after near-tests/);
  const noCommand = copy();
  delete noCommand.commands['repo-rules'];
  assert.match(repoRulesProblem(noCommand) ?? '', /no repo-rules/);
  for (const command of ['npm run typecheck', 'node --no-warnings --test "packages/*/test/*.test.ts"', 'node --no-warnings scripts/test/*.test.ts']) {
    const wrong = copy();
    wrong.commands['repo-rules'] = command;
    assert.match(repoRulesProblem(wrong) ?? '', /does not run the files in scripts\/test/, command);
  }
  for (const list of ['heavy', 'tests'] as const) {
    const missing = copy();
    missing[list] = missing[list].filter((c) => c !== 'repo-rules');
    assert.match(repoRulesProblem(missing) ?? '', new RegExp(`not in gates\\.${list}`));
  }
});

test('a config with no gates block fails rather than passes', () => {
  assert.throws(() => gatesOf('{}'), /no gates block/);
});
