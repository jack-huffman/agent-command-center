// Setup and its walkthroughs: the steps, their buttons and commands, the orgs and templates acc init offers, and what Setup shows.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../../packages/core/src/config.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { repoKey } from '../src/logic/connect.ts';
import { afterFullCheck, afterStepCheck, buildWalkthroughs, commandLink, COMMANDS, contextKey, type DoctorItem, EXTENSION_ID, hasPlaceholder, importRulesCommand, initArgs, initCommand, initOutput, isComplete, machineCache, mediaPath, pendingProject, productionOrgs, rememberTemplate, reusableMachine, rulesDetail, setupOrgChoices, shownRules, shownTemplate, startTracker, statusText, stepDescription, stepIdOf, stepMedia, summarize, templateDetail } from '../src/logic/setup.ts';
import { needsTerminal } from '../src/logic/runs.ts';
import { staleFiles } from '../scripts/generate.ts';
import { setupModel } from '../src/model/setup.ts';
import { root, manifest, envs, row } from './support.ts';

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

test('machine and project walkthroughs hold every step, in order', () => {
  const [machine, project] = buildWalkthroughs(STEPS);
  const ids = [...machine!.steps, ...project!.steps].map((s) => s.id);
  assert.deepEqual(ids, STEPS.map((s) => s.id));
  assert.ok(ids.includes('B11.drift') && ids.includes('B13.gate-tools'), 'M4\'s steps are in');
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
  for (const s of STEPS) {
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
  assert.deepEqual(labels('B0.template'), ['Check', 'Do it', 'Read the guide'], 'Do it previews the template, writing nothing');
  assert.deepEqual(labels('B0.rules'), ['Check', 'Do it', 'Import rules…', 'Read the guide'], 'Do it shows the difference; Import rules… copies one in');
  assert.deepEqual(labels('B2.identity'), ['Check', 'Do it'], 'the check supplies the exact command');
  assert.deepEqual(labels('B8.tracking'), ['Check', 'Open in Salesforce', 'Read the guide'], 'a click only a person can make');
  assert.deepEqual(labels('B14.tickets'), ['Check', 'Do it', 'I\'ve done this', 'Read the guide'], 'Do it runs Add a tracker; a repo with no tracker can be marked done');
  assert.deepEqual(labels('B0.repo'), ['Check', 'Do it', 'Read the guide'], 'opens the repo beside an old folder');
  assert.deepEqual(labels('A2.gh-login'), ['Check', 'Do it'], 'GitHub sign-in through VSCode, nothing to confirm by hand');
  assert.deepEqual(labels('B2.account'), ['Check', 'Do it']);
  assert.deepEqual(labels('B6.org-match'), ['Check', 'Do it'], 'pick an environment; the login opens in the browser');
  assert.deepEqual(labels('A4.plugin'), ['Check', 'Do it'], 'nothing to confirm by hand: the check reads Claude Code');
});

test('the README that ships in the extension names the walkthroughs by their titles, and asks for no Node of acc\'s own', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  for (const w of buildWalkthroughs(STEPS)) assert.ok(readme.includes(w.title), w.title);
  assert.ok(!/Node 20\+/.test(readme), 'acc runs on VSCode\'s runtime (D-077)');
});

test('the acc plugin is a machine step after the GitHub login, and installs in a terminal that can ask for git credentials', () => {
  const [machine] = buildWalkthroughs(STEPS);
  const ids = machine!.steps.map((s) => s.id);
  assert.equal(ids.indexOf('A4.plugin'), ids.indexOf('A2.gh-login') + 1);
  assert.equal(machine!.steps.find((s) => s.id === 'A4.plugin')!.when, undefined, 'every profile');
  const a4 = step('A4.plugin');
  assert.ok(needsTerminal(a4.fix!.command!));
  assert.ok(needsTerminal('claude plugin install acc@agent-command-center --scope user'));
  assert.ok(needsTerminal('claude plugin enable acc@agent-command-center --scope user'));
  const media = stepMedia(a4);
  assert.ok(media.includes(`\`\`\`bash\n${a4.fix!.command}\n\`\`\``), 'its page shows the command Do it runs');
  assert.match(media, /accept the invitation/);
  assert.match(media, /start a new one/);
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
    { id: 'B14.tickets', part: 'project', title: 'Tickets', status: 'unknown', detail: '' },
    { id: 'B8.tracking', part: 'project', title: 'Tracking', status: 'fail', detail: '' },
    { id: 'B11.drift', part: 'project', title: 'Drift', status: 'skip', detail: '' },
  ];
  const s = statusText(summarize(items, new Set()));
  assert.equal(s.text, '$(checklist) Setup: 2 to do');
  assert.equal(s.attention, true);
  assert.match(s.tooltip, /2 of 4 setup steps done. Next: Tracking \(B8.tracking\)/);
  const confirmed = statusText(summarize(items.filter((i) => i.status !== 'fail'), new Set(['B14.tickets'])));
  assert.equal(confirmed.text, '$(check) Setup done');
  assert.equal(isComplete('skip'), true);
  assert.equal(isComplete('unknown', true), true);
  assert.equal(isComplete('fail'), false);
});

test('machine results are reused only while fresh, in a folder with the same profile, and by the same version (GH-114)', () => {
  const items: DoctorItem[] = [{ id: 'A1.node', part: 'machine', title: 'Node', status: 'fail', detail: 'node isn\'t installed.' }];
  const now = 1_000_000;
  const fresh = { at: now - 1000, profile: 'salesforce', version: '0.37.0', items };
  assert.deepEqual(reusableMachine(fresh, 'salesforce', '0.37.0', now, 5000), items);
  assert.equal(reusableMachine(fresh, 'generic', '0.37.0', now, 5000), null, 'a generic folder never shows A1.node from a Salesforce folder\'s check');
  assert.equal(reusableMachine(fresh, 'none', '0.37.0', now, 5000), null);
  assert.equal(reusableMachine({ ...fresh, at: now - 5000 }, 'salesforce', '0.37.0', now, 5000), null, 'stale');
  assert.equal(reusableMachine({ at: now, version: '0.37.0', items }, 'generic', '0.37.0', now, 5000), null, 'saved before results knew their profile');
  assert.equal(reusableMachine(undefined, 'generic', '0.37.0', now, 5000), null);
  assert.equal(reusableMachine({ ...fresh, items: [] }, 'salesforce', '0.37.0', now, 5000), null, 'an empty list saved by 0.35.0 or earlier, when acc failed, is checked again');
  // An upgrade checks the machine again: the new acc may fail a plugin the old one passed (A4, D-088).
  assert.equal(reusableMachine(fresh, 'salesforce', '0.38.0', now, 5000), null, 'checked by another version');
  assert.equal(reusableMachine({ at: now, profile: 'salesforce', items }, 'salesforce', '0.37.0', now, 5000), null, 'saved before results knew their version');
  assert.equal(reusableMachine({ ...fresh, version: '' }, 'salesforce', '', now, 5000), null, 'saved when the version couldn\'t be read');
});

test('a machine check that came back empty is never saved for startup to reuse', () => {
  const items: DoctorItem[] = [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: 'git 2.54.0' }];
  assert.deepEqual(machineCache(items, 'generic', '0.37.0', 42), { at: 42, profile: 'generic', version: '0.37.0', items });
  assert.equal(machineCache([], 'generic', '0.37.0', 42), null, 'acc failed: startup checks again instead of showing no machine rows for 12 hours');
});

test('a full check replaces each part\'s rows, so a step that no longer applies loses its row (GH-62)', () => {
  const row = (id: string, part: DoctorItem['part'], status: DoctorItem['status'] = 'pass'): DoctorItem => ({ id, part, title: id, status, detail: '' });
  const ids = (rows: DoctorItem[]) => rows.map((r) => r.id);
  // No project open, then `acc init --profile generic`: the machine check no longer lists A1.node.
  const before = [row('A1.git', 'machine'), row('A1.node', 'machine', 'fail')];
  const after = afterFullCheck(before, { machine: [row('A1.git', 'machine')], project: [row('B0.config', 'project')] });
  assert.deepEqual(ids(after), ['A1.git', 'B0.config']);
  assert.deepEqual(summarize(after, new Set()).failing, [], 'neither done nor to do');
  // acc failed for a part: its rows stay rather than Setup going blank.
  const salesforce = [row('A1.git', 'machine'), row('A1.sf', 'machine'), row('B1.orgs', 'project', 'fail'), row('B0.config', 'project')];
  assert.deepEqual(ids(afterFullCheck(salesforce, { machine: [], project: [row('B0.config', 'project')] })), ['A1.git', 'A1.sf', 'B0.config']);
  assert.deepEqual(ids(afterFullCheck(salesforce, { machine: [row('A1.git', 'machine')], project: [] })), ['A1.git', 'B1.orgs', 'B0.config']);
  // A folder that isn't a project drops the project rows and keeps the machine's.
  assert.deepEqual(ids(afterFullCheck(salesforce, { machine: [row('A1.git', 'machine')], project: null })), ['A1.git']);
  // Salesforce to generic: B1.orgs and A1.sf go.
  assert.deepEqual(ids(afterFullCheck(salesforce, { machine: [row('A1.git', 'machine')], project: [row('B0.config', 'project')] })), ['A1.git', 'B0.config']);
  // A Check of one step changes that row alone.
  const checked = afterStepCheck(after, [row('A1.git', 'machine', 'fail')]);
  assert.deepEqual(ids(checked), ['A1.git', 'B0.config']);
  assert.equal(checked[0]!.status, 'fail');
  assert.deepEqual(checked[1], after[1]);
  assert.deepEqual(ids(afterStepCheck(after, [row('B14.tickets', 'project')])), ['A1.git', 'B0.config', 'B14.tickets']);
});

test('Open in Salesforce offers Developer sandboxes for tracking, and the default org first otherwise', () => {
  const envs = [
    { name: 'Production', type: 'production', org: 'P', default: false },
    { name: 'Sandbox', type: 'partial', org: 'S', default: false },
    { name: 'Devbox', type: 'developer', org: 'A', default: true },
    { name: 'Train', type: 'developer', org: null, default: false },
  ];
  assert.deepEqual(setupOrgChoices('B8.tracking', envs).map((e) => e.name), ['Devbox']);
  assert.deepEqual(setupOrgChoices('B6.org-match', envs).map((e) => e.name)[0], 'Devbox');
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
  assert.equal(initCommand({ profile: 'salesforce', productionOrg: 'Acme Production' }), 'acc init --profile salesforce --production-org \'Acme Production\'');
  assert.equal(initCommand({ profile: 'generic' }), 'acc init --profile generic');
});

test('a team template\'s acc init quotes its source and org, and the recent list keeps the five newest, each source once (GH-80)', () => {
  const src = 'git@github.com:acme/acc-templates.git#salesforce.json';
  assert.equal(initCommand({ from: src, profile: 'salesforce', productionOrg: 'Acme Production' }), `acc init --from '${src}' --profile salesforce --production-org 'Acme Production'`);
  assert.equal(initCommand({ from: '~/team/acme tools.json' }), 'acc init --from \'~/team/acme tools.json\'', 'acc expands ~ itself');
  const url = 'https://github.com/acme/acc-templates/blob/main/generic.json';
  assert.equal(initCommand({ from: url }), `acc init --from ${url}`);
  assert.equal(initCommand({ from: url, profile: 'generic' }), `acc init --from ${url} --profile generic`, 'a template with no profile gets the one the person chose');

  const t = (n: number) => ({ source: `~/team/t${n}.json`, name: `T${n}` });
  let list = [1, 2, 3, 4, 5].reduce((l, n) => rememberTemplate(l, t(n)), [] as ReturnType<typeof t>[]);
  assert.deepEqual(list.map((r) => r.name), ['T5', 'T4', 'T3', 'T2', 'T1']);
  list = rememberTemplate(list, t(6));
  assert.deepEqual(list.map((r) => r.name), ['T6', 'T5', 'T4', 'T3', 'T2'], 'at most five');
  list = rememberTemplate(list, { source: '~/team/t3.json', name: 'T3, renamed' });
  assert.deepEqual(list.map((r) => r.name), ['T3, renamed', 'T6', 'T5', 'T4', 'T2'], 'a source used again moves to the top, once');
});

test('what acc template show --json said is read as the template, its problems, or why it couldn\'t be read (GH-80)', () => {
  const good = shownTemplate(JSON.stringify({ ok: true, errors: [], name: 'ACME tools', description: 'Small repos.', profile: 'generic', sets: ['Required checks: test'], commands: { test: 'npm test' } }));
  assert.deepEqual(good, { ok: true, name: 'ACME tools', description: 'Small repos.', profile: 'generic', sets: ['Required checks: test'], commands: { test: 'npm test' }, tracker: null });
  assert.ok(good.ok && templateDetail(good).includes('Check commands it runs on this machine:\ntest: npm test'));
  assert.ok(good.ok && !templateDetail(good).includes('sets no profile'));
  const noProfile = shownTemplate(JSON.stringify({ ok: true, errors: [], name: 'ACME any', description: null, profile: null, sets: [], commands: {} }));
  assert.ok(noProfile.ok && noProfile.profile === null && templateDetail(noProfile).includes('It sets no profile, so you choose Salesforce or Other next.'));
  assert.deepEqual(shownTemplate(JSON.stringify({ ok: false, errors: ['"gatez" isn\'t a template key.'] })), { ok: false, errors: ['"gatez" isn\'t a template key.'] });
  assert.deepEqual(shownTemplate(JSON.stringify({ error: 'no-template', message: 'There\'s no team template at x.json.' })), { ok: false, errors: ['There\'s no team template at x.json.'] });
  assert.deepEqual(shownTemplate('', 'node: not found\nmore'), { ok: false, errors: ['node: not found'] });
});

test('From a Jira epic: acc init gets the tracker as one argument, a template\'s tracker fills in the page, and acc\'s words come back (GH-81)', () => {
  const tracker = { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: 'ACME-3' };
  assert.deepEqual(initArgs({ profile: 'generic', tracker }), ['--profile', 'generic', '--tracker', JSON.stringify(tracker)]);
  assert.equal(initCommand({ profile: 'generic', tracker }), `acc init --profile generic --tracker '${JSON.stringify(tracker)}'`, 'the JSON is one argument');
  assert.equal(initCommand({ tracker: { kind: 'github', labels: ['won\'t fix'] } }), `acc init --tracker '{"kind":"github","labels":["won'\\''t fix"]}'`);
  assert.deepEqual(initArgs({ from: '~/team/acme tools.json', profile: 'salesforce', productionOrg: 'Acme Production' }), ['--from', '~/team/acme tools.json', '--profile', 'salesforce', '--production-org', 'Acme Production'], 'each value one argument, unquoted, for running acc itself');

  // The template's tracker, as acc template show --json gives it: its site and project, never a place (D-097).
  const shown = shownTemplate(JSON.stringify({ ok: true, errors: [], name: 'ACME', description: null, profile: 'generic', sets: [], commands: {}, template: { tracker: { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', organization: null } } }));
  assert.ok(shown.ok);
  assert.deepEqual(startTracker(shown.tracker), { kind: 'jira', host: 'acme.atlassian.net', values: { project: 'ACME' } });
  assert.deepEqual(startTracker({ kind: 'azure', organization: 'acme', project: null }), { kind: 'azure', host: 'acme', values: {} });
  assert.deepEqual(startTracker({ kind: 'monday', account: 'acme', board: 1234 }), { kind: 'monday', host: 'acme', values: { board: '1234' } });
  assert.deepEqual(startTracker({ kind: 'github' }), { kind: 'github', host: null, values: {} });
  assert.equal(startTracker({ kind: 'trello' }), null);
  assert.equal(startTracker(null), null);

  assert.deepEqual(initOutput(JSON.stringify({ written: false, config: { project: 'acme-renewals', github: { repo: 'acme/renewals', account: 'jordan-kim' } } })), { ok: true, project: 'acme-renewals', github: { repo: 'acme/renewals', account: 'jordan-kim' } });
  assert.deepEqual(initOutput(JSON.stringify({ written: false, config: { project: 'tool', github: null } })), { ok: true, project: 'tool', github: null });
  assert.deepEqual(initOutput(JSON.stringify({ error: 'init', message: '"Acme Production" isn\'t logged in: sf failed' })), { ok: false, error: '"Acme Production" isn\'t logged in: sf failed' });
  assert.deepEqual(initOutput('', 'node: not found\nmore'), { ok: false, error: 'node: not found' });
});

test('a project started from an epic signs in under the key it has once acc init writes it: its dry run and its written config agree (GH-81)', () => {
  const dir = makeRepo();
  const reposFile = join(tempDir('acc-repos-'), 'repos.json');
  const acc = (args: string[]) => spawnSync(process.execPath, ['--no-warnings', join(root, '..', 'packages', 'cli', 'src', 'main.ts'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', ACC_REPOS_FILE: reposFile } });
  const args = initArgs({ profile: 'generic' });
  const dry = initOutput(acc(['init', ...args, '--dry-run', '--json']).stdout);
  assert.ok(dry.ok, JSON.stringify(dry));
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const pending = pendingProject({ root: dir, dry, commonDir: common, args, tracker: null });
  assert.deepEqual([pending.name, pending.args, pending.tracker], [dir.split('/').pop(), ['--profile', 'generic'], null]);

  const tracker = { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', epic: 'ACME-3' };
  const done = acc(['init', ...pending.args, ...initArgs({ tracker }), '--json']);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  const written = parseConfig(JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'))).config!;
  assert.deepEqual(written.trackers.map((t) => [t.kind, t.epic]), [['jira', 'ACME-3']]);
  // As the hub builds a project from its folder once it's written.
  const loaded = { config: written, ledgerPath: join(common, 'acc', 'ledger.json') };
  assert.equal(repoKey(pending), repoKey(loaded));
  assert.equal(repoKey(pending), `git:${common}`);
  // With a GitHub repo, by the repo, as every clone shares it.
  const withGithub = pendingProject({ root: dir, dry: { ok: true, project: 'acme-renewals', github: { repo: 'Acme/Renewals', account: 'jordan-kim' } }, commonDir: common, args, tracker: null });
  assert.equal(repoKey(withGithub), repoKey({ config: { github: { repo: 'Acme/Renewals' } }, ledgerPath: '/elsewhere/.git/acc/ledger.json' }));
});

test('the copied-in rules row offers Import rules… whatever it shows, after Check, and the command is the page\'s to ask for (GH-108)', () => {
  const item = (status: 'pass' | 'skip' | 'unknown') => ({ id: 'B0.rules', part: 'project' as const, title: 'Copied-in rules are current', status, detail: 'd', ...(status === 'unknown' ? { fix: 'acc rules diff acme' } : {}) });
  const actions = (status: 'pass' | 'skip' | 'unknown') => setupModel([item(status)], new Set()).parts[0]!.steps[0]!.actions.map((a) => [a.label, a.command]);
  const importRules = ['Import rules…', 'acc.importRules'];
  assert.deepEqual(actions('skip'), [['Check', 'acc.step.check'], importRules, ['Guide', 'acc.openGuide']], 'nothing copied in yet: Import rules… is how one starts');
  assert.deepEqual(actions('pass'), [['Check', 'acc.step.check'], importRules, ['Guide', 'acc.openGuide']]);
  assert.deepEqual(actions('unknown'), [['Do it', 'acc.step.fix'], ['Check', 'acc.step.check'], importRules, ['I\'ve done this', 'acc.step.confirm'], ['Guide', 'acc.openGuide']], 'Do it shows the difference, and writes nothing');
  // acc's fix is named as its process, not shown as a line to type (GH-163).
  const unknown = setupModel([item('unknown')], new Set()).parts[0]!.steps[0]!;
  assert.deepEqual([unknown.fix, unknown.does], [null, 'Compare the rules with their source']);
  assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === 'acc.importRules'), 'contributed');
  assert.ok(stepMedia(STEPS.find((s) => s.id === 'B0.rules')!).includes('**Import rules…** is here whatever the step shows.'));
});

test('what acc rules import --dry-run --json said is read as the copy it would write, or why it can\'t, and the command it runs replaces only when asked (GH-108)', () => {
  const dry = { written: false, name: 'acme', file: '.acc/rules/acme.md', source: '~/team/acme.md', commit: null, copied: '2026-10-07', sha256: 'x', bytes: 40, lines: 12, exists: true,
    replaces: { source: '~/team/old.md', copied: '2026-09-01', edited: true }, preview: Array.from({ length: 12 }, (_, i) => `- Rule ${i + 1}.`) };
  const shown = shownRules(JSON.stringify(dry));
  assert.ok(shown.ok);
  assert.deepEqual([shown.file, shown.lines, shown.replaces], ['.acc/rules/acme.md', 12, { source: '~/team/old.md', copied: '2026-09-01', edited: true }]);
  const detail = rulesDetail(shown);
  assert.match(detail, /^From ~\/team\/acme\.md: 12 lines\.\nIt replaces the copy from ~\/team\/old\.md, copied on 2026-09-01, and the edits made to it here\.\n\n- Rule 1\./);
  assert.ok(detail.includes('- Rule 10.\n…') && !detail.includes('Rule 11'), 'ten lines, then more');
  assert.match(detail, /You review the rules file acme and commit it yourself\. acc never updates it on its own/);
  assert.match(rulesDetail(shownRules(JSON.stringify({ ...dry, commit: 'c0ffee'.padEnd(40, '0'), replaces: null, lines: 1, preview: ['x'] })) as Extract<ReturnType<typeof shownRules>, { ok: true }>), /^From ~\/team\/acme\.md, at commit c0ffee0: 1 line\.\n\nx\n/);
  assert.deepEqual(shownRules(JSON.stringify({ error: 'bad-rules', message: 'Use https://: acc doesn\'t fetch a rules file over plain http.' })), { ok: false, errors: ['Use https://: acc doesn\'t fetch a rules file over plain http.'] });
  assert.deepEqual(shownRules('', 'node: not found'), { ok: false, errors: ['node: not found'] });
  assert.equal(importRulesCommand({ source: 'https://github.com/acme/acc-rules/blob/main/salesforce.md' }), 'acc rules import https://github.com/acme/acc-rules/blob/main/salesforce.md');
  assert.equal(importRulesCommand({ source: '~/Team Rules/acme.md', name: 'acme-2', force: true }), 'acc rules import \'~/Team Rules/acme.md\' --name acme-2 --force');
});

test('org logins go where an environment\'s name says, gh\'s active account is read, and aliases with spaces stay whole', async () => {
  const { activeGhAccount, expectedOrgUrl } = await import('../src/logic/setup.ts');
  const { shq } = await import('../src/logic/shared.ts');
  assert.equal(expectedOrgUrl('acme', { type: 'production', branch: 'production' }), 'https://acme.my.salesforce.com');
  assert.equal(expectedOrgUrl('acme', { type: 'developer', branch: 'dev' }), 'https://acme--dev.sandbox.my.salesforce.com');
  const status = `github.com
  ✓ Logged in to github.com account work-acct (keyring)
  - Active account: true
  - Token scopes: 'gist', 'read:org', 'repo'

  ✓ Logged in to github.com account me (keyring)
  - Active account: false`;
  assert.equal(activeGhAccount(status), 'work-acct');
  assert.equal(activeGhAccount('You are not logged into any GitHub hosts.'), null);
  assert.equal(shq('Acme Dev SB'), "'Acme Dev SB'");
  assert.equal(shq("Pat's org"), "'Pat'\\''s org'");
  assert.equal(shq('acme-dev'), 'acme-dev');
});

test('setup counts steps done, and offers fixes only where something is open', () => {
  const m = setupModel([
    { id: 'B0.repo', part: 'project', title: 'Repo', status: 'pass', detail: 'ok' },
    { id: 'B2.identity', part: 'project', title: 'Identity', status: 'fail', detail: 'wrong', fix: 'git config user.name x' },
    { id: 'B14.tickets', part: 'project', title: 'Tickets', status: 'fail', detail: 'Not signed in', fix: 'acc.trackers.signIn' },
    { id: 'A4.plugin', part: 'machine', title: 'Plugin', status: 'pass', detail: 'acc 0.35.0, for every Claude Code session.' },
  ], new Set());
  assert.equal(m.total, 4);
  assert.equal(m.done, 2);
  const steps = m.parts.flatMap((p) => p.steps);
  assert.deepEqual(steps.find((s) => s.id === 'B2.identity')!.actions.map((a) => a.label), ['Do it', 'Check']);
  const tickets = steps.find((s) => s.id === 'B14.tickets')!;
  assert.deepEqual(tickets.actions.map((a) => a.label), ['Do it', 'Check', 'Guide'], 'Do it runs Add a tracker or Sign in, in VSCode');
  assert.equal(tickets.fix, null, 'a VSCode command isn\'t shown as one to copy');
  assert.deepEqual(steps.find((s) => s.id === 'B0.repo')!.actions.map((a) => a.label), ['Check', 'Guide'], 'passing steps keep only Check and the guide')
  assert.deepEqual(steps.find((s) => s.id === 'A4.plugin')!.actions.map((a) => a.label), ['Check']);
});

test('setup shows the acc plugin under its own section, with Do it while it fails', () => {
  const add = 'claude plugin marketplace add https://github.com/jack-huffman/agent-command-center && claude plugin install acc@agent-command-center --scope user';
  const m = setupModel([
    { id: 'A2.gh-login', part: 'machine', title: 'Logged in to GitHub', status: 'pass', detail: 'ok' },
    { id: 'A4.plugin', part: 'machine', title: 'The acc plugin in Claude Code', status: 'fail', detail: 'acc isn\'t installed in Claude Code, and its marketplace isn\'t added.', fix: add },
  ], new Set());
  const machine = m.parts.find((p) => p.part === 'machine')!;
  assert.deepEqual(machine.sections.map((s) => [s.title, s.todo]), [['Accounts', 0], ['The acc plugin', 1]]);
  const a4 = machine.steps.find((s) => s.id === 'A4.plugin')!;
  assert.deepEqual(a4.actions.map((a) => a.label), ['Do it', 'Check']);
  assert.deepEqual([a4.fix, a4.does], [add, 'Install the acc plugin in Claude Code'], 'the step says what Do it does in words, and keeps the command line to show on request (GH-168)');
  assert.deepEqual([a4.look.label, a4.look.tone], ['To do', 'orange']);
});

test('setup reads in the order things are set up, a section for each thing, whatever order the checks finished in (D-047)', () => {
  // B14 is re-checked first, as soon as projects load: it still comes after the repo's own steps.
  const item = (id: string, status: 'pass' | 'fail' | 'skip' | 'unknown' = 'pass') => ({ id, part: id.startsWith('A') ? 'machine' as const : 'project' as const, title: id, status, detail: 'd' });
  const m = setupModel([item('B14.tickets', 'unknown'), item('B2.account'), item('B0.template', 'skip'), item('B0.config'), item('B0.repo'), item('B2.identity', 'fail'), item('B12.trust'), item('B13.gate-tools', 'skip'), item('A1.claude-billing'), item('A1.git'), item('A2.gh-login')], new Set());
  const project = m.parts.find((p) => p.part === 'project')!;
  assert.deepEqual(project.steps.map((s) => s.id), ['B0.repo', 'B0.config', 'B0.template', 'B2.identity', 'B2.account', 'B12.trust', 'B13.gate-tools', 'B14.tickets']);
  assert.deepEqual(project.sections.map((s) => [s.title, s.todo, s.steps.length]), [['The repo', 0, 3], ['GitHub account', 1, 2], ['Background agents', 0, 2], ['Tickets', 1, 1]], 'neighbouring groups that set up one thing share a section');
  assert.deepEqual(m.parts.find((p) => p.part === 'machine')!.steps.map((s) => s.id), ['A1.git', 'A1.claude-billing', 'A2.gh-login'], 'a step this build doesn\'t know goes at the end of its group');
  assert.deepEqual(project.steps.map((s) => [s.look.label, s.done]), [['Done', true], ['Done', true], ['Doesn\'t apply', true], ['To do', false], ['Done', true], ['Done', true], ['Doesn\'t apply', true], ['Check by hand', false]]);
  assert.deepEqual([m.done, m.total], [9, 11]);
});

test('a step command names a step that\'s there, or none: acc.step.check, acc.step.fix, acc.step.openSetup, acc.step.confirm, acc.openGuide (GH-106)', () => {
  const ids = STEPS.map((s) => s.id);
  assert.equal(stepIdOf('B0.repo', ids), 'B0.repo', 'a walkthrough button');
  assert.equal(stepIdOf({ item: { id: 'A1.git' } }, ids), 'A1.git', 'a Setup row');
  // Each of these threw "Unknown step", so the command rejected.
  for (const junk of [undefined, null, '', '../x', 'B99.nope', 0, {}, { item: null }, { item: { id: 5 } }, ['B0.repo']]) assert.equal(stepIdOf(junk, ids), undefined, JSON.stringify(junk));
});
