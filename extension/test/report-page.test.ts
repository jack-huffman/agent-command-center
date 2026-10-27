// Report a problem's page (T-118), drawn under Node: a box for the title and each section, labelled; what's
// attached filled in and scrubbed; the whole issue under them as it will be posted; Post off with why until a
// title and what happened are there; and each state after Post, with Copy the issue text where it couldn't go.
// The browser's keys and clicks are the behaviour run's (scripts/behaviour.ts, its report case).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleReport } from '../scripts/fixtures/report.ts';
import { issueBody } from '../webview/report-text.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const page = pageDom();
let kept: { drafts: Record<string, string> } = { drafts: {} };
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: typeof kept) => { kept = s; } });
const { draftKey, issueText, postOff, renderReport } = await import('../webview/report.ts');

const draw = (m: ReturnType<typeof sampleReport>): PageElement => { const box = page.document.createElement('div'); box.append(...(renderReport(m) as unknown as PageElement[])); return box; };
const button = (e: PageElement, label: string): PageElement | undefined => e.all().find((x) => x.tagName === 'BUTTON' && x.textContent === label);
const box = (e: PageElement, id: string): PageElement & { value: string } => e.all().find((x) => (x as unknown as { id: string }).id === `report-${id}`) as PageElement & { value: string };
const type = (b: PageElement & { value: string }, text: string): void => { b.value = text; for (const f of b.listeners.get('input') ?? []) f({}); };

test('the draft opens with a labelled box for the title and each section, what\'s attached filled in, and Post off until there\'s a title', () => {
  kept = { drafts: {} };
  const m = sampleReport('report');
  const p = draw(m);
  for (const [id, label] of [['title', 'Title'], ['what-happened', 'What happened'], ['expected', 'What you expected'], ['attached', 'What\'s attached']] as [string, string][]) {
    const b = box(p, id);
    assert.ok(b, `a box for ${id}`);
    const l = p.all().find((x) => x.tagName === 'LABEL' && x.getAttribute('for') === `report-${id}`);
    assert.equal(l?.textContent, label, `${id} is labelled`);
  }
  assert.equal(box(p, 'attached').value, m.attached);
  assert.ok(p.textContent.includes(m.scrubbed!), 'it says what the scrub replaced');
  assert.ok(p.textContent.includes('Nothing is sent until you click Post to GitHub.'));
  const post = button(p, 'Post to GitHub')!;
  assert.deepEqual([post.disabled, post.title], [true, 'Give it a title']);
  assert.equal(p.all('report-preview')[0]!.textContent, issueText('(no title yet)', { 'what-happened': '', expected: '', attached: m.attached }));
  assert.equal(p.all('report-state').length, 0, 'no state before Post');
  assert.deepEqual(page.sent, [], 'drawing it sends nothing');
});

test('typing keeps each box in the tab\'s memory and the preview with it; Post goes on once what happened is said, and sends the issue the preview shows', () => {
  kept = { drafts: {} };
  page.sent.length = 0;
  const m = sampleReport('report');
  const p = draw(m);
  type(box(p, 'title'), 'It broke');
  const post = button(p, 'Post to GitHub')!;
  assert.deepEqual([post.disabled, post.title], [true, 'Say what happened']);
  type(box(p, 'what-happened'), 'I clicked it.');
  type(box(p, 'attached'), '- VSCode: 1.105.1');
  assert.deepEqual([post.disabled, post.title], [false, '']);
  const fields = { 'what-happened': 'I clicked it.', expected: '', attached: '- VSCode: 1.105.1' };
  assert.equal(p.all('report-preview')[0]!.textContent, issueText('It broke', fields));
  assert.deepEqual(kept.drafts, { [draftKey(1, 'title')]: 'It broke', [draftKey(1, 'what-happened')]: 'I clicked it.', [draftKey(1, 'attached')]: '- VSCode: 1.105.1' });
  assert.deepEqual(page.sent, [], 'nothing is sent while it\'s typed');
  post.click();
  assert.deepEqual(page.sent, [{ type: 'report-post', title: 'It broke', body: issueBody(fields) }]);
  // A redraw, such as the posting state's, keeps what was typed.
  const again = draw(sampleReport('report'));
  assert.equal(box(again, 'what-happened').value, 'I clicked it.');
});

test('a new draft starts empty, whatever the last one kept (edge case: a choice cleared after it was made)', () => {
  kept = { drafts: { [draftKey(1, 'title')]: 'Old' } };
  const p = draw({ ...sampleReport('report'), draft: 2, happened: 'Setup\'s step A4.plugin (The plugin) failed.' });
  assert.equal(box(p, 'title').value, '');
  assert.equal(box(p, 'what-happened').value, 'Setup\'s step A4.plugin (The plugin) failed.', 'a failed step starts what happened');
});

test('while it posts, Post says so and waits; posted, the link shows; where it can\'t go, the state says why and Copy the issue text copies it (edge cases)', () => {
  kept = { drafts: { [draftKey(1, 'title')]: 'T', [draftKey(1, 'what-happened')]: 'H' } };
  page.sent.length = 0;
  const posting = draw({ ...sampleReport('report'), posting: true, postOff: 'It\'s posting now.' });
  const wait = button(posting, 'Posting…')!;
  assert.deepEqual([wait.disabled, wait.title], [true, 'It\'s posting now.']);
  const posted = draw(sampleReport('report-posted'));
  assert.match(posted.all('report-state')[0]!.textContent, /Posted.*Open the issue on GitHub/);
  assert.equal(posted.all('report-state')[0]!.getAttribute('role'), 'status');
  assert.equal(button(posted, 'Copy the issue text'), undefined, 'nothing to copy once it\'s posted');
  assert.equal(button(posted, 'Post to GitHub')!.disabled, true);
  const denied = draw(sampleReport('report-no-access'));
  const state = denied.all('report-state')[0]!;
  assert.match(state.textContent, /can't reach the Command Center's repo/);
  button(denied, 'Copy the issue text')!.click();
  const m = sampleReport('report-no-access');
  assert.deepEqual(page.sent, [{ type: 'report-copy', text: issueText('T', { 'what-happened': 'H', expected: '', attached: m.attached }) }]);
  assert.equal(button(denied, 'Post to GitHub')!.disabled, false, 'it can be posted again');
});

test('Post\'s reasons: the model\'s own first, then a title, then what happened (edge cases)', () => {
  const m = sampleReport('report');
  const f = { 'what-happened': '', expected: '', attached: '' };
  assert.equal(postOff({ ...m, postOff: 'It\'s posted.' }, 'T', { ...f, 'what-happened': 'x' }), 'It\'s posted.');
  assert.equal(postOff(m, '  ', f), 'Give it a title');
  assert.equal(postOff(m, 'T', { ...f, 'what-happened': ' ' }), 'Say what happened');
  assert.equal(postOff(m, 'T', { ...f, 'what-happened': 'x' }), null);
});
