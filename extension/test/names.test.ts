// Each control's name holds what it shows, and faded text still reads (T-59). The screenshot run's axe check
// is the oracle on the drawn pages; these tests pin each fix where it's made, with no browser, and words()
// splits a name as axe's label-content-name-mismatch does, so a name that axe would fail fails here too.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cssRules, styleFile } from '../scripts/styles.ts';
import { PAGES, sampleModel } from '../scripts/screenshot.ts';
import { sampleAbout, sampleAboutBehind } from '../scripts/fixtures/about.ts';
import { aboutModel, type AboutFacts } from '../src/model/about.ts';
import { cloudSetting, githubAccount } from '../src/model/settings.ts';
import { pageSource } from './support.ts';

// The page's modules read these as they load: a stand-in, as rail-fonts.test.ts has.
Object.assign(globalThis, {
  document: { addEventListener() {}, createElement: () => ({}), getElementById: () => ({}), body: { dataset: {} } },
  acquireVsCodeApi: () => ({ postMessage() {}, getState: () => undefined, setState() {} }),
});
const { tabName } = await import('../webview/rail.ts');
const { lineName } = await import('../webview/landing.ts');
const { KEYS_DESCRIPTION } = await import('../webview/board-nav.ts');

/** A name's words as axe compares them: no parentheses, each run of what isn't a letter or a digit a space, in lower case. */
const words = (s: string): string[] => s.normalize('NFKD').replace(/\([^()]*\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').toLowerCase().trim().split(' ').filter(Boolean);
/** The shown words are in the name, in order and side by side. */
function holds(shown: string, name: string): boolean {
  const s = words(shown);
  const n = words(name);
  for (let i = 0; i + s.length <= n.length; i++) if (s.every((w, j) => n[i + j] === w)) return true;
  return false;
}

test('words() holds a name as axe does: punctuation is no word, and words run together are one, so a missing space fails (T-59 edge case)', () => {
  assert.equal(holds('Tasks 14', 'Tasks: 14 need you'), true, 'a colon is no word');
  assert.equal(holds('Change place…', 'Change where Jira gets its tickets'), false, 'a word the name hasn\'t');
  assert.equal(holds('Tasks14', 'Tasks 14, need you'), false, 'two spans drawn with no space between are one word');
  assert.equal(holds('Ready 3', 'Ready, x, 3'), false, 'not side by side');
});

test('a rail tab is named by its label and count, then its hint without the count twice; with no count, by its label (T-59)', () => {
  assert.equal(tabName({ label: 'Tasks', count: 14, hint: '14 need you' }), 'Tasks 14, need you');
  assert.equal(tabName({ label: 'Worktrees', count: 3, hint: '3 task checkouts' }), 'Worktrees 3, task checkouts');
  assert.equal(tabName({ label: 'Environments', count: null, hint: 'Branches, orgs and your GitHub account' }), 'Environments, Branches, orgs and your GitHub account');
  // Edge case: a hint that starts with another number keeps it whole.
  assert.equal(tabName({ label: 'Tasks', count: 1, hint: '14 need you' }), 'Tasks 1, 14 need you');
  for (const n of [{ label: 'Tasks', count: 14, hint: '14 need you' }, { label: 'Settings', count: null, hint: 'Appearance' }]) {
    assert.ok(holds([n.label, n.count].filter((x) => x !== null).join(' '), tabName(n)), `${tabName(n)} holds what the tab shows`);
  }
  // The tab draws a space between its label and its count, and is named by tabName.
  const rail = pageSource('rail.ts');
  assert.ok(rail.includes("n.count !== null ? ' ' : null, n.count !== null ? el('span', `nav-count"), 'the space');
  assert.ok(rail.includes("b.setAttribute('aria-label', tabName(n));"));
});

test('an Overview line stays a list item, and its link is its title, named by the title first, then its state and key; a line with no key has none (T-59)', () => {
  const look = { label: 'Asks a question', icon: 'question', tone: 'orange' as const };
  assert.equal(lineName({ title: 'Case escalation rules', id: 'ACME-12', look }), 'Case escalation rules, Asks a question, ACME-12');
  assert.equal(lineName({ title: 'Tidy the page', id: null, look }), 'Tidy the page, Asks a question');
  assert.ok(holds('Case escalation rules', lineName({ title: 'Case escalation rules', id: 'ACME-12', look })));
  const landing = pageSource('landing.ts');
  // The link role, focus, its name and what brings focus back are on the title; the li keeps its own role.
  for (const line of ["title.tabIndex = 0;", "title.setAttribute('role', 'link');", "title.setAttribute('aria-label', lineName(r));", 'title.dataset.peek = ', 'title.dataset.opens = ', "title.addEventListener('keydown'"]) assert.ok(landing.includes(line), line);
  assert.ok(!/row\.setAttribute\('role'|row\.tabIndex|row\.setAttribute\('aria-label'/.test(landing), 'nothing gives the li a role, focus or a name');
  // An Overview card keeps its title, count and line apart as words, with spaces its flex rows don't draw.
  assert.ok(landing.includes("el('span', 'lp-card-title', c.title), ' ', el('span', 'count', String(c.count))),\n    ' ', el('span', 'lp-card-line', c.line)"));
  assert.ok(holds('Ready for an agent 3 ACME-16 next', 'Ready for an agent, 3: ACME-16 next'), 'its name, as landingCard writes it, holds them');
  // The line shows its focus, as it did when it took focus itself.
  const css = cssRules(styleFile('landing.css'));
  assert.ok(css.some((r) => r.selector === '.lp-row:has(> .lp-title:focus-visible)' && r.declarations.some((d) => d.name === 'outline')));
});

test('a tracker card has no aria-label, so what it shows names it; its status and the keys\' words describe it (T-59)', () => {
  const tasks = pageSource('tasks.ts');
  const card = tasks.slice(tasks.indexOf('function trackerCard('), tasks.indexOf('function trackButton('));
  assert.ok(card.length > 100, 'trackerCard is there');
  assert.ok(!card.includes("card.setAttribute('aria-label'"), 'no name over what it shows');
  assert.ok(card.includes("card.setAttribute('aria-description', `${c.status}.`);"));
  // The board's keys add their words after it, and keep what the card said.
  assert.equal(KEYS_DESCRIPTION, 'Arrows go to other cards. Enter opens it. Space picks it up to move it.');
  assert.ok(pageSource('board-nav.ts').includes("target.setAttribute('aria-description', [target.getAttribute('aria-description'), KEYS_DESCRIPTION].filter(Boolean).join(' '));"));
});

/** Every action in a model: an object with a command, a label it shows and a name it's read by. */
function actions(o: unknown, out: { label: string; name: string }[] = []): { label: string; name: string }[] {
  if (Array.isArray(o)) for (const x of o) actions(x, out);
  else if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    if (typeof r.command === 'string' && typeof r.label === 'string' && typeof r.name === 'string') out.push({ label: r.label, name: r.name });
    for (const v of Object.values(r)) actions(v, out);
  }
  return out;
}

test('every action a page draws has a name that holds its label: every sample page, cloud builders in each state, GitHub\'s and the plugin\'s (T-59)', () => {
  const p = (github: boolean, cloud: { routine: string | null; default: 'local' | 'cloud'; quietMinutes: number; max: number } | null) => ({ name: 'P', root: '/p', branch: null, worktrees: [], config: { github: github ? { repo: 'o/r', account: 'a' } : null, environments: [], profile: 'generic', agents: { cloud } } });
  const cloud = { routine: 'trig_0123456789', default: 'local' as const, quietMinutes: 120, max: 3, review: 'local' as const };
  const id = { account: 'a', projectAccount: 'a', from: 'project', signedIn: true, projects: false, commit: 'a <a@b>', problem: null };
  const plugin = (version: string | null, enabled = true): AboutFacts['plugin'] => ({ ok: true, value: { version, enabled } });
  const facts = (over: Partial<AboutFacts>): AboutFacts => ({ ...sampleAbout(0), ...over });
  const all = [
    ...PAGES.flatMap((page) => actions(sampleModel(page))),
    ...[p(false, null), p(true, null), p(true, { ...cloud, routine: null }), p(true, cloud)].flatMap((x) => actions(cloudSetting(x as never))),
    ...actions(githubAccount(p(true, null) as never, id as never)), ...actions(githubAccount(p(true, null) as never, { ...id, signedIn: false } as never)),
    ...[sampleAboutBehind(0), facts({ plugin: plugin('0.37.0', false) }), facts({ plugin: { ok: true, value: null } })].flatMap((f) => actions(aboutModel(f, 0))),
  ];
  const labels = new Set(all.map((a) => a.label));
  // The ones that once failed are among them: none can drop out unseen.
  for (const l of ['Change tracker…', 'Update the plugin', 'Turn on', 'Set up…', 'Turn off', 'Token…', 'Default…', 'Copy the prompt', 'Trigger id…', 'Add Projects access']) assert.ok(labels.has(l), l);
  assert.deepEqual(all.filter((a) => !holds(a.label, a.name)).map((a) => `${a.label} | ${a.name}`), []);
  assert.ok(all.length > 50, `${all.length} actions`);
});

test('Setup\'s progress bar is named, and no done card, lane or step is faded with opacity, which would take its text below 4.5:1 (T-59)', () => {
  const setup = pageSource('setup.ts');
  assert.ok(setup.includes("bar.setAttribute('aria-label', 'Setup steps done');") && setup.includes("bar.setAttribute('aria-valuetext', `${m.done} of ${m.total}`);"));
  const done = (file: string, selector: RegExp) => cssRules(styleFile(file)).filter((r) => selector.test(r.selector));
  const boards = done('boards.css', /\.card\.done|\.done-col/);
  const steps = done('setup.css', /\.step\.done/);
  assert.ok(boards.length && steps.length, 'their rules are there');
  // Edge case: opacity 1 shows Check again on hover, and fades nothing.
  assert.deepEqual([...boards, ...steps].filter((r) => r.declarations.some((d) => d.name === 'opacity' && Number(d.value) < 1)).map((r) => r.selector), []);
  assert.ok(steps.some((r) => r.declarations.some((d) => d.name === 'opacity' && d.value === '1')), 'and it is still there');
  // A done card sits flat in its lane; a done step's title is the theme's muted colour.
  assert.ok(boards.some((r) => r.selector.includes('.card.done') && r.declarations.some((d) => d.name === 'background' && d.value === 'transparent')));
  assert.ok(steps.some((r) => r.selector === '.step.done .strong' && r.declarations.some((d) => d.name === 'color' && d.value === 'var(--vscode-descriptionForeground)')));
});
