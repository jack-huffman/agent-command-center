// Set up cloud builders (T-145): one modal over the section that opened it, stepped through as the tracker's
// is (T-140): its step bar, the step on show, and a foot that stays in view with Back, why Next is off,
// Cancel and Next. Each step is one line of what to do, its live check, its own buttons, and its detail
// folded away. Only a step's own button writes anything, and the extension runs it; Cancel, Escape and the
// backdrop close it, keeping only what those buttons saved.

import type { Look } from '../src/model/shared.ts';
import type { HomeModel, Model } from '../src/model/home.ts';
import type { CloudAction, CloudButton, CloudField, CloudSetupModel, CloudSetupStep } from '../src/model/cloud-setup.ts';
import { button, el, icon, keepFocus, keptInput, status } from './dom.ts';
import { makeModal } from './modal.ts';
import { api, type PageArea } from './state.ts';

/** Each step's icon, beside its title. */
const STEP_ICON: Record<CloudSetupStep, string> = { on: 'cloud', github: 'github', task: 'calendar', token: 'key', signin: 'account', guard: 'shield', ready: 'rocket' };

/**
 * What's typed in a step's field that the extension hasn't taken yet, by modal and field. The token is kept
 * only here, never in the tab's memory, and goes once it's sent or the modal closes.
 */
export const cloudTyped = new Map<string, string>();
/** The folds a person opened, so a redraw keeps them open; the tab's memory can start one open, as a screenshot does. */
const openFolds = new Set<string>((api.getState() as { cloudFolds?: string[] } | undefined)?.cloudFolds ?? []);

const send = (m: CloudSetupModel, msg: Record<string, unknown>) => api.postMessage({ ...msg, session: m.id });

/** Whether what's typed matches its field's pattern: the extension checks it again before it keeps it. */
export const fieldOk = (f: Pick<CloudField, 'pattern'>, v: string): boolean => new RegExp(f.pattern).test(v.trim());

/** A step's button: off with why in its title, a spinner while its work runs. */
function stepButton(m: CloudSetupModel, b: CloudButton, value?: () => string): HTMLButtonElement {
  const x = button(b.label, b.busy ? 'loading~spin' : b.icon, () => act(m, b.action, value?.()), b.primary ? 'primary' : '');
  x.disabled = !!b.disabled || b.busy;
  if (b.disabled) x.title = b.disabled;
  return x;
}

function act(m: CloudSetupModel, action: CloudAction, value?: string): void {
  send(m, { type: 'cloud-setup-act', action, ...(value === undefined ? {} : { value }) });
  // The token goes once: what was typed is forgotten as it's sent.
  if (action === 'keepToken') cloudTyped.delete(`${m.id}:token`);
}

/**
 * A step's field (the trigger id, or the token, hidden): its label, the box, and its button, with what's
 * wrong with it said as it's typed, in words and an icon. Its button is off until what's typed fits.
 */
function fieldRow(m: CloudSetupModel, f: CloudField): HTMLElement {
  const k = `${m.id}:${f.key}`;
  const id = `cloud-${f.key}`;
  const typed = () => cloudTyped.get(k) ?? f.value;
  const line = el('div', 'cloud-field-check small');
  line.setAttribute('aria-live', 'polite');
  const keep = stepButton(m, f.keep, () => typed());
  const draw = () => {
    const v = typed();
    const fits = fieldOk(f, v);
    const look: Look | null = !v.trim() ? null : fits ? { label: 'Looks right', icon: 'pass', tone: 'blue' } : { label: f.problem, icon: 'warning', tone: 'orange' };
    line.replaceChildren(...(look ? [status(look)] : []));
    const off = f.keep.disabled ?? (fits ? null : v.trim() ? f.problem : `Paste the ${f.label.toLowerCase()} first`);
    keep.disabled = !!off || f.keep.busy;
    keep.title = off ?? '';
  };
  const input = keptInput(`cloud:${k}`, typed(), f.placeholder, (v) => { cloudTyped.set(k, v); draw(); }, () => { if (!keep.disabled) keep.click(); }, f.secret ? 'password' : 'text');
  input.id = id;
  input.spellcheck = false;
  input.setAttribute('aria-label', f.label);
  draw();
  const label = el('label', 'cloud-field-label', f.label);
  label.setAttribute('for', id);
  return el('div', 'cloud-field', label, el('div', 'cloud-field-row', input, keep), line);
}

/** The step bar: each step's number and title, and where it stands as an icon; one not reachable yet is off, with why. */
function stepBar(m: CloudSetupModel): HTMLElement {
  const list = el('ol', 'cstep-bar', ...m.steps.map((x, i) => {
    const mark = x.state === 'current' ? icon('circle-filled', 'blue') : x.state === 'done' ? icon('pass-filled', 'blue') : icon('circle-large-outline');
    const b = el('button', `cstep ${x.state}`, mark, el('span', 'cstep-name', `${i + 1}. ${x.title}`)) as HTMLButtonElement;
    b.type = 'button';
    b.disabled = !x.can && x.state !== 'current';
    b.title = x.state === 'current' ? `${x.title}: you are here` : x.can ? `Go to ${x.title}: ${x.look.label}` : `${x.title}: ${x.why ?? ''}`;
    if (x.state === 'current') b.setAttribute('aria-current', 'step');
    b.addEventListener('click', () => { if (x.state !== 'current') send(m, { type: 'cloud-setup-step', step: x.id }); });
    return el('li', '', b);
  }));
  list.setAttribute('aria-label', 'Steps');
  return list;
}

/** The step's detail, folded away: a summary to open it, short lines, and labelled links. */
function fold(m: CloudSetupModel): HTMLElement {
  const f = m.view.fold;
  const key = `${m.step}`;
  const d = el('details', 'agent-fold cloud-fold',
    el('summary', '', el('span', 'tool-chev', icon('chevron-right')), el('span', '', f.summary)),
    el('ul', 'cloud-fold-lines', ...f.lines.map((l) => el('li', '', l))),
    f.links.length ? el('div', 'cloud-links', ...f.links.map((l) => button(l.label, 'link-external', () => api.postMessage({ type: 'open', url: l.url }), 'ghost'))) : null) as HTMLDetailsElement;
  d.open = openFolds.has(key);
  d.addEventListener('toggle', () => { if (d.open) openFolds.add(key); else openFolds.delete(key); });
  return d;
}

/** The step on show: its title, one line, its check, its buttons, its numbered lines and field, and its fold. */
export function renderCloudSetup(m: CloudSetupModel): Node[] {
  const v = m.view;
  const current = m.steps.find((x) => x.id === m.step)!;
  const heading = el('h2', '', icon(STEP_ICON[m.step]), current.title);
  heading.tabIndex = -1;
  const check = el('div', 'cloud-check', status(v.look));
  check.setAttribute('aria-live', 'polite');
  return [el('div', 'connect', stepBar(m), el('section', `connect-step cloud-step cloud-${m.step}`,
    heading,
    el('p', 'cloud-line', v.line),
    check,
    v.buttons.length ? el('div', 'cloud-buttons', ...v.buttons.map((b) => stepButton(m, b))) : null,
    v.numbered.length ? el('ol', 'cloud-numbered', ...v.numbered.map((l) => el('li', '', l))) : null,
    v.field ? fieldRow(m, v.field) : null,
    v.facts.length ? el('ul', 'cloud-facts', ...v.facts.map((f) => el('li', '', el('span', 'cloud-fact-name', f.label), status(f.look)))) : null,
    v.error ? el('div', 'cloud-error', status({ label: v.error, icon: 'warning', tone: 'orange' })) : null,
    fold(m)))];
}

/** The foot: Back, why Next is off, Cancel, and Next, or Done on Ready. */
function foot(m: CloudSetupModel): HTMLElement {
  const i = m.steps.findIndex((x) => x.id === m.step);
  const back = i > 0 ? button('Back', 'arrow-left', () => send(m, { type: 'cloud-setup-step', step: m.steps[i - 1]!.id }), 'ghost') : null;
  const cancel = button('Cancel', 'close', () => send(m, { type: 'cloud-setup-cancel' }), 'ghost');
  cancel.disabled = !m.cancel.can;
  if (m.cancel.why) cancel.title = m.cancel.why;
  const go = m.next ? button('Next', 'arrow-right', () => send(m, { type: 'cloud-setup-step', step: m.steps[i + 1]!.id }), 'primary')
    : button('Done', 'check', () => send(m, { type: 'cloud-setup-cancel' }), 'primary');
  go.disabled = m.next ? !m.next.can : !m.cancel.can;
  const why = m.next?.why ?? null;
  if (go.disabled && why) go.title = why.label;
  return el('div', 'connect-foot', back, el('div', 'connect-foot-why', why ? status(why) : null), m.next ? cancel : null, go);
}

let dialog: HTMLDialogElement | null = null;
let body: HTMLElement | null = null;
let title: HTMLElement | null = null;
let footBox: HTMLElement | null = null;
let drawn: CloudSetupModel | null = null;

function make(): HTMLDialogElement {
  title = el('h1', 'connect-title');
  const close = button('Close', 'close', () => shut(), 'ghost task-modal-close');
  close.title = 'Close it: what a step\'s own button saved stays saved (Escape)';
  const m = makeModal('connect-modal cloud-modal', [title, close], shut);
  body = m.body;
  footBox = el('div', 'connect-modal-foot');
  m.dialog.append(footBox);
  return m.dialog;
}

/** Cancel, Escape or the backdrop: the extension closes it, unless a step's work is under way. */
function shut(): void {
  if (drawn) send(drawn, { type: 'cloud-setup-cancel' });
}

/** Draws the modal for the model, opening it, or closes it when it isn't open. */
function show(m: CloudSetupModel | null): void {
  if (!m) {
    drawn = null;
    cloudTyped.clear();
    if (dialog?.open) dialog.close();
    body?.replaceChildren();
    footBox?.replaceChildren();
    return;
  }
  if (drawn && drawn.id !== m.id) cloudTyped.clear();
  dialog ??= make();
  const same = dialog.open && drawn?.id === m.id && drawn.step === m.step;
  const y = same ? body!.scrollTop : 0;
  const keep = keepFocus();
  drawn = m;
  title!.replaceChildren(icon('cloud'), el('span', '', `${m.title} · ${m.project}`));
  dialog.setAttribute('aria-label', `${m.title} for ${m.project}`);
  body!.replaceChildren(...renderCloudSetup(m));
  footBox!.replaceChildren(foot(m));
  body!.scrollTop = y;
  if (!dialog.open) dialog.showModal();
  // Another step starts at its top, with focus on its heading; the same step keeps its place and its focus.
  if (same) keep();
  else body!.querySelector<HTMLElement>('.cloud-step h2')?.focus({ preventScroll: true });
}

export const area: PageArea = {
  // The modal follows the model: open while cloud builders are being set up, closed when they aren't.
  after(model: Model) {
    show(model.kind === 'home' ? (model as HomeModel).cloudSetup ?? null : null);
  },
};
