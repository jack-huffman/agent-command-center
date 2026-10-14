// Rules suggested by review findings that keep coming back (GH-102), under Needs you on the Overview: the
// drafted line, a link to each review it came from, and Accept, which opens the task's draft to edit and
// confirm, or Dismiss. Nothing is added until Confirm, and acc does the adding.

import type { CheckAsk } from '../../packages/core/src/rule-suggestions.ts';
import type { Model } from '../src/model/home.ts';
import type { RuleCard } from '../src/model/rules.ts';
import { hideSettled, Pending } from './pending.ts';
import { button, type Child, el, icon, work } from './dom.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';

/** Accepts and dismissals on their way to acc, by card; a refusal stays, saying why, until it's tried again (D-059). */
export const pending = new Pending<'accept' | 'dismiss'>();
export const ruleKey = (c: Pick<RuleCard, 'project' | 'id'>): string => `rule:${c.project}#${c.id}`;
/** The draft is open: kept in the tab's memory, with what's typed in it, until it's confirmed or cancelled. */
const draftOpen = (c: RuleCard): boolean => memory().opened.includes(`${ruleKey(c)}:draft`);

/** How many of the findings it came from show before Show all. */
const SOURCES_SHOWN = 4;

const CHECKS: [Exclude<CheckAsk, 'none'>, string][] = [['any', 'A lint, test or gate'], ['lint', 'A lint'], ['test', 'A test'], ['gate', 'A gate']];

/** What the person typed in the draft, or what acc drafted. */
function draftOf(c: RuleCard): { line: string; title: string; note: string; check: CheckAsk } {
  const d = memory().drafts;
  const k = ruleKey(c);
  const check = d[`${k}:check`] as CheckAsk | undefined;
  return { line: d[`${k}:line`] ?? c.line, title: d[`${k}:title`] ?? c.title, note: d[`${k}:note`] ?? '', check: check ?? c.check };
}

function keep(c: RuleCard, field: 'line' | 'title' | 'note' | 'check', value: string): void {
  remember((m) => { m.drafts[`${ruleKey(c)}:${field}`] = value; });
}

/** How many reviews a card's findings came from: one per task and commit, which may hold several findings. */
const reviewsOf = (c: Pick<RuleCard, 'sources'>): number => new Set(c.sources.map((x) => `${x.task}@${x.sha}`)).size;

function forget(c: RuleCard): void {
  const k = ruleKey(c);
  remember((m) => {
    for (const f of ['line', 'title', 'note', 'check']) delete m.drafts[`${k}:${f}`];
    m.opened = m.opened.filter((x) => x !== `${k}:draft`);
  });
}

const redraw = (): void => { if (state.last) state.draw(state.last); };

function send(c: RuleCard, what: 'accept' | 'dismiss', msg: Record<string, unknown>): void {
  if (!pending.start(ruleKey(c), what)) return;
  api.postMessage(msg);
  redraw();
}

/** Accept… and Dismiss, on the card's row. Accept only opens the draft; Confirm there sends it. */
export function ruleButtons(c: RuleCard): Child[] {
  const sending = pending.what(ruleKey(c));
  if (sending) return [el('span', 'q-sending muted', icon('sync~spin'), sending === 'accept' ? 'Adding the task…' : 'Dismissing…')];
  const dismiss = button('Dismiss', 'close', () => send(c, 'dismiss', { type: 'rule-dismiss', project: c.project, id: c.id }), 'ghost');
  dismiss.title = 'Set it aside until the finding comes back 3 more times';
  if (draftOpen(c)) return [dismiss];
  const accept = button('Accept…', 'check', () => { remember((m) => { m.opened = [...m.opened, `${ruleKey(c)}:draft`]; }); redraw(); }, 'primary');
  accept.title = 'Draft the task that adds it, to edit and confirm';
  return [accept, dismiss];
}

/** A labelled field of the draft, which keeps its words and its place when the page redraws. */
function field(c: RuleCard, name: 'line' | 'title' | 'note', label: string, value: string, rows: number, onInput: () => void): HTMLElement {
  const box = document.createElement(rows > 1 ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
  box.className = 'text-input rule-input';
  box.value = value;
  box.dataset.keep = `${ruleKey(c)}:${name}`;
  if (box instanceof HTMLTextAreaElement) box.rows = rows;
  const id = `rule-${c.id}-${name}`;
  box.id = id;
  box.addEventListener('input', () => { keep(c, name, box.value); onInput(); });
  const l = el('label', 'rule-label', label) as HTMLLabelElement;
  l.htmlFor = id;
  return el('div', 'rule-field', l, box);
}

/**
 * The drafted task, to edit before Confirm: the rule's line, the task's title, whether it asks for a check
 * too, and anything more for the builder. A rule already written always asks for its check.
 */
function ruleDraft(c: RuleCard): HTMLElement {
  const d = draftOf(c);
  const sending = !!pending.what(ruleKey(c));
  const confirm = button('Confirm', 'pass', () => {
    const now = draftOf(c);
    if (!now.line.trim() || !now.title.trim()) return;
    send(c, 'accept', { type: 'rule-accept', project: c.project, id: c.id, line: now.line.trim(), title: now.title.trim(), check: now.check, ...(now.note.trim() ? { note: now.note.trim() } : {}) });
  }, 'primary');
  const ready = () => { const n = draftOf(c); confirm.disabled = sending || !n.line.trim() || !n.title.trim(); };
  ready();
  const cancel = button('Cancel', 'close', () => { forget(c); redraw(); }, 'ghost');

  // Ask for a check too: on to begin with where the words suggest one. A rule already written can't be without.
  const on = d.check !== 'none';
  const tick = document.createElement('input');
  tick.type = 'checkbox';
  tick.checked = on;
  tick.disabled = c.kind === 'check';
  tick.id = `rule-${c.id}-check`;
  tick.addEventListener('change', () => { keep(c, 'check', tick.checked ? (c.check === 'none' ? 'any' : c.check) : 'none'); redraw(); });
  const tickLabel = el('label', `tick${on ? ' on' : ''}`, tick, 'Ask for a check too') as HTMLLabelElement;
  tickLabel.htmlFor = tick.id;
  if (c.kind === 'check') tickLabel.title = 'It\'s already a rule, so its task is the check';
  const kind = document.createElement('select');
  kind.className = 'select-input rule-check';
  kind.setAttribute('aria-label', 'Which check');
  for (const [v, label] of CHECKS) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    o.selected = d.check === v;
    kind.append(o);
  }
  kind.addEventListener('change', () => keep(c, 'check', kind.value));

  const box = el('div', 'rule-draft',
    el('div', 'rule-draft-head strong', icon('tasklist'), 'The task Confirm adds'),
    field(c, 'line', c.kind === 'check' ? 'The rule it checks' : 'The line for the project\'s rules', d.line, 2, ready),
    field(c, 'title', 'Task title', d.title, 1, ready),
    el('div', 'rule-check-row', el('div', 'ticks', tickLabel), on ? kind : null),
    field(c, 'note', 'Anything else for the builder (optional)', d.note, 2, () => undefined),
    el('p', 'muted small rule-draft-note', icon('info'),
      el('span', '', `Confirm adds one task in To do, holding the rule${on ? ', the check it asks for' : ''} and the ${reviewsOf(c)} reviews it came from. acc never writes the project\'s rules: the task does, and a person merges it.`)),
    el('div', 'rule-draft-bar', cancel, confirm));
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `Draft task for ${c.id}`);
  return box;
}

/** Each review a finding came from, as a link that opens its reviewer's session. */
function sourceList(c: RuleCard): HTMLElement {
  const list = el('ul', 'rule-sources');
  list.setAttribute('aria-label', `The ${c.sources.length} findings it came from`);
  // The first few, then Show all: a rule that keeps coming back can have a dozen.
  const key = `${ruleKey(c)}:sources`;
  const all = memory().opened.includes(key);
  const shown = all ? c.sources : c.sources.slice(0, SOURCES_SHOWN);
  for (const s of shown) {
    const link = el('button', 'rule-source-link', icon('eye'), `${s.task} · ${s.sha.slice(0, 7)} · ${s.date}`) as HTMLButtonElement;
    link.type = 'button';
    link.title = `Open ${s.task}'s review of ${s.sha.slice(0, 7)}: its reviewer's session`;
    link.addEventListener('click', (e) => { e.stopPropagation(); api.postMessage({ type: 'rule-open-review', project: c.project, task: s.task, sha: s.sha }); });
    list.append(el('li', 'rule-source', link,
      s.where ? work(el('span', 'mono rule-where', s.where), 'files') : null,
      s.must ? el('span', 'chip rule-must', icon('warning'), 'must fix') : null,
      s.counted ? null : el('span', 'chip', 'said again, not counted'),
      work(el('div', 'muted small rule-message', s.message), 'transcript')));
  }
  if (c.sources.length <= SOURCES_SHOWN) return list;
  const toggle = button(all ? 'Show less' : `Show all ${c.sources.length}`, all ? 'chevron-up' : 'chevron-down', () => {
    remember((x) => { x.opened = all ? x.opened.filter((y) => y !== key) : [...x.opened, key]; });
    redraw();
  }, 'ghost small fold-toggle');
  return el('div', 'rule-sources-wrap', list, toggle);
}

/** Under the card's row: the line, what came back, each review, the draft when it's open, and why acc refused. */
export function ruleDetail(c: RuleCard): HTMLElement {
  const error = pending.error(ruleKey(c));
  const again = c.again ? el('p', 'muted small rule-again', icon('history'), `It came back after ${c.again.by.replace(/^human:/, '')} ${c.again.outcome === 'accepted' ? `accepted it${c.again.task ? ` as ${c.again.task}` : ''}` : 'dismissed it'} on ${c.again.at.slice(0, 10)}.`) : null;
  const d = el('div', 'inbox-rule',
    work(el('blockquote', 'rule-line', c.line), 'agent-text'),
    again,
    el('div', 'rule-sources-head muted small', `From ${reviewsOf(c)} reviews · ${c.findings} findings across ${c.tasks} tasks${c.must ? ` (${c.must} must)` : ''}`),
    sourceList(c),
    draftOpen(c) ? ruleDraft(c) : null,
    error ? el('div', 'aq-error', icon('warning'), el('span', '', error)) : null);
  return d;
}

/**
 * Suggestions acc said it accepted or dismissed, by card (T-35): off the page from its reply, whatever the
 * models say, until one arrives without them. A model can still hold one: the one drawn while acc ran, or
 * one from before acc wrote down what the person did.
 */
const settled = new Set<string>();
/** The models the extension sent that were looked at already: drawing one again isn't a new model. */
const seen = new WeakSet<Model>();

/** acc said how a Confirm or Dismiss went: the card goes at once, or comes back saying why not. */
function onRuleDone(msg: { action?: string; ok?: boolean; error?: string; project?: string; id?: string }): void {
  const c = { project: msg.project ?? '', id: msg.id ?? '' };
  const was = pending.what(ruleKey(c));
  pending.settle(ruleKey(c), msg.ok ? null : `${was === 'dismiss' || msg.action === 'rule-dismiss' ? 'It wasn\'t dismissed' : 'The task wasn\'t added'}: ${msg.error?.trim() || 'acc didn\'t say why.'}`);
  // Accepted or dismissed, the card goes, and so does a draft typed into it.
  if (msg.ok) {
    settled.add(ruleKey(c));
    forget(c as RuleCard);
  }
  redraw();
}

/**
 * Before each draw: a new model without a suggestion ends its wait and its hiding; then what acc settled
 * comes off the page, the suggested rules' line and the detail's count with it.
 */
function forgetGone(model: Model): void {
  if (model.kind !== 'home') return;
  const live = new Set(model.overview.attention.flatMap((a) => (a.rule ? [ruleKey(a.rule)] : [])));
  if (!seen.has(model)) {
    seen.add(model);
    for (const k of [...settled]) if (!live.has(k)) settled.delete(k);
  }
  pending.forget(live);
  if (settled.size) model.overview = hideSettled(model.overview, settled, ruleKey);
}

export const area: PageArea = {
  before: forgetGone,
  receive: { 'rule-done': onRuleDone },
};
