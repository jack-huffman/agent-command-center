import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import {
  buildWalkthroughs, commandLink, COMMANDS, contextKey, EXTENSION_ID, hasPlaceholder, initCommand, isComplete, isWebviewMenuContext, mediaPath,
  productionOrgs, setupOrgChoices, statusText, stepDescription, summarize, walkthroughSteps, type DoctorItem,
} from '../src/logic.ts';
import { staleFiles } from '../scripts/generate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const step = (id: string) => STEPS.find((s) => s.id === id)!;
const links = (md: string) => [...md.matchAll(/\[([^\]]+)\]\(command:([\w.]+)(?:\?([^)]+))?\)/g)].map((m) => ({ label: m[1], command: m[2], args: m[3] ? JSON.parse(decodeURIComponent(m[3])) : [] }));

test('the committed walkthrough matches the step list (run npm run build if this fails)', () => {
  assert.deepEqual(staleFiles(), []);
  assert.deepEqual(manifest.contributes.walkthroughs, buildWalkthroughs(STEPS));
});

test('the manifest identifies the extension the walkthrough commands open', () => {
  assert.equal(`${manifest.publisher}.${manifest.name}`, EXTENSION_ID);
  assert.equal(manifest.main, './dist/extension.js');
});

test('machine and project walkthroughs hold every step except planned ones', () => {
  const [machine, project] = buildWalkthroughs(STEPS);
  const ids = [...machine!.steps, ...project!.steps].map((s) => s.id);
  assert.deepEqual(ids, walkthroughSteps(STEPS).map((s) => s.id));
  assert.ok(!ids.includes('A4.plugin') && !ids.includes('B11.drift'), 'planned steps stay out');
  assert.ok(machine!.steps.every((s) => s.id.startsWith('A')));
  assert.ok(project!.steps.every((s) => s.id.startsWith('B')));
  assert.equal(new Set(ids).size, ids.length);
});

test('every step ticks itself from its own context key, and Salesforce-only steps hide for generic projects', () => {
  for (const wt of buildWalkthroughs(STEPS)) {
    for (const s of wt.steps) {
      assert.deepEqual(s.completionEvents, [`onContext:${contextKey(s.id)}`]);
      const sfOnly = step(s.id).profiles?.includes('salesforce') && !step(s.id).profiles?.includes('generic');
      assert.equal(s.when, sfOnly ? 'acc.profile != generic' : undefined, s.id);
      assert.ok(existsSync(join(root, mediaPath(s.id))), `${s.id} media`);
    }
  }
});

test('every button calls a contributed command with its step id', () => {
  const contributed = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
  for (const s of walkthroughSteps(STEPS)) {
    const ls = links(stepDescription(s));
    assert.ok(ls.length >= 1, `${s.id} has buttons`);
    for (const l of ls) {
      assert.ok(contributed.has(l.command), `${s.id}: ${l.command} isn't contributed`);
      assert.deepEqual(l.args, [s.id]);
    }
  }
});

test('buttons match what each step needs', () => {
  const labels = (id: string) => links(stepDescription(step(id))).map((l) => l.label);
  assert.deepEqual(labels('B0.config'), ['Check', 'Do it']);
  assert.deepEqual(labels('B2.identity'), ['Check', 'Do it'], 'the check supplies the exact command');
  assert.deepEqual(labels('B8.tracking'), ['Check', 'Open in Salesforce', 'Read the guide'], 'a click only a person can make');
  assert.deepEqual(labels('A3.trackers'), ['Check', 'I\'ve done this'], 'nothing here can check claude.ai connectors');
  assert.deepEqual(labels('B0.repo'), ['Check', 'Do it', 'Read the guide'], 'opens the repo beside an old folder');
});

test('internal step commands are hidden from the Command Palette', () => {
  const hidden = new Set(manifest.contributes.menus.commandPalette.filter((m: { when: string }) => m.when === 'false').map((m: { command: string }) => m.command));
  for (const c of [COMMANDS.check, COMMANDS.fix, COMMANDS.openSetup, COMMANDS.confirm]) assert.ok(hidden.has(c), c);
  for (const c of [COMMANDS.doctor, COMMANDS.machine, COMMANDS.project]) assert.ok(!hidden.has(c), c);
});

test('command links encode their arguments', () => {
  assert.equal(commandLink('Check', 'acc.step.check', ['B8.tracking']), '[Check](command:acc.step.check?%5B%22B8.tracking%22%5D)');
  assert.equal(commandLink('Open', 'acc.doctor'), '[Open](command:acc.doctor)');
});

test('commands with <placeholders> are typed but not run', () => {
  assert.equal(hasPlaceholder('sf org login web --alias "<alias>" --instance-url <My Domain URL>'), true);
  assert.equal(hasPlaceholder('git config user.name "Jane" && git config user.email "j@x.com"'), false);
  assert.equal(hasPlaceholder("printf '/*.csv\\n' >> .gitignore"), false);
  assert.equal(hasPlaceholder('acc init --profile generic'), false);
});

test('status text counts what is left, and attention means something failed', () => {
  const items: DoctorItem[] = [
    { id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: '' },
    { id: 'A3.trackers', part: 'machine', title: 'Trackers', status: 'unknown', detail: '' },
    { id: 'B8.tracking', part: 'project', title: 'Tracking', status: 'fail', detail: '' },
    { id: 'B11.drift', part: 'project', title: 'Drift', status: 'skip', detail: '' },
  ];
  const s = statusText(summarize(items, new Set()));
  assert.equal(s.text, '$(checklist) Setup: 2 to do');
  assert.equal(s.attention, true);
  assert.match(s.tooltip, /2 of 4 setup steps done. Next: Tracking \(B8.tracking\)/);
  const confirmed = statusText(summarize(items.filter((i) => i.status !== 'fail'), new Set(['A3.trackers'])));
  assert.equal(confirmed.text, '$(check) Setup done');
  assert.equal(isComplete('skip'), true);
  assert.equal(isComplete('unknown', true), true);
  assert.equal(isComplete('fail'), false);
});

test('Open in Salesforce offers Developer sandboxes for tracking, and the default org first otherwise', () => {
  const envs = [
    { name: 'Production', type: 'production', org: 'P', default: false },
    { name: 'Sandbox', type: 'partial', org: 'S', default: false },
    { name: 'Aleysian', type: 'developer', org: 'A', default: true },
    { name: 'Train', type: 'developer', org: null, default: false },
  ];
  assert.deepEqual(setupOrgChoices('B8.tracking', envs).map((e) => e.name), ['Aleysian']);
  assert.deepEqual(setupOrgChoices('B6.org-match', envs).map((e) => e.name)[0], 'Aleysian');
});

test('acc init offers only logged-in Production orgs', () => {
  const list = { status: 0, result: {
    nonScratchOrgs: [
      { alias: 'Acme Production', instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false },
      { alias: 'Acme Dev', instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com', isSandbox: true },
    ],
    other: [{ alias: 'Acme Production', instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false }],
    scratchOrgs: [{ alias: 'scratch', instanceUrl: 'https://x.my.salesforce.com', isSandbox: false, isScratch: true }],
  } };
  assert.deepEqual(productionOrgs(list), ['Acme Production']);
  assert.equal(initCommand('salesforce', 'Acme Production'), 'acc init --profile salesforce --production-org "Acme Production"');
  assert.equal(initCommand('generic'), 'acc init --profile generic');
});

test('a webview menu passes its row context, which is told apart from a sidebar node', () => {
  assert.ok(isWebviewMenuContext({ webviewSection: 'agent', accRef: { session: 's1' }, webview: 'acc.agents' }));
  assert.ok(!isWebviewMenuContext({ kind: 'agent', session: {} }));
  assert.ok(!isWebviewMenuContext(undefined));
  assert.ok(!isWebviewMenuContext('acc.agents'));
});
