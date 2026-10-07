// Autopilot: each step it takes as a notice and a History item, and its switch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { row } from './support.ts';

test('each step autopilot takes is one notice: what it did, and what it couldn\'t, as a warning (D-064)', async () => {
  const { autopilotNotices } = await import('../src/logic/autopilot.ts');
  const { noticeActions } = await import('../src/logic/notices.ts');
  type Rec = import('../../packages/core/src/autopilot-log.ts').AutopilotRecord;
  const at = '2026-10-05T12:00:00.000Z';
  const rec = (task: string, more: Partial<Rec>): Rec => ({ seq: 1, at, task, step: 'land', outcome: 'done', ...more });
  type Task = import('../src/logic/autopilot.ts').AutopilotTask;
  const gh: Task = { id: 'GH-31', source: { kind: 'github', key: '31' }, history: [] };
  const say = (r: Rec, tasks: Task[] = [gh]) => autopilotNotices([r], tasks).map((n) => [n.text, n.urgent, noticeActions(n)]);
  const show = ['Show', 'acc.task.show'];
  const pr = ['Open pull request', 'acc.task.openPr'];

  const review = ['Review the update', 'acc.task.show'];
  assert.deepEqual(say(rec('GH-31', { pr: { number: 40, url: 'u', opened: true } })), [['Autopilot landed GH-31: pull request #40. Its update for the ticket is ready for you to review and post.', false, [review, pr]]]);
  assert.deepEqual(say(rec('GH-31', { pr: { number: 40, url: 'u', opened: false } })), [['Autopilot updated pull request #40 (GH-31). Its update for the ticket is ready for you to review and post.', false, [review, pr]]]);
  // A ticket's update is a person's to post: autopilot drafts it, and the notice opens the task to review it (D-066).
  const jira = { id: 'ACME-7', source: { kind: 'jira', key: 'ACME-7' }, history: [] };
  assert.deepEqual(say(rec('ACME-7', { pr: { number: 41, url: 'u', opened: true } }), [jira]),
    [['Autopilot landed ACME-7: pull request #41. Its update for the ticket is ready for you to review and post.', false, [['Review the update', 'acc.task.show'], pr]]]);
  assert.deepEqual(say(rec('T-4', { pr: { number: 43, url: 'u', opened: true } }), [{ id: 'T-4', source: { kind: 'manual', key: null }, history: [] }]),
    [['Autopilot landed T-4: pull request #43', false, [pr, show]]], 'a task acc alone keeps has no ticket to tell');
  assert.deepEqual(say(rec('GH-31', { step: 'review', verdict: 'pass' })), [['Autopilot reviewed GH-31: it passed. Autopilot lands it next.', false, [show]]]);
  assert.deepEqual(say(rec('GH-31', { step: 'review', verdict: 'changes', reason: 'sum has no test' })), [['Autopilot\'s review asked for changes on GH-31: sum has no test. Autopilot re-dispatches it next.', false, [show]]]);
  // Once re-dispatched by autopilot, a second rework is a person's.
  const again = { ...gh, history: [{ at: '2026-10-05T11:00:00.000Z', from: 'rework', to: 'running', actor: 'orchestrator', by: 'orchestrator:autopilot' }] };
  assert.deepEqual(say(rec('GH-31', { step: 'review', verdict: 'changes', reason: 'Still no test.' }), [again]),
    [['Autopilot\'s review asked for changes on GH-31 again: Still no test. A second rework waits for you.', true, [['Re-dispatch', 'acc.task.dispatch'], show]]]);
  assert.deepEqual(say(rec('GH-31', { step: 'dispatch' })), [['Autopilot re-dispatched GH-31 with its review\'s changes.', false, [['Watch', 'acc.task.watch'], show]]]);
  assert.deepEqual(say(rec('GH-31', { step: 'refresh', base: 'main' }))[0]![0], 'Autopilot merged main into GH-31, and its checks passed. It\'s reviewed next, then landed.');
  assert.deepEqual(say(rec('GH-31', { step: 'refresh', base: null, pr: { number: 40, url: 'u', opened: false } }))[0]![0], 'Pull request #40 (GH-31) no longer conflicts with its base: autopilot found nothing to merge.');

  // What it couldn't do needs a person: a warning, with the step to take by hand.
  assert.deepEqual(say(rec('GH-31', { outcome: 'failed', reason: 'the push was refused: rejected' })), [['Autopilot couldn\'t land GH-31: the push was refused: rejected.', true, [['Land', 'acc.task.land'], show]]]);
  assert.deepEqual(say(rec('GH-31', { step: 'review', outcome: 'failed', reason: 'The review didn\'t finish within 45 minutes, so acc stopped it.' }))[0]!.slice(0, 2), ['Autopilot couldn\'t review GH-31: The review didn\'t finish within 45 minutes, so acc stopped it.', true]);
  assert.match(say(rec('GH-31', { step: 'refresh', outcome: 'failed', reason: 'Conflicts with main' }))[0]![0] as string, /^Autopilot couldn't update GH-31 from its base: Conflicts with main\.$/);
  assert.deepEqual(autopilotNotices([rec('GH-31', { step: 'review', verdict: 'pass' }), rec('GH-31', { seq: 2, pr: { number: 40, url: 'u', opened: true } })], [gh]).length, 2, 'one each');
});

test('a builder that stopped is told once, with what it last said, and Resume; not as an agent waiting in its own prompt (D-067)', async () => {
  const { autopilotNotices } = await import('../src/logic/autopilot.ts');
  const { noticeActions, taskNotices } = await import('../src/logic/notices.ts');
  const { sessionFor } = await import('../src/logic/agents.ts');
  const { autopilotStepLook } = await import('../src/model/history.ts');
  type Row = import('../src/logic/shared.ts').TaskRow;
  const said = 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.';
  const row = (more: Partial<Row> = {}): Row => ({ id: 'GH-41', title: 'Task GH-41', state: 'running', display: 'running', environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const stopped = row({ display: 'needs-you', stopped: { said } });
  const news = taskNotices([row()], [stopped]);
  assert.deepEqual(news.map((n) => [n.kind, n.urgent, n.text]), [['stopped', true, `GH-41's agent stopped: ${said}`]]);
  assert.deepEqual(noticeActions(news[0]!), [['Resume', 'acc.task.resume'], ['Show', 'acc.task.show']], 'Resume, not Open in Claude Code');
  assert.deepEqual(taskNotices([stopped], [stopped]), [], 'said once');
  assert.equal(taskNotices([row()], [row({ display: 'needs-you', stopped: { said: null } })])[0]!.text, 'GH-41\'s agent stopped before acc done or acc block.');
  assert.match(taskNotices([row()], [row({ display: 'needs-you', stopped: { said: 'x'.repeat(500) } })])[0]!.text, /^GH-41's agent stopped: x{150,}…$/, 'a long quote is clipped');

  // A resumed conversation is listed beside its old background session: the one with a process is the agent.
  const old = { cwd: '/r', kind: 'background', startedAt: 1, id: 'bg41', sessionId: 'sess-41', name: 'GH-41', state: 'blocked' };
  const live = { cwd: '/w41', kind: 'interactive', startedAt: 2, sessionId: 'sess-41', name: 'gh-41-73', pid: 94651, status: 'busy' };
  assert.equal(sessionFor({ id: 'GH-41', run: { bgId: 'bg41', sessionId: 'sess-41' } }, [old, live]), live);
  assert.equal(sessionFor({ id: 'GH-41', run: { bgId: 'bg41', sessionId: 'sess-41' } }, [old]), old);

  // Autopilot's resume, as a notice and in History.
  const at = '2026-10-05T22:20:00.000Z';
  const gh = { id: 'GH-41', source: { kind: 'github', key: '41' }, history: [] };
  const done = autopilotNotices([{ seq: 1, at, task: 'GH-41', step: 'resume', outcome: 'done', reason: said }], [gh]);
  assert.deepEqual(done.map((n) => [n.text, n.urgent, noticeActions(n)]), [[`Autopilot resumed GH-41: ${said}`, false, [['Watch', 'acc.task.watch'], ['Show', 'acc.task.show']]]]);
  const failed = autopilotNotices([{ seq: 2, at, task: 'GH-41', step: 'resume', outcome: 'failed', reason: 'Claude Code didn\'t start.' }], [gh]);
  assert.deepEqual(failed.map((n) => [n.text, n.urgent, noticeActions(n)[0]]), [['Autopilot couldn\'t resume GH-41: Claude Code didn\'t start.', true, ['Resume', 'acc.task.resume']]]);
  assert.deepEqual(autopilotStepLook({ seq: 1, at, task: 'GH-41', step: 'resume', outcome: 'done', reason: said }), { look: { label: 'Autopilot resumed it', icon: 'debug-continue', tone: 'blue' }, detail: said, url: null });
});

test('autopilot\'s send-back for failing checks is its own notice and History item, and its re-dispatch says what for (D-076)', async () => {
  const { autopilotNotices, withoutAutopilotEcho } = await import('../src/logic/autopilot.ts');
  const { noticeActions, taskNotices } = await import('../src/logic/notices.ts');
  const { autopilotStepLook } = await import('../src/model/history.ts');
  type Rec = import('../../packages/core/src/autopilot-log.ts').AutopilotRecord;
  type Task = import('../src/logic/autopilot.ts').AutopilotTask;
  type Row = import('../src/logic/shared.ts').TaskRow;
  const at = '2026-10-06T12:00:00.000Z';
  const gh: Task = { id: 'GH-57', source: { kind: 'github', key: '57' }, history: [] };
  const say = (r: Rec, tasks: Task[] = [gh]) => autopilotNotices([r], tasks).map((n) => [n.text, n.urgent, noticeActions(n)]);
  const show = ['Show', 'acc.task.show'];
  const pr = ['Open pull request', 'acc.task.openPr'];
  const sent: Rec = { seq: 1, at, task: 'GH-57', step: 'checks', outcome: 'done', checks: ['build', 'test'], reason: 'Checks failed on GitHub on abc1234: build, test.' };
  assert.deepEqual(say(sent), [['Autopilot sent GH-57 back to its builder: checks failed on GitHub: build, test.', false, [pr, show]]]);
  assert.deepEqual(say({ seq: 2, at, task: 'GH-57', step: 'dispatch', outcome: 'done', cause: 'checks' }), [['Autopilot re-dispatched GH-57 for its failing checks.', false, [['Watch', 'acc.task.watch'], show]]]);
  assert.deepEqual(say({ seq: 2, at, task: 'GH-57', step: 'dispatch', outcome: 'done', cause: 'review' })[0]![0], 'Autopilot re-dispatched GH-57 with its review\'s changes.');
  const again = 'Checks failed on GitHub again: build. Autopilot already sent abc1234 back once: a person decides.';
  assert.deepEqual(say({ seq: 3, at, task: 'GH-57', step: 'checks', outcome: 'failed', reason: again }), [[`Autopilot couldn't send GH-57 back for its failing checks: ${again}`, true, [pr, show]]]);

  // History says the same, with the checks' names.
  assert.deepEqual(autopilotStepLook(sent), { look: { label: 'Autopilot sent it back: checks failed on GitHub', icon: 'github-action', tone: 'neutral' }, detail: 'build, test', url: null });
  assert.equal(autopilotStepLook({ seq: 2, at, task: 'GH-57', step: 'dispatch', outcome: 'done', cause: 'checks' }).look.label, 'Autopilot re-dispatched it for its failing checks');
  assert.equal(autopilotStepLook({ seq: 2, at, task: 'GH-57', step: 'dispatch', outcome: 'done' }).look.label, 'Autopilot re-dispatched it for the review\'s changes');
  assert.deepEqual(autopilotStepLook({ seq: 3, at, task: 'GH-57', step: 'checks', outcome: 'failed', reason: again }).look, { label: 'Autopilot couldn\'t send it back for its failing checks', icon: 'warning', tone: 'orange' });

  // A re-dispatch for failing checks isn't a review's one: the review's changes after it aren't a second rework.
  const checksFirst: Task = { ...gh, history: [
    { at: '2026-10-06T10:00:00.000Z', from: 'review', to: 'rework', actor: 'orchestrator', by: 'orchestrator:autopilot' },
    { at: '2026-10-06T10:01:00.000Z', from: 'rework', to: 'running', actor: 'orchestrator', by: 'orchestrator:autopilot' },
  ] };
  const changes: Rec = { seq: 4, at, task: 'GH-57', step: 'review', outcome: 'done', verdict: 'changes', reason: 'No test.' };
  assert.equal(autopilotNotices([changes], [checksFirst])[0]!.text, 'Autopilot\'s review asked for changes on GH-57: No test. Autopilot re-dispatches it next.');

  // D-044's notice of its move to rework names the checks, and keeps quiet when autopilot's own said it.
  const row = (state: string, more: Partial<Row> = {}): Row => ({ id: 'GH-57', title: 'Task GH-57', state, display: state as Row['display'], environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const news = taskNotices([row('review')], [row('rework', { checks: ['build'], review: { verdict: 'pass', summary: 'Good.', current: true } })]);
  assert.deepEqual(news.map((n) => [n.kind, n.text, n.urgent]), [['rework', 'Checks failed on GitHub for GH-57: build. It went back to its builder.', true]]);
  assert.deepEqual(withoutAutopilotEcho(news, [sent]), [], 'autopilot\'s notice told it');
  assert.equal(withoutAutopilotEcho(news, [{ seq: 1, at, task: 'GH-57', step: 'land', outcome: 'done', pr: { number: 9, url: 'u', opened: true } }]).length, 1);
});

test('the merge queue\'s send-back is its own notice and History item, its merge commit says it merges next, and a turn it couldn\'t take needs you (GH-73)', async () => {
  const { autopilotNotices, withoutAutopilotEcho } = await import('../src/logic/autopilot.ts');
  const { noticeActions, taskNotices } = await import('../src/logic/notices.ts');
  const { autopilotStepLook } = await import('../src/model/history.ts');
  type Rec = import('../../packages/core/src/autopilot-log.ts').AutopilotRecord;
  type Row = import('../src/logic/shared.ts').TaskRow;
  const at = '2026-10-06T12:00:00.000Z';
  const gh = { id: 'GH-73', source: { kind: 'github', key: '73' }, history: [] };
  const say = (r: Rec) => autopilotNotices([r], [gh]).map((n) => [n.text, n.urgent, noticeActions(n)]);
  const show = ['Show', 'acc.task.show'];
  const pr = ['Open pull request', 'acc.task.openPr'];
  const conflict: Rec = { seq: 1, at, task: 'GH-73', step: 'queue', outcome: 'done', checks: [], conflicts: ['sum.js', 'docs/DESIGN.md'], reason: 'The merge queue sent it back: merging main in conflicts in sum.js, docs/DESIGN.md.' };
  const failed: Rec = { seq: 2, at, task: 'GH-73', step: 'queue', outcome: 'done', checks: ['check'], reason: 'The merge queue sent it back: the full check failed with main merged in: check.' };
  assert.deepEqual(say(conflict).map((n) => [n[0], n[1]]), [['Autopilot sent GH-73 back to its builder from the merge queue: it conflicts with its base in sum.js, docs/DESIGN.md.', false]]);
  assert.equal(say(failed)[0]![0], 'Autopilot sent GH-73 back to its builder from the merge queue: its full check failed: check.');
  assert.equal(say({ seq: 3, at, task: 'GH-73', step: 'dispatch', outcome: 'done', cause: 'queue' })[0]![0], 'Autopilot re-dispatched GH-73 with what the merge queue found.');
  const merged: Rec = { seq: 4, at, task: 'GH-73', step: 'refresh', outcome: 'done', base: 'main', queue: true };
  assert.deepEqual(say(merged), [['The merge queue merged main into GH-73, and its full check passed. It merges once GitHub\'s checks pass.', false, [pr, show]]]);
  const stuck = 'GH-73\'s worktree has changes nobody committed, so autopilot leaves it alone.';
  assert.deepEqual(say({ seq: 5, at, task: 'GH-73', step: 'queue', outcome: 'failed', reason: stuck }), [[`Autopilot couldn't take GH-73 through the merge queue: ${stuck}`, true, [pr, show]]]);

  // History: an icon and its words, neutral for a send-back, blue for its merge commit, orange only for a failure.
  assert.deepEqual(autopilotStepLook(conflict), { look: { label: 'Autopilot sent it back from the merge queue', icon: 'git-merge', tone: 'neutral' }, detail: 'It conflicts with its base in sum.js, docs/DESIGN.md.', url: null });
  assert.equal(autopilotStepLook(failed).detail, 'Its full check failed: check.');
  assert.deepEqual(autopilotStepLook(merged), { look: { label: 'The merge queue merged main into it', icon: 'git-merge', tone: 'blue' }, detail: 'Its full check passed on the merge. It merges once GitHub\'s checks pass.', url: null });
  assert.equal(autopilotStepLook({ seq: 3, at, task: 'GH-73', step: 'dispatch', outcome: 'done', cause: 'queue' }).look.label, 'Autopilot re-dispatched it with what the merge queue found');
  assert.deepEqual(autopilotStepLook({ seq: 5, at, task: 'GH-73', step: 'queue', outcome: 'failed', reason: stuck }).look, { label: 'Autopilot couldn\'t take it through the merge queue', icon: 'warning', tone: 'orange' });
  // A refresh without the queue still says it's reviewed next (D-058).
  assert.match(autopilotStepLook({ ...merged, queue: undefined }).detail!, /reviewed next, then landed/);

  // D-044's notice of its move to rework keeps quiet when the queue's own said it.
  const row = (state: string): Row => ({ id: 'GH-73', title: 'Task GH-73', state, display: state as Row['display'], environment: 'main', deps: [], source: { kind: 'github', url: null } });
  const news = taskNotices([row('review')], [row('rework')]);
  assert.equal(news.length, 1);
  assert.deepEqual(withoutAutopilotEcho(news, [conflict]), []);
});

test('the autopilot switch says on or off with an icon and the words, and its tooltip says what it does (D-064)', async () => {
  const { autopilotStatus } = await import('../src/logic/autopilot.ts');
  const on = autopilotStatus({ project: 'Tool', many: false, state: 'on', last: '✓ GH-31  Opened pull request #40.' });
  assert.equal(on.text, '$(rocket) Autopilot: on');
  assert.match(on.tooltip, /^Autopilot is on for Tool: it reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, merges the base into a pull request that conflicts with it, and starts a task a person dispatched once the files it waits for are free\. It never merges a pull request\./);
  assert.match(on.tooltip, /Last: ✓ GH-31 {2}Opened pull request #40\./);
  assert.match(on.tooltip, /Click to turn it off until VSCode closes\.$/);
  assert.doesNotMatch(autopilotStatus({ project: 'Tool', many: false, state: 'on' }).tooltip, /Last:/, 'nothing printed yet');

  const off = autopilotStatus({ project: 'Tool', many: false, state: 'off' });
  assert.equal(off.text, '$(debug-pause) Autopilot: off');
  assert.match(off.tooltip, /^Autopilot is off for Tool\. When it's on, it reviews[^]*starts a task a person dispatched once the files it waits for are free\. It never merges a pull request\.\n\nClick to turn it on until VSCode closes\.$/);

  const elsewhere = autopilotStatus({ project: 'Tool', many: false, state: 'elsewhere', pid: 4242 });
  assert.equal(elsewhere.text, '$(rocket) Autopilot: on elsewhere');
  assert.match(elsewhere.tooltip, /in another window or a terminal \(pid 4242\)/);
  assert.match(elsewhere.tooltip, /Stop it there to run it in this window\.$/);

  // It can't run: acc's own words say why.
  const { autopilotMode } = await import('../../packages/core/src/autopilot.ts');
  const refusal = autopilotMode({ autonomy: 'dispatch' }).refusal!;
  assert.match(refusal, /^autonomy "dispatch" \(autopilot also starting Ready tasks\) is not built yet\. Set "autonomy" to "review" in \.acc\/config\.json: autopilot then reviews finished work, [^]*, and starts a task a person dispatched once the files it waits for are free\.$/);
  const refused = autopilotStatus({ project: 'Tool', many: false, state: 'refused', refusal });
  assert.equal(refused.text, '$(circle-slash) Autopilot: off');
  assert.equal(refused.tooltip, `Autopilot can't run for Tool: ${refusal}`);
  const noGithub = autopilotStatus({ project: 'Tool', many: false, state: 'refused', refusal: 'Autopilot lands reviewed work as pull requests on GitHub, and this project has no "github" section in .acc/config.json.' });
  assert.match(noGithub.tooltip, /no "github" section/);

  // Several repos: each switch names its project.
  assert.equal(autopilotStatus({ project: 'Tool', many: true, state: 'on' }).text, '$(rocket) Autopilot: on · Tool');
  assert.equal(autopilotStatus({ project: 'Site', many: true, state: 'off' }).text, '$(debug-pause) Autopilot: off · Site');
  for (const state of ['on', 'off', 'elsewhere', 'refused'] as const) {
    const t = autopilotStatus({ project: 'Tool', many: false, state, pid: 1, refusal: 'x' }).text;
    assert.match(t, /^\$\([a-z-]+\) Autopilot: (on|off)/, `${state}: an icon and the words`);
  }
});

test('a pull request autopilot merged is a notice and a History item; one it couldn\'t merge needs you, and the switch says it merges (GH-67)', async () => {
  const { autopilotNotices, autopilotStatus } = await import('../src/logic/autopilot.ts');
  const { noticeActions } = await import('../src/logic/notices.ts');
  const { autopilotLook } = await import('../src/model/cards.ts');
  const { autopilotStepLook } = await import('../src/model/history.ts');
  type Rec = import('../../packages/core/src/autopilot-log.ts').AutopilotRecord;
  const at = '2026-10-06T12:00:00.000Z';
  const say = (r: Rec) => autopilotNotices([r], [{ id: 'GH-67', source: { kind: 'github', key: '67' }, history: [] }]).map((n) => [n.text, n.urgent, noticeActions(n)]);
  const pr = ['Open pull request', 'acc.task.openPr'];
  const show = ['Show', 'acc.task.show'];
  const merged: Rec = { seq: 5, at, task: 'GH-67', step: 'merge', outcome: 'done', pr: { number: 72, url: 'https://github.com/acme/tool/pull/72', opened: false } };
  assert.deepEqual(say(merged), [['Autopilot merged pull request #72 (GH-67).', false, [pr, show]]]);
  const reason = 'It changes .acc/, which a person merges: .acc/config.json.';
  const failed: Rec = { seq: 6, at, task: 'GH-67', step: 'merge', outcome: 'failed', reason };
  assert.deepEqual(say(failed), [[`Autopilot couldn't merge GH-67: ${reason}`, true, [pr, show]]]);

  // History: what it merged, with its link; and what it couldn't, in orange with a warning icon.
  assert.deepEqual(autopilotStepLook(merged), { look: { label: 'Autopilot merged pull request #72', icon: 'git-merge', tone: 'blue' }, detail: 'acc sync moves it to done.', url: 'https://github.com/acme/tool/pull/72' });
  assert.deepEqual(autopilotStepLook(failed), { look: { label: 'Autopilot couldn\'t merge it', icon: 'warning', tone: 'orange' }, detail: reason, url: null });
  // The card: Needs you, with the bell.
  assert.deepEqual(autopilotLook({ autopilot: { step: 'merge', reason } }), { label: `Needs you: autopilot couldn't merge it: ${reason}`, icon: 'bell', tone: 'orange' });
  assert.deepEqual(autopilotLook({ autopilot: { step: 'merge', reason } }, false)?.label, 'Needs you: autopilot couldn\'t merge it');

  // With auto-merge on, the switch's tooltip says how it merges, in turn through a merge queue (GH-73), and no longer that it never does.
  const on = autopilotStatus({ project: 'Tool', many: false, state: 'on', autoMerge: true });
  assert.match(on.tooltip, /Auto-merge is on: a pull request whose review and checks passed, with nothing waiting on a person, joins the repo's merge queue, and they merge in turn\. At its turn its base is merged in, the full check runs once, and it merges once GitHub says it can, or goes back to its builder\. It never merges into a protected environment\./);
  assert.doesNotMatch(on.tooltip, /It never merges a pull request/);
  assert.match(autopilotStatus({ project: 'Tool', many: false, state: 'off', autoMerge: false }).tooltip, /It never merges a pull request\./);
});
