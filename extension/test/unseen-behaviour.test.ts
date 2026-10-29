// What T-92's Dispatch again and Claude Code's silence do when run, not what their source says (T-93): the
// command is driven with a stand-in for acc, and the hub's load of `claude agents` with a stand-in claude on PATH.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { againRefusal } from '../../packages/core/src/again.ts';
import { UNSEEN_WORDS } from '../../packages/core/src/started.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { cardActions, dispatchAgainOff } from '../src/model/cards.ts';
import { row } from './support.ts';
import { standIn } from '../../packages/core/test/stand-in.ts';
import { thisMachine } from '../../packages/core/src/this-machine.ts';

/** This machine as acc names it on the system the tests run on (T-150): the Windows CI job reads This PC. */
const HERE = thisMachine();

/** tasks.ts and hub.ts import vscode, which only VSCode has: this stand-in holds what they call, and records what's shown. */
const said = { warn: [] as string[], info: [] as string[] };
(globalThis as { accUnseenVscode?: unknown }).accUnseenVscode = {
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
  window: { showWarningMessage: async (m: string) => { said.warn.push(m); }, showInformationMessage: async (m: string) => { said.info.push(m); } },
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }) },
  commands: { executeCommand: async () => undefined },
};
const STUB = `data:text/javascript,${encodeURIComponent('const v = globalThis.accUnseenVscode; export const { EventEmitter, window, workspace, commands } = v; export default v;')}`;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'vscode' ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)) });
const { Hub } = await import('../src/hub.ts');
const { TaskCommands } = await import('../src/tasks.ts');

/** The command, as the Command Center registers it, over a hub whose rows are `rows`, and every acc call it makes. */
function commands(rows: TaskRow[], silentSince: number | null = null) {
  const accCalls: string[][] = [];
  let loaded = 0;
  const hub = { taskRows: () => rows, agentsSilentSince: silentSince, loadTasks: async () => {}, loadAgents: async () => { loaded++; } };
  const acc = async (args: string[]) => { accCalls.push(args); return { code: 0, stdout: '{}', stderr: '' }; };
  const tasks = new TaskCommands({ hub, acc, log: { warn() {} }, openTicket: null, helpers: {}, terminals: new Map() } as never, () => false, () => false);
  const reg = new Map<string, (...a: unknown[]) => unknown>();
  tasks.register((id, fn) => reg.set(id, fn));
  const node = (id: string) => ({ kind: 'task', project: { root: '/r', name: 'Acme' }, task: { id } });
  return { accCalls, again: (id: string) => reg.get('acc.task.dispatchAgain')!(node(id)) as Promise<void>, loaded: () => loaded };
}

const running = (over: Partial<TaskRow> = {}): TaskRow => ({ ...row('T-1', 'running', 'running'), ...over });

test('Dispatch again on a running builder acc can see runs nothing and says why (T-93)', async () => {
  said.warn.length = 0;
  const c = commands([running()]);
  await c.again('T-1');
  assert.deepEqual(c.accCalls, [], 'acc is never asked to stop it');
  assert.deepEqual(said.warn, [againRefusal('T-1')]);
  assert.equal(c.loaded(), 0);
  // The same row as the card sees it: the reason is the action's.
  assert.equal(dispatchAgainOff(running()), againRefusal('T-1'));
});

test('Dispatch again runs acc dispatch <id> --again for a builder that didn\'t start, and for one acc can\'t see, and looks at Claude Code after (T-93)', async () => {
  const never = commands([{ ...row('T-1', 'todo', 'needs-you'), notStarted: { reason: 'x', at: '' } }]);
  await never.again('T-1');
  assert.deepEqual(never.accCalls, [['dispatch', 'T-1', '--again', '--json']]);
  assert.equal(never.loaded(), 1);
  const blind = commands([running({ unseen: 'quiet' })], 1234);
  await blind.again('T-1');
  assert.deepEqual(blind.accCalls, [['dispatch', 'T-1', '--again', '--silent-since', '1234', '--json']], 'it says since when it saw none');
  assert.equal(dispatchAgainOff(running({ unseen: 'unanswered' })), null);
  assert.equal(dispatchAgainOff({ ...row('T-1', 'review', 'review'), notStarted: { reason: 'x', at: '' } }), againRefusal('T-1'), 'edge: a moved task\'s old marker is no reason');
});

test('with no claude on PATH, Dispatch again is off and says so, and the card offers none (T-93)', async () => {
  said.warn.length = 0;
  const gone = running({ unseen: 'missing' });
  const c = commands([gone]);
  await c.again('T-1');
  assert.deepEqual(c.accCalls, []);
  assert.match(said.warn[0]!, /Install Claude Code/);
  assert.ok(!cardActions(gone, { project: '/r', task: 'T-1' }).some((a) => a.command === 'acc.task.dispatchAgain'));
});

/** A claude on PATH that fails while its `fail` file exists, else prints `[]`: the first load has no answer, a later one answers. */
function claudeOnPath(): { dir: string; fail: string } {
  const dir = tempDir('claude-bin-');
  const fail = join(dir, 'fail');
  writeFileSync(fail, '');
  const script = join(dir, 'claude');
  standIn(script, `#!/bin/sh\nif [ -e "${fail}" ]; then echo "connect ENOENT /tmp/cc-daemon-1/x/control.sock" >&2; exit 1; fi\necho '[]'\n`);
  chmodSync(script, 0o755);
  return { dir, fail };
}

test('the hub\'s silence starts once when claude agents fails, and an answer clears it (T-93)', async () => {
  const bin = claudeOnPath();
  const saved = process.env.PATH;
  process.env.PATH = `${bin.dir}${delimiter}${saved}`;
  try {
    const hub = new Hub();
    assert.equal(hub.agentsSilentSince, null, 'edge: before the first look');
    await hub.loadAgents();
    const first = hub.agentsSilentSince;
    assert.ok(first !== null && hub.agentsError && !hub.claudeMissing, 'no answer starts the clock');
    await new Promise((r) => setTimeout(r, 5));
    await hub.loadAgents();
    assert.equal(hub.agentsSilentSince, first, 'a second silence keeps the first time');
    unlinkSync(bin.fail);
    await hub.loadAgents();
    assert.deepEqual([hub.agentsSilentSince, hub.agentsError, hub.agents], [null, null, []], 'an answer clears it');
  } finally {
    process.env.PATH = saved;
  }
});

test('a missing claude stays out of the silence clock and reads as its own state (T-93)', async () => {
  const empty = tempDir('no-claude-');
  const saved = process.env.PATH;
  process.env.PATH = empty;
  try {
    assert.ok(!existsSync(join(empty, 'claude')));
    const hub = new Hub();
    await hub.loadAgents();
    await hub.loadAgents();
    assert.equal(hub.claudeMissing, true);
    assert.match(hub.agentsError!, /isn't on PATH/);
    assert.equal(hub.agentsSilentSince, null, 'it never starts the clock, so nothing reads as "not answering"');
    assert.match(UNSEEN_WORDS.missing.line, new RegExp(String.raw`isn't on ${HERE}'s path`));
    const bin = claudeOnPath();
    process.env.PATH = `${bin.dir}${delimiter}${saved}`;
    await hub.loadAgents();
    assert.equal(hub.claudeMissing, false, 'installed again, it is a silence like any');
    assert.ok(hub.agentsSilentSince !== null);
  } finally {
    process.env.PATH = saved;
  }
});
