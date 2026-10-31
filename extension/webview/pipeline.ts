// Settings' Pipeline section (T-157): each project's environments in path order, the development environment,
// whether reviewed work merges into it on its own, and where each goes next, with the buttons that change each.
// One stacked row an environment, so it reads at every width without a sideways scroll.

import type { PipelineEnv, PipelineProject } from '../src/model/pipeline.ts';
import type { SettingsModel } from '../src/model/settings.ts';
import { el, icon, settingsButton, status, whatThisMeans } from './dom.ts';

/** One environment: its name, branch and place in the pipeline; its org, type and where it goes next; its buttons. */
function envRow(e: PipelineEnv): HTMLElement {
  const next = e.next.length ? el('span', 'pipeline-next', ...e.next.flatMap((n, i) => [i ? el('span', 'muted', ', ') : null, el('span', '', n)])) : el('span', 'pipeline-next muted', 'nowhere further');
  const row = el('li', `pipeline-env role-${e.role}`,
    el('div', 'pipeline-head', el('span', 'pipeline-name', icon(e.icon), el('span', 'strong', e.name), el('span', 'mono muted small pipeline-branch', e.branch)), status(e.look)),
    el('div', 'pipeline-facts muted small',
      el('span', 'pipeline-fact', icon('organization'), e.org ? el('span', 'mono', e.org) : 'no org'),
      el('span', 'pipeline-fact', icon('server-environment'), e.typeWords),
      el('span', 'pipeline-fact', icon('arrow-right'), 'goes next to ', next)),
    el('div', 'actions pipeline-actions', ...e.actions.map(settingsButton)),
  );
  row.setAttribute('aria-label', e.name);
  return row;
}

/** One project's pipeline, under its name: the switch, then its environments in path order. */
function pipelineProjectBox(p: PipelineProject, folded: readonly string[]): HTMLElement {
  const box = el('div', 'settings-project pipeline-project');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', p.project);
  box.append(el('h3', 'settings-project-name', icon('repo'), el('span', '', p.project), el('span', 'muted settings-count', p.development ? `development: ${p.development}` : 'no development environment')));
  const change = p.merge.action ? settingsButton(p.merge.action) : null;
  box.append(el('div', 'settings-row has-change', el('span', 'settings-name', icon('git-merge'), el('span', 'strong', 'Merges on its own')),
    el('div', 'settings-value', el('div', 'settings-now', status(p.merge.look)), whatThisMeans(`pipeline:${p.root}`, p.merge.meaning, folded)), change));
  const list = el('ul', 'pipeline-list', ...p.envs.map(envRow));
  list.setAttribute('aria-label', `${p.project}'s environments, in path order`);
  box.append(list);
  return box;
}

/** The Pipeline part: every onboarded project's, Salesforce projects first. */
export function renderPipeline(m: SettingsModel): Node[] {
  return m.pipeline.map((p) => pipelineProjectBox(p, m.folded));
}
