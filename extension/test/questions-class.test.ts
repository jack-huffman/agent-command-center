// The extension's Questions (D-030): the folders it answers for, the questions it takes from the hook's folder
// for them, and what it does once the window has closed.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Question } from '../../packages/core/src/questions.ts';
import { tempDir } from '../../packages/core/test/support.ts';

/** questions.ts imports vscode, which only VS Code has: a stand-in with one workspace folder, whose messages are kept. */
const told: string[] = [];
(globalThis as { accQuestionsVscode?: unknown }).accQuestionsVscode = {
  workspace: { workspaceFolders: [{ uri: { fsPath: '/w/app' } }] },
  window: { showInformationMessage: async (m: string) => { told.push(m); return undefined; } },
};
const STUB = `data:text/javascript,${encodeURIComponent('const v = globalThis.accQuestionsVscode; export const workspace = v.workspace, window = v.window; export default v;')}`;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'vscode' ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)) });
const { Questions } = await import('../src/questions.ts');

type Ctor = ConstructorParameters<typeof Questions>;
const log = { info: () => {}, warn: () => {} } as unknown as Ctor[1];

/** A hub with one project and its worktree, keeping the questions it's given; and the toasts shown. */
function hub() {
  const h = {
    projects: [{ root: '/w/app', worktrees: [{ path: '/w/app' }, { path: '/w/app-T-1' }] }],
    agents: [], agentsAt: 0, questions: [] as Question[], answers: [] as unknown[],
    setQuestions(qs: Question[]) { h.questions = qs; },
    setAnswers(a: unknown[]) { h.answers = a; },
    projectFor: () => undefined, project: () => undefined, taskRows: () => [],
  };
  return h;
}

/** A question the hook wrote, from an agent working in `cwd`, whose process is this one, so it's alive. */
function asked(dir: string, id: string, cwd: string): void {
  const q: Question = { v: 1, id, pid: process.pid, at: 1, sessionId: `s-${id}`, cwd, transcript: null, tool: 'Bash', input: { command: 'ls' }, suggestions: [] };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(q));
}

test('Questions answers for each workspace folder and every worktree of its projects, once each, and takes only their questions', (t) => {
  const dir = tempDir();
  const h = hub();
  const qs = new Questions(h as unknown as Ctor[0], log, () => {}, () => true, null, dir);
  t.after(() => qs.dispose());
  assert.deepEqual(qs.roots(), ['/w/app', '/w/app-T-1']);
  asked(dir, 'q1', '/w/app-T-1/src');
  asked(dir, 'q2', '/elsewhere');
  qs.scan();
  assert.deepEqual(h.questions.map((q) => q.id), ['q1'], 'a question from outside its folders is another window\'s');
});

test('edge case: a Questions disposed before it starts listens for nothing, and an answer to a question gone says so', () => {
  const dir = join(tempDir(), 'questions');
  const qs = new Questions(hub() as unknown as Ctor[0], log, () => {}, () => true, null, dir);
  qs.dispose();
  qs.start();
  assert.equal(existsSync(dir), false, 'no folder made, no listener file written');
  told.length = 0;
  assert.equal(qs.answer('gone', { decision: 'allow' }), false);
  assert.deepEqual(told, ['That question was already answered, or its agent stopped waiting.']);
});
