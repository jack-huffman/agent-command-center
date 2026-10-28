// The Overview as a landing page (GH-160): one line per item, things of a kind collapsed into one line,
// Needs you's first three with Show all, a card for each other list (T-36), and every action the Overview
// had still a click or a menu away.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { HubLike, Ref } from '../src/model/shared.ts';
import { type HomeModel, homeModel } from '../src/model/home.ts';
import { CAP, CARD_ORDER, cardLine, checksFact, type Detail, landing, type LandingGroup, type LandingRow, overviewCards, type RowDo, TASK_MENU } from '../src/model/landing.ts';
import { needsYouCount, type OverviewModel } from '../src/model/overview.ts';
import { cardActions } from '../src/model/cards.ts';
import { pickStop } from '../src/progress.ts';
import { sampleLandingHub } from '../scripts/fixtures/landing.ts';
import { sampleQueueHub } from '../scripts/fixtures/overview.ts';
import { sampleHub } from '../scripts/fixtures/hub.ts';
import { sampleBoards } from '../scripts/fixtures/boards.ts';
import { sampleIdentity } from '../scripts/fixtures/environments.ts';
import { sampleSetup } from '../scripts/fixtures/setup.ts';
import { sampleEdited } from '../scripts/fixtures/updates.ts';
import { manifest, menuFor, root } from './support.ts';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const busy = (hub: HubLike = sampleLandingHub(NOW)): HomeModel => homeModel({ hub, section: 'overview', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: [], edited: sampleEdited, autopilot: () => 'on', now: NOW });
const group = (m: HomeModel, key: LandingGroup['key']): LandingGroup => m.overview.landing.find((g) => g.key === key)!;
const every = (g: LandingGroup): LandingRow[] => g.all;

test('suggested rules and update drafts each collapse into one line, with how many; questions come first (GH-160)', () => {
  const m = busy();
  const needs = every(group(m, 'needs-you'));
  const moment = every(group(m, 'moment'));
  const rules = moment.filter((r) => r.key === 'rules');
  assert.equal(rules.length, 1, 'ten rules, one line');
  assert.deepEqual([rules[0]!.title, rules[0]!.look.label, rules[0]!.action?.label, rules[0]!.action?.do], ['10 suggested rules, from repeated review findings', 'Rules suggested', 'Review', { kind: 'detail', detail: { kind: 'rules' } }]);
  assert.ok(!moment.some((r) => r.key.startsWith('rule:')) && !needs.some((r) => r.key.startsWith('rule:')), 'no rule has a line of its own');
  const drafts = needs.filter((r) => r.key === 'updates');
  assert.deepEqual(drafts.map((r) => [r.title, r.facts.map((f) => f.text), r.look.tone, r.action?.do]), [['2 update drafts waiting to post', ['ACME-10, ACME-12'], 'orange', { kind: 'detail', detail: { kind: 'updates' } }]]);
  assert.ok(!needs.some((r) => r.key.startsWith('u:')), 'no draft has a line of its own');
  // Three questions first, then the drafts: the questions are the three Needs you shows.
  assert.deepEqual(needs.slice(0, 4).map((r) => r.key), ['q:m1-aaaa0001', 'q:m1-aaaa0002', 'q:m1-aaaa0003', 'updates']);
  assert.equal(group(m, 'needs-you').count, m.overview.questions.length + m.overview.attention.filter((a) => a.look.tone === 'orange').length, 'the heading counts each thing, though drafts share a line');
  // One draft is still a line of its own kind; drafts only posting wait on nobody.
  const one = busy({ ...sampleLandingHub(NOW), updates: () => sampleLandingHub(NOW).updates!('').slice(0, 1) });
  assert.equal(every(group(one, 'needs-you')).find((r) => r.key === 'updates')?.title, '1 update draft waiting to post');
});

test('Needs you shows three lines and Show all; every other list shows none on the page, and holds every line for its card (T-36)', () => {
  const m = busy();
  assert.equal(CAP, 3);
  const needs = group(m, 'needs-you');
  assert.deepEqual([needs.shows, needs.rows.length, needs.more?.label], [3, 3, `Show all ${needs.total}`]);
  assert.ok(needs.total > CAP && needs.all.length === needs.total, 'every line, for the list in the modal');
  assert.deepEqual(needs.more?.do, { kind: 'detail', detail: { kind: 'list', group: 'needs-you' } });
  assert.deepEqual(needs.rows, needs.all.slice(0, CAP));
  for (const g of m.overview.landing.filter((x) => x.key !== 'needs-you')) {
    assert.deepEqual([g.shows, g.rows, g.more, g.all.length], [0, [], null, g.total], `${g.key}: a card, with every line`);
    assert.deepEqual(g.opens, g.key === 'history' ? { kind: 'history' } : { kind: 'list', group: g.key }, g.key);
  }
  // Ready and In progress hold every line now, not their first five; History every item, which its detail draws in full.
  assert.deepEqual([group(m, 'ready').total, group(m, 'progress').total, group(m, 'history').total, group(m, 'history').all.length], [6, 9, 13, m.overview.history.items.length], 'ACME-47\'s cloud review is in progress too (T-86), and ACME-48 and ACME-50, which acc can\'t see (T-92)');
  // Three or fewer in Needs you: no Show all. With nothing in it, its empty line says so.
  const few = landing({ ...m.overview, questions: m.overview.questions.slice(0, 2), attention: [] }, NOW).find((g) => g.key === 'needs-you')!;
  assert.deepEqual([few.rows.length, few.total, few.more], [2, 2, null]);
  const none = landing({ ...m.overview, questions: [], attention: [] }, NOW).find((g) => g.key === 'needs-you')!;
  assert.deepEqual([none.rows, none.more, none.title, none.empty], [[], null, 'All clear', 'No agent is waiting, nothing is blocked, and setup is done.']);
  const quiet = busy({ ...sampleLandingHub(NOW), history: () => [], edits: () => [], autopilotLog: () => [], answers: [] });
  assert.deepEqual([group(quiet, 'history').total, group(quiet, 'history').more, group(quiet, 'history').empty], [0, null, 'What agents and tasks do shows up here.']);
  // Each line says two facts at most.
  for (const g of m.overview.landing) for (const r of every(g)) assert.ok(r.facts.length <= 2 && r.facts.every((f) => f.text.trim()), `${g.key} ${r.key}`);
});

test('each line opens its detail with the actions it had before (GH-160)', () => {
  const m = busy();
  const needs = every(group(m, 'needs-you'));
  // A question: the question on the line, Answer, which opens it with its answers.
  const q = needs.find((r) => r.key === 'q:m1-aaaa0002')!;
  assert.deepEqual([q.id, q.title, q.look.label, q.look.tone, q.action?.label, q.action?.do], ['ACME-12', 'Premium cases escalate after how long without a reply?', 'Asks a question', 'orange', 'Answer', { kind: 'detail', detail: { kind: 'question', id: 'm1-aaaa0002' } }]);
  // An analysis's questions: Answer opens the task over the page on its Plan tab (T-134), where its analysis asks them.
  const an = needs.find((r) => r.id === 'ACME-21')!;
  assert.deepEqual([an.action?.label, an.action?.do, an.open], ['Answer', { kind: 'task', project: m.overview.projects[0]!.root, key: 'ACME-21', part: 'plan' }, { kind: 'task', project: m.overview.projects[0]!.root, key: 'ACME-21' }]);
  // A task waiting on you: its next step on the line, the rest in ⋯, the task on a click.
  const stopped = busy({ ...sampleLandingHub(NOW), questions: [], taskRows: () => [{ ...sampleLandingHub(NOW).taskRows('').find((r) => r.id === 'ACME-13')!, display: 'needs-you', stopped: { said: 'API Error' } }] });
  const s = every(group(stopped, 'needs-you')).find((r) => r.id === 'ACME-13')!;
  assert.deepEqual([s.look.label, s.action?.label, s.menu?.section, s.menu?.flags], ['Its agent stopped', 'Resume', 'task', { taskWatch: true }]);
  // A task in progress: what it's doing, how long, its checks as one fact; Watch, Open in Claude Code and Stop in ⋯.
  const p = every(group(m, 'progress'));
  const acme13 = p.find((r) => r.id === 'ACME-13')!;
  assert.deepEqual([acme13.look.label, acme13.facts.map((f) => f.text), acme13.action?.label, acme13.open?.kind], ['Working', ['14 min', '2 checks, 1 waiting'], 'Watch', 'task']);
  assert.deepEqual(acme13.menu?.flags, { taskWatch: true, taskClaude: true, taskStop: true });
  assert.deepEqual(JSON.parse(acme13.menu!.ref.stops!).map((x: { label: string }) => x.label), ['Builder: Stop']);
  assert.deepEqual(p.map((r) => r.facts[1]?.text).sort(), ['2 checks, 1 waiting', 'Claude Code\'s background sessions aren\'t answering, and this builder hasn\'t written to its conversation for longer than the quiet limit', 'Claude Code\'s background sessions aren\'t answering, so the Command Center can\'t see this builder', 'near-tests running', 'reading the branch on GitHub; its verdict comes back by a push, which the next sync takes', 'tests running', 'validate running', 'validate running', 'validate running'], 'each task\'s checks, one fact each; a cloud review\'s (T-86) is what it does, and a builder acc can\'t see says why (T-92)');
  // Asking, a builder's line answers: its question opens here.
  assert.deepEqual(p.find((r) => r.id === 'ACME-12')?.action?.do, { kind: 'detail', detail: { kind: 'question', id: 'm1-aaaa0002' } });
  // Ready, the merge queue and History open their task; an answer in History opens History at it.
  const ready = every(group(m, 'ready'))[0]!;
  assert.deepEqual([ready.look.label, ready.action?.label, ready.open?.kind], ['Ready', 'Build it', 'task']);
  const h = group(m, 'history').all;
  assert.ok(h.some((r) => r.open?.kind === 'task') && h.some((r) => r.open?.kind === 'detail'));
  const queued = every(group(busy(sampleQueueHub(NOW)), 'queue'));
  assert.deepEqual(queued.map((r) => [r.id, r.facts[0]?.text, r.action?.label, r.open?.kind]), [['GH-41', 'next to merge', '#141', 'task'], ['GH-44', '2nd in line', '#144', 'task'], ['GH-47', '3rd in line', '#147', 'task']]);
});

test('a task\'s checks read as one fact: one by name, several by number (GH-160)', () => {
  const job = (label: string, look: string) => ({ key: label, kind: 'check' as const, look: { label: look, icon: 'sync~spin', tone: 'blue' as const }, label: `Check: ${label}`, detail: '', since: '', actions: [] });
  assert.equal(checksFact({ jobs: [] }), null);
  assert.equal(checksFact({ jobs: [job('near-tests', 'Running')] }), 'near-tests running');
  assert.equal(checksFact({ jobs: [job('validate', '1st in line')] }), 'validate 1st in line');
  assert.equal(checksFact({ jobs: [job('a', 'Running'), job('b', 'Running')] }), '2 checks running');
  assert.equal(checksFact({ jobs: [job('a', '1st in line'), job('b', '2nd in line')] }), '2 checks waiting');
  assert.equal(checksFact({ jobs: [job('a', 'Running'), job('b', '2nd in line')] }), '2 checks, 1 waiting');
});

test('a task line\'s ⋯ menu is package.json\'s, flag for flag, and its Stop picks from the line\'s jobs (GH-160)', async () => {
  const items = (manifest.contributes.menus['webview/context'] as { command: string; when: string }[]).filter((i) => /webviewSection == 'task'/.test(i.when));
  assert.deepEqual(items.map((i) => [i.command, /&& (\w+)$/.exec(i.when)?.[1]]).sort(), Object.entries(TASK_MENU).sort(), 'each command behind its flag');
  for (const [command, flag] of Object.entries(TASK_MENU)) assert.deepEqual(menuFor('acc.home', { webviewSection: 'task', [flag]: true }), [command]);
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'tidy' }), ['acc.tidy.skip']);
  assert.ok(menuFor('acc.home', { webviewSection: 'task', ...Object.fromEntries(Object.values(TASK_MENU).map((f) => [f, true])) }).at(-1) === 'acc.job.stop', 'Stop sits alone at the bottom');
  // The tidy-up and an agent waiting on you name their own menus.
  const m = busy();
  const all = m.overview.landing.flatMap(every);
  assert.deepEqual(all.find((r) => r.key.startsWith('tidy:'))?.menu, { section: 'tidy', ref: { project: m.overview.projects[0]!.root }, flags: {} });
  assert.ok(all.some((r) => r.menu?.section === 'agent' && 'agentBackground' in r.menu.flags));
  // Stop from the menu: one stop is that one, several are picked from, anything else is nothing.
  const one = JSON.stringify([{ label: 'Builder: Stop', tip: 'Pause it.', arg: '{"kind":"builder"}' }]);
  const two = JSON.stringify([{ label: 'Builder: Stop', tip: 'Pause it.', arg: 'a' }, { label: 'Your message: Stop', tip: 'End it.', arg: 'b' }]);
  const asked: string[][] = [];
  const vscode = { window: { showQuickPick: async (xs: { label: string }[]) => { asked.push(xs.map((x) => x.label)); return xs[1]; } } } as never;
  assert.equal(await pickStop(vscode, one), '{"kind":"builder"}');
  assert.equal(await pickStop(vscode, two), 'b');
  assert.deepEqual(asked, [['Builder: Stop', 'Your message: Stop']]);
  for (const junk of [undefined, '', 'x', '{}', '[1]', '[{"label":1}]']) assert.equal(await pickStop(vscode, junk), undefined, String(junk));
  // The commands take a line's context: Stop names its jobs, Output its project.
  const src = ['progress.ts', 'autopilot.ts'].map((f) => readFileSync(join(root, 'src', f), 'utf8')).join('\n');
  assert.match(src, /if \(isWebviewMenuContext\(raw\)\) raw = await pickStop\(vscode, raw\.accRef\.stops\);/);
  assert.match(src, /autopilot\.showOutput\(isWebviewMenuContext\(arg\) \? arg\.accRef\.project : arg\)/);
});

/** A ref as a string, whatever its keys' order. */
const refKey = (r: Ref): string => `${r.project ?? ''}|${r.task ?? ''}|${r.session ?? ''}`;

/** Every action the Overview offered before GH-160, as it drew them: by what each sent. */
function before(o: OverviewModel): string[] {
  const out: string[] = [];
  for (const q of o.questions) out.push(`answer ${q.id}`, `run acc.agent.watch ${refKey({ session: q.session })}`, `run acc.agent.openInClaude ${refKey({ session: q.session })}`);
  for (const a of o.attention) {
    for (const x of a.actions) out.push(`run ${x.command} ${refKey(x.ref)}`);
    if (a.extra) out.push(`toolbar ${a.extra.command} ${a.extra.arg}`);
    if (a.go) out.push(`go ${a.go.section}`);
    if (a.update) out.push(`update-post ${a.update.id}`, `update-discard ${a.update.id}`);
    if (a.rule) out.push(`rule-accept ${a.rule.id}`, `rule-dismiss ${a.rule.id}`, ...a.rule.sources.map((s) => `rule-open-review ${s.task}@${s.sha}`));
    // Ask on the ticket is for a question only the ticket's author can answer, not yet sent (T-97).
    for (const q of a.analysis?.questions ?? []) out.push(`analysis-answer ${a.analysis!.task}:${q.id}`, ...(a.analysis!.canAsk && q.askOf === 'author' && !q.client ? [`update-ask ${a.analysis!.task}:${q.id}`] : []));
  }
  for (const g of o.inProgress.groups) {
    for (const j of g.jobs) for (const x of j.actions) out.push(x.question ? `answer ${x.question}` : x.ref ? `run ${x.command} ${refKey(x.ref)}` : `toolbar ${x.command} ${x.arg}`);
    if (g.ref) out.push(`run acc.task.show ${refKey(g.ref)}`);
  }
  for (const r of o.ready) out.push(`run ${r.action.command} ${refKey(r.action.ref)}`, `run acc.task.show ${refKey(r.action.ref)}`);
  for (const q of o.queue) for (const r of q.rows) out.push(`run acc.task.show ${refKey(r.ref)}`, ...(r.pr ? [`link ${r.pr.url}`] : []));
  for (const h of o.history.items) {
    if (h.kind === 'answer') out.push(`run acc.agent.watch ${refKey({ session: h.session })}`);
    if (h.kind === 'autopilot' && h.url) out.push(`link ${h.url}`);
  }
  return [...new Set(out)];
}

/**
 * Every action the landing page offers now: each line's button and click, its ⋯ menu as package.json builds
 * it, and what the detail it opens holds, as the page draws it (detail.ts, task-modal.ts).
 */
function after(m: HomeModel, hub: HubLike): Set<string> {
  const o = m.overview;
  const out = new Set<string>();
  const seen = new Set<string>();
  const detail = (d: Detail): void => {
    switch (d.kind) {
      case 'question': {
        const q = o.questions.find((x) => x.id === d.id)!;
        for (const s of [`answer ${q.id}`, `run acc.agent.watch ${refKey({ session: q.session })}`, `run acc.agent.openInClaude ${refKey({ session: q.session })}`]) out.add(s);
        return;
      }
      case 'rules':
        for (const a of o.attention) if (a.rule) for (const s of [`rule-accept ${a.rule.id}`, `rule-dismiss ${a.rule.id}`, ...a.rule.sources.map((x) => `rule-open-review ${x.task}@${x.sha}`)]) out.add(s);
        return;
      case 'updates':
        for (const a of o.attention) {
          if (!a.update) continue;
          for (const s of [`update-post ${a.update.id}`, `update-discard ${a.update.id}`, ...a.actions.map((x) => `run ${x.command} ${refKey(x.ref)}`), ...(a.extra ? [`toolbar ${a.extra.command} ${a.extra.arg}`] : [])]) out.add(s);
        }
        return;
      case 'list':
        for (const r of every(o.landing.find((g) => g.key === d.group)!)) line(r);
        return;
      case 'history':
        for (const h of o.history.items) {
          if (h.kind === 'answer') out.add(`run acc.agent.watch ${refKey({ session: h.session })}`);
          if (h.kind === 'autopilot' && h.url) out.add(`link ${h.url}`);
        }
    }
  };
  const does = (x: RowDo): void => {
    if (x.kind === 'run') out.add(`run ${x.command} ${refKey(x.ref)}`);
    else if (x.kind === 'toolbar') out.add(`toolbar ${x.command} ${x.arg}`);
    else if (x.kind === 'link') out.add(`link ${x.url}`);
    else if (x.kind === 'go') {
      out.add(`go ${x.section}`);
      // Tasks is the whole board: each task's card, with its actions, opening its page (D-129).
      if (x.section === 'tasks') for (const p of hub.projects) for (const r of hub.taskRows(p.root)) does({ kind: 'task', project: p.root, key: r.id });
    } else if (x.kind === 'detail') detail(x.detail);
    else {
      // The task over the page: its page's actions, Open as tab, and its analysis's questions.
      const ref = { project: x.project, task: x.key };
      out.add(`run acc.task.show ${refKey(ref)}`);
      const row = hub.taskRows(x.project).find((r) => r.id === x.key);
      for (const a of row ? cardActions(row, ref) : []) out.add(`run ${a.command} ${refKey(a.ref)}`);
      const asked = o.attention.find((a) => a.analysis?.task === x.key)?.analysis;
      for (const q of asked?.questions ?? []) { out.add(`analysis-answer ${x.key}:${q.id}`); if (asked!.canAsk && q.askOf === 'author' && !q.client) out.add(`update-ask ${x.key}:${q.id}`); }
    }
  };
  const line = (r: LandingRow): void => {
    if (seen.has(r.key)) return;
    seen.add(r.key);
    if (r.action) does(r.action.do);
    if (r.open) does(r.open);
    if (!r.menu) return;
    for (const command of menuFor('acc.home', { webviewSection: r.menu.section, ...r.menu.flags })) {
      if (command === 'acc.job.stop') for (const s of JSON.parse(r.menu.ref.stops ?? '[]') as { arg: string }[]) out.add(`toolbar acc.job.stop ${s.arg}`);
      else if (command === 'acc.autopilot.output') out.add(`toolbar acc.autopilot.output ${r.menu.ref.project}`);
      else out.add(`run ${command} ${refKey(r.menu.ref)}`);
    }
  };
  // What the page draws: Needs you's lines and Show all, and a card for each other list, which opens it (T-36).
  for (const r of group(m, 'needs-you').rows) line(r);
  const needs = group(m, 'needs-you').more;
  if (needs) does(needs.do);
  for (const c of o.cards) does({ kind: 'detail', detail: c.opens });
  return out;
}

test('nothing is lost: every action the Overview offered is still a line\'s button, its ⋯ menu or the detail it opens (GH-160)', (t) => {
  let checked = 0;
  for (const [name, hub] of [['the busy Overview', sampleLandingHub(NOW)], ['the sample project', sampleHub(NOW)], ['a merge queue', sampleQueueHub(NOW)]] as const) {
    const m = busy(hub);
    const was = before(m.overview);
    const now = after(m, hub);
    assert.deepEqual(was.filter((a) => !now.has(a)), [], `${name}: offered before, and nowhere now`);
    checked += was.length;
  }
  t.diagnostic(`checked ${checked} actions`);
  assert.ok(checked >= 210, `checked ${checked} actions`);
  // Each kind the Overview had is among them, so the check can't pass by looking at nothing.
  const kinds = new Set(before(busy().overview).map((a) => a.split(' ')[0]));
  // A question for the ticket's author keeps Ask on the ticket on the Overview's question card, as Send to the client was before (T-97).
  for (const k of ['answer', 'run', 'toolbar', 'go', 'update-post', 'update-discard', 'rule-accept', 'rule-dismiss', 'rule-open-review', 'analysis-answer', 'update-ask', 'link']) assert.ok(kinds.has(k), k);
  const asks = busy().overview.attention.flatMap((a) => (a.analysis ? a.analysis.questions.map((q) => [a.analysis!.task, q.id, q.askOf ?? 'you', a.analysis!.canAsk]) : []));
  assert.ok(asks.some(([, , who, can]) => who === 'author' && can), `a question for the author, to ask on its ticket: ${JSON.stringify(asks)}`);
  assert.ok(asks.some(([, , who]) => who === 'you'), 'and one for you, with its answer box');
});

test('the page draws each detail with the controls it had inline before (GH-160)', () => {
  const src = readFileSync(join(root, 'webview', 'detail.ts'), 'utf8');
  for (const call of ['questionCard(q, { watch: true })', 'ruleDetail(a.rule!)', 'ruleButtons(a.rule!)', 'overviewUpdateButtons(u, a.actions)', 'argButton(a.extra.command, a.extra.label, a.extra.icon, a.extra.arg, true)', 'u.edited ?? u.text', 'posterLine(u)', '...updateNotes(u)', 'renderHistory(o.history, o.projects.length > 1, d.at)', 'landingRows(rows, g.title)']) assert.ok(src.includes(call), call);
  // The Overview itself draws no detail inline: no question, rule, update text, analysis or list of checks.
  const overview = readFileSync(join(root, 'webview', 'overview.ts'), 'utf8') + readFileSync(join(root, 'webview', 'progress.ts'), 'utf8');
  for (const inline of ['questionCard', 'ruleDetail', 'analysisQuestion', 'updateNotes', 'foldable', 'pg-row']) assert.ok(!overview.includes(inline), `no ${inline} on the Overview`);
  // Answer, from Agents or a line, opens the question over the page.
  assert.match(readFileSync(join(root, 'webview', 'progress.ts'), 'utf8'), /export \{ answerHere \} from '\.\/detail\.ts';/);
});

test('every Overview row button is named by its label, so an icon-only button is never unnamed (GH-169)', () => {
  const dom = readFileSync(join(root, 'webview', 'landing.ts'), 'utf8');
  const css = readFileSync(join(root, 'webview', 'landing.css'), 'utf8');
  assert.ok(dom.includes('btn.title = b.tip ?? b.label'), 'the button keeps its label as its title (the screenshot run checks its aria-label on the drawn page, T-25)');
  assert.match(css, /@container \(max-width: \d+px\) \{[^}]*\.lp-btn-text \{ display: none; \}/, 'a narrow row hides the words');
  assert.match(css, /\.lp-row \{[^}]*container-type: inline-size/, 'the row is what the query measures');
  let checked = 0;
  for (const g of busy().overview.landing) for (const r of every(g)) {
    if (!r.action) continue;
    checked++;
    assert.ok(r.action.label.trim().length > 0, `${r.key}: its button has a label to be named by`);
    assert.ok(r.action.icon, `${r.key}: its button has an icon to show alone`);
  }
  assert.ok(checked > 0, 'checked no buttons');
});

test('only Needs you has primary buttons on the busy Overview; no other list, not even Ready\'s Dispatch lines, has one (D-147)', () => {
  const m = busy();
  const buttons = (key: LandingGroup['key']) => every(group(m, key)).flatMap((r) => (r.action ? [r.action] : []));
  const needs = buttons('needs-you');
  assert.ok(needs.length >= 1 && needs.every((b) => b.primary === true), 'each button in Needs you is primary, and there is one at least');
  const theirs = m.overview.landing.filter((g) => g.key !== 'needs-you').flatMap((g) => every(g).flatMap((r) => (r.action ? [{ g: g.key, label: r.action.label, primary: r.action.primary }] : [])));
  assert.ok(theirs.length > 5, `${theirs.length} buttons outside Needs you`);
  assert.deepEqual(theirs.filter((b) => b.primary !== false), [], 'each list but Needs you uses the outlined button');
  const ready = buttons('ready');
  assert.ok(ready.filter((b) => b.label === 'Build it').length >= 4 && ready.every((b) => b.primary === false), 'Ready\'s Dispatch buttons are outlined');
  // Show all's full list says the same as the five the page shows.
  const all = group(m, 'needs-you').all;
  assert.ok(all.length > CAP && all.every((r) => !r.action || r.action.primary));
  // The page draws primary from the model, and nothing else.
  assert.ok(readFileSync(join(root, 'webview', 'landing.ts'), 'utf8').includes('`btn lp-btn${b.primary ? \' primary\' : \'\'}`'));
});

test('every list the Overview had is on the page or one click away: Needs you\'s lines and Show all, and each other list\'s card opens all of it (T-36)', () => {
  let walked = 0;
  for (const [name, hub] of [['the busy Overview', sampleLandingHub(NOW)], ['a merge queue', sampleQueueHub(NOW)]] as const) {
    const m = busy(hub);
    const o = m.overview;
    for (const g of o.landing) {
      if (!g.all.length) continue;
      if (g.key === 'needs-you') {
        // On the page, or in the list Show all opens.
        const shown = new Set([...g.rows, ...(g.more?.do.kind === 'detail' && g.more.do.detail.kind === 'list' ? g.all : [])].map((r) => r.key));
        assert.deepEqual(g.all.filter((r) => !shown.has(r.key)).map((r) => r.key), [], `${name}: Needs you`);
        walked += g.all.length;
        continue;
      }
      const card = o.cards.find((c) => c.key === g.key);
      assert.ok(card, `${name}: ${g.key} has a card`);
      // What the card opens holds every line: the list's detail draws g.all, History's draws every item (detail.ts).
      if (card.opens.kind === 'history') assert.equal(o.history.items.length, g.all.length, `${name}: History in full`);
      else assert.deepEqual(card.opens, { kind: 'list', group: g.key }, `${name}: ${g.key}`);
      walked += g.all.length;
    }
  }
  assert.ok(walked >= 40, `walked ${walked} lines`);
  // Each list the busy Overview shows today is among them: none slipped through as empty.
  const lists = busy().overview.landing.filter((g) => g.all.length).map((g) => g.key);
  assert.deepEqual(lists, ['needs-you', 'moment', 'progress', 'ready', 'history']);
  assert.ok(busy(sampleQueueHub(NOW)).overview.cards.some((c) => c.key === 'queue'), 'the merge queue, when it holds something');
});

test('the model carries a card for each list but Needs you, in order, with its count and one line; an empty list has none (T-36)', () => {
  const o = busy().overview;
  assert.deepEqual(CARD_ORDER, ['progress', 'ready', 'moment', 'history', 'queue']);
  assert.deepEqual(o.cards.map((c) => [c.key, c.title, c.count]), [
    ['progress', 'In progress', group(busy(), 'progress').count], ['ready', 'Ready for an agent', 6], ['moment', 'When you have a moment', group(busy(), 'moment').count], ['history', 'History', 13],
  ]);
  assert.deepEqual(o.cards, overviewCards(o.landing), 'the model\'s cards are the host\'s overviewCards');
  for (const c of o.cards) assert.ok(c.line.trim() && c.count > 0, `${c.key}: a line and a count`);
  // The empty edge: no history, nothing ready, nothing running, no queue: no card for any of them.
  const quiet = busy({ ...sampleLandingHub(NOW), history: () => [], edits: () => [], autopilotLog: () => [], answers: [], taskRows: () => [], jobs: () => [] } as HubLike);
  const keys = quiet.overview.cards.map((c) => c.key);
  for (const k of ['ready', 'history', 'queue'] as const) assert.ok(!keys.includes(k), `no ${k} card: ${keys.join(', ')}`);
  for (const c of quiet.overview.cards) assert.ok(group(quiet, c.key).all.length > 0, `${c.key}: a card only with lines`);
  assert.deepEqual(overviewCards([]), [], 'no lists, no cards');
});

test('a card\'s line names its lines\' states, or what\'s first: each kind, and an empty list\'s (T-36)', () => {
  const row = (id: string | null, title: string, label: string, tone: 'orange' | 'blue' | 'neutral' = 'neutral', fact?: string): LandingRow => ({ key: title, look: { label, icon: 'circle', tone }, id, title, facts: fact ? [{ text: fact }] : [], action: null, menu: null, open: null, tip: null });
  const line = (key: LandingGroup['key'], all: LandingRow[]) => cardLine({ key, all });
  assert.equal(line('progress', [row('ACME-13', 'Login', 'Working', 'blue'), row('ACME-12', 'Sum', 'Asks a question', 'orange'), row('ACME-11', 'X', 'Stopped', 'orange')]), '1 asks a question, 1 stopped');
  assert.equal(line('progress', [row('ACME-12', 'Sum', 'Stopped', 'orange'), row('ACME-11', 'X', 'Stopped', 'orange'), row('ACME-13', 'Login', 'Working', 'blue')]), '2 stopped', 'lines in one state are counted together, in that state\'s words');
  assert.equal(line('progress', [row('ACME-12', 'Sum', 'Waiting on you', 'orange'), row('ACME-11', 'X', 'Failed', 'orange')]), '1 asking, 1 failed', 'a line labelled Waiting on you is an agent asking: the card doesn\'t claim the header\'s count');
  assert.equal(line('progress', [row('ACME-13', 'Login', 'Working', 'blue')]), 'ACME-13 working');
  assert.equal(line('progress', [row('ACME-12', 'Sum', 'Needs you', 'orange'), row('ACME-11', 'X', 'Stopped', 'orange')]), '1 stuck, 1 stopped', 'a finished job\'s Needs you line is stuck: the card never names the person');
  assert.equal(line('progress', [row('ACME-12', 'Sum', 'Needs you', 'neutral')]), 'ACME-12 stuck', 'nor does a card naming its first line');
  assert.equal(line('ready', [row('ACME-16', 'Export', 'Ready')]), 'ACME-16 next');
  assert.equal(line('queue', [row('GH-41', 'Fix', 'Checks running')]), 'GH-41 next to merge');
  assert.equal(line('history', [row('ACME-12', 'Sum', 'Done', 'neutral', '4 min ago')]), 'ACME-12, done, 4 min ago');
  assert.equal(line('history', [row(null, 'Run the checks', 'Passed')]), 'Run the checks, passed');
  assert.equal(line('moment', [row(null, '10 suggested rules, from repeated review findings', 'Rules suggested')]), '10 suggested rules, from repeated review findings');
  assert.equal(line('ready', []), '', 'an empty list has no line, and no card');
});

test('where the header says all is clear, no card says that something waits on the person: the edge case of stopped work with nothing needing you (T-37)', () => {
  const m = busy();
  const o = { ...m.overview, questions: [], attention: [] };
  assert.equal(needsYouCount(o), 0, 'the header says all is clear');
  const lists = landing(o, NOW);
  const cards = overviewCards(lists);
  const progress = lists.find((g) => g.key === 'progress')!;
  assert.ok(progress.all.some((r) => r.look.tone === 'orange'), 'the sample has lines that stopped or ask something');
  assert.ok(cards.length >= 3, `${cards.length} cards checked`);
  for (const c of cards) assert.doesNotMatch(c.line, c.key === 'history' ? /needs you|waiting (?:on|for) you|waits on you/i : /\byou\b/i, `${c.key}: ${c.line}`);
  assert.match(cards.find((c) => c.key === 'progress')!.line, /^\d+ [a-z ]+(, \d+ [a-z ]+)*$/, 'In progress names the lines\' own states');
});

test('the Overview\'s header has one button, Add task, and a ⋯ menu that reaches what its buttons did; each card is named with its count (T-36)', () => {
  const page = readFileSync(join(root, 'webview', 'overview.ts'), 'utf8');
  // The menu's items, each with its name and icon, as the header's buttons had them.
  assert.match(page, /\{ command: 'acc\.agent\.new', label: 'Start an agent', icon: 'hubot' \}/);
  assert.match(page, /\{ command: 'acc\.trackers\.add', label: 'Add a tracker', icon: 'plug' \}/);
  assert.match(page, /\{ command: 'refresh', label: 'Refresh', icon: 'refresh' \}/);
  assert.ok(page.includes('export const HEADER_MENU = ['), 'HEADER_MENU');
  // Start an agent and Add a tracker go as toolbar messages on the project, as toolbarButton sent them; Refresh as Refresh did.
  assert.ok(page.includes("(a.command === 'refresh' ? refreshPage() : api.postMessage({ type: 'toolbar', command: a.command, project: root }))"));
  assert.equal((page.match(/toolbarButton\(/g) ?? []).length, 2, 'Add task, or Onboard this project where there is none');
  assert.ok(page.includes('pageHeader(\'Overview\', summary, ...tools)'), 'the header without the Refresh button header() adds');
  const dom = readFileSync(join(root, 'webview', 'dom.ts'), 'utf8');
  assert.ok(dom.includes("export const refreshPage = (): void => api.postMessage({ type: 'refresh' });") && dom.includes('return pageHeader(title, summary, ...tools, refreshButton());'));
  // Both commands are ones the extension runs from the page.
  for (const c of ['acc.agent.new', 'acc.trackers.add']) assert.ok(manifest.contributes.commands.some((x: { command: string }) => x.command === c), c);
  // A card's accessible name holds its count; the behaviour run reads it on the drawn page.
  const cards = readFileSync(join(root, 'webview', 'landing.ts'), 'utf8');
  assert.ok(cards.includes("b.setAttribute('aria-label', `${c.title}, ${c.count}: ${c.line}`);"), 'landingCard names it with its count');
  // In progress's machine line heads its detail, not the page.
  assert.ok(readFileSync(join(root, 'webview', 'detail.ts'), 'utf8').includes("const top = d.group === 'progress' ? machineLine(o.inProgress) : null;"));
});
