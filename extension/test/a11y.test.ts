// The screenshot run's accessibility check (T-55), on made-up dumps that break one rule each, so a check that
// stopped looking can't pass. The run itself runs axe-core on the real pages in Chrome: npm run screenshot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { A11Y_EXCEPTIONS, A11Y_TAGS, A11Y_TEXT, type A11yException, axeScript, COLLECT_A11Y, excuses, type GeoA11y, incompleteSummary, judgeA11y } from '../scripts/a11y.ts';
import { CHECKS, COLLECT_GEOMETRY, type GeoSnapshot, GEOMETRY_EXCEPTIONS, geometrySummary, judge, type Render, runFloor, runFailures } from '../scripts/geometry.ts';
import { pageFor, PAGES, sampleModel, TAB_TITLES, viewOf } from '../scripts/screenshot.ts';
import { pageSource, root } from './support.ts';

const part = (o: Partial<GeoA11y> = {}): GeoA11y => ({ violations: [], examined: 40, incomplete: [], ...o });
const twoBroken = (): GeoA11y => part({
  violations: [
    { rule: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', nodes: [{ selector: 'button.icon', text: '' }] },
    { rule: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', nodes: [{ selector: '.lane > .hint', text: 'Nothing here yet' }] },
  ],
});
/** A drawing that passes every geometry check, with what axe found on it. */
const drawing = (a11y: GeoA11y | undefined): GeoSnapshot => ({
  controls: [{ what: 'button.a', text: 'a', box: { x: 0, y: 0, w: 80, h: 24 }, inside: [], layer: null }], texts: [{ what: 'span', text: 'words', over: 0, ellipsis: false, titled: false, folded: false }],
  tab: null, doc: { scroll: 1000, view: 1000 }, scrollers: [], said: [{ what: 'span', text: 'words', work: null }], a11y,
});
const exception = (o: Partial<A11yException> = {}): A11yException => ({ name: 'the hint', rule: 'color-contrast', what: /\.hint$/, reason: 'made up for the test', ...o });

test('a dump with two violations gives two findings, each naming the rule, its impact, the selector and the text (T-55)', () => {
  const j = judgeA11y(twoBroken(), []);
  assert.deepEqual(j.findings, [
    { what: 'button.icon', detail: 'button-name (critical): Buttons must have discernible text' },
    { what: '.lane > .hint', detail: 'color-contrast (serious): Elements must meet minimum color contrast ratio thresholds: "Nothing here yet"' },
  ]);
  assert.equal(j.examined, 40);
  // judge makes each an a11y violation, and the run names the page, theme and width with it.
  const v = judge(drawing(twoBroken()), false, [], true, null, []);
  assert.deepEqual(v.violations.map((x) => `${x.check}: ${x.what}`), ['a11y: button.icon', 'a11y: .lane > .hint']);
  assert.equal(v.examined.a11y, 40);
  const renders: Render[] = [{ page: 'tasks', theme: 'light', width: 620, verdict: v }];
  assert.deepEqual(runFailures(renders, false, [], runFloor(), [], []), [
    'tasks light 620px: a11y: button.icon: button-name (critical): Buttons must have discernible text',
    'tasks light 620px: a11y: .lane > .hint: color-contrast (serious): Elements must meet minimum color contrast ratio thresholds: "Nothing here yet"',
  ]);
  assert.ok(CHECKS.includes('a11y'), 'a11y is one of the checks');
});

test('a drawing where axe examined no node fails, and so does one with no a11y part, or one where axe failed to run (T-55)', () => {
  assert.deepEqual(judgeA11y(part({ examined: 0 }), []).findings, [{ what: 'the page', detail: 'axe examined no node' }]);
  assert.deepEqual(judgeA11y(undefined, []).findings, [{ what: 'the page', detail: 'axe examined no node, and the page wrote no a11y part' }]);
  assert.deepEqual(judgeA11y(part({ examined: 0, error: 'axe is not on the page' }), []).findings, [{ what: 'the page', detail: 'axe examined no node: axe is not on the page' }]);
  assert.deepEqual(judge(drawing(undefined), false, [], true, null, []).violations.map((x) => `${x.check}: ${x.what}: ${x.detail}`), ['a11y: the page: axe examined no node, and the page wrote no a11y part']);
  assert.deepEqual(judge(drawing(part()), false, [], true, null, []).violations, [], 'one where axe looked and found nothing passes');
});

test('an exception excuses only its rule on the selector or text it names, and counts what it excused (T-55)', () => {
  const a = part({
    violations: [
      { rule: 'color-contrast', impact: 'serious', help: 'contrast', nodes: [{ selector: '.lane > .hint', text: 'a' }, { selector: '.lane > .hint-2', text: 'b' }, { selector: 'span.x', text: 'ends in .hint' }] },
      { rule: 'link-name', impact: 'serious', help: 'links', nodes: [{ selector: 'a.hint', text: '' }] },
    ],
  });
  const j = judgeA11y(a, [exception()]);
  assert.deepEqual(j.findings.map((f) => f.what), ['.lane > .hint-2', 'a.hint'], 'another selector, and another rule on a selector it names');
  assert.deepEqual(j.excused, { 'the hint': 2 }, 'the selector it names, and a node whose text it names');
  assert.deepEqual(judgeA11y(part(), [exception()]).excused, { 'the hint': 0 }, 'an exception with nothing to excuse counts none');
  // judge keeps the a11y exceptions' counts with the geometry exceptions'.
  assert.deepEqual(judge(drawing(a), false, [], true, null, [exception()]).excused, { 'the hint': 2 });
  assert.equal(excuses(exception(), 'color-contrast', { selector: 'p', text: 'x.hint' }), true);
  assert.equal(excuses(exception(), 'link-name', { selector: '.hint', text: '' }), false);
});

test('an exception that excused nothing fails a whole run, but not a run of a few pages (T-55)', () => {
  const v = judge(drawing(part()), false, [], true, null, [exception()]);
  const renders: Render[] = [{ page: 'agents', theme: 'dark', width: 1000, verdict: v }];
  const floor = Object.fromEntries(CHECKS.map((c) => [c, 0])) as ReturnType<typeof runFloor>;
  assert.deepEqual(runFailures(renders, true, [], floor, [], [exception()]), ['The exception for the hint excused nothing: take it off A11Y_EXCEPTIONS.']);
  assert.deepEqual(runFailures(renders, false, [], floor, [], [exception()]), []);
  const used = judge(drawing(twoBroken()), false, [], true, null, [exception()]);
  assert.deepEqual(runFailures([{ ...renders[0]!, verdict: used }], true, [], floor, [], [exception()]).filter((f) => f.includes('excused nothing')), [], 'one that excused a node stays');
  assert.ok(runFailures(renders, true, [], { ...floor, a11y: 41 }, [], []).includes('The run examined 40 for a11y, below its floor of 41.'), 'a whole run below its a11y floor fails');
});

test('an incomplete result is counted by rule and makes no finding, and the run prints them by rule (T-55)', () => {
  const a = part({ incomplete: [{ rule: 'color-contrast', nodes: 3 }, { rule: 'aria-valid-attr-value', nodes: 1 }] });
  const j = judgeA11y(a, []);
  assert.deepEqual(j.findings, []);
  assert.deepEqual(j.incomplete, { 'color-contrast': 3, 'aria-valid-attr-value': 1 });
  const v = judge(drawing(a), false, [], true, null, []);
  assert.deepEqual(v.violations, []);
  assert.deepEqual(v.incomplete, { 'color-contrast': 3, 'aria-valid-attr-value': 1 });
  assert.equal(incompleteSummary([v.incomplete, { 'color-contrast': 2 }]), 'color-contrast 5, aria-valid-attr-value 1', 'most first, summed over drawings');
  assert.equal(incompleteSummary([]), 'none', 'a run with none says so');
  const renders: Render[] = [{ page: 'agents', theme: 'dark', width: 1000, verdict: v }];
  assert.match(geometrySummary(renders), /Incomplete in axe, by rule: color-contrast 3, aria-valid-attr-value 1\./);
});

test('the page the run writes holds axe\'s script before the harness\'s own, and only when it measures (T-55)', () => {
  const model = sampleModel('tasks');
  const page = pageFor('tasks', 'dark', model, 'light', false, true);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  assert.ok(scripts.length >= 2, `${scripts.length} inline scripts`);
  assert.equal(scripts[0], axeScript(), 'axe first, whole');
  assert.ok(scripts[1]!.includes('const MODEL') && scripts[1]!.includes(COLLECT_A11Y) && scripts[1]!.includes('collectGeometry(collectA11y, '), 'then the harness, which runs axe once it has measured');
  assert.ok(axeScript().length > 100_000 && axeScript().includes('axe'), 'axe-core\'s whole script, from node_modules');
  assert.ok(!/<\/script/i.test(axeScript()), 'nothing in it can close its element');
  assert.ok(!pageFor('tasks', 'dark', model).includes(axeScript()), 'a page drawn for the colour check doesn\'t load axe');
  assert.match(page, /<title>Command Center<\/title>/, 'and the page has a title, as the tab does');
  assert.deepEqual(TAB_TITLES, { home: 'Command Center', ticket: 'Ticket', agent: 'Agent', conversation: 'ACME-21 · Plan conversation', report: 'Report a problem' }, 'the titles htmlFor in panels.ts gives, and the conversation\'s and report\'s panels pass it');
  assert.ok(readFileSync(join(root, 'src', 'panels.ts'), 'utf8').includes("title = kind === 'ticket' ? 'Ticket' : kind === 'agent' ? 'Agent' : 'Command Center'"), 'which is where they come from');
  assert.match(pageFor('ticket', 'dark', sampleModel('ticket'), 'light', false, true), /<title>Ticket<\/title>/);
  assert.match(pageFor('report', 'dark', sampleModel('report'), 'light', false, true), /<title>Report a problem<\/title>/);
});

test('every page the run draws has a title, so none is named undefined (edge case: a kind of tab added after the titles were written)', () => {
  // One page of each kind of tab, drawn as the run draws it.
  const first = new Map(PAGES.map((p) => [viewOf(p), p] as const).reverse());
  assert.ok(first.size >= 5, `${first.size} kinds of tab`);
  for (const [view, kind] of first) {
    assert.ok(TAB_TITLES[view], `the ${view} tab has a title`);
    assert.ok(pageFor(kind, 'dark', sampleModel(kind)).includes(`<title>${TAB_TITLES[view]}</title>`), kind);
  }
  assert.deepEqual(A11Y_TAGS, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'], 'the rules for WCAG 2.1 AA');
  assert.ok(PAGES.length > 0);
});

/** The theme's variables on <html> in dumpWith's page: one --vscode-* colour, written as the theme writes it, and one of the page's own. */
const THEME: Record<string, string> = { '--vscode-charts-blue': '#3794FF', '--vscode-input-border': '#3c3c3c', '--blue': '#3794ff' };

/**
 * Runs the page's collectors on a document with nothing on it, and axe answering with results, and returns
 * the dump it writes. The page computes a colour as it was written, in lower case.
 */
async function dumpWith(results: unknown, axe = true): Promise<Record<string, unknown>> {
  const written: { textContent?: string }[] = [];
  const probe = { style: { color: '' }, removed: 0, remove() { this.removed++; } };
  const document = {
    body: { querySelectorAll: () => [], append: (e: { textContent?: string }) => written.push(e) },
    documentElement: { clientWidth: 1000, scrollWidth: 1000 }, querySelectorAll: () => [], querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({}), createElement: (tag: string) => (tag === 'i' ? probe : {}),
  };
  const computed = (e: unknown) => (e === document.documentElement ? Object.assign(Object.keys(THEME), { getPropertyValue: (p: string) => ` ${THEME[p]} ` }) : e === probe ? { color: probe.style.color.toLowerCase() } : {});
  const window = { innerHeight: 900, scrollY: 0, ...(axe ? { axe: { run: async (doc: unknown, options: unknown) => { assert.equal(doc, document); assert.deepEqual(options, { runOnly: { type: 'tag', values: [...A11Y_TAGS] }, elementRef: true }); if (results instanceof Error) throw results; return results; } } } : {}) };
  new Function('document', 'window', 'getComputedStyle', 'NodeFilter', `${COLLECT_GEOMETRY}${COLLECT_A11Y}\ncollectGeometry(collectA11y);`)(document, window, computed, { SHOW_TEXT: 4 });
  const dumps = () => written.filter((w) => w.textContent !== undefined);
  for (let i = 0; i < 10 && !dumps().length; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(dumps().length, 1, 'the dump is written once');
  assert.equal(probe.removed, axe ? 1 : 0, 'and the element it compares colours on is taken away once axe has run');
  return JSON.parse(dumps()[0]!.textContent!.replace(/\\u003c/g, '<')) as Record<string, unknown>;
}

test('the dump the page writes has the a11y part: each violation\'s nodes, how many nodes axe examined, and the incomplete rules (T-55)', async () => {
  const node = (target: unknown[], text: string | null) => ({ target, element: text === null ? { textContent: '  an svg  part ' } : { innerText: text } });
  const long = 'x'.repeat(A11Y_TEXT + 20);
  const dump = await dumpWith({
    violations: [{ id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', nodes: [node(['button.icon'], ''), node([['my-el', '#inner'], 'span'], `  two\n words ${long}`)] }],
    passes: [{ id: 'html-has-lang', nodes: [node(['html'], 'all'), node(['main'], '')] }, { id: 'list', nodes: [node(['ul'], null)] }],
    incomplete: [{ id: 'color-contrast', nodes: [node(['.a'], 'a'), node(['.b'], 'b')] }],
  });
  assert.ok('controls' in dump && 'said' in dump, 'with the geometry the page measured');
  assert.deepEqual(dump.a11y, {
    violations: [{ rule: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', nodes: [{ selector: 'button.icon', text: '' }, { selector: 'my-el #inner span', text: `two words ${long}`.slice(0, A11Y_TEXT) }] }],
    examined: 7,
    incomplete: [{ rule: 'color-contrast', nodes: 2 }],
  });
  assert.equal(judge(dump as unknown as GeoSnapshot, false, GEOMETRY_EXCEPTIONS, false, null, []).examined.a11y, 7);
});

test('a contrast node carries its colours and the theme variable its text is drawn in, or says it has none (T-55)', async () => {
  const contrast = (target: string, fgColor: string, bgColor: string, contrastRatio: number) => ({ target: [target], element: { innerText: 'In review' }, any: [{ data: { fgColor, bgColor, contrastRatio } }] });
  const dump = await dumpWith({
    violations: [{ id: 'color-contrast', impact: 'serious', help: 'contrast', nodes: [contrast('.status.tone-blue', '#3794ff', '#2d2d2d', 4.48), contrast('.done > .strong', '#6b6b6b', '#1f1f1f', 3.09)] }],
    passes: [], incomplete: [],
  });
  const a = dump.a11y as GeoA11y;
  assert.deepEqual(a.violations[0]!.nodes.map((n) => n.colour), ['#3794ff on #2d2d2d, 4.48:1, --vscode-charts-blue', '#6b6b6b on #1f1f1f, 3.09:1, no theme colour'], 'only --vscode-* variables are the theme\'s; --blue is the page\'s own');
  const blue = exception({ name: 'charts blue', what: /--vscode-charts-blue\b/ });
  const j = judgeA11y(a, [blue]);
  assert.deepEqual(j.excused, { 'charts blue': 1 }, 'an exception may name the theme variable');
  assert.deepEqual(j.findings, [{ what: '.done > .strong', detail: 'color-contrast (serious): contrast: "In review" (#6b6b6b on #1f1f1f, 3.09:1, no theme colour)' }], 'and a finding names the colours');
  const plain = await dumpWith({ violations: [{ id: 'list', impact: 'serious', help: 'lists', nodes: [{ target: ['ol'], element: { innerText: 'x' }, any: [{ data: null }] }] }], passes: [], incomplete: [] });
  assert.deepEqual((plain.a11y as GeoA11y).violations[0]!.nodes, [{ selector: 'ol', text: 'x' }], 'a node of another rule has no colours');
});

test('a page where axe isn\'t loaded, or fails, writes an a11y part that examined nothing, with why (T-55)', async () => {
  assert.deepEqual((await dumpWith(null, false)).a11y, { violations: [], examined: 0, incomplete: [], error: 'axe is not on the page' });
  const failed = await dumpWith(new Error('boom'));
  assert.deepEqual(failed.a11y, { violations: [], examined: 0, incomplete: [], error: 'Error: boom' });
  assert.deepEqual(judgeA11y(failed.a11y as GeoA11y, []).findings, [{ what: 'the page', detail: 'axe examined no node: Error: boom' }]);
});

test('A11Y_EXCEPTIONS: each says why, names one rule, and none shares a name with a geometry exception (T-55)', () => {
  const names = [...GEOMETRY_EXCEPTIONS, ...A11Y_EXCEPTIONS].map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'names are unique across both lists, which share the excused counts');
  for (const e of A11Y_EXCEPTIONS) {
    assert.ok(e.reason.length > 20, `${e.name} says why`);
    assert.match(e.rule, /^[a-z0-9-]+$/, `${e.name} names an axe rule id`);
  }
});

test('the shared helpers keep what the check found fixed: a checklist icon is an image with a name, and a code block that scrolls takes focus (T-55)', () => {
  const dom = pageSource('dom.ts');
  // A span named with aria-label and no role is aria-prohibited-attr; without the focus, scrollable-region-focusable.
  assert.match(dom, /box\.setAttribute\('role', 'img'\);\n\s*box\.setAttribute\('aria-label', it\.checked \? 'Done' : 'Not done'\);/);
  assert.match(dom, /const pre = el\('pre', '', el\('code', '', b\.text\)\);\n\s*pre\.tabIndex = 0;/);
  // The run would find each again: no exception reaches them.
  for (const [rule, n] of [['aria-prohibited-attr', { selector: '.task > .codicon-circle-large-outline.codicon[aria-label="Not done"]', text: '' }], ['scrollable-region-focusable', { selector: 'pre', text: 'Case c = [SELECT Id FROM Case]' }]] as const) {
    assert.equal(A11Y_EXCEPTIONS.some((e) => excuses(e, rule, n)), false, `nothing excuses ${rule}`);
  }
});

/** Nodes the full run found, one or more for each exception, and the exception that excuses each first. */
const REACHED: { rule: string; node: { selector: string; text: string; colour?: string }; first: string }[] = [
  { rule: 'color-contrast', node: { selector: '.settings-now > .status.tone-blue', text: 'Connected', colour: '#3794ff on #2d2d2d, 4.48:1, --vscode-charts-blue' }, first: 'contrast: --vscode-charts-blue' },
  { rule: 'color-contrast', node: { selector: 'button[title="14 need you"] > .attention.nav-count', text: '14', colour: '#d18616 on #f8f8f8, 2.77:1, --vscode-charts-orange' }, first: 'contrast: --vscode-charts-orange' },
  { rule: 'color-contrast', node: { selector: '.side-details > dl > dt:nth-child(3)', text: 'Branch', colour: '#9d9d9d on #393939, 4.25:1, --vscode-descriptionForeground' }, first: 'contrast: --vscode-descriptionForeground' },
  { rule: 'color-contrast', node: { selector: 'article[data-key="ACME-12"] > .tcard-top > .avatar[title="Jordan Kim"][aria-label="Jordan Kim"]', text: 'JK', colour: '#4daafc on #313d48, 4.47:1, --vscode-textLink-activeForeground --vscode-textLink-foreground' }, first: 'contrast: --vscode-textLink-foreground' },
];

/**
 * Nodes the full run found before T-59, which the eight follow-up exceptions excused: the rail's tabs, task
 * cards, faded task cards, the Overview's rows, cards and lists, Settings' action buttons, and Setup's
 * progress and done steps. Each page now draws them so the check passes, and no exception reaches them.
 */
const FIXED: { rule: string; node: { selector: string; text: string; colour?: string } }[] = [
  { rule: 'color-contrast', node: { selector: '.setup-section[open=""]:nth-child(2) > ul > .done:nth-child(1) > .step-line.muted[title="Looks right."]', text: 'Looks right.', colour: '#a9a9a9 on #ffffff, 2.35:1, no theme colour' } },
  { rule: 'color-contrast', node: { selector: '.done > .card-foot > .card-meta > .mono.card-where[data-work="branch"]', text: 'task/ACME-9', colour: '#909090 on #fcfcfc, 3.11:1, no theme colour' } },
  { rule: 'color-contrast', node: { selector: 'button[title="Clean up"]', text: 'Clean up', colour: '#fcfcfc on #3d84c7, 3.84:1, no theme colour' } },
  { rule: 'color-contrast', node: { selector: 'article[data-key="ACME-8"] > .tcard-top > .tcard-key', text: 'ACME-8', colour: '#7b7b7b on #ffffff, 4.23:1, no theme colour' } },
  { rule: 'label-content-name-mismatch', node: { selector: 'button[title="14 need you"]', text: 'Tasks 14' } },
  { rule: 'label-content-name-mismatch', node: { selector: '.on', text: 'Overview 21' } },
  { rule: 'label-content-name-mismatch', node: { selector: 'article[data-key="ACME-12"]', text: 'ACME-12 JK Case escalation rules for the premium tier' } },
  { rule: 'label-content-name-mismatch', node: { selector: '.acc-hover', text: 'ACME-16 Add a field history report for Opportunity stage' } },
  { rule: 'label-content-name-mismatch', node: { selector: '.held', text: 'Moving ACME-16 Add a field history report for Opportunity stage reporting Ready' } },
  { rule: 'label-content-name-mismatch', node: { selector: 'button[data-overview-card="ready"]', text: 'Ready for an agent 3 ACME-16 next' } },
  { rule: 'label-content-name-mismatch', node: { selector: 'ol[data-overview-group="detail:needs-you"] > .openable[role="link"]:nth-child(2)', text: 'Asks a question ACME-12' } },
  { rule: 'label-content-name-mismatch', node: { selector: 'li:nth-child(2)', text: 'Asks permission ACME-14' } },
  { rule: 'label-content-name-mismatch', node: { selector: '.tone-row-blue:nth-child(3)', text: 'Ready ACME-37 Tidy the Case page layout dev Dispatch' } },
  { rule: 'label-content-name-mismatch', node: { selector: '.settings-tracker-head > .settings-tracker-actions.actions > .btn:nth-child(3)', text: 'Change place…' } },
  { rule: 'label-content-name-mismatch', node: { selector: 'div[data-about="plugin"] > .primary.btn', text: 'Update the plugin' } },
  { rule: 'list', node: { selector: 'ol[aria-label="In progress"]', text: 'Waiting on you ACME-44' } },
  { rule: 'aria-progressbar-name', node: { selector: '.progress', text: '' } },
];

/** Nodes just past an exception's edge: another colour, rule, element or selector. None is excused. */
const BEYOND: { rule: string; node: { selector: string; text: string; colour?: string } }[] = [
  { rule: 'color-contrast', node: { selector: '.status.tone-blue', text: 'In review', colour: '#6b6b6b on #1f1f1f, 3.09:1, no theme colour' } },
  { rule: 'color-contrast', node: { selector: '.lane > .hint', text: 'Nothing here', colour: '#777777 on #ffffff, 4.4:1, --vscode-editor-foreground --vscode-foreground' } },
  { rule: 'label-content-name-mismatch', node: { selector: 'button.btn', text: 'Open' } },
  { rule: 'label-content-name-mismatch', node: { selector: '.on.seg', text: 'Light' } },
  { rule: 'label-content-name-mismatch', node: { selector: 'article[data-task="ACME-13"]', text: 'ACME-13 Close duplicate leads nightly' } },
  { rule: 'label-content-name-mismatch', node: { selector: '.held > .tcard-top', text: 'Moving ACME-16' } },
  { rule: 'button-name', node: { selector: 'button[title="14 need you"]', text: 'Tasks 14' } },
  { rule: 'list', node: { selector: 'ul.tasks', text: '' } },
  { rule: 'aria-progressbar-name', node: { selector: '.progress-fill', text: '' } },
  { rule: 'link-name', node: { selector: 'li:nth-child(2)', text: '' } },
];

test('each exception in A11Y_EXCEPTIONS reaches as far as it says and no further: the nodes it excuses, pinned, and none just past its edge (T-55)', () => {
  // How many of the run's nodes each exception matches, in A11Y_EXCEPTIONS' order.
  assert.deepEqual(A11Y_EXCEPTIONS.map((e) => REACHED.filter((r) => excuses(e, r.rule, r.node)).length), [1, 1, 1, 1]);
  assert.deepEqual(REACHED.map((r) => A11Y_EXCEPTIONS.find((e) => excuses(e, r.rule, r.node))?.name), REACHED.map((r) => r.first), 'the first that matches is the one meant');
  assert.deepEqual(BEYOND.filter((b) => A11Y_EXCEPTIONS.some((e) => excuses(e, b.rule, b.node))), [], 'nothing past an edge is excused');
  for (const e of A11Y_EXCEPTIONS) assert.ok(REACHED.some((r) => r.first === e.name), `${e.name} has a node the run found`);
  // Each is a contrast exception for a theme colour, and its reason names its --vscode-* variable.
  for (const e of A11Y_EXCEPTIONS) assert.ok(/^contrast: --vscode-/.test(e.name) && e.reason.includes(e.name.slice('contrast: '.length)), `${e.name}: ${e.reason}`);
});

test('A11Y_EXCEPTIONS holds only the four theme colours, and none of the nodes the eight follow-ups excused is excused now (T-59)', () => {
  assert.deepEqual(A11Y_EXCEPTIONS.map((e) => e.name), ['contrast: --vscode-charts-blue', 'contrast: --vscode-charts-orange', 'contrast: --vscode-descriptionForeground', 'contrast: --vscode-textLink-foreground']);
  assert.equal(FIXED.length, 17, 'every node T-55 pinned for a follow-up');
  assert.deepEqual(new Set(FIXED.map((f) => f.rule)), new Set(['color-contrast', 'label-content-name-mismatch', 'list', 'aria-progressbar-name']), 'each of their rules');
  // Edge case: a faded node in no theme colour, which no theme exception may reach.
  assert.deepEqual(FIXED.filter((f) => A11Y_EXCEPTIONS.some((e) => excuses(e, f.rule, f.node))), []);
});
