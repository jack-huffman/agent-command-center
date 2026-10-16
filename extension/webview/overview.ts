// The Overview, a landing page (GH-160, T-36): a header with one button, Needs you first, its first three
// lines, then a quiet card for each other list. A card opens its list in full over the page.

import type { HomeModel } from '../src/model/home.ts';
import type { Action } from '../src/model/shared.ts';
import { moreMenu } from './boards.ts';
import { type Child, el, pageHeader, plural, refreshPage, toolbarButton } from './dom.ts';
import { landingCard, landingGroup } from './landing.ts';
import { sinceSection } from './since.ts';
import { api, type PageArea } from './state.ts';

/** What the header's ⋯ menu holds (T-36): each did the same as its button in the header before. */
export const HEADER_MENU = [
  { command: 'acc.agent.new', label: 'Start an agent', icon: 'hubot' },
  { command: 'acc.trackers.add', label: 'Add a tracker', icon: 'plug' },
  { command: 'refresh', label: 'Refresh', icon: 'refresh' },
] as const;

/** The header's ⋯ menu: Start an agent and Add a tracker on the project, as their buttons did, and Refresh. */
function headerMenu(root: string | undefined): HTMLElement | null {
  const items = HEADER_MENU.filter((x) => root || x.command === 'refresh').map((x): Action => ({ ...x, ref: { project: root } }));
  return moreMenu('overview-header', 'the Overview', items, (a) => (a.command === 'refresh' ? refreshPage() : api.postMessage({ type: 'toolbar', command: a.command, project: root })));
}

export function renderOverview(m: HomeModel): Node[] {
  const o = m.overview;
  const needs = o.landing.find((g) => g.key === 'needs-you')!;
  const summary = needs.count ? `${plural(needs.count, 'thing')} need${needs.count === 1 ? 's' : ''} you` : 'All clear: nothing needs you right now';
  const root = o.projects[0]?.root;
  const tools: Child[] = [
    root ? toolbarButton('acc.task.add', 'Add task', 'add', root, true) : toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true),
    headerMenu(root),
  ];
  const cards = el('div', 'lp-cards', ...o.cards.map(landingCard));
  cards.setAttribute('role', 'group');
  cards.setAttribute('aria-label', 'Your other lists');
  // What needs a person, first and alone at the top; then what changed while they were away (D-???); every other list a card under it.
  return [pageHeader('Overview', summary, ...tools), landingGroup(needs), ...(o.since ? [sinceSection(o.since)] : []), ...(o.cards.length ? [cards] : [])];
}

export const area: PageArea = {
  sections: { overview: { draw: renderOverview } },
};
