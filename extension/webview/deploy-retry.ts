// Retry with an agent (T-174): on the Changes tab's development row, and in the banner above the tabs, where the
// ticket's deploy to the development org failed or never ran. On, a click hands the deploy back to its builder; off,
// the button says why beside it and in its title. While the click is on its way the button waits, and says so; a
// click that didn't start the builder says why under it.

import type { DeployRetry } from '../src/model/deploy-retry.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, el, icon } from './dom.ts';
import { api } from './state.ts';

/** The button, with why it's off or why the last click failed under it. */
export function retryControl(m: Pick<TicketModel, 'project'>, r: DeployRetry): HTMLElement {
  const go = button(r.retrying ? 'Retrying…' : r.label, r.retrying ? 'sync~spin' : 'debug-restart', () => {
    if (go.disabled) return;
    api.postMessage({ type: 'deploy-retry', project: m.project, task: r.task });
  }, 'small dp-retry');
  if (r.disabled) {
    go.disabled = true;
    go.title = `${r.label}: ${r.disabled}`;
    go.setAttribute('aria-description', r.disabled);
  } else go.title = `${r.label}: its builder deploys to ${r.env} again, and fixes its own work or blocks with options`;
  const box = el('div', 'dp-retry-box', go);
  if (r.disabled && !r.retrying) box.append(el('span', 'muted small dp-retry-why', icon('info'), el('span', '', r.disabled)));
  if (r.error) box.append(el('span', 'small dp-retry-error', icon('warning', 'orange'), el('span', '', `It didn't start: ${r.error}`)));
  return box;
}
