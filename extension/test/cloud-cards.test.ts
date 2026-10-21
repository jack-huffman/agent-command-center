// A cloud builder's card (GH-69): why the cloud is off, which Dispatch's sheet says now that no card offers
// Dispatch to the cloud (D-168); a running cloud task's Watch, Send a message and Collect, with Open in
// Claude Code disabled and why; Abandon's cloud label.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskRow } from '../src/logic/shared.ts';
import { emptyLedger, type Task } from '../../packages/core/src/ledger.ts';
import type { Hub } from '../src/hub.ts';
import { accLook } from '../src/model/boards.ts';
import { cardActions, cloudDisabled, cloudReviewLook } from '../src/model/cards.ts';
import { dispatchSheet } from '../src/model/dispatch-sheet.ts';
import { cloudSetting } from '../src/model/settings.ts';
import { deriveRows } from '../src/task-rows.ts';
import { row } from './support.ts';

const CLOUD = { routine: 'trig_01ABCDEFGHJKLMNOPQRSTUVW', default: 'local' as const, quietMinutes: 120, max: 3, review: 'local' as const };
const config = (github: boolean, cloud: typeof CLOUD | { routine: null } | null) => ({ github: github ? { repo: 'o/r', account: 'me' } : null, agents: { cloud: cloud ? { ...CLOUD, ...cloud } : null } });
const labels = (actions: ReturnType<typeof cardActions>) => actions.map((a) => a.label);
const find = (actions: ReturnType<typeof cardActions>, label: string) => actions.find((a) => a.label === label);

test('the cloud is off with its reason where the repo isn\'t on GitHub or the project hasn\'t opted in, in Dispatch\'s sheet, and no card offers it alone', () => {
  const todo = { ...row('AV-2', 'todo', 'ready'), deps: [] } as TaskRow;
  assert.equal(cloudDisabled(config(false, null)), 'Cloud builders need the repo on GitHub');
  assert.equal(cloudDisabled(config(true, null)), 'Cloud builders are off for this project: opt in under Settings');
  assert.equal(cloudDisabled(config(true, { routine: null })), 'Cloud builders need a routine for the repo: Setup says how');
  assert.equal(cloudDisabled(config(true, CLOUD)), null);
  assert.equal(cloudDisabled(null), 'Cloud builders need the repo on GitHub', 'no config at all: not on GitHub as far as the card knows');
  const builder = { model: 'claude-opus-5-5', effort: null, from: { model: 'acc', effort: 'default' } };
  for (const [cfg, why] of [[config(false, null), 'Cloud builders need the repo on GitHub'], [config(true, null), 'Cloud builders are off for this project: opt in under Settings'], [config(true, CLOUD), undefined]] as const) {
    assert.equal(dispatchSheet({ project: '/r', row: todo, builder, config: cfg }).places.find((p) => p.value === 'cloud')!.disabled, why, 'Dispatch\'s sheet says why');
  }
  // No card offers the cloud on its own, to do, in rework or running: the sheet's Where does (D-168).
  for (const t of [todo, { ...row('AV-3', 'rework', 'rework'), deps: [] }, { ...row('AV-4', 'running', 'running'), run: { worktree: '/w', branch: 'b' } }] as TaskRow[]) {
    assert.ok(!labels(cardActions(t, {})).some((l) => l.includes('cloud')), t.id);
    assert.ok(!cardActions(t, {}).some((a) => a.command === 'acc.task.dispatchCloud'), t.id);
  }
});

test('a running cloud task offers Watch, Send a message and Collect, and Open in Claude Code disabled with why; Attach has no place; Abandon says the session stays', () => {
  const cloud = { sessionId: 'session_01X', url: 'https://claude.ai/code/session_01X', firedAt: '2026-10-09T12:00:00Z', head: 'abc', lastPushAt: '2026-10-09T12:00:00Z' };
  const running = { ...row('AV-5', 'running', 'running'), run: { worktree: '/w5', branch: 'task/AV-5', where: 'cloud' as const, cloud, name: 'acme · AV-5 · builder' }, cloud: { url: cloud.url, wait: null, finished: false } } as TaskRow;
  const actions = cardActions(running, {});
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
  const quiet = cardActions({ ...running, display: 'needs-you', cloud: { url: cloud.url, wait: 'no word from its cloud builder for 150 minutes', finished: false } } as TaskRow, {});
  assert.deepEqual([!!find(quiet, 'Collect')?.primary, !!find(quiet, 'Watch')?.primary], [true, false]);
  const done = cardActions({ ...running, cloud: { url: cloud.url, wait: null, finished: true } } as TaskRow, {});
  assert.equal(!!find(done, 'Collect')?.primary, true);
  // In review, the cloud's own buttons are gone, and Watch stays for its session; a local task never sees them.
  const review = cardActions({ ...running, state: 'review', display: 'review' } as TaskRow, {});
  assert.deepEqual([find(review, 'Collect'), find(review, 'Send a message'), find(review, 'Watch')?.command], [undefined, undefined, 'acc.task.watch']);
  const local = cardActions({ ...row('AV-6', 'running', 'running'), run: { worktree: '/w6', branch: 'b6', bgId: 'bg1', sessionId: 's1' } } as TaskRow, {});
  assert.deepEqual([find(local, 'Collect'), find(local, 'Send a message'), find(local, 'Open in Claude Code')?.disabled, find(local, 'Abandon')?.command], [undefined, undefined, undefined, 'acc.task.abandon']);
});

// ---------------------------------------------------------------- a review in the cloud (T-86)

const CLOUD_REVIEW = { url: 'https://claude.ai/code/session_01R', firedAt: '2026-10-09T12:00:00Z', wait: null, failed: false };
const inCloud = (over: Partial<TaskRow> = {}): TaskRow => ({ ...row('AV-6', 'review', 'review'), run: { worktree: '/w6', branch: 'task/AV-6' }, review: null, reviewing: { sessionId: 'session_01R', name: 'acme · AV-6 · review', where: 'cloud', url: CLOUD_REVIEW.url }, cloudReview: CLOUD_REVIEW, ...over } as TaskRow);
const QUIET = 'no verdict from its cloud reviewer for 150 minutes: review it on this Mac';

test('a task reviewed in the cloud says so on its card, with an icon and a label; quiet for too long or with a verdict acc couldn\'t read it needs you, with why, and Review on this Mac is its next step (T-86)', () => {
  assert.deepEqual(cloudReviewLook(inCloud()), { label: 'Reviewing in the cloud', icon: 'cloud', tone: 'blue' });
  assert.deepEqual(accLook(inCloud()), { label: 'Reviewing in the cloud', icon: 'cloud', tone: 'blue' }, 'the card\'s state is the review\'s');
  const live = cardActions(inCloud(), {});
  assert.deepEqual([find(live, 'Watch the review')?.command, !!find(live, 'Watch the review')?.primary], ['acc.task.watchReview', true], 'Watch leads, and opens its page on claude.ai');
  assert.ok(!find(live, 'Review on this Mac'), 'while it reads, nothing asks for a review here');
  assert.ok(!find(live, 'Review'), 'nor a plain Review, which the project\'s setting might send to the cloud again');
  // Quiet: needs you, with the reason, and the way on is a review here, whatever the setting says.
  const quiet = inCloud({ display: 'needs-you', cloudReview: { ...CLOUD_REVIEW, wait: QUIET } });
  assert.deepEqual(cloudReviewLook(quiet), { label: `Needs you: ${QUIET}`, icon: 'bell', tone: 'orange' });
  assert.deepEqual(accLook(quiet), { label: `Needs you: ${QUIET}`, icon: 'bell', tone: 'orange' });
  const acts = cardActions(quiet, {});
  const local = find(acts, 'Review on this Mac')!;
  assert.deepEqual([local.command, local.icon, !!local.primary], ['acc.task.reviewLocal', 'checklist', true]);
  assert.deepEqual([find(acts, 'Watch the review')?.command, !!find(acts, 'Watch the review')?.primary], ['acc.task.watchReview', false], 'Watch stays, second');
  // Failed: no reviewer to watch any more; the reason, and Review on this Mac.
  const failed = inCloud({ display: 'needs-you', reviewing: null, cloudReview: { ...CLOUD_REVIEW, wait: 'its cloud reviewer pushed acc/review/AV-6-abc without review.json: review it on this Mac', failed: true } });
  assert.match(cloudReviewLook(failed)!.label, /^Needs you: its cloud reviewer pushed/);
  assert.deepEqual(labels(cardActions(failed, {})).filter((l) => /Review/.test(l)), ['Review on this Mac']);
  assert.equal(cloudReviewLook({ cloudReview: null }), null, 'edge case: no cloud review');
  assert.equal(cloudReviewLook({ cloudReview: { ...CLOUD_REVIEW, failed: true } }), null, 'edge case: a failed review whose reason is gone shows nothing of itself');
  // A review here, as before: Watch, no cloud words.
  const here = cardActions({ ...row('AV-7', 'review', 'review'), reviewing: { sessionId: 'rv-7' } } as TaskRow, {});
  assert.deepEqual(labels(here).filter((l) => /review|Review/.test(l)), ['Watch the review']);
  assert.equal(accLook({ ...row('AV-7', 'review', 'review'), reviewing: { sessionId: 'rv-7' } } as TaskRow).label, 'In review');
});

test('deriveRows reads a task\'s cloud review from the ledger: its reviewer to watch on claude.ai, and needs you once it is quiet or failed; a task with none has no cloud review (T-86 edge cases)', () => {
  // deriveRows reads the clock itself, so the fire is placed that many minutes before now.
  const firedAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const cr = (firedAt: string, failed: { at: string; reason: string } | null = null) => ({ sessionId: 'session_01R', url: 'https://claude.ai/code/session_01R', firedAt, sha: 'abc', branch: 'acc/review/AV-9-abc', failed });
  const read = (cloudReview: Task['cloudReview']): TaskRow => {
    const task = {
      id: 'AV-9', title: 'Task AV-9', brief: '', source: { kind: 'manual', url: null }, environment: 'devbox', deps: [], labels: [], state: 'review', blocker: null,
      run: { worktree: '/w', branch: 'task/AV-9' }, pr: null, history: [], createdAt: '', updatedAt: '', cloudReview,
    } as unknown as Task;
    const project = { name: 'Acme', root: '/r', ledgerPath: '/r/.git/acc/ledger.json', config: { github: { repo: 'o/r', account: 'me' }, environments: [], profile: 'generic', agents: { cloud: CLOUD } }, worktrees: [] };
    const fake = { agentsAt: 1, agentsError: null, agents: [], questions: [], askingFor: () => null, tieFor: () => null, lastSaid: () => null, lastModel: () => null, changed: new Map(), limits: null } as unknown as Hub;
    return deriveRows(fake, { ...emptyLedger(), tasks: [task] }, project as never)[0]!;
  };
  const fresh = firedAgo(30);
  const live = read(cr(fresh));
  assert.deepEqual(live.reviewing, { sessionId: 'session_01R', name: 'Acme · AV-9 Task AV-9 · review', where: 'cloud', url: 'https://claude.ai/code/session_01R' });
  assert.deepEqual(live.cloudReview, { url: 'https://claude.ai/code/session_01R', firedAt: fresh, wait: null, failed: false });
  assert.equal(live.display, 'review');
  const quiet = read(cr(firedAgo(150)));
  assert.equal(quiet.display, 'needs-you');
  assert.equal(quiet.cloudReview?.wait, QUIET);
  assert.ok(quiet.reviewing, 'still to watch');
  const failed = read(cr(firedAgo(5), { at: firedAgo(1), reason: 'its cloud reviewer pushed acc/review/AV-9-abc without review.json: review it on this Mac' }));
  assert.equal(failed.display, 'needs-you');
  assert.equal(failed.reviewing, null, 'nothing to watch: it gave what it gave');
  assert.deepEqual([failed.cloudReview?.failed, failed.cloudReview?.wait], [true, 'its cloud reviewer pushed acc/review/AV-9-abc without review.json: review it on this Mac']);
  const none = read(null);
  assert.deepEqual([none.reviewing, none.cloudReview, none.display], [null, null, 'review']);
  assert.deepEqual([read(undefined).cloudReview, read(undefined).reviewing], [null, null], 'an older ledger with no field');
});

test('Settings shows where reviews run beside where a plain dispatch goes, with a button to change it; off with why until the project opts in to cloud builders (T-86)', () => {
  const p = (github: boolean, cloud: (Omit<typeof CLOUD, 'review'> & { review: 'local' | 'cloud' }) | null) => ({ name: 'P', root: '/p', branch: null, worktrees: [], config: { github: github ? { repo: 'o/r', account: 'a' } : null, environments: [], profile: 'generic', agents: { cloud } } });
  const on = cloudSetting(p(true, CLOUD) as never)!;
  assert.deepEqual(on.reviewPlace, { label: 'This Mac', icon: 'device-desktop', tone: 'neutral' });
  assert.deepEqual(cloudSetting(p(true, { ...CLOUD, review: 'cloud' }) as never)!.reviewPlace, { label: 'Cloud', icon: 'cloud', tone: 'neutral' });
  const reviews = on.actions.find((a) => a.label === 'Reviews…')!;
  assert.deepEqual([reviews.command, reviews.icon, reviews.disabled, reviews.arg], ['acc.cloud.review', 'checklist', null, '/p']);
  const off = cloudSetting(p(true, null) as never)!;
  assert.equal(off.reviewPlace, null, 'nothing to show while cloud builders are off');
  assert.equal(off.actions.find((a) => a.label === 'Reviews…')!.disabled, 'Cloud builders are off for this project: opt in under Settings');
  assert.equal(cloudSetting(p(false, null) as never)!.actions.find((a) => a.label === 'Reviews…')!.disabled, 'Cloud builders need the repo on GitHub');
});
