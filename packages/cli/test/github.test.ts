// acc github use: the GitHub account a clone works as (github.ts).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { builderSettings, guardAnalyst, guardBash, parseConfig } from '../../core/src/index.ts';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('switching the GitHub account a clone pushes as is a person\'s at all three layers: the CLI, the hook and the builder\'s deny list (GH-113)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'acme-co/tool', account: 'work-account' } });
  const cloneConfig = () => readFileSync(join(dir, '.git', 'config'), 'utf8');
  const before = cloneConfig();
  const deny = (builderSettings({ id: 'T-1' } as never, parseConfig(GENERIC_CONFIG).config!, '/acc/bin', '/usr/bin') as { permissions: { deny: string[] } }).permissions.deny;
  // Claude Code's Bash(prefix*) rule: the command starts with what's before the star.
  const denied = (line: string) => deny.some((d) => { const p = /^Bash\((.*)\)$/.exec(d)?.[1] ?? ''; return p.endsWith('*') ? line.startsWith(p.slice(0, -1)) : line === p; });
  let ran = 0;
  for (const args of [['github', 'use', 'other-account'], ['github', 'use', '--default']]) {
    const line = `acc ${args.join(' ')}`;
    for (const role of ['builder', 'reviewer', 'analyst'] as const) {
      const r = acc(dir, args, undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
      assert.equal(r.code, 1, `${role}: ${line}`);
      assert.match(r.err, new RegExp(`An? ${role} can't switch the GitHub account this clone works as\\. A person does that\\.`), `${role}: ${line}`);
      ran++;
    }
    const autopilot = acc(dir, [...args, '--as', 'orchestrator']);
    assert.equal(autopilot.code, 1, `autopilot: ${line}`);
    assert.match(autopilot.err, /Only a person can switch the GitHub account this clone works as\./);
    assert.equal(guardBash({ task: { id: 'T-1', run: {} } } as never, line), 'acc github use is a person\'s. A builder finishes with acc done, or acc block "<what you need>".', `the hook: ${line}`);
    assert.match(guardBash({ task: { id: 'T-1', run: {} } } as never, `cd x && nice -n 15 ${line}`) ?? '', /is a person's/, `the hook, chained: ${line}`);
    assert.ok(guardAnalyst(line), `the analyst's hook: ${line}`);
    assert.ok(denied(line), `the builder's deny list: ${line}`);
  }
  assert.equal(ran, 6, 'each role met each form');
  assert.equal(cloneConfig(), before, 'nothing refused touched this clone\'s config');
  // Seeing which account it works as is still a builder's: it only reads.
  assert.equal(guardBash({ task: { id: 'T-1', run: {} } } as never, 'acc github status'), null);
  assert.ok(!denied('acc github status'));
});
