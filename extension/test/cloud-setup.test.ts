// Set up cloud builders (T-145): one stepped modal, opening on the first step not done; each step's check and why
// Next is off until a step that must pass has; the trigger id and the token checked as they're typed and again
// before they're kept; the guard committed by Do it and pushed only after a yes naming the branch; Cancel keeping
// only what a step's own button saved; and the same on a Mac and on Windows. The session runs with a stand-in acc
// that answers from a small state, as a project's would; the page is drawn in page-dom.ts's small document.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GuardPlace } from '../../packages/core/src/cloud-guard-place.ts';
import { CLAUDE_SIGN_IN, CLOUD_BUTTONS, CLOUD_SETUP, CLOUD_SETUP_STEPS, CLOUD_STEP_OF, CLOUD_STEPS, GITHUB_APP, ROUTINE_PROMPT } from '../../packages/core/src/onboarding/cloud-steps.ts';
import { ROUTINES_URL } from '../../packages/core/src/cloud.ts';
import { type CloudSetupDeps, CloudSetupSession, CloudTokens, githubCheck } from '../src/cloud-setup.ts';
import { docsLabel, mediaPath } from '../src/logic/setup.ts';
import { canReach, CLOUD_ACTIONS, CLOUD_SETUP_ORDER, type CloudSetupModel, type CloudSetupState, cloudSetupModel, firstNotDone, MUST_PASS, nextWhy, stepDone, stepLook, systemWords, TOKEN_PROBLEM, tokenProblem, TRIGGER_PROBLEM, triggerIdProblem } from '../src/model/cloud-setup.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const ROOT = '/Users/me/code/acme-tool';
const TRIGGER = 'trig_01ABCDEFGHJKLMNOPQRSTUVW';
const TOKEN = 'tok_0123456789abcdefghij';
/** Runs an element's listeners for an event, as the browser does. */
const fire = (e: PageElement, ev: { type: string } & Record<string, unknown>) => { for (const f of e.listeners.get(ev.type) ?? []) f(ev); };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

/** What the stand-in project holds, and what acc says of it. */
interface World {
  repo: string | null;
  on: boolean;
  routine: string | null;
  github: 'pass' | 'unknown' | 'skip';
  /** The keychain's token, on a Mac. */
  keychain: boolean;
  login: boolean;
  local: boolean;
  pushed: boolean;
  checkedOut: string;
}

const done: World = { repo: 'acme/tool', on: true, routine: TRIGGER, github: 'pass', keychain: true, login: true, local: true, pushed: true, checkedOut: 'main' };
const fresh: World = { repo: 'acme/tool', on: false, routine: null, github: 'skip', keychain: false, login: false, local: false, pushed: false, checkedOut: 'main' };

function place(w: World): GuardPlace {
  return { base: 'main', checkedOut: w.checkedOut, local: { ok: w.local, why: w.local ? null : 'main doesn\'t carry the guard' }, pushed: { ok: w.pushed, why: w.pushed ? null : 'not on GitHub' }, ahead: w.local && !w.pushed ? 2 : 0 };
}

/** The session with stand-ins: acc answers from the world, and records each call; ask answers as told. */
function harness(start: World, o: { platform?: NodeJS.Platform; ask?: boolean; secret?: string; confirmed?: boolean } = {}) {
  const w = { ...start };
  const calls: string[][] = [];
  const opened: string[] = [];
  const asked: { message: string; detail: string; go: string }[] = [];
  const copied: string[] = [];
  const terminals: { command: string; ended: () => void }[] = [];
  const secrets = new Map<string, string>(o.secret ? [[`acc.cloud.token:${w.repo}`, o.secret]] : []);
  const keychain: string[] = [];
  const platform = o.platform ?? 'darwin';
  const tokens = new CloudTokens({ get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); } }, platform, async (_root, t) => { keychain.push(t); w.keychain = true; return { code: 0, stdout: '{}', stderr: '' }; });
  let confirmed = o.confirmed ?? false;
  let changes = 0;
  const reply = (code: number, body: unknown) => ({ code, stdout: JSON.stringify(body), stderr: '' });
  const deps: CloudSetupDeps = {
    project: (root) => (root === ROOT ? { root, name: 'Acme Tool', repo: w.repo, on: w.on, routine: w.routine } : null),
    pick: async () => ROOT,
    acc: async (args) => {
      calls.push(args);
      const a = args.join(' ');
      if (a === 'cloud --json') return reply(0, { needs: [{ id: 'token', ok: platform === 'win32' ? !!tokens.env(w.repo)['ACC_CLOUD_TOKEN'] : w.keychain, fix: '' }, { id: 'login', ok: w.login, fix: w.login ? '' : 'Claude Code isn\'t signed in. Run: claude auth login' }], guardPlace: place(w) });
      if (a.startsWith('doctor')) return reply(0, [{ id: 'B15.cloud-github-app', status: w.on ? w.github : 'skip', detail: w.github === 'pass' ? 'The Claude GitHub App is installed on acme/tool.' : 'gh couldn\'t list the apps installed for you.' }]);
      if (a === 'cloud enable --json') { w.on = true; return reply(0, {}); }
      if (a.startsWith('cloud enable --routine')) { w.routine = args[3]!; return reply(0, {}); }
      if (a === 'cloud guard --commit --json') {
        if (w.checkedOut !== 'main') return reply(1, { message: '✗ The cloud clones main, and this folder has feature checked out.' });
        w.local = true;
        return reply(0, {});
      }
      if (a === 'cloud guard --push --json') { w.pushed = true; return reply(0, {}); }
      return reply(1, { message: `no stand-in for ${a}` });
    },
    tokens, platform,
    confirmed: () => confirmed,
    confirm: async () => { confirmed = true; },
    copy: async (t) => { copied.push(t); },
    open: (url) => { opened.push(url); },
    terminal: (command, _cwd, ended) => { terminals.push({ command, ended }); },
    ask: async (message, detail, go) => { asked.push({ message, detail, go }); return o.ask ?? true; },
    reload: async () => {},
    changed: () => { changes++; },
    log: () => {},
  };
  const session = new CloudSetupSession(deps);
  const m = () => session.model()!;
  const send = (msg: Record<string, unknown>) => {
    const full = { ...msg, session: m().id };
    assert.ok(isFromWebview(full), `${JSON.stringify(full)} passes the page's message check`);
    session.receive(full as never);
  };
  const act = async (action: string, value?: string) => { send({ type: 'cloud-setup-act', action, ...(value === undefined ? {} : { value }) }); await settle(); };
  const go = (step: string) => send({ type: 'cloud-setup-step', step });
  return { w, session, m, send, act, go, calls, opened, asked, copied, terminals, secrets, keychain, tokens, changes: () => changes };
}

/** A state at a step, with every check as given: for the model's own tests. */
function state(over: Partial<CloudSetupState> = {}): CloudSetupState {
  const pass = { status: 'pass' as const, detail: '' };
  return {
    id: 's', rev: 0, root: ROOT, project: 'Acme Tool', repo: 'acme/tool', platform: 'darwin', step: 'on', moved: true, on: true, routine: TRIGGER,
    github: pass, githubConfirmed: false, token: pass, signin: pass, guard: pass, place: place(done), busy: null, error: null, copied: false, ...over,
  };
}

test('the steps, in order, each named as the guides name it, and the ones that must pass before Next', () => {
  assert.deepEqual(CLOUD_SETUP_ORDER, ['on', 'github', 'task', 'token', 'signin', 'guard', 'ready']);
  assert.deepEqual(CLOUD_SETUP_ORDER.map((s) => CLOUD_SETUP_STEPS[s]), ['Turn on', 'GitHub access', 'The scheduled task', 'The token', 'Sign in', 'The push guard', 'Ready']);
  assert.deepEqual([...MUST_PASS], ['on', 'task', 'token', 'signin', 'guard']);
  assert.equal(CLOUD_SETUP.title, 'Set up cloud builders');
  assert.equal(CLOUD_ACTIONS.length, 11);
});

test('each step\'s check: done when it passes, and its look blue for done, orange for needs you, never colour alone', () => {
  const fail = { status: 'fail' as const, detail: 'Not yet' };
  const cases: [keyof typeof CLOUD_SETUP_STEPS, Partial<CloudSetupState>][] = [['on', { on: false }], ['github', { github: { status: 'unknown', detail: 'Can\'t see it' } }], ['task', { routine: null }], ['token', { token: fail }], ['signin', { signin: fail }], ['guard', { guard: fail }]];
  for (const [step, off] of cases) {
    assert.equal(stepDone(state(), step), true, `${step} done`);
    assert.equal(stepLook(state(), step).tone, 'blue', `${step} blue`);
    assert.equal(stepDone(state(off), step), false, `${step} not done`);
    const look = stepLook(state(off), step);
    assert.equal(look.tone, 'orange', `${step}: orange`);
    assert.ok(look.icon && look.label, `${step}: an icon and a label`);
  }
  assert.equal(stepDone(state({ github: { status: 'unknown', detail: '' }, githubConfirmed: true }), 'github'), true, 'ticked by hand counts');
  assert.deepEqual(stepLook(state({ token: { status: 'loading', detail: '' } }), 'token'), { label: 'Checking…', icon: 'loading', tone: 'neutral' }.icon ? { label: 'Checking…', icon: 'loading~spin', tone: 'neutral' } : null);
  assert.equal(stepDone(state({ signin: { status: 'fail', detail: '' } }), 'ready'), false, 'Ready needs every step that must pass');
});

test('Next is off with its reason until each step that must pass has; GitHub access never holds it', () => {
  const fail = { status: 'fail' as const, detail: '' };
  const why: [keyof typeof CLOUD_SETUP_STEPS, Partial<CloudSetupState>, RegExp][] = [
    ['on', { on: false }, /^Click Turn on first: nothing is written until you do$/],
    ['on', { on: false, repo: null }, /settings name no GitHub repo/],
    ['task', { routine: null }, /^Paste the trigger id and click Keep the id first$/],
    ['token', { token: fail }, /^Paste the token and click Keep the token first$/],
    ['signin', { signin: fail }, /^Sign in first/],
    ['guard', { guard: fail, place: place({ ...done, local: false, pushed: false }) }, /^Commit the push guard first: Do it does it$/],
    ['guard', { guard: fail, place: place({ ...done, pushed: false }) }, /^Click Push… first/],
    ['token', { token: { status: 'loading', detail: '' } }, /^Checking…$/],
  ];
  for (const [step, off, re] of why) {
    const m = cloudSetupModel(state({ ...off, step }));
    assert.equal(m.next!.can, false, `${step}: Next off`);
    assert.match(m.next!.why!.label, re);
    assert.match(nextWhy(state({ ...off }), step)!, re);
    assert.equal(cloudSetupModel(state({ step })).next!.can, true, `${step}: on once it passes`);
  }
  const github = cloudSetupModel(state({ step: 'github', github: { status: 'unknown', detail: 'Can\'t see it' } }));
  assert.deepEqual(github.next, { can: true, why: null }, 'GitHub access can be connected where this can\'t see it');
  assert.equal(cloudSetupModel(state({ step: 'ready' })).next, null, 'Ready has Done in its place');
});

test('a step can be gone to only once every step before it that must pass has: the step bar says why it\'s off', () => {
  const s = state({ token: { status: 'fail', detail: '' } });
  assert.equal(canReach(s, 'token'), true);
  assert.equal(canReach(s, 'signin'), false);
  const m = cloudSetupModel({ ...s, step: 'token' });
  const signin = m.steps.find((x) => x.id === 'signin')!;
  assert.deepEqual([signin.can, signin.why], [false, 'Finish the steps before it first']);
  assert.equal(m.steps.find((x) => x.id === 'token')!.state, 'current');
  assert.equal(m.steps.find((x) => x.id === 'on')!.state, 'done');
});

test('it opens on the first step not done, and on Ready when every one is, so a person can stop and come back', async () => {
  assert.equal(firstNotDone(state({ on: false })), 'on');
  assert.equal(firstNotDone(state({ routine: null })), 'task');
  assert.equal(firstNotDone(state({ guard: { status: 'fail', detail: '' } })), 'guard');
  assert.equal(firstNotDone(state()), 'ready');
  for (const [w, at] of [[fresh, 'on'], [{ ...done, routine: null }, 'task'], [{ ...done, login: false }, 'signin'], [{ ...done, pushed: false }, 'guard'], [done, 'ready']] as const) {
    const h = harness(w);
    await h.session.open(ROOT);
    assert.equal(h.m().step, at, `${JSON.stringify(w)} opens on ${at}`);
  }
});

test('edge case: before the first read, a check still loading isn\'t taken as a step left undone, and a move made then is kept', async () => {
  const h = harness({ ...done, login: false });
  const opening = h.session.open(ROOT);
  // The modal shows at once, past the checks it hasn't read yet.
  assert.equal(h.m().step, 'ready');
  assert.equal(h.m().view.facts.find((f) => f.label === 'Sign in')!.look.label, 'Checking…');
  await opening;
  assert.equal(h.m().step, 'signin', 'the read moved it to the first step not done');
  h.go('on');
  await h.act('check');
  assert.equal(h.m().step, 'on', 'once moved, a read keeps the step the person is on');
});

test('edge case: a step that can\'t be on show any more, such as after signing out, moves back to the first step not done', async () => {
  const h = harness(done);
  await h.session.open(ROOT);
  h.go('guard');
  h.w.login = false;
  await h.act('check');
  assert.equal(h.m().step, 'signin');
});

test('Turn on writes nothing until its button is clicked; then acc turns it on, and Next goes on', async () => {
  const h = harness(fresh);
  await h.session.open(ROOT);
  assert.equal(h.m().step, 'on');
  assert.deepEqual(h.calls.map((c) => c.join(' ')), ['cloud --json', 'doctor --step B15.cloud-github-app --json'], 'opening only reads');
  assert.equal(h.m().next!.can, false);
  const on = h.m().view.buttons.find((b) => b.action === 'turnOn')!;
  assert.deepEqual([on.label, on.primary, on.disabled], ['Turn on', true, null]);
  assert.match(h.m().view.fold.lines.join(' '), /counts toward your claude\.ai plan's usage, with no separate charge/);
  assert.match(h.m().view.fold.lines.join(' '), /belongs to the claude\.ai account that makes it/);
  await h.act('turnOn');
  assert.ok(h.calls.some((c) => c.join(' ') === 'cloud enable --json'));
  assert.equal(h.m().next!.can, true);
  assert.equal(h.m().view.buttons[0]!.disabled, 'Cloud builders are on already');
});

test('edge case: with no GitHub repo, Turn on is off with why, and every check says it can\'t be read', async () => {
  const h = harness({ ...fresh, repo: null });
  await h.session.open(ROOT);
  assert.equal(h.m().view.buttons[0]!.disabled, 'The project\'s settings name no GitHub repo');
  assert.equal(h.session.state()!.token.status, 'unknown');
  assert.deepEqual(h.calls, [], 'nothing to ask acc');
});

test('GitHub access: Install the app opens its page; where gh can\'t see it, I\'ve done this ticks it, as Setup does', async () => {
  const h = harness({ ...done, github: 'unknown' });
  await h.session.open(ROOT);
  assert.equal(h.m().step, 'github');
  assert.equal(h.m().view.look.tone, 'orange');
  await h.act('install');
  assert.deepEqual(h.opened, [GITHUB_APP]);
  assert.ok(h.m().view.buttons.some((b) => b.label === 'I\'ve done this'));
  assert.match(h.m().view.fold.summary, /\/web-setup/);
  await h.act('confirm');
  assert.equal(stepDone(h.session.state()!, 'github'), true);
  assert.deepEqual(h.m().view.look, { label: 'Ticked by you', icon: 'pass', tone: 'blue' });
  assert.deepEqual(githubCheck({ code: 1, stdout: 'junk', stderr: 'acc is broken' }), { status: 'unknown', detail: 'Couldn\'t check: acc is broken' });
});

test('the scheduled task: Copy the prompt, Open claude.ai, three numbered lines, and a trigger id checked as it\'s typed and again before it\'s kept', async () => {
  const h = harness({ ...done, routine: null });
  await h.session.open(ROOT);
  assert.equal(h.m().step, 'task');
  const v = h.m().view;
  assert.deepEqual(v.buttons.map((b) => b.label), ['Copy the prompt', 'Open claude.ai']);
  assert.deepEqual(v.numbered, ['Paste the prompt as its instructions.', 'Pick acme/tool and a model.', 'Add an API trigger, and copy its id.']);
  assert.equal(v.field!.label, 'Trigger id');
  assert.equal(new RegExp(v.field!.pattern).test(TRIGGER), true);
  await h.act('copy');
  assert.deepEqual(h.copied, [ROUTINE_PROMPT]);
  assert.equal(h.m().view.buttons[0]!.label, 'Copied');
  await h.act('open');
  assert.deepEqual(h.opened, [ROUTINES_URL]);
  // A near miss is refused, said, and nothing is written.
  await h.act('keepId', 'trig_short');
  assert.equal(h.m().view.error, TRIGGER_PROBLEM);
  assert.ok(!h.calls.some((c) => c.includes('--routine')));
  await h.act('keepId', ` ${TRIGGER} `);
  assert.ok(h.calls.some((c) => c.join(' ') === `cloud enable --routine ${TRIGGER} --json`), 'trimmed, then kept by acc');
  assert.equal(h.m().view.look.label, `Kept: ${TRIGGER}`);
  assert.equal(h.m().next!.can, true);
});

test('the trigger id and token checks: what fits, and each near miss', () => {
  assert.equal(triggerIdProblem(TRIGGER), null);
  assert.equal(triggerIdProblem(` ${TRIGGER}\n`), null, 'spaces around it are trimmed');
  for (const v of ['', 'trig_', 'trig_short', 'trg_01ABCDEFGHJK', 'trig_01ABC DEFGHJ']) assert.equal(triggerIdProblem(v), TRIGGER_PROBLEM, JSON.stringify(v));
  assert.equal(tokenProblem(TOKEN), null);
  for (const v of ['', 'tok_short', 'tok 0123456789abcdefghij', 'tok_0123456789abcdefghi!']) assert.equal(tokenProblem(v), TOKEN_PROBLEM, JSON.stringify(v));
});

test('the token on a Mac: pasted hidden, kept in the keychain through acc, never in the model or secret storage', async () => {
  const h = harness({ ...done, keychain: false });
  await h.session.open(ROOT);
  assert.equal(h.m().step, 'token');
  const f = h.m().view.field!;
  assert.deepEqual([f.label, f.secret, f.value], ['Token', true, '']);
  assert.match(h.m().view.fold.summary, /this Mac's keychain/);
  await h.act('keepToken', 'tok_short');
  assert.equal(h.m().view.error, TOKEN_PROBLEM);
  assert.deepEqual(h.keychain, []);
  await h.act('keepToken', TOKEN);
  assert.deepEqual(h.keychain, [TOKEN]);
  assert.equal(h.secrets.size, 0);
  assert.equal(h.m().view.look.tone, 'blue');
  assert.doesNotMatch(JSON.stringify(h.m()), new RegExp(TOKEN), 'the token is never in what the page is drawn from');
  assert.ok(!h.calls.some((c) => c.includes(TOKEN)), 'never on acc\'s command line');
});

test('the token on Windows: kept in VS Code\'s secret storage, checked there, and handed to acc in its environment', async () => {
  const h = harness({ ...done, keychain: false }, { platform: 'win32' });
  await h.session.open(ROOT);
  assert.equal(h.m().step, 'token');
  assert.match(h.m().view.fold.summary, /VS Code on this machine/);
  assert.match(h.m().view.fold.lines[0]!, /hands it over whenever it builds or reviews/);
  await h.act('keepToken', TOKEN);
  assert.equal(h.secrets.get('acc.cloud.token:acme/tool'), TOKEN);
  assert.deepEqual(h.keychain, [], 'no keychain on Windows');
  assert.equal(h.session.state()!.token.detail, 'Kept in VS Code on this machine');
  assert.deepEqual(h.tokens.env('acme/tool'), { ACC_CLOUD_TOKEN: TOKEN });
  assert.equal(h.m().next!.can, true);
});

test('each system\'s own lines: the terminal it names and where it keeps the token', () => {
  assert.deepEqual(systemWords('darwin').terminal, 'Terminal');
  assert.deepEqual(systemWords('win32').terminal, 'PowerShell');
  assert.match(systemWords('darwin').keptLong, /This Mac's keychain/);
  assert.match(systemWords('win32').keptLong, /VS Code's secret storage/);
  const mac = cloudSetupModel(state({ step: 'signin', platform: 'darwin' })).view.fold.lines[0];
  const win = cloudSetupModel(state({ step: 'signin', platform: 'win32' })).view.fold.lines[0];
  assert.equal(mac, 'Do it opens Terminal and runs Claude Code\'s sign-in there, so you see each step.');
  assert.equal(win, 'Do it opens PowerShell and runs Claude Code\'s sign-in there, so you see each step.');
});

test('Sign in: Do it runs the sign-in in a terminal, and the check runs again when it ends', async () => {
  const h = harness({ ...done, login: false });
  await h.session.open(ROOT);
  assert.equal(h.m().step, 'signin');
  assert.equal(h.m().view.look.label, 'Claude Code isn\'t signed in.', 'why, without the command line');
  await h.act('signin');
  assert.deepEqual(h.terminals.map((t) => t.command), [CLAUDE_SIGN_IN]);
  h.w.login = true;
  const before = h.calls.length;
  h.terminals[0]!.ended();
  await settle();
  assert.ok(h.calls.length > before, 'read again');
  assert.equal(h.m().view.look.tone, 'blue');
  assert.equal(h.m().next!.can, true);
});

test('the push guard: Do it commits it; Push… asks first, naming the branch, and a no pushes nothing', async () => {
  const h = harness({ ...done, local: false, pushed: false }, { ask: false });
  await h.session.open(ROOT);
  assert.equal(h.m().step, 'guard');
  assert.deepEqual(h.m().view.buttons.map((b) => b.label), ['Do it', 'Check again']);
  await h.act('commit');
  assert.ok(h.calls.some((c) => c.join(' ') === 'cloud guard --commit --json'));
  assert.equal(h.m().view.look.label, 'Committed here, not on GitHub\'s main yet');
  assert.deepEqual(h.m().view.buttons.map((b) => b.label), ['Push…', 'Check again']);
  await h.act('push');
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0]!.message, 'Push main to GitHub?');
  assert.match(h.asked[0]!.detail, /This sends 2 commits on main, the guard among them, and nothing else\./);
  assert.equal(h.asked[0]!.go, 'Push');
  assert.ok(!h.calls.some((c) => c.join(' ') === 'cloud guard --push --json'), 'a no pushes nothing');
  assert.equal(h.m().next!.can, false);
});

test('the push guard: a yes pushes, and Next goes on to Ready, which says how to send a task', async () => {
  const h = harness({ ...done, pushed: false }, { ask: true });
  await h.session.open(ROOT);
  await h.act('push');
  assert.ok(h.calls.some((c) => c.join(' ') === 'cloud guard --push --json'));
  assert.equal(h.m().next!.can, true);
  h.go('ready');
  assert.equal(h.m().view.line, 'To send a task to the cloud: Build it, then pick Cloud.');
  assert.deepEqual(h.m().view.facts.map((f) => f.look.tone), ['blue', 'blue', 'blue', 'blue', 'blue', 'blue']);
});

test('edge case: another branch checked out turns Do it off with why, and a refusal from acc is said on its step', async () => {
  const h = harness({ ...done, local: false, pushed: false, checkedOut: 'feature' });
  await h.session.open(ROOT);
  assert.equal(h.m().view.buttons[0]!.disabled, 'This folder has feature checked out: switch it to main first');
  // Sent anyway (an old page): acc refuses, and the step says why.
  await h.act('commit');
  assert.match(h.m().view.error!, /The cloud clones main, and this folder has feature checked out/);
});

test('Cancel closes, keeping only what a step\'s own button saved; while a button\'s work runs, Cancel is off and ignored', async () => {
  const h = harness({ ...fresh });
  await h.session.open(ROOT);
  await h.act('turnOn');
  h.go('github');
  h.go('task');
  // A trigger id typed and never kept goes with the modal: only Turn on wrote anything.
  h.send({ type: 'cloud-setup-cancel' });
  assert.equal(h.session.model(), null);
  assert.deepEqual(h.calls.filter((c) => !c.includes('--json') || c[1] === 'enable').map((c) => c.join(' ')), ['cloud enable --json']);
  // Busy: the cancel is ignored until the work finishes.
  const slow = harness({ ...done, keychain: false });
  await slow.session.open(ROOT);
  let release!: () => void;
  (slow.tokens as unknown as { keep: () => Promise<void> }).keep = () => new Promise<void>((r) => { release = r; });
  slow.send({ type: 'cloud-setup-act', action: 'keepToken', value: TOKEN });
  await settle();
  assert.deepEqual(slow.m().cancel, { can: false, why: 'A step\'s work is under way: it finishes, then you can close this' });
  assert.equal(slow.m().view.field!.keep.busy, true);
  slow.send({ type: 'cloud-setup-cancel' });
  assert.ok(slow.session.model(), 'still open');
  release();
  await settle();
  assert.equal(slow.m().cancel.can, true);
});

test('edge case: a message for another modal, or a step that can\'t be gone to yet, changes nothing', async () => {
  const h = harness(fresh);
  await h.session.open(ROOT);
  h.session.receive({ type: 'cloud-setup-cancel', session: 'another' });
  assert.ok(h.session.model());
  h.go('ready');
  assert.equal(h.m().step, 'on', 'Ready needs every step before it');
  assert.equal(isFromWebview({ type: 'cloud-setup-act', session: 'x', action: 'deleteEverything' }), false);
  assert.equal(isFromWebview({ type: 'cloud-setup-step', session: 'x', step: 'nowhere' }), false);
  assert.equal(isFromWebview({ type: 'cloud-setup-act', session: 'x', action: 'keepToken', value: 'x'.repeat(401) }), false);
});

test('edge case: a read answered after the modal closed is dropped, and opening with no project opens nothing', async () => {
  const h = harness(done);
  const opening = h.session.open(ROOT);
  h.session.close();
  await opening;
  assert.equal(h.session.model(), null);
  assert.equal(await h.session.open('/nowhere'), false);
});

// ---------------------------------------------------------------- the guides match the modal

/** Each Setup step's guide page, as generate.ts writes it. */
const guide = (id: string) => readFileSync(join(import.meta.dirname, '..', mediaPath(id)), 'utf8');

test('each cloud step\'s guide names the modal, its step and its buttons as the modal names them, and says scheduled task', () => {
  const buttons: Record<string, string[]> = {
    'B15.cloud-github-app': [CLOUD_BUTTONS.install], 'B15.cloud-routine': [CLOUD_BUTTONS.copy, CLOUD_BUTTONS.open, CLOUD_BUTTONS.keepId],
    'B15.cloud-token': [CLOUD_BUTTONS.token, CLOUD_BUTTONS.keepToken], 'B15.cloud-login': [CLOUD_BUTTONS.doIt], 'B15.cloud-guard': [CLOUD_BUTTONS.doIt, CLOUD_BUTTONS.push],
  };
  let checked = 0;
  for (const s of CLOUD_STEPS) {
    const text = guide(s.id);
    assert.ok(text.includes(`Do it opens ${CLOUD_SETUP.title}; in ${CLOUD_SETUP_STEPS[CLOUD_STEP_OF[s.id]!]}:`), `${s.id} names its step`);
    assert.doesNotMatch(text, /opens [^.;:]*, at /, `${s.id}: claims no step it opens at, as the modal opens on the first not done`);
    for (const b of buttons[s.id]!) { assert.ok(text.includes(b), `${s.id} names ${b}`); checked++; }
    assert.doesNotMatch(text, /Turn cloud builders on"|See the cloud builders' setup|Keep the routine's token/, `${s.id}: no button that's gone`);
    assert.equal(s.fix?.vscode, CLOUD_SETUP.command, `${s.id}: Do it opens the modal`);
  }
  assert.equal(checked, 9);
  assert.match(guide('B15.cloud-routine'), /scheduled task's API trigger \(formerly a routine/);
  // Each button the guides name is one the modal draws.
  const drawn = new Set(CLOUD_SETUP_ORDER.flatMap((step) => { const v = cloudSetupModel(state({ step, place: place({ ...done, pushed: false }), guard: { status: 'fail', detail: '' } })).view; return [...v.buttons.map((b) => b.label), ...(v.field ? [v.field.label, v.field.keep.label] : [])]; }));
  for (const b of Object.values(buttons).flat()) assert.ok(drawn.has(b), `the modal draws ${b}`);
});

test('every link in a guide is labelled for what it opens: Claude Code\'s docs are never called Salesforce docs', () => {
  assert.equal(docsLabel('https://code.claude.com/docs/en/routines'), 'Claude Code docs');
  assert.equal(docsLabel('https://developer.salesforce.com/docs/x'), 'Salesforce docs');
  assert.equal(docsLabel('https://help.salesforce.com/s/x'), 'Salesforce docs');
  assert.equal(docsLabel('https://docs.github.com/x'), 'GitHub docs');
  assert.equal(docsLabel('https://example.org/x'), 'Docs at example.org');
  assert.equal(docsLabel('not a url'), 'The docs', 'edge case: a link that isn\'t one');
  let links = 0;
  for (const s of CLOUD_STEPS) {
    for (const [, label, url] of guide(s.id).matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) { assert.equal(label, docsLabel(url!), `${s.id}: ${url}`); links++; }
  }
  assert.equal(links, 3);
});

// ---------------------------------------------------------------- the page

const page = pageDom();
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => undefined, setState: () => {} });
const { renderCloudSetup, fieldOk, cloudTyped } = await import('../webview/cloud-setup.ts');

function find(nodes: Node[], pred: (e: PageElement) => boolean): PageElement[] {
  const out: PageElement[] = [];
  const walk = (n: PageElement) => { if (pred(n)) out.push(n); for (const c of n.children ?? []) walk(c as PageElement); };
  for (const n of nodes) walk(n as unknown as PageElement);
  return out;
}

test('the page: the trigger id is checked as it\'s typed, its button off with why until it fits, and Enter keeps it', () => {
  const m: CloudSetupModel = cloudSetupModel(state({ step: 'task', routine: null }));
  cloudTyped.clear();
  const nodes = renderCloudSetup(m);
  const input = find(nodes, (e) => e.tagName === 'INPUT')[0]!;
  const keep = find(nodes, (e) => e.tagName === 'BUTTON' && (e.textContent ?? '').includes('Keep the id'))[0]!;
  assert.equal(keep.disabled, true);
  assert.equal(keep.title, 'Paste the trigger id first');
  (input as unknown as { value: string }).value = 'trig_short';
  fire(input, { type: 'input' });
  assert.equal(keep.disabled, true);
  assert.equal(keep.title, TRIGGER_PROBLEM);
  assert.match(find(nodes, (e) => (e.className ?? '').includes('cloud-field-check'))[0]!.textContent ?? '', /A trigger id looks like trig_01ABC…/);
  (input as unknown as { value: string }).value = TRIGGER;
  fire(input, { type: 'input' });
  assert.equal(keep.disabled, false);
  page.sent.length = 0;
  fire(input, { type: 'keydown', key: 'Enter', preventDefault: () => undefined });
  assert.deepEqual(page.sent, [{ type: 'cloud-setup-act', action: 'keepId', value: TRIGGER, session: 's' }]);
  assert.equal(fieldOk({ pattern: m.view.field!.pattern }, ` ${TRIGGER} `), true);
});

test('the page: the token is typed hidden, sent once, and forgotten as it\'s sent', () => {
  const m = cloudSetupModel(state({ step: 'token', token: { status: 'fail', detail: 'No token kept yet' } }));
  cloudTyped.clear();
  const nodes = renderCloudSetup(m);
  const input = find(nodes, (e) => e.tagName === 'INPUT')[0]!;
  assert.equal(input.type, 'password');
  (input as unknown as { value: string }).value = TOKEN;
  fire(input, { type: 'input' });
  page.sent.length = 0;
  find(nodes, (e) => e.tagName === 'BUTTON' && (e.textContent ?? '').includes('Keep the token'))[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'cloud-setup-act', action: 'keepToken', value: TOKEN, session: 's' }]);
  assert.equal(cloudTyped.size, 0, 'forgotten once sent');
});

test('the page: each step draws its one line, its check with an icon and a label, and its fold, closed', () => {
  let drawn = 0;
  for (const step of CLOUD_SETUP_ORDER) {
    const nodes = renderCloudSetup(cloudSetupModel(state({ step })));
    const text = nodes.map((n) => n.textContent).join(' ');
    assert.ok(text.includes(cloudSetupModel(state({ step })).view.line), `${step}: its line`);
    const details = find(nodes, (e) => e.tagName === 'DETAILS');
    assert.equal(details.length, 1, `${step}: one fold`);
    assert.equal((details[0] as unknown as { open: boolean }).open, false, `${step}: folded`);
    assert.ok(find(nodes, (e) => (e.className ?? '').includes('cloud-check'))[0]!.children.length, `${step}: its check`);
    drawn++;
  }
  assert.equal(drawn, 7);
});
