// A Connect modal list as a dropdown (T-140): the words on its button, the choices its box finds, one choice
// sending its value, ticks sending every value ticked, and the whole project unticking them. The browser
// behaviour case "connect: the board under the dropdowns" drives it with keys and clicks; this draws it in a
// small document, as board-switch.test.ts draws the board switch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConnectPicker } from '../src/model/connect.ts';
import { sampleConnect } from '../scripts/fixtures/connect.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const page = pageDom();
const { dropChoices, dropText, pickerDropdown } = await import('../webview/dropdown.ts');

const m = sampleConnect('jira-board');
const picker = (key: string): ConnectPicker => m.pickers.find((p) => p.key === key)!;
const drawn = (p: ConnectPicker) => pickerDropdown(m, p, `connect-${p.key}`) as unknown as PageElement;
const options = (d: PageElement) => d.all('cdrop-option');

test('the button names the choice, the choices ticked, or the whole project when none is', () => {
  assert.equal(dropText(picker('board')), 'ACME Service board');
  assert.equal(dropText(picker('epics')), 'ACME-31');
  assert.equal(dropText({ ...picker('epics'), selected: [] }), 'The whole ACME project');
  assert.equal(dropText({ ...picker('epics'), selected: ['ACME-31', 'ACME-30', 'ACME-28', 'ACME-27'] }), 'ACME-31, ACME-30 and 2 more', 'edge case: many ticked are cut to two and a count');
  assert.equal(dropText({ whole: null, options: [], selected: [], multi: false }), 'Choose one', 'edge case: nothing chosen and no whole project');
});

test('the box finds choices by name or detail, keeps the whole project, and finds none for words nothing has', () => {
  const epics = picker('epics');
  assert.deepEqual(dropChoices(epics, '').map((c) => c.value), ['', ...epics.options.map((o) => o.value)]);
  assert.deepEqual(dropChoices(epics, 'PARTNER').map((c) => c.value), ['', 'ACME-30'], 'by its detail, whatever the case');
  assert.deepEqual(dropChoices(epics, 'acme-19').map((c) => c.value), ['', 'ACME-19'], 'by its name');
  assert.deepEqual(dropChoices(epics, 'no such epic').map((c) => c.value), [''], 'edge case: only the whole project is left');
});

test('one choice sends its value; the whole project sends none; a list off can\'t be opened', () => {
  const board = drawn(picker('board'));
  page.sent.length = 0;
  options(board).find((o) => o.dataset.value === '9')!.click();
  assert.deepEqual(page.sent, [{ type: 'connect-pick', key: 'board', value: '9', session: m.id }]);
  page.sent.length = 0;
  options(board).find((o) => o.dataset.value === '7')!.click();
  assert.deepEqual(page.sent, [], 'edge case: the choice already made sends nothing');
  const off = drawn({ ...picker('board'), disabled: true });
  assert.equal(off.all('cdrop-btn')[0]!.disabled, true);
});

test('ticks send every value ticked, unticking one leaves the rest, and the whole project unticks them all', () => {
  const epics = drawn(picker('epics'));
  const tick = (v: string) => options(epics).find((o) => o.dataset.value === v)!.click();
  page.sent.length = 0;
  tick('ACME-30');
  tick('ACME-31');
  tick('');
  assert.deepEqual(page.sent.map((x) => (x as { value: unknown }).value), [['ACME-31', 'ACME-30'], [], []]);
  const on = options(epics).filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.dataset.value);
  assert.deepEqual(on, ['ACME-31'], 'the one chosen is marked for a screen reader, not only by its tick');
  assert.equal(epics.all('cdrop-find').length, 1, 'more than SEARCH_FROM epics: a box to find one');
  assert.equal(drawn(picker('board')).all('cdrop-find').length, 0, 'a short list has none');
});
