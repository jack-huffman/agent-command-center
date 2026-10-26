// What several of the extension's test files share: the extension's folder and manifest, a test hub, and
// the page's source (GH-95).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskRow } from '../src/logic/shared.ts';
import type { HubLike } from '../src/model/shared.ts';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
/** The page's source: the webview's modules named, in that order, or all of them. */
export const pageSource = (...files: string[]): string => (files.length ? files : readdirSync(join(root, 'webview')).filter((f) => f.endsWith('.ts')).sort()).map((f) => readFileSync(join(root, 'webview', f), 'utf8')).join('\n');
export const envs = [
  { name: 'Production', branch: 'production', type: 'production' as const, org: 'P', default: false, protected: true, promotesTo: [] },
  { name: 'Devbox', branch: 'devbox', type: 'developer' as const, org: 'A', default: true, protected: false, promotesTo: ['sandbox', 'production'] },
  { name: 'Sandbox', branch: 'sandbox', type: 'partial' as const, org: 'S', default: false, protected: false, promotesTo: ['production'] },
];
export const row = (id: string, state: string, display: TaskRow['display'], url: string | null = null): TaskRow => ({ id, title: `Task ${id}`, state, display, environment: 'devbox', deps: display === 'todo' ? ['AV-1'] : [], source: { kind: 'jira', url } });
export function hub(): HubLike {
  const project = {
    name: 'Acme', root: '/r', branch: 'devbox',
    config: { github: { repo: 'o/r', account: 'me' }, environments: envs, profile: 'salesforce', worktrees: { root: '../r.worktrees' } },
    worktrees: [
      { path: '/r', head: 'abc1234', branch: 'devbox', main: true, changed: 0, locked: false, prunable: false },
      { path: '/r.worktrees/AV-2', head: 'def5678', branch: 'task/AV-2-login', main: false, changed: 3, locked: false, prunable: false },
    ],
  };
  return {
    projects: [project],
    agents: [
      { cwd: '/r.worktrees/AV-2', kind: 'background', startedAt: 2, id: 'bg1', name: 'av-2', state: 'blocked', waitingFor: 'permission prompt' },
      { cwd: '/elsewhere', kind: 'interactive', startedAt: 1, sessionId: 'uuid', name: 'other', status: 'idle', pid: 9 },
    ],
    agentsError: null,
    taskRows: () => [row('AV-1', 'running', 'running'), row('AV-2', 'todo', 'todo', 'https://x/AV-2'), row('AV-3', 'blocked', 'blocked'), row('AV-4', 'done', 'done')],
    projectFor: (p: string) => (p.startsWith('/r') ? project : undefined),
  };
}
/** The webview/context items VSCode would show for a row with these context keys, in menu order. */
export function menuFor(webviewId: string, keys: Record<string, string | boolean>): string[] {
  const ctx: Record<string, string | boolean> = { webviewId, ...keys };
  const holds = (term: string): boolean => {
    const eq = /^(\w+) == '([^']*)'$/.exec(term);
    if (eq) return ctx[eq[1]!] === eq[2];
    if (term.startsWith('!')) return !ctx[term.slice(1)];
    assert.match(term, /^\w+$/, `a when-clause term this test can't read: ${term}`);
    return !!ctx[term];
  };
  return (manifest.contributes.menus['webview/context'] as { command: string; when: string; group: string }[])
    .filter((i) => i.when.split('&&').every((t) => holds(t.trim())))
    .sort((a, b) => a.group.localeCompare(b.group))
    .map((i) => i.command);
}
export const ask = (id: string) => ({ id, question: `Question ${id}?`, why: 'It changes the build.', suggested: 'The usual.' });
export const asks = { verdict: 'questions' as const, at: 't1', open: [ask('q1'), ask('q2')], split: [] };
export const tooBig = { verdict: 'split' as const, at: 't1', open: [], split: ['One part', 'Another part', 'The rest'] };
// Ready to build from: nothing open, and its plan approved (T-97).
export const analysed = { verdict: 'ready' as const, at: 't1', open: [], split: [], approved: true };

/**
 * Jira, answering only this email and token (T-117): who you are, then the projects, epics and boards given.
 * `search` answers the epics' search itself, to hold it back or fail it. Core's fakeJira answers acme.atlassian.net
 * by route and never checks who asks; the Connect page's tests need the check (a wrong sign-in is a 401), so they keep this.
 */
export function jiraFor(who: { email: string; token: string }, data: { projects: { key: string; name: string }[]; epics: [string, string][]; boards: { id: number; name: string; type: string }[]; search?: (url: URL) => Response | Promise<Response> }): typeof fetch {
  return (async (url: string, init: { headers: Record<string, string> }) => {
    if (init.headers.Authorization !== `Basic ${Buffer.from(`${who.email}:${who.token}`).toString('base64')}`) return new Response(JSON.stringify({ errorMessages: ['Unauthorized'] }), { status: 401 });
    const u = new URL(url);
    if (u.pathname === '/rest/api/3/myself') return Response.json({ accountId: 'a1', displayName: 'Jordan Kim' });
    if (u.pathname === '/rest/api/3/project/search') return Response.json({ values: data.projects });
    if (u.pathname === '/rest/api/3/search/jql') return data.search ? data.search(u) : Response.json({ issues: data.epics.map(([key, summary]) => ({ key, fields: { summary } })) });
    if (u.pathname === '/rest/agile/1.0/board') return Response.json({ values: data.boards });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}
