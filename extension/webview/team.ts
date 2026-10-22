// A task's team on its page (T-103), while it's in flight: whether it took in the latest merges into its
// environment's branch, each with its icon and words, the merges it hasn't yet, then the tasks it shares
// files with now, each with its state and the files.

import type { TicketTeam } from '../src/model/team.ts';
import { el, status, work } from './dom.ts';

export function renderTeam(t: TicketTeam): HTMLElement {
  const sec = el('section', 'block team', el('h2', '', 'Team'));
  sec.setAttribute('aria-label', 'Team');
  sec.append(el('div', 'team-line', status(t.behind)));
  if (t.merges.length) {
    sec.append(el('ul', 'team-list', ...t.merges.map((m) => el('li', 'team-item', work(el('span', 'mono team-sha', m.sha), 'branch'), el('span', 'team-name', m.name)))));
  }
  sec.append(el('div', 'team-line', t.sharing.look ? status(t.sharing.look) : el('span', 'muted', `${t.sharing.label}.`)));
  if (t.shares.length) {
    sec.append(el('ul', 'team-list', ...t.shares.map((s) => el('li', 'team-item team-share',
      el('div', 'team-head', el('strong', '', s.id), el('span', 'muted', s.state), el('span', 'team-name', s.title)),
      work(el('div', 'mono small team-files', s.files.join(', ')), 'files')))));
  }
  return sec;
}
