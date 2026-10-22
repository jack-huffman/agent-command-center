import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { epicKeys, loadConfig, parseConfig, replaceTracker, writeConfig } from '../src/config.ts';
import { readmePlaces } from '../src/setup.ts';
import { JIRA } from '../src/trackers/connect.ts';
import { JiraClient } from '../src/trackers/jira.ts';
import { placeText, TrackerError } from '../src/trackers/types.ts';
import { GENERIC_CONFIG, tempDir } from './support.ts';

// A Jira tracker that follows several epics (T-107): the settings, the board's query, and what's inside it.

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const SITE = 'acme.atlassian.net';
const one = (t: Record<string, unknown>) => parseConfig({ ...clone(GENERIC_CONFIG), trackers: [t] });

test('a Jira tracker\'s settings name several epics, an older file\'s one epic reads as a list of one, and both together are one list', () => {
  assert.deepEqual(one({ kind: 'jira', site: 's', project: 'ACME', epics: ['acme-3', 'ACME-7'] }).config!.trackers[0]!.epics, ['ACME-3', 'ACME-7'], 'each key upper-cased');
  assert.deepEqual(one({ kind: 'jira', site: 's', project: 'ACME', epic: 'acme-3' }).config!.trackers[0]!.epics, ['ACME-3'], 'an older file\'s one epic');
  const both = one({ kind: 'jira', site: 's', project: 'ACME', epic: 'ACME-3', epics: ['acme-3', 'ACME-9'] });
  assert.deepEqual([both.config!.trackers[0]!.epics, both.warnings], [['ACME-3', 'ACME-9'], []], 'both keys: each epic once, and neither is unknown');
  assert.deepEqual(one({ kind: 'jira', site: 's', project: 'ACME', epics: [] }).config!.trackers[0]!.epics, [], 'edge: an empty list is the whole project');
});

test('a list of epics that isn\'t one is refused, and on another tracker it\'s a warning, not kept', () => {
  for (const bad of ['ACME-3', ['Premium Support'], [3], ['ACME-3', '']]) {
    assert.match(one({ kind: 'jira', site: 's', project: 'K', epics: bad }).errors.join('\n'), /trackers\[0\]: "epics" must be a list of Jira epics' keys/, JSON.stringify(bad));
  }
  const wrong = one({ kind: 'github', epics: ['ACME-3'] });
  assert.match(wrong.warnings.join('\n'), /trackers\[0\]: "epics" applies only to a Jira tracker/);
  assert.deepEqual(wrong.config!.trackers[0]!.epics, []);
});

test('epicKeys writes one epic as "epic", as older files have it, and several as "epics", taking the other key out', () => {
  assert.deepEqual(epicKeys([]), { epic: null, epics: null }, 'edge: none takes both out');
  assert.deepEqual(epicKeys(['ACME-3']), { epic: 'ACME-3', epics: null });
  assert.deepEqual(epicKeys(['ACME-3', 'ACME-7']), { epic: null, epics: ['ACME-3', 'ACME-7'] });
  const file = join(tempDir(), '.acc', 'config.json');
  const trackers = [{ kind: 'jira', site: 's', project: 'ACME', epics: ['ACME-3', 'ACME-7'] }, { kind: 'jira', site: 's', project: 'OPS', epic: 'OPS-1' }];
  writeConfig(file, parseConfig({ ...clone(GENERIC_CONFIG), trackers }).config!);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).trackers, trackers, 'written as given, and an older acc still reads the one');
  assert.deepEqual(loadConfig(file).config.trackers.map((t) => t.epics), [['ACME-3', 'ACME-7'], ['OPS-1']]);
  // A second epic ticked on the Connect page: the old key goes, the list comes.
  const was = [{ kind: 'jira', site: SITE, project: 'ACME', epic: 'ACME-3', board: 7 }];
  const record = JIRA.toConfig({ host: SITE, values: { project: 'ACME', epics: ['ACME-3', 'ACME-7'], board: '7', sprint: null }, defaults: [], ownRepo: null });
  assert.deepEqual(replaceTracker(was, 0, record), [{ kind: 'jira', site: SITE, project: 'ACME', board: 7, epics: ['ACME-3', 'ACME-7'] }]);
  // And back to one: the list goes.
  const back = JIRA.toConfig({ host: SITE, values: { project: 'ACME', epics: ['ACME-7'], board: '7', sprint: null }, defaults: [], ownRepo: null });
  assert.deepEqual(replaceTracker(replaceTracker(was, 0, record), 0, back), [{ kind: 'jira', site: SITE, project: 'ACME', board: 7, epic: 'ACME-7' }]);
});

test('the Connect page ticks epics: an existing tracker opens with each ticked, and its preview follows them', () => {
  const epics = JIRA.pickers.find((p) => p.key === JIRA.place.key)!;
  assert.deepEqual([epics.key, epics.multi, epics.label], ['epics', true, 'Epics']);
  const t = parseConfig({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'jira', site: SITE, project: 'ACME', epics: ['ACME-3', 'ACME-7'], board: 7 }] }).config!.trackers[0]!;
  assert.deepEqual(JIRA.fromConfig(t, null).values.epics, ['ACME-3', 'ACME-7']);
  assert.equal(JIRA.fromConfig({ ...t, epics: [] }, null).values.epics, null, 'edge: no epic opens at the whole project');
  const signIn = { method: 'token', fields: { email: 'e@x.io', token: 't'.repeat(20) }, header: null, gh: null };
  const preview = JIRA.preview({ host: SITE, signIn, values: { project: 'ACME', epics: ['ACME-3', 'ACME-7'], board: '7', sprint: null }, exec: async () => ({ code: 0, stdout: '', stderr: '' }) }) as JiraClient;
  assert.equal(preview.place, 'Jira · ACME · epics ACME-3 or ACME-7');
  assert.equal(preview.placeJql(), 'project = "ACME" AND parent in (ACME-3, ACME-7)');
});

/** A stand-in Jira that answers by method and path prefix, and records each path asked. */
function jira(routes: Record<string, unknown>) {
  const paths: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace(`https://${SITE}`, '');
    paths.push(path);
    const key = Object.keys(routes).find((k) => `${init.method ?? 'GET'} ${path}`.startsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : { errorMessages: ['Not found'] }), { status: key ? 200 : 404 });
  }) as unknown as typeof fetch;
  return { fetch: f, paths };
}
const issue = (key: string, parent: string | null, subtask = false) => ({
  key, fields: { summary: key, status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } }, assignee: null, issuetype: { name: subtask ? 'Sub-task' : 'Story', subtask }, labels: [], project: { key: 'MSP' }, ...(parent ? { parent: { key: parent, fields: { summary: parent } } } : {}) },
});
const jql = (path: string) => new URL(`https://x${path}`).searchParams.get('jql');

test('the board asks for the tickets under any of the epics, and their sub-tasks, and names each epic', async () => {
  const { fetch: f, paths } = jira({
    'GET /rest/agile/1.0/board/42/configuration': { name: 'MSP board', columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] } },
    'GET /rest/api/3/project/MSP/statuses': [{ statuses: [{ id: '1', name: 'To Do', statusCategory: { key: 'new' } }] }],
    'GET /rest/api/3/issue/MSP-3?fields=summary': { fields: { summary: 'Premium Support' } },
    'GET /rest/api/3/issue/MSP-7?fields=summary': { fields: { summary: 'Renewals' } },
    [`GET /rest/agile/1.0/board/42/issue?jql=${encodeURIComponent('project = "MSP" AND parent in (MSP-4, MSP-8)')}`]: { total: 1, issues: [issue('MSP-5', 'MSP-8', true)] },
    'GET /rest/agile/1.0/board/42/issue?jql=': { total: 3, issues: [issue('MSP-4', 'MSP-3'), issue('MSP-8', 'MSP-7'), issue('MSP-9', 'MSP-1')] },
  });
  const b = await new JiraClient({ site: SITE, project: 'MSP', email: 'e', token: 't', board: 42, epics: ['msp-3', 'MSP-7', 'MSP-3'], fetch: f }).board();
  assert.deepEqual(b.cards.map((c) => c.key), ['MSP-4', 'MSP-8', 'MSP-5'], 'each epic\'s child and a sub-task of one; not a stray under another epic');
  assert.equal(b.place, 'Jira · MSP · epics MSP-3 Premium Support or MSP-7 Renewals');
  assert.deepEqual(paths.filter((p) => p.includes('/issue?jql=')).map(jql), ['project = "MSP" AND parent in (MSP-3, MSP-7)', 'project = "MSP" AND parent in (MSP-4, MSP-8)'], 'each epic asked once');
});

test('edge: a board with several epics and none of their tickets says so, naming them', async () => {
  const { fetch: f } = jira({
    'GET /rest/agile/1.0/board/42/configuration': { name: 'MSP board', columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] } },
    'GET /rest/api/3/project/MSP/statuses': [],
    'GET /rest/api/3/issue/MSP-3?fields=summary': { fields: { summary: 'A' } },
    'GET /rest/api/3/issue/MSP-7?fields=summary': { fields: { summary: 'B' } },
    'GET /rest/agile/1.0/board/42/issue?jql=': { total: 0, issues: [] },
  });
  const b = await new JiraClient({ site: SITE, project: 'MSP', email: 'e', token: 't', board: 42, epics: ['MSP-3', 'MSP-7'], fetch: f }).board();
  assert.match(b.notice!, /^No ticket in epic MSP-3 or MSP-7 is on this board\./);
  // One epic Jira hasn't: the board says which.
  const { fetch: missing } = jira({
    'GET /rest/agile/1.0/board/42/configuration': { name: 'MSP board', columnConfig: { columns: [] } }, 'GET /rest/api/3/project/MSP/statuses': [],
    'GET /rest/api/3/issue/MSP-3?fields=summary': { fields: { summary: 'A' } },
  });
  await assert.rejects(new JiraClient({ site: SITE, project: 'MSP', email: 'e', token: 't', board: 42, epics: ['MSP-3', 'MSP-7'], fetch: missing }).board(), /Epic MSP-7 isn't in Jira/);
  assert.throws(() => new JiraClient({ site: SITE, project: 'MSP', email: 'e', token: 't', epics: ['MSP-3', 'not a key'] }).placeJql(), (e) => e instanceof TrackerError && /"NOT A KEY" isn't a Jira epic's key/.test(e.message), 'a bad key is never sent to Jira');
});

test('intake\'s place check: a ticket under any of the epics is inside, a sub-task of one too, and one under none is outside', async () => {
  const { fetch: f } = jira({
    'GET /rest/api/3/issue/MSP-4?': issue('MSP-4', 'MSP-3'),
    'GET /rest/api/3/issue/MSP-8?fields=parent': { key: 'MSP-8', fields: { parent: { key: 'MSP-7' } } },
    'GET /rest/api/3/issue/MSP-8?': issue('MSP-8', 'MSP-7'),
    'GET /rest/api/3/issue/MSP-5?': issue('MSP-5', 'MSP-8', true),
    'GET /rest/api/3/issue/MSP-9?': issue('MSP-9', 'MSP-1'),
    'GET /rest/api/3/issue/MSP-7?': issue('MSP-7', null),
  });
  const c = new JiraClient({ site: SITE, project: 'MSP', email: 'e', token: 't', epics: ['MSP-3', 'MSP-7'], fetch: f });
  assert.equal(c.place, 'Jira · MSP · epics MSP-3 or MSP-7', 'before the board loads, without their names');
  assert.deepEqual(await c.outside(['MSP-4', 'MSP-8', 'MSP-5', 'MSP-9', 'MSP-7']), [
    { key: 'MSP-9', why: 'it isn\'t in epic MSP-3 or MSP-7' },
    { key: 'MSP-7', why: 'it\'s the epic itself, and only the tickets in it count' },
  ], 'the first epic\'s child, the second\'s, and a sub-task of the second\'s are inside');
});

test('the README links each epic a tracker follows, and the place words name them', () => {
  const config = parseConfig({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'jira', site: SITE, project: 'ACME', epics: ['ACME-3', 'ACME-7'] }] }).config!;
  assert.deepEqual(readmePlaces(config), [{
    line: `Jira epics [ACME-3](https://${SITE}/browse/ACME-3) or [ACME-7](https://${SITE}/browse/ACME-7)`, words: 'the Jira epics ACME-3 or ACME-7',
    needs: [`https://${SITE}/browse/ACME-3`, `https://${SITE}/browse/ACME-7`],
  }]);
  assert.equal(placeText({ kind: 'jira', project: 'ACME', epics: ['ACME-3'], epicNames: ['Renewals'] }), 'Jira · ACME · epic ACME-3 Renewals', 'one is "epic", as before');
  assert.equal(placeText({ kind: 'jira', project: 'ACME', epics: ['ACME-3', 'ACME-7'], epicNames: [null, 'Renewals'] }), 'Jira · ACME · epics ACME-3 or ACME-7 Renewals', 'edge: a name not read yet leaves the key alone');
});
