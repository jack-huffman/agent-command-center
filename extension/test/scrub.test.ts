// Report a problem's scrub (T-118): a project's settings and an error full of client details go in, and none of
// them comes out of the draft's attached block; each kind of detail becomes its own placeholder, a path inside the
// home folder is the project's, and what isn't a detail (versions, step ids, a standard's name) stays as it was.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configWords, PLACEHOLDER, scrub, type ScrubContext, scrubbedLine, scrubContext } from '../src/logic/scrub.ts';
import { attachedText, type ReportFacts } from '../src/model/report.ts';

const HOME = '/Users/jordan';
const ROOT = '/Users/jordan/Clients/Globex Field Service';
/** A second project open in the same window: the scrub reaches the whole workspace, not the active folder. */
const OTHER = '/Volumes/Work/initech-crm';

/** A Salesforce project's settings with every field the scrub reads, as the config parser gives them. */
const CONFIG = {
  project: 'Globex Field Service',
  github: { repo: 'globex-corp/field-service', account: 'globex-ci-bot' },
  commitIdentity: { name: 'Morgan Reyes', email: 'morgan.reyes@globex.example' },
  environments: [
    { name: 'Dev', branch: 'dev', type: 'sandbox', org: 'gfs-dev', default: true, protected: false, promotesTo: [] },
    { name: 'UAT', branch: 'uat', type: 'sandbox', org: 'integration@globex.example.uat', default: false, protected: false, promotesTo: [] },
    { name: 'Production', branch: 'main', type: 'production', org: null, default: false, protected: true, promotesTo: [] },
  ],
  trackers: [
    { kind: 'jira', site: 'globex.atlassian.net', project: 'GFS', repo: null, organization: null, account: null, workspace: null, channel: null, team: null },
    { kind: 'azure', site: null, project: 'Initech Rollout', repo: null, organization: 'initech-devops', account: null, workspace: null, channel: null, team: 'Blue Team' },
  ],
} as never;
const OTHER_CONFIG = { project: 'Initech CRM', github: null, commitIdentity: null, environments: [], trackers: [] } as never;

/** Every detail the settings and the error hold, each by what it is: none of them may survive the scrub. */
const SECRETS: { what: string; text: string }[] = [
  { what: 'the project path', text: ROOT },
  { what: 'the other project\'s path', text: OTHER },
  { what: 'the home folder', text: HOME },
  { what: 'the project\'s name', text: 'Globex Field Service' },
  { what: 'the GitHub repo', text: 'globex-corp/field-service' },
  { what: 'the GitHub account', text: 'globex-ci-bot' },
  { what: 'the commit name', text: 'Morgan Reyes' },
  { what: 'the commit email', text: 'morgan.reyes@globex.example' },
  { what: 'an org alias', text: 'gfs-dev' },
  { what: 'an org username', text: 'integration@globex.example.uat' },
  { what: 'the Jira site', text: 'globex.atlassian.net' },
  { what: 'the Azure DevOps organization', text: 'initech-devops' },
  { what: 'the Azure DevOps project', text: 'Initech Rollout' },
  { what: 'the board\'s team', text: 'Blue Team' },
  { what: 'the other project\'s name', text: 'Initech CRM' },
  { what: 'the machine\'s username', text: 'jordan' },
  { what: 'an email not in the settings', text: 'pat.kim@vendor.example' },
  { what: 'a URL\'s host', text: 'globex--uat.sandbox.my.salesforce.com' },
  { what: 'another URL\'s host', text: 'build.internal.example:8443' },
  { what: 'a host a network error names', text: 'build.globex.internal' },
  { what: 'a bare host with its port', text: 'api.initech.example:443' },
  { what: 'a bare host in a sentence', text: 'cache.globex.corp' },
  { what: 'an IP address', text: '10.20.30.40' },
  { what: 'a ticket key', text: 'GFS-1182' },
  { what: 'another tracker\'s ticket key', text: 'OPS-77' },
  { what: 'a GitHub token', text: 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' },
  { what: 'a Salesforce session id', text: '00D5g000004XyZqEAK!AQ4AQFh7nC9o1KpYw2fWq8bZxR3tLmE5vD6sJ9uN' },
  { what: 'a named password', text: 'hunter2-correct-horse' },
  { what: 'a token-shaped word', text: 'x9Fk2LmQ7rT4vB8nW1pZ5sJ3' },
  { what: 'a Slack token', text: 'xoxb-1234567890-abcdefghij' },
];

/** An error as a person might have seen it, holding each detail above. */
const ERROR = [
  `Run the checks stopped with code 1.`,
  `Deploying ${ROOT}/force-app/main/default/classes/WorkOrderService.cls to gfs-dev as integration@globex.example.uat`,
  `Also open: ${OTHER}/README.md, and ${HOME}/.zshrc was read`,
  `GFS-1182 and OPS-77 failed: INVALID_SESSION_ID 00D5g000004XyZqEAK!AQ4AQFh7nC9o1KpYw2fWq8bZxR3tLmE5vD6sJ9uN`,
  `at https://globex--uat.sandbox.my.salesforce.com/services/data/v61.0 and http://build.internal.example:8443/job/12`,
  `Pushed by globex-ci-bot to globex-corp/field-service, for Morgan Reyes <morgan.reyes@globex.example>, cc pat.kim@vendor.example`,
  `Board: globex.atlassian.net, Initech Rollout in initech-devops for Blue Team (Initech CRM)`,
  `GH_TOKEN=ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 password: hunter2-correct-horse Slack xoxb-1234567890-abcdefghij`,
  `Session x9Fk2LmQ7rT4vB8nW1pZ5sJ3 ended; jordan was signed in`,
  `getaddrinfo ENOTFOUND build.globex.internal; connect ECONNREFUSED 10.20.30.40:443; then api.initech.example:443 and cache.globex.corp.`,
].join('\n');

const ctx = (): ScrubContext => scrubContext(HOME, 'jordan', [{ root: ROOT, config: CONFIG }, { root: OTHER, config: OTHER_CONFIG }]);

const FACTS: ReportFacts = {
  extension: '0.46.0', acc: { ok: true, value: '0.46.0' }, plugin: { ok: true, value: { version: '0.46.0', enabled: true } }, os: 'macOS 15.1', vscode: '1.105.1', profile: 'salesforce',
  setup: [{ id: 'A1.git', status: 'pass' }, { id: 'B6.org-match', status: 'fail' }, { id: 'B8.tracking', status: 'skip' }],
  step: { id: 'B6.org-match', title: 'Each branch points at the right org', status: 'fail', detail: 'dev points at gfs-dev, which is integration@globex.example.uat' },
  lastError: ERROR,
};

test('a config and an error holding paths, emails, hosts, ticket keys, orgs, a username and token-shaped strings make a draft with none of them', () => {
  const out = scrub(attachedText(FACTS), ctx()).text;
  let checked = 0;
  for (const s of SECRETS) {
    assert.ok(!out.toLowerCase().includes(s.text.toLowerCase()), `${s.what} survived: ${s.text}\n${out}`);
    checked++;
  }
  assert.equal(checked, SECRETS.length);
  assert.ok(checked >= 26, `checked only ${checked}`);
  // Every detail went in: a detail missing from the error would pass without being scrubbed.
  for (const s of SECRETS) assert.ok(attachedText(FACTS).toLowerCase().includes(s.text.toLowerCase()), `the test's error lacks ${s.what}`);
});

test('each kind of detail becomes its own placeholder, and the facts that aren\'t details stay', () => {
  const out = scrub(attachedText(FACTS), ctx()).text;
  for (const p of ['<project>/force-app/main/default/classes/WorkOrderService.cls', '~/.zshrc', '<org>', '<email>', 'https://<host>/services/data/v61.0', 'http://<host>/job/12', '<ticket>', '<token>', '<site>', '<user>', '<repo>', '<name>']) {
    assert.ok(out.includes(p), `${p} isn't in:\n${out}`);
  }
  for (const kept of ['0.46.0', 'macOS 15.1', '1.105.1', 'salesforce', 'A1.git pass', 'B6.org-match fail', 'B8.tracking skip', 'INVALID_SESSION_ID', 'Run the checks stopped with code 1.']) {
    assert.ok(out.includes(kept), `${kept} was taken out:\n${out}`);
  }
});

test('a project inside the home folder is <project>, not ~/…, and the other project\'s path is <project> too (edge case: the whole workspace)', () => {
  const r = scrub(`${ROOT}/a.cls and ${OTHER}/b.cls and ${HOME}/c`, ctx());
  assert.equal(r.text, '<project>/a.cls and <project>/b.cls and ~/c');
  assert.deepEqual([r.replaced.project, r.replaced.home], [2, 1]);
});

test('a path that only starts with the home folder\'s, such as another user\'s, is not taken for it (edge case)', () => {
  assert.equal(scrub('/Users/jordanna/x', scrubContext(HOME, null, [])).text, '/Users/jordanna/x');
});

test('an empty text and one with nothing to replace come back as they were, and say nothing was replaced (edge case)', () => {
  for (const text of ['', 'The extension: 0.46.0, A4.plugin pass, UTF-8, SHA-256']) {
    const r = scrub(text, ctx());
    assert.equal(r.text, text);
    assert.deepEqual(r.replaced, {});
    assert.equal(scrubbedLine(r.replaced), null);
  }
});

test('the scrub doesn\'t scrub its own placeholders, and a word too short to be a detail stays (edge case)', () => {
  const c: ScrubContext = { home: HOME, roots: [], words: [{ text: 'project', kind: 'name' }, { text: 'ui', kind: 'org' }] };
  assert.equal(scrub('<project> ui', c).text, '<project> ui');
  assert.equal(scrub('the project', c).text, `the ${PLACEHOLDER.name}`);
});

test('with no project open, the scrub still takes the home folder, the username and every shape (edge case)', () => {
  const r = scrub(`${HOME}/x by jordan, a@b.example, https://acme.example/p, ACME-1`, scrubContext(HOME, 'jordan', []));
  assert.equal(r.text, '~/x by <user>, <email>, https://<host>/p, <ticket>');
});

test('the settings\' words: every field the scrub reads, and none from a project with nothing set', () => {
  const words = configWords(CONFIG).map((w) => `${w.kind}:${w.text}`);
  for (const w of ['name:Globex Field Service', 'repo:globex-corp/field-service', 'user:globex-ci-bot', 'name:globex-corp', 'name:field-service', 'email:morgan.reyes@globex.example', 'user:Morgan Reyes', 'org:gfs-dev', 'org:integration@globex.example.uat', 'site:globex.atlassian.net', 'name:GFS', 'name:Initech Rollout', 'name:initech-devops', 'name:Blue Team']) {
    assert.ok(words.includes(w), `${w} isn't among ${words.join(', ')}`);
  }
  assert.deepEqual(configWords(OTHER_CONFIG).map((w) => w.text), ['Initech CRM']);
});

test('what the scrub replaced, in a line: one of a kind, several, and the kinds in order', () => {
  assert.equal(scrubbedLine({ email: 1 }), 'Replaced an email address with placeholders.');
  assert.equal(scrubbedLine({ project: 2, ticket: 1, token: 3 }), 'Replaced 2 project paths, a ticket key and 3 things shaped like tokens with placeholders.');
  const line = scrubbedLine(scrub(attachedText(FACTS), ctx()).replaced) ?? '';
  for (const k of ['project path', 'email address', 'ticket key', 'token']) assert.ok(line.includes(k), `${k} isn't in ${line}`);
});
