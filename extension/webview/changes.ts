// A task's Changes tab (T-138): first where it is, one row for each environment on its path (T-158), its state by
// acc's record and a Check this org (T-167), and one
// Deploy…, which asks where and starts the deploy guide's agent there, so a long list never pushes it out of
// view. Nothing on the tab deploys by itself. Then what changed, one list by type with a count; planned before there's work, made once there is, with what
// was planned and not made, or made and not planned, behind one quiet line. Deletions carry an icon and the
// word. Record changes are a short list after it, then the steps left to do by hand. Everything else (the
// manifest, the tracker's field, record changes by hand, the team) waits under one closed More.

import type { ChangeItem, ChangeList, ChangeSet, TicketChanges } from '../src/model/changes.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import type { DeployChoice, DeployPick, EnvRow, TicketDeploy } from '../src/model/ticket-deploy.ts';
import { button, el, icon, plural, status, when, work } from './dom.ts';
import { api, memory, remember, state } from './state.ts';
import { renderSteps } from './record-changes.ts';

/** The key the tab remembers an open fold by, per ticket: the quiet line's list, More, Deploy…'s pick, and a row's components that differ. */
export const openKey = (what: 'apart' | 'more' | 'pick' | `differs-${string}`, m: Pick<TicketModel, 'project' | 'key'>): string => `chg-${what}:${m.project}#${m.key}`;

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

/** A fold's button: it says whether it's open, and flips it in the tab's memory. It is small, as it sits in a line of text. */
function foldButton(label: string, key: string, cls: string): HTMLButtonElement {
  const on = isOpen(key);
  const b = button(label, on ? 'chevron-down' : 'chevron-right', () => flip(key), `ghost small ${cls}`);
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

/**
 * A row's Check this org (T-167): quiet, it reads its own environment alone, for work deployed outside acc. It waits,
 * spinning, while its check is under way, and is off with why where there's nothing to check.
 */
function checkButton(m: TicketModel, d: TicketDeploy, r: EnvRow): HTMLButtonElement {
  const x = button('Check this org', r.checking ? 'sync~spin' : 'search', () => {
    if (!x.disabled) api.postMessage({ type: 'where-check', project: m.project, task: d.task, env: r.branch });
  }, 'ghost small dp-check-btn');
  if (r.checking) {
    x.disabled = true;
    x.setAttribute('aria-busy', 'true');
    x.title = `Check this org: it is reading ${r.org ?? r.name} now`;
  } else if (r.checkOff) {
    x.disabled = true;
    x.title = `Check this org: ${r.checkOff}`;
    x.setAttribute('aria-description', r.checkOff);
  } else x.title = `Check this org: read whether ${r.org ?? r.name} holds this work now, for work deployed another way`;
  return x;
}

/** What a check found, under its row: matches, differs (a fold of which), or can't tell (why), with when it was read. A note: the row's state stays acc's record. */
function renderCheck(m: TicketModel, r: EnvRow): HTMLElement[] {
  const c = r.check;
  if (!c) return [];
  const out: HTMLElement[] = [el('p', 'small dp-check-found', el('span', 'muted', 'This org, checked '), when(c.at), status(c.look))];
  if (c.differs.length) {
    const key = openKey(`differs-${r.branch}`, m);
    out.push(foldButton(c.detail ?? plural(c.differs.length, 'component'), key, 'dp-differs-btn'));
    if (isOpen(key)) out.push(el('ul', 'chg-list dp-differs', ...c.differs.map((x) => el('li', 'chg-item', work(el('span', 'mono chg-name', x), 'files')))));
  } else if (c.detail) out.push(el('p', 'muted small dp-check-why', c.detail));
  for (const n of c.notes) out.push(el('p', 'muted small dp-note', n));
  return out;
}

/**
 * One environment's row: its name and org, its state by acc's record with an icon and a label (when it got there
 * and who deployed it, or why its deploy failed), the next step, a deploy under way, the development environment's
 * merge, then what its last Check this org found, and the button.
 */
function renderRow(m: TicketModel, d: TicketDeploy, r: EnvRow): HTMLElement {
  const head = el('div', 'dp-row-head', el('strong', 'dp-env', r.name), r.org ? el('span', 'mono muted dp-org', r.org) : null,
    el('span', 'dp-state', status(r.look), r.at ? when(r.at) : null, r.by ? el('span', 'muted dp-by', r.by) : null), r.next ? status(r.next) : null);
  const row = el('li', 'dp-row', head);
  row.dataset.env = r.branch;
  if (r.detail) row.append(el('p', 'muted small dp-detail', r.detail));
  if (r.merged) row.append(el('p', 'small dp-merged', status({ ...r.merged.look, label: r.merged.words })));
  if (r.busy) row.append(el('p', 'small dp-busy', status(r.busy)));
  row.append(...renderCheck(m, r), el('div', 'dp-check', checkButton(m, d, r)));
  return row;
}

/** One environment Deploy… offers: a button that starts the agent there, saying what happens next; off, it says why. */
function choiceButton(m: TicketModel, d: TicketDeploy, c: DeployChoice): HTMLButtonElement {
  const x = el('button', 'btn ghost dp-choice', icon('hubot'), el('span', 'dp-choice-text',
    el('span', 'dp-choice-name', el('strong', '', c.name), c.org ? el('span', 'mono muted', c.org) : null),
    el('span', 'muted small dp-then', c.disabled ?? c.then))) as HTMLButtonElement;
  x.type = 'button';
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    if (x.disabled) return;
    api.postMessage({ type: 'deploy-guide', project: m.project, task: d.task, to: c.to });
    remember((s) => { s.opened = s.opened.filter((y) => y !== openKey('pick', m)); });
    if (state.last) state.draw(state.last);
  });
  if (c.disabled) {
    x.disabled = true;
    x.title = `${c.name}: ${c.disabled}`;
    x.setAttribute('aria-description', c.disabled);
  } else x.title = `${c.name}: ${c.then}`;
  return x;
}

/** Deploy…: the tab's one primary action. It opens the pick of where; off, it says why, beside it and in its title. */
function renderPick(m: TicketModel, d: TicketDeploy, p: DeployPick): HTMLElement[] {
  const key = openKey('pick', m);
  const on = !p.disabled && isOpen(key);
  const go = button(p.label, 'cloud-upload', () => { if (!go.disabled) flip(key); }, 'primary dp-go');
  go.setAttribute('aria-expanded', String(on));
  if (p.disabled) {
    go.disabled = true;
    go.title = `${p.label} ${p.disabled}`;
    go.setAttribute('aria-description', p.disabled);
  } else go.title = 'Deploy…: pick where, and an agent deploys it there';
  const out: HTMLElement[] = [el('div', 'actions dp-actions', go)];
  if (p.disabled) out.push(el('p', 'muted small dp-why', icon('info'), el('span', '', p.disabled)));
  if (on) {
    const pick = el('div', 'dp-pick', el('p', 'small dp-pick-q', 'Where should an agent deploy it?'), ...p.choices.map((c) => choiceButton(m, d, c)));
    pick.setAttribute('role', 'group');
    pick.setAttribute('aria-label', 'Where to deploy');
    out.push(pick);
  }
  return out;
}

/** The deploy part: a row for each environment on the path, what the agent is on, and Deploy… with its pick. */
export function renderDeploy(m: TicketModel, d: TicketDeploy): HTMLElement {
  const rows = el('ul', 'dp-rows', ...d.rows.map((r) => renderRow(m, d, r)));
  rows.setAttribute('aria-label', 'Where its work is');
  const sec = el('section', 'block dp', rows);
  sec.setAttribute('aria-label', 'Deploy');
  if (d.status) sec.append(el('p', 'dp-status', status({ ...d.status.look, label: d.status.words })));
  if (d.pick) sec.append(...renderPick(m, d, d.pick));
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
