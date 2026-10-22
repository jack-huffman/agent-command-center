import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, readAnalysis, writeAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { renderPacket } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { decisionIn, parseShapes, parseShapeSplit, SHAPE_KINDS, SHAPE_PROMPT, SHAPE_SCHEMA } from '../src/shape-first.ts';
import { shapeSection, shapeTeamLines, splitRefusal, splitShapeFirst } from '../src/shape-split.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');

/** Claude Code's JSON result, as `claude -p --output-format json --json-schema` prints it. */
const result = (structured: unknown): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's', total_cost_usd: 0.5, structured_output: structured }),
});

const SHAPE = { name: 'The plan format', kind: 'type', why: 'T-98 to T-100 read it', files: ['packages/core/src/analyze.ts'], users: ['T-98', 'T-99'] };
const SPLIT = { why: 'T-98 and T-99 need only the format.', first: { title: 'The plan format', brief: 'Add the type and its tests.' }, rest: { title: 'Draw the plan', brief: 'Show it on the page.' } };
const BASE = {
  verdict: 'ready', summary: 'Adds options to the plan.', requirements: { goal: 'G', criteria: ['C'], assumptions: [], outOfScope: [] }, questions: [], decisions: [], findings: [],
  approach: { plan: ['Do it'], files: [], refactors: [], risks: [], tests: [], size: 'M' }, split: [],
};

/** A repo with the task to plan, a task in flight and one ready, and a fake agent that answers with `answer`. */
function setup(answer: Record<string, unknown>) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [
      { source: { kind: 'manual', key: 'T-97' }, title: 'Plan options' },
      { source: { kind: 'manual', key: 'T-98' }, title: 'Talk a plan through' },
    ], 'human', 'human:test', emit, now);
  });
  let input = '';
  let system = '';
  let schema: any = null;
  const fake = fakeRunner({});
  const runner = (cmd: string, args: string[], opts?: RunOptions) => {
    if (cmd !== 'claude') return fake(cmd, args, opts);
    input = String(opts?.input);
    system = args[args.indexOf('--append-system-prompt') + 1]!;
    schema = JSON.parse(args[args.indexOf('--json-schema') + 1]!);
    return result({ ...BASE, ...answer });
  };
  const make = () => analyze(paths, config, 'T-97', { run: runner, now, env: { PATH: '/bin' }, accCommand: 'acc', uuid: () => 'u' });
  return { paths, config, make, seen: () => ({ input, system, schema }) };
}

test('a plan names a shared shape and suggests a small first task for it, with the rest after it', () => {
  const { make, seen, paths } = setup({ sharedShapes: [SHAPE], shapeSplit: SPLIT });
  const a = make();
  assert.deepEqual(a.sharedShapes, [{ ...SHAPE, kind: 'type' }]);
  assert.deepEqual(a.shapeSplit, { why: SPLIT.why, first: SPLIT.first, rest: SPLIT.rest });
  assert.deepEqual(readAnalysis(paths, 'T-97')?.shapeSplit?.first, SPLIT.first, 'kept with the plan');
  // The analyst is told to look, and given the tasks in flight and ready to look at (T-103's team).
  assert.ok(seen().system.includes(SHAPE_PROMPT));
  assert.ok(seen().schema.properties.sharedShapes && seen().schema.properties.shapeSplit, 'its answer has room for both');
  assert.match(seen().input, /## The tasks in flight and ready/);
  assert.match(seen().input, /- T-98 \(ready\): Talk a plan through/);
  assert.ok(!seen().input.includes('- T-97 (ready)'), 'not itself');
});

test('a task with no shared shape suggests no split, even when the analyst wrote one', () => {
  const none = setup({ sharedShapes: [], shapeSplit: SPLIT });
  const a = none.make();
  assert.deepEqual(a.sharedShapes, []);
  assert.equal(a.shapeSplit, undefined, 'a split with no shape to put first is dropped');
  const empty = setup({ sharedShapes: [], shapeSplit: { why: '', first: { title: '', brief: '' }, rest: { title: '', brief: '' } } });
  assert.equal(empty.make().shapeSplit, undefined);
  // An analysis from before shapes has neither field.
  const older = setup({});
  assert.equal(older.make().shapeSplit, undefined);
});

test('shapes are read leniently: an unknown kind is a module, a nameless shape is dropped, and a half-made split is none', () => {
  assert.deepEqual(parseShapes([{ name: ' A ', kind: 'banana', why: 'w', files: ['a.ts', 3, ' '], users: ['T-1'] }, { name: ' ' }, null]), [{ name: 'A', kind: 'module', why: 'w', files: ['a.ts'], users: ['T-1'] }]);
  assert.deepEqual(parseShapes('nothing'), []);
  const shapes = parseShapes([SHAPE]);
  assert.equal(parseShapeSplit({ ...SPLIT, rest: { title: '', brief: 'x' } }, shapes), undefined, 'both tasks need a title');
  assert.equal(parseShapeSplit(undefined, shapes), undefined);
  assert.deepEqual(SHAPE_SCHEMA.sharedShapes.items.properties.kind.enum, [...SHAPE_KINDS]);
});

test('the tasks in flight and ready are none when the team can\'t be read or no other task is there', () => {
  const { paths, config } = setup({});
  const ledger = readLedger(paths.ledger);
  assert.deepEqual(shapeTeamLines(paths, config, { tasks: [] }, run, 'T-1'), []);
  assert.deepEqual(shapeTeamLines(paths, config, { tasks: ledger.tasks.filter((t) => t.id === 'T-97') }, run, 'T-97'), []);
  // A ledger it can't read: the plan is made without the team.
  assert.deepEqual(shapeTeamLines(paths, config, { tasks: null as never }, run, 'T-97'), []);
  // A runner that fails still leaves the ready tasks to list.
  const broken = (): RunResult => ({ code: 128, stdout: '', stderr: 'broke' });
  assert.match(shapeTeamLines(paths, config, ledger, broken, 'T-97').join('\n'), /- T-98 \(ready\)/);
});

test('Split into these tasks makes the shape task and the rest, which waits for it, and blocks the task', () => {
  const { paths, config, make } = setup({ sharedShapes: [SHAPE], shapeSplit: SPLIT });
  make();
  const made = splitShapeFirst(paths, config, 'T-97', 'human:me', now);
  assert.deepEqual(made, { first: 'T-99', rest: 'T-100' }, 'the next free manual ids');
  const tasks = readLedger(paths.ledger).tasks;
  const first = tasks.find((t) => t.id === made.first)!;
  const rest = tasks.find((t) => t.id === made.rest)!;
  assert.equal(first.title, 'The plan format');
  assert.match(first.brief, /Add the type and its tests\.\n\nSplit from T-97: Plan options\. It makes the shape and its tests only: nothing is drawn\./);
  assert.deepEqual(first.deps, []);
  assert.deepEqual(rest.deps, [made.first], 'the rest depends on the shape');
  assert.match(rest.brief, /It waits for T-99, which makes the shape it builds on\./);
  assert.deepEqual(rest.shapeFrom, { task: made.first, shapes: ['The plan format'], files: ['packages/core/src/analyze.ts'] });
  assert.equal(first.environment, 'main');
  const was = tasks.find((t) => t.id === 'T-97')!;
  assert.equal(was.state, 'blocked');
  assert.equal(was.blocker, 'Split into T-99 (the shape) and T-100 (the rest).');
  assert.deepEqual(readAnalysis(paths, 'T-97')?.shapeSplit?.made, { ...made, by: 'human:me', at: now().toISOString() });
});

test('a split is refused when it\'s made already, not suggested, not waiting to be built, or the plan is missing', () => {
  const { paths, config, make } = setup({ sharedShapes: [SHAPE], shapeSplit: SPLIT });
  assert.throws(() => splitShapeFirst(paths, config, 'T-97', 'human:me', now), /T-97 has no plan yet/);
  make();
  splitShapeFirst(paths, config, 'T-97', 'human:me', now);
  const before = readLedger(paths.ledger).tasks.length;
  assert.throws(() => splitShapeFirst(paths, config, 'T-97', 'human:me', now), /already split into T-99 and T-100/);
  assert.equal(readLedger(paths.ledger).tasks.length, before, 'a second split makes nothing');
  const noSplit = setup({});
  noSplit.make();
  assert.throws(() => splitShapeFirst(noSplit.paths, noSplit.config, 'T-97', 'human:me', now), /suggests no shape-first split/);
  const running = setup({ sharedShapes: [SHAPE], shapeSplit: SPLIT });
  const a = running.make();
  assert.equal(splitRefusal({ id: 'T-97', state: 'running' }, a), 'T-97 isn\'t waiting to be built, so it can\'t be split.');
  assert.equal(splitRefusal({ id: 'T-97', state: 'todo' }, a), null);
  assert.throws(() => splitShapeFirst(running.paths, running.config, 'T-1', 'human:me', now), /has no plan yet/);
});

test('a new plan version that suggests no split leaves the tasks a person already made', () => {
  const { paths, config, make } = setup({ sharedShapes: [SHAPE], shapeSplit: SPLIT });
  make();
  const made = splitShapeFirst(paths, config, 'T-97', 'human:me', now);
  const a = readAnalysis(paths, 'T-97')!;
  delete a.shapeSplit;
  writeAnalysis(paths, a);
  assert.ok(readLedger(paths.ledger).tasks.some((t) => t.id === made.rest), 'the tasks stay');
});

test('the rest\'s packet names the shape\'s decision and files once the first task merged, and nothing for other tasks', () => {
  const rest = { id: 'T-100', shapeFrom: { task: 'T-99', shapes: ['The plan format'], files: ['packages/core/src/analyze.ts'] } };
  const first = { id: 'T-99', title: 'The plan format', state: 'done' as const, changes: { at: '', paths: ['docs/decisions/D-199-the-plan-format.md', 'packages/core/src/analyze.ts', 'packages/core/test/analyze.test.ts'] } };
  const text = shapeSection(rest, [first]).join('\n');
  assert.match(text, /## The shape you build on/);
  assert.match(text, /T-99, The plan format, made the shape first so this task could start: The plan format\./);
  assert.match(text, /Its decision: D-199, in `docs\/decisions\/D-199-the-plan-format\.md`\./);
  assert.match(text, /Its files: `packages\/core\/src\/analyze\.ts`, `packages\/core\/test\/analyze\.test\.ts`\./);
  assert.ok(!text.includes('Its files: `docs'), 'the decision file is named as the decision');
  // Without kept changes (its first task's merge wasn't read), the plan's own files and a pointer stand in.
  const unread = shapeSection(rest, [{ ...first, changes: null }]).join('\n');
  assert.match(unread, /Its files: `packages\/core\/src\/analyze\.ts`\./);
  assert.match(unread, /T-99's own note and decision file/);
  assert.deepEqual(shapeSection({}, [first]), [], 'a task that isn\'t the rest of a split');
  // A decision still on the first task's branch is named by its task.
  assert.deepEqual(decisionIn(['docs/decisions/new-T-99-the-shape.md']), { id: 'D-T-99', file: 'docs/decisions/new-T-99-the-shape.md' });
  assert.equal(decisionIn(['src/a.ts', 'docs/decisions/notes.md']), null);
});

test('the packet of the rest carries the shape section after the notes of the tasks it depends on', () => {
  const { paths, config, make } = setup({ sharedShapes: [SHAPE], shapeSplit: SPLIT });
  make();
  const made = splitShapeFirst(paths, config, 'T-97', 'human:me', now);
  const tasks = readLedger(paths.ledger).tasks;
  const first: Task = { ...tasks.find((t) => t.id === made.first)!, state: 'done', changes: { at: '', paths: ['docs/decisions/D-199-x.md', 'src/shape.ts'] } };
  const rest = tasks.find((t) => t.id === made.rest)!;
  const env = config.environments[0]!;
  const packet = renderPacket({ task: rest, config, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [], deps: [first] });
  assert.match(packet, /## The shape you build on/);
  assert.match(packet, /Its decision: D-199/);
  const plain = renderPacket({ task: first, config, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [], deps: [] });
  assert.ok(!plain.includes('The shape you build on'));
});
