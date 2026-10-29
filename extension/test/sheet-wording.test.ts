// The wording check in the task sheet (T-148): the findings beside each acceptance criterion, as the sheet
// opens and as the extension answers the page; Save off on a hard finding; a tracker's ticket never checked;
// and the page's message checked before the extension takes it. The briefs are made up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFromWebview } from '../src/model/messages.ts';
import { area, type SheetWording, sheetWording, TASK_SHEET_WORDING, wordingChecked, wordingOff, wordingReply } from '../src/model/sheet-wording.ts';
import { taskSheet, type TaskSheetInput } from '../src/model/task-sheet.ts';

const brief = (...criteria: string[]) => ['## Goal', '', 'Regions show on each deal.', '', '## Acceptance criteria', '', ...criteria.map((c) => `- [ ] ${c}`)].join('\n');
const input = (source: 'manual' | 'jira', b: string): TaskSheetInput => ({
  project: '/repo', name: 'Tool', environments: [{ name: 'main', branch: 'main', default: true }],
  task: { id: source === 'manual' ? 'T-1' : 'ACME-7', title: 'Regions', brief: b, deps: [], environment: 'main', labels: [], notes: '', state: 'todo', source: { kind: source, key: null, url: null } },
});

test('each finding sits beside its criterion, with its line, its rule in words, its fix and what it matched', () => {
  const w = sheetWording(brief('The page shows the region.', 'Kick off the import; then stop.', 'The region is shown on the page.'));
  assert.deepEqual(w, {
    brief: brief('The page shows the region.', 'Kick off the import; then stop.', 'The region is shown on the page.'),
    checked: 3, hard: 2,
    criteria: [
      { criterion: 2, line: 8, text: 'Kick off the import; then stop.', findings: [
        { hard: true, rule: 'Phrasal verb', message: 'Soft phrasal verb. Use the single plain verb (start, contact, read, begin).', match: 'Kick off' },
        { hard: true, rule: 'Semicolon', message: 'STE bans the semicolon (Rule 8.1). Split into separate sentences.', match: ';' },
      ] },
      { criterion: 3, line: 9, text: 'The region is shown on the page.', findings: [
        { hard: false, rule: 'Passive voice', message: 'Possible passive voice. Name the actor and use an active verb, unless the actor is unknown or irrelevant.', match: 'is shown' },
      ] },
    ],
  } satisfies SheetWording);
});

test('edge case: a description that starts with blank lines counts them, so each line is the box\'s own', () => {
  const w = sheetWording(`\n\n${brief('Kick off the import.')}`);
  assert.equal(w.criteria[0]!.line, 9, 'two blank lines above the line the trimmed text puts at 7');
  assert.equal(`\n\n${brief('Kick off the import.')}`.split('\n')[8], '- [ ] Kick off the import.');
});

test('Save is off with why on a hard finding, and on with advice only', () => {
  assert.equal(wordingOff(sheetWording(brief('Kick off the import.'))), 'Fix the wording of the acceptance criteria first: 1 finding');
  assert.equal(wordingOff({ hard: 2 }), 'Fix the wording of the acceptance criteria first: 2 findings');
  assert.equal(wordingOff(sheetWording(brief('The region is shown on the page.'))), null, 'advice never stops Save');
  assert.equal(wordingOff(sheetWording(brief('The page shows the region.'))), null);
});

test('edge case: a description with no criteria, or none yet, is checked and has nothing to show', () => {
  assert.deepEqual(sheetWording(''), { brief: '', checked: 0, hard: 0, criteria: [] });
  assert.deepEqual(sheetWording('Kick off the import; then stop.'), { brief: 'Kick off the import; then stop.', checked: 0, hard: 0, criteria: [] });
  assert.equal(wordingOff(null), null, 'before the first check comes back, Save is on');
});

test('a new task and acc\'s own task open with their findings; a tracker\'s ticket is never checked', () => {
  assert.deepEqual(taskSheet({ ...input('manual', ''), task: null })!.wording, { brief: '', checked: 0, hard: 0, criteria: [] });
  assert.equal(taskSheet(input('manual', brief('Kick off the import.')))!.wording!.hard, 1);
  assert.equal(taskSheet(input('jira', brief('Kick off the import.')))!.wording, undefined);
  assert.deepEqual([wordingChecked(null), wordingChecked({ source: { kind: 'manual', key: null, url: null } }), wordingChecked({ source: { kind: 'github', key: '1', url: null } })], [true, true, false]);
});

test('the extension answers the page\'s ask with the findings for the description it sent', () => {
  const m = { type: 'task-sheet-wording' as const, project: '/repo', brief: brief('Kick off the import.') };
  assert.deepEqual(wordingReply(m), { type: TASK_SHEET_WORDING, project: '/repo', wording: sheetWording(m.brief) });
});

test('edge case: the page\'s ask is checked: a missing project, a brief that is not text or is too long is ignored', () => {
  assert.ok(isFromWebview({ type: 'task-sheet-wording', project: '/repo', brief: '' }));
  assert.ok(!isFromWebview({ type: 'task-sheet-wording', brief: 'x' }));
  assert.ok(!isFromWebview({ type: 'task-sheet-wording', project: '/repo', brief: 7 }));
  assert.ok(!isFromWebview({ type: 'task-sheet-wording', project: '/repo', brief: 'x'.repeat(65537) }));
  assert.deepEqual(Object.keys(area.messages!), ['task-sheet-wording']);
});
