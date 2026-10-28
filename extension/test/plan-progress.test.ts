// The planning agent's progress (T-131): each tool it uses in plain words, its transcript read a small part at a
// time from where the last read ended, only while on show, the time so far and since its last step, the stall at
// five minutes with Watch its session and Stop where they work, the typical time, and the block on the page.
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { PlansMaking } from '../src/logic/conversation.ts';
import { commandWords, feedLines, newFeed, type PlanJob, PlanWatch, type PlanWatchHost, READ_BYTES, readFeed, repoPath, stepOf } from '../src/logic/plan-progress.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { PROGRESS_LOOK, planProgress, type PlanProgressIn, STALL_MS, STEPS_SHOWN, typicalWords } from '../src/model/plan-progress.ts';
import type { RunInput } from '../src/model/runs.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { ticketTalk } from '../src/model/talk.ts';
import { planJob, planRun, TICK_MS } from '../src/plan-progress.ts';
import { sampleProgress } from '../scripts/fixtures/plan-progress.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const ROOT = '/Users/me/code/acme';
const NOW = Date.parse('2026-10-27T12:00:00Z');
const SEC = 1_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** An assistant record with one tool call at `at`. */
const use = (at: number, name: string, input: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(at), cwd: ROOT, message: { content: [{ type: 'tool_use', id: `u${at}`, name, input }] }, ...more });

// ---------------------------------------------------------------- each tool in plain words

test('each kind of tool is a step in plain words, with what the agent acted on as work data', () => {
  const s = (name: string, input: Record<string, unknown>, job: 'plan' | 'reply' = 'plan') => stepOf(name, input, [ROOT], job);
  assert.deepEqual(s('Read', { file_path: `${ROOT}/src/lead.ts` }), { kind: 'read', icon: 'file', words: 'Reading', data: 'src/lead.ts' }, 'a file, by its path in the repo');
  assert.deepEqual(s('Grep', { pattern: 'ContactRole', path: ROOT }), { kind: 'search', icon: 'search', words: 'Searching the code for', data: 'ContactRole' });
  assert.deepEqual(s('Glob', { pattern: '**/*.cls' }), { kind: 'find', icon: 'files', words: 'Looking for files named', data: '**/*.cls' });
  assert.deepEqual(s('Bash', { command: 'git log --oneline -5' }), { kind: 'command', icon: 'terminal', words: 'Reading the project\'s history', data: null });
  assert.deepEqual(s('WebFetch', { url: 'https://example.com/doc' }), { kind: 'web', icon: 'globe', words: 'Reading a web page', data: 'https://example.com/doc' });
  assert.deepEqual(s('WebSearch', { query: 'contact roles' }), { kind: 'web', icon: 'globe', words: 'Searching the web for', data: 'contact roles' });
  assert.equal(s('StructuredOutput', { verdict: 'ready' }).words, 'Writing the plan');
  assert.equal(s('StructuredOutput', { reply: 'x' }, 'reply').words, 'Writing its reply');
  assert.equal(s('Task', { description: 'look around' }).words, 'Asking a helper agent');
  assert.equal(s('Agent', {}).data, null, 'a helper\'s brief isn\'t shown');
});

test('edge cases: an unknown tool, an MCP tool and a tool with no input are steps with no words of the agent\'s; a path outside the repo shows its name only', () => {
  for (const name of ['SomethingNew', 'mcp__acme__read_records']) assert.deepEqual(stepOf(name, { secret: 'x' }, [ROOT], 'plan'), { kind: 'other', icon: 'tools', words: 'Using a tool', data: null }, name);
  assert.deepEqual(stepOf('Read', {}, [ROOT], 'plan'), { kind: 'read', icon: 'file', words: 'Reading a file', data: null });
  assert.deepEqual(stepOf('Grep', { pattern: '  ' }, [ROOT], 'plan').words, 'Searching the code', 'a blank search is no search text');
  assert.equal(stepOf('Glob', {}, [ROOT], 'plan').words, 'Looking for files');
  assert.equal(stepOf('WebSearch', {}, [ROOT], 'plan').words, 'Searching the web');
  assert.equal(repoPath('/Users/me/.claude/notes/brief.md', [ROOT]), 'brief.md', 'a home folder\'s path isn\'t shown');
  assert.equal(repoPath(`${ROOT}/a/b.ts`, ['/elsewhere', ROOT]), 'a/b.ts', 'the first root it\'s under');
  assert.equal(repoPath('src/x.ts', [ROOT]), 'src/x.ts', 'already relative');
});

test('a command is what it does, never its line: each analyst read, acc\'s own as its process, and anything else as running a command', () => {
  const cases: [string, string][] = [
    ['git log --oneline', 'Reading the project\'s history'], ['git show abc123', 'Reading an earlier change'], ['git diff main', 'Comparing versions of the code'],
    ['git grep -n ContactRole', 'Searching the code'], ['git ls-files force-app', 'Listing the project\'s files'],
    ['sf org display --target-org dev', 'Reading the org\'s details'], ['sf org list metadata-types', 'Listing the org\'s metadata'], ['sf data query -q "SELECT Id FROM Lead"', 'Querying the org\'s records'],
    ['sf sobject describe -s Lead', 'Reading the org\'s objects'], ['sf limits api display', 'Reading the org\'s limits'], ['sf project retrieve start -m ApexClass', 'Fetching metadata from the org'],
    ['sf apex get log -i 07L', 'Reading the org\'s debug logs'],
    ['cd "/Users/me/code/acme" && git log -3', 'Reading the project\'s history'], ['GIT_PAGER=cat git diff', 'Comparing versions of the code'],
    ['acc status', 'Running "Count the tasks"'],
    ['rm -rf /tmp/x', 'Running a command'], ['', 'Running a command'],
  ];
  for (const [line, words] of cases) {
    assert.equal(commandWords(line), words, line);
    if (line) assert.ok(!commandWords(line).includes(line), `no raw line: ${line}`);
  }
});

// ---------------------------------------------------------------- the transcript, read a little at a time

test('a feed keeps this job\'s tool calls in order: earlier records, lines that aren\'t JSON and a helper\'s own calls add no step, though a helper moving counts', () => {
  const feed = feedLines(newFeed(NOW, [ROOT], 'plan'), [
    use(NOW - 60 * SEC, 'Read', { file_path: `${ROOT}/old.ts` }),
    'not json',
    '',
    use(NOW + 2 * SEC, 'Read', { file_path: `${ROOT}/new.ts` }),
    JSON.stringify({ type: 'user', timestamp: iso(NOW + 3 * SEC), message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } }),
    use(NOW + 9 * SEC, 'Grep', { pattern: 'x' }, { isSidechain: true }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
  ]);
  assert.deepEqual(feed.steps.map((s) => [s.words, s.data, s.at]), [['Reading', 'new.ts', NOW + 2 * SEC]], 'a resumed session\'s earlier turns aren\'t this job\'s; a record with no time is skipped');
  assert.equal(feed.movedAt, NOW + 9 * SEC, 'a helper agent\'s step is the agent moving');
});

test('edge case: an empty transcript, and one not there, read nothing and show no step', () => {
  const dir = tempDir();
  const file = join(dir, 'empty.jsonl');
  writeFileSync(file, '');
  const feed = newFeed(NOW, [ROOT], 'plan');
  assert.equal(readFeed(feed, file), 0);
  assert.equal(readFeed(feed, join(dir, 'missing.jsonl')), 0);
  assert.deepEqual([feed.steps, feed.movedAt, feed.offset], [[], null, 0]);
});

test('edge case: a half-written last line waits for the rest of it, and is a step once whole', () => {
  const file = join(tempDir(), 's.jsonl');
  const line = use(NOW + SEC, 'Read', { file_path: `${ROOT}/a.ts` });
  writeFileSync(file, `${use(NOW, 'Glob', { pattern: '*.ts' })}\n${line.slice(0, 40)}`);
  const feed = newFeed(NOW, [ROOT], 'plan');
  readFeed(feed, file);
  assert.deepEqual(feed.steps.map((s) => s.words), ['Looking for files named'], 'the cut line isn\'t read as a record');
  appendFileSync(file, `${line.slice(40)}\n`);
  readFeed(feed, file);
  assert.deepEqual(feed.steps.map((s) => s.data), ['*.ts', 'a.ts']);
});

test('each read starts where the last ended and takes at most its share; a file that shrank is read from its start', () => {
  const file = join(tempDir(), 's.jsonl');
  const lines = Array.from({ length: 6 }, (_, i) => use(NOW + i * SEC, 'Read', { file_path: `${ROOT}/f${i}.ts` }));
  writeFileSync(file, `${lines.join('\n')}\n`);
  const feed = newFeed(NOW, [ROOT], 'plan');
  const share = lines[0]!.length * 2 + 10;
  readFeed(feed, file, share);
  const first = feed.steps.length;
  assert.ok(first >= 1 && first < 6, `a small read takes some lines only: ${first}`);
  let reads = 1;
  while (readFeed(feed, file, share) > 0) reads++;
  assert.deepEqual(feed.steps.map((s) => s.data), lines.map((_, i) => `f${i}.ts`), 'every step once, in order');
  assert.ok(reads > 2, `in small steps: ${reads} reads`);
  assert.ok(READ_BYTES >= 64 * 1024, 'a whole-size read passes a resumed session\'s earlier turns in a few ticks');
  truncateSync(file, 0);
  writeFileSync(file, `${use(NOW + 30 * SEC, 'Grep', { pattern: 'again' })}\n`);
  readFeed(feed, file);
  assert.deepEqual(feed.steps.map((s) => s.data), ['again'], 'started again');
});

// ---------------------------------------------------------------- what the progress says

const progressIn = (more: Partial<PlanProgressIn> = {}): PlanProgressIn => ({ job: 'plan', phase: 'working', startedAt: NOW - 125 * SEC, steps: [], movedAt: null, found: true, now: NOW, typicalMs: null, watch: true, stop: true, ...more });
const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'read' as const, icon: 'file', words: 'Reading', data: `f${i}.ts`, at: NOW - (100 - i * 10) * SEC }));

test('the progress says the time so far, the step now, the few before it newest first, and how long since its last step', () => {
  const p = planProgress(progressIn({ steps: steps(7), movedAt: NOW - 12 * SEC }));
  assert.equal(p.elapsed, '2 min 5 s so far');
  assert.deepEqual([p.now.data, p.now.ago], ['f6.ts', '40 s ago'], 'the newest step');
  assert.deepEqual(p.earlier.map((s) => s.data), ['f5.ts', 'f4.ts', 'f3.ts', 'f2.ts'], 'newest first');
  assert.equal(p.earlier.length, STEPS_SHOWN);
  assert.equal(p.last, 'Last step 12 s ago');
  assert.equal(p.heading, 'Making the plan');
  assert.deepEqual(p.look, PROGRESS_LOOK.working);
  assert.equal(p.stalled, null);
});

test('edge cases: before its first step a plan reads the ticket and a reply your message; while the ticket is read there are no steps and no stall', () => {
  const plan = planProgress(progressIn());
  assert.deepEqual([plan.now.words, plan.earlier, plan.last], ['Reading the ticket', [], null]);
  const reply = planProgress(progressIn({ job: 'reply' }));
  assert.deepEqual([reply.now.words, reply.heading], ['Reading your message', 'Writing its reply']);
  const reading = planProgress(progressIn({ phase: 'reading', steps: steps(3), startedAt: NOW - STALL_MS * 2 }));
  assert.deepEqual([reading.now.words, reading.earlier.length, reading.stalled], ['Reading the ticket, its comments too', 0, null], 'the Command Center reads it, not the agent');
});

test('a stall shows at STALL_MS since it last moved, not before, in orange, with Watch its session, and Stop only where it works', () => {
  assert.equal(STALL_MS, 5 * 60_000);
  const at = (quiet: number, more: Partial<PlanProgressIn> = {}) => planProgress(progressIn({ startedAt: NOW - 20 * 60_000, steps: steps(1), movedAt: NOW - quiet, ...more }));
  assert.equal(at(STALL_MS - 1).stalled, null, 'a moment before');
  const s = at(STALL_MS);
  assert.deepEqual(s.stalled, { words: 'The planning agent hasn\'t moved for 5 minutes.', watch: true, stop: true });
  assert.deepEqual(s.look, PROGRESS_LOOK.stalled);
  assert.equal(PROGRESS_LOOK.stalled.tone, 'orange');
  assert.equal(at(STALL_MS, { stop: false }).stalled?.stop, false, 'a run this window didn\'t start: no Stop');
  assert.equal(at(STALL_MS, { watch: false }).stalled?.watch, false, 'no session to watch');
  assert.equal(at(STALL_MS * 3, { found: false }).stalled, null, 'with no transcript found, nothing says it stalled');
  // With no step at all, the quiet counts from its start.
  assert.notEqual(planProgress(progressIn({ startedAt: NOW - STALL_MS })).stalled, null);
});

test('the typical time shows for a plan once the project has some, and never for a reply', () => {
  assert.deepEqual([typicalWords(20 * SEC), typicalWords(70 * SEC), typicalWords(4 * 60_000)], ['under a minute', 'about 1 minute', 'about 4 minutes']);
  assert.equal(planProgress(progressIn({ typicalMs: 4 * 60_000 })).typical, 'Plans here usually take about 4 minutes');
  assert.equal(planProgress(progressIn({ typicalMs: null })).typical, null, 'with too few recorded it says nothing');
  assert.equal(planProgress(progressIn({ job: 'reply', typicalMs: 4 * 60_000 })).typical, null);
});

// ---------------------------------------------------------------- read only while on show

/** A host with one task's job, its transcript at `file`, and a list of what's on show. */
function host(file: string | null, jobOf: () => PlanJob | null) {
  const calls = { shown: [] as string[], files: 0, told: [] as string[], ended: [] as string[], now: NOW };
  const h: PlanWatchHost & { on: { root: string; id: string }[] } = {
    on: [],
    shown() { return h.on; },
    job: () => jobOf(),
    file: () => { calls.files++; return file; },
    typical: () => 4 * 60_000,
    tell: (_r, id, p) => { calls.told.push(`${id}:${p.now.words}`); },
    ended: (_r, id) => { calls.ended.push(id); },
    now: () => calls.now,
  };
  return { h, calls };
}

const JOB: PlanJob = { kind: 'plan', phase: 'working', sessionId: 's1', startedAt: NOW - 60 * SEC, roots: [ROOT], watch: true, stop: false };

test('the watch reads and tells only the tasks on show, and nothing at all when none is', () => {
  const file = join(tempDir(), 's1.jsonl');
  writeFileSync(file, `${use(NOW - 30 * SEC, 'Read', { file_path: `${ROOT}/a.ts` })}\n`);
  const { h, calls } = host(file, () => JOB);
  const w = new PlanWatch(h);
  assert.equal(w.tick(), 0, 'nothing on show');
  assert.equal(calls.files, 0, 'no transcript looked for');
  h.on = [{ root: ROOT, id: 'ACME-21' }, { root: ROOT, id: 'ACME-21' }];
  assert.equal(w.tick(), 1, 'a task on show twice, the panel and its page, is read once');
  assert.deepEqual(calls.told, ['ACME-21:Reading']);
  assert.ok(TICK_MS <= 1_000, 'about once a second');
});

test('edge cases: a job that ends redraws its page once; a transcript not found yet is looked for again after a few seconds; a new job starts afresh', () => {
  const file = join(tempDir(), 's1.jsonl');
  let job: PlanJob | null = JOB;
  let found: string | null = null;
  const { h, calls } = host(null, () => job);
  h.file = () => { calls.files++; return found; };
  h.on = [{ root: ROOT, id: 'ACME-21' }];
  const w = new PlanWatch(h);
  w.tick();
  calls.now += 1_000;
  w.tick();
  assert.equal(calls.files, 1, 'not looked for each second');
  writeFileSync(file, `${use(NOW - 30 * SEC, 'Grep', { pattern: 'x' })}\n`);
  found = file;
  calls.now += 5_000;
  w.tick();
  assert.deepEqual([calls.files, calls.told.at(-1)], [2, 'ACME-21:Searching the code for']);
  job = { ...JOB, sessionId: 's2', startedAt: NOW };
  found = null;
  w.tick();
  assert.equal(calls.told.at(-1), 'ACME-21:Reading the ticket', 'the new job\'s steps, not the old one\'s');
  job = null;
  w.tick();
  w.tick();
  assert.deepEqual(calls.ended, ['ACME-21'], 'once');
  assert.equal(w.progress(ROOT, 'ACME-21'), null);
});

// ---------------------------------------------------------------- the job, Stop and Watch its session

const run = (command: string, endedAt: number | null = null): RunInput => ({ id: `r-${command}`, label: command, command, startedAt: NOW, endedAt, code: null, stopped: false, lines: [], prompt: null, step: null });

test('Stop is this window\'s own run for the task\'s plan or reply, still running; another task\'s, or one that ended, is none', () => {
  const runs = [run('acc analyze ACME-2'), run('acc analyze ACME-21 --ticket /t/x.json', NOW), run('acc plan talk ACME-21 --message=hi --json')];
  assert.equal(planRun(runs, 'ACME-21')?.command, 'acc plan talk ACME-21 --message=hi --json');
  assert.equal(planRun([run('acc plan start ACME-21 --message=x')], 'acme-21')?.label, 'acc plan start ACME-21 --message=x');
  assert.equal(planRun([run('acc analyze ACME-2')], 'ACME-21'), undefined, 'ACME-2 isn\'t ACME-21');
  assert.equal(planRun([run('acc analyze ACME-21', NOW)], 'ACME-21'), undefined, 'ended');
});

test('the job is a plan by its marker or this window\'s making, else a reply by its marker; Watch needs a session and Stop this window\'s run', () => {
  const analyses = join(tempDir(), 'analyses');
  mkdirSync(analyses, { recursive: true });
  const paths = { analyses } as RepoPaths;
  const w = { making: null, since: null, runs: [] as RunInput[], canWatch: true, now: NOW };
  assert.equal(planJob(ROOT, 'ACME-21', paths, w), null, 'nothing under way');
  assert.deepEqual(planJob(ROOT, 'acme-21', paths, { ...w, making: 'reading', since: NOW - 5 * SEC }), { kind: 'plan', phase: 'reading', sessionId: null, startedAt: NOW - 5 * SEC, roots: [ROOT, join(analyses, 'ACME-21.work')], watch: false, stop: false });
  assert.equal(planJob(ROOT, 'ACME-21', paths, { ...w, making: 'planning' })?.phase, 'working', 'acc starting the agent');
  writeFileSync(join(analyses, 'ACME-21.talking.json'), JSON.stringify({ pid: process.pid, startedAt: iso(NOW - 9 * SEC), sessionId: 's-talk' }));
  assert.deepEqual(planJob(ROOT, 'ACME-21', paths, w), { kind: 'reply', phase: 'working', sessionId: 's-talk', startedAt: NOW - 9 * SEC, roots: [ROOT, join(analyses, 'ACME-21.work')], watch: true, stop: false });
  writeFileSync(join(analyses, 'ACME-21.talking.json'), JSON.stringify({ pid: process.pid, startedAt: iso(NOW) }));
  assert.equal(planJob(ROOT, 'ACME-21', paths, w)?.watch, false, 'an older acc\'s reply names no session to watch');
  writeFileSync(join(analyses, 'ACME-21.running.json'), JSON.stringify({ sessionId: 's-plan', startedAt: iso(NOW - 60 * SEC), pid: process.pid }));
  const plan = planJob(ROOT, 'ACME-21', paths, { ...w, making: 'planning', since: NOW - 70 * SEC, runs: [run('acc analyze ACME-21')] });
  assert.deepEqual([plan?.kind, plan?.sessionId, plan?.startedAt, plan?.watch, plan?.stop], ['plan', 's-plan', NOW - 70 * SEC, true, true], 'its time counts the ticket\'s reading too');
  assert.equal(planJob(ROOT, 'ACME-21', paths, { ...w, canWatch: false })?.watch, false);
  writeFileSync(join(analyses, 'ACME-21.running.json'), JSON.stringify({ sessionId: 's-plan', startedAt: iso(NOW), pid: 999_999_999 }));
  assert.equal(planJob(ROOT, 'ACME-21', paths, w)?.kind, 'reply', 'a plan whose process has gone isn\'t under way');
});

test('a plan being made in this window keeps when it began, and forgets it once it ends', () => {
  let t = NOW;
  const m = new PlansMaking(() => {}, () => t);
  assert.equal(m.since(ROOT, 'ACME-21'), null);
  m.begin(ROOT, 'ACME-21');
  t += 10 * SEC;
  m.planning(ROOT, 'ACME-21');
  assert.equal(m.since(ROOT, 'acme-21'), NOW);
  m.end(ROOT, 'ACME-21');
  assert.equal(m.since(ROOT, 'ACME-21'), null);
});

test('the conversation carries the progress only while a plan is made or a reply comes', () => {
  const base = { task: { id: 'ACME-21', state: 'todo' as const }, analysis: null, analyzing: false, talk: { v: 1 as const, task: 'ACME-21', turns: [] }, running: false, open: [], ref: { project: ROOT, task: 'ACME-21' }, progress: sampleProgress(NOW) };
  assert.equal(ticketTalk(base)!.progress, null, 'nothing under way: a stale progress isn\'t drawn');
  assert.notEqual(ticketTalk({ ...base, running: true })!.progress, null);
  assert.notEqual(ticketTalk({ ...base, analyzing: true })!.progress, null);
  assert.notEqual(ticketTalk({ ...base, making: 'reading' })!.progress, null);
  assert.equal(ticketTalk({ ...base, running: true, progress: undefined })!.progress, null, 'before the first read');
});

test('Watch its session and Stop are messages for one task, from the panel, the page and the modal over the board', () => {
  for (const type of ['plan-watch', 'plan-stop']) {
    assert.ok(isFromWebview({ type, project: ROOT, task: 'ACME-21' }), type);
    assert.ok(!isFromWebview({ type, project: ROOT, task: '../x' }), `${type}: not a task`);
    assert.ok(!isFromWebview({ type, project: '', task: 'ACME-21' }), `${type}: no project`);
    assert.ok(modalTakes({ project: ROOT, key: 'ACME-21' }, { type, project: ROOT, task: 'acme-21' } as never, new Set()), `${type}: the modal's task`);
    assert.ok(!modalTakes({ project: ROOT, key: 'ACME-21' }, { type, project: ROOT, task: 'ACME-22' } as never, new Set()), `${type}: another task's`);
  }
});

// ---------------------------------------------------------------- the block on the page

const page = pageDom();
const { area, planProgressBlock } = await import('../webview/plan-progress.ts');
const words = (e: PageElement) => e.textContent;

test('the block shows the state, the time, the step now with its path as work data, and the steps before it; no raw command line', () => {
  const p = sampleProgress(NOW);
  const box = planProgressBlock(ROOT, 'ACME-21', p) as unknown as PageElement;
  assert.match(words(box), /Working/);
  assert.match(words(box), /Making the plan/);
  assert.match(words(box), /3 min 10 s so far/);
  assert.match(words(box), /Last step 12 s ago · Plans here usually take about 4 minutes/);
  const data = box.all('pp-data');
  assert.ok(data.length >= 2 && data.every((d) => d.dataset.work === 'transcript'), 'the agent\'s paths and searches are work data');
  assert.equal(box.all('pp-step').length, 1 + p.earlier.length);
  assert.doesNotMatch(words(box), /git log|sf data query/, 'commands are what they do');
  assert.equal(box.all().filter((x) => x.tagName === 'BUTTON').length, 0, 'no buttons while it moves');
});

test('stalled, the block is orange with Watch its session and Stop, each sending its message; Stop isn\'t there where it can\'t work', () => {
  const p = sampleProgress(NOW, true);
  const box = planProgressBlock(ROOT, 'ACME-22', p) as unknown as PageElement;
  assert.ok(box.classList.contains('tone-edge-orange'));
  assert.match(words(box), /hasn't moved for 6 minutes/);
  const buttons = box.all().filter((x) => x.tagName === 'BUTTON');
  assert.deepEqual(buttons.map(words), ['Watch its session', 'Stop']);
  page.sent.length = 0;
  for (const b of buttons) b.click();
  assert.deepEqual(page.sent, [{ type: 'plan-watch', project: ROOT, task: 'ACME-22' }, { type: 'plan-stop', project: ROOT, task: 'ACME-22' }]);
  const none = planProgressBlock(ROOT, 'ACME-23', { ...p, stalled: { ...p.stalled!, stop: false } }) as unknown as PageElement;
  assert.deepEqual(none.all().filter((x) => x.tagName === 'BUTTON').map(words), ['Watch its session']);
});

test('each second\'s progress redraws the task\'s block in place, a later draw keeps it, and a model with none forgets it', () => {
  const box = planProgressBlock(ROOT, 'ACME-24', sampleProgress(NOW)) as unknown as PageElement;
  page.document.body.append(box);
  const other = planProgressBlock(ROOT, 'ACME-25', sampleProgress(NOW)) as unknown as PageElement;
  page.document.body.append(other);
  const later = sampleProgress(NOW + 30 * SEC, true);
  area.receive!['plan-progress']({ project: ROOT, task: 'acme-24', progress: later } as never);
  assert.match(words(box), /hasn't moved/, 'drawn again where it is');
  assert.ok(box.classList.contains('tone-edge-orange'));
  assert.doesNotMatch(words(other), /hasn't moved/, 'another task\'s block is its own');
  const redrawn = planProgressBlock(ROOT, 'ACME-24', sampleProgress(NOW)) as unknown as PageElement;
  assert.match(words(redrawn), /hasn't moved/, 'a redraw from an older model shows the newest told');
  assert.equal(planProgressBlock(ROOT, 'ACME-24', null), null, 'ended');
  assert.doesNotMatch(words(planProgressBlock(ROOT, 'ACME-24', sampleProgress(NOW)) as unknown as PageElement), /hasn't moved/, 'a later job starts from its own');
  area.receive!['plan-progress']({ project: ROOT } as never);
});
