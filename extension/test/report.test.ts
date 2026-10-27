// Report a problem (T-118): its command, what the draft attaches, the draft's states with an icon and words in
// orange or blue, and the post, with a stand-in gh: nothing runs before Post, Post runs gh issue create on the
// Command Center's repo with the body on stdin and shows the link, and where gh isn't signed in or can't reach
// the repo, the draft says so and offers Copy the issue text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sampleAbout } from '../scripts/fixtures/about.ts';
import { sampleReport, SAMPLE_REPORT_FACTS } from '../scripts/fixtures/report.ts';
import { aboutModel, reportAction, RELEASES_REPO } from '../src/model/about.ts';
import { isFromWebview, PAGE_COMMANDS } from '../src/model/messages.ts';
import { paletteItems } from '../src/model/palette.ts';
import { area as reportModelArea, attachedText, issueArgs, NO_ACCESS_OFF, NOT_POSTED, parsePost, REPORT_BODY_MAX, REPORT_COMMAND, REPORT_POSTING, REPORT_TITLE, REPORT_TITLE_MAX, type ReportFacts, type ReportModel, reportModel } from '../src/model/report.ts';
import { setupModel } from '../src/model/setup.ts';
import { ERROR_LINES, type ReportDeps, Reports, runError, stepArg } from '../src/report.ts';
import type { RunResult } from '../src/run.ts';
import { scrubContext } from '../src/logic/scrub.ts';

const TONES = new Set(['orange', 'blue']);
const ISSUE = `https://github.com/${RELEASES_REPO}/issues/7`;

/** A stand-in for the extension: gh answers as told, and every call is kept. */
function standIn(answer: RunResult | (() => Promise<RunResult>) = { code: 0, stdout: `${ISSUE}\n`, stderr: '' }, facts: Partial<ReportFacts> = {}) {
  const calls = { gh: [] as { args: string[]; input: string }[], shown: [] as ReportModel[], redrawn: [] as ReportModel[], said: [] as string[], copied: [] as string[], facts: [] as (string | null)[] };
  const d: ReportDeps = {
    facts: async (step) => { calls.facts.push(step); return { ...SAMPLE_REPORT_FACTS, ...facts }; },
    scrubContext: () => scrubContext('/Users/me', 'me', [{ root: '/Users/me/code/acme-service', config: { project: 'Acme Service', github: null, commitIdentity: null, environments: [], trackers: [] } as never }]),
    gh: async (args, input) => { calls.gh.push({ args, input }); return typeof answer === 'function' ? answer() : answer; },
    copy: async (text) => { calls.copied.push(text); },
    show: (m) => calls.shown.push(m),
    redraw: (m) => calls.redrawn.push(m),
    say: (t) => calls.said.push(t),
  };
  return { reports: new Reports(d), calls };
}

test('Report a problem is a command with an id, what it takes, and whether it can run with why not', () => {
  assert.equal(REPORT_COMMAND.id, 'acc.report');
  assert.ok(REPORT_COMMAND.params.length > 20 && REPORT_COMMAND.params.includes('Setup step'), REPORT_COMMAND.params);
  assert.deepEqual(REPORT_COMMAND.enabled({ posting: false }), { ok: true });
  assert.deepEqual(REPORT_COMMAND.enabled({ posting: true }), { ok: false, why: REPORT_POSTING });
  // The page may ask for it (Settings' About, a failed step), and VSCode's Command Palette lists it.
  assert.ok(PAGE_COMMANDS.includes(REPORT_COMMAND.id));
  assert.deepEqual(reportModelArea.commands, [REPORT_COMMAND.id]);
  const contributed = JSON.parse(readFileSync(new URL('../commands/report-panel.json', import.meta.url), 'utf8')) as { command: string; title: string }[];
  assert.deepEqual(contributed.map((c) => c.command), [REPORT_COMMAND.id]);
  assert.ok(/Report a problem/.test(contributed[0]!.title));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { contributes: { commands: { command: string }[] } };
  assert.ok(pkg.contributes.commands.some((c) => c.command === REPORT_COMMAND.id), 'package.json contributes it');
});

test('the command opens the draft with the step it was passed: an id, or a ref with one; anything else opens a plain draft (edge case)', async () => {
  // stepArg is what the registered command reads its argument with: a step's row passes its id, or a ref.
  assert.deepEqual([stepArg('A4.plugin'), stepArg({ step: 'B6.org-match' }), stepArg(undefined), stepArg('rm -rf'), stepArg({ step: 3 })], ['A4.plugin', 'B6.org-match', null, null, null]);
  const { reports, calls } = standIn(undefined, { step: { id: 'A4.plugin', title: 'The plugin', status: 'fail', detail: 'Not installed' } });
  await reports.open({ step: 'A4.plugin' });
  assert.deepEqual(calls.facts, ['A4.plugin']);
  const m = calls.shown.at(-1)!;
  assert.equal(m.happened, 'Setup\'s step A4.plugin (The plugin) failed.');
  assert.ok(m.attached.includes('- The step it\'s about: A4.plugin (The plugin), fail: Not installed'), m.attached);
});

test('Settings\' About and the Command Center\'s palette offer Report a problem, off with its reason while a report posts', () => {
  const now = 1_800_000_000_000;
  const about = aboutModel(sampleAbout(now), now);
  assert.deepEqual([about.report.command, about.report.label, about.report.disabled], [REPORT_COMMAND.id, 'Report a problem', null]);
  assert.equal(aboutModel({ ...sampleAbout(now), reporting: true }, now).report.disabled, REPORT_POSTING);
  assert.deepEqual(reportAction({}), about.report);
  const home = { nav: [], settings: { parts: [], about }, tasks: { projects: [] }, agents: { repos: [], stopFinished: 0 }, overview: { projects: [] } } as never;
  const item = paletteItems(home).find((i) => i.id === 'action:report')!;
  assert.deepEqual([item.title, item.does, item.disabled], ['Report a problem', { kind: 'toolbar', command: REPORT_COMMAND.id }, undefined]);
  const off = paletteItems({ ...(home as object), settings: { parts: [], about: aboutModel({ ...sampleAbout(now), reporting: true }, now) } } as never).find((i) => i.id === 'action:report')!;
  assert.deepEqual([off.disabled, off.hint], [REPORT_POSTING, REPORT_POSTING]);
  // Before About is read, the palette still offers it, on.
  const none = paletteItems({ ...(home as object), settings: { parts: [], about: null } } as never).find((i) => i.id === 'action:report')!;
  assert.equal(none.disabled, undefined);
});

test('a failed Setup step offers Report a problem with its own id; a step that passed, can\'t be checked or doesn\'t apply doesn\'t (edge case)', () => {
  const m = setupModel([
    { id: 'A1.git', part: 'machine', title: 'git', status: 'fail', detail: 'too old' },
    { id: 'A1.gh', part: 'machine', title: 'gh', status: 'pass', detail: '' },
    { id: 'A2.gh-login', part: 'machine', title: 'login', status: 'unknown', detail: '' },
    { id: 'B8.tracking', part: 'project', title: 'tracking', status: 'skip', detail: '' },
  ], new Set());
  const report = (id: string) => m.parts.flatMap((p) => p.steps).find((s) => s.id === id)!.actions.find((a) => a.command === REPORT_COMMAND.id);
  assert.deepEqual(report('A1.git'), { command: REPORT_COMMAND.id, label: 'Report a problem', icon: 'report', ref: { step: 'A1.git' } });
  for (const id of ['A1.gh', 'A2.gh-login', 'B8.tracking']) assert.equal(report(id), undefined, id);
});

test('what\'s attached: the versions, the machine, VSCode, the profile, each Setup step\'s result and the last error', () => {
  const t = attachedText(SAMPLE_REPORT_FACTS);
  for (const line of ['- The extension: 0.42.0', '- The command-line engine: 0.42.0', '- The Claude Code plugin: 0.42.0', '- This machine: macOS 15.1', '- VSCode: 1.105.1', '- The project\'s profile: salesforce', '- Setup: A1.git pass, A1.gh pass, A2.gh-login pass, A4.plugin pass, B1.orgs pass, B6.org-match fail, B8.tracking skip', '- The last error:\n\n```\nRun the checks stopped with code 1.']) {
    assert.ok(t.includes(line), `${line} isn't in:\n${t}`);
  }
});

test('what\'s attached before anything is read, with no project, no error and nothing checked (edge case)', () => {
  const t = attachedText({ extension: '', acc: null, plugin: null, os: null, vscode: '', profile: null, setup: [], step: null, lastError: null });
  assert.equal(t, ['- The extension: unknown', '- The command-line engine: not read yet', '- The Claude Code plugin: not read yet', '- This machine: unknown', '- VSCode: unknown', '- The project\'s profile: no project open', '- Setup: not checked yet', '- The last error: none seen'].join('\n'));
  const failed = attachedText({ ...SAMPLE_REPORT_FACTS, acc: { ok: false, error: 'not found' }, plugin: { ok: false, error: 'no claude', missing: true }, lastError: 'a ``` fence' });
  assert.ok(failed.includes('engine: couldn\'t read it: not found') && failed.includes('plugin: Claude Code isn\'t installed'), failed);
  assert.ok(failed.includes("a ''' fence") && !failed.includes('a ``` fence'), 'an error\'s own fence can\'t close the block');
  for (const [p, want] of [[{ ok: true, value: null }, 'not installed'], [{ ok: true, value: { version: '1.0.0', enabled: false } }, '1.0.0, turned off'], [{ ok: false, error: 'bad json' }, 'couldn\'t read it: bad json']] as const) {
    assert.ok(attachedText({ ...SAMPLE_REPORT_FACTS, plugin: p }).includes(`plugin: ${want}`), want);
  }
});

test('the last error is a failed run\'s label and last lines, in process words; one that passed, was stopped or still runs isn\'t one (edge case)', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const e = runError({ label: 'Run the checks', code: 1, ok: false, stopped: false, lines: ['', ...lines], endedAt: 1 })!;
  assert.equal(e.split('\n')[0], 'Run the checks stopped with code 1.');
  assert.equal(e.split('\n').length, 1 + ERROR_LINES);
  assert.equal(e.split('\n').at(-1), 'line 19');
  assert.ok(!runError({ label: 'acc gate run', code: 1, ok: false, stopped: false, lines: ['acc gate run failed'], endedAt: 1 })!.includes('acc gate'), 'acc\'s commands are said as processes');
  assert.equal(runError({ label: 'x', code: 0, stopped: false, lines: [], endedAt: 1 }), null);
  assert.equal(runError({ label: 'x', code: 1, ok: true, stopped: false, lines: [], endedAt: 1 }), null);
  assert.equal(runError({ label: 'x', code: 1, ok: false, stopped: true, lines: [], endedAt: 1 }), null);
  assert.equal(runError({ label: 'x', code: null, stopped: false, lines: [], endedAt: null }), null);
  const { reports } = standIn();
  reports.heard({ id: '1', label: 'Run the checks', command: 'x', startedAt: 0, endedAt: 1, code: 2, ok: false, stopped: false, lines: ['boom'], prompt: null, step: null });
  reports.heard({ id: '2', label: 'Refresh', command: 'y', startedAt: 0, endedAt: 2, code: 0, stopped: false, lines: [], prompt: null, step: null });
  assert.equal(reports.lastError, 'Run the checks stopped with code 2.\nboom', 'a run that passed after it leaves the last error');
});

test('gh is asked for an issue on the Command Center\'s repo, the body read from stdin: never in an argument or a URL', () => {
  const args = issueArgs('It broke');
  assert.deepEqual(args, ['issue', 'create', '--repo', RELEASES_REPO, '--title', 'It broke', '--body-file', '-']);
  assert.ok(!args.some((a) => /^https?:/.test(a)));
});

test('gh\'s answers: the link, not signed in, no access, gh missing, and anything else (edge cases)', () => {
  assert.deepEqual(parsePost({ code: 0, stdout: `Creating issue in ${RELEASES_REPO}\n\n${ISSUE}\n`, stderr: '' }), { ok: true, url: ISSUE });
  assert.equal(parsePost({ code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }).ok === false && (parsePost({ code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }) as { why: string }).why, 'signed-out');
  for (const said of [`GraphQL: Could not resolve to a Repository with the name '${RELEASES_REPO}'. (repository)`, 'HTTP 404: Not Found', 'HTTP 403: Resource not accessible by integration', 'the repository has disabled issues']) {
    assert.equal((parsePost({ code: 1, stdout: '', stderr: said }) as { why: string }).why, 'no-access', said);
  }
  assert.deepEqual(parsePost({ code: 127, stdout: '', stderr: 'spawn gh ENOENT' }), { ok: false, why: 'no-gh', said: 'spawn gh ENOENT' });
  assert.deepEqual(parsePost({ code: 1, stdout: '', stderr: 'Something else\nmore' }), { ok: false, why: 'failed', said: 'Something else' });
  assert.deepEqual(parsePost({ code: 1, stdout: '', stderr: '' }), { ok: false, why: 'failed', said: 'it stopped with code 1' });
  // Exit 0 without a link isn't a post: nothing says where it went.
  assert.equal(parsePost({ code: 0, stdout: 'done', stderr: '' }).ok, false);
});

test('opening the draft runs nothing on GitHub: gh runs only when Post is clicked, with the body on stdin, and the link shows', async () => {
  const { reports, calls } = standIn();
  await reports.open();
  assert.equal(calls.gh.length, 0, 'nothing is sent before Post');
  const opened = calls.shown.at(-1)!;
  assert.deepEqual([opened.kind, opened.title, opened.draft, opened.look, opened.url, opened.copy, opened.postOff], ['report', REPORT_TITLE, 1, null, null, false, null]);
  assert.ok(opened.attached.includes('<project>') && !opened.attached.includes('/Users/me'), 'the draft shows its attached block scrubbed');
  assert.ok(opened.scrubbed?.startsWith('Replaced '), opened.scrubbed ?? '');
  const body = '### What happened\n\nIt broke\n';
  const going = reports.post('  It broke  ', body);
  assert.equal(calls.redrawn.at(-1)!.posting, true, 'it says it\'s posting while gh runs');
  assert.equal(calls.redrawn.at(-1)!.postOff, 'It\'s posting now.');
  assert.equal(reports.posting, true);
  await going;
  assert.deepEqual(calls.gh, [{ args: issueArgs('It broke'), input: body }]);
  const posted = calls.redrawn.at(-1)!;
  assert.deepEqual([posted.url, posted.look?.label, posted.look?.tone, posted.copy, posted.postOff], [ISSUE, 'Posted', 'blue', false, 'It\'s posted.']);
  // Posted once: a second click posts nothing more.
  await reports.post('It broke', body);
  assert.equal(calls.gh.length, 1);
});

test('Post clicked twice while gh runs posts once, and Report a problem then brings the posting draft forward instead of a new one (edge case)', async () => {
  let release!: (r: RunResult) => void;
  const { reports, calls } = standIn(() => new Promise((r) => { release = r; }));
  await reports.open();
  const first = reports.post('T', 'B');
  await reports.post('T', 'B');
  await reports.open();
  assert.deepEqual(calls.said, [REPORT_POSTING]);
  assert.equal(calls.shown.at(-1)!.draft, 1, 'still the same draft');
  assert.equal(calls.facts.length, 1, 'nothing is read again');
  release({ code: 0, stdout: ISSUE, stderr: '' });
  await first;
  assert.equal(calls.gh.length, 1);
  // Once it's posted, a new Report a problem is a new draft.
  await reports.open();
  assert.deepEqual([calls.shown.at(-1)!.draft, calls.shown.at(-1)!.url], [2, null]);
});

test('where gh isn\'t signed in, can\'t reach the repo or isn\'t installed, the draft says so in orange and offers Copy the issue text', async () => {
  const cases: [RunResult, keyof typeof NOT_POSTED][] = [
    [{ code: 4, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' }, 'signed-out'],
    [{ code: 1, stdout: '', stderr: `GraphQL: Could not resolve to a Repository with the name '${RELEASES_REPO}'.` }, 'no-access'],
    [{ code: 127, stdout: '', stderr: 'spawn gh ENOENT' }, 'no-gh'],
    [{ code: 1, stdout: '', stderr: 'timeout talking to /Users/me/code/acme-service' }, 'failed'],
  ];
  let checked = 0;
  for (const [answer, why] of cases) {
    const { reports, calls } = standIn(answer);
    await reports.open();
    await reports.post('T', 'B');
    const m = calls.redrawn.at(-1)!;
    assert.deepEqual([m.copy, m.url, m.look?.tone, m.look?.icon, m.postOff, m.meaning], [true, null, 'orange', 'warning', why === 'no-access' ? NO_ACCESS_OFF : null, NOT_POSTED[why].meaning], why);
    assert.ok(m.look!.label.startsWith(NOT_POSTED[why].label), m.look!.label);
    assert.ok(/copy the issue text/i.test(m.meaning ?? ''), why);
    assert.ok(!m.look!.label.includes('/Users/me'), 'what gh said is scrubbed too');
    await reports.copy('T\n\nB');
    assert.deepEqual(calls.copied, ['T\n\nB']);
    assert.deepEqual(calls.said, ['Copied the issue text.']);
    checked++;
  }
  assert.equal(checked, 4);
  // gh that throws is a failed post, not a lost one.
  const { reports, calls } = standIn(() => Promise.reject(new Error('spawn failed')));
  await reports.open();
  await reports.post('T', 'B');
  assert.equal(calls.redrawn.at(-1)!.copy, true);
});

test('every state of the draft has an icon and words, orange or blue, never red against green', () => {
  const states = [{ kind: 'posting' }, { kind: 'posted', url: ISSUE }, ...(Object.keys(NOT_POSTED) as (keyof typeof NOT_POSTED)[]).map((why) => ({ kind: 'not-posted', result: { ok: false, why, said: 'x' } }))] as const;
  for (const state of states) {
    const m = reportModel({ draft: 1, attached: '', scrubbed: null, happened: '', state: state as never });
    assert.ok(m.look && m.look.icon && m.look.label.length > 3 && TONES.has(m.look.tone), JSON.stringify(m.look));
  }
  // The fixtures the screenshot run draws are the model's own.
  assert.deepEqual(['report', 'report-filled', 'report-no-access', 'report-posted'].map((k) => sampleReport(k as never).look?.tone ?? null), [null, null, 'orange', 'blue']);
});

test('the page\'s messages: Post with a title and a body, Copy with text; empty, missing or too long ones are refused (edge cases)', () => {
  assert.ok(isFromWebview({ type: 'report-post', title: 'T', body: 'B' }));
  assert.ok(isFromWebview({ type: 'report-copy', text: 'T\n\nB' }));
  for (const bad of [
    { type: 'report-post', title: '', body: 'B' }, { type: 'report-post', title: '  ', body: 'B' }, { type: 'report-post', title: 'T', body: '' },
    { type: 'report-post', title: 'T' }, { type: 'report-post', title: 'x'.repeat(REPORT_TITLE_MAX + 1), body: 'B' }, { type: 'report-post', title: 'T', body: 'x'.repeat(REPORT_BODY_MAX + 1) },
    { type: 'report-copy', text: '' }, { type: 'report-copy', text: 3 },
  ]) assert.ok(!isFromWebview(bad), JSON.stringify(bad).slice(0, 80));
});
