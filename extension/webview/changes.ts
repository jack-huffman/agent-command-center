// A task's Changes tab (T-138): first where it is, one line of its path, and Deploy to <next environment>,
// which opens the sheet (deploy-sheet.ts) and never deploys at once, so a long list never pushes it out of view.
// Then what changed, one list by type with a count; planned before there's work, made once there is, with what
// was planned and not made, or made and not planned, behind one quiet line. Deletions carry an icon and the
// word. Record changes are a short list after it, then the steps left to do by hand. Everything else (the
// manifest, the tracker's field, record changes by hand, the team) waits under one closed More.

import type { ChangeItem, ChangeList, ChangeSet, TicketChanges } from '../src/model/changes.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import type { DeployButton, TicketDeploy } from '../src/model/ticket-deploy.ts';
import { button, el, icon, linkTo, plural, status, when, work } from './dom.ts';
import { api, memory, remember, state } from './state.ts';
import { renderSteps } from './record-changes.ts';

/** The key the tab remembers an open fold by, per ticket: the quiet line's list, and More. */
export const openKey = (what: 'apart' | 'more' | 'others', m: Pick<TicketModel, 'project' | 'key'>): string => `chg-${what}:${m.project}#${m.key}`;

const isOpen = (key: string): boolean => memory().opened.includes(key);
const flip = (key: string): void => {
  remember((x) => { x.opened = isOpen(key) ? x.opened.filter((y) => y !== key) : [...new Set([...x.opened, key])]; });
  if (state.last) state.draw(state.last);
};

/** One component or file: its name, its path in its title, and for a deletion, an icon and the word. */
function item(i: ChangeItem): HTMLElement {
  const name = work(el('span', 'mono chg-name', i.name), 'files');
  name.title = i.paths.join('\n');
  return el('li', 'chg-item', name,
    i.deleted ? el('span', 'status tone-neutral chg-deleted', icon('trash'), 'deleted') : null,
    i.look ? status(i.look) : null);
}

/** Each type or folder with its count, then its items. */
const sets = (list: ChangeSet[]): HTMLElement[] => list.map((s) => el('div', 'chg-set',
  el('div', 'chg-head', work(el('strong', '', s.head), 'files'), el('span', 'count', String(s.items.length))),
  el('ul', 'chg-list', ...s.items.map(item))));

/**
 * A fold's button: it says whether it's open, and flips it in the tab's memory. It is small, as it sits in a line
 * of text; in a row of buttons (inRow) it is the row's size (T-144).
 */
function foldButton(label: string, key: string, cls: string, inRow = false): HTMLButtonElement {
  const on = isOpen(key);
  const b = button(label, on ? 'chevron-down' : 'chevron-right', () => flip(key), `ghost${inRow ? '' : ' small'} ${cls}`);
  b.setAttribute('aria-expanded', String(on));
  return b;
}

/** The list: its title and count, a note where there's no record, then its sets, and the quiet line with what's apart. */
export function renderList(m: TicketModel, c: TicketChanges): HTMLElement {
  const l: ChangeList = c.list;
  const sec = el('section', 'block chg', el('div', 'chg-top', el('h2', '', l.title), l.count ? el('span', 'count', String(l.count)) : null));
  sec.setAttribute('aria-label', l.title);
  if (c.note) sec.append(el('p', 'muted chg-note', c.note));
  if (c.keptAt) sec.append(el('p', 'muted small chg-note', 'Kept with the task ', when(c.keptAt), ', so they stay after its branch is gone.'));
  sec.append(...sets(l.sets));
  if (l.apart) {
    const key = openKey('apart', m);
    sec.append(foldButton(l.apart.label, key, 'chg-apart'));
    if (isOpen(key)) sec.append(el('div', 'chg-apart-list', ...sets(l.apart.sets)));
  }
  return sec;
}

/** Record changes, when there are any: a short list in words, each with its state. */
function renderRecordList(m: TicketModel): HTMLElement | null {
  const rows = m.records?.rows ?? [];
  if (!rows.length) return null;
  const sec = el('section', 'block chg chg-records', el('h3', 'chg-sub', 'Record changes'),
    el('ul', 'chg-list chg-rec', ...rows.map((r) => el('li', 'chg-item', status(r.look), el('span', '', r.words)))));
  sec.setAttribute('aria-label', 'Record changes');
  return sec;
}

/** Deploy to an environment: it opens the sheet, which checks first; off, it says why, beside it and in its title. */
function deployButton(m: TicketModel, d: TicketDeploy, b: DeployButton, primary: boolean): HTMLButtonElement {
  const x = button(b.label, 'cloud-upload', () => {
    if (!x.disabled) api.postMessage({ type: 'deploy-check', project: m.project, task: d.task, to: b.to });
  }, primary ? 'primary dp-go' : 'ghost dp-other');
  if (b.disabled) {
    x.disabled = true;
    x.title = `${b.label}: ${b.disabled}`;
    x.setAttribute('aria-description', b.disabled);
  } else x.title = `${b.label}: check first, then deploy on your yes`;
  return x;
}

/** Deploy with an agent (T-154): the deploy guide's chat, for the same step as Deploy, off for the same reason. */
function guideButton(m: TicketModel, d: TicketDeploy, b: DeployButton): HTMLButtonElement {
  const x = button('Deploy with an agent', 'hubot', () => {
    if (!x.disabled) api.postMessage({ type: 'deploy-guide', project: m.project, task: d.task, to: b.to });
  }, 'ghost dp-guide');
  if (b.disabled) {
    x.disabled = true;
    x.title = `Deploy with an agent: ${b.disabled}`;
    x.setAttribute('aria-description', b.disabled);
  } else x.title = 'Deploy with an agent: it gathers every step, by-hand ones too, into a runbook for you to approve, and deploys on the yes you type';
  return x;
}

/** Where it is: its path in one line, each environment with an icon and words, and when it got there. */
function renderPath(d: TicketDeploy): HTMLElement {
  const line = el('p', 'dp-path');
  line.setAttribute('aria-label', 'Its path');
  d.path.forEach((s, i) => {
    if (i) line.append(el('span', 'muted dp-sep', '·'));
    line.append(el('span', 'dp-stop', status({ ...s.look, label: `${s.name}, ${s.look.label}` }), s.at ? when(s.at) : null));
  });
  return line;
}

/** The deploy part: the path, what's under way or how it went, the one Deploy and its menu, and why it's off. */
export function renderDeploy(m: TicketModel, d: TicketDeploy): HTMLElement {
  const sec = el('section', 'block dp', renderPath(d));
  sec.setAttribute('aria-label', 'Deploy');
  if (d.status) {
    sec.append(el('p', 'dp-status', status({ ...d.status.look, label: d.status.words }), d.status.pr ? linkTo(d.status.pr.url, `Pull request #${d.status.pr.number}`) : null));
  }
  if (d.deploy) {
    const row = el('div', 'actions dp-actions', deployButton(m, d, d.deploy, true), guideButton(m, d, d.deploy));
    if (d.others.length) {
      const key = openKey('others', m);
      row.append(foldButton('Other next steps', key, 'dp-more', true));
      if (isOpen(key)) row.append(el('div', 'dp-menu', ...d.others.map((o) => deployButton(m, d, o, false))));
    }
    sec.append(row);
    if (d.deploy.disabled) sec.append(el('p', 'muted small dp-why', icon('info'), el('span', '', d.deploy.disabled)));
  }
  return sec;
}

/** The steps left to do by hand, each environment's, with Mark done and Skip: the record changes' own steps. */
function renderLeft(m: TicketModel): HTMLElement | null {
  const r = m.records;
  if (!r) return null;
  const left = r.promotions.map((p) => ({ ...p, steps: p.steps.filter((s) => s.done) })).filter((p) => p.steps.length);
  if (!left.length) return null;
  const n = left.reduce((k, p) => k + p.steps.length, 0);
  const sec = el('section', 'block chg dp-left', el('h3', 'chg-sub', `Left to do by hand: ${plural(n, 'step')}`));
  sec.setAttribute('aria-label', 'Left to do by hand');
  for (const p of left) sec.append(el('div', 'dp-left-env', el('p', 'muted small', `In ${p.name}. Make each in the org, then mark it.`), renderSteps(m, r, p.steps)));
  return sec;
}

/**
 * The tab: where it is and Deploy, the list, record changes, the steps left, then More, closed, holding
 * `more`: the parts that moved there, each drawn as before.
 */
export function renderChangesTab(m: TicketModel, more: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  // Where it is and Deploy come first, so a long list never pushes Deploy out of view.
  if (m.deploy) out.push(renderDeploy(m, m.deploy));
  if (m.changes) out.push(renderList(m, m.changes));
  const rec = renderRecordList(m);
  if (rec) out.push(rec);
  const left = renderLeft(m);
  if (left) out.push(left);
  // Its builder's own deploys (D-206), with what the tests found there, go in More beside the rest.
  const builder = m.changes?.deployed.length ? el('section', 'block chg-builder', el('h3', 'chg-sub', 'Its builder\'s deploys'),
    ...m.changes.deployed.map((x) => el('p', 'small chg-note chg-deploy', status(x.look), when(x.at), el('span', 'muted', x.words)))) : null;
  const inMore = [...(builder ? [builder] : []), ...more];
  if (inMore.length) {
    const key = openKey('more', m);
    const box = el('section', 'chg-more', foldButton('More', key, 'chg-more-btn'));
    box.setAttribute('aria-label', 'More');
    if (isOpen(key)) box.append(el('div', 'chg-more-body', ...inMore));
    out.push(box);
  }
  return out;
}
