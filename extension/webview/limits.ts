// Settings' Limits and checks (GH-111): how many builders run at once, this project's cap and this machine's
// total side by side, each with − and + and Change…; what a change means; the heavy-check slots; and each
// project's checks. Every button asks the extension, which runs acc: the page writes nothing itself.

import type { CapCard, LimitRow, LimitsModel, Step } from '../src/model/limits.ts';
import { el, icon, status } from './dom.ts';
import { api } from './state.ts';

/** Asks the extension to run one of the part's commands, with the value or project it's for. */
const ask = (command: string, arg: string | null): void => {
  api.postMessage(arg === null ? { type: 'toolbar', command } : { type: 'toolbar', command, arg });
};

/**
 * A button that runs a command, or, when it can't, stays in view and in the tab order, says why on hover and
 * to a screen reader, and does nothing: never a control that silently does nothing.
 */
function control(text: string, label: string, iconName: string | null, why: string | null, run: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', `btn ${cls}`.trim(), iconName ? icon(iconName) : null, text) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('aria-label', why ? `${label}: ${why}` : label);
  b.title = why ?? label;
  if (why) {
    b.setAttribute('aria-disabled', 'true');
    b.classList.add('is-disabled');
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!why) run();
  });
  return b;
}

const stepButton = (s: Step, text: string, command: string): HTMLButtonElement =>
  control(text, s.label, null, s.why, () => ask(command, s.arg), 'step-btn');

/** One cap: its title and project, − its number +, what it counts, its state, where it's set, and Change…. */
function capCard(c: CapCard): HTMLElement {
  const value = el('output', 'cap-value', c.value);
  value.setAttribute('aria-live', 'polite');
  const stepper = el('div', 'stepper', stepButton(c.lower, '−', c.command), value, stepButton(c.raise, '+', c.command));
  stepper.setAttribute('role', 'group');
  stepper.setAttribute('aria-label', c.project ? `${c.title}, ${c.project}` : c.title);
  const change = control('Change…', `Change ${c.project && !c.title.startsWith(c.project) ? `${c.project}'s cap` : c.title.toLowerCase()}`, 'edit', null, () => ask(c.command, c.arg));
  const card = el('div', 'cap-card',
    el('div', 'cap-head', el('span', 'strong', c.title), c.project && !c.title.startsWith(c.project) ? el('span', 'chip', c.project) : null),
    el('div', 'cap-row', stepper, el('span', 'muted cap-unit', c.unit)),
    el('div', 'cap-state', status(c.look)),
    el('p', 'muted small cap-from', c.from),
    el('div', 'actions', change));
  card.dataset.cap = c.key;
  return card;
}

/** A setting: its name, its value and state, where it's set, and Change…, or why it can't change here. */
function row(r: LimitRow): HTMLElement {
  const change = control('Change…', `Change ${r.name.toLowerCase()}`, 'edit', r.why, () => ask(r.command, r.arg));
  return el('div', 'settings-row limit-row',
    el('span', 'settings-name', icon(r.icon), el('span', 'strong', r.name)),
    el('div', 'settings-value',
      el('div', 'limit-value', el('span', 'mono', r.value), r.look ? status(r.look) : null),
      el('p', 'muted small settings-meaning', r.from),
      r.why ? el('p', 'muted small limit-why', icon('info'), r.why) : null),
    el('div', 'limit-change', change));
}

export function renderLimits(m: LimitsModel | null): Node[] {
  if (!m) return [el('p', 'muted', 'Reading this machine\'s limits…')];
  const caps = el('div', 'cap-cards', ...m.caps.map(capCard));
  const meaning = el('ul', 'limit-meaning', ...m.meaning.map((x) => {
    const li = el('li', '', icon(x.icon), el('span', '', x.text));
    li.dataset.meaning = x.key;
    return li;
  }));
  const out: Node[] = [
    el('h3', 'limit-heading', 'How many builders run at once'),
    caps,
    el('h3', 'limit-heading', 'What a change means'),
    meaning,
    m.billing ? el('div', 'limit-billing', status(m.billing)) : null,
    el('h3', 'limit-heading', 'This machine'),
    row(m.slots),
  ].filter((x): x is HTMLElement => !!x);
  for (const c of m.checks) {
    out.push(el('h3', 'limit-heading', m.checks.length > 1 ? `Checks · ${c.project}` : 'Checks'), ...c.rows.map(row));
  }
  if (!m.checks.length) out.push(el('h3', 'limit-heading', 'Checks'), el('p', 'muted', 'Checks are a project\'s: open a folder with an .acc/config.json to see and change them.'));
  return out;
}
