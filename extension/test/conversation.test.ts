// A plan's conversation in its own panel (T-111): where it opens, a plan made once at a time, the opening's
// model and its messages, the first message handing acc the ticket, and the panel and the task page's one line.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeAnalysis } from '../../packages/core/src/analyze.ts';
import { parseConfig, type Config } from '../../packages/core/src/config.ts';
import { run } from '../../packages/core/src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../../packages/core/src/ledger.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { OPENING_ASK } from '../../packages/core/src/plan-opening.ts';
import { addTurn } from '../../packages/core/src/plan-talk.ts';
import { GENERIC_CONFIG, makeRepo } from '../../packages/core/test/support.ts';
import { BESIDE_MIN, conversationPlace, PlansMaking, startArgs } from '../src/logic/conversation.ts';
import { Talks, waitsToBuild } from '../src/logic/talk.ts';
import { conversationModel, conversationTitle, QUOTE_MAX } from '../src/model/conversation.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { conversationWords, MAKING_WORDS, OPENING_NOTE, TALK_NOTE, ticketTalk } from '../src/model/talk.ts';
import { sampleAnalyses } from '../scripts/fixtures/analysis.ts';
import { sampleConversation, sampleConversationDiscuss, sampleConversationDrafting, sampleConversationReady, sampleConversationStart, sampleConversationTicket, sampleOpening } from '../scripts/fixtures/conversation.ts';
import { ROOT } from '../scripts/fixtures/shared.ts';
import { sampleTalkTicket } from '../scripts/fixtures/talk.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const REF = { project: '/r', task: 'ACME-21' };
const opening = (more: Partial<Parameters<typeof ticketTalk>[0]> = {}) =>
  ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: null, analyzing: false, talk: { v: 1, task: 'ACME-21', turns: [] }, running: false, open: [], ref: REF, ...more })!;

// ---------------------------------------------------------------- where it opens, and one plan at a time

test('the conversation opens beside a wide page, and as a tab of its own on a narrow one; edge case: a page that never said its width opens it beside', () => {
  assert.equal(BESIDE_MIN, 900);
  assert.equal(conversationPlace(1400), 'beside');
  assert.equal(conversationPlace(BESIDE_MIN), 'beside');
  assert.equal(conversationPlace(BESIDE_MIN - 1), 'tab');
  assert.equal(conversationPlace(500), 'tab');
  assert.equal(conversationPlace(null), 'beside');
  assert.equal(conversationPlace(undefined), 'beside');
  assert.equal(conversationPlace(0), 'beside', 'a page not laid out yet says 0');
  assert.equal(conversationTitle('ACME-21'), 'Discuss ACME-21');
});

test('edge case: a second Make a plan while one is under way is ignored; the ticket is read, then the plan made, and each change redraws', () => {
  const told: string[] = [];
  const making = new PlansMaking((root, id) => told.push(`${root}#${id}`));
  assert.equal(making.of('/r', 'ACME-21'), null, 'before the first');
  assert.equal(making.begin('/r', 'acme-21'), true);
  assert.equal(making.of('/r', 'ACME-21'), 'reading', 'the ticket is read first');
  assert.equal(making.begin('/r', 'ACME-21'), false, 'a second click is ignored');
  assert.equal(making.begin('/other', 'ACME-21'), true, 'another project\'s task is its own');
  making.planning('/r', 'ACME-21');
  assert.equal(making.of('/r', 'ACME-21'), 'planning');
  making.end('/r', 'ACME-21');
  assert.equal(making.of('/r', 'ACME-21'), null);
  assert.equal(making.begin('/r', 'ACME-21'), true, 'once ended, it can start again');
  const before = told.length;
  making.planning('/x', 'T-1');
  making.end('/x', 'T-1');
  assert.equal(told.length, before, 'one never begun changes nothing and redraws nothing');
  assert.equal(told.length, 5, 'two begun, one planned, one ended, one begun again');
});

test('acc\'s arguments for a message before the plan keep its words as words, with the ticket\'s file when there is one', () => {
  assert.deepEqual(startArgs('ACME-21', '--not a flag'), ['plan', 'start', 'ACME-21', '--message=--not a flag', '--json']);
  assert.deepEqual(startArgs('ACME-21', 'Two years.', '/tmp/t/ticket.json'), ['plan', 'start', 'ACME-21', '--message=Two years.', '--ticket', '/tmp/t/ticket.json', '--json']);
});

// ---------------------------------------------------------------- the opening's model and its messages

test('before a plan, the conversation asks its question; Draft the plan is off until something is said, and Skip to the plan is on', () => {
  const s = opening();
  assert.deepEqual([s.stage, s.ask, s.note, s.turns, s.line], ['opening', OPENING_ASK, OPENING_NOTE, [], null]);
  assert.deepEqual([s.draft, s.skip, s.send], [{ disabled: 'Say what you\'re thinking first, or skip to the plan.' }, { disabled: null }, { disabled: null }]);
  assert.deepEqual([s.newPlan, s.claude, s.making], [null, null, null], 'Make a new plan and Open in Claude Code need a plan');
  const said = opening({ talk: sampleOpening(NOW) });
  assert.equal(said.ask, null, 'once something is said, the question has been answered');
  assert.deepEqual(said.draft, { disabled: null });
  assert.deepEqual(said.turns.map((t) => [t.who, t.before]), [['you', true], ['agent', true], ['you', true]]);
  assert.equal(said.questions, null, 'the person answered the agent\'s questions, so none wait');
  assert.deepEqual(said.line, { words: 'Conversation · 3 messages', at: sampleOpening(NOW).turns[2]!.at });
});

test('edge cases: a reply on its way or a plan being made turns Draft, Skip and Send off with why; the making says what is under way; past the build with no plan it is the ticket\'s conversation', () => {
  const busy = opening({ talk: sampleOpening(NOW), running: true });
  assert.deepEqual([busy.draft?.disabled, busy.skip?.disabled, busy.send?.disabled], Array(3).fill('Wait for the planning agent\'s reply.'));
  const reading = opening({ talk: sampleOpening(NOW), making: 'reading' });
  assert.deepEqual(reading.making, { phase: 'reading', words: MAKING_WORDS.reading });
  assert.equal(reading.draft?.disabled, 'Its plan is being made. Wait for it to finish.');
  assert.equal(opening({ analyzing: true }).making?.phase, 'planning', 'acc making it, from any window');
  // Past the build with no plan, it is the ticket's own conversation (T-169): no question first, and no plan to make.
  const running = opening({ task: { id: 'ACME-21', state: 'running' } });
  assert.deepEqual([running.stage, running.ask, running.note, running.send, running.claude], ['plan', null, TALK_NOTE, { disabled: null }, { disabled: null }]);
  const built = opening({ task: { id: 'ACME-21', state: 'done' }, talk: sampleOpening(NOW) });
  assert.deepEqual([built.send, built.draft, built.skip], [{ disabled: null }, null, null], 'what was said stays, and the ticket can still be discussed');
  assert.equal(conversationWords(1), 'Conversation · 1 message');
  // With a plan: Talk it through, its line counts every message but the plan's own.
  const talked = sampleTalkTicket(NOW, true).talk!;
  assert.deepEqual([talked.stage, talked.ask, talked.draft, talked.skip, talked.line?.words], ['plan', null, null, null, 'Conversation · 4 messages']);
});

test('the panel\'s model: its title, the task\'s, and the conversation the task page draws its line from', () => {
  const m = conversationModel({ project: '/r', key: 'ACME-21', taskTitle: 'Contact roles', talk: opening() });
  assert.deepEqual([m.kind, m.title, m.taskTitle, m.talk?.stage], ['conversation', 'Discuss ACME-21', 'Contact roles', 'opening']);
  assert.equal(sampleConversationTicket(NOW).talk?.line?.words, sampleConversationReady(NOW).talk?.line?.words, 'the page and the panel agree');
});

test('the page may ask to open the conversation, quoting a part of the plan, to draft or skip, and say its width; edge case: a bad quote, skip or width is refused', () => {
  const ok = (m: Record<string, unknown>) => isFromWebview(m);
  assert.ok(ok({ type: 'conversation-open', project: '/r', task: 'ACME-21' }));
  assert.ok(ok({ type: 'conversation-open', project: '/r', task: 'ACME-21', about: { ref: 'd1.a', text: 'Where: In the handler' } }));
  assert.ok(!ok({ type: 'conversation-open', project: '/r', task: 'ACME-21', about: { ref: 'nope', text: 'x' } }));
  assert.ok(!ok({ type: 'conversation-open', project: '/r', task: 'ACME-21', about: { ref: 'd1', text: 'x'.repeat(QUOTE_MAX + 1) } }));
  assert.ok(!ok({ type: 'conversation-open', project: '/r', task: 'not a key' }));
  assert.ok(ok({ type: 'conversation-draft', project: '/r', task: 'ACME-21' }));
  assert.ok(ok({ type: 'conversation-draft', project: '/r', task: 'ACME-21', skip: true }));
  assert.ok(!ok({ type: 'conversation-draft', project: '/r', task: 'ACME-21', skip: false }));
  assert.ok(ok({ type: 'page-width', project: '/r', task: 'ACME-21', width: 1200 }));
  assert.ok(!ok({ type: 'page-width', project: '/r', task: 'ACME-21', width: -1 }));
  assert.ok(!ok({ type: 'page-width', project: '/r', task: 'ACME-21', width: Number.NaN }));
  assert.ok(!ok({ type: 'page-width', project: '/r', task: 'ACME-21', width: '900' }));
});

// ---------------------------------------------------------------- the first message hands acc the ticket

function noPlanRepo() {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, () => new Date(NOW), (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-21' }, title: 'Contact roles missing on converted leads', brief: 'Converting a lead drops its contact roles.' }], 'human', 'human:test', emit, () => new Date(NOW));
  });
  return { dir, paths, id: readLedger(paths.ledger).tasks[0]!.id };
}

test('before a plan, a message starts it: the first hands acc the whole ticket and removes its file after; a later one resumes without it; once there is a plan, it talks', async () => {
  const { dir, paths, id } = noPlanRepo();
  const asked: { args: string[]; label?: string }[] = [];
  const read: string[] = [];
  let removed = 0;
  const talks = new Talks({
    paths: () => paths,
    acc: async (args, _cwd, label) => { asked.push({ args, label }); return { code: 0, stdout: '{}', stderr: '' }; },
    launch: () => {},
    ticket: async (_root, task) => { read.push(task); return { file: '/tmp/x/ticket.json', remove: () => { removed++; } }; },
  });
  assert.deepEqual(await talks.send(dir, id, 'Two years.'), { ok: true });
  assert.deepEqual(asked[0], { args: startArgs(id, 'Two years.', '/tmp/x/ticket.json'), label: `Start ${id}'s plan with a conversation` });
  assert.deepEqual([read, removed], [[id], 1], 'read once, removed once acc ended');
  // The agent answered: the next message resumes its session, which holds the ticket already.
  addTurn(paths, id, { who: 'agent', by: 'analyst', at: new Date(NOW).toISOString(), version: 0, text: 'Understood.', sessionId: 's-open' });
  await talks.send(dir, id, 'Closed deals too.');
  assert.deepEqual(asked[1]!.args, startArgs(id, 'Closed deals too.'));
  assert.equal(read.length, 1, 'no second read');
  writeAnalysis(paths, { ...sampleAnalyses(NOW)['ACME-21']!, task: id });
  await talks.send(dir, id, 'Why?');
  assert.deepEqual(asked[2]!.args.slice(0, 2), ['plan', 'talk'], 'with a plan, Talk it through');
});

test('edge case: past the build with no plan, a message discusses the ticket and never starts a plan, nor reads its ticket again (T-169)', async () => {
  const { dir, paths, id } = noPlanRepo();
  assert.equal(waitsToBuild(paths, id), true, 'to do: a message starts its plan');
  mutate(paths, () => new Date(NOW), (l, emit) => { l.tasks[0]!.state = 'running'; emit({ type: 'task.moved', task: id, actor: 'human', by: 'test', data: {} }); });
  assert.equal(waitsToBuild(paths, id), false);
  assert.equal(waitsToBuild(paths, 'NONE-1'), false, 'a task acc doesn\'t keep isn\'t waiting');
  const asked: { args: string[]; label?: string }[] = [];
  const read: string[] = [];
  const talks = new Talks({
    paths: () => paths,
    acc: async (args, _cwd, label) => { asked.push({ args, label }); return { code: 0, stdout: '{}', stderr: '' }; },
    launch: () => {},
    ticket: async (_root, task) => { read.push(task); return { file: null, remove: () => {} }; },
  });
  assert.deepEqual(await talks.send(dir, id, 'What changed?'), { ok: true });
  assert.deepEqual(asked, [{ args: ['plan', 'talk', id, '--message=What changed?', '--json'], label: `Discuss ${id}` }]);
  assert.deepEqual(read, [], 'no ticket read for a plan');
});

test('edge case: a first message whose ticket file can\'t be written still goes, reading the description, and acc failing still removes what was read', async () => {
  const { dir, paths, id } = noPlanRepo();
  const asked: string[][] = [];
  let removed = 0;
  const talks = new Talks({
    paths: () => paths,
    acc: async (args) => { asked.push(args); return { code: 1, stdout: JSON.stringify({ message: 'It broke.' }), stderr: '' }; },
    launch: () => {},
    ticket: async () => ({ file: null, remove: () => { removed++; } }),
  });
  const r = await talks.send(dir, id, 'Hi');
  assert.deepEqual(asked[0], startArgs(id, 'Hi'));
  assert.equal(r.ok, false);
  assert.equal(removed, 1);
  assert.equal(talks.state(dir, id).running, false);
});

// ---------------------------------------------------------------- the panel and the task page

const page = pageDom();
let kept: unknown = { opened: [], drafts: {} };
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
const { renderConversationPage } = await import('../webview/conversation.ts');
const { renderAnalysis } = await import('../webview/analysis.ts');
const { conversationLine, focusTalk, headerDiscuss, renderConversation } = await import('../webview/talk.ts');
const { renderTicket } = await import('../webview/task-page.ts');
const { state } = await import('../webview/state.ts');

const drawPanel = (m: ReturnType<typeof sampleConversation>) => { const box = page.document.createElement('div'); box.append(...(renderConversationPage(m) as unknown as PageElement[])); return box as unknown as PageElement; };
// A button by its words, or by its name where it has only an icon, such as the message card's Send (T-160).
const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && (x.textContent || x.getAttribute('aria-label')) === label);
const drawn = () => new Promise<void>((r) => queueMicrotask(r));

test('the panel opens with its title, the task\'s, the question, the box with the cursor in it, and Draft the plan off with why', async () => {
  state.draw = () => {};
  const p = drawPanel(sampleConversationStart(NOW));
  assert.equal(p.all('convo-title')[0]!.textContent, 'Discuss ACME-21');
  assert.match(p.all('convo-task')[0]!.textContent, /Contact roles/);
  assert.equal(p.all('talk-ask')[0]!.textContent, OPENING_ASK);
  assert.deepEqual([p.all('convo-title')[0]!.all('codicon').length, p.all('talk-ask')[0]!.all('codicon').length], [1, 0], 'one icon, on the title: the question has none of its own (T-129)');
  assert.equal(p.all('talk-turn').length, 0);
  const box = p.all('talk-box')[0]!;
  await drawn();
  assert.equal(page.document.activeElement, box, 'the cursor starts in the box');
  assert.equal(buttons(p, 'Draft the plan')[0]!.disabled, true);
  assert.match(p.textContent, /Draft the plan is off: Say what you're thinking first, or skip to the plan\./);
  assert.equal(buttons(p, 'Skip to the plan')[0]!.disabled, false);
  assert.equal(buttons(p, 'Make a new plan').length + buttons(p, 'Open in Claude Code').length, 0);
});

test('mid-conversation, the panel draws the latest exchange, the earlier turns folded, and the agent working; Send is off while it replies', () => {
  const p = drawPanel(sampleConversation(NOW));
  const turns = p.all('talk-turn');
  assert.deepEqual(turns.map((t) => t.getAttribute('aria-label')), ['You (jordan)'], 'the person\'s answers, the latest exchange');
  assert.equal(buttons(p, 'Earlier in this conversation (2 messages)').length, 1);
  assert.ok(turns.every((t) => !/Before the plan|You/.test(t.textContent)), 'the person\'s message is a box with no heading: no name, no version (T-160)');
  assert.match(turns[0]!.textContent, /1\. Should integration users' conversions get the role too\?\n   Yes, them too/, 'the answers went as one message');
  assert.equal(p.all('talk-card').length, 0, 'answered: no question waits');
  assert.match(p.all('talk-waiting')[0]!.textContent, /reading the ticket to reply/);
  assert.equal(buttons(p, 'Send')[0]!.disabled, true);
  assert.equal(buttons(p, 'Draft the plan')[0]!.disabled, true);
});

test('Draft the plan asks for the plan with the conversation, and Skip to the plan without it; while it\'s made the panel says what is under way', () => {
  const ready = drawPanel(sampleConversationReady(NOW));
  page.sent.length = 0;
  buttons(ready, 'Draft the plan')[0]!.click();
  buttons(ready, 'Skip to the plan')[0]!.click();
  assert.deepEqual(page.sent, [
    { type: 'conversation-draft', project: '/Users/me/code/acme-service', task: 'ACME-21' },
    { type: 'conversation-draft', project: '/Users/me/code/acme-service', task: 'ACME-21', skip: true },
  ]);
  assert.ok(page.sent.every(isFromWebview));
  const drafting = drawPanel(sampleConversationDrafting(NOW));
  assert.match(drafting.all('talk-waiting')[0]!.textContent, /Reading the ticket, its comments too/);
  assert.equal(buttons(drafting, 'Draft the plan')[0]!.disabled, true);
  assert.doesNotMatch(drafting.textContent, /Draft the plan is off/, 'the work under way says enough');
});

test('the task page shows the conversation as one line with Open conversation, never its turns, before the plan and with one', () => {
  for (const m of [sampleConversationTicket(NOW), sampleTalkTicket(NOW, true)]) {
    const p = page.document.createElement('div');
    p.append(...(renderTicket(m) as unknown as PageElement[]));
    const e = p as unknown as PageElement;
    const line = e.all('convo-line');
    assert.equal(line.length, 1, m.analysis?.planState ? 'with a plan' : 'before a plan');
    assert.match(line[0]!.textContent, /^Conversation · \d+ messages/);
    assert.equal(e.all('talk-turn').length + e.all('talk-box').length, 0, 'no turns and no box on the page');
    page.sent.length = 0;
    buttons(line[0]!, 'Open conversation')[0]!.click();
    assert.deepEqual(page.sent, [{ type: 'conversation-open', project: m.project, task: m.key }]);
  }
  // Nothing said: no line; the plan's Talk it through opens the panel instead.
  const quiet = { ...sampleTalkTicket(NOW), talk: { ...sampleTalkTicket(NOW).talk!, line: null } };
  assert.equal((renderAnalysis(quiet, quiet.analysis!) as unknown as PageElement).all('convo-line').length, 0);
  assert.equal(conversationLine(quiet.project, quiet.talk), null);
});

test('Discuss in the ticket\'s header opens its one conversation, nothing quoted, before the plan, with one and past the build; edge case: a ticket the Command Center doesn\'t keep has none', () => {
  const built = { ...sampleTalkTicket(NOW, true), talk: sampleConversationDiscuss(NOW).talk };
  for (const m of [sampleConversationTicket(NOW), sampleTalkTicket(NOW, true), built]) {
    const p = page.document.createElement('div');
    p.append(...(renderTicket(m) as unknown as PageElement[]));
    const head = (p as unknown as PageElement).all('ticket-head')[0]!;
    const discuss = buttons(head, 'Discuss');
    assert.equal(discuss.length, 1, 'one Discuss, in the header');
    assert.equal(discuss[0]!.getAttribute('aria-label'), 'Discuss ACME-21');
    page.sent.length = 0;
    discuss[0]!.click();
    assert.deepEqual(page.sent, [{ type: 'conversation-open', project: m.project, task: 'ACME-21' }], 'the same message Open conversation sends: one conversation per ticket');
    assert.ok(page.sent.every(isFromWebview));
  }
  const p = page.document.createElement('div');
  p.append(...(renderTicket({ ...built, talk: null }) as unknown as PageElement[]));
  assert.equal(buttons((p as unknown as PageElement).all('ticket-head')[0]!, 'Discuss').length, 0);
  assert.equal(headerDiscuss(ROOT, 'ACME-21', undefined), null, 'headerDiscuss draws nothing without a conversation');
});

test('the conversation Discuss opens past the build: titled Discuss <key>, it says what the person can ask, and offers Send and Open in Claude Code, but no plan to make', () => {
  const p = drawPanel(sampleConversationDiscuss(NOW));
  assert.equal(p.all('convo-title')[0]!.textContent, 'Discuss ACME-21');
  assert.equal(p.all('talk-turn').length, 0, 'nothing said yet');
  assert.match(p.textContent, /Ask anything about this ticket: what it asks, why the plan chose what it did, what the work changed, where it's deployed, what the checks and the review found, or why it's blocked\./);
  assert.equal((p.all('talk-box')[0]! as unknown as { placeholder: string }).placeholder, 'Ask about the ticket, push back, or suggest another way');
  assert.equal(buttons(p, 'Open in Claude Code')[0]!.disabled, false);
  assert.equal(buttons(p, 'Make a new plan').length + buttons(p, 'Draft the plan').length, 0);
  page.sent.length = 0;
  const box = p.all('talk-box')[0]!;
  (box as unknown as { value: string }).value = 'Where is it deployed?';
  for (const f of box.listeners.get('input') ?? []) f({});
  buttons(p, 'Send')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'talk-send', project: ROOT, task: 'ACME-21', text: 'Where is it deployed?' }]);
});

test('edge case: a redraw of the panel leaves the cursor where the person put it, and focusTalk puts it back in the box', async () => {
  const m = sampleConversationReady(NOW);
  page.document.activeElement = page.document.body;
  const again = renderConversation(m.project, m.talk!) as unknown as PageElement;
  await drawn();
  assert.notEqual(page.document.activeElement, again.all('talk-box')[0], 'a later draw takes no focus');
  focusTalk();
  const asked = renderConversation(m.project, m.talk!) as unknown as PageElement;
  await drawn();
  assert.equal(page.document.activeElement, asked.all('talk-box')[0]);
});
