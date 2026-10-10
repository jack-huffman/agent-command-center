// The Overview, a landing page (GH-160): what needs you, what waits on you, what's in progress, the stat
// tiles, the merge queue, what's ready and History, a line each, five to a list. Detail opens on a click.

import type { HomeModel } from '../src/model/home.ts';
import type { GroupKey } from '../src/model/landing.ts';
import { type Child, el, icon, sectionTitle, toolbarButton } from './dom.ts';
import { landingGroup } from './landing.ts';
import { renderInProgress } from './progress.ts';
import { go, type PageArea } from './state.ts';

export function renderOverview(m: HomeModel): Node[] {
  const o = m.overview;
  const people = o.questions.length + o.attention.filter((a) => a.look.tone === 'orange').length;
  const project = o.projects[0];
  const summary = [
    people ? `${people} thing${people === 1 ? '' : 's'} need${people === 1 ? 's' : ''} you` : 'Nothing needs you right now',
    project ? `${project.name}${project.branch ? ` on ${project.branch}` : ''}` : '',
    project?.trackers.length ? project.trackers.join(' and ') : '',
  ].filter(Boolean).join(' · ');
  const root = project?.root;
  const tools: Child[] = root ? [
    toolbarButton('acc.task.add', 'Add task', 'add', root, true),
    toolbarButton('acc.agent.new', 'Start an agent', 'hubot', root),
    toolbarButton('acc.trackers.add', 'Add a tracker', 'plug', root),
  ] : [toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true)];
  const out: Node[] = [sectionTitle('Overview', summary, ...tools)];
  const group = (k: GroupKey) => o.landing.find((g) => g.key === k)!;
  const shown = (k: GroupKey) => group(k).rows.length > 0 || group(k).empty !== null;

  // What needs a person, first and alone at the top; what waits on you when you have a moment, apart.
  out.push(landingGroup(group('needs-you')));
  if (shown('moment')) out.push(landingGroup(group('moment')));
  out.push(renderInProgress(group('progress'), o.inProgress));

  // At a glance: each tile opens its section.
  const tiles = el('div', 'tiles');
  for (const s of o.stats) {
    const tile = el('button', `tile tone-edge-${s.tone}`, el('div', 'tile-top', icon(s.icon, s.tone === 'neutral' ? undefined : s.tone), el('span', 'tile-label', s.label)), el('div', 'tile-value', s.value), el('div', 'muted small', s.hint)) as HTMLButtonElement;
    tile.type = 'button';
    tile.addEventListener('click', () => go(s.section));
    tiles.append(tile);
  }
  out.push(tiles);

  // Each repo's merge queue, where auto-merge is on (GH-73): head first, with what each waits on.
  if (shown('queue')) out.push(landingGroup(group('queue')));
  // Ready work, its top five, then the last five things that happened.
  out.push(landingGroup(group('ready')), landingGroup(group('history')));
  return out;
}

export const area: PageArea = {
  sections: { overview: { draw: renderOverview } },
};
