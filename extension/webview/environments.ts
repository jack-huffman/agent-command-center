// The Environments section: the repo's GitHub identity, and a card per environment.

import type { EnvironmentsModel, IdentityCard } from '../src/model/environments.ts';
import { actionButton, argButton, button, type Child, el, empty, header, icon, toolbarButton } from './dom.ts';
import { api, go, type PageArea } from './state.ts';

/**
 * Who this repo is on GitHub: the account, where that's set, and whether gh and git push agree. Anything
 * wrong says so in words and with an icon, and the card gains an orange edge.
 */
function identityCard(root: string, repo: string, id: IdentityCard): HTMLElement {
  const big = el('span', 'avatar avatar-lg', id.initials);
  big.setAttribute('aria-hidden', 'true');
  const where = el('span', `chip${id.from === 'clone' ? ' chip-blue' : ''}`, id.from === 'clone' ? 'This clone' : 'Project default');
  where.title = id.from === 'clone' ? `Chosen for this clone only, in git config. The project's account is ${id.projectAccount}.` : 'From .acc/config.json';
  const line = (iconName: string, tone: string | undefined, ...text: Child[]) => el('div', 'id-line', icon(iconName, tone), el('span', '', ...text));
  const pushOk = !id.pushesAs || id.pushesAs.toLowerCase() === id.account.toLowerCase();
  const profile = el('button', 'btn ghost', icon('link-external'), 'Profile') as HTMLButtonElement;
  profile.type = 'button';
  profile.addEventListener('click', () => api.postMessage({ type: 'open', url: id.profile }));
  return el('article', `identity${id.problem ? ' attention' : ''}`,
    el('div', 'id-head', big, el('div', 'id-who',
      el('div', 'id-name', el('span', 'strong', id.account), where),
      el('div', 'muted small', `GitHub account for ${repo || 'this repo'}${id.from === 'clone' ? ` · the project's is ${id.projectAccount}` : ''}`))),
    el('div', 'id-lines',
      id.signedIn
        ? line('pass', 'blue', 'gh is signed in', id.scopes.length ? el('span', 'scopes', ...id.scopes.map((s) => el('span', `scope${s === 'project' ? ' scope-on' : ''}`, s))) : null)
        : line('warning', 'orange', el('strong', '', `gh isn't signed in as ${id.account}`)),
      id.signedIn && !id.projects ? line('info', undefined, el('span', 'muted', 'No GitHub Projects access yet, which a Project\'s board needs. Sign in again to add it.')) : null,
      id.pushesAs ? line(pushOk ? 'repo-push' : 'warning', pushOk ? undefined : 'orange', pushOk ? `git push as ${id.pushesAs}` : el('strong', '', `git push would use ${id.pushesAs}`)) : line('warning', 'orange', 'git push isn\'t set up by acc for this repo'),
      id.commit ? line('git-commit', undefined, `Commits as ${id.commit}`) : line('warning', 'orange', 'No commit identity set for this repo')),
    el('div', 'actions',
      argButton('acc.github.switch', id.others ? 'Switch account' : 'Add or switch account', 'arrow-swap', root, true),
      !id.signedIn ? argButton('acc.github.signIn', 'Sign in', 'github', root) : !id.projects ? argButton('acc.github.signIn', 'Add Projects access', 'github', root) : null,
      profile));
}

/** Notices in Slack moved to Settings (GH-113): This machine says so, with a way to its part there. */
function slackMoved(m: EnvironmentsModel): HTMLElement {
  const to = m.slackMoved;
  return el('section', 'block', el('h2', '', icon('device-desktop'), 'This machine'),
    el('div', 'moved', el('span', 'status tone-neutral', icon('info'), 'Notices in Slack moved to Settings.'), button(to.label, to.icon, () => go(to.section, to.part))));
}

export function renderEnvironments(m: EnvironmentsModel): Node[] {
  const machine = slackMoved(m);
  if (!m.projects.length) return [header('Environments', 'No onboarded project in this workspace.'), empty('Environments appear here once this folder is an onboarded project.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true)), machine];
  const out: Node[] = [header('Environments', 'Each environment has its own branch, named after it. Changes move between them by pull request.')];
  for (const p of m.projects) {
    const section = el('section', 'block', el('h2', '', icon('repo'), p.name, p.identity ? null : p.github ? el('span', 'muted', ` · ${p.github}`) : null));
    if (p.identity) section.append(identityCard(p.root, p.github?.split(' as ')[0] ?? '', p.identity));
    if (p.paths.length) {
      const flow = el('div', 'flows');
      for (const path of p.paths) {
        const line = el('div', 'flow');
        path.forEach((b, i) => {
          if (i) line.append(el('span', 'arrow', icon('arrow-right')));
          line.append(el('span', 'flow-node', b));
        });
        flow.append(line);
      }
      section.append(el('h3', '', 'Promotion paths'), flow);
    }
    const cards = el('div', 'env-cards');
    for (const e of p.envs) {
      cards.append(el('article', `env-card${e.current ? ' current' : ''}`,
        el('div', 'env-head', icon(e.icon, e.current ? 'blue' : 'neutral'), el('span', 'strong', e.name), el('span', 'chip', e.type === 'none' ? 'branch' : e.type.replace('_', ' '))),
        el('dl', '',
          el('dt', '', 'Branch'), el('dd', 'mono', e.branch),
          el('dt', '', 'Org'), el('dd', 'mono', e.org ?? (e.type === 'none' ? '–' : 'no alias')),
          el('dt', '', 'Promotes to'), el('dd', 'mono', e.promotesTo.length ? e.promotesTo.join(', ') : '–')),
        e.badges.length ? el('div', 'badges', ...e.badges.map((b) => el('span', `badge${b === 'checked out' ? ' tone-blue' : ''}`, b))) : null,
        el('div', 'actions', ...e.actions.map(actionButton)),
      ));
    }
    section.append(cards);
    out.push(section);
  }
  out.push(machine);
  return out;
}

export const area: PageArea = {
  sections: { environments: { draw: (m) => renderEnvironments(m.environments) } },
  views: { environments: renderEnvironments },
};
