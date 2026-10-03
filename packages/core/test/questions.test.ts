import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { builderSettings } from '../src/dispatch.ts';
import {
  answerQuestion, ask, covered, type HookInput, hookOutput, isAnswer, listen, listeners, parseHookInput, pendingQuestions, permissionHook, type Question, questionHistory, stopListening, editedMessage, preapprove, takePreapproval,
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
