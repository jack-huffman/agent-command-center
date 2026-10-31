// A task page's Agent panel (T-142): at a glance its state, its checks in one line and what holds it up; its
// next step and the two that fit its state; the rest of its actions under More actions; and every other fact
// under Details, folded and closed at first. Nothing the panel showed before is gone: each is a fold or a menu away.

import type { Action } from '../src/model/shared.ts';
import type { TicketAcc, TicketModel, TicketRatchet } from '../src/model/task-page.ts';
import { button, type Child, clippedSpan, el, icon, linkTo, stateChip, status, withTip, work } from './dom.ts';
import { checkSummary, detailsKey, splitActions, stateGlance } from './agent-glance.ts';
import { noteHeadline } from './note.ts';
import { WORDS } from './plain-words.ts';
import { memory, remember } from './state.ts';
import { taskActions } from './task-actions.ts';

/** A row of a list of fields: its name, with an icon before it where one is given, then its value. */
export function field(name: string | { icon: string; name: string }, ...value: Child[]): HTMLElement[] {
  return [typeof name === 'string' ? el('dt', '', name) : el('dt', '', icon(name.icon), name.name), el('dd', '', ...value)];
}

/**
 * A ratchet's numbers (GH-99), "669 → 674 (+5)" beside its name, with an arrow for the way it went: blue
 * when it got better or held, orange when it got worse. The numbers say it; the arrow and its colour only
 * add to them. Hovered, it says them with its label, then what the check said.
 */
function ratchetNumbers(r: TicketRatchet, summary: string): HTMLElement {
  const diff = r.diff ?? 0;
  const better = r.limit === 'floor' ? diff >= 0 : diff <= 0;
  return Object.assign(el('span', 'small check-sum check-ratchet', icon(diff > 0 ? 'arrow-up' : diff < 0 ? 'arrow-down' : 'arrow-right', better ? 'blue' : 'orange'), r.numbers ?? ''), { title: `${r.line}. ${summary}` });
}

/** A fold that starts closed and stays as a person left it, per ticket, until the page is drawn again. */
function fold(key: string, name: string, cls: string, ...body: Child[]): HTMLDetailsElement {
  const d = el('details', `agent-fold ${cls}`, el('summary', '', el('span', 'tool-chev', icon('chevron-right')), el('span', '', name)), ...body) as HTMLDetailsElement;
  d.open = memory().opened.includes(key);
  d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, key])].slice(-200) : x.opened.filter((y) => y !== key); }));
  return d;
}

/** Every check on its own lines, with Accept anyway… where one can be set aside (D-031) and what its tests ran (GH-100). */
function checkRows(a: TicketAcc, onWaive: (gate: string) => void): HTMLElement | null {
  return a.checks.length ? el('div', 'checks', el('h3', '', 'Checks'), ...a.checks.map((c) => el('div', 'check',
    // Its state and name on a line of their own, so a long state such as "needs a person" leaves room (GH-100).
    el('span', 'check-head', status(c.look),
      // A builder's lighter check, or the full one the merge queue runs once (GH-73).
      el('span', 'check-gate', el('span', 'mono', c.gate),
        c.scope ? Object.assign(el('span', 'chip', c.scope === 'builder' ? 'builder' : 'merge queue'), { title: c.scope === 'builder' ? 'One of the lighter checks a builder runs before it finishes the task' : 'The full check, run once in the merge queue before the merge' }) : null)),
    // Its summary under them, beside Accept anyway…, then what its tests ran. A ratchet shows its numbers (GH-99).
    work(c.ratchet?.numbers ? ratchetNumbers(c.ratchet, c.summary) : Object.assign(el('span', 'muted small check-sum', c.summary), { title: c.summary }), 'output'),
    // A person can set a failing check, or one that needs them, aside, with a reason (D-031). Not a ratchet: a person relaxes its floor instead (GH-99).
    c.waivable ? Object.assign(button(`${WORDS.acceptAnyway}…`, 'debug-step-over', () => onWaive(c.gate), 'ghost small check-waive'), { title: `Accept ${c.gate} anyway on this commit, with a reason` }) : null,
    c.counts ? Object.assign(el('span', 'muted small check-tests', icon('beaker'), `Tests: ${c.counts}`), { title: c.countsNote ?? `Tests: ${c.counts}` }) : null))) : null;
}

/** The facts the glance leaves out, in the order the panel listed them: environment, model, builder, where it runs, branch, worktree. */
function facts(a: TicketAcc): HTMLElement {
  return el('dl', 'fields',
    ...field('Environment', el('span', 'mono', a.environment)),
    // The session's own words, only where they differ from the state's: the same words would repeat its chip above.
    ...(a.agent && a.agent.label !== a.look.label ? field('Session', stateChip(a.agent)) : []),
    // The tasks it waits on: at a glance only where no blocker is the reason (holdLine), here whenever it waits.
    ...(a.waitingOn.length ? field('Waiting on', a.waitingOn.join(', ')) : []),
    // Its effort beside it, when it isn't the model's default (D-128).
    ...(a.agent && a.model ? field('Model and effort', el('span', '', el('span', 'mono', a.model), a.effort ? el('span', 'muted', ` · ${a.effort} effort`) : null)) : []),
    // What its builder is called, in Claude Code and the Command Center alike (D-087).
    ...(a.agentName ? field('Builder session', el('span', 'agent-name', a.agentName)) : []),
    // Where it runs (GH-69): This Mac or Cloud, and a cloud builder's page on claude.ai.
    ...(a.place ? field('Runs on', a.cloudUrl ? el('span', '', status(a.place), ' ', linkTo(a.cloudUrl, 'its session on claude.ai')) : status(a.place)) : []),
    ...(a.branch ? field('Branch', work(clippedSpan(a.branch), 'branch')) : []),
    ...(a.worktree ? field('Worktree', work(clippedSpan(a.worktree.split('/').slice(-2).join('/')), 'branch')) : []),
  );
}

/**
 * What holds it up, in one short line at a glance: a blocked note's headline alone (T-146), whose bullets are the
 * page's "Why it's blocked" notice beside the panel, each fact once; else the tasks it waits on, which with a
 * blocker are a row of Details.
 */
function holdLine(a: TicketAcc): HTMLElement | null {
  if (a.blocker) return el('p', 'agent-hold agent-why small', icon('circle-slash', 'orange'), noteHeadline(a.blocker));
  if (!a.waitingOn.length) return null;
  const text = `Waiting on ${a.waitingOn.join(', ')}`;
  return el('p', 'agent-hold muted small', icon('clock'), Object.assign(el('span', 'agent-hold-text', text), { title: text }));
}

/** Open in Claude Code… is too long for half the panel, so its tile says Claude Code; its tip and command are the same. */
const shortLabel = (a: Action): Action => (a.label === 'Open in Claude Code' ? { ...a, label: 'Claude Code' } : a);

/** The panel's body: the glance, the actions, More actions and Details. The caller makes it fold to its header line. */
export function renderAgentPanel(m: Pick<TicketModel, 'project' | 'key'>, a: TicketAcc, onWaive: (gate: string) => void): HTMLElement {
  const g = stateGlance(a);
  const sum = checkSummary(a.checks);
  const { shown, more } = splitActions(a.actions, a.state);
  const glance = el('div', 'agent-glance',
    // Its state as the one state chip, its icon and its label, as every board and ticket draws one (T-94); beside it the session where it adds to it.
    g.disagree ? el('p', 'agent-disagree', icon('warning', 'orange'), el('span', '', g.disagree)) : el('div', 'agent-state', stateChip(a.look), g.session ? withTip(stateChip(g.session), g.session.tip, 'Its builder\'s session') : null),
    sum ? el('p', `agent-checks tone-${sum.tone}`, status(sum)) : null,
    holdLine(a));
  const moreSet = taskActions(more.map(shortLabel));
  return el('section', `side-panel side-agent${a.look.tone === 'orange' ? ' attention' : ''}`, el('h2', '', icon('hubot'), 'Agent'),
    glance,
    // Its actions in one size and place (D-168): the next step full width, the two that fit its state under it.
    taskActions(shown),
    moreSet ? fold(`agent-more:${m.project}#${m.key}`, 'More actions', 'agent-more', moreSet) : null,
    fold(detailsKey(m.project, m.key), 'Details', 'agent-details', facts(a), checkRows(a, onWaive)));
}
