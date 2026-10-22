// The planning agent's questions one at a time, and less on screen at once (T-113): the conversation's model (the
// questions waiting, the fold of earlier turns, a long reply), the answers' message and the extension's side of it,
// the question card with its keys, Back, Skip, the dots and Escape, and the folds and one-line proposals it draws.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig, type Config } from '../../packages/core/src/config.ts';
import { run } from '../../packages/core/src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../../packages/core/src/ledger.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { addTurn, type PlanTalk } from '../../packages/core/src/plan-talk.ts';
import { GENERIC_CONFIG, makeRepo } from '../../packages/core/test/support.ts';
import { startArgs } from '../src/logic/conversation.ts';
import { Talks } from '../src/logic/talk.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { longText, REPLY_LINES, TALK_DONE, type TalkAnswerIn, ticketTalk } from '../src/model/talk.ts';
import { samplePlan } from '../scripts/fixtures/analysis.ts';
import { OPENING_QUESTIONS, QUESTIONS_STATE, sampleConversationLong, sampleConversationQuestions, sampleOpening } from '../scripts/fixtures/conversation.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const ROOT = '/Users/me/code/acme-service';
const REF = { project: ROOT, task: 'ACME-21' };
const opening = (talk: PlanTalk, more: Partial<Parameters<typeof ticketTalk>[0]> = {}) =>
  ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: null, analyzing: false, talk, running: false, open: [], ref: REF, ...more })!;

// ---------------------------------------------------------------- the model

test('the agent\'s last reply\'s questions wait, each with its answers, the suggestion first and marked, and whether own words go', () => {
  const s = opening(sampleOpening(NOW, false, 0, true));
  assert.equal(s.questions?.turn, 't2');
  assert.deepEqual(s.questions?.items.map((q) => [q.question, q.options.map((o) => `${o.label}${o.suggested ? ' *' : ''}`), q.own]), [
    [OPENING_QUESTIONS[0]!.question, ['Yes, them too *', 'No, people only'], true],
    [OPENING_QUESTIONS[1]!.question, ['Keep it, add none *', 'Add another', 'Replace it'], false],
    [OPENING_QUESTIONS[2]!.question, ['The lead\'s own contact *', 'The account\'s main contact'], true],
  ]);
  assert.equal(s.questions?.items[0]!.why, OPENING_QUESTIONS[0]!.why);
});

test('edge cases: no questions wait once the person said something after, past the build, on another version of the plan, or with none asked; a reply kept before T-113 asks in own words', () => {
  assert.equal(opening(sampleOpening(NOW)).questions, null, 'answered');
  assert.equal(opening(sampleOpening(NOW, false, 0, true), { task: { id: 'ACME-21', state: 'done' } }).questions, null, 'past the build');
  assert.equal(opening(sampleOpening(NOW, false, 0, true), { analysis: samplePlan(NOW, 'approved') }).questions, null, 'asked before the plan, and the plan was skipped to');
  assert.equal(opening({ v: 1, task: 'ACME-21', turns: [] }).questions, null, 'nothing said');
  assert.equal(opening(sampleOpening(NOW, true)).questions, null, 'the last reply asks nothing');
  const old = sampleOpening(NOW, false, 0, true);
  old.turns[1] = { ...old.turns[1]!, questions: undefined, asks: ['Closed deals too?'], unsure: ['Which contact is primary'] };
  const s = opening(old);
  assert.deepEqual(s.questions?.items, [{ question: 'Closed deals too?', why: '', options: [], own: true }]);
  assert.match(s.turns[1]!.text, /\n\nNot sure yet:\n- Which contact is primary$/, 'what it was unsure of stays, under its words');
});

test('the turns before the person\'s last message fold; edge cases: none before it, no message of theirs, or nothing said', () => {
  assert.equal(opening(sampleOpening(NOW, true)).earlier, 2, 'the opening and the agent\'s reply fold; the answers and its reply show');
  assert.equal(opening(sampleOpening(NOW, false, 0, true)).earlier, 0, 'the latest exchange is all there is');
  assert.equal(opening({ v: 1, task: 'ACME-21', turns: [] }).earlier, 0);
  const t: PlanTalk = { v: 1, task: 'ACME-21', turns: ['plan', 'claude-code', 'plan'].map((who, i) => ({ id: `t${i + 1}`, who: who as 'plan', by: 'x', at: new Date(NOW).toISOString(), version: 0, text: 'x' })) };
  assert.equal(opening(t).earlier, 2, 'with no message of theirs, the last turn shows');
  assert.equal(sampleConversationLong(NOW).talk!.earlier, 8);
});

test('a reply longer than about eight lines is long, counting a line each and wrapping long ones; edge case: exactly eight is not', () => {
  assert.equal(REPLY_LINES, 8);
  assert.equal(longText(Array(8).fill('a line').join('\n')), false);
  assert.equal(longText(Array(9).fill('a line').join('\n')), true);
  assert.equal(longText('x'.repeat(80 * 8)), false, 'eight full lines');
  assert.equal(longText('x'.repeat(80 * 8 + 1)), true, 'a ninth wraps');
  assert.equal(longText(''), false);
  assert.equal(sampleConversationLong(NOW).talk!.turns.at(-1)!.long, true);
});

test('the answers\' message: one to three, each an option by its place, own words or skipped; edge cases: a bad turn, too many, an option past four, long words or another shape are refused', () => {
  const ok = (answers: unknown, turn: unknown = 't2') => isFromWebview({ type: 'talk-answers', project: ROOT, task: 'ACME-21', turn, answers });
  assert.ok(ok([{ option: 1 }, null, { text: 'Mine' }]));
  assert.ok(ok([null]));
  assert.ok(ok([{ text: 'x'.repeat(1000) }]));
  assert.ok(!ok([]), 'no answers');
  assert.ok(!ok([null, null, null, null]), 'more than three');
  assert.ok(!ok([{ option: 4 }]), 'past four options');
  assert.ok(!ok([{ option: -1 }]));
  assert.ok(!ok([{ option: 1.5 }]));
  assert.ok(!ok([{ text: 'x'.repeat(1001) }]), 'longer than an answer');
  assert.ok(!ok([{ option: 1, text: 'both' }]), 'one or the other');
  assert.ok(!ok(['Yes']));
  assert.ok(!ok([[1]]));
  assert.ok(!ok([null], 'x2'));
  assert.ok(!ok('Yes'));
});

// ---------------------------------------------------------------- the extension's side

function asked() {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, () => new Date(NOW), (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-21' }, title: 'Contact roles', brief: 'Give the role.' }], 'human', 'human:test', emit, () => new Date(NOW));
  });
  const id = readLedger(paths.ledger).tasks[0]!.id;
  for (const t of sampleOpening(NOW, false, 0, true).turns) addTurn(paths, id, t);
  const args: string[][] = [];
  const talks = new Talks({ paths: () => paths, acc: async (a) => { args.push(a); return { code: 0, stdout: '{}', stderr: '' }; }, launch: () => {} });
  return { dir, paths, id, args, talks };
}

test('the answers go to acc as the person\'s one next message, numbered with the questions acc kept', async () => {
  const { dir, id, args, talks } = asked();
  const answers: TalkAnswerIn[] = [{ option: 1 }, null, { text: 'The lead\'s own contact' }];
  assert.deepEqual(await talks.answers(dir, id, 't2', answers), { ok: true });
  assert.deepEqual(args, [startArgs(id, [
    `1. ${OPENING_QUESTIONS[0]!.question}`, '   No, people only',
    `2. ${OPENING_QUESTIONS[1]!.question}`, '   (skipped)',
    `3. ${OPENING_QUESTIONS[2]!.question}`, '   The lead\'s own contact',
  ].join('\n'))]);
});

test('edge cases: answers to a reply that isn\'t the last, or a count that doesn\'t match, or a project that closed, are refused and send nothing', async () => {
  const { dir, paths, id, args, talks } = asked();
  assert.deepEqual(await talks.answers(dir, id, 't2', [null]), { ok: false, error: 'The planning agent asked 3 questions, and 1 answer came.' });
  assert.deepEqual(await talks.answers(dir, id, 't1', [null, null, null]), { ok: false, error: 'Those questions aren\'t waiting any more: something was said since.' });
  addTurn(paths, id, { who: 'you', by: 'human:me', at: new Date(NOW).toISOString(), version: 0, text: 'Something else first.' });
  assert.equal((await talks.answers(dir, id, 't2', [null, null, null])).ok, false, 'something was said since');
  const closed = new Talks({ paths: () => undefined, acc: async () => ({ code: 0, stdout: '', stderr: '' }), launch: () => {} });
  assert.equal((await closed.answers(dir, id, 't2', [null])).ok, false);
  assert.deepEqual(args, []);
});

// ---------------------------------------------------------------- the page

const page = pageDom();
let kept: { opened: string[]; drafts: Record<string, string> } = { opened: [], drafts: {} };
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: typeof kept) => { kept = s; } });
const { renderConversation, earlierKey, sendKey, talkPending, area } = await import('../webview/talk.ts');
const { answersOf, answersSent, picksOf, questionCard, questionsKey } = await import('../webview/talk-questions.ts');
const { pickByKey, stepProgress, stepRadio, stepTag } = await import('../webview/stepper.ts');
const { state } = await import('../webview/state.ts');
state.draw = () => {};

const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === label);
const drawn = () => new Promise<void>((r) => queueMicrotask(r));
const done = (msg: Record<string, unknown>) => (area.receive![TALK_DONE] as (m: unknown) => void)(msg);
const questions = sampleConversationQuestions(NOW);
const draw = (m = questions) => renderConversation(m.project, m.talk!) as unknown as PageElement;
const card = (s: PageElement = draw()) => s.all('talk-card')[0]!;
const place = (c: PageElement) => c.all('rp-place')[0]!.textContent;
const picked = (c: PageElement) => c.all('rp-radio').find((r) => r.getAttribute('aria-checked') === 'true')!.dataset.pick;
const press = (e: PageElement, key: string, target: PageElement = e) => { for (const f of e.listeners.get('keydown') ?? []) f({ key, target: { ...target, closest: () => null, getAttribute: (n: string) => target.getAttribute(n) }, preventDefault() {}, stopPropagation() {}, defaultPrevented: false }); };
const radio = (c: PageElement) => c.all('rp-radio').find((r) => r.getAttribute('aria-checked') === 'true')!;
const fresh = () => { kept = { opened: [], drafts: {} }; page.sent.length = 0; };

test('the card asks one question at a time: "Question 1 of 3", the question, its why, its answers with the suggestion first and marked, and own words last', () => {
  fresh();
  const s = draw();
  const c = card(s);
  assert.equal(s.all('talk-card').length, 1);
  assert.equal(c.all('rp-step').length, 1, 'one question');
  assert.equal(place(c), 'Question 1 of 3');
  assert.equal(c.all('rp-q')[0]!.textContent, OPENING_QUESTIONS[0]!.question);
  assert.equal(c.all('rp-why')[0]!.textContent, OPENING_QUESTIONS[0]!.why);
  assert.ok(!s.textContent.includes(OPENING_QUESTIONS[1]!.question), 'the next isn\'t on the page');
  assert.deepEqual(c.all('rp-name').map((x) => x.textContent), ['Yes, them tooSuggested', 'No, people only', 'Answer in my own words']);
  assert.equal(c.all('rp-rec')[0]!.textContent, 'Suggested', 'marked with an icon and the word');
  assert.equal(picked(c), 'o0', 'the suggestion is picked');
  const group = c.all('rp-options')[0]!;
  assert.deepEqual([group.getAttribute('role'), group.getAttribute('aria-labelledby')], ['radiogroup', (c.all('rp-q')[0] as unknown as { id: string }).id]);
  assert.equal(c.all('rp-dot').length, 3);
  assert.deepEqual(picksOf({ question: 'q', why: '', options: [{ label: 'a', suggested: true }, { label: 'b', suggested: false }], own: false }), ['o0', 'o1'], 'no own words where they don\'t go');
  assert.deepEqual(picksOf({ question: 'q', why: '', options: [], own: false }), ['own'], 'edge case: a question with no answers takes own words');
});

test('a number picks, Enter confirms and goes on, sending nothing; Back keeps the pick; Skip marks the dot orange; the last sends every answer once', () => {
  fresh();
  press(card(), '2', radio(card()));
  assert.equal(picked(card()), 'o1');
  assert.equal(kept.drafts[`${questionsKey(ROOT, 'ACME-21', 't2')}:pick:0`], 'o1');
  press(card(), 'Enter', radio(card()));
  assert.equal(place(card()), 'Question 2 of 3');
  assert.deepEqual(page.sent, [], 'nothing goes before the last');
  assert.ok(card().all('rp-dot')[0]!.classList.contains('done'));
  buttons(card(), 'Back')[0]!.click();
  assert.deepEqual([place(card()), picked(card())], ['Question 1 of 3', 'o1'], 'Back keeps the pick');
  assert.equal(buttons(card(), 'Back')[0]!.disabled, true, 'edge case: no Back on the first');
  buttons(card(), 'Confirm')[0]!.click();
  buttons(card(), 'Skip')[0]!.click();
  assert.equal(place(card()), 'Question 3 of 3');
  const dot = card().all('rp-dot')[1]!;
  assert.ok(dot.classList.contains('skipped') && dot.getAttribute('aria-label')!.endsWith(': skipped'));
  assert.deepEqual([buttons(card(), 'Skip and send').length, buttons(card(), 'Confirm and send').length], [1, 1], 'the last says it sends');
  buttons(card(), 'Confirm and send')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'talk-answers', project: ROOT, task: 'ACME-21', turn: 't2', answers: [{ option: 1 }, null, { option: 0 }] }]);
  assert.ok(isFromWebview(page.sent[0]));
  assert.equal(buttons(card(), 'Sending…').length, 1, 'it shows they\'re on their way');
  done({ action: 'talk-answers', project: ROOT, task: 'ACME-21', ok: true });
  assert.equal(Object.keys(kept.drafts).some((k) => k.startsWith('askq:')), false, 'what was picked for them is forgotten once they went');
});

test('own words: the box shows once picked, Confirm is off until there are words, and Enter in the box confirms', async () => {
  fresh();
  kept = { opened: [...QUESTIONS_STATE.opened], drafts: { ...QUESTIONS_STATE.drafts } };
  assert.deepEqual([place(card()), picked(card())], ['Question 2 of 3', 'o1'], 'part-way, as the screenshot draws it');
  buttons(card(), 'Skip')[0]!.click();
  press(card(), '3', radio(card()));
  const c = card();
  await drawn();
  const box = c.all().find((x) => x.tagName === 'INPUT')!;
  assert.ok(box, 'its box');
  assert.match(box.getAttribute('aria-label')!, /^Your answer to: Which contact is primary/);
  assert.equal(buttons(c, 'Confirm and send')[0]!.disabled, true);
  assert.equal(buttons(c, 'Confirm and send')[0]!.title, 'Type your answer first');
  (box as unknown as { value: string }).value = 'Ask the rep';
  for (const f of box.listeners.get('input') ?? []) f({});
  assert.equal(buttons(c, 'Confirm and send')[0]!.disabled, false, 'on once there are words, with no redraw');
  for (const f of box.listeners.get('keydown') ?? []) f({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(page.sent, [{ type: 'talk-answers', project: ROOT, task: 'ACME-21', turn: 't2', answers: [{ option: 0 }, null, { text: 'Ask the rep' }] }]);
  done({ action: 'talk-answers', project: ROOT, task: 'ACME-21', ok: false, error: 'The planning agent is still answering.' });
  assert.match(card().textContent, /Your answers didn't go: The planning agent is still answering\./, 'edge case: a refusal says why');
  assert.equal(place(card()), 'Question 3 of 3', 'and keeps the picks, to send again');
  talkPending.settle(sendKey(ROOT, 'ACME-21'), null);
});

test('edge cases: Escape puts the questions aside, keeping the picks, and Answer the questions brings them back; while a reply is on its way nothing can be confirmed', async () => {
  fresh();
  press(card(), '2', radio(card()));
  press(card(), 'Escape', radio(card()));
  const s = draw();
  assert.equal(s.all('talk-card').length, 0);
  const aside = s.all('talk-card-aside')[0]!;
  assert.match(aside.textContent, /3 questions from the planning agent/);
  await drawn();
  assert.equal(page.document.activeElement, buttons(aside, 'Answer the questions')[0], 'focus goes to the way back');
  buttons(aside, 'Answer the questions')[0]!.click();
  assert.deepEqual([place(card()), picked(card())], ['Question 1 of 3', 'o1'], 'back where it was');
  assert.deepEqual(page.sent, []);
  const busy = { ...questions, talk: { ...questions.talk!, send: { disabled: 'Wait for the planning agent\'s reply.' } } };
  const c = card(draw(busy));
  assert.equal(buttons(c, 'Confirm')[0]!.disabled, true);
  assert.equal(buttons(c, 'Skip')[0]!.disabled, true);
  press(c, 'Enter', radio(c));
  assert.deepEqual(page.sent, [], 'Enter does nothing either');
  assert.equal(draw({ ...questions, talk: { ...questions.talk!, send: null } }).all('talk-card').length, 0, 'past the build there is no card');
});

test('edge case: Up and Down move round the answers, another key does nothing, and an answer not reached is skipped', () => {
  fresh();
  press(card(), 'ArrowUp', radio(card()));
  assert.equal(picked(card()), 'own', 'Up from the first goes round to the last');
  press(card(), 'ArrowDown', radio(card()));
  assert.equal(picked(card()), 'o0');
  press(card(), 'x', radio(card()));
  press(card(), '9', radio(card()));
  assert.equal(picked(card()), 'o0');
  const b = questionsKey(ROOT, 'ACME-21', 't2');
  assert.deepEqual(answersOf(b, questions.talk!.questions!.items), [null, null, null], 'nothing confirmed, nothing answered');
  answersSent(ROOT, 'ACME-21');
  assert.equal(questionCard(ROOT, { ...questions.talk!, questions: null }, { busy: false, error: null, go: () => {} }), null, 'none waiting, no card');
});

test('the stepper shared with Review plan: its dots and words, a radio with its marks, and the keys that pick', () => {
  const p = stepProgress('2 of 3', [{ title: 'A', state: 'done' }, { title: 'B', state: 'current' }, { title: 'C', state: 'skipped' }], () => {}) as unknown as PageElement;
  assert.equal(p.all('rp-place')[0]!.textContent, '2 of 3');
  assert.deepEqual(p.all('rp-dot').map((d) => d.getAttribute('aria-label')), ['1. A: done', '2. B: you are here', '3. C: skipped']);
  assert.equal(p.all('rp-dot')[1]!.getAttribute('aria-current'), 'step');
  const r = stepRadio({ n: 2, name: 'Two', line: 'Its line', on: true, pick: 'b', click: () => {}, tags: [stepTag('rp-rec', 'star-full', 'Suggested'), null] }) as unknown as PageElement;
  assert.deepEqual([r.getAttribute('role'), r.getAttribute('aria-checked'), r.tabIndex, r.dataset.pick], ['radio', 'true', 0, 'b']);
  assert.match(r.textContent, /^2.*TwoSuggestedIts line$/);
  const got: string[] = [];
  const key = (k: string, cur = 'a') => pickByKey({ key: k, preventDefault() {} } as KeyboardEvent, ['a', 'b', 'c'], cur, (id) => got.push(id));
  assert.deepEqual([key('3'), key('ArrowDown', 'c'), key('ArrowUp', 'a'), key('Enter'), key('0')], [true, true, true, false, false]);
  assert.deepEqual(got, ['c', 'a', 'c']);
});

test('less at once: a long reply folds with Show more, the earlier turns fold under one line, and a proposal is one line whose Why opens its reasons', () => {
  fresh();
  const long = sampleConversationLong(NOW);
  const s = draw(long);
  const fold = buttons(s, 'Earlier in this conversation (8 messages)')[0]!;
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.equal(s.all('talk-turn').length, long.talk!.turns.length - 8, 'the latest exchange only');
  const text = s.all('talk-folded')[0]!;
  assert.ok(text, 'the long reply is folded');
  const more = buttons(s, 'Show more')[0]!;
  assert.deepEqual([more.getAttribute('aria-expanded'), more.getAttribute('aria-controls')], ['false', (text as unknown as { id: string }).id]);
  more.click();
  assert.equal(draw(long).all('talk-folded').length, 0, 'Show more unfolds it');
  assert.equal(buttons(draw(long), 'Show less').length, 1);
  fold.click();
  assert.equal(draw(long).all('talk-turn').length, long.talk!.turns.length, 'the fold opens every turn');
  assert.equal(kept.opened.includes(earlierKey(ROOT, 'ACME-21')), true, 'the tab remembers it open');
  const proposal = draw(long).all('talk-proposal').at(-2)!;
  assert.equal(proposal.all('tp-line').length, 1);
  assert.equal(proposal.all('tp-why').length, 0, 'its reasons wait behind Why');
  const why = buttons(proposal, 'Why')[0]!;
  assert.equal(why.getAttribute('aria-expanded'), 'false');
  assert.ok(buttons(proposal.all('tp-line')[0]!, 'Use this').length === 1, 'Use this on the same line');
  why.click();
  assert.match(draw(long).all('talk-proposal').at(-2)!.all('tp-why')[0]!.textContent, /Marketo Sync can't see every contact/);
  assert.match(draw(long).all('talk-proposal').at(-1)!.all('tp-line')[0]!.textContent, /Used/, 'a used one says so on its line');
});

test('edge case: a short reply doesn\'t fold, and a conversation with nothing earlier has no fold', () => {
  fresh();
  const s = draw();
  assert.equal(s.all('talk-folded').length + buttons(s, 'Show more').length, 0);
  assert.equal(s.all('talk-earlier').length, 0);
});
