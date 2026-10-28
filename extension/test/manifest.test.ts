// Manifest for this ticket on a Salesforce task's page (T-101): the section and its off states, the org
// check's findings, an org copy that differs with See the difference and Use the org's copy, an org change
// with Add to this ticket, deletions apart, and View, Copy, Save as a file and Add to the ticket's branch.
// Its buttons ask acc, and the branch changes only by one of them.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { MANIFEST_TIMEOUT_MS, manifestPath, NEVER_DEPLOYED, ORG_DIFFERS, type TicketManifest } from '../../packages/core/src/manifest.ts';
import { tempDir } from '../../packages/core/test/temp-root.ts';
import { type ManifestHost, Manifests, type ManifestUi } from '../src/logic/manifest.ts';
import { PROCESSES } from '../src/logic/processes.ts';
import type { FromWebview } from '../src/model/messages.ts';
import { area, MANIFEST_ACTIONS, MANIFEST_DONE, MANIFEST_FILE_ASKS, MANIFEST_LOOK, MANIFEST_ROW_LOOK, type ManifestIn, ticketManifest } from '../src/model/manifest.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { ticketModel } from '../src/model/task-page.ts';
import { accTimeoutMs, RUN_TIMEOUT_MS } from '../src/run.ts';
import { sampleManifest } from '../scripts/fixtures/manifest.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const NOW = Date.parse('2026-10-22T10:00:00Z');
const task = (more: Partial<ManifestIn['task']> = {}): ManifestIn['task'] => ({ id: 'ACME-19', run: { branch: 'task/ACME-19-welcome-email-once' }, state: 'rework', source: { kind: 'jira', key: 'ACME-19', url: null }, ...more });
const input = (more: Partial<ManifestIn> = {}): ManifestIn => ({ task: task(), profile: 'salesforce', org: 'Acme Dev', manifest: null, running: null, ...more });
const checked = (): TicketManifest => sampleManifest(NOW);

// ---------------------------------------------------------------- the section

test('before a manifest the section offers Build the manifest, says it never deploys, and has nothing to view, copy, save or commit', () => {
  const s = ticketManifest(input());
  assert.deepEqual([s.look, s.build, s.orgCheck, s.view, s.copy, s.save, s.commit, s.built, s.check], [MANIFEST_LOOK.none, { label: 'Build the manifest', disabled: null }, { label: 'Check against the org', disabled: null }, null, null, null, null, null, null]);
  assert.match(s.note!, /Salesforce's own CLI .* It never deploys/);
  assert.equal(s.file, 'manifest/tickets/ACME-19/package.xml');
});

test('edge: the section is off, with why, outside a Salesforce project and for a task with no branch; with no org, Check against the org is off', () => {
  const generic = ticketManifest(input({ profile: 'generic', manifest: checked() }));
  assert.deepEqual([generic.look, generic.types, generic.check], [MANIFEST_LOOK.off, [], null], 'a kept one isn\'t shown either');
  assert.match(generic.build.disabled!, /isn't a Salesforce project/);
  const unbuilt = ticketManifest(input({ task: task({ run: null }) }));
  assert.match(unbuilt.note!, /has no branch yet/);
  assert.equal(unbuilt.orgCheck.disabled, unbuilt.note);
  assert.equal(ticketManifest(input({ org: null })).orgCheck.disabled, 'Its environment has no org to check against');
});

test('a checked manifest shows its components, the new one marked, each org copy that differs, each org change, and the deletions apart', () => {
  const s = ticketManifest(input({ manifest: checked() }));
  assert.deepEqual(s.look, MANIFEST_LOOK.differs);
  assert.deepEqual(s.built, { branch: 'task/ACME-19-welcome-email-once', sha: '7c3e9a1', apiVersion: '62.0', at: checked().at, components: 4 });
  assert.deepEqual(s.types.flatMap((t) => t.members.map((r) => [r.component, r.look?.label ?? null])), [['ApexClass:WelcomeEmailService', null], ['ApexClass:WelcomeEmailServiceTest', null], ['CustomField:Contact.Welcome_Sent_At__c', 'New'], ['Flow:Welcome_Email', null]]);
  const c = s.check!;
  assert.equal(c.same, '3 components the same in Acme Dev as in the branch.');
  assert.deepEqual(c.differs.map((d) => [d.component, d.look, d.says, d.use]), [['Flow:Welcome_Email', MANIFEST_ROW_LOOK.differs, ORG_DIFFERS, { label: 'Use the org\'s copy', disabled: null }]]);
  assert.deepEqual(c.changes, { why: null, items: [{ component: 'EmailTemplate:Marketing/Welcome', type: 'EmailTemplate', member: 'Marketing/Welcome', look: MANIFEST_ROW_LOOK.change, state: 'Changed', add: { label: 'Add to this ticket', disabled: null } }] });
  assert.deepEqual(s.deletions.map((d) => [d.component, d.look]), [['ApexClass:WelcomeEmailHelper', MANIFEST_ROW_LOOK.deleted]]);
  assert.equal(s.deletionsNote, NEVER_DEPLOYED);
  assert.deepEqual([s.build.label, s.orgCheck.label, s.view?.label, s.copy?.label, s.save?.label, s.commit?.label], ['Build again', 'Check again', 'View', 'Copy', 'Save as a file', 'Add to the ticket\'s branch']);
});

test('the org check\'s findings show with their why: a member the org lacks, an unknown type, and one it couldn\'t check', () => {
  const m = { ...checked(), check: null, findings: [
    { type: 'CustomField', member: 'Contact.Status__c', kind: 'missing' as const, why: 'The org doesn\'t hold CustomField Contact.Status__c.' },
    { type: 'Widget', member: null, kind: 'unknown-type' as const, why: 'The org doesn\'t know Widget.' },
    { type: 'Report', member: null, kind: 'unchecked' as const, why: 'The org couldn\'t list its Report.' },
  ] };
  const s = ticketManifest(input({ manifest: m }));
  assert.deepEqual(s.look, MANIFEST_LOOK.findings);
  assert.deepEqual(s.findings.map((f) => [f.component, f.look?.label, f.why]), [['CustomField:Contact.Status__c', 'Not in the org', m.findings[0]!.why], ['Widget', 'Unknown type', m.findings[1]!.why], ['Report', 'Not checked', m.findings[2]!.why]]);
  assert.deepEqual(ticketManifest(input({ manifest: { ...m, findings: [] } })).look, MANIFEST_LOOK.ready);
  const none = ticketManifest(input({ manifest: { ...m, findings: [], unchecked: 'Dev has no org, so nothing was checked against one.', org: null } }));
  assert.deepEqual([none.look, none.unchecked], [MANIFEST_LOOK.built, 'Dev has no org, so nothing was checked against one.']);
  const off = ticketManifest(input({ manifest: { ...checked(), check: { ...checked().check!, changes: { available: false, why: 'This project doesn\'t use source tracking.' } } } }));
  assert.deepEqual(off.check!.changes, { items: [], why: 'This project doesn\'t use source tracking.' }, 'edge: tracking off says why, with nothing to add');
});

test('edge: while one runs every button is off with what runs; while its builder works, the branch-changing ones are off', () => {
  const s = ticketManifest(input({ manifest: checked(), running: 'checking against the org' }));
  assert.deepEqual(s.look, MANIFEST_LOOK.running);
  for (const b of [s.build, s.orgCheck, s.view!, s.copy!, s.save!, s.commit!, s.check!.differs[0]!.use, s.check!.changes.items[0]!.add]) assert.equal(b.disabled, 'It\'s checking against the org now');
  const busy = ticketManifest(input({ manifest: checked(), task: task({ state: 'running' }) }));
  for (const b of [busy.commit!, busy.check!.differs[0]!.use, busy.check!.changes.items[0]!.add]) assert.equal(b.disabled, 'Its builder is working in its branch now');
  for (const b of [busy.build, busy.orgCheck, busy.view!, busy.save!]) assert.equal(b.disabled, null, 'reading is fine');
});

test('the task page\'s model holds the section for a task, and none for a ticket acc keeps no task for', () => {
  const base = { project: '/r', tracker: 0, trackerTitle: 'Jira', trackerKind: 'jira' as const, key: 'ACME-19', ticket: null, loading: false, error: null, connect: null, row: null, checks: [] };
  const section = ticketManifest(input());
  assert.deepEqual(ticketModel({ ...base, task: { id: 'ACME-19', source: { kind: 'jira', key: 'ACME-19', url: null } } as never, manifest: section }).manifest, section);
  assert.equal(ticketModel({ ...base, task: null, manifest: section }).manifest, null);
});

// ---------------------------------------------------------------- asking acc

function host(o: { code?: number; stdout?: string; profile?: string; state?: string } = {}) {
  const root = tempDir('acc-manifest-');
  const state = join(root, '.git', 'acc');
  mkdirSync(state, { recursive: true });
  const calls: { args: string[]; label?: string }[] = [];
  const h: ManifestHost = {
    project: (r) => (r === root ? { root, ledgerPath: join(state, 'ledger.json'), profile: o.profile ?? 'salesforce' } : undefined),
    task: () => ({ id: 'ACME-19', run: { branch: 'task/ACME-19-welcome-email-once' }, state: (o.state ?? 'rework') as never }),
    acc: async (args, _cwd, label) => {
      calls.push({ args, ...(label ? { label } : {}) });
      return { code: o.code ?? 0, stdout: o.stdout ?? '{}', stderr: '' };
    },
  };
  const keep = (m: TicketManifest) => {
    mkdirSync(join(state, 'manifests'), { recursive: true });
    writeFileSync(manifestPath({ stateDir: state }, 'ACME-19'), JSON.stringify(m));
  };
  return { root, state, calls, h, keep };
}

test('Build and Check against the org ask acc in the output panel, and the page reads back what acc kept', async () => {
  const { root, calls, h, keep } = host();
  const changed: string[] = [];
  const v = new Manifests(h, (_r, id) => changed.push(id));
  let during: string | null = null;
  const watching = new Manifests({ ...h, acc: async (...a) => { during = watching.state(root, 'acme-19').running; return h.acc(...a); } });
  assert.deepEqual(await watching.build(root, 'acme-19'), { ok: true });
  assert.equal(during, 'building the manifest', 'it shows as running while acc runs');
  assert.deepEqual(await v.build(root, 'ACME-19', true), { ok: true });
  assert.deepEqual(calls, [{ args: ['manifest', 'ACME-19', '--json'], label: 'Build ACME-19\'s manifest' }, { args: ['manifest', 'ACME-19', '--check', '--json'], label: 'Check ACME-19\'s manifest against the org' }]);
  assert.deepEqual(changed, ['ACME-19', 'ACME-19']);
  assert.deepEqual(v.state(root, 'ACME-19'), { manifest: null, running: null }, 'edge: before acc keeps one');
  keep(checked());
  assert.equal(v.state(root, 'acme-19').manifest?.check?.org, 'Acme Dev');
  assert.deepEqual(v.state('/elsewhere', 'ACME-19'), { manifest: null, running: null }, 'edge: a project that closed');
});

test('Use the org\'s copy and Add to this ticket retrieve that component; Add to the ticket\'s branch commits; each only when asked', async () => {
  const { root, calls, h } = host();
  const v = new Manifests(h);
  assert.equal(calls.length, 0, 'nothing runs until a person clicks');
  assert.deepEqual(await v.retrieve(root, 'ACME-19', 'Flow:Welcome_Email'), { ok: true });
  assert.deepEqual(await v.retrieve(root, 'ACME-19', 'EmailTemplate:Marketing/Welcome'), { ok: true });
  assert.deepEqual(await v.commit(root, 'ACME-19'), { ok: true });
  assert.deepEqual(calls, [
    { args: ['manifest', 'retrieve', 'ACME-19', 'Flow:Welcome_Email', '--json'], label: 'Use the org\'s copy in ACME-19' },
    { args: ['manifest', 'retrieve', 'ACME-19', 'EmailTemplate:Marketing/Welcome', '--json'], label: 'Use the org\'s copy in ACME-19' },
    { args: ['manifest', 'commit', 'ACME-19', '--json'] },
  ]);
  assert.equal(calls.some((c) => c.args.some((a) => /deploy/.test(a))), false, 'nothing deploys');
});

test('edge: a closed project, a project that isn\'t Salesforce, one under way and a name that isn\'t Type:Member are refused before acc runs; acc\'s refusal comes back in process words', async () => {
  const generic = host({ profile: 'generic' });
  assert.match((await new Manifests(generic.h).build(generic.root, 'ACME-19') as { error: string }).error, /isn't a Salesforce project/);
  assert.deepEqual(await new Manifests(generic.h).commit('/gone', 'ACME-19'), { ok: false, error: 'That project isn\'t open any more.' });
  const bad = host();
  assert.match((await new Manifests(bad.h).retrieve(bad.root, 'ACME-19', 'Welcome_Email') as { error: string }).error, /isn't a component/);
  for (const x of [generic, bad]) assert.deepEqual(x.calls, []);
  const slow = host();
  let release: () => void = () => {};
  const v = new Manifests({ ...slow.h, acc: () => new Promise((r) => { release = () => r({ code: 0, stdout: '{}', stderr: '' }); }) });
  const first = v.build(slow.root, 'ACME-19', true);
  assert.deepEqual(await v.commit(slow.root, 'ACME-19'), { ok: false, error: 'It\'s checking against the org now. Wait for it to finish.' });
  release();
  assert.deepEqual(await first, { ok: true });
  const refused = host({ code: 1, stdout: JSON.stringify({ error: 'refused', message: 'ACME-19\'s worktree has changes that aren\'t committed. Run acc gate run first.' }) });
  const r = await new Manifests(refused.h).retrieve(refused.root, 'ACME-19', 'Flow:Welcome_Email');
  assert.equal(r.ok, false);
  assert.doesNotMatch((r as { error: string }).error, /acc gate run/, 'process words, not commands');
});

function ui() {
  const did: string[] = [];
  let to: string | null = null;
  const u: ManifestUi = {
    show: async (content, language) => { did.push(`show ${language} ${content.length}`); },
    copy: async (text) => { did.push(`copy ${text.length}`); },
    saveTo: async () => to,
    info: (text) => { did.push(`info ${text}`); },
  };
  return { u, did, saveTo: (p: string | null) => { to = p; } };
}

test('View opens package.xml and the deletions beside it, Copy copies package.xml, and Save as a file writes both where the person chose', async () => {
  const { root, h, keep } = host();
  const v = new Manifests(h);
  const m = checked();
  keep(m);
  const a = ui();
  assert.deepEqual(await v.file(root, 'ACME-19', 'view', a.u), { ok: true });
  assert.deepEqual(a.did, [`show xml ${m.package.length}`, `show xml ${m.destructive!.length}`]);
  a.did.length = 0;
  await v.file(root, 'ACME-19', 'copy', a.u);
  assert.equal(a.did[0], `copy ${m.package.length}`);
  assert.match(a.did[1]!, /Its deletions are apart, in destructiveChangesPost\.xml/);
  const out = join(tempDir('acc-saved-'), 'package.xml');
  a.saveTo(out);
  assert.deepEqual(await v.file(root, 'ACME-19', 'save', a.u), { ok: true });
  assert.equal(readFileSync(out, 'utf8'), m.package);
  assert.equal(readFileSync(join(out, '..', 'destructiveChangesPost.xml'), 'utf8'), m.destructive);
  a.saveTo(null);
  a.did.length = 0;
  assert.deepEqual(await v.file(root, 'ACME-19', 'save', a.u), { ok: true }, 'edge: the person chose nowhere');
  assert.deepEqual(a.did, []);
  a.saveTo(join(out, 'package.xml', 'x.xml'));
  assert.match((await v.file(root, 'ACME-19', 'save', a.u) as { error: string }).error, /Couldn't save it/, 'edge: a place it can\'t write');
  const empty = host();
  assert.match((await new Manifests(empty.h).file(empty.root, 'ACME-19', 'view', a.u) as { error: string }).error, /no manifest yet/, 'edge: before one is built');
});

test('See the difference opens the kept difference, and says when it isn\'t kept any more', async () => {
  const { root, h, keep } = host();
  keep(checked());
  const a = ui();
  const v = new Manifests(h);
  assert.deepEqual(await v.diff(root, 'ACME-19', 'Flow:Welcome_Email', a.u), { ok: true });
  assert.equal(a.did[0], `show diff ${checked().check!.differs[0]!.diff.length}`);
  assert.match((await v.diff(root, 'ACME-19', 'Flow:Gone', a.u) as { error: string }).error, /isn't kept any more/);
});

// ---------------------------------------------------------------- the page

test('the page\'s messages are checked before the extension acts, and the modal takes only its own task\'s', () => {
  const ok: Record<string, Record<string, unknown>> = {
    'manifest-build': { check: true }, 'manifest-retrieve': { component: 'Flow:Welcome_Email' }, 'manifest-commit': {}, 'manifest-file': { how: 'save' }, 'manifest-diff': { component: 'Layout:Contact-Contact %28Sales%29 Layout' },
  };
  for (const type of MANIFEST_ACTIONS) {
    const check = area.messages![type]!;
    assert.equal(check({ project: '/r', task: 'ACME-19', ...ok[type] }), true, type);
    assert.equal(check({ project: '/r', task: '../x', ...ok[type] }), false, `${type}: edge: not a task id`);
    assert.equal(modalTakes({ project: '/r', key: 'ACME-19' } as never, { type, project: '/r', task: 'acme-19', ...ok[type] } as FromWebview, new Set()), true, type);
    assert.equal(modalTakes({ project: '/r', key: 'ACME-19' } as never, { type, project: '/r', task: 'ACME-8', ...ok[type] } as FromWebview, new Set()), false, `${type}: another task's`);
  }
  for (const bad of ['Welcome_Email', ':x', 'Flow:a\nb', 42]) assert.equal(area.messages!['manifest-retrieve']!({ project: '/r', task: 'ACME-19', component: bad }), false, `edge: component ${String(bad)}`);
  assert.equal(area.messages!['manifest-build']!({ project: '/r', task: 'ACME-19', check: 'yes' }), false);
  assert.equal(area.messages!['manifest-file']!({ project: '/r', task: 'ACME-19', how: 'deploy' }), false, 'edge: no way to ask for a deploy');
  assert.deepEqual([...MANIFEST_FILE_ASKS], ['view', 'copy', 'save']);
});

const all = (e: PageElement): PageElement[] => [e, ...e.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const buttons = (e: PageElement): PageElement[] => all(e).filter((x) => x.tagName === 'BUTTON');

test('the section draws its rows and buttons, and Use the org\'s copy, Add to this ticket, Save as a file and Add to the ticket\'s branch send theirs', async () => {
  const page = pageDom();
  const { renderManifest } = await import('../webview/manifest.ts');
  const m = { project: '/r', key: 'ACME-19' } as never;
  const draw = () => renderManifest(m, ticketManifest(input({ manifest: checked() }))) as unknown as PageElement;
  const sec = draw();
  assert.match(sec.textContent, /Manifest for this ticket.*The org differs/);
  assert.match(sec.textContent, /Components.*Welcome_Sent_At__c.*Checked against Acme Dev.*Differs.*changed in the org after the last commit.*Changed in the org, not in this branch.*Marketing\/Welcome.*Deleted by this ticket.*WelcomeEmailHelper.*never deploys/);
  assert.match(sec.textContent, /manifest\/tickets\/ACME-19\/package\.xml/);
  assert.deepEqual(buttons(sec).map((b) => b.textContent), ['See the difference', 'Use the org\'s copy', 'Add to this ticket', 'Build again', 'Check again', 'View', 'Copy', 'Save as a file', 'Add to the ticket\'s branch']);
  const press = (label: string) => buttons(draw()).find((b) => b.textContent === label)!.click();
  const sends: [string, Record<string, unknown>][] = [
    ['Use the org\'s copy', { type: 'manifest-retrieve', component: 'Flow:Welcome_Email' }],
    ['Add to this ticket', { type: 'manifest-retrieve', component: 'EmailTemplate:Marketing/Welcome' }],
    ['Save as a file', { type: 'manifest-file', how: 'save' }],
    ['Add to the ticket\'s branch', { type: 'manifest-commit' }],
    ['See the difference', { type: 'manifest-diff', component: 'Flow:Welcome_Email' }],
    ['Check again', { type: 'manifest-build', check: true }],
  ];
  const { area: pageArea } = await import('../webview/manifest.ts');
  for (const [label, msg] of sends) {
    press(label);
    assert.deepEqual(page.sent.at(-1), { project: '/r', task: 'ACME-19', ...msg }, label);
    // edge: while it's on its way, the others are off; the reply frees them.
    assert.ok(buttons(draw()).filter((b) => b.textContent !== label).every((b) => (b as unknown as { disabled: boolean }).disabled), `${label}: the others wait`);
    (pageArea.receive![MANIFEST_DONE] as (m: unknown) => void)({ project: '/r', task: 'ACME-19', ok: true });
  }
  (pageArea.receive![MANIFEST_DONE] as (m: unknown) => void)({ project: '/r', task: 'ACME-19', ok: false, error: 'nothing asked' });
  assert.doesNotMatch(draw().textContent, /nothing asked/, 'edge: a reply nobody waits for is ignored');
});

test('the page takes the replies by the name the extension sends, and draws the section after Verify, over the Activity', () => {
  const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(MANIFEST_DONE, 'manifest-done');
  assert.match(source('../webview/manifest.ts'), new RegExp(`'${MANIFEST_DONE}': done`));
  const page = source('../webview/task-page.ts');
  const at = page.indexOf('if (m.manifest) add(renderManifest(m, m.manifest)');
  assert.ok(at > page.indexOf('renderVerify(m, m.verify)') && at < page.indexOf('renderActivity(m)'));
  assert.ok(existsSync(new URL('../webview/manifest.css', import.meta.url)));
});

test('the process words name each manifest command, and the extension waits for the org', () => {
  const names = (acc: string) => PROCESSES.find((p) => p.acc.includes(acc))?.name;
  assert.deepEqual(['manifest', 'manifest show', 'manifest retrieve', 'manifest commit'].map(names), ['Build the manifest', 'See the manifest', 'Use the org\'s copy', 'Add the manifest to the ticket\'s branch']);
  assert.equal(accTimeoutMs(['manifest', 'ACME-19', '--check']), MANIFEST_TIMEOUT_MS);
  assert.equal(accTimeoutMs(['manifest', 'retrieve', 'ACME-19', 'Flow:X']), MANIFEST_TIMEOUT_MS);
  assert.equal(accTimeoutMs(['manifest', 'show', 'ACME-19']), RUN_TIMEOUT_MS);
});
