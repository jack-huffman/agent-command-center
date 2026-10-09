// Agents: who each session is, where it runs, which model it uses, and what agents bill. How agents run
// is in Settings (GH-110), whose tests are settings.test.ts.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type RepoAgents, type SessionTie, tieSession } from '../../packages/core/src/ledger.ts';
import { gitIn, makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { agentLook, commonDirOf, dispatchModelArgs, dispatchModelItems, finishedSession, MODEL_CHOICES, repoRoot, sessionLedger, stopFinishedPlan } from '../src/logic/agents.ts';
import { sizeLine } from '../src/logic/tasks.ts';
import { type AgentSession, nodeArg, tildePath } from '../src/logic/shared.ts';
import { agentsModel, sessionFolders } from '../src/model/agents.ts';
import { howAgentsRun, settingsKey } from '../src/model/settings.ts';
import { tasksModel } from '../src/model/tasks.ts';
import { homeModel } from '../src/model/home.ts';
import type { HubLike } from '../src/model/shared.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { needsYouCount } from '../src/model/overview.ts';
import { root, manifest, pageSource, row, hub, menuFor } from './support.ts';

test('a task\'s agent is found by its session, else by the name its run recorded, never by a name worked out again, and is called that everywhere (D-087)', async () => {
  const { displayName, ownsSession, sessionFor } = await import('../src/logic/agents.ts');
  const { taskNotices } = await import('../src/logic/notices.ts');
  const { sessionName } = await import('../../packages/core/src/names.ts');
  type Row = import('../src/logic/shared.ts').TaskRow;
  const name = sessionName({ project: 'Acme Service', key: 'GH-44', title: 'Case escalation rules', role: 'builder', n: 2 });
  assert.equal(name, 'Acme Service · GH-44 Case escalation rules · builder 2');
  const row = (more: Partial<Row> = {}): Row => ({ id: 'GH-44', title: 'Case escalation rules', state: 'running', display: 'running', environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const mine = { cwd: '/r', kind: 'background', startedAt: 2, id: 'bg44', sessionId: 'sess-44', name, pid: 7 };
  const legacy = { cwd: '/r', kind: 'background', startedAt: 1, id: 'bg-old', sessionId: 'sess-old', name: 'GH-44', pid: 8 };
  const all = [legacy, mine];
  assert.equal(sessionFor(row({ run: { bgId: 'bg44' } }), all), mine, 'by its background id');
  assert.equal(sessionFor(row({ run: { sessionId: 'sess-44' } }), all), mine, 'by its session id');
  assert.equal(sessionFor(row({ run: { bgId: 'gone', sessionId: 'gone-too' } }), all), undefined, 'ids recorded but gone: never another session by name');
  // Its ids weren't recorded, and its title changed since: the name its run recorded still finds it.
  const retitled = row({ title: 'Escalation rules, rewritten', run: { worktree: '/w44', name } });
  assert.equal(sessionFor(retitled, all), mine);
  const fresh = { ...mine, id: 'bg-new', sessionId: 'sess-new', name: sessionName({ project: 'Acme Service', key: 'GH-44', title: retitled.title, role: 'builder', n: 2 }) };
  assert.equal(sessionFor(retitled, [legacy, fresh]), undefined, 'not a name worked out from the new title, nor the old-style one');
  // A run from before names: its session named the old way is still found.
  assert.equal(sessionFor(row({ run: { worktree: '/w44' } }), all), legacy);

  // Called by the name acc gave it, though Claude Code lists a resumed session under one of its own.
  const resumed = { cwd: '/w44', kind: 'interactive', startedAt: 3, sessionId: 'sess-44', name: 'probe-5e', pid: 9 };
  const named = row({ run: { bgId: 'bg44', sessionId: 'sess-44', name } });
  assert.equal(displayName(resumed, named), name);
  assert.equal(displayName(mine, named), name);
  assert.equal(displayName(legacy, row({ run: { bgId: 'bg-old' } })), 'GH-44', 'a run from before names: Claude Code\'s');
  assert.equal(displayName(undefined, named), name, 'no session: its task\'s builder');
  assert.equal(displayName(undefined, row()), 'GH-44');
  assert.equal(displayName({ cwd: '/x', kind: 'interactive', startedAt: 1, sessionId: '0e023162-5807-497b' }), '0e023162');
  // A review or an analysis under way goes by its own name, not the builder's.
  const reviewer = { cwd: '/w44', kind: 'interactive', startedAt: 4, sessionId: 'sess-r', name: 'Acme Service · GH-44 Case escalation rules · review', pid: 10 };
  const reviewing = row({ state: 'review', run: { bgId: 'bg44', name }, reviewing: { sessionId: 'sess-r', name: reviewer.name } });
  assert.ok(ownsSession(reviewing, reviewer));
  assert.equal(displayName({ ...reviewer, name: undefined }, reviewing), reviewer.name);
  assert.equal(displayName(reviewer, row({ run: { bgId: 'bg44', name } })), reviewer.name, 'not its task\'s builder: its own name');
  const analyst = { ...reviewer, sessionId: 'sess-a', name: undefined };
  assert.equal(displayName(analyst, row({ state: 'todo', analyzing: { sessionId: 'sess-a', name: 'Acme Service · GH-44 Case escalation rules · analysis' } })), 'Acme Service · GH-44 Case escalation rules · analysis');

  // A notice about the agent names it in place of "GH-44's agent"; a run from before names keeps those words.
  const said = 'API Error: Your computer went to sleep mid-response.';
  assert.equal(taskNotices([named], [{ ...named, display: 'needs-you', stopped: { said } }])[0]!.text, `${name} stopped: ${said}`);
  assert.equal(taskNotices([named], [{ ...named, display: 'needs-you', stopped: { said: null } }])[0]!.text, `${name} stopped before acc done or acc block.`);
  assert.equal(taskNotices([named], [{ ...named, display: 'needs-you' }])[0]!.text, `${name} is waiting for you in its own prompt.`);
  assert.equal(taskNotices([row()], [row({ display: 'needs-you' })])[0]!.text, 'GH-44\'s agent is waiting for you in its own prompt.');
  assert.equal(taskNotices([named], [{ ...named, state: 'review', display: 'review' }])[0]!.text, 'GH-44 is ready for review: Case escalation rules', 'news about the task names the task');
});

test('Dispatch with… offers the model the builder runs with anyway first, saying where it\'s set, then the rest once, then another (D-086)', () => {
  const builder = (model: string, from: string) => ({ model, from: { model: from } });
  const labels = (items: { label: string; description: string }[]) => items.map((i) => `${i.label} · ${i.description}`);
  assert.deepEqual(MODEL_CHOICES.map((m) => m.name), ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'], 'pinned names, one list for Dispatch with… and Change…');
  assert.deepEqual(labels(dispatchModelItems({}, builder('claude-opus-5-5', 'acc'))), [
    'claude-opus-5-5 · acc\'s default', 'claude-fable-5-1 · Claude Fable 5.1', 'claude-sonnet-5-5 · Claude Sonnet 5.5: lighter on your plan',
    'claude-haiku-5-5 · Claude Haiku 5.5: the lightest', 'Another model… · an alias or a full model name, as claude --model takes it',
  ]);
  const clone = dispatchModelItems({}, builder('claude-sonnet-5-5', 'clone'));
  assert.deepEqual(clone.map((i) => i.value), ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-5-5', null], 'never repeated, and Another model… last');
  assert.equal(clone[0]!.description, 'this clone');
  assert.equal(dispatchModelItems({}, builder('opus', 'project'))[0]!.description, 'project default');
  assert.equal(dispatchModelItems({}, builder('opus', 'project')).length, 6, 'an alias isn\'t one of the pinned names, so all four follow it');
  // A model picked for the task earlier is what a re-dispatch would run with, so it comes first.
  const kept = dispatchModelItems({ run: { model: 'claude-haiku-4-5-20251001', modelPicked: true } }, builder('claude-opus-5-5', 'acc'));
  assert.deepEqual([kept[0]!.value, kept[0]!.description], ['claude-haiku-4-5-20251001', 'picked for this task']);
  assert.equal(dispatchModelItems({ run: { model: 'claude-haiku-4-5-20251001' } }, builder('claude-opus-5-5', 'acc'))[0]!.value, 'claude-opus-5-5', 'one only started with it follows the settings');
});

test('Dispatch with… keeps a model for the task only when it\'s one the settings wouldn\'t give it (D-086)', () => {
  const b = { model: 'claude-opus-5-5' };
  assert.deepEqual(dispatchModelArgs({}, b, 'claude-opus-5-5'), [], 'the model it runs with anyway: it keeps following the settings');
  assert.deepEqual(dispatchModelArgs({ run: { model: 'claude-opus-5-5' } }, b, 'claude-opus-5-5'), [], 'started with it, but never picked');
  assert.deepEqual(dispatchModelArgs({}, b, 'claude-sonnet-5-5'), ['--model', 'claude-sonnet-5-5']);
  assert.deepEqual(dispatchModelArgs({ run: { model: 'claude-haiku-4-5-20251001', modelPicked: true } }, b, 'claude-haiku-4-5-20251001'), ['--model', 'claude-haiku-4-5-20251001'], 'a pick made before is kept');
  assert.deepEqual(dispatchModelArgs({ run: { model: 'claude-haiku-4-5-20251001', modelPicked: true } }, b, 'claude-opus-5-5'), ['--model', 'claude-opus-5-5'], 'picking the settings\' model over an earlier pick is a pick too');
});

test('the analysis\'s size is shown beside the models, in words, and chooses none of them (D-086)', () => {
  const analysis = (size?: 'S' | 'M' | 'L' | 'XL') => ({ analysis: { verdict: 'ready' as const, at: 't', open: [], split: [], ...(size ? { size } : {}) } });
  assert.equal(sizeLine(analysis('L')), 'Its analysis sizes it L: a few days.');
  assert.equal(sizeLine(analysis('S')), 'Its analysis sizes it S: an hour or two.');
  assert.equal(sizeLine({}), 'Not analyzed: no size to go on.');
  assert.equal(sizeLine(analysis()), 'Its analysis gave no size.');
  // The items don't depend on the analysis at all: their input has no room for it.
  const b = { model: 'claude-opus-5-5', from: { model: 'acc' } };
  assert.deepEqual(dispatchModelItems({ ...analysis('XL'), run: null }, b), dispatchModelItems({ run: null }, b));
});

test('a session\'s repo is the nearest folder up holding .git, short of the home folder and / (GH-83)', () => {
  const holds = (...dirs: string[]) => (d: string) => dirs.includes(d);
  assert.equal(repoRoot('/Users/me/clients/Acme Service/force-app/main', '/Users/me', holds('/Users/me/clients/Acme Service')), '/Users/me/clients/Acme Service');
  assert.equal(repoRoot('/Users/me/clients/Acme Service', '/Users/me', holds('/Users/me/clients/Acme Service')), '/Users/me/clients/Acme Service', 'the folder itself first');
  assert.equal(repoRoot('/Users/me/a/b/c', '/Users/me', holds('/Users/me/a', '/Users/me/a/b')), '/Users/me/a/b', 'the nearest one');
  assert.equal(repoRoot('/Users/me/Downloads/scratch', '/Users/me', holds()), null);
  assert.equal(repoRoot('/Users/me/Downloads/scratch', '/Users/me', holds('/Users/me')), null, 'a repo at ~ (dotfiles) is nobody\'s repo');
  assert.equal(repoRoot('/Users/me', '/Users/me', holds('/Users/me')), null);
  assert.equal(repoRoot('/opt/tools/x', '/Users/me', holds('/', '/opt/tools')), '/opt/tools', 'outside home it walks up to, not into, /');
  assert.equal(repoRoot('/opt/x', '/Users/me', holds('/')), null);
});

test('a path shows the home folder as ~, and a path outside it as it is (GH-83)', () => {
  assert.equal(tildePath('/Users/me/clients/Acme Service', '/Users/me'), '~/clients/Acme Service');
  assert.equal(tildePath('/Users/me', '/Users/me'), '~');
  assert.equal(tildePath('/Users/meg/x', '/Users/me'), '/Users/meg/x', 'a folder whose name starts the same isn\'t home');
  assert.equal(tildePath('/opt/x', '/Users/me'), '/opt/x');
  assert.equal(tildePath('/Users/me/x', undefined), '/Users/me/x', 'with no home known, the path as it is');
});

const FINISHED = { label: 'Finished', icon: 'check', tone: 'neutral', needsYou: false };

const bgSession = (x: Partial<AgentSession> = {}): AgentSession => ({ cwd: '/r', kind: 'background', startedAt: 0, id: 'bg', ...x });

test('a finished session reads as Finished, with a check and a muted label, unless it works or asks; untied, as Claude Code says (D-095)', () => {
  const done: SessionTie = { task: 'GH-1', role: 'builder', finished: true, why: 'done' };
  const atWork: SessionTie = { task: 'GH-2', role: 'builder', finished: false, why: null };
  assert.deepEqual(agentLook(bgSession({ status: 'waiting', pid: 1 }), null, done), FINISHED, 'waiting at its prompt');
  assert.deepEqual(agentLook(bgSession({ state: 'blocked' }), null, done), FINISHED, 'listed blocked, its process gone');
  assert.deepEqual(agentLook(bgSession({ state: 'blocked', waitingFor: 'permission prompt', pid: 1 }), null, { ...done, why: 'later-run' }), FINISHED);
  assert.deepEqual(agentLook(bgSession({ kind: 'interactive', id: undefined, status: 'idle' }), null, { ...done, role: 'review', why: 'reviewed' }), FINISHED, 'an exited reviewer');
  assert.equal(agentLook(bgSession({ state: 'working', status: 'busy', pid: 1 }), null, done).label, 'Working', 'someone carried it on');
  assert.deepEqual(agentLook(bgSession({ state: 'blocked', pid: 1 }), 'has a question', done), { label: 'Needs you: has a question', icon: 'bell', tone: 'orange', needsYou: true });
  // Tied to work under way, or not tied at all: exactly what Claude Code's state said before.
  for (const s of [bgSession({ state: 'blocked', waitingFor: 'permission prompt' }), bgSession({ status: 'waiting', pid: 1 }), bgSession({ state: 'done' }), bgSession({ state: 'failed' }), bgSession({ kind: 'interactive', status: 'idle', pid: 3 })]) {
    assert.deepEqual(agentLook(s, null, atWork), agentLook(s));
    assert.deepEqual(agentLook(s, null, null), agentLook(s));
  }
  assert.deepEqual(agentLook(bgSession({ status: 'waiting', pid: 1 }), null, atWork), { label: 'Needs you', icon: 'bell', tone: 'orange', needsYou: true });
  assert.deepEqual([finishedSession(bgSession({ state: 'blocked' }), done), finishedSession(bgSession({ state: 'blocked' }), done, 'has a question'), finishedSession(bgSession({ state: 'blocked' }), atWork)], [true, false, false]);
});

test('Stop finished sessions takes background sessions whose work is over, and never one at work, untied, interactive, busy, asking or ended (D-095)', () => {
  const repo: RepoAgents = {
    tasks: [
      { id: 'GH-1', state: 'done', run: { bgId: 'bg-1', sessionId: 's-1' } },
      { id: 'GH-2', state: 'running', run: { bgId: 'bg-2b', sessionId: 's-2b', n: 2 } },
      { id: 'GH-3', state: 'review', run: { bgId: 'bg-3', sessionId: 's-3' } },
      { id: 'GH-4', state: 'rework', run: { bgId: 'bg-4', sessionId: 's-4' } },
      ...['5', '6', '7', '8'].map((n) => ({ id: `GH-${n}`, state: 'done' as const, run: { bgId: `bg-${n}`, sessionId: `s-${n}` } })),
    ],
    runs: [{ task: 'GH-2', bgId: 'bg-2a', sessionId: 's-2a', n: 1 }, { task: 'GH-2', bgId: 'bg-2b', sessionId: 's-2b', n: 2 }],
    verdicts: [{ task: 'GH-3', sessionId: 'review-3' }],
    analyses: [],
    live: [{ task: 'GH-4', sessionId: 'review-4', role: 'review' }],
  };
  const bg = (n: string, x: Partial<AgentSession> = {}): AgentSession => bgSession({ id: `bg-${n}`, sessionId: `s-${n}`, state: 'blocked', status: 'waiting', pid: 1, ...x });
  const sessions: AgentSession[] = [
    bg('1'), // its task is done
    bg('2a'), // an earlier run, while its task runs again
    bg('2b'), bg('3'), bg('4'), // the current builders of tasks running, in review and in rework
    bg('5', { pid: undefined, status: undefined }), // its task is done, its process gone, still listed blocked: nothing to stop
    bg('6', { state: 'working', status: 'busy' }), // carried on by someone
    bg('7'), // a question waiting in the Command Center
    bg('8', { pid: undefined, status: undefined, state: 'done' }), // ended already
    bg('x'), // untied
    { cwd: '/r', kind: 'interactive', startedAt: 0, sessionId: 'review-3', status: 'idle', pid: 2 }, // a recorded review's, interactive
    { cwd: '/r', kind: 'interactive', startedAt: 0, sessionId: 'review-4', status: 'busy', pid: 3 }, // a review under way
  ];
  const plan = stopFinishedPlan(sessions, (s) => tieSession(s, repo), (s) => (s.id === 'bg-7' ? 'has a question' : null));
  assert.deepEqual(plan.map((s) => s.id), ['bg-1', 'bg-2a'], 'not bg-5: with no process, claude stop can\'t confirm stopping it');
  assert.deepEqual(stopFinishedPlan(sessions, () => null, () => null), [], 'nothing acc can\'t tie');
});

test('a repo\'s shared git folder is .git, or where a linked worktree\'s .git file points, read without git', () => {
  const files: Record<string, string> = {
    '/a/b/.git': 'gitdir: ../main/.git/worktrees/b\n',
    '/a/main/.git/worktrees/b/commondir': '../..\n',
    '/c/.git': 'gitdir: /x/.git/worktrees/c',
    '/x/.git/worktrees/c/commondir': '/x/.git',
    '/sub/.git': 'gitdir: ../super/.git/modules/sub\n',
    '/junk/.git': 'not a pointer',
  };
  const fake = { isDir: (p: string) => p === '/m/.git', read: (f: string) => files[f] ?? null };
  assert.equal(commonDirOf('/m', fake), '/m/.git');
  assert.equal(commonDirOf('/a/b', fake), '/a/main/.git', 'relative');
  assert.equal(commonDirOf('/c', fake), '/x/.git', 'absolute');
  assert.equal(commonDirOf('/sub', fake), '/super/.git/modules/sub', 'no commondir: its own folder');
  assert.equal(commonDirOf('/junk', fake), null);
  assert.equal(commonDirOf('/none', fake), null);
  // As git really writes a linked worktree's files.
  const repo = makeRepo();
  const wt = join(tempDir(), 'linked');
  gitIn(repo, 'worktree', 'add', '-q', wt);
  const disk = {
    isDir: (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } },
    read: (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return null; } },
  };
  assert.equal(realpathSync(commonDirOf(wt, disk)!), realpathSync(gitIn(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim()));
  assert.equal(commonDirOf(repo, disk), join(repo, '.git'));
});

test('a session\'s ledger is its project\'s here; elsewhere, its repo\'s, a builder\'s worktree\'s by its path (D-095)', () => {
  const o = {
    project: (p: string) => (p === '/here' || p.startsWith('/here/') ? '/here/.git/acc/ledger.json' : null),
    repoFor: (p: string) => repoRoot(p, '/Users/me', (d) => ['/Users/me/clients/Acme', '/Users/me/linked'].includes(d)),
    commonDir: (r: string) => (r === '/Users/me/linked' ? '/Users/me/clients/Acme/.git' : r === '/Users/me/clients/Acme' ? `${r}/.git` : null),
  };
  const acme = '/Users/me/clients/Acme/.git/acc/ledger.json';
  assert.equal(sessionLedger('/here/.claude/worktrees/X', o), '/here/.git/acc/ledger.json');
  for (const cwd of ['/Users/me/clients/Acme', '/Users/me/clients/Acme/', '/Users/me/clients/Acme/force-app/main', '/Users/me/clients/Acme/.claude/worktrees/ACME-38', '/Users/me/clients/Acme/.claude/worktrees/ACME-38/src', '/Users/me/linked']) {
    assert.equal(sessionLedger(cwd, o), acme, cwd);
  }
  assert.equal(sessionLedger('/Users/me/Downloads/scratch', o), null, 'in no repo');
  assert.equal(sessionLedger('/Users/me/other/.claude/worktrees/Y', o), null, 'a worktree path whose repo has no git folder');
});

test('agents: this project first, a session in no repo under Other folders, background sessions can be stopped', () => {
  const m = agentsModel(hub());
  assert.deepEqual(m.repos.map((r) => [r.label, r.window, r.sessions]), [['Acme', 'this', 1], ['Other folders', null, 1]]);
  // Tied to no task, it goes by its own name, and says where it is.
  const bg = m.repos[0]!.tasks[0]!.agents[0]!;
  assert.deepEqual([m.repos[0]!.tasks[0]!.key, bg.label, bg.look.label, bg.where, bg.background], [null, 'av-2', 'Needs you: permission prompt', 'worktree AV-2', true]);
  assert.equal(m.repos[1]!.tasks[0]!.agents[0]!.background, false, 'interactive sessions are managed where they run');
});

test('an agent is called by the name acc gave it on the Agents tab, the Overview and its page, though Claude Code lists another (D-087)', async () => {
  const { agentModel } = await import('../src/model/agent-page.ts');
  const name = 'Acme · AV-1 Login page for the partner portal · builder 2';
  const review = 'Acme · AV-3 Lead routing · review';
  const h = hub();
  // A resumed builder Claude Code lists under a name of its own, waiting on you; a reviewer it lists without one.
  h.agents = [
    { cwd: '/r.worktrees/AV-1', kind: 'interactive', startedAt: 3, sessionId: 'sess-1', name: 'r-worktrees-5e', status: 'waiting', pid: 11 },
    { cwd: '/r.worktrees/AV-3', kind: 'interactive', startedAt: 2, sessionId: 'sess-r', status: 'busy', pid: 12 },
    { cwd: '/r', kind: 'background', startedAt: 1, id: 'bg9', sessionId: 'sess-9', name: 'AV-9', state: 'working', pid: 13 },
  ];
  const rows = h.taskRows('/r');
  h.taskRows = () => rows.map((r) => (r.id === 'AV-1' ? { ...r, title: 'Retitled since', run: { bgId: 'bg1', sessionId: 'sess-1', name } } : r.id === 'AV-3' ? { ...r, state: 'review', reviewing: { sessionId: 'sess-r', name: review } } : r));
  const lines = agentsModel(h).repos[0]!.tasks.flatMap((t) => t.agents);
  assert.deepEqual(lines.map((a) => a.name), [name, review, 'AV-9'], 'by its recorded name; one from before names by Claude Code\'s');
  // Its line, under its task, says only its role (GH-119): builder 2 by the name acc gave it, though its run recorded no count.
  assert.deepEqual(lines.map((a) => a.label), ['builder 2', 'review', 'AV-9']);
  const page = agentModel({ hub: h, key: 'sess-1', seen: null, entries: [], readable: false, lastAt: null });
  assert.equal(page.name, name);
  assert.equal(page.task?.id, 'AV-1', 'its task, found by its session');
  assert.equal(agentModel({ hub: h, key: 'sess-r', seen: null, entries: [], readable: false, lastAt: null }).name, review);
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  assert.ok(m.overview.attention.some((a) => a.title === name), 'the Overview names a waiting agent the same way');
  // A card shows its builder's name when its agent line is hovered.
  const card = tasksModel(h).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === 'AV-1')!;
  assert.equal(card.agentName, name);
});

/** The test hub with these sessions, a home folder, and these folders holding .git. */
function sessionsAt(cwds: string[], repos: string[] = []): HubLike {
  const agents: AgentSession[] = cwds.map((cwd, i) => ({ cwd, kind: 'interactive', startedAt: 100 - i, sessionId: `s${i}`, name: `s${i}`, status: 'idle', pid: i + 1 }));
  return { ...hub(), home: '/Users/me', agents, repoFor: (p) => repoRoot(p, '/Users/me', (d) => repos.includes(d)) };
}

const labels = (h: HubLike) => [...sessionFolders(h).values()].map((f) => f.label);

test('a session elsewhere reads as its repo, a worktree of it, a folder inside it, or its folder\'s own name (GH-83)', () => {
  const acme = '/Users/me/clients/Acme Service';
  // The worktree has its own .git, a file: the path says it's Acme Service's, and that wins.
  const h = sessionsAt([acme, `${acme}/.claude/worktrees/ACME-12`, `${acme}/.claude/worktrees/ACME-12/force-app`, `${acme}/force-app/main`, '/Users/me/Downloads/scratch', '/Users/me', '/opt/tools'], [acme, `${acme}/.claude/worktrees/ACME-12`]);
  assert.deepEqual(labels(h), ['Acme Service', 'Acme Service › worktree ACME-12', 'Acme Service › worktree ACME-12 › force-app', 'Acme Service › force-app/main', 'scratch', '~', 'tools']);
  const folders = sessionFolders(h);
  assert.deepEqual([...folders.values()].map((f) => f.full), ['~/clients/Acme Service', '~/clients/Acme Service/.claude/worktrees/ACME-12', '~/clients/Acme Service/.claude/worktrees/ACME-12/force-app', '~/clients/Acme Service/force-app/main', '~/Downloads/scratch', '~', '/opt/tools']);
  assert.ok([...folders.values()].every((f) => f.inProject === null), 'none is in a project open here');
  // The Agents page groups them by that repo (GH-119): untied, each line says where in it, with the full path for the toggle and the hover.
  const m = agentsModel(h);
  assert.deepEqual(m.repos.map((r) => [r.label, r.sessions]), [['Acme', 0], ['Acme Service', 4], ['Other folders', 3]]);
  const lines = m.repos.flatMap((r) => r.tasks.flatMap((t) => t.agents));
  assert.deepEqual(lines.map((a) => [a.where, a.path]), [...folders.values()].map((f) => [f.inRepo, f.full]));
  assert.deepEqual(lines.map((a) => a.where), ['main checkout', 'worktree ACME-12', 'worktree ACME-12 › force-app', 'force-app/main', 'scratch', '~', 'tools']);
  assert.equal(sessionFolders(h, ['/x']).get('/x')!.label, 'x', 'a folder no session has, such as an ended session\'s');
});

test('a session in a project open here reads as where it is in it, without the project its group names (GH-83)', () => {
  const h = sessionsAt(['/r', '/r/.claude/worktrees/ACME-12', '/r/force-app/main', '/r.worktrees/AV-2', '/r.worktrees/AV-2/src']);
  const folders = [...sessionFolders(h).values()];
  assert.deepEqual(folders.map((f) => f.inProject), ['main checkout', 'worktree ACME-12', 'force-app/main', 'worktree AV-2', 'worktree AV-2 › src']);
  assert.deepEqual(folders.map((f) => f.label), ['Acme › main checkout', 'Acme › worktree ACME-12', 'Acme › force-app/main', 'Acme › worktree AV-2', 'Acme › worktree AV-2 › src'], 'elsewhere, such as an agent\'s page, it leads with the project');
  assert.deepEqual(agentsModel(h).repos[0]!.tasks[0]!.agents.map((a) => a.where), folders.map((f) => f.inProject));
});

test('two folders of one name each add their parent folders until they differ, and one folder always reads one way (GH-83)', () => {
  const clients = '/Users/me/clients/Acme Service';
  const personal = '/Users/me/personal/Acme Service';
  // Every session in a repo of that name says which it is, its worktrees too.
  assert.deepEqual(labels(sessionsAt([clients, personal, `${clients}/.claude/worktrees/ACME-40`], [clients, personal])), ['clients/Acme Service', 'personal/Acme Service', 'clients/Acme Service › worktree ACME-40']);
  assert.deepEqual(labels(sessionsAt(['/Users/me/a/x/Acme', '/Users/me/b/x/Acme'])), ['a/x/Acme', 'b/x/Acme']);
  assert.deepEqual(labels(sessionsAt(['/Users/me/x/Acme', '/opt/x/Acme'])), ['~/x/Acme', 'opt/x/Acme']);
  // Two sessions in one folder, however its path is written, share one name, and add no parent for it.
  const same = sessionsAt(['/Users/me/Downloads/scratch', '/Users/me/Downloads/scratch/', '/Users/me/Downloads/scratch']);
  assert.deepEqual(agentsModel(same).repos.find((r) => r.key === null)!.tasks[0]!.agents.map((a) => a.where), ['scratch', 'scratch', 'scratch']);
});

test('the Where column shows folders unless the window chose full paths, and the page can only ask for one or the other (GH-83)', () => {
  const input = { hub: hub(), section: 'agents' as const, boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set<string>() } };
  assert.equal(homeModel(input).agents.whereView, 'folder');
  assert.equal(homeModel({ ...input, whereView: 'path' }).agents.whereView, 'path');
  assert.equal(agentsModel(hub()).whereView, 'folder');
  assert.ok(isFromWebview({ type: 'agents-where', view: 'folder' }));
  assert.ok(isFromWebview({ type: 'agents-where', view: 'path' }));
  assert.ok(!isFromWebview({ type: 'agents-where', view: 'tree' }));
  assert.ok(!isFromWebview({ type: 'agents-where' }));
});

test('agent rows hide their actions behind one menu: Watch first, and background sessions also attach and stop', () => {
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'agent', agentBackground: true }), ['acc.agent.watch', 'acc.agent.openInClaude', 'acc.agent.attach', 'acc.agent.openFolder', 'acc.agent.stop'], 'Stop sits alone at the bottom');
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'agent', agentBackground: false }), ['acc.agent.watch', 'acc.agent.openInClaude', 'acc.agent.openFolder']);
});

test('a finished session reads as Finished and never needs you: not on its row, the badges, the Overview or its page; an untied one still does (D-095)', async () => {
  const { agentModel } = await import('../src/model/agent-page.ts');
  const done: SessionTie = { task: 'AV-4', role: 'builder', finished: true, why: 'done' };
  const untied = hub();
  untied.agents = [
    // Claude Code lists all three waiting. acc can't tie the first to a task.
    { cwd: '/r.worktrees/AV-2', kind: 'background', startedAt: 5, id: 'bg1', name: 'av-2', state: 'blocked', waitingFor: 'permission prompt' },
    // AV-4's builder, here, left waiting at its prompt after its task was done.
    { cwd: '/r/.claude/worktrees/AV-4', kind: 'background', startedAt: 4, id: 'bg4', sessionId: 's-4', name: 'Acme · AV-4 Login page · builder', state: 'blocked', status: 'waiting', pid: 14 },
    // Another repo's, elsewhere on the machine: its process gone, still listed blocked.
    { cwd: '/Users/me/clients/Acme Service/.claude/worktrees/ACME-38', kind: 'background', startedAt: 3, id: 'bg38', sessionId: 's-38', name: 'ACME-38', state: 'blocked' },
    { cwd: '/elsewhere', kind: 'interactive', startedAt: 1, sessionId: 'uuid', name: 'other', status: 'idle', pid: 9 },
  ];
  const tied: HubLike = { ...untied, tieFor: (s) => (s.id === 'bg4' || s.id === 'bg38' ? done : null) };
  const input = (h: HubLike) => ({ hub: h, section: 'agents' as const, boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set<string>() } });
  const m = homeModel(input(tied));
  const was = homeModel(input(untied));
  const row = (key: string) => m.agents.repos.flatMap((r) => [...r.tasks.flatMap((t) => t.agents), ...r.finished]).find((a) => a.key === key)!;
  for (const key of ['s-4', 's-38']) assert.deepEqual([row(key).look, row(key).needsYou, row(key).finished], [{ label: 'Finished', icon: 'check', tone: 'neutral' }, false, true], key);
  assert.deepEqual(m.agents.repos.find((r) => r.label === 'Acme Service')!.finished.map((a) => [a.key, a.where]), [['s-38', 'worktree ACME-38']], 'elsewhere on the machine, in its repo');
  assert.deepEqual([row('bg1').look.label, row('bg1').needsYou, row('bg1').finished], ['Needs you: permission prompt', true, false]);
  assert.deepEqual([m.agents.repos[0]!.tasks.flatMap((t) => t.agents).map((a) => a.key), m.agents.repos[0]!.finished.map((a) => a.key)], [['bg1'], ['s-4']], 'the finished one folded away');
  // The rail's Agents badge counts only the untied one.
  const nav = (x: typeof m) => Object.fromEntries(x.nav.map((n) => [n.section, n]));
  assert.deepEqual([nav(m).agents!.count, nav(m).agents!.attention, nav(m).agents!.hint], [1, true, '1 waiting on you']);
  assert.equal(nav(was).agents!.count, 3, 'untied, all three would need you');
  // The Overview lists the untied one only; its badge, the launcher's and the status bar count one less for each finished one.
  const titles = m.overview.attention.map((a) => a.title);
  assert.ok(titles.includes('av-2'));
  assert.ok(!titles.some((t) => /AV-4|ACME-38/.test(t)), 'no finished session in Needs you');
  assert.equal(needsYouCount(was.overview) - needsYouCount(m.overview), 2);
  assert.equal(nav(m).overview!.count, needsYouCount(m.overview));
  // Its page says Finished too.
  const page = (h: HubLike, key: string) => agentModel({ hub: h, key, seen: null, entries: [], readable: false, lastAt: null });
  assert.deepEqual(page(tied, 's-38').look, { label: 'Finished', icon: 'check', tone: 'neutral' });
  assert.equal(page(untied, 's-38').look.label, 'Needs you');
  // Only the one whose process still runs is stopped (D-119): the other has nothing left to stop.
  assert.equal(m.agents.stopFinished, 1);
  assert.equal(was.agents.stopFinished, 0);
  assert.ok(menuFor('acc.home', { webviewSection: 'agent', agentBackground: row('s-4').background }).includes('acc.agent.stop'));
});

test('Stop finished sessions is on the Agents header while there are any, through a command the page may ask for (D-095)', () => {
  const page = pageSource();
  assert.match(page, /m\.stopFinished \? toolbarButton\('acc\.agents\.stopFinished', `Stop finished \(\$\{m\.stopFinished\}\)`, 'debug-stop'\) : null/);
  assert.match(readFileSync(join(root, 'src', 'model', 'agents.ts'), 'utf8'), /'acc\.agents\.stopFinished'/, 'the page may ask for it');
  assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === 'acc.agents.stopFinished'));
  assert.match(readFileSync(join(root, 'src', 'agents.ts'), 'utf8'), /reg\('acc\.agents\.stopFinished', \(repo\?: unknown\) => this\.stopFinished\(typeof repo === 'string' \? repo : null\)\)/);
});

test('Agents\' Settings button goes to How agents run in Settings, and per-token billing stays on Agents (GH-110)', () => {
  const page = pageSource('agents.ts');
  // The button goes to Settings' heading for it, by the key the model gives it, with a name that says so.
  assert.equal(page.match(/const HOW_AGENTS_RUN = '([^']+)'/)?.[1], settingsKey('agents'));
  assert.match(page, /button\('Settings', 'settings-gear', \(\) => go\('settings', HOW_AGENTS_RUN\), 'ghost'\)/);
  assert.match(page, /setAttribute\('aria-label', 'Settings: How agents run'\)/);
  // How agents run itself isn't drawn here any more: no Change… of its own.
  for (const c of ['acc.agents.configure', 'acc.agents.autonomy', 'acc.agents.autoMerge']) assert.ok(!page.includes(c), `Agents draws no ${c}`);
  // Per-token billing shows above the sessions, once for the machine; the subscription doesn't.
  assert.match(page, /if \(m\.billing\?\.tone === 'orange'\) out\.push\(el\('div', 'setting-billing', status\(m\.billing\)\)\)/);
  const billing = (status: 'pass' | 'fail' | 'skip' | null) => agentsModel(hub(), status ? [{ id: 'A1.claude-billing', part: 'machine', title: 'Billing', status, detail: status === 'fail' ? 'ANTHROPIC_API_KEY in the environment.' : 'Agents use your Claude subscription.' }] : []).billing;
  assert.deepEqual(billing('fail'), { label: 'Per-token billing: ANTHROPIC_API_KEY in the environment.', icon: 'warning', tone: 'orange' });
  assert.deepEqual(billing('pass'), { label: 'Agents use your Claude subscription', icon: 'pass', tone: 'blue' });
  assert.deepEqual([billing('skip'), billing(null)], [null, null], 'nothing until the check has run');
  // It's the machine's, so a hub with no project still says it.
  assert.equal(agentsModel({ ...hub(), projects: [] }, [{ id: 'A1.claude-billing', part: 'machine', title: 'Billing', status: 'fail', detail: 'x' }]).billing?.tone, 'orange');
});

test('How agents run, in Settings, shows no row for a config key nothing reads yet, and with none listed it shows them all (GH-107)', () => {
  const h = hub();
  const p = h.projects[0]!;
  p.agents = {
    builder: { model: 'opus', effort: 'high', fallbackModel: 'sonnet', from: { model: 'project', effort: 'project', fallbackModel: 'project' } },
    reviewer: { model: 'opus', effort: null, fallbackModel: null, from: { model: 'project', effort: 'default', fallbackModel: 'default' } },
  };
  p.config = { ...p.config, profile: 'generic', autonomy: 'review' };
  const keys = (s: ReturnType<typeof howAgentsRun>['projects'][number]) => [...s.roles.flatMap((r) => r.parts.map((x) => x.key)), s.autonomy?.key, s.autoMerge?.key];
  const all = howAgentsRun(h.projects, []).projects[0]!;
  assert.deepEqual(keys(all), ['agents.builder.model', 'agents.builder.effort', 'agents.builder.fallbackModel', 'agents.reviewer.model', 'agents.reviewer.effort', 'autonomy', 'autopilot.autoMerge']);
  assert.deepEqual(howAgentsRun(h.projects, [], {}).projects[0], all, 'the real list is empty today, so nothing is hidden');
  const why = 'GH-1 will read it.';
  const some = howAgentsRun(h.projects, [], { 'agents.builder.fallbackModel': why, 'autopilot.autoMerge': why }).projects[0]!;
  assert.deepEqual(keys(some), ['agents.builder.model', 'agents.builder.effort', 'agents.reviewer.model', 'agents.reviewer.effort', 'autonomy', undefined]);
  // A role with every part hidden has no row, and nor does autonomy.
  const fewer = howAgentsRun(h.projects, [], { 'agents.reviewer.model': why, 'agents.reviewer.effort': why, autonomy: why }).projects[0]!;
  assert.deepEqual([fewer.roles.map((r) => r.role), fewer.autonomy], [['builder'], null]);
});

/**
 * A busy machine (GH-119): two projects open here, one with no agents, a repo another window has open, a repo
 * no window has, and folders in no repo. Acme Service has a task whose builder needs you beside its reviewer,
 * a task with a second builder at work, a finished builder, and a session tied to no task.
 */
function busyMachine(): HubLike {
  const acme = '/w/acme';
  const wt = (id: string) => `${acme}/.claude/worktrees/${id}`;
  const billing = '/Users/me/clients/Billing';
  const project = (name: string, root: string) => ({ ...hub().projects[0]!, name, root, worktrees: [{ path: root, head: 'a', branch: 'dev', main: true, changed: 0, locked: false, prunable: false }] });
  const projects = [project('Acme Service', acme), project('Acme Portal', '/w/portal')];
  const ties: Record<string, SessionTie> = {
    s1: { task: 'AC-1', role: 'builder', finished: false, why: null, n: 2 },
    sb2: { task: 'AC-2', role: 'builder', finished: false, why: null },
    r2: { task: 'AC-2', role: 'review', finished: false, why: null },
    s3: { task: 'AC-3', role: 'builder', finished: true, why: 'done' },
    sbl: { task: 'BL-7', role: 'builder', finished: false, why: null, title: 'Invoice export' },
  };
  return {
    projects,
    agents: [
      { cwd: wt('AC-1'), kind: 'background', startedAt: 10, id: 'b1', sessionId: 's1', name: 'Acme Service · AC-1 Case rules · builder 2', state: 'working', pid: 1 },
      { cwd: `${wt('AC-2')}/force-app`, kind: 'background', startedAt: 5, id: 'b2', sessionId: 'sb2', name: 'Acme Service · AC-2 Lead routing · builder', state: 'working', pid: 2 },
      { cwd: acme, kind: 'interactive', startedAt: 30, sessionId: 'r2', name: 'Acme Service · AC-2 Lead routing · review', status: 'busy', pid: 3 },
      { cwd: wt('AC-3'), kind: 'background', startedAt: 1, id: 'b3', sessionId: 's3', name: 'Acme Service · AC-3 Old work · builder', state: 'blocked' },
      { cwd: acme, kind: 'interactive', startedAt: 50, sessionId: 'u1', name: 'acme-dev', status: 'idle', pid: 4 },
      { cwd: `${billing}/.claude/worktrees/BL-7`, kind: 'background', startedAt: 20, id: 'bbl', sessionId: 'sbl', name: 'Billing · BL-7 Invoice export · builder', state: 'working', pid: 5 },
      { cwd: '/Users/me/zeta/src', kind: 'interactive', startedAt: 40, sessionId: 'z1', name: 'zeta', status: 'idle', pid: 6 },
      { cwd: '/Users/me/Downloads/notes', kind: 'interactive', startedAt: 60, sessionId: 'f1', name: 'notes', status: 'idle', pid: 7 },
      { cwd: '/Users/me/tmp/x', kind: 'interactive', startedAt: 70, sessionId: 'f2', name: 'scratchpad', status: 'idle', pid: 8 },
    ],
    agentsError: null,
    questions: [{ id: 'q1', sessionId: 'sb2', tool: 'Bash' } as never],
    askingFor: (s) => (s.sessionId === 'sb2' ? 'wants permission' : null),
    tieFor: (s) => ties[s.sessionId ?? ''] ?? null,
    taskRows: (r) => (r === acme ? [
      { ...row('AC-1', 'running', 'running'), title: 'Case rules', run: { bgId: 'b1', sessionId: 's1', worktree: wt('AC-1') } },
      { ...row('AC-2', 'review', 'review'), title: 'Lead routing', run: { bgId: 'b2', sessionId: 'sb2', worktree: wt('AC-2') }, reviewing: { sessionId: 'r2' } },
      { ...row('AC-3', 'done', 'done'), title: 'Old work', run: { bgId: 'b3', sessionId: 's3', worktree: wt('AC-3') } },
    ] : []),
    projectFor: (p) => projects.find((x) => p === x.root || p.startsWith(`${x.root}/`)),
    home: '/Users/me',
    repoFor: (p) => repoRoot(p, '/Users/me', (d) => d === billing || d === '/Users/me/zeta'),
    // Another window's Command Center shows Billing's worktree: it has Billing open.
    otherWindows: ['/elsewhere/project', `${billing}/.claude/worktrees/BL-7`],
  };
}

test('the Agents page is grouped by repo: this window\'s projects first, then every other repo by name, then Other folders (GH-119)', () => {
  const m = agentsModel(busyMachine());
  assert.deepEqual(m.repos.map((r) => [r.label, r.window, r.sessions]), [
    ['Acme Service', 'this', 5], ['Acme Portal', 'this', 0], ['Billing', 'other', 1], ['zeta', null, 1], ['Other folders', null, 2],
  ], 'an empty project still has its line; a repo another window shows says so; nothing is lumped together');
  assert.deepEqual(m.repos.map((r) => r.key), ['/w/acme', '/w/portal', '/Users/me/clients/Billing', '/Users/me/zeta', null]);
  assert.deepEqual(m.repos.map((r) => r.path), ['/w/acme', '/w/portal', '~/clients/Billing', '~/zeta', null], 'its folder, for its heading\'s hover');
  // The header's summary, and the rail's badge, from the same counts.
  assert.deepEqual(m.counts, { sessions: 9, working: 3, needsYou: 1, finished: 1 });
  // A window showing a folder above a repo, or another repo, doesn't have it open.
  const away = agentsModel({ ...busyMachine(), otherWindows: ['/Users/me', '/Users/me/clients/Billing2'] });
  assert.equal(away.repos.find((r) => r.label === 'Billing')!.window, null);
});

test('under its repo, each task heads its agents, those needing you first, then sessions tied to no task; finished ones fold away (GH-119)', () => {
  const acme = agentsModel(busyMachine()).repos[0]!;
  // AC-2's builder needs you, so AC-2 comes first, though AC-1's agent is newer; the untied session comes last.
  assert.deepEqual(acme.tasks.map((t) => [t.key, t.title, t.project, t.needsYou]), [['AC-2', 'Lead routing', '/w/acme', true], ['AC-1', 'Case rules', '/w/acme', false], [null, null, null, false]]);
  // A task's agents together, by role, the one needing you first: its builder (D-087), its review.
  const [ac2, ac1, other] = acme.tasks;
  assert.deepEqual(ac2!.agents.map((a) => [a.label, a.needsYou, a.look.label]), [['builder', true, 'Needs you: wants permission'], ['review', false, 'Working']]);
  assert.deepEqual(ac1!.agents.map((a) => a.label), ['builder 2'], 'the second dispatch, by its run\'s count');
  assert.deepEqual(other!.agents.map((a) => [a.label, a.task]), [['acme-dev', null]], 'by its own name');
  // Its done task's builder, folded away, naming its task since no task line heads it.
  assert.deepEqual(acme.finished.map((a) => [a.key, a.label, a.task, a.look.label]), [['s3', 'builder', { key: 'AC-3', title: 'Old work' }, 'Finished']]);
  assert.equal(acme.stopFinished, 0, 'its process is gone, so Stop all has nothing to stop (D-119)');
  // A task elsewhere: its title from its repo's ledger, and no page here to open.
  const billing = agentsModel(busyMachine()).repos[2]!;
  assert.deepEqual(billing.tasks.map((t) => [t.key, t.title, t.project]), [['BL-7', 'Invoice export', null]]);
  // Answer, Watch and Open in Claude Code: the line knows its question and its conversation.
  assert.deepEqual([ac2!.agents[0]!.question, ac2!.agents[0]!.conversation, ac2!.agents[1]!.question], ['q1', true, null]);
});

test('tasks that both need you go by their newest agent, not by the one that sorts first under them (GH-119)', () => {
  const m = busyMachine();
  // AC-1's builder needs you too: AC-2's needing-you builder is older than it, but AC-2's review is newer.
  const both = { ...m, agents: m.agents.map((s) => (s.sessionId === 's1' ? { ...s, state: 'blocked' as const } : s)) };
  const acme = agentsModel(both).repos[0]!;
  assert.deepEqual(acme.tasks.map((t) => [t.key, t.needsYou]), [['AC-2', true], ['AC-1', true], [null, false]]);
  assert.equal(agentsModel(both).counts.working, 2, 'working is the look\'s own flag');
});

test('no line says what its headings say: Where shows only off its task\'s own worktree, and a name never twice (GH-119)', () => {
  const m = agentsModel(busyMachine());
  const where = (key: string) => m.repos.flatMap((r) => [...r.tasks.flatMap((t) => t.agents), ...r.finished]).find((a) => a.key === key)!.where;
  assert.equal(where('s1'), null, 'in its task\'s own worktree');
  assert.equal(where('sb2'), 'force-app', 'in a folder inside its own worktree: that folder alone');
  assert.equal(where('r2'), 'main checkout', 'a reviewer in the main checkout');
  assert.equal(where('s3'), null);
  assert.equal(where('sbl'), null, 'a task elsewhere, in its own worktree');
  assert.equal(where('u1'), 'main checkout', 'tied to no task: where it is in its repo');
  assert.equal(where('z1'), 'src');
  assert.equal(where('f1'), null, 'a session named for its folder doesn\'t say it twice');
  assert.equal(where('f2'), 'x');
  // No line names its repo or its task: those are its headings'.
  let lines = 0;
  for (const r of m.repos) for (const t of r.tasks) for (const a of t.agents) {
    lines++;
    if (t.key) assert.ok(!a.label.includes(t.key) && !a.label.includes(r.label), `${a.label} under ${t.key}`);
    assert.ok(!a.where?.includes(r.label), `${a.where} under ${r.label}`);
  }
  assert.equal(lines, 8, 'every line but the finished one');
});

test('the Agents page draws repos, task lines and agent lines, with no Kind column and nothing done twice (GH-119)', () => {
  const page = pageSource('agents.ts');
  // Interactive or background is an icon with its word on hover, not a column.
  assert.ok(!/\['Kind'/.test(page), 'no Kind column');
  assert.match(page, /const word = a\.background \? 'Background session' : 'Interactive session';/);
  assert.match(page, /kind\.title = word;/);
  // A repo with no agents is one quiet line; another window's says so.
  assert.match(page, /' · no agents right now'/);
  assert.match(page, /'another window'/);
  // A task's line opens its page; finished sessions fold, closed unless opened, with Stop all for the repo's.
  assert.match(page, /openable\(line, \{ type: 'run', command: 'acc\.task\.show', ref: \{ project: t\.project, task: key \} \}\)/);
  assert.match(page, /const open = memory\(\)\.opened\.includes\(key\);/);
  assert.match(page, /argButton\('acc\.agents\.stopFinished', 'Stop all', 'debug-stop', r\.key\)/);
  // While it needs you: Answer finds its question on the Overview; Watch and Open in Claude Code run its commands.
  assert.match(page, /go\('overview'\); answerHere\(a\.question!\);/);
  assert.match(page, /run\('acc\.agent\.watch'\)/);
  assert.match(page, /run\('acc\.agent\.openInClaude'\)/);
  // The header's summary counts working, needs you and finished.
  assert.match(page, /`\$\{plural\(c\.sessions, 'session'\)\}: \$\{c\.working\} working, \$\{c\.needsYou\} need\$\{c\.needsYou === 1 \? 's' : ''\} you, \$\{c\.finished\} finished\.`/);
});

test('Stop all stops one repo\'s finished sessions: the command takes the repo the page groups them by (GH-119)', () => {
  const src = readFileSync(join(root, 'src', 'agents.ts'), 'utf8');
  assert.match(src, /return folders \? all\.filter\(\(s\) => folders\.get\(s\.cwd\)\?\.repo\?\.path === repo\) : all;/);
  // The repo a session is in is the same rule's on the page and in the command.
  const h = busyMachine();
  const folders = sessionFolders(h);
  for (const r of agentsModel(h).repos) {
    const inIt = h.agents.filter((s) => (folders.get(s.cwd)!.repo?.path ?? null) === r.key);
    assert.equal(inIt.length, r.sessions, r.label);
  }
  assert.ok(isFromWebview({ type: 'toolbar', command: 'acc.agents.stopFinished', arg: '/Users/me/clients/Billing' }), 'the page may ask for it with a repo');
});

test('a node command gets a node of the right shape, its own string, or nothing (GH-106)', () => {
  // Given an object that isn't a row, such as { kind: 'task' }, each of these read a field it lacked and threw:
  // acc.agent.attach, logs, openFolder, openInClaude, stop, watch; acc.task.abandon, analyze, attach, block,
  // cleanup, copyId, dispatch, dispatchAnyway, dispatchWith, land, move, openInClaude, openPacket, openPr,
  // openTicket, openWorktree, resume, review, show, stopWaiting, unblock, watch, watchAnalysis, watchReview.
  // Given nothing or null, these read n.kind and threw, until it became n?.kind: acc.agent.openFolder;
  // acc.env.openOrg, openGithub, copyBranch, compare; acc.task.openTicket, copyId, attach, openWorktree and the
  // task methods behind them; acc.worktree.open, terminal, reveal, remove.
  const project = { root: '/repo', config: { environments: [] } };
  const task = { kind: 'task', project, task: { id: 'T-1', source: { kind: 'manual' } } };
  const nodes = [task, { kind: 'project', project }, { kind: 'group', project, group: 'ready', tasks: [] }, { kind: 'place', label: 'x', root: null, sessions: [] }, { kind: 'agent', session: { cwd: '/repo' }, project }, { kind: 'worktree', project, worktree: { path: '/repo/w' } }, { kind: 'env', project, env: { branch: 'main' } }];
  for (const n of nodes) assert.equal(nodeArg(n), n, n.kind);
  // A root or an id still reaches the commands that take one, as acc.agents.autonomy(root) does.
  for (const v of [undefined, '/repo', 'builder|/repo', 0]) assert.equal(nodeArg(v), v);
  for (const junk of [null, {}, [], { kind: 'task' }, { kind: 'task', project }, { kind: 'task', project: '/repo', task: { id: 'T-1' } }, { kind: 'agent', session: null }, { kind: 'env', project, env: {} }, { kind: 'worktree', project: {}, worktree: { path: '/w' } }, { kind: 'nope', project }, { root: '/outside' }]) {
    assert.equal(nodeArg(junk), undefined, JSON.stringify(junk));
  }
});
