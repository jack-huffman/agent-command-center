// A tracker's changes field (T-105): each tracker lists only its fields that hold text, through stand-ins for its
// fields API; the setting is checked; the Command Center drafts the field's text from metadata, record changes, or
// both; each tracker gets it in its own format; and a GitHub issue keeps it under its own heading, the rest of
// its description untouched.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changePlace, changesDraft, changesFieldProblem, changesFieldRefusal, draftedOn, FIELD_FORMATS_OF, readChangesField, sameChanges } from '../src/changes-field.ts';
import { parseConfig } from '../src/config.ts';
import type { OutsideChange } from '../src/outside-changes.ts';
import type { RecordChange } from '../src/records.ts';
import { AzureClient } from '../src/trackers/azure.ts';
import type { AdfNode } from '../src/trackers/doc.ts';
import { fieldMarkdown, fieldValue, GITHUB_CHANGES, GITHUB_SECTION, githubSection, plainOf, withGithubSection } from '../src/trackers/fields.ts';
import { fromMarkdown } from '../src/trackers/doc.ts';
import { GithubClient } from '../src/trackers/github.ts';
import { JiraClient } from '../src/trackers/jira.ts';
import { MondayClient } from '../src/trackers/monday.ts';
import { SlackClient } from '../src/trackers/slack.ts';
import { type Exec, FIELD_FORMATS, type TextField, TRACKER_KINDS } from '../src/trackers/types.ts';
import { GENERIC_CONFIG } from './support.ts';

const AT = new Date('2026-10-22T12:00:00Z');
const SF = 'force-app/main/default';
const PATHS = [`${SF}/classes/JobHistoryService.cls`, `${SF}/classes/JobHistoryService.cls-meta.xml`, `${SF}/objects/Contact/fields/Job_Title__c.field-meta.xml`, `${SF}/flows/Contact_Job_History.flow-meta.xml`, 'README.md'];
const RENAME: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };
const REGION: RecordChange = { object: 'Region__c', action: 'create', match: [{ field: 'Code__c', value: 'EMEA' }], fields: [{ field: 'Name', from: null, to: 'Europe' }] };
const change = (id: string, detail: RecordChange): OutsideChange => ({ id, kind: 'record', detail, why: 'The brand changed', planned: true, actor: 'human', by: 'human:pat', at: '2026-10-21T09:00:00Z' });

/** Records each request and answers from `routes`, by the first pattern its method and path match. */
function recorder(base: string, routes: [RegExp, unknown][]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace(base, '');
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const hit = routes.find(([re]) => re.test(`${method} ${path}`));
    if (!hit) return new Response(JSON.stringify({ message: `no route for ${method} ${path}` }), { status: 404 });
    return hit[1] === null ? new Response(null, { status: 204 }) : Response.json(hit[1]);
  }) as unknown as typeof fetch;
  return { f, calls, writes: () => calls.filter((c) => c.method !== 'GET' && !/wiql|workitemsbatch/.test(c.path)) };
}

// ---------------------------------------------------------------- the field list, from each tracker's fields API

test('Jira lists only its custom text and long-text fields: a long-text field keeps ADF, a one-line one plain text', async () => {
  const { f, calls } = recorder('https://acme.atlassian.net', [[/^GET \/rest\/api\/3\/field$/, [
    { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string', system: 'summary' } },
    { id: 'customfield_10042', name: 'Deployment Notes', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
    { id: 'customfield_10043', name: 'Release Ticket', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' } },
    { id: 'customfield_10044', name: 'Story Points', custom: true, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
    { id: 'customfield_10045', name: 'Region', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
    { id: 'customfield_10046', name: 'Odd', custom: true, schema: { type: 'string', custom: 'x:constructor' } },
  ]]]);
  const jira = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'me@acme.co', token: 'tok', fetch: f });
  assert.deepEqual(await jira.textFields(), [
    { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' },
    { id: 'customfield_10043', name: 'Release Ticket', format: 'plain' },
  ]);
  assert.deepEqual(calls.map((c) => c.method), ['GET'], 'one read, and nothing written');
});

test('Azure DevOps lists the string and HTML fields on the board\'s work item types, leaving out its own System fields, read-only ones, and fields no board type has', async () => {
  const { f, calls } = recorder('https://dev.azure.com/acme', [
    [/^GET \/CRM\/Sales\/_apis\/work\/boards\?/, { value: [{ id: 'b1', name: 'Stories' }] }],
    [/^GET \/CRM\/Sales\/_apis\/work\/boards\/b1\?/, { columns: [{ id: 'c1', name: 'New', columnType: 'incoming', stateMappings: { 'User Story': 'New', Bug: 'New' } }] }],
    [/^GET \/CRM\/_apis\/wit\/fields\?/, { value: [
      { referenceName: 'System.Description', name: 'Description', type: 'html' },
      { referenceName: 'System.History', name: 'History', type: 'history' },
      { referenceName: 'Custom.DeploymentNotes', name: 'Deployment Notes', type: 'html' },
      { referenceName: 'Custom.ReleaseTag', name: 'Release Tag', type: 'string' },
      { referenceName: 'Custom.Steps', name: 'Manual Steps', type: 'plainText' },
      { referenceName: 'Custom.Locked', name: 'Locked Notes', type: 'html', readOnly: true },
      { referenceName: 'Custom.Effort', name: 'Effort', type: 'double' },
      { referenceName: 'Custom.TaskOnly', name: 'Task Notes', type: 'html' },
    ] }],
    [/^GET \/CRM\/_apis\/wit\/workitemtypes\/User%20Story\/fields\?/, { value: [{ referenceName: 'System.Description' }, { referenceName: 'Custom.DeploymentNotes' }, { referenceName: 'Custom.ReleaseTag' }, { referenceName: 'Custom.Locked' }, { referenceName: 'Custom.Effort' }] }],
    [/^GET \/CRM\/_apis\/wit\/workitemtypes\/Bug\/fields\?/, { value: [{ referenceName: 'Custom.Steps' }] }],
  ]);
  const az = new AzureClient({ organization: 'acme', project: 'CRM', team: 'Sales', auth: async () => 'Bearer tok', fetch: f });
  assert.deepEqual(await az.textFields(), [
    { id: 'Custom.DeploymentNotes', name: 'Deployment Notes', format: 'html' },
    { id: 'Custom.Steps', name: 'Manual Steps', format: 'plain' },
    { id: 'Custom.ReleaseTag', name: 'Release Tag', format: 'plain' },
  ], 'a field Bug has counts, though User Story hasn\'t it; Task Notes is on no board type');
  assert.ok(calls.every((c) => c.method === 'GET'), 'nothing written');
});

test('monday.com lists the board\'s long-text columns, each plain text, and GitHub its description\'s section', async () => {
  const sent: string[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)).query);
    return Response.json({ data: { boards: [{ columns: [{ id: 'long_text_1', title: 'Deployment Notes', type: 'long_text' }, { id: 'text_2', title: 'Short', type: 'text' }] }] } });
  }) as unknown as typeof fetch;
  const mon = new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: f });
  assert.deepEqual(await mon.textFields(), [{ id: 'long_text_1', name: 'Deployment Notes', format: 'plain' }]);
  assert.match(sent[0]!, /columns\(types: \[long_text\]\)/);
  assert.ok(!sent.some((q) => q.includes('mutation')), 'nothing written');
  const gh = new GithubClient({ repo: 'o/r', token: 'tok', account: 'me', exec: async () => ({ code: 1, stdout: '', stderr: 'not called' }) });
  assert.deepEqual(await gh.textFields(), [GITHUB_CHANGES]);
  assert.equal(GITHUB_CHANGES.name, GITHUB_SECTION);
});

test('edge: Slack has no fields, so it has no field list, and its setting is refused with why', () => {
  const slack = new SlackClient({ workspace: 'acme', channel: 'C0123ABCD', token: 'xoxb-test', fetch: (async () => Response.json({ ok: true })) as unknown as typeof fetch });
  assert.equal(slack.textFields, undefined);
  assert.equal(slack.writeField, undefined);
  assert.match(changesFieldRefusal('slack')!, /Slack thread has no fields/);
  for (const k of TRACKER_KINDS.filter((x) => x !== 'slack')) assert.equal(changesFieldRefusal(k), null, k);
  assert.deepEqual(FIELD_FORMATS_OF.slack, []);
  for (const k of TRACKER_KINDS) for (const f of FIELD_FORMATS_OF[k]) assert.ok(FIELD_FORMATS.includes(f));
});

// ---------------------------------------------------------------- the setting

const withTracker = (t: Record<string, unknown>) => ({ ...GENERIC_CONFIG, trackers: [t] });
const JIRA = { kind: 'jira', site: 'acme.atlassian.net', project: 'MSP' };
const NOTES = { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' };

test('the setting: a field its tracker can keep is read, trimmed; one it can\'t is an error that says what it must be', () => {
  const ok = parseConfig(withTracker({ ...JIRA, changesField: { ...NOTES, name: '  Deployment Notes ' } }));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config!.trackers[0]!.changesField, NOTES);
  assert.equal(parseConfig(withTracker(JIRA)).config!.trackers[0]!.changesField, null, 'unset: none');
  assert.equal(parseConfig(withTracker({ ...JIRA, changesField: null })).config!.trackers[0]!.changesField, null, 'edge: a choice cleared is none');

  const errs = (t: Record<string, unknown>) => parseConfig(withTracker(t)).errors.join('\n');
  assert.match(errs({ ...JIRA, changesField: { ...NOTES, format: 'html' } }), /trackers\[0\]: "changesField" names a Jira field .* one of adf, plain/);
  assert.match(errs({ ...JIRA, changesField: 'customfield_10042' }), /"changesField" names a Jira field/);
  assert.match(errs({ ...JIRA, changesField: { ...NOTES, name: ' ' } }), /"changesField" names a Jira field/);
  assert.match(errs({ kind: 'slack', workspace: 'acme', channel: 'C0123ABCD', changesField: NOTES }), /"changesField" can't be set: A Slack thread has no fields/);
  assert.match(errs({ kind: 'github', repo: 'o/r', changesField: { id: 'body', name: 'Body', format: 'markdown' } }), /on GitHub can only be the issue's description/);
  assert.deepEqual(parseConfig(withTracker({ kind: 'github', repo: 'o/r', changesField: GITHUB_CHANGES })).errors, []);
  assert.deepEqual(parseConfig(withTracker({ kind: 'azure', organization: 'acme', project: 'CRM', changesField: { id: 'Custom.DeploymentNotes', name: 'Deployment Notes', format: 'html' } })).errors, []);
  assert.deepEqual(parseConfig(withTracker({ kind: 'monday', account: 'acme', board: 111, changesField: { id: 'long_text_1', name: 'Notes', format: 'plain' } })).errors, []);
  assert.deepEqual(parseConfig(withTracker({ ...JIRA, changesField: { ...NOTES, extra: 1 } })).warnings.filter((w) => /changesField/.test(w)).length, 1, 'an unknown key under it is warned about');

  assert.equal(changesFieldProblem('jira', NOTES), null);
  assert.equal(readChangesField('jira', { ...NOTES, format: 'markdown' }), null, 'a refused one reads as none');
  assert.equal(readChangesField('slack', NOTES), null);
});

// ---------------------------------------------------------------- the drafted text

test('the draft for metadata: each component once, grouped by type, then the date; a path the profile doesn\'t know is under Other files, last', () => {
  const md = changesDraft({ profile: 'salesforce', paths: PATHS, outside: [], at: AT })!;
  assert.equal(md, [
    '**Apex Class**', '', '- JobHistoryService', '',
    '**Custom Field**', '', '- Contact.Job_Title__c', '',
    '**Flow**', '', '- Contact_Job_History', '',
    '**Other files**', '', '- README.md', '',
    'As of 22 Oct 2026.',
  ].join('\n'));
  assert.equal(draftedOn(AT), 'As of 22 Oct 2026.');
});

test('the draft for record changes: each in plain words under its kind\'s label, then the date', () => {
  const md = changesDraft({ profile: 'salesforce', paths: [], outside: [change('c1', RENAME), change('c2', REGION)], at: AT })!;
  assert.equal(md, ['**Record changes**', '', '- Account \'Acme Corp\': Name → \'Acme Corporation\'', '- New Region__c Code__c \'EMEA\': Name → \'Europe\'', '', 'As of 22 Oct 2026.'].join('\n'));
});

test('the draft for both: components first, then record changes; outside Salesforce, files by folder', () => {
  const md = changesDraft({ profile: 'salesforce', paths: PATHS.slice(0, 2), outside: [change('c1', RENAME)], at: AT })!;
  assert.ok(md.indexOf('**Apex Class**') < md.indexOf('**Record changes**'));
  assert.ok(md.trimEnd().endsWith('As of 22 Oct 2026.'));
  const generic = changesDraft({ profile: 'generic', paths: ['src/a.ts', 'src/b.ts', 'package.json'], outside: [], at: AT })!;
  assert.equal(generic, ['**src**', '', '- a.ts', '- b.ts', '', '**The top folder**', '', '- package.json', '', 'As of 22 Oct 2026.'].join('\n'));
  assert.deepEqual(changePlace(`${SF}/classes/A.cls`, 'salesforce'), { head: 'Apex Class', name: 'A', other: false });
  assert.deepEqual(changePlace('lib/x/y.ts', 'generic'), { head: 'lib/x', name: 'y.ts', other: false });
});

test('edge: nothing changed drafts nothing; a change of a kind nobody registered still shows; markup in a name reads back as itself', () => {
  assert.equal(changesDraft({ profile: 'salesforce', paths: [], outside: [], at: AT }), null);
  const odd = changesDraft({ profile: 'generic', paths: ['docs/*star*.md'], outside: [{ ...change('c1', RENAME), kind: 'webhook', detail: { url: 'x' } }], at: AT })!;
  assert.match(odd, /\*\*Changes of kind webhook\*\*\n\n- \{"url":"x"\}/);
  assert.equal(plainOf(fromMarkdown(odd)).split('\n')[1], '- *star*.md', 'the name is escaped, so it isn\'t read as emphasis');
});

test('sameChanges: a field that says the same, in any format or on another day, is the same; one that differs isn\'t', () => {
  const md = changesDraft({ profile: 'salesforce', paths: PATHS, outside: [change('c1', RENAME)], at: AT })!;
  const tomorrow = changesDraft({ profile: 'salesforce', paths: PATHS, outside: [change('c1', RENAME)], at: new Date('2026-10-23T12:00:00Z') })!;
  assert.ok(sameChanges(tomorrow, md), 'only the date differs');
  for (const format of ['adf', 'html', 'plain'] as const) assert.ok(sameChanges(fieldMarkdown(fieldValue(md, format), format), md), `${format} read back says the same`);
  assert.ok(!sameChanges(`${md}\n- Also: the Holiday records`, md));
  assert.ok(!sameChanges('', md), 'edge: an empty field');
});

// ---------------------------------------------------------------- each format

test('each format: Markdown as it is, HTML, ADF and plain text that keeps its list; empty text clears the field', () => {
  const md = '**Apex Class**\n\n- JobHistoryService\n\nAs of 22 Oct 2026.';
  assert.equal(fieldValue(md, 'markdown'), md);
  assert.equal(fieldValue(md, 'html'), '<p><b>Apex Class</b></p><ul><li><p>JobHistoryService</p></li></ul><p>As of 22 Oct 2026.</p>');
  const adf = fieldValue(md, 'adf') as AdfNode;
  assert.equal(adf.type, 'doc');
  assert.deepEqual(adf.content!.map((n) => n.type), ['paragraph', 'bulletList', 'paragraph']);
  assert.equal(fieldValue(md, 'plain'), 'Apex Class\n- JobHistoryService\nAs of 22 Oct 2026.');
  for (const format of FIELD_FORMATS) assert.equal(fieldValue('  \n', format), null, `edge: empty ${format}`);
  assert.equal(fieldMarkdown(null, 'adf'), '');
  assert.equal(fieldMarkdown(42, 'html'), '', 'edge: a value that isn\'t text');
  assert.equal(fieldMarkdown('<p>Hand <b>written</b></p>', 'html'), 'Hand **written**');
  assert.equal(fieldMarkdown('  plain  ', 'plain'), 'plain');
});

test('Jira reads the field as Markdown and writes it as ADF or plain text, in one edit', async () => {
  const { f, calls, writes } = recorder('https://acme.atlassian.net', [
    [/^GET \/rest\/api\/3\/issue\/MSP-1\?fields=customfield_10042$/, { fields: { customfield_10042: fieldValue('Hand *written*', 'adf') } }],
    [/^PUT /, null],
  ]);
  const jira = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'me@acme.co', token: 'tok', fetch: f });
  const notes = NOTES as TextField;
  assert.equal(await jira.readField('MSP-1', notes), 'Hand _written_');
  assert.equal(writes().length, 0, 'a read writes nothing');
  await jira.writeField('MSP-1', notes, '- one');
  await jira.writeField('MSP-1', { id: 'customfield_10043', name: 'Release', format: 'plain' }, '- one');
  assert.deepEqual(writes().map((c) => [c.path, c.body]), [
    ['/rest/api/3/issue/MSP-1', { fields: { customfield_10042: fieldValue('- one', 'adf') } }],
    ['/rest/api/3/issue/MSP-1', { fields: { customfield_10043: '- one' } }],
  ]);
  assert.equal(calls.length, 3);
});

test('Azure DevOps writes an HTML field as HTML and a plain one as text, and monday.com a long-text column as { text }', async () => {
  const { f, writes } = recorder('https://dev.azure.com/acme', [
    [/^GET \/CRM\/_apis\/wit\/workitems\/7\?fields=Custom.DeploymentNotes/, { fields: { 'Custom.DeploymentNotes': '<ul><li>one</li></ul>' } }],
    [/^PATCH /, { id: 7 }],
  ]);
  const az = new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'Bearer tok', fetch: f });
  const html: TextField = { id: 'Custom.DeploymentNotes', name: 'Deployment Notes', format: 'html' };
  assert.equal(await az.readField('AB-7', html), '- one');
  await az.writeField('AB-7', html, '**Flow**\n\n- A');
  await az.writeField('AB-7', { ...html, format: 'plain' }, '');
  assert.deepEqual(writes().map((c) => c.body), [
    [{ op: 'add', path: '/fields/Custom.DeploymentNotes', value: '<p><b>Flow</b></p><ul><li><p>A</p></li></ul>' }],
    [{ op: 'add', path: '/fields/Custom.DeploymentNotes', value: '' }],
  ], 'edge: empty text empties the field');

  const sent: { query: string; variables: Record<string, unknown> }[] = [];
  const mf = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push(body);
    return Response.json({ data: body.query.includes('mutation') ? { change_column_value: { id: '5' } } : { items: [{ board: { id: '111' }, column_values: [{ id: 'long_text_1', text: 'by hand' }] }] } });
  }) as unknown as typeof fetch;
  const mon = new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: mf });
  const notes: TextField = { id: 'long_text_1', name: 'Notes', format: 'plain' };
  assert.equal(await mon.readField('MON-5', notes), 'by hand');
  await mon.writeField('MON-5', notes, '**Flow**\n\n- A');
  const m = sent.find((s) => s.query.includes('mutation'))!;
  assert.deepEqual({ ...m.variables }, { board: '111', item: '5', column: 'long_text_1', value: JSON.stringify({ text: 'Flow\n- A' }) });
});

test('edge: a monday.com item on another board isn\'t read as this tracker\'s', async () => {
  const mf = (async () => Response.json({ data: { items: [{ board: { id: '999' }, column_values: [{ id: 'long_text_1', text: 'theirs' }] }] } })) as unknown as typeof fetch;
  const mon = new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: mf });
  await assert.rejects(mon.readField('MON-5', { id: 'long_text_1', name: 'Notes', format: 'plain' }), /isn't an item this token can see/);
});

// ---------------------------------------------------------------- GitHub's section

const BODY = ['As a user I want history.', '', `## ${GITHUB_SECTION}`, '', '- old', '', '### Notes inside', '', 'kept with it', '', '## Testing', '', 'Run the suite.'].join('\n');

test('GitHub\'s section: read from under its heading to the next heading as big, and written in place, the rest kept as it was', () => {
  assert.equal(githubSection(BODY), '- old\n\n### Notes inside\n\nkept with it');
  const next = withGithubSection(BODY, '**Flow**\n\n- A');
  assert.equal(next, ['As a user I want history.', '', `## ${GITHUB_SECTION}`, '', '**Flow**\n\n- A', '', '## Testing', '', 'Run the suite.', ''].join('\n'));
  assert.equal(githubSection(next), '**Flow**\n\n- A');
});

test('edge: a description without the section gets it at the end; an empty one is just the section; a heading in a code block doesn\'t count', () => {
  assert.equal(githubSection('Intro'), null);
  assert.equal(withGithubSection('Intro\n', '- A'), `Intro\n\n## ${GITHUB_SECTION}\n\n- A\n`);
  assert.equal(withGithubSection('', '- A'), `## ${GITHUB_SECTION}\n\n- A\n`);
  const fenced = ['```', `## ${GITHUB_SECTION}`, '```', 'after'].join('\n');
  assert.equal(githubSection(fenced), null);
  assert.equal(withGithubSection(BODY, ''), ['As a user I want history.', '', `## ${GITHUB_SECTION}`, '', '## Testing', '', 'Run the suite.', ''].join('\n'), 'cleared: the heading stays, with nothing under it');
  assert.equal(githubSection(withGithubSection('a\r\nb', 'x')), 'x', 'Windows line ends');
});

test('GitHub reads the section, and writes the description whole with only the section changed, its body on stdin', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const exec: Exec = async (_cmd, args, opts) => {
    calls.push({ args, input: opts?.input });
    return { code: 0, stdout: args[1] === 'view' ? JSON.stringify({ body: BODY }) : '', stderr: '' };
  };
  const gh = new GithubClient({ repo: 'o/r', token: 'tok', account: 'me', exec });
  assert.equal(await gh.readField('GH-41'), githubSection(BODY));
  assert.ok(calls.every((c) => c.args[1] === 'view'), 'a read writes nothing');
  await gh.writeField('GH-41', GITHUB_CHANGES, '- new');
  const edit = calls.find((c) => c.args[1] === 'edit')!;
  assert.deepEqual(edit.args, ['issue', 'edit', '41', '-R', 'o/r', '--body-file', '-']);
  assert.equal(edit.input, withGithubSection(BODY, '- new'));
  assert.ok(edit.input!.startsWith('As a user I want history.') && edit.input!.endsWith('Run the suite.\n'));
});
