// Settings' Limits and checks (GH-111): the part's model, in words and states, from this machine's own
// numbers; what it reads; and every command it runs, each through acc, with a stand-in for VS Code.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../../packages/core/src/config.ts';
import { mutate, readLedger, upsertTasks } from '../../packages/core/src/ledger.ts';
import { ledgersDir, registerLedger, setMachineAgents } from '../../packages/core/src/limits.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { run } from '../../packages/core/src/exec.ts';
import { GENERIC_CONFIG, makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { sampleLimits, sampleLimitsOther } from '../scripts/fixtures/limits.ts';
import { limitCommands, type LimitsDeps, type LimitsProject, readLimits } from '../src/limits.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import { filesLook } from '../src/model/cards.ts';
import { durationWords, LIMIT_COMMANDS, limitsModel, modelWords } from '../src/model/limits.ts';
import type { Look } from '../src/model/shared.ts';
import { hub, pageSource, root } from './support.ts';
import { homeModel } from '../src/model/home.ts';
import { HOME_SECTIONS, type HomeSection } from '../src/model/shared.ts';

const TONES = new Set(['orange', 'blue', 'neutral']);

/** Every state has an icon and words, and is orange, blue or neutral: never red against green. */
function looksRight(look: Look | null, where: string): void {
  if (!look) return;
  assert.ok(look.icon && look.label.length > 3, `${where}: an icon and a label`);
  assert.ok(TONES.has(look.tone), `${where}: ${look.tone}`);
}

test('the two caps sit side by side, each with − and + and its number, and where it\'s set', () => {
  const m = limitsModel(sampleLimits());
  assert.deepEqual(m.caps.map((c) => [c.key, c.title, c.project, c.value, c.command, c.arg]), [
    ['project:/Users/me/code/acme-service', 'This project\'s cap', 'Acme Service', '3', 'acc.settings.agentsMax', '/Users/me/code/acme-service'],
    ['machine', 'This machine\'s total', null, '6', 'acc.settings.machineAgents', null],
  ]);
  const [project, machine] = m.caps;
  // − and + set the next number, through the same command Change… runs.
  assert.deepEqual([project!.lower.arg, project!.raise.arg, machine!.lower.arg, machine!.raise.arg], ['/Users/me/code/acme-service|2', '/Users/me/code/acme-service|4', '5', '7']);
  assert.deepEqual([project!.lower.label, machine!.raise.label], ['Lower Acme Service\'s cap to 2', 'Raise this machine\'s total to 7']);
  assert.ok([project!.lower, project!.raise, machine!.lower, machine!.raise].every((s) => s.why === null));
  // Its project, and whether the project or acc's default sets it.
  assert.match(project!.from, /^Set in Acme Service's settings \(agents\.max\), shared with everyone who works on the repo/);
  assert.match(machine!.from, /^Set in this machine's settings, beside the heavy-check slots, for every repo on this machine: usage limits belong to your Claude account, not a project\.$/);
  // How many run now, beside each.
  assert.deepEqual(project!.look, { label: 'Full: 3 of 3 running in Acme Service, so the next start waits', icon: 'clock', tone: 'blue' });
  assert.deepEqual(machine!.look, { label: '4 of 6 running across 2 repos: room for 2 more', icon: 'hubot', tone: 'blue' });
});

test('a − or + that can\'t move says why; no total has neither, and Change… sets one', () => {
  const m = limitsModel(sampleLimitsOther());
  const [acme, tool, machine] = m.caps;
  assert.deepEqual([acme!.title, acme!.lower.arg, acme!.lower.why, acme!.raise.arg], ['Acme Service\'s cap', null, 'One is the least: a project runs at least one builder.', '/Users/me/code/acme-service|2']);
  assert.deepEqual([tool!.raise.arg, tool!.raise.why], [null, '16 is the most a project runs at once.']);
  assert.match(acme!.from, /^acc's default: Acme Service's settings set none \(agents\.max\)\./);
  assert.deepEqual([machine!.value, machine!.lower.arg, machine!.raise.arg], ['None', null, null]);
  assert.equal(machine!.lower.why, 'There\'s no total to lower: Change… sets one.');
  assert.deepEqual(machine!.look, { label: 'No total: each project\'s cap is the only limit', icon: 'circle-large-outline', tone: 'neutral' });
  const one = limitsModel({ ...sampleLimits(), machine: { ...sampleLimits().machine, total: 1, running: 0, repos: 0 } }).caps[1]!;
  assert.deepEqual([one.lower.arg, one.lower.why, one.raise.arg], [null, 'One is the least: Change… takes the total out instead.', '2']);
  assert.deepEqual(one.look, { label: 'None running on this machine: room for 1', icon: 'circle-large-outline', tone: 'neutral' });
});

test('what a change means is in this machine\'s own numbers, and says so when there are none yet', () => {
  const words = (m: ReturnType<typeof limitsModel>) => Object.fromEntries(m.meaning.map((x) => [x.key, x.text]));
  const busy = words(limitsModel(sampleLimits()));
  assert.equal(busy.usage, 'Each agent is a Claude Code session on your account. Builders here run Opus 5.5 (claude-opus-5-5), acc\'s default unless set. More at once uses your plan\'s limits that many times faster, and at the limit Claude Code pauses them until it resets. On per-token billing, each one costs as it runs. Lately a review cost about $0.88 and an analysis about $1.23, as Claude Code estimates at API prices (the last 4 reviews and 2 analyses).');
  assert.equal(busy.slots, 'Each builder\'s checks wait for this machine\'s heavy-check slots, 2 at once: with 3 builders at once, up to one waits in line for a slot rather than finish sooner. Lately a builder here took about 45 min from its dispatch to finishing its task (the middle of its last 6).');
  assert.equal(busy.files, 'More at once means more tasks touching the same files. They take turns, and conflicts at merge get likelier. 3 builders running now in Acme Service, 4 across this machine.');
  const none = words(limitsModel(sampleLimitsOther()));
  assert.match(none.usage!, /Builders run Opus 5\.5 \(claude-opus-5-5\), acc's default unless set in Acme Service; Sonnet 5\.5 \(claude-sonnet-5-5\), set for the project in Tool\./);
  assert.match(none.usage!, /No review or analysis here has recorded a cost yet, so there's nothing to go by\.$/);
  assert.match(none.slots!, /1 at once: with 17 builders at once, up to 16 wait in line .* No builder here has finished yet, so there's no time to go by\.$/);
  assert.match(none.files!, /No builders running now in Acme Service and Tool\.$/);
  // Under a total, as many as run at once are the total's, not the caps' sum.
  assert.match(words(limitsModel({ ...sampleLimitsOther(), machine: { ...sampleLimitsOther().machine, total: 1 } })).slots!, /1 at once, so a builder never waits for another's checks\./);
  assert.deepEqual([durationWords(30_000), durationWords(45 * 60_000), durationWords(60 * 60_000), durationWords(95 * 60_000)], ['1 min', '45 min', '1 h', '1 h 35 min']);
  assert.equal(modelWords('claude-fable-5-1', 'clone'), 'Fable 5.1 (claude-fable-5-1), set for this clone');
  assert.equal(modelWords('my-own-model', 'project'), 'my-own-model, set for the project');
});

test('the heavy-check slots and each project\'s checks: value, where set, state, and a Change… or why not', () => {
  const m = limitsModel(sampleLimits(), { label: 'Per-token billing: an API key is set', icon: 'warning', tone: 'orange' });
  assert.deepEqual([m.slots.value, m.slots.command, m.slots.arg, m.slots.why], ['2 at once', 'acc.settings.heavySlots', null, null]);
  assert.deepEqual(m.slots.look, { label: '2 of 2 in use, 1 waiting', icon: 'clock', tone: 'blue' });
  assert.equal(m.billing?.tone, 'orange', 'per-token billing stays orange');
  const [required, builder] = m.checks[0]!.rows;
  assert.deepEqual([required!.value, required!.command, required!.arg, required!.look], ['format, static, validate', 'acc.settings.requiredGates', '/Users/me/code/acme-service', null]);
  assert.equal(builder!.value, 'The required checks', 'no merge queue in a Salesforce project');
  const other = limitsModel(sampleLimitsOther());
  assert.match(other.slots.why!, /^ACC_HEAVY_SLOTS sets it for this VSCode/);
  assert.deepEqual(other.slots.look, { label: 'None in use', icon: 'circle-large-outline', tone: 'neutral' });
  assert.deepEqual(other.checks.map((c) => c.project), ['Acme Service', 'Tool']);
  assert.deepEqual(other.checks[0]!.rows[0]!.look, { label: 'None: a task can finish on any commit', icon: 'warning', tone: 'orange' });
  // Where the required checks come from: the project's file when it names them, else acc's default (GH-111).
  assert.match(required!.from, /^Set in Acme Service's settings, for everyone/);
  assert.match(other.checks[0]!.rows[0]!.from, /^acc's default: Acme Service's settings set none \(gates\.required\)\. A change sets it there/);
  assert.match(other.checks[1]!.rows[0]!.from, /^Set in Tool's settings/);
  const tool = other.checks[1]!.rows;
  assert.deepEqual(tool.map((r) => r.value), ['check', 'typecheck, near-tests']);
  assert.match(tool[1]!.from, /builders run these where the merge queue runs \(main\), and the required checks run once in it\./);
  // Named but with no merge queue: said, in a neutral tone.
  const unused = limitsModel({ ...sampleLimitsOther(), projects: [{ ...sampleLimitsOther().projects[1]!, queue: [] }] }).checks[0]!.rows[1]!;
  assert.deepEqual([unused.value, unused.look], ['The required checks', { label: 'Named (typecheck, near-tests), but unused while no merge queue runs', icon: 'info', tone: 'neutral' }]);
  // Every state on the part, in every sample: an icon and words, orange, blue or neutral.
  let looks = 0;
  for (const model of [m, other]) {
    for (const c of model.caps) { looksRight(c.look, c.key); looks++; }
    for (const r of [model.slots, ...model.checks.flatMap((c) => c.rows)]) { looksRight(r.look, r.key); if (r.look) looks++; }
    looksRight(model.billing, 'billing');
  }
  assert.ok(looks >= 8, `${looks} states checked`);
});

test('the part reads its limits from the machine and each project, and counts every repo\'s builders once', () => {
  const machine = join(tempDir('machine-'), 'machine.json');
  const env = { ACC_MACHINE_FILE: machine };
  writeFileSync(machine, JSON.stringify({ heavySlots: 2 }));
  const raw = { ...GENERIC_CONFIG, autonomy: 'review', autopilot: { autoMerge: true }, gates: { required: ['check'], builder: ['quick'], commands: { check: 'true', quick: 'true' } } };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  const config = parseConfig(raw).config!;
  const paths = repoPaths(dir, run);
  mutate(paths, () => new Date(), (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'One' }, { source: { kind: 'manual', key: 'T-2' }, title: 'Two' }], 'human', 'h', emit, () => new Date());
    l.tasks[0]!.state = 'running';
  });
  // Another repo on the machine, with two running, and this one noted too: counted once.
  const other = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, project: 'Other' }) });
  const otherPaths = repoPaths(other, run);
  mutate(otherPaths, () => new Date(), (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'A' }, { source: { kind: 'manual', key: 'T-2' }, title: 'B' }], 'human', 'h', emit, () => new Date());
    for (const t of l.tasks) t.state = 'running';
  });
  registerLedger(otherPaths.ledger, 'Other', env);
  registerLedger(paths.ledger, 'Tool', env);
  setMachineAgents(5, env);
  const project: LimitsProject = { name: 'Tool', root: dir, config, ledgerPath: paths.ledger, agents: { builder: { model: 'claude-opus-5-5', from: { model: 'acc' } } } };
  const f = readLimits([project], () => readLedger(paths.ledger), { dir: '', slots: 2, held: [{ pid: 1 }], waiting: [] } as never, env);
  assert.deepEqual(f.machine, { slots: 2, slotsFrom: 'machine', inUse: 1, waiting: 0, total: 5, running: 3, repos: 2 });
  assert.deepEqual([f.projects[0]!.max, f.projects[0]!.maxFrom, f.projects[0]!.running, f.projects[0]!.required, f.projects[0]!.requiredFrom, f.projects[0]!.builder, f.projects[0]!.queue], [3, 'acc', 1, ['check', 'stray-files'], 'project', ['quick'], ['main']], 'stray-files is required beside what the project names (GH-103)');
  // A config that names no required checks has acc's default.
  const bareRaw = { ...GENERIC_CONFIG, project: 'Bare' };
  const bareDir = makeRepo({ '.acc/config.json': JSON.stringify(bareRaw) });
  const bare: LimitsProject = { name: 'Bare', root: bareDir, config: parseConfig(bareRaw).config!, ledgerPath: repoPaths(bareDir, run).ledger, agents: project.agents };
  assert.equal(readLimits([bare], () => undefined, null, env).projects[0]!.requiredFrom, 'acc');
  assert.deepEqual(f.projects[0]!.gates.map((g) => g.name), ['check', 'quick']);
  assert.equal(readLimits([project], () => readLedger(paths.ledger), null, { ...env, ACC_HEAVY_SLOTS: '3' }).machine.slotsFrom, 'env');
  assert.equal(readLimits([project], () => undefined, null, { ACC_MACHINE_FILE: join(tempDir('m-'), 'machine.json') }).machine.slotsFrom, 'default');
  // The Command Center only reads (D-012): a repo whose ledger has gone is left out, and its note left for acc.
  registerLedger(join(tempDir('gone-'), 'ledger.json'), 'Gone', env);
  const notes = readdirSync(ledgersDir(env)!).sort();
  assert.equal(notes.length, 3);
  assert.deepEqual(readLimits([project], () => readLedger(paths.ledger), null, env).machine.repos, 2);
  assert.deepEqual(readdirSync(ledgersDir(env)!).sort(), notes, 'the read deleted nothing');
});

test('a held task\'s card says which cap it waits for: the project\'s, or this machine\'s total', () => {
  const held = (capped?: 'project' | 'machine') => filesLook({ state: 'todo', display: 'ready', analyzing: false, files: { known: true, shares: [], first: [], held: { at: 't', failed: null, byAutopilot: false }, ...(capped ? { capped } : {}) } } as never);
  assert.deepEqual(held('project'), { label: 'Waits for an agent: as many are running as the project allows', icon: 'clock', tone: 'blue' });
  assert.deepEqual(held('machine'), { label: 'Waits for an agent: as many are running as this machine\'s total allows, across every repo', icon: 'clock', tone: 'blue' });
  assert.equal(held()?.label, 'Starting: the files it waited for are free');
});

/** A stand-in for VS Code's window: what each quick pick answers, and what was said. */
function stand(answers: unknown[] = []) {
  const said = { info: [] as string[], warn: [] as string[], picks: [] as { title: string; items: { label: string; description?: string; picked?: boolean; value: unknown }[]; canPickMany?: boolean }[] };
  const window = {
    showQuickPick: async (items: { value: unknown }[], o: { title: string; canPickMany?: boolean }) => {
      said.picks.push({ title: o.title, items: items as never, canPickMany: o.canPickMany });
      const a = answers.shift();
      if (typeof a === 'function') return (a as (x: unknown[]) => unknown)(items);
      return a;
    },
    showInputBox: async () => answers.shift(),
    showInformationMessage: async (m: string) => { said.info.push(m); return undefined; },
    showWarningMessage: async (m: string) => { said.warn.push(m); return undefined; },
  };
  return { vs: { window } as never, said };
}

/** Two projects, as the hub holds them, and an acc that records what it's asked and answers as told. */
function deps(over: Partial<LimitsDeps> = {}, code = 0) {
  const ran: { args: string[]; cwd: string }[] = [];
  const cfg = (raw: Record<string, unknown>) => parseConfig({ ...GENERIC_CONFIG, ...raw }).config!;
  const tool: LimitsProject = { name: 'Tool', root: '/code/tool', config: cfg({ agents: { max: 3 }, autonomy: 'review', autopilot: { autoMerge: true }, gates: { required: ['check'], commands: { check: 'npm run check', typecheck: 'tsc', lint: 'eslint' } } }), ledgerPath: '/code/tool/.git/acc/ledger.json', agents: { builder: { model: 'claude-opus-5-5', from: { model: 'acc' } } } };
  const bare: LimitsProject = { name: 'Bare', root: '/code/bare', config: cfg({ project: 'Bare' }), ledgerPath: '/code/bare/.git/acc/ledger.json', agents: { builder: { model: 'claude-opus-5-5', from: { model: 'acc' } } } };
  let changed = 0;
  const d: LimitsDeps = {
    projects: () => [tool, bare], project: (r) => [tool, bare].find((p) => p.root === r),
    acc: async (args, cwd) => { ran.push({ args, cwd }); return { code, stdout: code ? '{"message":"A builder can\'t do that."}' : '{}', stderr: '' }; },
    says: (r) => JSON.parse(r.stdout).message,
    changed: async () => { changed++; },
    slots: () => ({ slots: 2, fromEnv: false }), machineTotal: () => 6, home: '/home/me',
    ...over,
  };
  return { d, ran, changed: () => changed, tool };
}

test('each command runs acc once, with the value − or + sent or the one picked, and nothing when nothing changes', async () => {
  const { vs, said } = stand();
  const { d, ran, changed } = deps();
  const c = limitCommands(vs, d);
  assert.deepEqual(Object.keys(c).map((k) => `acc.settings.${k}`).sort(), Object.values(LIMIT_COMMANDS).sort(), 'a function for each of the part\'s commands');
  await c.agentsMax!('/code/tool|4');
  await c.machineAgents!('7');
  await c.machineAgents!('none');
  await c.heavySlots!('3');
  assert.deepEqual(ran.map((r) => [r.args.join(' '), r.cwd]), [
    ['agents max 4 --json', '/code/tool'],
    ['machine agents 7 --json', '/code/tool'],
    ['machine agents --none --json', '/code/tool'],
    ['machine heavy-slots 3 --json', '/code/tool'],
  ]);
  assert.equal(changed(), 4, 'each change is read again');
  assert.deepEqual(said.info, [
    'Tool now runs at most 4 builders at once. Changed in the project\'s settings: commit the change to share it.',
    'This machine now runs at most 7 builders at once, across every repo on it.',
    'This machine has no total now: each project\'s cap is the only limit.',
    'This machine now runs 3 heavy checks at once, for every repo on it.',
  ]);
  // The same value, or one out of range, or a project that isn't open: no acc at all.
  for (const [cmd, arg] of [['agentsMax', '/code/tool|3'], ['agentsMax', '/code/tool|17'], ['agentsMax', '/code/tool|x'], ['agentsMax', '/nowhere|2'], ['machineAgents', '6'], ['machineAgents', '65'], ['heavySlots', '2'], ['heavySlots', '9']] as const) await c[cmd]!(arg);
  assert.equal(ran.length, 4, 'nothing more ran');
});

test('Change… asks with a quick pick that marks what\'s set now, then runs acc with the pick', async () => {
  const pick = (v: unknown) => (items: { value: unknown }[]) => items.find((i) => i.value === v);
  const { vs, said } = stand([pick(5), pick(null), pick('more'), '24', pick(4)]);
  const { d, ran } = deps();
  const c = limitCommands(vs, d);
  await c.agentsMax!('/code/tool');
  await c.machineAgents!();
  await c.machineAgents!();
  await c.heavySlots!();
  assert.deepEqual(ran.map((r) => r.args.join(' ')), ['agents max 5 --json', 'machine agents --none --json', 'machine agents 24 --json', 'machine heavy-slots 4 --json']);
  const [cap, total, , slots] = said.picks;
  assert.equal(cap!.title, 'Tool: how many builders at once?');
  assert.deepEqual([cap!.items.length, cap!.items.find((i) => i.description === 'now')?.label], [16, '3']);
  assert.match(String((cap!.items[3] as { detail?: string }).detail), /^Past this machine's 2 heavy-check slots, 2 wait in line for checks\.$/);
  assert.deepEqual([total!.items[0]!.label, total!.items.find((i) => i.description === 'now')?.label, total!.items.at(-1)!.label], ['No total', '6', 'Another number…']);
  assert.deepEqual([slots!.items.length, slots!.items.find((i) => i.description === 'now')?.label], [8, '2']);
  // Dismissed: nothing runs.
  const quiet = stand([undefined, undefined, undefined]);
  const q = deps();
  const qc = limitCommands(quiet.vs, q.d);
  await qc.agentsMax!('/code/tool');
  await qc.machineAgents!();
  await qc.heavySlots!();
  assert.deepEqual(q.ran, []);
});

test('the checks are picked many at a time, at least one required; none for builders is --none', async () => {
  const names = (...v: string[]) => (items: { value: unknown }[]) => items.filter((i) => v.includes(i.value as string));
  const { vs, said } = stand([names('check', 'lint'), names(), names('typecheck'), names(), names('check')]);
  const { d, ran } = deps();
  const c = limitCommands(vs, d);
  await c.requiredGates!('/code/tool');
  await c.requiredGates!('/code/tool');
  await c.builderGates!('/code/tool');
  await c.builderGates!('/code/tool');
  await c.requiredGates!('/code/tool');
  assert.deepEqual(ran.map((r) => r.args.join(' ')), ['gate required check lint --json', 'gate builder typecheck --json']);
  assert.ok(said.picks.every((p) => p.canPickMany), 'many at a time');
  assert.deepEqual(said.picks[0]!.items.map((i) => [i.label, i.description, i.picked]), [['check', 'npm run check', true], ['typecheck', 'tsc', false], ['lint', 'eslint', false]]);
  assert.match(said.picks[0]!.title, /^Tool: which checks must every task pass\?$/);
  assert.equal(said.warn[0], 'Pick at least one check: with none, a builder could finish a task on any commit.');
  // None picked for builders, where none are named: nothing to change. Named, none picked takes them out.
  const named = deps();
  named.tool.config.gates.builder = ['typecheck'];
  const n = stand([names()]);
  await limitCommands(n.vs, named.d).builderGates!('/code/tool');
  assert.deepEqual(named.ran.map((r) => r.args.join(' ')), ['gate builder --none --json']);
  assert.equal(n.said.info[0], 'Tool\'s builders now run the required checks. Changed in the project\'s settings: commit the change to share it.');
  // A project with no checks says so, and asks nothing.
  const b = stand();
  const bd = deps();
  await limitCommands(b.vs, bd.d).requiredGates!('/code/bare');
  await limitCommands(b.vs, bd.d).builderGates!('/code/bare');
  assert.deepEqual([bd.ran, b.said.picks.length, b.said.info.length], [[], 0, 2]);
  assert.match(b.said.info[0]!, /^Bare has no checks to choose from yet/);
});

test('what acc refuses is said in its words, with nothing read again; slots set by the environment aren\'t changed here', async () => {
  const { vs, said } = stand();
  const { d, changed } = deps({}, 1);
  await limitCommands(vs, d).agentsMax!('/code/tool|5');
  assert.deepEqual([said.warn, said.info, changed()], [['A builder can\'t do that.'], [], 0]);
  const env = stand();
  const e = deps({ slots: () => ({ slots: 4, fromEnv: true }) });
  await limitCommands(env.vs, e.d).heavySlots!('3');
  assert.deepEqual(e.ran, []);
  assert.match(env.said.info[0]!, /^ACC_HEAVY_SLOTS sets this machine's heavy-check slots for this VSCode/);
  // With two projects open, Change… without one asks which.
  const which = stand([undefined]);
  const w = deps();
  await limitCommands(which.vs, w.d).agentsMax!();
  assert.deepEqual([which.said.picks[0]!.title, which.said.picks[0]!.items.map((i) => i.label), w.ran], ['Which project?', ['Tool', 'Bare'], []]);
});

test('the page asks the extension for each change, which acc makes: neither writes a file itself', () => {
  for (const c of Object.values(LIMIT_COMMANDS)) assert.ok(PAGE_COMMANDS.includes(c), `the page may ask for ${c}`);
  const page = pageSource('limits.ts');
  assert.ok(page.includes("{ type: 'toolbar', command, arg }") && page.includes("{ type: 'toolbar', command }"), 'it posts toolbar messages, nothing else');
  const ext = readFileSync(join(root, 'src', 'limits.ts'), 'utf8') + readFileSync(join(root, 'src', 'model', 'limits.ts'), 'utf8');
  assert.doesNotMatch(ext, /writeFile|appendFile|renameSync|rmSync|mkdirSync|\.update\(/, 'the extension\'s side only reads; acc writes');
  // A control that can't act stays in view with its reason, and never does nothing silently.
  assert.ok(page.includes("b.setAttribute('aria-disabled', 'true')") && page.includes('if (!why) run();') && page.includes('`${label}: ${why}`'));
});

test('the limits are read only while Settings shows, or a task is held: never on another section\'s render', () => {
  let reads = 0;
  const h = { ...hub(), limits: () => { reads++; return sampleLimits(); } };
  const page = (section: HomeSection) => homeModel({ hub: h, section, boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  for (const section of HOME_SECTIONS.filter((x) => x !== 'settings')) assert.equal(page(section).settings.limits, null, section);
  assert.equal(reads, 0, 'no other section reads them');
  assert.deepEqual(page('settings').settings.limits?.caps.map((c) => c.value), ['3', '6']);
  assert.equal(reads, 1);
  // Arriving at Settings posts the page again, so it reads them; a held task's row reads only this machine's total.
  assert.match(readFileSync(join(root, 'src', 'panels.ts'), 'utf8'), /this\.remember\(m\.section\);\n\s+\/\/[^\n]*\n\s+if \(m\.section === 'settings'\) \{ this\.arrived\(\); this\.post\(\); \}/);
  assert.match(readFileSync(join(root, 'src', 'task-rows.ts'), 'utf8'), /ledger\.tasks\.some\(\(t\) => t\.state === 'todo' && t\.held\) \? hub\.limits\(\)\?\.machine : null/);
});
