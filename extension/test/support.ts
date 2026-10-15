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
export const analysed = { verdict: 'ready' as const, at: 't1', open: [], split: [] };
