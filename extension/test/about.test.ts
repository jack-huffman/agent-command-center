// Settings' About (GH-114): the part's model in every state, each with an icon and words, orange or blue or
// neutral; the plugin compared with the extension as A4 compares it, checked against A4 itself; when a newer
// release is looked for, as gh's active account; and every command the part runs, with stand-ins for VS Code.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeContext } from '../../packages/core/src/onboarding/helpers.ts';
import { type ClaudeList, parsePluginList, runSteps, userPlugin } from '../../packages/core/src/onboarding/steps.ts';
import { fakeRunner, ok, tempDir } from '../../packages/core/test/support.ts';
import { sampleAbout, sampleAboutBehind, sampleAboutFailed } from '../scripts/fixtures/about.ts';
import { About, type AboutDeps, activeAccountEnv, area as aboutArea, parsePlugins } from '../src/about.ts';
import { area as settingsArea } from '../src/settings.ts';
import type { RunResult } from '../src/run.ts';
import { ABOUT_COMMANDS, type AboutFacts, aboutModel, area as aboutModelArea, parseAccVersion, parseRelease, RELEASE_ARGS, RELEASE_EVERY_MS, releaseDue, releaseNewer, RELEASES_REPO } from '../src/model/about.ts';
import { homeModel } from '../src/model/home.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import type { Look } from '../src/model/shared.ts';
import { hub } from './support.ts';

const NOW = 1_800_000_000_000;
const TONES = new Set(['orange', 'blue', 'neutral']);

/** Every state has an icon and words, and is orange, blue or neutral: never red against green. */
function looksRight(look: Look, where: string): void {
  assert.ok(look.icon && look.label.length > 3, `${where}: an icon and a label`);
  assert.ok(TONES.has(look.tone), `${where}: ${look.tone}`);
}

const facts = (over: Partial<AboutFacts> = {}): AboutFacts => ({ ...sampleAbout(NOW), ...over });
const plugin = (version: string | null, enabled = true): AboutFacts['plugin'] => ({ ok: true, value: { version, enabled } });
const pluginRow = (f: AboutFacts) => aboutModel(f, NOW).rows.find((r) => r.key === 'plugin')!;

test('About lists acc, the extension and the plugin, each with where it\'s read from, then the latest release', () => {
  const m = aboutModel(sampleAbout(NOW), NOW);
  assert.deepEqual(m.rows.map((r) => [r.key, r.name, r.look.label, r.look.tone, r.from.label]), [
    ['acc', 'The command-line engine', '0.37.0', 'blue', 'Bundled with the extension'],
    ['extension', 'The extension', '0.37.0', 'blue', 'VSCode on this machine'],
    ['plugin', 'The Claude Code plugin', '0.37.0, the same as the extension', 'blue', 'Claude Code on this machine, for every session'],
  ]);
  assert.deepEqual([m.release.look.label, m.release.look.tone, m.release.notes], ['Up to date: 0.37.0 is the latest release', 'blue', null]);
  assert.equal(m.release.when, 'Looked 12 min ago, as gh\'s active account. Looked for again by itself, and when Settings opens, at most every 6 h, or now with Check now.');
  assert.equal(m.release.install, null, 'nothing to install when it\'s the latest');
  assert.deepEqual([m.release.check.command, m.release.check.label, m.release.check.disabled], ['acc.about.check', 'Check now', null]);
  assert.ok(m.rows.every((r) => r.action === null), 'nothing to do when everything is current');
});

test('a newer release is said in orange, with a link to its notes', () => {
  const m = aboutModel(sampleAboutBehind(NOW), NOW);
  assert.deepEqual([m.release.look.label, m.release.look.icon, m.release.look.tone], ['0.38.0 is out: this is 0.37.0', 'arrow-circle-up', 'orange']);
  assert.deepEqual(m.release.notes, { label: 'Read v0.38.0\'s notes', url: 'https://github.com/jack-huffman/agent-command-center/releases/tag/v0.38.0' });
  assert.equal(m.release.when.split('.')[0], 'Looked just now, as gh\'s active account');
  // Install and reload (T-62), the extension's own update, for that version, named for what it shows.
  assert.deepEqual(m.release.install, { command: 'acc.update.install', label: 'Install and reload', icon: 'cloud-download', arg: '0.38.0', name: 'Install and reload: 0.38.0, then the Command Center opens on it', primary: true, disabled: null });
  assert.ok(m.release.install!.name.includes(m.release.install!.label));
  // An older release, or one that isn't x.y.z, isn't newer: nothing to say, and no notes.
  const older = aboutModel(facts({ release: { ok: true, value: { version: '0.36.0', tag: 'v0.36.0', name: 'v0.36.0', url: 'https://github.com/x/y' } } }), NOW);
  assert.deepEqual([older.release.look.tone, older.release.notes, older.release.install], ['blue', null, null]);
  assert.deepEqual([releaseNewer('0.38.0', '0.37.0'), releaseNewer('0.10.0', '0.9.0'), releaseNewer('0.37.0', '0.37.0'), releaseNewer('nightly', '0.37.0'), releaseNewer('0.38.0', '')], [true, true, false, false, false]);
});

test('a look that fails reads neutral, not as a problem; so do none yet and no release yet; looking is blue, and Check now waits for it', () => {
  const failed = aboutModel(sampleAboutFailed(NOW), NOW);
  assert.deepEqual([failed.release.look.label, failed.release.look.tone, failed.release.notes], ['Couldn\'t look: error connecting to api.github.com', 'neutral', null]);
  assert.equal(failed.release.when.split('.')[0], 'Looked 3 h ago, as gh\'s active account');
  // While the versions are read again, each says so.
  assert.deepEqual(failed.rows.filter((r) => r.key !== 'extension').map((r) => [r.look.label, r.look.icon, r.look.tone]), [['Reading it', 'sync~spin', 'blue'], ['Reading it', 'sync~spin', 'blue']]);
  assert.equal(failed.release.install, null, 'a failed look offers nothing to install');
  const none = aboutModel(facts({ release: null, checkedAt: null }), NOW).release;
  assert.deepEqual([none.look.label, none.look.tone, none.when.split('.')[0]], ['Not looked for yet', 'neutral', 'Looked for as gh\'s active account']);
  assert.deepEqual([aboutModel(facts({ release: { ok: true, value: null } }), NOW).release.look.label], ['No release yet']);
  const looking = aboutModel(facts({ checking: true }), NOW).release;
  assert.deepEqual([looking.look.icon, looking.look.tone, looking.check.disabled], ['sync~spin', 'blue', 'It\'s looking now.']);
  // acc that won't run is neutral too, and one that isn't the extension's says to reload.
  assert.equal(aboutModel(facts({ acc: { ok: false, error: 'boom' } }), NOW).rows[0]!.look.tone, 'neutral');
  assert.match(aboutModel(facts({ acc: { ok: true, value: '0.36.0' } }), NOW).rows[0]!.meaning!, /reload VSCode's window/);
});

test('an older plugin than the extension is said in orange, with Setup\'s own A4 fix', () => {
  const behind = pluginRow(sampleAboutBehind(NOW));
  assert.deepEqual([behind.look.label, behind.look.tone], ['0.36.0, older than the extension\'s 0.37.0', 'orange']);
  assert.deepEqual(behind.action, { command: 'acc.step.fix', label: 'Update the plugin', icon: 'tools', arg: 'A4.plugin', name: 'Update the plugin to 0.37.0: the Command Center\'s Claude Code plugin, as Setup\'s A4 does', primary: true, disabled: null });
  // A newer plugin is fine, as A4 says (D-088).
  assert.deepEqual([pluginRow(facts({ plugin: plugin('0.38.0') })).look.tone, pluginRow(facts({ plugin: plugin('0.38.0') })).action], ['blue', null]);
  // Not installed, turned off, or no Claude Code: orange, and A4's fix, whatever it turns out to be.
  const states = [
    [{ ok: true, value: null }, 'Not installed in Claude Code', 'Install'],
    [plugin('0.37.0', false), '0.37.0, turned off', 'Turn on'],
    [{ ok: false, error: 'claude isn\'t installed', missing: true }, 'Claude Code isn\'t installed', 'Install'],
  ] as const;
  for (const [p, label, button] of states) {
    const r = pluginRow(facts({ plugin: p as AboutFacts['plugin'] }));
    assert.deepEqual([r.look.label, r.look.tone, r.action?.command, r.action?.arg, r.action?.label], [label, 'orange', 'acc.step.fix', 'A4.plugin', button]);
  }
  // Plugins that can't be read are neutral, with nothing to click.
  const unread = pluginRow(facts({ plugin: { ok: false, error: 'exit 1' } }));
  assert.deepEqual([unread.look.tone, unread.action], ['neutral', null]);
});

test('About and A4 compare the plugin the same way: About is orange exactly when A4 fails it for being older', () => {
  const ACC = { id: 'acc@agent-command-center', scope: 'user', enabled: true };
  const a4 = (pluginVersion: unknown, acc: string) => {
    const f = { 'claude plugin list --json': ok(JSON.stringify([{ ...ACC, version: pluginVersion }])), 'claude plugin marketplace list --json': ok('[]') };
    return runSteps(makeContext(tempDir(), fakeRunner(f), { ...process.env, CLAUDE_CONFIG_DIR: tempDir('claude-state-') }, acc), 'machine', ['A4.plugin'])[0]!.result.status;
  };
  const pairs: [string | null, string][] = [['0.36.0', '0.37.0'], ['0.37.0', '0.37.0'], ['0.38.0', '0.37.0'], ['0.9.0', '0.10.0'], ['0.10.0', '0.9.0'], ['0.37', '0.37.0'], ['9d655cb', '0.37.0'], [null, '0.37.0'], ['1.0.0', '0.99.9']];
  let compared = 0;
  for (const [p, ext] of pairs) {
    const about = pluginRow(facts({ extension: ext, plugin: plugin(p) })).look.tone === 'orange';
    assert.equal(about, a4(p ?? undefined, ext) === 'fail', `plugin ${p} against ${ext}`);
    compared++;
  }
  assert.equal(compared, pairs.length);
  assert.ok(pairs.some(([p, e]) => pluginRow(facts({ extension: e, plugin: plugin(p) })).look.tone === 'orange'), 'some pair is older, so the check can fail');
});

test('gh\'s and claude\'s answers, read as A4 reads them', () => {
  const release = (j: unknown): RunResult => ({ code: 0, stdout: JSON.stringify(j), stderr: '' });
  assert.deepEqual(parseRelease(release({ tagName: 'v0.38.0', name: 'v0.38.0', url: 'https://github.com/jack-huffman/agent-command-center/releases/tag/v0.38.0', publishedAt: '2026-10-08T00:00:00Z' })),
    { ok: true, value: { version: '0.38.0', tag: 'v0.38.0', name: 'v0.38.0', url: 'https://github.com/jack-huffman/agent-command-center/releases/tag/v0.38.0' } });
  assert.deepEqual(parseRelease(release({ tagName: '0.38.0', name: '', url: 'https://github.com/a/b' })), { ok: true, value: { version: '0.38.0', tag: '0.38.0', name: '0.38.0', url: 'https://github.com/a/b' } });
  assert.deepEqual(parseRelease({ code: 1, stdout: '', stderr: 'release not found\n' }), { ok: true, value: null }, 'no release yet');
  assert.deepEqual(parseRelease({ code: 1, stdout: '', stderr: 'HTTP 404: Not Found\nmore' }), { ok: false, error: 'HTTP 404: Not Found' });
  assert.deepEqual(parseRelease({ code: 127, stdout: '', stderr: '' }), { ok: false, error: 'gh isn\'t installed' });
  assert.equal(parseRelease(release({ tagName: 'v1.0.0', url: 'javascript:alert(1)' })).ok, false, 'only a page on GitHub is linked');
  assert.equal(parseRelease({ code: 0, stdout: 'not json', stderr: '' }).ok, false);
  assert.deepEqual(RELEASE_ARGS, ['release', 'view', '--repo', 'jack-huffman/agent-command-center', '--json', 'tagName,name,url,publishedAt']);
  assert.equal(RELEASES_REPO, 'jack-huffman/agent-command-center');
  assert.deepEqual(parseAccVersion({ code: 0, stdout: '0.37.0\n', stderr: '' }), { ok: true, value: '0.37.0' });
  assert.equal(parseAccVersion({ code: 1, stdout: '', stderr: 'node: bad option' }).ok, false);
  const list = (l: unknown): RunResult => ({ code: 0, stdout: JSON.stringify(l), stderr: '' });
  assert.deepEqual(parsePlugins(list([{ id: 'acc@agent-command-center', scope: 'project', version: '0.1.0', enabled: true }, { id: 'acc@agent-command-center', scope: 'user', version: '0.37.0', enabled: true }])), { ok: true, value: { version: '0.37.0', enabled: true } });
  assert.deepEqual(parsePlugins(list([{ id: 'acc@agent-command-center', scope: 'project' }])), { ok: true, value: null }, 'one project\'s install isn\'t every session\'s');
  assert.deepEqual(parsePlugins({ code: 127, stdout: '', stderr: '' }), { ok: false, error: 'claude isn\'t installed.', missing: true });
  assert.equal(parsePlugins({ code: 0, stdout: '{}', stderr: '' }).ok, false);
});

test('About and A4 read the plugin list through one parser, and say each way it fails in the same words (GH-147)', () => {
  const ACC = { id: 'acc@agent-command-center', scope: 'user', version: '0.37.0', enabled: true };
  const a4 = (r: RunResult) => runSteps(makeContext(tempDir(), fakeRunner({ 'claude plugin list --json': r, 'claude plugin marketplace list --json': ok('[]') }), { ...process.env, CLAUDE_CONFIG_DIR: tempDir('claude-state-') }, '0.37.0'), 'machine', ['A4.plugin'])[0]!.result;
  const cases: [string, RunResult, ClaudeList][] = [
    ['claude isn\'t installed', { code: 127, stdout: '', stderr: 'not found' }, { ok: false, missing: true, error: 'claude isn\'t installed.' }],
    ['exits with an error', { code: 1, stdout: '', stderr: 'error: unknown option \'--json\'\nmore' }, { ok: false, missing: false, error: 'claude plugin list didn\'t run: error: unknown option \'--json\'' }],
    ['exits, saying it on stdout', { code: 2, stdout: 'Not logged in\n', stderr: '' }, { ok: false, missing: false, error: 'claude plugin list didn\'t run: Not logged in' }],
    ['exits, saying nothing', { code: 3, stdout: '', stderr: '' }, { ok: false, missing: false, error: 'claude plugin list didn\'t run: exit 3' }],
    ['prints text', ok('Installed plugins:\n  acc'), { ok: false, missing: false, error: 'claude plugin list printed something other than a list.' }],
    ['prints an object', ok('{"id":"acc@agent-command-center"}'), { ok: false, missing: false, error: 'claude plugin list printed something other than a list.' }],
    ['prints a list of numbers', ok('[1, 2]'), { ok: false, missing: false, error: 'claude plugin list printed something other than a list.' }],
    ['prints a list of nulls', ok('[null]'), { ok: false, missing: false, error: 'claude plugin list printed something other than a list.' }],
    ['lists no plugins', ok('[]'), { ok: true, list: [] }],
    ['lists acc', ok(JSON.stringify([ACC])), { ok: true, list: [ACC] }],
  ];
  let ran = 0;
  for (const [name, r, want] of cases) {
    assert.deepEqual(parsePluginList(r), want, name);
    const setup = a4(r);
    const about = parsePlugins(r);
    const row = pluginRow(facts({ plugin: about }));
    if (want.ok) {
      assert.deepEqual(about, { ok: true, value: userPlugin(want.list) }, name);
      assert.notEqual(setup.status, 'unknown', name);
    } else if (want.missing) {
      // Both send the person to install Claude Code: A4 as its fix, About as A4's.
      assert.deepEqual([setup.status, setup.detail, about], ['fail', `${want.error} Do A1.claude first.`, { ok: false, missing: true, error: want.error }], name);
      assert.deepEqual([row.look.label, row.action?.arg], ['Claude Code isn\'t installed', 'A4.plugin'], name);
    } else {
      // The same words in Setup's A4 and in About's row.
      assert.deepEqual([setup.status, setup.detail], ['unknown', `Couldn't read Claude Code's plugins: ${want.error}`], name);
      assert.deepEqual([row.look.label, row.look.tone, row.action], [setup.detail, 'neutral', null], name);
    }
    ran++;
  }
  assert.equal(ran, cases.length);
  assert.ok(cases.some(([, , w]) => !w.ok && !w.missing) && cases.some(([, , w]) => !w.ok && w.missing) && cases.some(([, , w]) => w.ok), 'every way it reads is a case');
});

test('gh is asked as its active account: a token in the environment, which would win, is left out', () => {
  const env = activeAccountEnv({ PATH: '/bin', GH_TOKEN: 'a', GITHUB_TOKEN: 'b', GH_ENTERPRISE_TOKEN: 'c', GITHUB_ENTERPRISE_TOKEN: 'd', HOME: '/h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
});

/** About with stand-ins: what each program was asked, with what env, and a clock to move. */
function stand(gh: () => RunResult = () => ({ code: 0, stdout: JSON.stringify({ tagName: 'v0.38.0', name: 'v0.38.0', url: 'https://github.com/x/y/releases/tag/v0.38.0' }), stderr: '' })) {
  const calls: { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  let now = NOW;
  let redraws = 0;
  const d: AboutDeps = {
    extension: () => '0.37.0',
    acc: async () => { calls.push({ cmd: 'acc', args: ['--version'] }); return { code: 0, stdout: '0.37.0\n', stderr: '' }; },
    run: async (cmd, args, env) => {
      calls.push({ cmd, args, env });
      return cmd === 'gh' ? gh() : { code: 0, stdout: JSON.stringify([{ id: 'acc@agent-command-center', scope: 'user', version: '0.36.0', enabled: true }]), stderr: '' };
    },
    now: () => now,
    auto: () => true,
    changed: () => { redraws++; },
    env: { PATH: '/bin', GH_TOKEN: 'project-account' },
  };
  return { about: new About(d), calls, tick: (ms: number) => { now += ms; }, redraws: () => redraws, names: () => calls.map((c) => c.cmd) };
}

test('Settings first shown in a session reads the versions and looks for a release; after that, a release at most every 6 hours', async () => {
  const s = stand();
  assert.deepEqual([s.about.facts().acc, s.about.facts().plugin, s.about.facts().release], [null, null, null], 'nothing read before Settings shows');
  await s.about.arrive();
  assert.deepEqual(s.names(), ['acc', 'claude', 'gh']);
  const f = s.about.facts();
  assert.deepEqual([f.acc, f.plugin, f.release?.ok, f.checkedAt, f.reading, f.checking], [{ ok: true, value: '0.37.0' }, { ok: true, value: { version: '0.36.0', enabled: true } }, true, NOW, false, false]);
  assert.deepEqual(s.calls.find((c) => c.cmd === 'gh')!.args, RELEASE_ARGS);
  assert.equal(s.calls.find((c) => c.cmd === 'gh')!.env!.GH_TOKEN, undefined, 'as gh\'s active account, not a project\'s');
  assert.ok(s.redraws() >= 2, 'the page redraws as it reads, and when it\'s done');
  // Arriving again reads the versions fresh, but doesn't look for a release until six hours have passed.
  s.tick(RELEASE_EVERY_MS - 1);
  await s.about.arrive();
  assert.deepEqual(s.names(), ['acc', 'claude', 'gh', 'acc', 'claude']);
  s.tick(1);
  await s.about.arrive();
  assert.deepEqual(s.names().filter((n) => n === 'gh').length, 2);
  // Check now looks whenever it's asked.
  await s.about.checkNow();
  assert.deepEqual(s.names().filter((n) => n === 'gh').length, 3);
  assert.deepEqual([releaseDue(null, 0), releaseDue(0, RELEASE_EVERY_MS - 1), releaseDue(0, RELEASE_EVERY_MS)], [true, false, true]);
});

test('reads already going aren\'t started twice, and a look that throws is neutral and waits its six hours', async () => {
  const s = stand(() => { throw new Error('spawn gh EACCES'); });
  await Promise.all([s.about.arrive(), s.about.arrive(), s.about.checkNow()]);
  assert.deepEqual(s.names(), ['acc', 'claude', 'gh']);
  assert.deepEqual([s.about.facts().release, s.about.facts().checkedAt], [{ ok: false, error: 'spawn gh EACCES' }, NOW]);
  assert.equal(aboutModel(s.about.facts(), NOW).release.look.tone, 'neutral');
});

test('every command About runs is one the page may ask for, and each does what it says', async () => {
  const m = aboutModel(sampleAboutBehind(NOW), NOW);
  const commands = [m.release.check.command, ...m.rows.flatMap((r) => (r.action ? [r.action.command] : []))];
  const install = m.release.install!.command;
  assert.deepEqual([...commands, install], ['acc.about.check', 'acc.step.fix', 'acc.update.install']);
  for (const c of [...commands, install]) assert.ok(PAGE_COMMANDS.includes(c), `${c} may be asked for by the page`);
  assert.deepEqual(aboutModelArea.commands, [ABOUT_COMMANDS.check, ABOUT_COMMANDS.install], 'About claims Check now and Install and reload; Setup claims its own fix');
  // acc.about.check runs Check now; Settings' Refresh reads About again, as arriving does, with the projects.
  const did: string[] = [];
  const reg = new Map<string, (...a: unknown[]) => unknown>();
  const about = { checkNow: async () => { did.push('checkNow'); }, arrive: async () => { did.push('arrive'); } };
  const parts = {
    reg: (id: string, fn: (...a: unknown[]) => unknown) => reg.set(id, fn), about, subscribe: () => {},
    vscode: { workspace: { getConfiguration: () => ({ get: () => 'vscode' }), onDidChangeConfiguration: () => ({ dispose() {} }) }, window: {} },
    hub: { loadProjects: async () => { did.push('projects'); } }, identity: { refresh: async () => { did.push('identity'); } },
  };
  aboutArea.register!(parts as never);
  settingsArea.register!(parts as never);
  await reg.get('acc.about.check')!();
  assert.deepEqual(did, ['checkNow']);
  await reg.get('acc.settings.refresh')!();
  assert.deepEqual(did.slice(1).sort(), ['arrive', 'identity', 'projects']);
});

test('About is a built part of Settings, drawn from what the extension read, with every state looking right', () => {
  const home = (about: AboutFacts | null) => homeModel({ hub: hub(), section: 'settings', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() }, about, now: NOW });
  const part = home(null).settings.parts.find((p) => p.id === 'about')!;
  assert.deepEqual([part.built, part.today, part.links], [true, null, []]);
  assert.equal(home(null).settings.about, null, 'reading: the page says so');
  for (const f of [sampleAbout(NOW), sampleAboutBehind(NOW), sampleAboutFailed(NOW), facts({ release: null, checkedAt: null, checking: true }), facts({ plugin: { ok: true, value: null } })]) {
    const m = home(f).settings.about!;
    for (const r of m.rows) looksRight(r.look, `${r.key}: ${r.look.label}`);
    looksRight(m.release.look, `release: ${m.release.look.label}`);
  }
});

test('Check now shows that it\'s looking while it looks: the first redraw already has it under way (GH-114)', async () => {
  const s = stand();
  const seen: [boolean, boolean][] = [];
  // Each redraw, what the page would draw from.
  (s.about as unknown as { d: { changed: () => void } }).d.changed = () => { const f = s.about.facts(); seen.push([f.reading, f.checking]); };
  await s.about.checkNow();
  assert.deepEqual(seen[0], [true, false], 'reading the versions');
  assert.deepEqual(seen[1], [true, true], 'and looking on GitHub');
  assert.deepEqual(seen.at(-1), [false, false], 'then done');
});

test('with looking by itself off in the settings, About says so, and Check now still looks (T-62)', () => {
  const off = aboutModel(facts({ auto: false }), NOW).release;
  assert.equal(off.when, 'Looked 12 min ago, as gh\'s active account. Looking by itself is off in VSCode\'s settings: looked for when Settings opens, at most every 6 h, or now with Check now.');
  assert.equal(off.check.disabled, null);
});

test('the look by itself shares About\'s look: one going isn\'t asked twice, one not due asks nothing, and each look is heard (T-62)', async () => {
  const s = stand();
  const heard: unknown[] = [];
  s.about.onLooked((r) => heard.push(r));
  await Promise.all([s.about.lookIfDue(), s.about.arrive(), s.about.lookIfDue()]);
  assert.deepEqual(s.names().filter((n) => n === 'gh').length, 1, 'one look for all three');
  assert.equal(heard.length, 1);
  assert.equal((heard[0] as { ok: boolean }).ok, true);
  // Not due yet: nothing asked, nothing heard. Check now always asks, and is heard too.
  s.tick(RELEASE_EVERY_MS - 1);
  await s.about.lookIfDue();
  assert.equal(s.names().filter((n) => n === 'gh').length, 1);
  await s.about.checkNow();
  assert.deepEqual([s.names().filter((n) => n === 'gh').length, heard.length], [2, 2]);
  assert.equal(s.about.facts().auto, true);
});
