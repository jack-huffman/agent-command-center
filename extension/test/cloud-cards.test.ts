// A cloud builder's card (GH-69): Dispatch to the cloud, offered or disabled with the reason; a running cloud
// task's Watch, Send a message and Collect, with Open in Claude Code disabled and why; Abandon's cloud label.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskRow } from '../src/logic/shared.ts';
import { cardActions, cloudDisabled } from '../src/model/cards.ts';
import { row } from './support.ts';

const CLOUD = { routine: 'trig_01ABCDEFGHJKLMNOPQRSTUVW', default: 'local' as const, quietMinutes: 120, max: 3 };
const config = (github: boolean, cloud: typeof CLOUD | { routine: null } | null) => ({ github: github ? { repo: 'o/r', account: 'me' } : null, agents: { cloud: cloud ? { ...CLOUD, ...cloud } : null } });
const labels = (actions: ReturnType<typeof cardActions>) => actions.map((a) => a.label);
const find = (actions: ReturnType<typeof cardActions>, label: string) => actions.find((a) => a.label === label);

test('Dispatch to the cloud is disabled with the reason where the repo isn\'t on GitHub or the project hasn\'t opted in, and enabled when everything is there', () => {
  const todo = { ...row('AV-2', 'todo', 'ready'), deps: [] } as TaskRow;
  assert.equal(cloudDisabled(config(false, null)), 'Cloud builders need the repo on GitHub');
  assert.equal(cloudDisabled(config(true, null)), 'Cloud builders are off for this project: opt in under Settings');
  assert.equal(cloudDisabled(config(true, { routine: null })), 'Cloud builders need a routine for the repo: Setup says how');
  assert.equal(cloudDisabled(config(true, CLOUD)), null);
  assert.equal(cloudDisabled(null), 'Cloud builders need the repo on GitHub', 'no config at all: not on GitHub as far as the card knows');
  for (const [cfg, why] of [[config(false, null), 'Cloud builders need the repo on GitHub'], [config(true, null), 'Cloud builders are off for this project: opt in under Settings']] as const) {
    const a = find(cardActions(todo, {}, cfg), 'Dispatch to the cloud')!;
    assert.ok(a, 'offered, so a person sees it exists');
    assert.equal(a.disabled, why, 'disabled, with the reason');
    assert.equal(a.command, 'acc.task.dispatchCloud');
  }
  const on = find(cardActions(todo, {}, config(true, CLOUD)), 'Dispatch to the cloud')!;
  assert.equal(on.disabled, undefined, 'enabled');
  assert.equal(on.icon, 'cloud-upload');
  // A rework re-dispatches to the cloud the same way; a task that can't be dispatched offers nothing cloud.
  assert.equal(find(cardActions({ ...row('AV-3', 'rework', 'rework'), deps: [] } as TaskRow, {}, config(true, CLOUD)), 'Re-dispatch to the cloud')?.disabled, undefined);
  assert.equal(find(cardActions({ ...row('AV-4', 'running', 'running'), run: { worktree: '/w', branch: 'b' } } as TaskRow, {}, config(true, CLOUD)), 'Dispatch to the cloud'), undefined);
  // Without the config, as the tracker's board calls it, the cloud isn't mentioned at all.
  assert.ok(!labels(cardActions(todo, {})).some((l) => l.includes('cloud')));
});

test('a running cloud task offers Watch, Send a message and Collect, and Open in Claude Code disabled with why; Attach has no place; Abandon says the session stays', () => {
  const cloud = { sessionId: 'session_01X', url: 'https://claude.ai/code/session_01X', firedAt: '2026-10-09T12:00:00Z', head: 'abc', lastPushAt: '2026-10-09T12:00:00Z' };
  const running = { ...row('AV-5', 'running', 'running'), run: { worktree: '/w5', branch: 'task/AV-5', where: 'cloud' as const, cloud, name: 'acme · AV-5 · builder' }, cloud: { url: cloud.url, wait: null, finished: false } } as TaskRow;
  const actions = cardActions(running, {}, config(true, CLOUD));
  const watch = find(actions, 'Watch')!;
  assert.deepEqual([watch.command, watch.icon, !!watch.primary, watch.disabled], ['acc.task.watch', 'pulse', true, undefined], 'Watch is the next step, and opens the session on claude.ai');
  assert.deepEqual([find(actions, 'Send a message')?.command, find(actions, 'Send a message')?.disabled], ['acc.task.message', undefined]);
  assert.deepEqual([find(actions, 'Collect')?.command, find(actions, 'Collect')?.disabled, !!find(actions, 'Collect')?.primary], ['acc.task.collect', undefined, false]);
  const open = find(actions, 'Open in Claude Code')!;
  assert.equal(open.disabled, 'Its conversation runs on claude.ai, not on this Mac: Watch opens it there.');
  assert.equal(find(actions, 'Resume'), undefined, 'nothing on this Mac to resume');
  assert.equal(find(actions, 'Abandon (its session stays on claude.ai)')?.command, 'acc.task.abandon');
  assert.equal(find(actions, 'Abandon'), undefined);
  // Quiet for too long, or finished: Collect is the next step.
  const quiet = cardActions({ ...running, display: 'needs-you', cloud: { url: cloud.url, wait: 'no word from its cloud builder for 150 minutes', finished: false } } as TaskRow, {}, config(true, CLOUD));
  assert.deepEqual([!!find(quiet, 'Collect')?.primary, !!find(quiet, 'Watch')?.primary], [true, false]);
  const done = cardActions({ ...running, cloud: { url: cloud.url, wait: null, finished: true } } as TaskRow, {}, config(true, CLOUD));
  assert.equal(!!find(done, 'Collect')?.primary, true);
  // In review, the cloud's own buttons are gone, and Watch stays for its session; a local task never sees them.
  const review = cardActions({ ...running, state: 'review', display: 'review' } as TaskRow, {}, config(true, CLOUD));
  assert.deepEqual([find(review, 'Collect'), find(review, 'Send a message'), find(review, 'Watch')?.command], [undefined, undefined, 'acc.task.watch']);
  const local = cardActions({ ...row('AV-6', 'running', 'running'), run: { worktree: '/w6', branch: 'b6', bgId: 'bg1', sessionId: 's1' } } as TaskRow, {}, config(true, CLOUD));
  assert.deepEqual([find(local, 'Collect'), find(local, 'Send a message'), find(local, 'Open in Claude Code')?.disabled, find(local, 'Abandon')?.command], [undefined, undefined, undefined, 'acc.task.abandon']);
});
