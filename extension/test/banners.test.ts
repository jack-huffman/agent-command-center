// The notices above a task page's tabs as banners (T-168, webview/banners.ts and src/model/banners.ts): each one a
// label and a one-line summary, closed on each draw unless the person opened it for that task; opened, its detail;
// a blocked note's question as a choice of three at most and own words, whose Send gives the answer to the blocked
// builder and then says it went. Drawn in page-dom.ts's small document; at each width and theme, the screenshot run's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketModel } from '../src/model/task-page.ts';
import { ANSWER_MAX, answerSession, area as bannersArea, blockedReply, REPLY_CLOUD, REPLY_NO_SESSION, sharedFiles } from '../src/model/banners.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { OPTIONS_MAX } from '../../packages/core/src/talk-questions.ts';
import { sampleAgentPanelTicket } from '../scripts/fixtures/agent-panel.ts';
import { ROOT } from '../scripts/fixtures/shared.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const dom = pageDom();
let saved: Record<string, unknown> | undefined;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { dom.sent.push(m); }, getState: () => saved, setState: (s: Record<string, unknown>) => { saved = s; } });
const { renderTicket } = await import('../webview/task-page.ts');
const { answerText, answerWords, bannerKey, bannersOf, CHOICE_MAX, drawBanner, onAnswered, OWN, renderBanners, sending, sentAnswer } = await import('../webview/banners.ts');

const NOW = Date.parse('2026-10-31T12:00:00Z');
const KEY = 'ACME-12';
type Details = PageElement & { open: boolean };

const sample = (): TicketModel => sampleAgentPanelTicket(NOW, 'banners');
const drawn = (m: TicketModel = sample()): Details[] => renderBanners(m) as unknown as Details[];
const byId = (bs: Details[], id: string): Details => bs.find((b) => b.dataset.banner === id)!;
const toggle = (d: Details, open: boolean): void => { d.open = open; for (const f of d.listeners.get('toggle') ?? []) f({}); };
const radios = (d: PageElement): (PageElement & { checked: boolean; value: string })[] => d.all().filter((e) => e.tagName === 'INPUT' && e.type === 'radio') as never;
const change = (r: PageElement & { checked: boolean }): void => { r.checked = true; for (const f of r.listeners.get('change') ?? []) f({}); };
const sendButton = (d: PageElement): PageElement => d.all('banner-send')[0]!.all('btn')[0]!;
function fresh(memory?: Record<string, unknown>): void {
  saved = memory;
  dom.sent.length = 0;
}

// ---------------------------------------------------------------- what each banner says

test('each notice above the tabs is a banner with a label and a one-line summary, in the order the notices were', () => {
  const bs = bannersOf(sample().acc);
  assert.deepEqual(bs.map((b) => b.id), ['blocked', 'conflicts', 'checks', 'card', 'files']);
  const line = (id: string) => { const b = bs.find((x) => x.id === id)!; return `${b.label}${b.sep}${b.summary}`; };
  assert.equal(line('blocked'), 'Blocked: The plan and the ticket disagree, so nothing can land without your choice.');
  assert.equal(line('conflicts'), 'Conflicts with dev in 2 files');
  assert.equal(line('checks'), 'Checks failed on GitHub: 2 checks');
  assert.equal(line('card'), 'Card: it couldn\'t move on its GitHub Project');
  assert.equal(line('files'), 'Shares 3 files with ACME-13', 'the person\'s example: Shares 3 files with AB-20526');
  // Each has an icon, and none uses green or red: orange for what waits on the person.
  for (const b of bs) assert.ok(b.icon && ['orange', 'blue', 'neutral'].includes(b.tone), b.id);
});

test('edge case: a task acc doesn\'t keep, or one with nothing to say, has no banners', () => {
  assert.deepEqual(bannersOf(null), []);
  const m = sample();
  assert.deepEqual(bannersOf({ ...m.acc!, blocker: null, conflicts: null, failedChecks: null, cardFailed: null, files: null, shares: [] }), []);
  fresh();
  assert.equal(renderBanners({ ...m, acc: null }).length, 0);
});

test('edge case: the files banner lists each task\'s files when it shares with several, and keeps a wait\'s or a failed start\'s own words', () => {
  const acc = sample().acc!;
  const two = bannersOf({ ...acc, blocker: null, shares: [{ task: 'ACME-13', files: ['a.cls'] }, { task: 'ACME-19', files: ['b.cls', 'c.cls'] }] }).at(-1)!;
  assert.equal(`${two.label}${two.sep}${two.summary}`, 'Shares 3 files with ACME-13 and ACME-19');
  assert.deepEqual(two.lines, ['ACME-13: a.cls', 'ACME-19: b.cls', 'ACME-19: c.cls']);
  const waits = bannersOf({ ...acc, files: { label: 'Waits for ACME-12\'s files: a.cls, while ACME-16 is ready to start', icon: 'clock', tone: 'blue' } }).at(-1)!;
  assert.deepEqual([waits.label, waits.sep, waits.tone], ['Waits', ' ', 'blue']);
  assert.equal(waits.text, 'Waits for ACME-12\'s files: a.cls, while ACME-16 is ready to start', 'opened, the wait in full');
  const failed = bannersOf({ ...acc, files: { label: 'Needs you: its start failed: no worktree', icon: 'bell', tone: 'orange' }, shares: [] }).at(-1)!;
  assert.deepEqual([failed.label, failed.summary], ['Needs you', 'its start failed: no worktree']);
  const unknown = bannersOf({ ...acc, files: { label: 'Its files aren\'t known: no analysis to compare with work in flight', icon: 'info', tone: 'neutral' }, shares: [] }).at(-1)!;
  assert.equal(`${unknown.label}${unknown.sep}${unknown.summary}`, 'Files: its files aren\'t known: no analysis to compare with work in flight');
  // A done task shares nothing: its card says nothing then (D-093).
  assert.deepEqual(sharedFiles({ state: 'done', files: { known: true, shares: [{ task: 'ACME-13', files: ['a.cls'] }], first: [], held: null } as never }), []);
  assert.deepEqual(sharedFiles({ state: 'running', files: undefined } as never), [], 'edge case: no files read yet');
});

// ---------------------------------------------------------------- closed by default, remembered per task

test('every banner is drawn closed when the person hasn\'t opened it: a mutant that draws one open fails here', () => {
  fresh();
  const bs = drawn();
  assert.equal(bs.length, 5);
  let checked = 0;
  for (const b of bs) {
    assert.equal(b.tagName, 'DETAILS');
    assert.equal(b.open, false, `${b.dataset.banner} is closed`);
    checked++;
  }
  assert.equal(checked, 5);
  // The page draws them above the tabs, in its top.
  const page = renderTicket(sample()) as unknown as PageElement[];
  const top = page.find((n) => n.classList.contains('ticket-grid'))!.all('ticket-top')[0]!;
  assert.equal(top.all('banner').length, 5);
  assert.ok(top.all('banner').every((b) => !(b as Details).open));
});

test('opening a banner shows its detail and the page remembers it open for that task only, on each new draw; closing forgets it', () => {
  fresh();
  const files = byId(drawn(), 'files');
  assert.deepEqual(files.all('banner-lines')[0]!.all().map((l) => l.textContent), ['force-app/main/default/classes/CaseTriggerHandler.cls', 'force-app/main/default/classes/CaseTriggerHandlerTest.cls', 'force-app/main/default/flows/Case_Escalation.flow-meta.xml']);
  toggle(files, true);
  assert.ok((saved!.opened as string[]).includes(bannerKey({ project: ROOT, key: KEY }, 'files')));
  const again = drawn();
  assert.equal(byId(again, 'files').open, true, 'redrawn, still open');
  assert.equal(byId(again, 'blocked').open, false, 'the others stay closed');
  // Another task's page: its own files banner is closed.
  assert.equal(byId(drawn({ ...sample(), key: 'ACME-13' }), 'files').open, false, 'edge case: remembered per task');
  toggle(byId(again, 'files'), false);
  assert.equal(byId(drawn(), 'files').open, false, 'closed, it stays closed');
  // The card's reason and the checks show in full once opened; a conflict's files too.
  const bs = drawn();
  assert.match(byId(bs, 'card').all('banner-detail-text')[0]!.textContent, /no Status field/);
  assert.deepEqual(byId(bs, 'checks').all('banner-lines')[0]!.all().map((l) => l.textContent), ['validate', 'apex-tests']);
  assert.equal(byId(bs, 'conflicts').all('banner-lines')[0]!.all().length, 2);
});

test('the keyboard and a screen reader can open a banner: its line is a summary, with the whole sentence as its title and a chevron', () => {
  fresh();
  const b = byId(drawn(), 'blocked');
  const summary = b.children[0] as PageElement;
  assert.equal(summary.tagName, 'SUMMARY', 'a details\' summary takes Enter and Space, and says whether it is open');
  assert.equal(summary.all('banner-label')[0]!.textContent, 'Blocked');
  assert.equal(summary.all('banner-line')[0]!.title, 'Blocked: The plan and the ticket disagree, so nothing can land without your choice.');
  assert.equal(summary.all('codicon-chevron-down').length, 1);
  assert.equal(summary.dataset.keep, bannerKey({ project: ROOT, key: KEY }, 'blocked'), 'focus stays on it as the page redraws');
});

// ---------------------------------------------------------------- a choice you can answer

test('a blocked note\'s question with options shows each as a choice and the person\'s own words, three options at most', () => {
  fresh();
  const m = sample();
  const four = { ...m.acc!.blocker!, shape: { ...m.acc!.blocker!.shape!, items: [{ text: 'Which one?', options: ['a', 'b', 'c', 'd'].map((l) => ({ label: l, text: `option ${l}`, recommended: l === 'b' })) }] } };
  const b = byId(drawn({ ...m, acc: { ...m.acc!, blocker: four } }), 'blocked');
  const group = b.all('banner-choice')[0]!;
  assert.equal(group.tagName, 'FIELDSET');
  assert.equal(group.all('banner-legend')[0]!.textContent, 'Which one?', 'the group is named by its question');
  assert.deepEqual(radios(group).map((r) => r.value), ['a', 'b', 'c', OWN]);
  assert.equal(CHOICE_MAX, OPTIONS_MAX);
  assert.ok(radios(group).every((r) => r.attributes.get('name') === undefined && (r as unknown as { name: string }).name === radios(group)[0]!.name), 'one group: the arrow keys move between them');
  // Each radio sits in its label, so a screen reader says its words.
  assert.ok(group.all('banner-option').every((l) => l.tagName === 'LABEL' && radios(l).length === 1));
  // A thing with no options is a bullet, with no choice.
  const plain = byId(drawn(), 'blocked').all('banner-item')[2]!;
  assert.equal(plain.all('banner-choice').length, 0);
});

test('Send is off with why until there\'s an answer: an option, or own words written; edge case: own words picked and then cleared', () => {
  fresh();
  let b = byId(drawn(), 'blocked');
  const send = sendButton(b);
  assert.equal(send.disabled, true);
  assert.equal(send.title, 'Pick an answer first.');
  change(radios(b)[0]!);
  assert.equal(send.disabled, false);
  // Own words, with none written, holds Send back.
  fresh();
  b = byId(drawn(), 'blocked');
  change(radios(b).find((r) => r.value === OWN)!);
  assert.equal(sendButton(b).title, 'Write your answer first.');
  // Typing picks own words by itself.
  fresh();
  b = byId(drawn(), 'blocked');
  const words = b.all('text-input')[0]! as PageElement & { value: string };
  words.value = 'The service layout';
  for (const f of words.listeners.get('input') ?? []) f({});
  assert.equal(radios(b).find((r) => r.value === OWN)!.checked, true);
  assert.equal(sendButton(b).disabled, false);
  words.value = '  ';
  for (const f of words.listeners.get('input') ?? []) f({});
  assert.equal(sendButton(b).disabled, true, 'cleared again: nothing to send');
});

test('sending a choice gives the answer to the blocked builder, says it\'s on its way, and then says it was sent', () => {
  fresh();
  const m = sample();
  let b = byId(drawn(m), 'blocked');
  change(radios(b)[0]!);
  sendButton(b).click();
  const msg = dom.sent.find((x) => (x as { type: string }).type === 'blocked-answer') as { project: string; task: string; item: number; text: string };
  assert.deepEqual([msg.project, msg.task, msg.item], [ROOT, KEY, 0]);
  assert.match(msg.text, /^This is the answer to your blocked note: The plan and the ticket disagree/);
  assert.match(msg.text, /\nThe answer: a\) `Territory__c` on Account$/, 'the option\'s letter and words, without "(recommended)"');
  assert.ok(bannersArea.messages!['blocked-answer']!(msg as never), 'the extension takes the message');
  // On its way: Send says so, and a second click sends nothing more.
  b = byId(drawn(m), 'blocked');
  assert.equal(sendButton(b).textContent, 'Sending…');
  assert.equal(sendButton(b).disabled, true);
  // The extension's reply: it went. The question shows the answer sent, and the banner's line says so.
  onAnswered({ type: 'blocked-answered', project: ROOT, task: KEY, item: 0, ok: true });
  b = byId(drawn(m), 'blocked');
  const items = b.all('banner-item');
  assert.equal(items[0]!.all('banner-choice').length, 0);
  assert.match(items[0]!.all('banner-sent')[0]!.textContent, /^Your answer was sent to its builder: a\) Territory__c on Account$/);
  assert.equal(items[1]!.all('banner-choice').length, 1, 'the other question still asks');
  assert.equal(b.all('banner-done')[0]!.textContent, 'Answer sent');
  assert.equal(sentAnswer({ project: ROOT, key: KEY }, 0, m.acc!.blocker!.headline), 'a) `Territory__c` on Account');
  // Edge case: an answer sent for an older note doesn't count for a new one.
  assert.equal(sentAnswer({ project: ROOT, key: KEY }, 0, 'Another headline'), null);
});

test('edge case: a refused answer says why under Send and can be sent again; a reply for nothing on its way is dropped', () => {
  fresh();
  const m = sample();
  let b = byId(drawn(m), 'blocked');
  change(radios(b)[1]!);
  sendButton(b).click();
  onAnswered({ type: 'blocked-answered', project: ROOT, task: KEY, item: 0, ok: false, error: 'its background session wouldn\'t stop' });
  b = byId(drawn(m), 'blocked');
  assert.equal(b.all('banner-error')[0]!.textContent, 'It wasn\'t sent: its background session wouldn\'t stop');
  assert.equal(sendButton(b).disabled, false, 'its pick is kept, so Send is on again');
  assert.equal(b.all('banner-done').length, 0);
  // A reply that comes with nothing sent changes nothing.
  onAnswered({ type: 'blocked-answered', project: ROOT, task: KEY, item: 1, ok: true });
  assert.equal(sentAnswer({ project: ROOT, key: KEY }, 1, m.acc!.blocker!.headline), null);
  assert.equal(sending.what(`blocked-sent:${ROOT}#${KEY}:1`), undefined);
});

test('edge case: a builder that can\'t take an answer here keeps the choice off, with why', () => {
  fresh();
  const m = sample();
  const b = byId(drawn({ ...m, acc: { ...m.acc!, reply: { can: false, why: REPLY_CLOUD } } }), 'blocked');
  assert.ok(radios(b).every((r) => r.disabled));
  assert.equal(sendButton(b).disabled, true);
  assert.equal(sendButton(b).title, REPLY_CLOUD);
  assert.ok(b.all('banner-send')[0]!.textContent.includes(REPLY_CLOUD));
});

test('the answer\'s words: an option\'s letter and words, or own words trimmed, after the note and its question, and never longer than the message allows', () => {
  const item = { text: 'Which field?', options: [{ label: 'a', text: 'Account (recommended)', recommended: true }] };
  assert.equal(answerWords(item.options[0]!, 'ignored'), 'a) Account');
  assert.equal(answerWords(null, '  my words  '), 'my words');
  assert.equal(answerText('It is stuck.', item, 'a) Account'), 'This is the answer to your blocked note: It is stuck.\nYou asked: Which field?\nThe answer: a) Account');
  assert.equal(answerText('It is stuck.', { text: '', options: [] }, 'x'), 'This is the answer to your blocked note: It is stuck.\nThe answer: x', 'edge case: a question with no words of its own');
  assert.equal(answerText('h', item, 'x'.repeat(9000)).length, ANSWER_MAX);
});

// ---------------------------------------------------------------- the extension's side

test('blockedReply: a local builder with a session can take an answer; a cloud builder, or one with no session, can\'t, with why', () => {
  assert.deepEqual(blockedReply({ run: { sessionId: 's-1' } }), { can: true, why: null });
  assert.deepEqual(blockedReply({ run: { sessionId: 's-1', where: 'cloud' } as never }), { can: false, why: REPLY_CLOUD });
  assert.deepEqual(blockedReply({ run: { bgId: 'bg1' } }), { can: false, why: REPLY_NO_SESSION });
  assert.deepEqual(blockedReply({ run: null } as never), { can: false, why: REPLY_NO_SESSION }, 'edge case: never dispatched');
});

test('answerSession: the builder\'s listed session first, else the one acc recorded, in its worktree; none where it can\'t take one', () => {
  const task = { id: 'ACME-12', run: { sessionId: 's-12', worktree: '/wt/ACME-12', name: 'acme-12-builder' } };
  const listed = { cwd: '/wt/ACME-12', kind: 'background', startedAt: 1, sessionId: 's-12', id: 'bg12', pid: 42 };
  assert.equal(answerSession(task, ROOT, [listed]), listed);
  const recorded = answerSession(task, ROOT, [])!;
  assert.deepEqual([recorded.cwd, recorded.sessionId, recorded.name], ['/wt/ACME-12', 's-12', 'acme-12-builder']);
  assert.equal(answerSession({ id: 'ACME-12', run: { sessionId: 's-12' } }, ROOT, [])!.cwd, ROOT, 'edge case: no worktree recorded: the project');
  assert.equal(answerSession({ id: 'ACME-12', run: { where: 'cloud', sessionId: 's-12' } as never }, ROOT, [listed]), null);
});

test('the blocked-answer message: checked before the extension takes it, and the modal takes its own task\'s only', () => {
  const ok = bannersArea.messages!['blocked-answer']!;
  const m = { type: 'blocked-answer', project: ROOT, task: 'ACME-12', item: 0, text: 'a) Account' };
  assert.ok(ok(m));
  assert.ok(!ok({ ...m, text: '   ' }), 'edge case: blank');
  assert.ok(!ok({ ...m, text: 'x'.repeat(ANSWER_MAX + 1) }), 'too long');
  assert.ok(!ok({ ...m, item: -1 }) && !ok({ ...m, item: 1.5 }) && !ok({ ...m, item: '0' }), 'its question is a small whole number');
  assert.ok(!ok({ ...m, task: 'not a key' }));
  assert.ok(modalTakes({ project: ROOT, key: 'ACME-12' }, m as never, new Set()));
  assert.ok(!modalTakes({ project: ROOT, key: 'ACME-13' }, m as never, new Set()), 'another task\'s answer isn\'t the modal\'s');
});

test('drawBanner names the banner by its id and draws one level of border: no box inside it', () => {
  fresh();
  const b = drawBanner(sample(), bannersOf(sample().acc)[0]!) as unknown as Details;
  assert.equal(b.dataset.banner, 'blocked');
  assert.ok(b.classList.contains('banner-orange'));
  assert.equal(b.all('notice').length + b.all('block').length, 0);
});
