// Settings' Pipeline section (T-157): each project's environments in path order with org, type and protection,
// the development environment, the switch for merging on its own (on by default in a Salesforce project), and
// where each environment goes next, with the buttons a person changes each by. The model here; the page drawn
// in page-dom.ts's small document; the page in a browser, at each width and theme, is the screenshot run's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HomeModel } from '../src/model/home.ts';
import { PIPELINE_MERGE_LOOK, PIPELINE_ROLE_LOOK, pipelineMerge, pipelineProject, pipelineProjects, pipelineRole } from '../src/model/pipeline.ts';
import { sectionOfPart, SETTINGS_PARTS, settingsKey, settingsMeanings, type SettingsModel } from '../src/model/settings.ts';
import type { ProjectLike } from '../src/model/shared.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const page = pageDom();
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => undefined, setState: () => undefined });
const { renderPipeline } = await import('../webview/pipeline.ts');
const { sampleModel } = await import('../scripts/screenshot.ts');
const { sampleSettingsHub } = await import('../scripts/fixtures/settings.ts');

const NOW = Date.UTC(2026, 9, 30);
const projects = (): ProjectLike[] => sampleSettingsHub(NOW).projects;
const service = (): ProjectLike => projects().find((p) => p.config.profile === 'salesforce')!;
const portal = (): ProjectLike => projects().find((p) => p.config.profile !== 'salesforce')!;
const settings = (): SettingsModel => (sampleModel('settings-pipeline', NOW, 'dark') as HomeModel).settings;
const under = (nodes: PageElement[]): PageElement[] => nodes.flatMap((n) => [n, ...n.all()]);
const controlName = (e: PageElement): string => `${e.getAttribute('aria-label') ?? e.textContent}${e.disabled ? ' [off]' : ''}`;

test('a Salesforce project\'s pipeline lists its environments in path order, dev first and Production last, with org, type and protection, and names Dev the development environment', () => {
  const p = pipelineProject(service());
  assert.deepEqual([p.project, p.salesforce, p.development], ['Acme Service', true, 'Dev']);
  assert.deepEqual(p.envs.map((e) => [e.name, e.branch, e.org, e.typeWords, e.protected, e.role, e.next]), [
    ['Dev', 'dev', 'Acme Dev', 'Developer sandbox', false, 'development', ['QA', 'Production']],
    ['QA', 'qa', 'Acme QA', 'Partial copy sandbox', false, 'further', ['Production']],
    ['Production', 'production', 'Acme Production', 'Production', true, 'production', []],
  ]);
  for (const e of p.envs) assert.deepEqual(e.look, PIPELINE_ROLE_LOOK[e.role]);
  // The switch: on by default, with the words that say what merges, where, and never further.
  assert.deepEqual(p.merge.look, PIPELINE_MERGE_LOOK.on);
  assert.match(p.merge.meaning, /^A task whose review passed and whose own deploy to the development org passed joins the merge queue.*into the development environment's branch.*Never into Production, a protected environment or any further environment, and never a deploy past the development org.*It merges while autopilot is on\.$/);
  assert.deepEqual(p.merge.action, { command: 'acc.agents.autoMerge', label: 'Change…', icon: 'edit', arg: service().root, name: 'Change whether reviewed work merges into the development environment on its own, in Acme Service', primary: false, disabled: null });
});

test('each environment has Make it development and Next steps…: Production and the development environment can\'t be made development, and say why; a sandbox that isn\'t can', () => {
  const p = pipelineProject(service());
  const by = (name: string) => p.envs.find((e) => e.name === name)!;
  assert.deepEqual(by('Dev').actions.map((a) => [a.command, a.arg, a.name, a.disabled]), [
    ['acc.pipeline.development', `${p.root}|dev`, 'Make it development: Dev, in Acme Service', 'It is the development environment'],
    ['acc.pipeline.next', `${p.root}|dev`, 'Next steps for Dev, in Acme Service: where its work goes next', null],
  ]);
  assert.equal(by('QA').actions[0]!.disabled, null, 'QA, a partial copy that isn\'t protected, can be it');
  assert.equal(by('Production').actions[0]!.disabled, 'Production can\'t be the development environment');
  const guarded = pipelineProject({ ...service(), config: { ...service().config, environments: service().config.environments.map((e) => (e.name === 'QA' ? { ...e, protected: true } : e)) } });
  assert.equal(guarded.envs.find((e) => e.name === 'QA')!.actions[0]!.disabled, 'A protected environment can\'t be the development environment');
  assert.equal(guarded.envs.find((e) => e.name === 'QA')!.role, 'protected');
  for (const command of ['acc.pipeline.development', 'acc.pipeline.next', 'acc.agents.autoMerge']) assert.ok(PAGE_COMMANDS.includes(command), `${command} is a command the page may ask for`);
});

test('the switch off, autonomy manual, and a project that isn\'t Salesforce each show with their own words (T-157, D-083)', () => {
  const s = service();
  const off = pipelineMerge({ ...s, config: { ...s.config, autopilot: { autoMerge: false } } });
  assert.deepEqual(off.look, PIPELINE_MERGE_LOOK.off);
  assert.match(off.meaning, /^A person merges every pull request\. Turned on, .* merges into the development environment on its own\.$/);
  assert.ok(off.action, 'a person can turn it on');
  const manual = pipelineMerge({ ...s, config: { ...s.config, autonomy: 'manual' } });
  assert.deepEqual(manual.look, PIPELINE_MERGE_LOOK.held);
  assert.match(manual.meaning, /^Autonomy is manual, so autopilot doesn't run and nothing merges on its own\. A task whose review passed/);
  const generic = pipelineProject(portal());
  assert.deepEqual([generic.salesforce, generic.development, generic.merge.look, generic.merge.action], [false, 'Staging', PIPELINE_MERGE_LOOK.on, null]);
  assert.equal(generic.merge.meaning, 'Not Salesforce: Agents\' Auto-merge row says whether its pull requests merge on their own.');
  assert.deepEqual(generic.envs.map((e) => [e.name, e.role]), [['Staging', 'development'], ['Production', 'production']]);
});

test('edge case: a default that is Production, or no default, leaves no development environment, the switch is held, and every environment is a further step or Production', () => {
  const s = service();
  // The parser refuses these; a config read some other way shows what it is.
  const noDefault = pipelineProject({ ...s, config: { ...s.config, environments: s.config.environments.map((e) => ({ ...e, default: false })) } });
  assert.equal(noDefault.development, null);
  assert.deepEqual(noDefault.merge.look, PIPELINE_MERGE_LOOK.held);
  assert.match(noDefault.merge.meaning, /^No environment is the default, so there is no development environment to merge into\./);
  assert.deepEqual(noDefault.envs.map((e) => e.role), ['further', 'further', 'production']);
  assert.ok(noDefault.envs.every((e) => e.actions[0]!.disabled === (e.type === 'production' ? 'Production can\'t be the development environment' : null)));
  assert.equal(pipelineRole({ branch: 'main', type: 'none', protected: false }, null), 'further');
  assert.equal(pipelineRole({ branch: 'main', type: 'none', protected: false }, 'main'), 'development');
  assert.deepEqual(pipelineProjects([]), [], 'no project: nothing');
  assert.deepEqual(pipelineProjects(projects()).map((p) => p.project), ['Acme Service', 'Acme Portal'], 'Salesforce projects first');
});

test('Settings carries the pipeline as a part of its own section, the sample page opens at it, and its switch\'s words fold under What this means', () => {
  assert.ok((SETTINGS_PARTS as readonly string[]).includes('pipeline'));
  assert.equal(sectionOfPart('pipeline'), 'pipeline');
  assert.equal(settingsKey('pipeline'), 'settings:pipeline');
  const m = settings();
  assert.deepEqual(m.pipeline.map((p) => p.project), ['Acme Service', 'Acme Portal']);
  const ids = settingsMeanings(m).map((x) => x.id);
  for (const p of m.pipeline) assert.ok(ids.includes(`pipeline:${p.root}`), p.project);
  assert.ok(m.folded.includes(`pipeline:${m.pipeline[0]!.root}`), 'two sentences fold');
  assert.ok(m.parts.find((p) => p.id === 'pipeline')!.built);
});

test('the page draws each project\'s switch and its environments as rows in path order, the development row marked, each button named for what and whose it changes', () => {
  const m = settings();
  const nodes = renderPipeline(m) as unknown as PageElement[];
  assert.equal(nodes.length, 2);
  const groups = nodes.map((n) => n.getAttribute('aria-label'));
  assert.deepEqual(groups, ['Acme Service', 'Acme Portal']);
  const service = nodes[0]!;
  const list = under([service]).find((e) => e.tagName === 'UL')!;
  assert.equal(list.getAttribute('aria-label'), 'Acme Service\'s environments, in path order');
  const rows = under([list]).filter((e) => e.classList.contains('pipeline-env'));
  assert.deepEqual(rows.map((r) => r.getAttribute('aria-label')), ['Dev', 'QA', 'Production']);
  assert.deepEqual(rows.map((r) => r.querySelector('.pipeline-name')!.textContent), ['Devdev', 'QAqa', 'Productionproduction']);
  assert.deepEqual(rows.map((r) => r.classList.contains('role-development')), [true, false, false]);
  assert.deepEqual(rows.map((r) => r.querySelector('.pipeline-next')!.textContent), ['QA, Production', 'Production', 'nowhere further']);
  assert.deepEqual(rows.map((r) => r.querySelector('.pipeline-facts')!.textContent), ['Acme DevDeveloper sandboxgoes next to QA, Production', 'Acme QAPartial copy sandboxgoes next to Production', 'Acme ProductionProductiongoes next to nowhere further'], 'org, type and next steps on one line');
  const buttons = under([service]).filter((e) => e.tagName === 'BUTTON').map(controlName);
  assert.deepEqual(buttons, [
    'Change whether reviewed work merges into the development environment on its own, in Acme Service',
    'Make it development: Dev, in Acme Service [off]', 'Next steps for Dev, in Acme Service: where its work goes next',
    'Make it development: QA, in Acme Service', 'Next steps for QA, in Acme Service: where its work goes next',
    'Make it development: Production, in Acme Service [off]', 'Next steps for Production, in Acme Service: where its work goes next',
  ]);
  // Each name holds its button's visible words (WCAG 2.5.3), so a voice user can say what they see.
  for (const b of under([service]).filter((e) => e.tagName === 'BUTTON')) assert.ok(b.getAttribute('aria-label')!.includes(b.textContent.replace(/…$/, '')), `${b.textContent} is in ${b.getAttribute('aria-label')}`);
  // Each button that can be used asks the extension for its command, with the project and environment.
  page.sent.length = 0;
  for (const b of under([service]).filter((e) => e.tagName === 'BUTTON' && !e.disabled)) b.click();
  assert.deepEqual(page.sent.map((s) => [(s as { command: string }).command, (s as { arg?: string }).arg]), [
    ['acc.agents.autoMerge', m.pipeline[0]!.root], ['acc.pipeline.next', `${m.pipeline[0]!.root}|dev`], ['acc.pipeline.development', `${m.pipeline[0]!.root}|qa`], ['acc.pipeline.next', `${m.pipeline[0]!.root}|qa`], ['acc.pipeline.next', `${m.pipeline[0]!.root}|production`],
  ]);
  // The generic project has no Change… on its switch: Agents' Auto-merge row is where it changes.
  assert.ok(!under([nodes[1]!]).some((e) => e.tagName === 'BUTTON' && e.getAttribute('aria-label')?.startsWith('Change whether')));
  // Every state drawn has an icon and a label.
  for (const s of under(nodes).filter((e) => e.classList.contains('status'))) assert.ok(s.querySelector('.codicon') && s.textContent.trim(), 'an icon and a label');
  assert.deepEqual(renderPipeline({ ...m, pipeline: [] }), [], 'edge case: no project draws nothing');
});
