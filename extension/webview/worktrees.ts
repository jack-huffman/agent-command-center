// The Worktrees section: every checkout.

import type { WorktreesModel } from '../src/model/worktrees.ts';
import { clipped, el, empty, header, icon, menuButton, span, status, toolbarButton, withMenu, wrap } from './dom.ts';
import type { PageArea } from './state.ts';

export function renderWorktrees(m: WorktreesModel): Node[] {
  if (!m.projects.length) return [header('Worktrees', 'No onboarded project in this workspace.'), empty('Worktrees appear here once this folder is an onboarded project.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  const out: Node[] = [header('Worktrees', 'Each checkout of the repo. Agents get their own, so your folder stays as you left it.')];
  // One table with a heading row per project, like Agents, so the columns line up.
  const table = el('table', 'grid');
  table.append(el('thead', '', el('tr', '', ...[['Branch', ''], ['Location', 'wide'], ['Changes', ''], ['', '']].map(([h, c]) => el('th', c!, h!)))));
  for (const p of m.projects) {
    const body = el('tbody');
    body.append(el('tr', 'group', span(el('th', '', icon('repo'), p.name, el('span', 'count', String(p.worktrees.length))), 4)));
    for (const w of p.worktrees) {
      const branch = el('td', 'clip name strong', icon(w.main ? 'repo' : 'git-branch'), w.branch);
      branch.title = w.branch;
      const row = el('tr', w.state.tone === 'orange' ? 'attention' : '',
        branch, clipped(w.place, 'mono'), el('td', 'nowrap', status(w.state)), el('td', 'actions', menuButton(w.branch)));
      body.append(withMenu(row, 'worktree', { project: p.root, worktree: w.path }, { worktreeLinked: !w.main }));
    }
    table.append(body);
  }
  out.push(wrap(table));
  return out;
}

export const area: PageArea = {
  sections: { worktrees: { draw: (m) => renderWorktrees(m.worktrees) } },
  views: { worktrees: renderWorktrees },
};
