// A task's card on its GitHub Project follows acc's own moves (GH-146): acc set, done and block move it, a
// read moves nothing, and a person's drag stands until the task moves again. acc runs from its source, in
// throwaway repos (support.ts), with a gh on PATH that stands in for GitHub's GraphQL.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mutate, parseConfig, readLedger, repoPaths, run, upsertTasks } from '../../core/src/index.ts';
import { cli, repoWithConfig, UNCHECKED } from './support.ts';
import { standIn } from '../../core/test/stand-in.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const COLUMNS = ['Todo', 'In Progress', 'Testing', 'Blocked', 'Done'];

/**
 * A repo whose GitHub tracker says "edits", with GH-9 from issue #9, to do, and a gh that answers GraphQL
 * from a file: the card's column is in `<dir>/column`, each write is appended to `<dir>/writes`, and a
 * `<dir>/fail` file makes the write fail with its text.
 */
function cardRepo(tracker: Record<string, unknown> = { kind: 'github', edits: true }) {
  const raw = { ...UNCHECKED, github: { repo: 'o/r', account: 'me' }, trackers: [tracker] };
  const dir = repoWithConfig(raw);
  const config = parseConfig(raw).config!;
  const now = () => new Date('2026-10-09T12:00:00Z');
  mutate(repoPaths(dir, run), now, (l, emit) => upsertTasks(l, config, [{ source: { kind: 'github', key: '#9', url: 'https://github.com/o/r/issues/9' }, title: 'Fix login' }], 'human', 'human:test', emit, now));
  writeFileSync(join(dir, 'column'), 'opt-0');
  const options = JSON.stringify(COLUMNS.map((name, i) => ({ id: `opt-${i}`, name })));
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  standIn(join(bin, 'gh'), `#!/bin/sh
echo "$@" >> "${dir}/calls"
case "$1 $2" in
  "auth token") [ "$4" = "me" ] && echo tok-me || exit 1 ;;
  "api graphql")
    case "$*" in
      *"query=mutation"*)
        [ "$GH_TOKEN" = "tok-me" ] || { echo "wrong account" >&2; exit 1; }
        [ -f "${dir}/fail" ] && { cat "${dir}/fail" >&2; exit 1; }
        option=$(echo "$*" | sed -n 's/.*option=\\([^ ]*\\).*/\\1/p')
        echo "$option" > "${dir}/column"; echo "$option" >> "${dir}/writes"
        echo '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"item-9"}}}}' ;;
      *)
        echo '{"data":{"repository":{"projectsV2":{"nodes":[{"id":"proj-1","number":1,"closed":false,"field":{"id":"field-status","options":${options}}}]},"issue":{"projectItems":{"nodes":[{"id":"item-9","project":{"id":"proj-1"},"fieldValueByName":{"optionId":"'"$(cat "${dir}/column")"'"}}]}}}}}' ;;
    esac ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  const column = () => COLUMNS[Number(read('column').trim().slice(4))];
  const writes = () => read('writes').split('\n').filter(Boolean).map((o) => COLUMNS[Number(o.slice(4))]);
  return { dir, env: { PATH: `${bin}${delimiter}${process.env.PATH}` }, ledger: repoPaths(dir, run).ledger, column, writes, calls: () => read('calls') };
}

test('acc set, done and block move the task\'s card on its GitHub Project to the column for its new state (GH-146)', () => {
  const r = cardRepo();
  for (const [args, column] of [
    [['set', 'GH-9', 'running', '--force', '--reason', 'started by hand'], 'In Progress'],
    [['done', 'GH-9'], 'Testing'],
    [['set', 'GH-9', 'rework', '--reason', 'needs a test'], 'In Progress'],
    [['block', 'GH-9', 'Which browsers?'], 'Blocked'],
    [['set', 'GH-9', 'done', '--force', '--reason', 'shipped by hand'], 'Done'],
  ] as const) {
    const res = acc(r.dir, [...args], undefined, r.env);
    assert.equal(res.code, 0, res.err);
    assert.equal(res.err, '', 'nothing to say when it moved');
    assert.equal(r.column(), column, args.join(' '));
  }
  assert.deepEqual(r.writes(), ['In Progress', 'Testing', 'In Progress', 'Blocked', 'Done'], 'one write a move');
  assert.deepEqual(readLedger(r.ledger).tasks[0]!.card, { state: 'done', column: 'Done', at: readLedger(r.ledger).tasks[0]!.card!.at });
});

test('reading moves no card, and a card a person dragged stays put until the task moves again (GH-146)', () => {
  const r = cardRepo();
  assert.equal(acc(r.dir, ['set', 'GH-9', 'running', '--force', '--reason', 'started by hand'], undefined, r.env).code, 0);
  assert.equal(r.column(), 'In Progress');
  // A person drags the card to Testing on the Tasks tab: the tracker's own move, outside acc's ledger.
  writeFileSync(join(r.dir, 'column'), 'opt-2');
  const calls = r.calls();
  const seq = readLedger(r.ledger).seq;
  for (const args of [['list'], ['show', 'GH-9'], ['status'], ['ready'], ['sync']]) assert.equal(acc(r.dir, args, undefined, r.env).code, 0, args.join(' '));
  assert.equal(r.calls(), calls, 'no gh call from a read, or from a sync that moved nothing');
  assert.equal(readLedger(r.ledger).seq, seq, 'and no write to the ledger');
  assert.equal(r.column(), 'Testing', 'the drag stands');
  // The task moves on: its card follows the new state.
  assert.equal(acc(r.dir, ['set', 'GH-9', 'blocked', '--reason', 'waiting'], undefined, r.env).code, 0);
  assert.equal(r.column(), 'Blocked');
});

test('a card that can\'t move is said once and kept on the task; the state changes all the same (GH-146)', () => {
  const r = cardRepo();
  writeFileSync(join(r.dir, 'fail'), 'GraphQL: Resource not accessible by integration');
  const res = acc(r.dir, ['set', 'GH-9', 'running', '--force', '--reason', 'started by hand'], undefined, r.env);
  assert.equal(res.code, 0, 'the move stands');
  assert.match(res.out, /GH-9: todo → /);
  assert.equal(res.err, '! Couldn\'t move GH-9\'s card to In Progress on its GitHub Project: GraphQL: Resource not accessible by integration. GH-9 is running all the same.\n');
  const t = readLedger(r.ledger).tasks[0]!;
  assert.equal(t.state, 'running');
  assert.equal(t.card?.failed, 'GraphQL: Resource not accessible by integration');
  assert.match(acc(r.dir, ['show', 'GH-9'], undefined, r.env).out, /! Its card couldn't move on its GitHub Project: GraphQL: Resource not accessible by integration\./);
  assert.equal(r.column(), 'Todo');
  assert.equal(acc(r.dir, ['list'], undefined, r.env).err, '', 'said once: a read doesn\'t say it again');
});

test('a tracker without "edits" moves no card, and asks gh nothing (GH-146)', () => {
  const r = cardRepo({ kind: 'github' });
  const res = acc(r.dir, ['set', 'GH-9', 'running', '--force', '--reason', 'started by hand'], undefined, r.env);
  assert.equal(res.code, 0, res.err);
  assert.equal(r.calls(), '');
  assert.equal(readLedger(r.ledger).tasks[0]!.card, undefined);
});
