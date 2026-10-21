// The task page at narrow widths and its one status (T-41): read from the page's styles and the drawn source.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { styleFile } from '../scripts/styles.ts';
import { pageSource } from './support.ts';

const css = styleFile('task-page.css');
const narrow = css.slice(css.indexOf('@media (max-width: 760px)'), css.indexOf('.ticket-main h2'));
const order = (sel: string) => Number(new RegExp(`${sel.replace('.', '\\.')} \\{ order: (-?\\d+); \\}`).exec(narrow)?.[1]);

test('at 760 px and below the Agent panel comes first, then the conflict and analysis, the main column, and Details last', () => {
  assert.ok(narrow.includes('.ticket-side { display: contents; }'), 'the side column\'s panels order with the rest');
  const [agent, top, details] = [order('.side-agent'), order('.ticket-top'), order('.side-details')];
  assert.ok(agent < top && top < 0 && 0 < details, `agent ${agent}, top ${top}, main 0, details ${details}`);
});

test('the page draws its status once, as the tracker writes it, as the state chip, and Details has no Status row', () => {
  const src = pageSource('task-page.ts');
  assert.equal(src.match(/stateChip\(\{ label: m\.status\.name/g)?.length, 1, 'one state chip for the ticket');
  assert.ok(!src.includes("field('Status'") && !src.includes("detail('status'"), 'no Status row');
  assert.ok(src.includes('side-details') && src.includes('side-agent'));
  const chip = /\.state-chip \{[^}]*\}/.exec(styleFile('styles.css'))?.[0] ?? '';
  assert.ok(chip && !/text-transform/.test(chip), 'the chip keeps the tracker\'s case');
});

test('at 760 px and below the Agent panel sits where the content starts: no panel-after-panel margin reaches it (T-47)', () => {
  // The base `.side-panel + .side-panel` rule comes later in the file, so the narrow one must name the grid to outrank it.
  assert.match(narrow, /\.ticket-grid \.side-panel \+ \.side-panel \{ margin-top: 0; \}/);
  assert.ok(!/(^|\n)\s*\.side-panel \+ \.side-panel \{ margin-top: 0/.test(narrow), 'not the plain selector, which the base rule beats');
});

test('edge case: a tracker that gives no status leaves the state out of the head, with no line or dash in its place (T-91)', () => {
  const src = pageSource('task-page.ts');
  assert.ok(src.includes('let statusCtl: Child = statusEl;'));
  assert.ok(!src.includes("el('span', 'muted', '—')"), 'no dash');
});

test('the activity feed heads its days with History\'s dayName, and keeps no day namer of its own (T-70)', () => {
  const src = pageSource('task-page.ts');
  assert.match(src, /import \{ dayName \} from '\.\/days\.ts';/);
  assert.equal(src.match(/dayName\(it\.at, now\)/g)?.length, 1, 'each feed entry\'s day comes from dayName');
  // The edge case: a second, local namer would let the feed and History name one day two ways.
  assert.ok(!/function day\w*\(/.test(src), 'no local day namer');
  assert.ok(!src.includes('toLocaleDateString'), 'no date written outside dayName');
});
