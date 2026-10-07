import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { builderSettings } from '../src/packet.ts';
import {
  answerQuestion, appendHistory, ask, covered, HISTORY_TRIM_EVERY_BYTES, type HistoryRecord, type HookInput, hookOutput, isAnswer, listen, listeners, parseHookInput, pendingQuestions, permissionHook, type Question, questionHistory, stopListening, editedMessage, preapprove, takePreapproval,
} from '../src/questions.ts';
import { tempDir } from './support.ts';

const MAIN = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));

const input = (over: Partial<HookInput> = {}): HookInput => ({
  hook_event_name: 'PermissionRequest', session_id: 'sess-1', cwd: '/work/repo/.claude/worktrees/T-1', transcript_path: '/t.jsonl',
  tool_name: 'Bash', tool_input: { command: 'npm run deploy', description: 'Deploy' }, permission_suggestions: [], ...over,
});

/** Waits, in small steps, until there's a question in the folder. */
async function questionIn(dir: string): Promise<Question> {
  for (let i = 0; i < 200; i++) {
    const [q] = pendingQuestions(dir);
    if (q) return q;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no question appeared');
}

test('with no Command Center listening for the folder, the hook steps aside at once and leaves nothing behind', async () => {
  const dir = tempDir();
  assert.equal(await ask(input(), { dir }), null);
  listen(dir, ['/somewhere/else']);
  assert.equal(await ask(input(), { dir }), null, 'a window for another folder doesn\'t count');
  assert.deepEqual(pendingQuestions(dir), []);
});

test('a question waits for its answer, the first answer wins, and both files are gone after', async () => {
  const dir = tempDir();
  listen(dir, ['/work/repo']);
  const waiting = ask(input(), { dir, pollMs: 5 });
  const q = await questionIn(dir);
  assert.equal(q.tool, 'Bash');
  assert.equal(q.sessionId, 'sess-1');
  assert.equal(statSync(join(dir, `${q.id}.json`)).mode & 0o077, 0, 'readable only by this user');
  assert.equal(answerQuestion(dir, q.id, { decision: 'allow' }), true);
  assert.equal(answerQuestion(dir, q.id, { decision: 'deny' }), false, 'another window got there first');
  const r = await waiting;
  assert.deepEqual(r?.answer, { decision: 'allow' });
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.json')), []);
  assert.equal(answerQuestion(dir, q.id, { decision: 'allow' }), false, 'nothing to answer once it has gone');
});

test('"answer in the terminal" hands the question back to Claude Code', async () => {
  const dir = tempDir();
  listen(dir, ['/work/repo']);
  const waiting = ask(input(), { dir, pollMs: 5 });
  answerQuestion(dir, (await questionIn(dir)).id, { decision: 'terminal' });
  assert.equal(await waiting, null);
});

test('the hook steps aside when the last window closes, when told to stop, and when the wait runs out', async () => {
  const closed = tempDir();
  listen(closed, ['/work/repo']);
  const a = ask(input(), { dir: closed, pollMs: 2 });
  await questionIn(closed);
  stopListening(closed);
  assert.equal(await a, null);
  assert.deepEqual(pendingQuestions(closed), [], 'its question is withdrawn');

  const stopped = tempDir();
  listen(stopped, ['/work/repo']);
  const stop = new AbortController();
  const b = ask(input(), { dir: stopped, pollMs: 2, signal: stop.signal });
  await questionIn(stopped);
  stop.abort();
  assert.equal(await b, null);

  const slow = tempDir();
  listen(slow, ['/work/repo']);
  let t = 0;
  assert.equal(await ask(input(), { dir: slow, now: () => t, wait: async () => { t += 1000; }, maxWaitMs: 5000 }), null);
  assert.deepEqual(pendingQuestions(slow), []);
});

test('listeners: only fresh ones from live processes count, and a worktree under a listened folder is covered', () => {
  const dir = tempDir();
  listen(dir, ['/work/repo'], process.pid, 1_000_000);
  assert.equal(listeners(dir, 1_000_000 + 10_000).length, 1);
  assert.equal(listeners(dir, 1_000_000 + 120_000).length, 0, 'not refreshed: the window has gone');
  listen(dir, ['/work/other'], 999_999_999, 1_000_000);
  assert.equal(listeners(dir, 1_000_000).length, 1, 'a listener whose process is gone is ignored');
  assert.ok(covered(listeners(dir, 1_000_000), '/work/repo/.claude/worktrees/T-1'));
  assert.ok(!covered(listeners(dir, 1_000_000), '/work/repository'), 'a prefix that isn\'t a folder doesn\'t count');
});

test('a question whose hook has died is cleared away', () => {
  const dir = tempDir();
  const q: Question = { v: 1, id: 'abc-0123abcd', pid: 999_999_999, at: 1, sessionId: 's', cwd: '/w', transcript: null, tool: 'Bash', input: {}, suggestions: [] };
  writeFileSync(join(dir, `${q.id}.json`), JSON.stringify(q));
  assert.deepEqual(pendingQuestions(dir), []);
  assert.ok(!existsSync(join(dir, `${q.id}.json`)));
});

test('the hook\'s output: allow, deny with a reason, a question\'s answers, and "don\'t ask again" for this session only', () => {
  const q = (tool: string, inp: Record<string, unknown> = {}, suggestions: unknown[] = []): Question => ({ v: 1, id: 'a-00000000', pid: 1, at: 1, sessionId: 's', cwd: '/w', transcript: null, tool, input: inp, suggestions });
  const decision = (o: Record<string, unknown> | null) => (o?.hookSpecificOutput as { decision: Record<string, unknown> }).decision;
  assert.deepEqual(decision(hookOutput(q('Bash'), { decision: 'allow' })), { behavior: 'allow' });
  assert.match(String(decision(hookOutput(q('Bash'), { decision: 'deny', message: 'use the sandbox' })).message), /said no.*use the sandbox/);
  assert.equal(decision(hookOutput(q('Bash'), { decision: 'deny' })).behavior, 'deny');
  const asked = { questions: [{ question: 'Which colour?', options: [{ label: 'Blue' }] }] };
  assert.deepEqual(decision(hookOutput(q('AskUserQuestion', asked), { decision: 'allow', answers: { 'Which colour?': 'Blue' } })),
    { behavior: 'allow', updatedInput: { ...asked, answers: { 'Which colour?': 'Blue' } } });
  const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' };
  assert.deepEqual(decision(hookOutput(q('Bash', {}, [rule]), { decision: 'allow', always: true })).updatedPermissions, [{ ...rule, destination: 'session' }]);
  assert.equal(decision(hookOutput(q('Bash', {}, [rule]), { decision: 'allow' })).updatedPermissions, undefined, 'only when asked');
  assert.equal(hookOutput(q('Bash'), { decision: 'terminal' }), null);
});

test('what the hook reads is checked: junk input, and answers of the wrong shape, are refused', () => {
  assert.equal(parseHookInput('not json'), null);
  assert.equal(parseHookInput(JSON.stringify({ session_id: 's', cwd: '/w' })), null);
  assert.equal(parseHookInput(JSON.stringify(input()))?.tool_name, 'Bash');
  assert.ok(isAnswer({ decision: 'allow', answers: { q: 'a' } }));
  assert.ok(!isAnswer({ decision: 'allow', answers: { q: 1 } }));
  assert.ok(!isAnswer({ decision: 'maybe' }));
  assert.ok(!isAnswer({ decision: 'deny', message: 'x'.repeat(5000) }));
  assert.equal(answerQuestion(tempDir(), '../../etc/passwd', { decision: 'allow' }), false, 'ids are only ever our own');
});

test('builders get the hook only when acc can say how to run itself, with an hour before Claude Code gives up', () => {
  const config = { profile: 'generic' } as never;
  assert.equal((builderSettings({ id: 'T-1' } as never, config, '/acc/bin', '/usr/bin') as Record<string, unknown>).hooks, undefined);
  const s = builderSettings({ id: 'T-1' } as never, config, '/acc/bin', '/usr/bin', "'/node' '/acc/bin/acc'") as { hooks: unknown };
  assert.deepEqual(s.hooks, permissionHook("'/node' '/acc/bin/acc'"));
  const hook = (s.hooks as { PermissionRequest: { matcher: string; hooks: { command: string; timeout: number }[] }[] }).PermissionRequest[0]!;
  assert.equal(hook.matcher, '*');
  assert.equal(hook.hooks[0]!.command, "'/node' '/acc/bin/acc' hook permission");
  assert.equal(hook.hooks[0]!.timeout, 3600);
});

/** Runs `acc hook permission` as Claude Code would: input on stdin, the decision on stdout. */
function hook(dir: string, stdin: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', MAIN, 'hook', 'permission'], { env: { ...process.env, ACC_QUESTIONS_DIR: dir } });
    let out = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(stdin);
  });
}

test('acc hook permission: nothing listening or junk input prints nothing and exits 0, so Claude Code asks as usual', async () => {
  const dir = tempDir();
  assert.deepEqual(await hook(dir, JSON.stringify(input())), { code: 0, out: '' });
  listen(dir, ['/work/repo']);
  assert.deepEqual(await hook(dir, '{not json'), { code: 0, out: '' });
});

test('acc hook permission: an answer from the Command Center comes back as the hook\'s decision', async () => {
  const dir = tempDir();
  listen(dir, ['/work/repo']);
  const running = hook(dir, JSON.stringify(input({ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which colour?' }] } })));
  const q = await questionIn(dir);
  answerQuestion(dir, q.id, { decision: 'allow', answers: { 'Which colour?': 'Orange' } });
  const r = await running;
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out).hookSpecificOutput.decision.updatedInput.answers, { 'Which colour?': 'Orange' });
});

// ---------------------------------------------------------------- history (D-037)

test('every question leaves a record of how it ended: answered, allowed for the session, denied with the reason, or handed back', async () => {
  const dir = tempDir();
  listen(dir, ['/work/repo']);
  const answerWith = async (over: Partial<HookInput>, a: Parameters<typeof answerQuestion>[2]) => {
    const waiting = ask(input(over), { dir, pollMs: 5 });
    answerQuestion(dir, (await questionIn(dir)).id, a);
    await waiting;
  };
  await answerWith({}, { decision: 'allow', always: true });
  await answerWith({ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?' }] } }, { decision: 'allow', answers: { 'Which?': 'Blue' } });
  await answerWith({}, { decision: 'deny', message: 'not today' });
  await answerWith({}, { decision: 'terminal' });
  const h = questionHistory(dir);
  assert.deepEqual(h.map((r) => r.outcome), ['allowed-for-session', 'answered', 'denied', 'terminal']);
  assert.deepEqual(h[1]!.answers, { 'Which?': 'Blue' });
  assert.equal(h[2]!.message, 'not today');
  assert.equal(h[0]!.input.command, 'npm run deploy', 'what it asked is kept with it');
  assert.ok(h.every((r) => r.endedAt >= r.askedAt));
  stopListening(dir);
  assert.equal(await ask(input(), { dir }), null);
  assert.equal(questionHistory(dir).at(-1)!.outcome, 'no-window', 'asked in its own terminal, with no window: noted too');
});

// ---------------------------------------------------------------- the history keeps its newest 1,000 records (D-043)

const record = (i: number): HistoryRecord => ({ v: 1, id: `r${i}-00000000`, sessionId: 'sess-1', cwd: '/work/repo', tool: 'Bash', input: { command: `echo ${i}` }, askedAt: i, endedAt: i, outcome: 'allowed' });
const recordLines = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => `${JSON.stringify(record(from + k))}\n`).join('');
const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => record(from + k).id);
const historyIds = (dir: string) => questionHistory(dir, 5000).map((r) => r.id);

test('the history keeps its newest 1,000 records: 1,000 stay as they are, and the 1,001st pushes out the oldest', () => {
  const dir = tempDir();
  const file = join(dir, 'history.jsonl');
  writeFileSync(file, recordLines(0, 999), { mode: 0o600 });
  const inode = statSync(file).ino;
  appendHistory(dir, record(999), 1); // a trim check on this append
  assert.deepEqual(historyIds(dir), ids(0, 1000), '1,000 kept');
  assert.equal(statSync(file).ino, inode, 'and not rewritten');
  appendHistory(dir, record(1000), 1);
  assert.deepEqual(historyIds(dir), ids(1, 1001), 'the oldest went, the newest stayed, in order');
  assert.equal(statSync(file).mode & 0o077, 0, 'still readable only by this user');
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'written to a temp file and renamed over it');
});

test('an append only checks the size: the file is trimmed once it has grown 64 KB since its last trim, not on every append', () => {
  const dir = tempDir();
  const file = join(dir, 'history.jsonl');
  // 1,000 records of 262 bytes are 262,000 bytes, just under 4 × 64 KB, so every append after a trim crosses that mark.
  const LINE = 262;
  const sized = (i: number): HistoryRecord => {
    const r = record(i);
    return { ...r, input: { command: 'x'.repeat(LINE - Buffer.byteLength(`${JSON.stringify({ ...r, input: { command: '' } })}\n`)) } };
  };
  const lines = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => `${JSON.stringify(sized(from + k))}\n`).join('');
  assert.equal(Buffer.byteLength(lines(995, 1005)), 10 * LINE);
  assert.ok(1000 * LINE < 4 * HISTORY_TRIM_EVERY_BYTES && 1001 * LINE > 4 * HISTORY_TRIM_EVERY_BYTES);
  writeFileSync(file, lines(0, 1000), { mode: 0o600 }); // from before D-043: no trim noted, so the first append trims
  const every = Math.floor(HISTORY_TRIM_EVERY_BYTES / LINE) + 1; // 251 appends, a little over 64 KB
  const trims: number[] = [];
  for (let i = 1000; i < 1000 + 3 * every + 10; i++) {
    const before = statSync(file);
    appendHistory(dir, sized(i));
    const after = statSync(file);
    if (after.ino === before.ino && after.size === before.size + LINE) continue;
    trims.push(i);
    assert.deepEqual(historyIds(dir), ids(i - 999, i + 1), `append ${i} trimmed to the newest 1,000`);
    assert.equal(after.size, 1000 * LINE);
  }
  assert.deepEqual(trims, [1000, 1000 + every, 1000 + 2 * every, 1000 + 3 * every], 'the appends between trims only appended, the ones right after a trim too');
  assert.deepEqual(historyIds(dir), ids(1000 + 3 * every - 999, 1000 + 3 * every + 10));
  writeFileSync(join(dir, 'history.trimmed'), '99999999\n'); // more than the file holds: deleted or replaced since
  appendHistory(dir, sized(2000));
  assert.equal(questionHistory(dir, 5000).length, 1000, 'a noted size the file can\'t have counts as none');
});

test('a garbled or half-written line doesn\'t stop the trim or the readers', () => {
  const dir = tempDir();
  const file = join(dir, 'history.jsonl');
  writeFileSync(file, `${recordLines(0, 500)}not json at all\n{"v":1,"id":"torn by a cra\n{"v":2}\n${recordLines(500, 1000)}`, { mode: 0o600 });
  assert.deepEqual(historyIds(dir), ids(0, 1000), 'the reader skips the lines that don\'t read');
  appendHistory(dir, record(1000), 1);
  assert.deepEqual(historyIds(dir), ids(1, 1001), 'the trim counts only records, and drops the rest');
  assert.equal(statSync(file).size, Buffer.byteLength(recordLines(1, 1001)));
  appendFileSync(file, '{"v":1,"id":"an append still being writ');
  assert.deepEqual(historyIds(dir), ids(1, 1001), 'a half-written last line is skipped too');
});

test('an append after a torn last line starts a line of its own, so its record still reads', () => {
  const dir = tempDir();
  const file = join(dir, 'history.jsonl');
  appendHistory(dir, record(0));
  assert.equal(readFileSync(file, 'utf8'), recordLines(0, 1), 'a new file starts with the record, not a blank line');
  appendFileSync(file, '{"v":1,"id":"torn by a cra'); // a crash mid-write: no newline
  appendHistory(dir, record(1));
  assert.equal(readFileSync(file, 'utf8'), `${recordLines(0, 1)}{"v":1,"id":"torn by a cra\n${recordLines(1, 2)}`);
  assert.deepEqual(historyIds(dir), ids(0, 2));
  appendHistory(dir, record(2));
  assert.equal(readFileSync(file, 'utf8'), `${recordLines(0, 1)}{"v":1,"id":"torn by a cra\n${recordLines(1, 3)}`, 'a whole last line gets no extra newline');
});

test('an append that lands during a trim isn\'t lost: several processes appending at once, each append trimming, keep every record', async () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'history.jsonl'), recordLines(0, 1000), { mode: 0o600 });
  // Each process appends its own records, and each append trims the oldest away (trimEvery 1).
  const child = `
    import { appendHistory } from ${JSON.stringify(new URL('../src/questions.ts', import.meta.url).href)};
    const [dir, who, n] = process.argv.slice(1);
    for (let j = 0; j < Number(n); j++) appendHistory(dir, { v: 1, id: \`\${who}-\${j}\`, sessionId: 's', cwd: '/work/repo', tool: 'Bash', input: {}, askedAt: j, endedAt: j, outcome: 'allowed' }, 1);
  `;
  const PROCS = 4;
  const EACH = 50;
  const codes = await Promise.all(Array.from({ length: PROCS }, (_, p) => new Promise<number | null>((resolve) => {
    spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', child, dir, `p${p}`, String(EACH)], { stdio: 'inherit' }).on('close', resolve);
  })));
  assert.deepEqual(codes, Array(PROCS).fill(0));
  const kept = historyIds(dir);
  assert.equal(kept.length, 1000, 'trimmed to the newest 1,000');
  assert.deepEqual(kept.slice(0, 1000 - PROCS * EACH), ids(PROCS * EACH, 1000), 'each append pushed out exactly one of the oldest');
  for (let p = 0; p < PROCS; p++) {
    assert.deepEqual(kept.filter((id) => id.startsWith(`p${p}-`)), Array.from({ length: EACH }, (_, j) => `p${p}-${j}`), `every record process ${p} appended is there, in order`);
  }
  assert.ok(!existsSync(join(dir, 'history.lock')), 'and the lock is let go');
});

test('very large records are kept to 2 MB, and the newest is always kept', () => {
  const dir = tempDir();
  const big = (i: number): HistoryRecord => ({ ...record(i), input: { content: 'x'.repeat(300_000) } });
  writeFileSync(join(dir, 'history.jsonl'), Array.from({ length: 10 }, (_, i) => `${JSON.stringify(big(i))}\n`).join(''), { mode: 0o600 });
  appendHistory(dir, big(10));
  assert.ok(statSync(join(dir, 'history.jsonl')).size <= 2 * 1024 * 1024);
  assert.deepEqual(historyIds(dir), ids(5, 11), 'the newest six fit');
  appendHistory(dir, { ...record(11), input: { content: 'x'.repeat(3_000_000) } });
  assert.deepEqual(historyIds(dir), ids(11, 12), 'one record past the limit on its own still stays');
});

// ---------------------------------------------------------------- every answer the prompt offers (D-038)

test('the hook can give every answer Claude Code\'s prompt offers: for the project, auto mode, stop, and plan approval', () => {
  const q = (tool: string, suggestions: unknown[] = []): Question => ({ v: 1, id: 'a-00000000', pid: 1, at: 1, sessionId: 's', cwd: '/w', transcript: null, tool, input: { command: 'npm test' }, suggestions });
  const decision = (o: Record<string, unknown> | null) => (o?.hookSpecificOutput as { decision: Record<string, unknown> }).decision;
  const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'session' };
  assert.deepEqual(decision(hookOutput(q('Bash', [rule]), { decision: 'allow', always: true, scope: 'project' })).updatedPermissions, [{ ...rule, destination: 'localSettings' }], 'saved to the project\'s own settings');
  assert.deepEqual(decision(hookOutput(q('Bash'), { decision: 'allow', mode: 'auto' })).updatedPermissions, [{ type: 'setMode', mode: 'auto', destination: 'session' }]);
  assert.deepEqual(decision(hookOutput(q('ExitPlanMode'), { decision: 'allow', mode: 'acceptEdits' })).updatedPermissions, [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]);
  assert.equal(decision(hookOutput(q('Bash'), { decision: 'deny', stop: true })).interrupt, true);
  assert.equal(decision(hookOutput(q('Bash'), { decision: 'deny' })).interrupt, undefined);
  const edited = decision(hookOutput(q('Bash'), { decision: 'allow', command: 'npm test -- --grep fast' }));
  assert.deepEqual([edited.behavior, edited.message], ['deny', editedMessage('npm test -- --grep fast')], 'an edit tells the agent to run your version');
  assert.ok(!isAnswer({ decision: 'allow', mode: 'bypassPermissions' }), 'never a switch to bypass permissions');
  assert.ok(!isAnswer({ decision: 'allow', scope: 'everywhere' }));
});

test('an edited command is allowed when the agent runs it: once, exactly, for that session, within ten minutes', async () => {
  const dir = tempDir();
  listen(dir, ['/work/repo']);
  const waiting = ask(input(), { dir, pollMs: 5 });
  answerQuestion(dir, (await questionIn(dir)).id, { decision: 'allow', command: 'npm run deploy -- --dry-run' });
  const first = await waiting;
  assert.equal(hookOutput(first!.question, first!.answer)?.hookSpecificOutput && (hookOutput(first!.question, first!.answer)!.hookSpecificOutput as { decision: { behavior: string } }).decision.behavior, 'deny');
  assert.equal(questionHistory(dir).at(-1)!.outcome, 'allowed-edited');
  assert.equal(questionHistory(dir).at(-1)!.command, 'npm run deploy -- --dry-run');
  // The agent runs the edited version: no card, just allowed.
  const second = await ask(input({ tool_input: { command: 'npm run deploy -- --dry-run' } }), { dir, pollMs: 5 });
  assert.equal(second?.answer.decision, 'allow');
  assert.deepEqual(pendingQuestions(dir), []);
  assert.equal(takePreapproval(dir, 'sess-1', 'npm run deploy -- --dry-run'), false, 'used up');
  preapprove(dir, 'sess-1', 'x', 1_000);
  assert.equal(takePreapproval(dir, 'sess-1', 'x', 1_000 + 11 * 60_000), false, 'expired');
  preapprove(dir, 'sess-1', 'x');
  assert.equal(takePreapproval(dir, 'other-session', 'x'), false, 'another session\'s approval');
  assert.equal(takePreapproval(dir, 'sess-1', 'x '), false, 'only the exact command');
});
