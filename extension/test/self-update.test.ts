// The extension's own update (T-62): the four decisions, with no vscode import; the update path, with a
// stand-in for vscode, a fake gh and a temporary folder; and the built extension's first activation after an
// install, against the vscode stand-in. The last two need npm run build first, for the extension's bundle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRepo, tempDir } from '../../packages/core/test/support.ts';
import type { InstallSystem } from '../../packages/core/src/onboarding/install-lines.ts';
import { PLUGIN_LIST_ARGS, pluginUpdate, vsixName } from '../../packages/core/src/onboarding/steps.ts';
import { PLUGIN_FIX, PLUGIN_STEP } from '../src/logic/plugin-update.ts';
import { inShell } from '../../packages/core/src/shell.ts';
import { AFTER_STATE, afterText, afterUpdate, checksumCheck, downloadArgs, FIRST_LOOK_MS, nextLookIn, OFFER_BUTTONS, offerText, pickVsix, shouldOffer, SKIPPED_STATE } from '../src/logic/self-update.ts';
import type { AboutFacts, Release } from '../src/model/about.ts';
import { RELEASE_EVERY_MS, RELEASES_REPO } from '../src/model/about.ts';
import type { RunResult } from '../src/run.ts';
import { area as selfUpdateArea, SelfUpdate, type SelfUpdateDeps } from '../src/self-update.ts';
import { activate, fakeVscode, memento, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------- the decisions

test('a version is offered when it\'s newer, not skipped and not offered in this session; the edge cases of a skip and a closed notification', () => {
  const none = new Set<string>();
  assert.equal(shouldOffer('0.41.0', '0.40.0', null, none), true, 'newer');
  assert.equal(shouldOffer('0.40.0', '0.40.0', null, none), false, 'the same');
  assert.equal(shouldOffer('0.39.0', '0.40.0', null, none), false, 'older');
  assert.equal(shouldOffer('nightly', '0.40.0', null, none), false, 'not x.y.z');
  assert.equal(shouldOffer('0.41.0', '0.40.0', '0.41.0', none), false, 'skipped');
  assert.equal(shouldOffer('0.42.0', '0.40.0', '0.41.0', none), true, 'later than the skipped one');
  assert.equal(shouldOffer('0.41.0', '0.40.0', '0.42.0', none), false, 'older than the skipped one');
  assert.equal(shouldOffer('0.41.0', '0.40.0', null, new Set(['0.41.0'])), false, 'offered already: also after the person closed it');
  assert.equal(shouldOffer('0.42.0', '0.40.0', null, new Set(['0.41.0'])), true, 'another version is offered again');
  assert.equal(offerText('0.41.0'), 'Agent Command Center 0.41.0 is out');
  assert.deepEqual(Object.values(OFFER_BUTTONS), ['Install and reload', 'Release notes', 'Skip this version']);
});

test('the checksum check: a match, a mismatch, a missing asset, and the edge cases of an unreadable or another file\'s checksum', () => {
  const file = vsixName('0.41.0');
  const hash = sha('the vsix');
  assert.deepEqual(checksumCheck(hash, `${hash}  ${file}\n`, file), { ok: true }, 'a match, in shasum -a 256\'s format');
  assert.deepEqual(checksumCheck(hash.toUpperCase(), `${hash} *${file}\n`, file), { ok: true }, 'binary mode, any case');
  assert.deepEqual(checksumCheck(sha('another'), `${hash}  ${file}\n`, file), { ok: false, error: 'the downloaded file doesn\'t match the release\'s checksum' });
  assert.deepEqual(checksumCheck(hash, null, file), { ok: false, error: 'the release has no checksum, so it isn\'t installed' }, 'no checksum on the release: refused');
  assert.deepEqual(checksumCheck(hash, 'not a checksum\n', file), { ok: false, error: 'the release\'s checksum file can\'t be read' });
  assert.deepEqual(checksumCheck(hash, '', file), { ok: false, error: 'the release\'s checksum file can\'t be read' }, 'an empty file');
  assert.deepEqual(checksumCheck(hash, `${hash}  ${vsixName('0.40.0')}\n`, file), { ok: false, error: `the release's checksum is for ${vsixName('0.40.0')}, not ${file}` });
});

test('the file-name check: one file named for the release\'s version, and the edge cases of none, two, and another version\'s', () => {
  assert.deepEqual(pickVsix(['agent-command-center-0.41.0.vsix', 'agent-command-center-0.41.0.vsix.sha256'], '0.41.0'), { ok: true, file: 'agent-command-center-0.41.0.vsix' });
  assert.deepEqual(pickVsix([], '0.41.0'), { ok: false, error: 'the release has no extension file' });
  assert.deepEqual(pickVsix(['notes.md', 'x.vsix.sha256'], '0.41.0'), { ok: false, error: 'the release has no extension file' });
  assert.deepEqual(pickVsix(['a.vsix', 'b.vsix'], '0.41.0'), { ok: false, error: 'the release has 2 extension files, not one' });
  assert.deepEqual(pickVsix(['agent-command-center-0.40.0.vsix'], '0.41.0'), { ok: false, error: 'its file, agent-command-center-0.40.0.vsix, isn\'t named for 0.41.0' });
  assert.equal(vsixName('0.41.0'), 'agent-command-center-0.41.0.vsix');
});

test('whether to open after an update: the same version, another version, and none, with the edge case of a save that isn\'t one', () => {
  assert.deepEqual(afterUpdate({ version: '0.41.0', at: 1 }, '0.41.0'), { kind: 'opened', version: '0.41.0' });
  assert.deepEqual(afterUpdate({ version: '0.41.0', at: 1 }, '0.40.0'), { kind: 'missed', version: '0.41.0' });
  assert.equal(afterUpdate(undefined, '0.41.0'), null);
  for (const junk of [null, 'v0.41.0', { at: 1 }, { version: '' }, { version: 41 }]) assert.equal(afterUpdate(junk, '0.41.0'), null, JSON.stringify(junk));
  assert.equal(afterText({ kind: 'opened', version: '0.41.0' }, '0.41.0'), 'Updated to 0.41.0');
  assert.equal(afterText({ kind: 'missed', version: '0.41.0' }, '0.40.0'), 'The update to 0.41.0 didn\'t take: this is still 0.40.0. Install it again from Settings\' About.');
});

test('the look by itself waits a minute, then each interval after the last look, whoever made it; gh downloads into one folder', () => {
  assert.equal(FIRST_LOOK_MS, 60_000);
  assert.equal(nextLookIn(null, 5), 0, 'never looked: at once');
  assert.equal(nextLookIn(1000, 1000), RELEASE_EVERY_MS);
  assert.equal(nextLookIn(1000, 1000 + RELEASE_EVERY_MS - 10), 10, 'Settings looked a while ago');
  assert.equal(nextLookIn(1000, 1000 + 2 * RELEASE_EVERY_MS), 0, 'overdue');
  assert.deepEqual(downloadArgs('v0.41.0', '/t/d'), ['release', 'download', 'v0.41.0', '--repo', RELEASES_REPO, '--pattern', '*.vsix', '--pattern', '*.vsix.sha256', '--dir', '/t/d']);
});

// ---------------------------------------------------------------- the update path

const RELEASE: Release = { version: '0.41.0', tag: 'v0.41.0', name: 'v0.41.0', url: 'https://github.com/jack-huffman/agent-command-center/releases/tag/v0.41.0' };
const VSIX = 'PK the extension 0.41.0';

/** What the fake gh puts in the folder it's given: the VSIX and its checksum, as a release holds them. */
type Assets = Record<string, string> | 'fails';
const released = (over: Record<string, string | null> = {}): Record<string, string> => {
  const files: Record<string, string | null> = { [vsixName('0.41.0')]: VSIX, [`${vsixName('0.41.0')}.sha256`]: `${sha(VSIX)}  ${vsixName('0.41.0')}\n`, ...over };
  return Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => e[1] !== null));
};

/** `claude plugin list --json` with the acc plugin at a version, for every session (user scope). */
const pluginList = (version: string, scope = 'user'): RunResult => ({ code: 0, stdout: JSON.stringify([{ id: 'acc@agent-command-center', scope, version, enabled: true }]), stderr: '' });

/** What the fake claude and the plugin's update line answer: by default an older plugin, which updates. */
interface PluginFakes { list?: RunResult | 'throws'; update?: RunResult; system?: InstallSystem }

/** The update with stand-ins: the vscode stand-in, a fake gh, claude and shell, a temp folder, and each step in order. */
function updater(assets: Assets, o: { auto?: boolean; pick?: string; warnPick?: string; release?: Release | null; running?: string; installThrows?: boolean } & PluginFakes = {}) {
  const fake = fakeVscode(tempDir());
  const tmp = tempDir('acc-update-parent-');
  const steps: string[] = [];
  const state = memento();
  const looked: ((r: NonNullable<AboutFacts['release']>) => void)[] = [];
  const shown: { text: string; buttons: string[] }[] = [];
  const api = fake.api;
  const vscode = {
    Uri: api.Uri, env: api.env, ProgressLocation: api.ProgressLocation,
    window: {
      withProgress: (opts: { title: string }, task: (p: { report(m: { message?: string }): void }) => Promise<unknown>) => { steps.push(`progress: ${opts.title}`); return task({ report: (m) => steps.push(`step: ${m.message}`) }); },
      showInformationMessage: async (text: string, ...buttons: string[]) => { shown.push({ text, buttons }); return o.pick; },
      showWarningMessage: async (text: string, ...buttons: string[]) => { shown.push({ text, buttons }); steps.push(`warn: ${text}`); return buttons.includes(OFFER_BUTTONS.notes) ? OFFER_BUTTONS.notes : o.warnPick; },
    },
    commands: {
      executeCommand: async (id: string, ...args: unknown[]) => {
        if (id === 'workbench.extensions.installExtension') {
          const uri = args[0] as { fsPath: string; toString(): string };
          steps.push(`install: ${uri.toString()} (${existsSync(uri.fsPath) ? readFileSync(uri.fsPath, 'utf8') : 'gone'})`);
          if (o.installThrows) throw new Error('Can\'t install: corrupt zip');
        } else steps.push(`command: ${id}`);
        return api.commands.executeCommand(id, ...args);
      },
    },
  };
  const ghCalls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const pluginCalls: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const d: SelfUpdateDeps = {
    vscode: vscode as unknown as SelfUpdateDeps['vscode'],
    state: { get: (k) => state.get(k), update: async (k, v) => { steps.push(`saved: ${k} ${JSON.stringify(v)}`); await state.update(k, v); } },
    running: () => o.running ?? '0.40.0',
    open: () => steps.push('open'),
    auto: () => o.auto ?? true,
    about: {
      facts: () => ({ release: o.release === null ? { ok: true, value: null } : { ok: true, value: o.release ?? RELEASE }, checkedAt: null }) as AboutFacts,
      lookIfDue: async () => { steps.push('look'); },
      onLooked: (fn) => looked.push(fn),
    },
    run: async (cmd, args, env): Promise<RunResult> => {
      steps.push(`${cmd} ${args.slice(0, 3).join(' ')}`);
      if (cmd === 'claude') {
        if (o.list === 'throws') throw new Error('spawn claude EACCES');
        return o.list ?? pluginList('0.40.0');
      }
      if (cmd !== 'gh') {
        pluginCalls.push({ cmd, args, env });
        return o.update ?? { code: 0, stdout: '', stderr: '' };
      }
      ghCalls.push({ args, env });
      if (assets === 'fails') return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found\nmore' };
      const dir = args[args.indexOf('--dir') + 1]!;
      for (const [name, text] of Object.entries(assets)) writeFileSync(join(dir, name), text);
      return { code: 0, stdout: '', stderr: '' };
    },
    env: { PATH: '/bin', GH_TOKEN: 'a project\'s' },
    system: o.system ?? 'mac',
    now: () => 1234,
    tmp,
    log: (line) => steps.push(`log: ${line}`),
  };
  return { u: new SelfUpdate(d), steps, state, fake, tmp, shown, ghCalls, pluginCalls, hear: (r: NonNullable<AboutFacts['release']>) => looked.forEach((fn) => fn(r)) };
}

test('Install and reload downloads as gh\'s active account, checks the file, updates the older plugin, installs the file by its URI, saves the version, then reloads, in that order', async () => {
  const s = updater(released());
  assert.equal(await s.u.install('0.41.0'), true);
  const dir = s.ghCalls[0]!.args[s.ghCalls[0]!.args.indexOf('--dir') + 1]!;
  const file = join(dir, vsixName('0.41.0'));
  assert.deepEqual(s.steps, [
    'progress: Updating Agent Command Center to 0.41.0',
    'step: Downloading the release',
    'gh release download v0.41.0',
    'step: Checking the download',
    `claude ${PLUGIN_LIST_ARGS.join(' ')}`,
    `step: ${PLUGIN_STEP}`,
    `${inShell('')[0]} -c ${pluginUpdate('sh')}`,
    'step: Installing',
    `install: file://${file} (${VSIX})`,
    `saved: ${AFTER_STATE} {"version":"0.41.0","at":1234,"plugin":{"kind":"updated"}}`,
    'command: workbench.action.reloadWindow',
  ]);
  assert.deepEqual(s.ghCalls[0]!.args, downloadArgs('v0.41.0', dir));
  assert.equal(s.ghCalls[0]!.env.GH_TOKEN, undefined, 'as gh\'s active account, not a project\'s');
  assert.deepEqual(s.pluginCalls.map((c) => [c.cmd, c.args]), [inShell(pluginUpdate('sh'))], 'A4\'s own update line');
  assert.equal(s.pluginCalls[0]!.env.GH_TOKEN, undefined, 'the plugin\'s git runs as gh\'s active account, not a project\'s');
  assert.ok(dir.startsWith(s.tmp));
  assert.deepEqual(readdirSync(s.tmp), [], 'the temporary folder is gone');
});

test('on Windows the plugin updates through PowerShell, with A4\'s line built for PowerShell', async () => {
  const s = updater(released(), { system: 'windows' });
  assert.equal(await s.u.install('0.41.0'), true);
  assert.equal(s.pluginCalls.length, 1);
  const { cmd, args } = s.pluginCalls[0]!;
  assert.equal(cmd, 'powershell.exe');
  assert.equal(Buffer.from(args.at(-1)!, 'base64').toString('utf16le'), pluginUpdate('powershell'));
  assert.ok(!pluginUpdate('powershell').includes('&&'), 'Windows PowerShell 5.1 has no &&');
});

test('the plugin step leaves alone a plugin that is current, newer, not there, there for one project only, or with no claude, and installs nothing (edge cases)', async () => {
  const cases: [string, RunResult][] = [
    ['current', pluginList('0.41.0')],
    ['newer', pluginList('0.42.0')],
    ['not there', { code: 0, stdout: '[]', stderr: '' }],
    ['for one project only', pluginList('0.40.0', 'project')],
    ['no claude', { code: 127, stdout: '', stderr: '' }],
  ];
  let ran = 0;
  for (const [name, list] of cases) {
    const s = updater(released(), { list });
    assert.equal(await s.u.install('0.41.0'), true, name);
    assert.deepEqual(s.pluginCalls, [], `${name}: nothing updated or installed`);
    assert.ok(!s.steps.includes(`step: ${PLUGIN_STEP}`), `${name}: no plugin step shows`);
    assert.ok(s.steps.includes(`saved: ${AFTER_STATE} {"version":"0.41.0","at":1234}`), `${name}: no plugin outcome saved`);
    assert.ok(s.steps.includes('command: workbench.action.reloadWindow'), name);
    ran++;
  }
  assert.equal(ran, cases.length);
});

test('a failed plugin update, an unreadable plugin list or a claude that throws still installs the extension and reloads, logs why, and saves why (the edge cases of a failure)', async () => {
  const cases: [string, PluginFakes, string][] = [
    ['a failed update', { update: { code: 1, stdout: '', stderr: 'Failed to update marketplace: repository not found.\nmore' } }, 'Failed to update marketplace: repository not found'],
    ['a list that isn\'t read', { list: { code: 0, stdout: 'not json', stderr: '' } }, 'couldn\'t read Claude Code\'s plugins: claude plugin list printed something other than a list'],
    ['a claude that throws', { list: 'throws' }, 'spawn claude EACCES'],
  ];
  let ran = 0;
  for (const [name, fakes, why] of cases) {
    const s = updater(released(), fakes);
    assert.equal(await s.u.install('0.41.0'), true, `${name}: the extension still updates`);
    assert.ok(s.steps.some((x) => x.startsWith('install: ')), `${name}: installed`);
    assert.equal(s.steps.at(-1), 'command: workbench.action.reloadWindow', `${name}: reloaded`);
    assert.ok(s.steps.includes(`log: The Claude Code plugin didn't update to 0.41.0: ${why}`), `${name}: logged`);
    assert.deepEqual(s.state.get(AFTER_STATE), { version: '0.41.0', at: 1234, plugin: { kind: 'failed', why } }, `${name}: saved for after the reload`);
    ran++;
  }
  assert.equal(ran, cases.length);
});

test('after the reload a failed plugin step warns with why, and its button runs Setup\'s A4 Do it; a good one says open sessions keep the old plugin', async () => {
  const failed = updater(released(), { running: '0.41.0', warnPick: PLUGIN_FIX.label });
  await failed.state.update(AFTER_STATE, { version: '0.41.0', at: 1, plugin: { kind: 'failed', why: 'repository not found' } });
  await failed.u.afterActivation();
  const fixes = () => failed.fake.calls.executed.filter(([id]) => id === 'acc.step.fix');
  await until(() => fixes().length === 1, 2000, 'the A4 fix to run');
  assert.deepEqual(failed.shown, [{ text: 'Updated to 0.41.0. The Claude Code plugin didn\'t update: repository not found.', buttons: ['Update the plugin'] }]);
  assert.deepEqual(fixes(), [['acc.step.fix', ['A4.plugin']]], 'Setup\'s Do it, for A4');
  assert.ok(failed.steps.includes('open'), 'the Command Center still opens');
  // Closed with no button: nothing runs.
  const closed = updater(released(), { running: '0.41.0' });
  await closed.state.update(AFTER_STATE, { version: '0.41.0', at: 1, plugin: { kind: 'failed', why: 'repository not found' } });
  await closed.u.afterActivation();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(closed.fake.calls.executed.filter(([id]) => id === 'acc.step.fix'), []);

  const good = updater(released(), { running: '0.41.0' });
  await good.state.update(AFTER_STATE, { version: '0.41.0', at: 1, plugin: { kind: 'updated' } });
  await good.u.afterActivation();
  assert.deepEqual(good.shown, [{ text: 'Updated to 0.41.0. The Claude Code plugin updated too. Claude Code sessions that are open keep the old plugin until they start again.', buttons: [] }]);
});

test('a mismatched checksum, a release with no checksum file, a failed download, a wrong file and a failed install each install nothing, say what failed, offer the notes, and leave no folder (the edge cases of a failure)', async () => {
  const cases: [string, Assets, RegExp, { installThrows?: boolean }?][] = [
    ['a mismatched checksum', released({ [`${vsixName('0.41.0')}.sha256`]: `${sha('other')}  ${vsixName('0.41.0')}\n` }), /Couldn't update to 0\.41\.0: the downloaded file doesn't match the release's checksum\./],
    ['a release with no checksum file', released({ [`${vsixName('0.41.0')}.sha256`]: null }), /Couldn't update to 0\.41\.0: the release has no checksum, so it isn't installed\./],
    ['a failed download', 'fails', /Couldn't update to 0\.41\.0: couldn't download it: HTTP 404: Not Found\./],
    ['another version\'s file', { [vsixName('0.40.0')]: VSIX }, /isn't named for 0\.41\.0/],
    ['a failed install', released(), /the install failed: Can't install: corrupt zip/, { installThrows: true }],
  ];
  let ran = 0;
  for (const [name, assets, said, o] of cases) {
    const s = updater(assets, o);
    assert.equal(await s.u.install('0.41.0'), false, name);
    if (!o?.installThrows) assert.ok(!s.steps.some((x) => x.startsWith('install:')), `${name}: nothing installed`);
    assert.ok(!s.steps.some((x) => x.includes('reloadWindow') || x.startsWith('saved:')), `${name}: no reload, nothing saved`);
    const warning = s.shown.at(-1)!;
    assert.match(warning.text, said, name);
    assert.deepEqual(warning.buttons, [OFFER_BUTTONS.notes], `${name}: offers the release's notes`);
    assert.deepEqual(s.fake.calls.opened, [RELEASE.url], `${name}: the notes open when clicked`);
    assert.deepEqual(readdirSync(s.tmp), [], `${name}: the temporary folder is gone`);
    ran++;
  }
  assert.equal(ran, cases.length);
});

test('a version that isn\'t the latest installs nothing; two clicks install once (edge cases)', async () => {
  const stale = updater(released());
  assert.equal(await stale.u.install('0.39.0'), false);
  assert.match(stale.shown[0]!.text, /Couldn't update to 0\.39\.0: it isn't the latest release any more/);
  assert.deepEqual(stale.ghCalls, []);
  const noRelease = updater(released(), { release: null });
  assert.equal(await noRelease.u.install(), false);
  const twice = updater(released());
  await Promise.all([twice.u.install('0.41.0'), twice.u.install('0.41.0')]);
  assert.equal(twice.ghCalls.length, 1);
});

test('a look that finds a newer version offers it once a session, with its three buttons; Skip keeps it skipped, Release notes opens them', async () => {
  const s = updater(released(), { pick: OFFER_BUTTONS.skip });
  s.hear({ ok: true, value: RELEASE });
  await until(() => s.state.get(SKIPPED_STATE) === '0.41.0', 2000, 'the skip to be saved');
  assert.deepEqual(s.shown, [{ text: 'Agent Command Center 0.41.0 is out', buttons: ['Install and reload', 'Release notes', 'Skip this version'] }]);
  // The same version again, in this session or a later one: not offered. A failed look or no release: quiet.
  s.hear({ ok: true, value: RELEASE });
  s.hear({ ok: false, error: 'error connecting to api.github.com' });
  s.hear({ ok: true, value: null });
  await s.u.offer(RELEASE);
  const later = new SelfUpdate({ ...(s.u as unknown as { d: SelfUpdateDeps }).d });
  await later.offer(RELEASE);
  assert.equal(s.shown.length, 1);
  // A later version is offered.
  await s.u.offer({ ...RELEASE, version: '0.42.0', tag: 'v0.42.0' });
  assert.equal(s.shown.length, 2);

  const notes = updater(released(), { pick: OFFER_BUTTONS.notes });
  await notes.u.offer(RELEASE);
  assert.deepEqual(notes.fake.calls.opened, [RELEASE.url]);
  assert.equal(notes.state.get(SKIPPED_STATE), undefined);
  // Closed with no button: not skipped, and not offered again this session.
  const closed = updater(released());
  await closed.u.offer(RELEASE);
  await closed.u.offer(RELEASE);
  assert.deepEqual([closed.shown.length, closed.state.get(SKIPPED_STATE)], [1, undefined]);
});

test('Install and reload from the offer runs the install; with the setting off nothing is offered (edge case of a setting turned off)', async () => {
  const s = updater(released(), { pick: OFFER_BUTTONS.install });
  await s.u.offer(RELEASE);
  assert.ok(s.steps.includes('command: workbench.action.reloadWindow'));
  const off = updater(released(), { auto: false });
  await off.u.offer(RELEASE);
  assert.deepEqual(off.shown, []);
});

test('the look by itself waits FIRST_LOOK_MS, and with the setting off it looks for nothing (edge case of a slow first step)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const on = updater(released());
  const stop = on.u.start();
  t.mock.timers.tick(FIRST_LOOK_MS - 1);
  assert.deepEqual(on.steps, [], 'nothing before the minute');
  t.mock.timers.tick(1);
  await until(() => on.steps.includes('look'), 2000, 'the first look');
  stop.dispose();
  const off = updater(released(), { auto: false });
  const stopOff = off.u.start();
  t.mock.timers.tick(FIRST_LOOK_MS);
  await Promise.resolve();
  assert.deepEqual(off.steps, []);
  stopOff.dispose();
});

test('after the first look, the next follows RELEASE_EVERY_MS later; with the setting off the timer waits a full interval, never a busy loop (T-62 review)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const on = updater(released());
  const stop = on.u.start();
  t.mock.timers.tick(FIRST_LOOK_MS);
  await until(() => on.steps.filter((x) => x === 'look').length === 1, 2000, 'the first look');
  t.mock.timers.tick(RELEASE_EVERY_MS - 1);
  await Promise.resolve();
  assert.equal(on.steps.filter((x) => x === 'look').length, 1, 'nothing before the interval');
  t.mock.timers.tick(1);
  await until(() => on.steps.filter((x) => x === 'look').length === 2, 2000, 'the second look');
  stop.dispose();
  // Off: nextLookIn(null) is 0, so a timer with no floor would fire again at once, forever. Ticking through
  // three intervals ends, and looks for nothing.
  const off = updater(released(), { auto: false });
  const stopOff = off.u.start();
  for (const ms of [FIRST_LOOK_MS, RELEASE_EVERY_MS, RELEASE_EVERY_MS, RELEASE_EVERY_MS]) { t.mock.timers.tick(ms); await Promise.resolve(); await Promise.resolve(); }
  assert.deepEqual(off.steps, []);
  stopOff.dispose();
});

test('the page\'s Install and reload runs the update with the version it names', async () => {
  const reg = new Map<string, (...a: unknown[]) => unknown>();
  const asked: unknown[] = [];
  selfUpdateArea.register!({ reg: (id: string, fn: (...a: unknown[]) => unknown) => reg.set(id, fn), selfUpdate: { install: async (v: unknown) => { asked.push(v); return true; } } } as never);
  await reg.get('acc.update.install')!('0.41.0');
  assert.deepEqual(asked, ['0.41.0']);
});

// ---------------------------------------------------------------- the built extension, after the reload

/** The built extension in a sandbox of its own, with what the install saved before the reload. */
async function activated(saved: unknown, fn: (fake: ReturnType<typeof fakeVscode>, state: { get(k: string): unknown }) => Promise<void>): Promise<void> {
  const { restore } = sandboxEnv('acc-self-update-');
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }] }) });
  const fake = fakeVscode(repo);
  const started = activate(dist, fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', version: running(), items: [] }, ...(saved === undefined ? {} : { [AFTER_STATE]: saved }) });
  try {
    await fn(fake, started.ctx.globalState);
    // Its setup pass done, so nothing it started is left for the next test.
    await until(() => fake.calls.contexts.get('acc.profile') === 'generic', 30_000, 'the extension\'s first setup pass');
  } finally {
    started.stop();
    delete createRequire(import.meta.url).cache[dist];
    restore();
  }
}

const running = () => (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;

test('the first activation after an update to this version opens the Command Center and says the version', { timeout: 60_000 }, async () => {
  await activated({ version: running(), at: Date.now() }, async (fake, state) => {
    await until(() => fake.calls.info.includes(`Updated to ${running()}`), 10_000, 'Updated to');
    assert.equal(fake.panels.length, 1, 'the Command Center opens');
    assert.equal(state.get(AFTER_STATE), undefined, 'cleared, so the next start says nothing');
  });
});

test('the first activation after an update to another version says the update didn\'t take, and opens nothing; with none saved it says nothing (edge cases)', { timeout: 60_000 }, async () => {
  await activated({ version: '999.0.0', at: Date.now() }, async (fake, state) => {
    await until(() => fake.calls.warn.some((w) => w.startsWith('The update to 999.0.0 didn\'t take')), 10_000, 'the update didn\'t take');
    assert.equal(fake.calls.warn.find((w) => w.startsWith('The update'))!, `The update to 999.0.0 didn't take: this is still ${running()}. Install it again from Settings' About.`);
    assert.equal(fake.panels.length, 0, 'nothing opens');
    assert.equal(state.get(AFTER_STATE), undefined);
  });
  await activated(undefined, async (fake) => {
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!fake.calls.info.some((m) => m.startsWith('Updated to')) && !fake.calls.warn.some((m) => m.startsWith('The update')));
  });
});
