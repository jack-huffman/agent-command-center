// The screenshot run's jobs (T-58): pages shared out so each is drawn once, drawn K at once with results in
// the pages' order, and the behaviour cases and mutants in a pool of K. Chrome isn't run here: a stand-in
// writes each PNG and prints a geometry dump, slower for some pages so jobs finish out of order.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_JOBS, inOrder, jobsOption, pool, type Ran, runAsync, runJobs, splitJobs } from '../scripts/jobs.ts';
import { chromeSaid, drawPages, type DrawnPages, FONTS, PAGES, type Page, profileArg, sampleModel, shotHeight } from '../scripts/screenshot.ts';
import { type BehaviourReport, behaviourCheck, CASES, MUTANTS } from '../scripts/behaviour.ts';
import type { GeoSnapshot } from '../scripts/geometry.ts';
import { pool as testPool, PoolError, tempDir } from '../../packages/core/test/support.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('the job splitter puts each page in one job only, keeps the pages\' order in each, and none is missing (T-58)', () => {
  const cost = (p: Page) => shotHeight(p, undefined);
  let checked = 0;
  for (const k of [1, 2, 3, 4, 7]) {
    const jobs = splitJobs(PAGES, k, cost);
    assert.equal(jobs.length, k);
    const all = jobs.flat();
    assert.equal(all.length, PAGES.length, `${k} jobs: each page once`);
    assert.deepEqual([...all].sort(), [...PAGES].sort(), `${k} jobs: no page missing, none twice`);
    for (const job of jobs) assert.deepEqual(job, PAGES.filter((p) => job.includes(p)), 'a job draws its pages in the pages\' order');
    checked += all.length;
  }
  assert.equal(checked, PAGES.length * 5);
  // Shared by how tall each is shot, the three jobs' loads are close: none more than the tallest page above another.
  const loads = splitJobs(PAGES, 3, cost).map((j) => j.reduce((n, p) => n + cost(p), 0));
  assert.ok(Math.max(...loads) - Math.min(...loads) <= Math.max(...PAGES.map(cost)), `loads ${loads.join(', ')}`);
});

test('the job splitter gives no jobs for an empty list, no more jobs than items, and takes k below 1 as one job (T-58)', () => {
  assert.deepEqual(splitJobs([], 3), []);
  assert.deepEqual(splitJobs(['a', 'b'], 5), [['a'], ['b']]);
  assert.deepEqual(splitJobs(['a', 'b', 'c'], 0), [['a', 'b', 'c']]);
  assert.deepEqual(splitJobs(['a', 'b', 'c'], Number.NaN), [['a', 'b', 'c']]);
  // The dearest first, each to the lightest job: the 5 alone in the first, and 3, 1, 1 together.
  assert.deepEqual(splitJobs([1, 5, 3, 1], 2, (n) => n), [[5], [1, 3, 1]]);
});

test('--jobs is DEFAULT_JOBS when unset, and refused when it isn\'t a whole number of 1 or more (T-58)', () => {
  assert.equal(DEFAULT_JOBS, 3);
  assert.equal(jobsOption(undefined), 3);
  assert.equal(jobsOption('1'), 1);
  assert.equal(jobsOption('8'), 8);
  for (const bad of ['0', '-2', '2.5', 'many', '', ' ', '1e2']) assert.equal(jobsOption(bad), null, `"${bad}"`);
});

test('results that finish out of order are handed on in their items\' order, none before those ahead of it (T-58)', () => {
  const got: [string, number][] = [];
  const done = inOrder<string>((r, i) => got.push([r, i]));
  done(2, 'c');
  done(1, 'b');
  assert.deepEqual(got, [], 'nothing yet: the first hasn\'t finished');
  done(0, 'a');
  done(3, 'd');
  assert.deepEqual(got, [['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
});

test('runJobs runs each job\'s items one after another and the jobs at once, and a job that fails waits for the others (T-58)', async () => {
  const items = ['slow', 'b', 'c', 'd', 'e', 'f'];
  let running = 0;
  let most = 0;
  const slotsBusy = new Set<number>();
  const order: string[] = [];
  const results = await runJobs(items, 3, async (item, slot) => {
    assert.ok(!slotsBusy.has(slot), `slot ${slot} used by two items at once`);
    slotsBusy.add(slot);
    most = Math.max(most, ++running);
    await wait(item === 'slow' ? 40 : 5);
    running--;
    slotsBusy.delete(slot);
    return item.toUpperCase();
  }, (r) => order.push(r));
  assert.deepEqual(results, ['SLOW', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(order, results, 'handed on in order, though the slow first finished last');
  assert.equal(most, 3);
  const finished: string[] = [];
  await assert.rejects(runJobs(['x', 'y', 'z'], 3, async (item) => {
    if (item === 'x') throw new Error('Chrome is not there');
    await wait(10);
    finished.push(item);
    return item;
  }), /Chrome is not there/);
  assert.deepEqual(finished.sort(), ['y', 'z'], 'the other jobs ran to their end before the failure was thrown');
});

test('a pool runs at most k at once, a slot never holds two items, and an empty list runs nothing (T-58)', async () => {
  let running = 0;
  let most = 0;
  const busy = new Set<number>();
  const logged: number[] = [];
  const out = await pool(Array.from({ length: 10 }, (_, i) => i), 3, async (n, slot, index) => {
    assert.equal(n, index);
    assert.ok(slot >= 0 && slot < 3);
    assert.ok(!busy.has(slot), `slot ${slot} used by two items at once`);
    busy.add(slot);
    most = Math.max(most, ++running);
    await wait(n % 3 === 0 ? 15 : 3);
    running--;
    busy.delete(slot);
    return n * 2;
  }, (r) => logged.push(r));
  assert.deepEqual(out, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  assert.deepEqual(logged, out);
  assert.equal(most, 3);
  let calls = 0;
  assert.deepEqual(await pool([], 3, async () => { calls++; return 1; }), []);
  assert.equal(calls, 0);
});

test('when an item fails, this pool still runs every item, and the test support\'s pool starts no more: why both stay (T-70)', async () => {
  // The screenshot run's pool gives each case and mutant its slot's own folders and lets every one run to its
  // end, so none is left running when the failure is thrown; the tests' pool stops at the first failure and names it.
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const ran: number[] = [];
  const slots = new Set<number>();
  await assert.rejects(pool(items, 2, async (n, slot) => {
    ran.push(n);
    slots.add(slot);
    await wait(5);
    if (n === 3) throw new Error('boom');
    return n;
  }), /boom/);
  assert.deepEqual(ran.sort((a, b) => a - b), items, 'every item ran, though item 3 failed');
  assert.deepEqual([...slots].sort(), [0, 1], 'each item was given its slot');
  const started: number[] = [];
  await assert.rejects(testPool(items, 2, async (n) => {
    started.push(n);
    await wait(5);
    if (n === 3) throw new Error('boom');
    return n;
  }), PoolError);
  assert.ok(started.length < items.length, `the tests' pool stopped after ${started.length} of ${items.length}`);
});

test('runAsync gathers what a program prints, times out with ETIMEDOUT, and fails with no program there (T-58)', async () => {
  const printed = await runAsync(process.execPath, ['-e', 'process.stdout.write("drawn"); process.exit(3)'], 10_000);
  assert.deepEqual({ status: printed.status, stdout: printed.stdout, error: printed.error }, { status: 3, stdout: 'drawn', error: undefined });
  const said = await runAsync(process.execPath, ['-e', 'process.stderr.write("no sandbox"); process.exit(5)'], 10_000);
  assert.deepEqual({ stdout: said.stdout, stderr: said.stderr }, { stdout: '', stderr: 'no sandbox' }, 'what it says on stderr is kept apart (T-108)');
  const slow = await runAsync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 200);
  assert.equal((slow.error as NodeJS.ErrnoException | undefined)?.code, 'ETIMEDOUT');
  assert.equal(slow.signal, 'SIGTERM');
  const none = await runAsync(join(tmpdir(), 'no-such-chrome-t58'), [], 1000);
  assert.equal((none.error as NodeJS.ErrnoException | undefined)?.code, 'ENOENT');
});

/** A drawing's geometry as the page would dump it: agents at 620 px draws two buttons on top of each other. */
function dumped(view: string, width: number): string {
  const control = (what: string, x: number) => ({ what, text: what, box: { x, y: 60, w: 80, h: 24 }, inside: [], layer: null });
  const s: GeoSnapshot = {
    controls: view === 'agents' && width === 620 ? [control('button.a', 10), control('button.b', 40)] : [control('button.a', 10), control('button.b', 200)],
    texts: [{ what: 'span', text: `${view} words`, over: 0, ellipsis: false, titled: false, folded: false }],
    tab: { what: 'button.nav-item.on', box: { x: 10, y: 8, w: 110, h: 30 }, rail: { x: 0, y: 0, w: width, h: 46 } },
    doc: { scroll: width, view: width }, scrollers: [], said: [{ what: 'span', text: `${view} words`, work: null }],
    drawn: [`page-${view}`, `w${width}`], fonts: 2, a11y: { violations: [], examined: 40 + width / 10, incomplete: [] },
  };
  return `<html><body><script type="application/json" id="acc-geometry">${JSON.stringify(s)}</script></body></html>`;
}

const arg = (args: string[], flag: string): string => args.find((a) => a.startsWith(`${flag}=`))!.slice(flag.length + 1);

/** Draws three pages with a stand-in Chrome; what it drew, the order drawings finished in, and what it saw of the profiles. */
async function drawThree(jobs: number, dies: string | null = null): Promise<{ drawn: DrawnPages; log: string[]; finished: string[]; most: number; profiles: Map<string, string[]>; out: string }> {
  const root = tempDir('acc-t58-');
  const work = join(root, 'work');
  const out = join(root, 'shots');
  const log: string[] = [];
  const finished: string[] = [];
  const profiles = new Map<string, string[]>();
  const busy = new Set<string>();
  let running = 0;
  let most = 0;
  let timedOut = false;
  const draw = async (args: string[]): Promise<Ran> => {
    const png = arg(args, '--screenshot');
    const name = png.split('/').at(-1)!;
    const [, view, width] = /^(.+)-(?:dark|light)-(\d+)\.png$/.exec(name)!;
    const profile = arg(args, '--user-data-dir');
    assert.ok(!busy.has(profile), `two Chromes at once in ${profile}`);
    busy.add(profile);
    profiles.set(name, [...(profiles.get(name) ?? []), profile]);
    most = Math.max(most, ++running);
    // The first page is the slowest, so the others finish first.
    await wait(view === 'tasks' ? 30 : 4);
    running--;
    busy.delete(profile);
    finished.push(name);
    if (name === 'agents-dark-500.png' && !timedOut) {
      timedOut = true;
      return { status: null, signal: 'SIGTERM', stdout: '', error: Object.assign(new Error('spawn nice ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
    }
    if (name === dies) return { status: null, signal: 'SIGSEGV', stdout: '' };
    writeFileSync(png, `png of ${name}`);
    return { status: 0, signal: null, stdout: dumped(view!, Number(width)) };
  };
  mkdirSync(work, { recursive: true });
  mkdirSync(out, { recursive: true });
  const drawn = await drawPages(['tasks', 'agents', 'settings-about'], { themes: ['dark', 'light'], widths: [1000, 620, 500], height: undefined, jobs, work, out, now: Date.UTC(2026, 0, 1), print: 'print', browser: { name: 'chrome-headless-shell', version: '155.0.8059.84' }, draw, log: (l) => log.push(l) });
  return { drawn, log: log.map((l) => l.replace(out, '<out>')), finished, most, profiles, out };
}

test('three pages drawn with --jobs 1 and --jobs 3 give the same findings, counts, log and record, in the pages\' order (T-58)', async () => {
  const one = await drawThree(1);
  const three = await drawThree(3);
  assert.equal(one.most, 1, '--jobs 1 draws one at a time');
  assert.equal(three.most, 3, '--jobs 3 draws three at once');
  assert.notDeepEqual(three.finished, one.finished, 'the jobs finished out of the pages\' order');
  for (const r of [one, three]) {
    assert.equal(r.drawn.renders.length, 18);
    assert.deepEqual(r.drawn.failures, []);
    assert.deepEqual(r.drawn.retried, ['agents (dark, 500px)']);
    assert.deepEqual(readdirSync(r.out).sort(), Object.keys(r.drawn.taken).sort(), 'every PNG moved out of its job\'s folder, and the folders gone');
  }
  const verdicts = (d: DrawnPages) => d.renders.map((r) => [r.page, r.theme, r.width, r.verdict.examined, r.verdict.violations]);
  assert.deepEqual(verdicts(three.drawn), verdicts(one.drawn));
  const found = three.drawn.renders.reduce((n, r) => n + r.verdict.violations.length, 0);
  assert.ok(found > 0, 'a finding to compare: agents at 620 px draws two buttons over each other');
  assert.deepEqual(three.log, one.log);
  assert.match(three.log[0]!, /^<out>\/tasks-dark-1000\.png {2}overlap /);
  assert.ok(three.log.some((l) => /agents \(dark, 500px\).*drawn once more/.test(l)));
  const record = (d: DrawnPages) => Object.entries(d.taken).map(([k, n]) => [k, n.sha256, n.findings, n.drawn, n.fingerprint, n.browser]);
  assert.deepEqual(record(three.drawn), record(one.drawn));
  // Each note names the browser that drew it, for the screenshots gate (T-68).
  assert.deepEqual([...new Set(Object.values(three.drawn.taken).map((n) => JSON.stringify(n.browser)))], ['{"name":"chrome-headless-shell","version":"155.0.8059.84"}']);
  // The drawing that timed out was drawn again in its own job, with its profile.
  const again = three.profiles.get('agents-dark-500.png')!;
  assert.equal(again.length, 2);
  assert.equal(again[0], again[1]);
  assert.equal(new Set([...three.profiles.values()].flat()).size, 3, 'three jobs, three profiles');
  for (const r of [one, three]) rmSync(join(r.out, '..'), { recursive: true, force: true });
});

test('a Chrome that dies fails its own drawing only, named, and the other drawings are drawn (T-58)', async () => {
  const r = await drawThree(3, 'settings-about-light-620.png');
  assert.deepEqual(r.drawn.failures.map((f) => f.replace(r.out, '<out>')), ['Chrome didn\'t write <out>/settings-about-light-620.png (exit SIGSEGV).']);
  assert.equal(r.drawn.renders.length, 17);
  assert.equal(Object.keys(r.drawn.taken).length, 17);
  assert.ok(!existsSync(join(r.out, 'settings-about-light-620.png')));
  assert.ok(existsSync(join(r.out, 'settings-about-light-500.png')), 'its job drew on after it');
  rmSync(join(r.out, '..'), { recursive: true, force: true });
});

test('a Chrome that can\'t start stops the run at its first drawings and says why in one line, from its stderr (T-108)', async () => {
  const root = tempDir('acc-t108-');
  const work = join(root, 'work');
  const out = join(root, 'shots');
  mkdirSync(work, { recursive: true });
  mkdirSync(out, { recursive: true });
  let calls = 0;
  const stderr = '[1022/101500.1:WARNING:dbus.cc(12)] no bus\n[1022/101500.2:FATAL:zygote_host_impl_linux.cc(128)] No usable sandbox!\n';
  const draw = async (): Promise<Ran> => { calls++; return { status: null, signal: 'SIGTRAP', stdout: '', stderr }; };
  const drawn = await drawPages(['tasks', 'agents', 'settings-about'], { themes: ['dark', 'light'], widths: [1000, 620, 500], height: undefined, jobs: 3, work, out, now: Date.UTC(2026, 0, 1), print: null, browser: { name: 'chrome-headless-shell', version: '155.0.8059.84' }, draw, log: () => {} });
  assert.equal(calls, 3, 'each job tried its first drawing, and none drew another');
  assert.match(drawn.cantStart ?? '', /^Chrome couldn't start: \S+ \(dark, 1000px\) exited SIGTRAP before any drawing was written, so the run stops\. Chrome said: \[1022\/101500\.2:FATAL:zygote_host_impl_linux\.cc\(128\)\] No usable sandbox!$/);
  assert.ok(!drawn.cantStart!.includes('\n'), 'one line');
  rmSync(root, { recursive: true, force: true });
});

test('chromeSaid picks the FATAL or ERROR line, else the last line, and says so when stderr is empty (T-108)', () => {
  assert.equal(chromeSaid('a\n[x:ERROR:y] broke\nlast\n'), '[x:ERROR:y] broke');
  assert.equal(chromeSaid('first\n  last  \n\n'), 'last');
  assert.equal(chromeSaid(''), 'Chrome printed nothing on stderr');
  assert.equal(chromeSaid(undefined), 'Chrome printed nothing on stderr');
  assert.equal(chromeSaid(`FATAL ${'x'.repeat(400)}`).length, 300);
});

test('a job\'s profile is its own folder under the run\'s work folder (T-58)', () => {
  assert.equal(profileArg('/tmp/w', 2), '--user-data-dir=/tmp/w/profile-2');
  assert.notEqual(profileArg('/tmp/w', 0), profileArg('/tmp/w', 1));
});

const report = (ok: boolean): BehaviourReport => ({ checks: [{ what: ok ? 'it works' : 'it broke', ok }], error: null, sent: [{ type: 'ready' }] });

/** The behaviour run with a stand-in Chrome: a case passes on the built page and fails on a mutant's. */
async function behaviourWith(jobs: number, mutants: typeof MUTANTS): Promise<{ failures: string[]; log: string[]; most: number; scripts: string[] }> {
  const work = tempDir('acc-t58-behaviour-');
  const log: string[] = [];
  const scripts: string[] = [];
  const busy = new Set<number>();
  let running = 0;
  let most = 0;
  try {
    const now = Date.UTC(2026, 9, 10, 12);
    const models = { tasks: sampleModel('tasks', now, 'dark'), overview: sampleModel('overview-landing', now, 'dark'), since: sampleModel('overview-since', now, 'dark'), ticket: sampleModel('ticket-questions', now, 'dark'), review: sampleModel('ticket-review', now, 'dark'), settings: sampleModel('settings-agents', now, 'dark'), connect: sampleModel('connect-start', now, 'dark'), agent: sampleModel('agent', now, 'dark'), dock: sampleModel('output-changes', now, 'dark'), run: sampleModel('output-failed', now, 'dark'), pages: sampleModel('overview-pages', now, 'dark'), conversation: sampleModel('conversation-start', now, 'dark'), beforePlan: sampleModel('ticket-conversation', now, 'dark'), talked: sampleModel('ticket-talk', now, 'dark'), report: sampleModel('report', now, 'dark') };
    const failures = await behaviourCheck({
      chrome: 'chrome', work, models, now, fonts: FONTS, jobs, log: (l) => log.push(l),
      run: async (_c, args, slot) => {
        assert.ok(!busy.has(slot), `slot ${slot} used by two cases at once`);
        busy.add(slot);
        most = Math.max(most, ++running);
        const page = readFileSync(fileURLToPath(args.at(-1)!), 'utf8');
        const script = /<script src="([^"]+)"><\/script><\/body>/.exec(page)![1]!;
        if (script !== 'webview/main.js') {
          assert.ok(existsSync(join(work, script)), `${script} was built before its cases ran`);
          scripts.push(script);
        }
        await wait(script === 'webview/main.js' ? (args.at(-1)!.endsWith('-0.html') ? 25 : 3) : 3);
        running--;
        busy.delete(slot);
        const r = report(script === 'webview/main.js');
        return { status: 0, signal: null, stdout: `<script type="application/json" id="acc-behaviour">${JSON.stringify(r)}</script>` };
      },
    }, mutants);
    return { failures, log, most, scripts };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test('the cases and mutants run in a pool of K, each mutant built into its own folder, logged as with one at a time (T-58)', async () => {
  const some = MUTANTS.slice(0, 4);
  const one = await behaviourWith(1, some);
  const three = await behaviourWith(3, some);
  assert.deepEqual(three.failures, []);
  assert.deepEqual(one.failures, []);
  assert.equal(one.most, 1);
  assert.equal(three.most, 3);
  assert.deepEqual(three.log, one.log);
  assert.equal(three.log.filter((l) => l.startsWith('pass  ')).length, CASES.length);
  assert.equal(three.log.filter((l) => /^mutant ".*": caught: /.test(l)).length, some.length);
  // Each mutant's bundle is in a folder of its own: mutant-<i>/main.js, never one another wrote.
  const folders = [...new Set(three.scripts)].sort();
  assert.deepEqual(folders, some.map((_, i) => `mutant-${i}/main.js`));
});
