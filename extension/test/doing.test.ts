// What an agent is doing (T-164): one table of activities, read from a session's latest steps, said on the Agents
// page's cards, in a task's Agent panel, in In progress and in the status bar, with the step behind it in process
// words. The cards are drawn in page-dom.ts's small document; at each width and theme they're the screenshot run's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ACTIVITIES, ACTIVITY_KEYS, activityOf, RECENT_STEPS, sessionDoing, type ToolStep } from '../src/logic/doing.ts';
import { agentLook } from '../src/logic/agents.ts';
import type { AgentSession } from '../src/logic/shared.ts';
import { statusSummary } from '../src/logic/status.ts';
import { agentsModel } from '../src/model/agents.ts';
import { cssRules } from '../scripts/styles.ts';
import { SAMPLE_STEPS, sampleStepOf } from '../scripts/fixtures/agents.ts';
import { sampleSettingsHub } from '../scripts/fixtures/settings.ts';
import { pageDom, type PageElement } from './page-dom.ts';
import { root, row } from './support.ts';

pageDom();
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} });
const { renderAgents } = await import('../webview/agents.ts');
const { stateGlance } = await import('../webview/agent-glance.ts');

const bash = (command: string): ToolStep => ({ tool: 'Bash', command });
const busy: AgentSession = { cwd: '/w/acme/.claude/worktrees/AC-1', kind: 'background', startedAt: 1, id: 'b1', sessionId: 's1', state: 'working', pid: 4 };

/** Each activity, a step that is it, and the words its hover says. */
const EACH: [string, ToolStep[], string | null, string][] = [
  ['planning', [], 'analysis', 'Making a plan: reading the ticket and the code'],
  ['researching', [{ tool: 'Read', path: 'src/a.ts' }], null, 'Reading src/a.ts'],
  ['building', [{ tool: 'Edit', path: 'extension/webview/agents.ts' }], null, 'Editing extension/webview/agents.ts'],
  ['testing', [bash('acc gate run')], null, 'Running the checks'],
  ['deploying', [bash('acc gate run deploy')], null, 'Deploying its branch to its own org'],
  ['committing', [bash('git commit -m "x"')], null, 'Committing its work'],
  ['reviewing', [{ tool: 'Edit', path: 'a.ts' }], 'review', 'Reviewing the branch'],
  ['working', [{ tool: 'TodoWrite' }], null, ''],
];

test('one table holds each activity\'s words and icon, and each is what a step of its kind says (T-164)', () => {
  assert.deepEqual(EACH.map(([k]) => k), [...ACTIVITY_KEYS], 'a case for every activity, in the table\'s order');
  for (const [key, steps, role, tip] of EACH) {
    const a = activityOf(steps, role);
    assert.equal(a.key, key, key);
    assert.deepEqual({ label: a.label, icon: a.icon }, ACTIVITIES[key as keyof typeof ACTIVITIES], `${key}: its words and icon are the table's`);
    assert.equal(a.detail ?? '', tip, `${key}: its hover`);
  }
  assert.deepEqual(Object.values(ACTIVITIES).map((a) => a.label), ['Planning', 'Researching', 'Building', 'Testing', 'Deploying', 'Committing', 'Reviewing', 'Working']);
  assert.equal(new Set(Object.values(ACTIVITIES).map((a) => a.icon)).size, ACTIVITY_KEYS.length, 'each its own icon, so the label isn\'t all that tells them apart');
});

test('a step the table doesn\'t know says Working, and so does a session with no steps read yet (T-164)', () => {
  for (const steps of [[], [{ tool: 'TodoWrite' }], [bash('brew install gh')], [{ tool: 'Skill' }, { tool: 'Bash', command: null }]] as ToolStep[][]) {
    const a = activityOf(steps);
    assert.deepEqual([a.key, a.label, a.icon, a.detail], ['working', 'Working', 'sync~spin', null], JSON.stringify(steps));
  }
  assert.equal(sessionDoing(busy, 'builder').label, 'Working', 'no stepOf: nothing read');
  assert.equal(sessionDoing(busy, 'builder', () => null).label, 'Working', 'stepOf has nothing for it yet');
  assert.equal(sessionDoing(busy, 'builder', () => ({})).label, 'Working', 'a step read before steps were kept has no recent');
  assert.equal(sessionDoing({}, 'builder', () => ({ recent: [bash('npm test')] })).label, 'Working', 'a session with no id has no transcript');
});

test('a builder that runs the tests says Testing, not Working, on its look and its card (T-164)', () => {
  // The mutant: an agentLook that ignores what it's doing, or a page that drops it, shows Working here.
  for (const command of ['npm test', 'npm run test:unit', 'cd extension && nice -n 15 npm test', 'node --test test/a.test.ts', 'sf apex run test --target-org dev', 'npm run check', '/Users/me/acc/dist/acc gate run tests']) {
    const look = agentLook(busy, null, null, sessionDoing(busy, 'builder', () => ({ recent: [bash(command)] })));
    assert.deepEqual([look.label, look.icon, look.tone, look.working], ['Testing', 'beaker', 'blue', true], command);
  }
  assert.equal(agentLook(busy, null, null, null).label, 'Working', 'without what it\'s doing, as before');
  // What needs you still comes first: a question beats what its steps say.
  assert.equal(agentLook(busy, 'has a question', null, activityOf([bash('npm test')])).label, 'Needs you: has a question');
});

test('the newest step the table knows wins: one it doesn\'t know looks further back, up to RECENT_STEPS (T-164)', () => {
  assert.equal(activityOf([{ tool: 'TodoWrite' }, { tool: 'Edit', path: 'a.ts' }]).key, 'building');
  assert.equal(activityOf([{ tool: 'Edit', path: 'a.ts' }, bash('npm test')]).key, 'building', 'newest first');
  const far = [...Array.from({ length: RECENT_STEPS }, (): ToolStep => ({ tool: 'TodoWrite' })), { tool: 'Edit', path: 'a.ts' }];
  assert.equal(activityOf(far).key, 'working', 'a step older than RECENT_STEPS isn\'t what it\'s doing now');
  // A command line: its last step the table knows, one that only reads giving way to any other.
  assert.equal(activityOf([bash('npm test && git commit -m x')]).key, 'committing');
  assert.equal(activityOf([bash('git status; npm test | tail -5')]).key, 'testing');
  assert.equal(activityOf([bash('grep -rn foo src')]).key, 'researching');
  assert.equal(activityOf([bash('sf project deploy start --dry-run -o dev')]).key, 'testing', 'a check-only deploy deploys nothing');
  assert.equal(activityOf([bash('sf project deploy start -o dev')]).key, 'deploying');
  assert.equal(activityOf([bash('acc deploy qa')]).detail, 'Deploying to qa', 'a deploy guide\'s deploy');
  assert.equal(activityOf([bash('acc done --landed x')]).key, 'committing');
  assert.equal(activityOf([bash('acc gate run --check tests')]).detail, 'Running the checks', 'a flag isn\'t a check\'s name');
});

test('the step behind an activity is in process words: no acc command, npm run or docs path reaches its hover (T-164)', () => {
  const lines = ['acc gate run', 'acc gate run tests', 'acc gate run deploy', 'acc deploy qa', 'acc done', 'npm run check', 'npm test', 'git commit -m x', 'cat docs/DESIGN.md'];
  const steps: ToolStep[][] = [...lines.map((l) => [bash(l)]), [{ tool: 'Edit', path: 'docs/DESIGN.md' }], [{ tool: 'Write', path: '.acc/config.json' }], [{ tool: 'Read', path: '.acc/rules.md' }]];
  let checked = 0;
  for (const s of steps) {
    const d = activityOf(s).detail!;
    assert.doesNotMatch(d, /\bacc [a-z]|npm run|docs\/|\.acc\//, `${JSON.stringify(s)}: ${d}`);
    checked++;
  }
  assert.equal(checked, steps.length);
  assert.equal(activityOf([{ tool: 'Edit', path: 'docs/DESIGN.md' }]).detail, 'Editing the design guide');
  assert.equal(activityOf([{ tool: 'Write', path: '.acc/config.json' }]).detail, 'Writing the project\'s settings');
});

test('the Agents page draws each agent as a card of its own, saying what it\'s doing, with no table or grey block (T-164)', () => {
  const all = agentsModel({ ...sampleSettingsHub(Date.now()), stepOf: sampleStepOf });
  // page-dom's text is plain strings, which a button's text can't replace itself in: the cards that need you,
  // with Answer and Watch, and the Finished fold's toggle are the screenshot run's to draw.
  const m = { ...all, repos: all.repos.map((r) => ({ ...r, finished: [], tasks: r.tasks.map((t) => ({ ...t, agents: t.agents.filter((a) => !a.needsYou) })) })) };
  assert.ok(m.repos.some((r) => r.tasks.some((t) => t.agents.length)), 'cards left to draw');
  const nodes = renderAgents(m) as unknown as PageElement[];
  const page = nodes.flatMap((n) => [n, ...n.all()]);
  assert.equal(page.filter((e) => e.tagName === 'TABLE').length, 0, 'no table');
  const cards = page.filter((e) => e.classList.contains('agent-card'));
  const lines = m.repos.flatMap((r) => r.tasks.flatMap((t) => t.agents));
  assert.equal(cards.length, lines.length, 'one card for each agent');
  // Each repo's name is a heading above its cards.
  const heads = page.filter((e) => e.tagName === 'H2' && e.classList.contains('agent-repo-head')).map((h) => h.all('repo-name')[0]!.textContent);
  assert.deepEqual(heads, m.repos.map((r) => r.label));
  // What each busy agent is doing: five, each different.
  const doing = cards.map((c) => c.all('agent-doing')[0]?.textContent ?? '');
  for (const word of ['Testing', 'Building', 'Deploying', 'Planning', 'Reviewing']) assert.ok(doing.includes(word), `${word} is on a card: ${doing.join(', ')}`);
  // The step behind it, on hover and to a screen reader.
  const testing = cards.find((c) => c.all('agent-doing')[0]?.textContent === 'Testing')!.all('status')[0]!;
  assert.equal(testing.title, 'Running the checks');
  assert.equal(testing.attributes.get('aria-description'), 'Running the checks');
  // The task's key and title head its card.
  const acme13 = cards.find((c) => c.all('tcard-key')[0]?.textContent === 'ACME-13')!;
  assert.match(acme13.all('agent-task')[0]!.textContent, /^ACME-13/);
  assert.equal(acme13.all('agent-doing')[0]!.textContent, 'Deploying');
  assert.ok(Object.keys(SAMPLE_STEPS).length >= 3, 'the sample has the steps it shows');
});

test('the cards sit on the page\'s own background: no fill on a repo, a card or its list, and one border, the card\'s (T-164)', () => {
  const css = readFileSync(join(root, 'webview', 'agents.css'), 'utf8');
  const rules = cssRules(css).filter((r) => /agent-(repo|cards|card|main)\b/.test(r.selector));
  assert.ok(rules.length >= 6, `read ${rules.length} rules`);
  const fills = rules.filter((r) => r.declarations.some((d) => /^background/.test(d.name)));
  assert.deepEqual(fills.map((r) => r.selector), [], 'no grey block');
  const borders = rules.filter((r) => r.declarations.some((d) => /^border(-left|-top|-bottom)?$/.test(d.name))).map((r) => r.selector);
  assert.deepEqual(borders, ['.agent-card', '.agent-card.attention'], 'the card\'s border, and its orange edge while it needs you');
  assert.ok(cssRules(css).some((r) => r.selector === '.agent-cards' && r.declarations.some((d) => d.name === 'gap')), 'space between cards');
  assert.doesNotMatch(css, /agents-grid/, 'the old table\'s rules are gone');
});

test('the Agent panel shows what a running builder is doing beside Running, and never a plain Working twice (T-164)', () => {
  const look = { label: 'Running', icon: 'sync~spin', tone: 'blue' as const };
  const building = { label: 'Building', icon: 'tools', tone: 'blue' as const, busy: true, tip: 'Editing a.ts' };
  assert.deepEqual(stateGlance({ look, state: 'running', agent: building }), { disagree: null, session: building });
  assert.deepEqual(stateGlance({ look, state: 'running', agent: { label: 'Working', icon: 'sync~spin', tone: 'blue', busy: true } }), { disagree: null, session: null });
  // A task in review whose builder is still Building disagrees, as one still Working did.
  assert.equal(stateGlance({ look: { label: 'In review', icon: 'eye', tone: 'blue' }, state: 'review', agent: building }).disagree, 'In review: its builder is still working');
  // Edge: a session that isn't busy, with no flag, isn't taken for one at work.
  assert.equal(stateGlance({ look: { label: 'In review', icon: 'eye', tone: 'blue' }, state: 'review', agent: { label: 'Idle', icon: 'circle-outline', tone: 'neutral' } }).disagree, null);
});

test('the status bar\'s tooltip says what each running task\'s agent is doing, and nothing for a plain Working (T-164)', () => {
  const s = statusSummary([
    { ...row('T-1', 'running', 'running'), agent: { label: 'Testing', icon: 'beaker', tone: 'blue', busy: true } },
    { ...row('T-2', 'running', 'running'), agent: { label: 'Working', icon: 'sync~spin', tone: 'blue', busy: true } },
    { ...row('T-3', 'running', 'running'), agent: null },
  ], 0);
  assert.match(s.tooltip, /^Running: T-1 \(Testing\), T-2, T-3$/m);
  assert.equal(s.text, '$(sync) 3 running');
});
