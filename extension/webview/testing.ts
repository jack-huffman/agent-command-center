// The ticket's Testing tab (T-161): once its builder's deploy to the development org passed, one line of where the
// work is, Open <environment>, and its builder's steps to test it, numbered, a step that names one component with a
// link to that component's page. Before that deploy, it says what it will hold and why it's empty. Testing is for
// trying the builder's work in its development org; Verify (D-084) is for checking a developer's pull request.
// Nothing here needs the person. Off, Open says why beside it and in its title.

import type { TicketModel } from '../src/model/task-page.ts';
import type { Testing, TestingReady, TestStep } from '../src/model/testing.ts';
import { api } from './state.ts';
import { button, el, icon, md, when, work } from './dom.ts';

/** What the tab is for, set apart from Verify's (D-084). */
export const TESTING_ABOUT = 'Testing is for trying the builder\'s work in its development org. Verify is for checking a developer\'s pull request.';

/** Open <environment>: it opens the org's home; off, it says why in its title and to a screen reader. */
function openButton(m: Pick<TicketModel, 'project'>, t: Testing, r: TestingReady): HTMLButtonElement {
  const b = button(r.open.label, 'globe', () => { if (!b.disabled) api.postMessage({ type: 'org-open', project: m.project, task: t.task }); }, 'primary test-open');
  if (r.open.disabled) {
    b.disabled = true;
    b.title = `${r.open.label}: ${r.open.disabled}`;
    b.setAttribute('aria-description', r.open.disabled);
  } else b.title = `${r.open.label}: open ${t.org} in your browser`;
  return b;
}

/** One step, in its builder's words, and where it names one component, one small link that opens that component's page. */
function stepItem(m: Pick<TicketModel, 'project'>, t: Testing, r: TestingReady, s: TestStep): HTMLElement {
  const li = el('li', '', work(el('span', '', md(s.text)), 'transcript'));
  const c = s.link;
  if (!c) return li;
  const go = button(`Open ${c.name}`, 'link-external', () => { if (!go.disabled) api.postMessage({ type: 'org-open', project: m.project, task: t.task, path: c.path }); }, 'ghost small test-link');
  go.setAttribute('aria-label', `Open ${c.name} in ${c.where}`);
  if (r.open.disabled) {
    go.disabled = true;
    go.title = `Open ${c.name}: ${r.open.disabled}`;
  } else go.title = `Open ${c.name} in ${c.where}`;
  li.append(' ', go);
  return li;
}

/** The tab's content: before the deploy, what it will hold; after, where the work is, Open, and the steps. */
export function renderTesting(m: Pick<TicketModel, 'project'>, t: Testing): HTMLElement {
  const sec = el('section', 'block testing', el('h2', '', 'Testing'));
  sec.setAttribute('aria-label', `Testing in ${t.name}`);
  const r = t.ready;
  if (!r) {
    sec.append(el('p', 'muted test-empty', icon('info'), el('span', '', `Nothing to test yet. Once its builder's deploy to ${t.name} passes, this tab opens ${t.name} and lists the steps to test the work there. ${TESTING_ABOUT}`)));
    return sec;
  }
  sec.append(
    el('p', 'test-where', `Deployed to ${t.name} `, when(r.at), `, ${r.tests}.`),
    el('div', 'actions test-actions', openButton(m, t, r)));
  if (r.open.disabled) sec.append(el('p', 'muted small test-why', icon('info'), el('span', '', r.open.disabled)));
  sec.append(el('h3', 'test-sub', 'Steps to test it'));
  if (r.steps.length) sec.append(el('ol', 'test-steps', ...r.steps.map((s) => stepItem(m, t, r, s))));
  else sec.append(el('p', 'muted small test-none', 'Its builder gave no steps. Check its note.'));
  return sec;
}

/** The Agent panel's one link once the build is done: How to test it, which opens the Testing tab. */
export function testingLink(): HTMLElement {
  const b = button('How to test it', 'beaker', () => document.getElementById('task-tab-testing')?.click(), 'ghost small test-go');
  b.title = 'How to test it: open the Testing tab';
  return el('div', 'test-go-line', b);
}
