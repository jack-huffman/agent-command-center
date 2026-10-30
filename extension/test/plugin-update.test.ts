// Install and reload's plugin step (T-152): which plugin it updates, the line it runs on each system, what a
// run's result means, what it saves for after the reload, and the words Settings' About and the message say.
// The step inside the update itself is self-update.test.ts's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pluginUpdate, STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { settingsModel } from '../src/model/settings.ts';
import { PLUGIN_FIX, PLUGIN_STEP, pluginPlan, pluginRunOutcome, pluginUpdateRun, pluginWords, savedPlugin } from '../src/logic/plugin-update.ts';
import { COMMANDS } from '../src/logic/setup.ts';
import { encodedPowerShell, shellRun } from '../src/logic/shells.ts';
import { inShell } from '../../packages/core/src/shell.ts';
import { afterText, afterUpdate } from '../src/logic/self-update.ts';
import type { RunResult } from '../src/run.ts';

const listed = (plugins: Record<string, unknown>[]): RunResult => ({ code: 0, stdout: JSON.stringify(plugins), stderr: '' });
/** The sh acc runs a line with on this machine (inShell). */
const SH = inShell('')[0];
const acc = (version: unknown, scope = 'user', enabled = true) => ({ id: 'acc@agent-command-center', scope, version, enabled });

test('only a plugin for every session and older than the new version is updated; the edge cases of none, another scope, an unknown version and a failed list', () => {
  const cases: [string, RunResult, ReturnType<typeof pluginPlan>][] = [
    ['older, for every session', listed([acc('0.40.0')]), { kind: 'update' }],
    ['older and turned off: still updated', listed([acc('0.40.0', 'user', false)]), { kind: 'update' }],
    ['the same version', listed([acc('0.41.0')]), { kind: 'leave' }],
    ['newer', listed([acc('0.42.0')]), { kind: 'leave' }],
    ['not installed: Setup installs it', listed([]), { kind: 'leave' }],
    ['another plugin only', listed([{ id: 'other@market', scope: 'user', version: '0.1.0' }]), { kind: 'leave' }],
    ['for one project only', listed([acc('0.40.0', 'project')]), { kind: 'leave' }],
    ['no version', listed([acc(undefined)]), { kind: 'leave' }],
    ['claude isn\'t installed', { code: 127, stdout: '', stderr: '' }, { kind: 'leave' }],
    ['the list fails', { code: 1, stdout: '', stderr: 'boom' }, { kind: 'failed', why: 'couldn\'t read Claude Code\'s plugins: claude plugin list didn\'t run: boom' }],
    ['the list isn\'t a list', { code: 0, stdout: '{}', stderr: '' }, { kind: 'failed', why: 'couldn\'t read Claude Code\'s plugins: claude plugin list printed something other than a list' }],
  ];
  let ran = 0;
  for (const [name, r, want] of cases) {
    assert.deepEqual(pluginPlan(r, '0.41.0'), want, name);
    ran++;
  }
  assert.equal(ran, cases.length);
});

test('the update runs A4\'s own fix line, through sh on a Mac and Linux and PowerShell on Windows', () => {
  const a4 = STEPS.find((s) => s.id === 'A4.plugin')!;
  assert.equal(pluginUpdate('sh'), 'claude plugin marketplace update agent-command-center && claude plugin update acc@agent-command-center --scope user');
  assert.equal(pluginUpdate('powershell'), 'claude plugin marketplace update agent-command-center; if ($?) { claude plugin update acc@agent-command-center --scope user }');
  assert.deepEqual(pluginUpdateRun('mac'), { cmd: SH, args: ['-c', pluginUpdate('sh')] });
  assert.deepEqual(pluginUpdateRun('linux'), { cmd: SH, args: ['-c', pluginUpdate('sh')] });
  const win = pluginUpdateRun('windows');
  assert.equal(win.cmd, 'powershell.exe');
  assert.equal([win.cmd, ...win.args].join(' '), encodedPowerShell(pluginUpdate('powershell')), 'the encoded line Do it runs on Windows');
  assert.deepEqual(shellRun('echo hi', 'mac'), { cmd: SH, args: ['-c', 'echo hi'] });
  assert.ok(a4, 'A4 is the step whose fix this is');
  assert.deepEqual(PLUGIN_FIX, { label: 'Update the plugin', command: COMMANDS.fix, step: 'A4.plugin' });
  assert.equal(PLUGIN_STEP, 'Updating the Claude Code plugin');
});

test('a run that exits 0 updated; one that fails says its first line, and the edge case of a failure that prints nothing', () => {
  assert.deepEqual(pluginRunOutcome({ code: 0, stdout: 'Updated', stderr: '' }), { kind: 'updated' });
  assert.deepEqual(pluginRunOutcome({ code: 1, stdout: '', stderr: 'Plugin not found.\nmore' }), { kind: 'failed', why: 'Plugin not found' });
  assert.deepEqual(pluginRunOutcome({ code: 1, stdout: 'from stdout', stderr: '' }), { kind: 'failed', why: 'from stdout' });
  assert.deepEqual(pluginRunOutcome({ code: 2, stdout: '', stderr: '  ' }), { kind: 'failed', why: 'the update exited 2' });
});

test('what the install saved is read back after the reload, and the edge cases of a save from before T-152 and one that isn\'t an outcome', () => {
  assert.deepEqual(savedPlugin({ kind: 'updated' }), { kind: 'updated' });
  assert.deepEqual(savedPlugin({ kind: 'failed', why: 'x' }), { kind: 'failed', why: 'x' });
  for (const junk of [undefined, null, 'updated', { kind: 'failed' }, { kind: 'failed', why: '' }, { kind: 'other' }]) assert.equal(savedPlugin(junk), undefined, JSON.stringify(junk));
  assert.deepEqual(afterUpdate({ version: '0.41.0', at: 1 }, '0.41.0'), { kind: 'opened', version: '0.41.0' }, 'a save from before T-152');
  assert.deepEqual(afterUpdate({ version: '0.41.0', at: 1, plugin: { kind: 'failed', why: 'x' } }, '0.41.0'), { kind: 'opened', version: '0.41.0', plugin: { kind: 'failed', why: 'x' } });
  assert.deepEqual(afterUpdate({ version: '0.41.0', at: 1, plugin: 'junk' }, '0.40.0'), { kind: 'missed', version: '0.41.0' });
});

test('the message after the reload says whether the plugin updated, and the edge case of an update that didn\'t take', () => {
  assert.equal(pluginWords({ kind: 'updated' }), 'The Claude Code plugin updated too. Claude Code sessions that are open keep the old plugin until they start again.');
  assert.equal(pluginWords({ kind: 'failed', why: 'repository not found' }), 'The Claude Code plugin didn\'t update: repository not found.');
  assert.equal(afterText({ kind: 'opened', version: '0.41.0' }, '0.41.0'), 'Updated to 0.41.0', 'no plugin step: as before');
  assert.equal(afterText({ kind: 'opened', version: '0.41.0', plugin: { kind: 'updated' } }, '0.41.0'), `Updated to 0.41.0. ${pluginWords({ kind: 'updated' })}`);
  assert.equal(afterText({ kind: 'missed', version: '0.41.0', plugin: { kind: 'failed', why: 'x' } }, '0.40.0'), 'The update to 0.41.0 didn\'t take: this is still 0.40.0. Install it again from Settings\' About. The Claude Code plugin didn\'t update: x.');
});

test('Settings\' About describes the plugin step, as the notification does', () => {
  const about = settingsModel({ theme: 'vscode', projects: [], setup: [] }).parts.find((p) => p.id === 'about')!;
  const text = about.details.join(' ');
  assert.match(text, /When the Claude Code plugin is installed for every session and is older, the extension updates it as Setup's A4 does\. Then it installs the new version and reloads the window\./);
  assert.ok(text.includes('Claude Code sessions that are open keep the old plugin until they start again.'), 'the same words as the message after a good update');
  assert.ok(pluginWords({ kind: 'updated' }).endsWith('Claude Code sessions that are open keep the old plugin until they start again.'));
  assert.match(text, /If the plugin doesn't update, the extension still updates, and the message after the reload says why\./);
});
