// A single choice offers at most three answers and the person's own words, everywhere a person is asked (D-205).
// Only a question that ticks several lists every option. This walks the webview modules that draw a radio group, so
// a new one must say how it keeps to the rule, and the agents' schemas, so none asks for a longer list; then it draws
// a plan question with five suggested answers from a fake agent and shows three plus own words.
// Checked as `.acc/rules.md` says: this file is the check for D-205.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ANALYSIS_SCHEMA, type Analysis } from '../../packages/core/src/analyze.ts';
import { OPENING_SCHEMA } from '../../packages/core/src/plan-opening.ts';
import { TALK_SCHEMA } from '../../packages/core/src/plan-talk.ts';
import { OPTIONS_MAX, QUESTIONS_SCHEMA } from '../../packages/core/src/talk-questions.ts';
import { developmentChoices, nextStepChoices } from '../src/model/pipeline.ts';
import { MULTI_OPTIONS_MAX, questionsOf } from '../src/model/questions.ts';
import { reviewSteps } from '../src/model/review-plan.ts';
import { ticketTalk } from '../src/model/talk.ts';
import { samplePlan } from '../scripts/fixtures/analysis.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const WEBVIEW = join(import.meta.dirname, '..', 'webview');

/** Every webview module that draws a radio group, and how it keeps to the rule. A new one fails until it is named here. */
const RADIO_MODULES: Record<string, string> = {
  'questions.ts': 'an agent-made question: questionsOf (extension/src/model/questions.ts) cuts a single choice to OPTIONS_MAX; one that ticks several keeps MULTI_OPTIONS_MAX',
  'talk-questions.ts': 'the planning agent\'s questions: the model slices to OPTIONS_MAX, the card slices again by optionsMax, and own words are always last',
  'stepper.ts': 'the radios Review plan and the question card share: the cap is theirs, and each caller\'s test below draws it',
  'review-plan.ts': 'Review plan\'s steps: reviewSteps cuts a choice\'s options to OPTIONS_MAX, then Something else…; a question has its suggestion and own words',
  'palette.ts': 'navigation, not a question: the command palette\'s listbox is what typing found, to go to or run',
  'dropdown.ts': 'exempt: the Connect modal\'s lists (T-140) are things to pick from (projects, boards, teams, epics), not questions; each is one dropdown, a listbox, with a box to find a choice in a long list',
  'dispatch-sheet.ts': 'exempt: the dispatch sheet\'s model, effort and place are settings, each a short fixed list',
  'person-menu.ts': 'exempt: the person filter is a menu of the people on the project, not a question',
  'banners.ts': 'a blocked note\'s question (T-168): the banner shows its first CHOICE_MAX options, pinned to OPTIONS_MAX below, then In your own words; the test below draws a note with four options and finds three plus own words',
  'board-switch.ts': 'navigation, not a question (T-127): up to SEGMENTED_MOST boards are a row of buttons beside My work, with no radio group; past it, one menu of the boards to find and pick from, as the person filter is a menu of people. board-switch.test.ts pins both',
};

// A dropdown's list (T-140) is a single choice too, so a listbox of options counts as a radio group here.
const RADIO = /radiogroup|'radio'|"radio"|menuitemradio|'listbox'/;

test('every webview module that draws a radio group says how it keeps to three options and your own words', () => {
  const drawing = readdirSync(WEBVIEW).filter((f) => f.endsWith('.ts') && RADIO.test(readFileSync(join(WEBVIEW, f), 'utf8'))).sort();
  assert.ok(drawing.length > 0, 'the walk found radio modules');
  assert.deepEqual(drawing, Object.keys(RADIO_MODULES).sort(), 'a module drawing a radio group is named in RADIO_MODULES, and each one named still draws one');
});

/** Every `options` array a schema sets, with its path, so none is missed when a schema grows. */
function optionLists(schema: unknown, path = ''): { path: string; max: unknown }[] {
  if (!schema || typeof schema !== 'object') return [];
  return Object.entries(schema as Record<string, unknown>).flatMap(([k, v]) => [
    ...(k === 'options' && v && typeof v === 'object' && (v as { type?: unknown }).type === 'array' ? [{ path: `${path}.options`, max: (v as { maxItems?: unknown }).maxItems }] : []),
    ...optionLists(v, `${path}.${k}`),
  ]);
}

test('every schema that asks an agent for options caps them at three', () => {
  const lists = [ANALYSIS_SCHEMA, OPENING_SCHEMA, TALK_SCHEMA, QUESTIONS_SCHEMA].flatMap((s) => optionLists(s));
  assert.ok(lists.length >= 3, 'the plan\'s choices and the conversation\'s questions were found');
  for (const l of lists) assert.ok(typeof l.max === 'number' && l.max <= 3, `${l.path} says maxItems ${String(l.max)}`);
  assert.equal(OPTIONS_MAX, 3);
});

test('VS Code\'s pick of the development environment (T-157, extension/src/pipeline.ts) is a single choice: developmentChoices offers at most three sandboxes, and the pick\'s last item is the person\'s own words, an environment named by typing', () => {
  const sandbox = (i: number) => ({ branch: `sb${i}`, type: 'developer' as const, protected: false, promotesTo: i < 7 ? [`sb${i + 1}`] : [] });
  const envs = Array.from({ length: 7 }, (_, i) => sandbox(i + 1));
  const { offered, more } = developmentChoices({ environments: envs }, null);
  assert.ok(envs.length > OPTIONS_MAX, 'more sandboxes than a single choice shows');
  assert.equal(offered.length, OPTIONS_MAX);
  assert.equal(more, envs.length - OPTIONS_MAX, 'the rest are typed by name');
  // The command itself: the pick's items are the offered ones and one more for own words, then an input box.
  const command = readFileSync(join(import.meta.dirname, '..', 'src', 'pipeline.ts'), 'utf8');
  assert.ok(command.includes('developmentChoices(project.config') && command.includes('showInputBox'), 'the command picks through developmentChoices and takes a typed name');
});

test('VS Code\'s pick of which environment\'s next steps to change (T-157, extension/src/pipeline.ts) is a single choice: nextStepChoices offers three in path order, and the rest are typed by name', () => {
  const env = (i: number) => ({ branch: `e${i}`, promotesTo: i < 6 ? [`e${i + 1}`] : [] });
  const envs = Array.from({ length: 6 }, (_, i) => env(i + 1));
  const { offered, more } = nextStepChoices({ environments: envs });
  assert.equal(offered.length, OPTIONS_MAX);
  assert.equal(more, envs.length - OPTIONS_MAX);
  assert.deepEqual(nextStepChoices({ environments: envs.slice(0, 2) }).offered.length, 2, 'edge case: two stay two');
  const command = readFileSync(join(import.meta.dirname, '..', 'src', 'pipeline.ts'), 'utf8');
  assert.ok(command.includes('nextStepChoices(project.config)'), 'the command picks through nextStepChoices');
});

const ask = (n: number, multiSelect = false) => ({ questions: [{ question: 'Which?', header: 'h', multiSelect, options: Array.from({ length: n }, (_, i) => ({ label: `o${i}`, description: '' })) }] });

test('an agent-made question: a single choice lists three, one that ticks several lists all', () => {
  assert.deepEqual(questionsOf(ask(8))[0]!.options.map((o) => o.label), ['o0', 'o1', 'o2']);
  assert.equal(questionsOf(ask(8, true))[0]!.options.length, MULTI_OPTIONS_MAX, 'ticking several keeps its options');
  assert.equal(questionsOf(ask(5, true))[0]!.options.length, 5);
  assert.equal(questionsOf(ask(0))[0]!.options.length, 0, 'edge case: a question with no options stays empty');
  assert.equal(questionsOf(ask(2))[0]!.options.length, 2, 'two stay two');
});

test('edge case: Deploy… on the Changes tab (T-158) offers three environments of the five ahead, the usual next step first, as a list of buttons, not a radio group', async () => {
  const { deployPick } = await import('../src/model/ticket-deploy.ts');
  const names = ['Dev', 'QA', 'UAT', 'Staging', 'Training', 'Production'];
  const environments = names.map((name, i) => ({ name, branch: name.toLowerCase(), type: name === 'Production' ? 'production' : 'sandbox', org: `acme-${name.toLowerCase()}`, default: i === 0, protected: false, promotesTo: names[i + 1] ? [names[i + 1]!.toLowerCase()] : [] })) as never;
  const task = { id: 'ACME-7', state: 'done', environment: 'dev', deps: [], promotions: [], deploys: [], pr: { state: 'merged' }, run: null } as never;
  const p = deployPick({ config: { profile: 'salesforce', environments, github: { repo: 'acme/app', account: 'jordan-kim' } }, task, tasks: [], deploying: null })!;
  assert.deepEqual(p.choices.map((c) => c.name), ['QA', 'UAT', 'Staging'], 'three of five, in path order');
  assert.equal(OPTIONS_MAX, 3);
  assert.doesNotMatch(readFileSync(join(WEBVIEW, 'changes.ts'), 'utf8'), RADIO, 'drawn as buttons, so RADIO_MODULES needn\'t name it');
});

test('edge case: no fourth option in Review plan: a choice with four options (an older plan) offers three, the recommended first, keeping the one chosen now', () => {
  const a = samplePlan(Date.parse('2026-10-22T12:00:00Z'), 'changed') as Analysis;
  const d = a.decisions![0]!;
  const extra = Array.from({ length: 4 - d.options.length }, (_, i) => ({ ...d.options[0]!, id: `x${i}`, name: `Extra ${i}` }));
  const four = { ...d, options: [...d.options, ...extra], recommended: d.options[0]!.id, choice: undefined };
  const offered = (decision: typeof d) => {
    const s = reviewSteps({ ...a, decisions: [decision] }, []).find((x) => x.kind === 'choice')!;
    return s.kind === 'choice' ? s.options : [];
  };
  assert.equal(offered(four).length, 3);
  assert.equal(offered(four)[0]!.id, d.options[0]!.id, 'the recommended is first');
  const last = four.options[3]!;
  const chosen = { ...four, choice: { option: last.id, text: '', by: 'me', at: '' } } as unknown as typeof d;
  assert.ok(offered(chosen).some((o) => o.id === last.id), 'edge case: the choice made stays on the list, so the dot and the radio agree');
  assert.equal(offered(chosen).length, 3);
});

pageDom();
let kept: { opened: string[]; drafts: Record<string, string> } = { opened: [], drafts: {} };
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => kept, setState: (s: typeof kept) => { kept = s; } });
const { renderConversation } = await import('../webview/talk.ts');
const { state } = await import('../webview/state.ts');
state.draw = () => {};

test('with a fake agent that suggests five answers: the card shows three and Answer in my own words', () => {
  kept = { opened: [], drafts: {} };
  const five = ['One', 'Two', 'Three', 'Four', 'Five'];
  const talk = { v: 1 as const, task: 'ACME-21', turns: [
    { id: 't1', who: 'you' as const, by: 'human:me', at: '2026-10-22T11:50:00.000Z', version: 0, text: 'Do it.' },
    { id: 't2', who: 'agent' as const, by: 'analyst:ACME-21', at: '2026-10-22T11:51:00.000Z', version: 0, text: 'Which one?', questions: [{ question: 'Which one?', why: 'It changes the plan.', options: five }] },
  ] };
  const m = ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: null, analyzing: false, talk, running: false, open: [], ref: { project: '/p', task: 'ACME-21' } })!;
  assert.deepEqual(m.questions!.items[0]!.options.map((o) => o.label), ['One', 'Two', 'Three'], 'the model cuts to three');
  const drawn = renderConversation('/p', m) as unknown as PageElement;
  assert.deepEqual(drawn.all('rp-name').map((x) => x.textContent), ['OneSuggested', 'Two', 'Three', 'Answer in my own words']);
  // The card cuts too, were the model to hand it more.
  const wide = { ...m, questions: { ...m.questions!, items: [{ ...m.questions!.items[0]!, options: five.map((label) => ({ label, suggested: false })) }] } };
  const again = renderConversation('/p', wide) as unknown as PageElement;
  assert.equal(again.all('rp-radio').length, 4, 'three answers and own words: never a fourth answer');
});
