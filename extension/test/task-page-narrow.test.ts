// The task page at narrow widths and its one status (T-41): read from the page's styles and the drawn source.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { styleFile } from '../scripts/styles.ts';
import { pageSource } from './support.ts';

const css = styleFile('task-page.css');
const narrow = css.slice(css.indexOf('@media (max-width: 760px)'), css.indexOf('.ticket-main h2'));

/** The order a rule in the narrow block gives a selector, where it is one of a list such as `.a, .b { order: 1; }`. */
const orderOf = (sel: string): number => {
  for (const m of narrow.matchAll(/([^{}]+)\{ order: (-?\d+); \}/g)) if (m[1]!.split(',').map((s) => s.trim()).includes(sel)) return Number(m[2]);
  return 0;
};

test('at 760 px and below the facts come first: the conflict and analysis, the description, then Details and the Agent panel, then Related and Activity (T-94)', () => {
  assert.ok(narrow.includes('.ticket-side, .ticket-main { display: contents; }'), 'both columns\' sections order with the rest');
  const [top, details, agent, related, activity] = ['.ticket-top', '.side-details', '.side-panel', '.related-block', '.activity'].map(orderOf);
  assert.ok(top! < 0, `top ${top}, before the description's 0`);
  assert.ok(details! > 0 && agent === details, `Details ${details} and the Agent panel ${agent} after the description`);
  assert.ok(related! > details! && activity! > details!, `Related ${related} and Activity ${activity} after Details`);
  // The page draws the classes the order names, so a renamed class can't drop a section back to 0.
  const src = pageSource('task-page.ts');
  for (const c of ['block related-block', 'block activity', 'side-details', 'side-panel side-agent']) assert.ok(src.includes(`'${c}`) || src.includes(`\`${c}`), c);
});

test('edge case: the order check reads a rule naming one selector, or several, and gives 0 to one never named', () => {
  assert.equal(orderOf('.ticket-top'), -1);
  assert.equal(orderOf('.activity'), orderOf('.related-block'));
  assert.equal(orderOf('.description-nobody-orders'), 0);
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
