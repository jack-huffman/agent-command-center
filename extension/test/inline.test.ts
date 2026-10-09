import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMarkdown, type Inline } from '../../packages/core/src/trackers/doc.ts';
import { inlineMarks } from '../webview/inline.ts';

// Lines as analyses and builder's notes write them. Core's fromMarkdown is the oracle: the page's small
// reader must give the same inlines for each.
const LINES = [
  'No marks at all.',
  '`npx prettier --check "force-app/**/*.{cls,trigger}" "force-app/**/lwc/**/*.{js,html,css}"` passes.',
  '`git diff --stat 0ad4793` lists exactly the 17 files; `git diff --name-only 0ad4793 -- \'*.xml\' \'*.json\'` is empty.',
  "The outputs must be identical, including the `'Avg {resolvedXLabel}: '` text with its trailing space.",
  'Run ``a `tick` inside`` as it is.',
  'A **bold** word, and **bold with `code` in it**.',
  'An unclosed `backtick stays as written.',
  '**Bold at the start** of a line.',
  'Renewal_Date__c is read-only for everyone but Sales Ops',
  'Ends with a code span `x`',
];

test('the page reads a line\'s inline marks as core\'s markdown does', () => {
  let n = 0;
  for (const line of LINES) {
    const doc = fromMarkdown(line);
    const want = doc.blocks[0]?.t === 'p' ? doc.blocks[0].c : null;
    assert.ok(want, `core made a paragraph of ${line}`);
    assert.deepEqual(inlineMarks(line), want, line);
    n++;
  }
  assert.equal(n, LINES.length);
  assert.ok(n >= 10);
});

// Where the page differs from core on purpose, each pinned with what each makes of it. A glob outside a
// code span is a path, not bold: core reads force-app/**/lwc/** as bold "/lwc/".
const GLOB = 'Globs outside code stay put: force-app/**/lwc/**/x.js';
const DIFFERS: { line: string; core: Inline[]; page: Inline[] }[] = [
  {
    line: GLOB,
    core: [{ t: 'text', text: 'Globs outside code stay put: force-app/' }, { t: 'text', text: '/lwc/', marks: ['strong'] }, { t: 'text', text: '/x.js' }],
    page: [{ t: 'text', text: GLOB }],
  },
];

test('each place the page differs from core is pinned, and core still differs there', () => {
  assert.ok(DIFFERS.length);
  for (const d of DIFFERS) {
    assert.deepEqual(inlineMarks(d.line), d.page, d.line);
    const doc = fromMarkdown(d.line);
    assert.ok(doc.blocks[0]?.t === 'p');
    assert.deepEqual(doc.blocks[0].c, d.core, `core changed on ${d.line}: if it now agrees, move the line to LINES`);
  }
});

test('the analysis and the builder\'s note draw their lines with those marks', async () => {
  const { readFileSync } = await import('node:fs');
  const analysis = readFileSync(new URL('../webview/analysis.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../webview/task-page.ts', import.meta.url), 'utf8');
  for (const field of ['a.criteria', 'a.assumptions', 'a.outOfScope', 'a.plan', 'a.risks', 'a.tests']) assert.match(analysis, new RegExp(`${field.replace('.', '\\.')}\\.map\\(md\\)`), field);
  assert.match(page, /el\('span', 'note-line', md\(l\)\)/);
});
