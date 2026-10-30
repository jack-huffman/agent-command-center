// Adding or changing a board (T-140): one modal over the section that opened it, stepped through: the
// tracker, its site and sign-in, the board with its lists as dropdowns across the top and the board they make
// under them, then Save. Back and Next keep every choice, which the extension holds; Cancel, Escape and the
// backdrop change nothing. Connect a tracker opens it at the click, loading, until a model holds the page (T-162).

import type { Look } from '../src/model/shared.ts';
import type { HomeModel, Model } from '../src/model/home.ts';
import type { ConnectField, ConnectModel, ConnectPicker, ConnectStep } from '../src/model/connect.ts';
import { button, type Child, el, icon, keepFocus, keptInput, segmented, status } from './dom.ts';
import { api, onSent, type PageArea } from './state.ts';
import { changesFieldConnect } from './changes-field.ts';
import { connectSend, previewPanel } from './choose-board.ts';
import { pickerDropdown } from './dropdown.ts';
import { LOAD_LIMIT_MS, Opening } from './loading.ts';
import { makeModal } from './modal.ts';

// ---------------------------------------------------------------- connecting a tracker (GH-51)

/**
 * What's typed on the Connect page that the extension hasn't taken in yet, by page and field. A token is
 * kept only here, never in the tab's memory, and goes when the page signs in or closes.
 */
export const connectTyped = new Map<string, string>();
/** Fields sent to the extension, with the page's revision then: a newer revision has taken them in. */
const connectSent = new Map<string, number>();
export let connectShown: string | null = null;

/** One labelled row: the label, then the control, its hint and what's wrong with it, beside each other. */
function connectRow(id: string, label: string, control: Child[], hint: string | null, look: Look | null): HTMLElement {
  const name = el('label', 'cfield-label', label);
  name.setAttribute('for', id);
  return el('div', 'cfield', name, el('div', 'cfield-control', ...control, look ? el('div', `cfield-status tone-${look.tone}`, icon(look.icon, look.tone), el('span', '', look.label)) : null, hint ? el('div', 'muted small cfield-hint', hint) : null));
}

const errorLook = (text: string | null): Look | null => (text ? { label: text, icon: 'warning', tone: 'orange' } : null);

function connectInput(m: ConnectModel, f: ConnectField, onEnter: () => void): HTMLElement {
  const id = `connect-${f.key}`;
  if (f.fixed) return connectRow(id, f.label, [el('span', 'cfield-fixed', icon('lock'), f.value)], null, errorLook(f.error));
  const k = `${m.id}:${f.key}`;
  const input = keptInput(`connect:${k}`, connectTyped.get(k) ?? f.value, f.placeholder, (v) => connectTyped.set(k, v), onEnter, f.type === 'secret' ? 'password' : f.type === 'email' ? 'email' : 'text');
  input.id = id;
  input.setAttribute('aria-label', f.label);
  input.spellcheck = false;
  if (f.error) input.setAttribute('aria-invalid', 'true');
  // Typing a token is sent only with Test connection; everything else is taken in when the field is left.
  if (f.type !== 'secret') input.addEventListener('change', () => { connectSend(m, { type: 'connect-set', field: f.key, value: input.value }); connectSent.set(k, m.rev); });
  const help = f.help ? button(f.help.label, 'link-external', () => api.postMessage({ type: 'open', url: f.help!.url }), 'ghost') : null;
  return connectRow(id, f.label, [el('div', 'cfield-input', input, help)], f.hint, errorLook(f.error));
}

/** A status line under a dropdown (T-140): an icon and words, never colour alone. */
const pickLine = (look: Look | null): HTMLElement | null => (look ? el('div', `cfield-status small tone-${look.tone}`, icon(look.icon, look.tone), el('span', '', look.label)) : null);

/**
 * One list as a dropdown across the top of the board step (T-140): its label over it, and under it what's
 * loading, why its list or the board couldn't be read with its choice, or a choice another repo uses already.
 * An existing board's site or project isn't changed here, so it's shown as text with a lock.
 */
function connectPicker(m: ConnectModel, p: ConnectPicker): HTMLElement {
  const id = `connect-${p.key}`;
  const name = el('label', 'cdrop-label', p.label);
  name.setAttribute('for', id);
  const text = (o: { label: string; detail: string | null }) => (o.detail ? `${o.label} · ${o.detail}` : o.label);
  const fixed = p.options.find((x) => x.value === p.selected[0]);
  const choice = p.fixed ? el('span', 'cfield-fixed', icon('lock'), el('span', '', fixed ? text(fixed) : p.selected[0] ?? '')) : pickerDropdown(m, p, id);
  if (p.fixed) choice.id = id;
  const box = el('div', 'cpick', name, choice, pickLine(p.look), pickLine(p.error), pickLine(p.used), p.hint ? el('div', 'muted small cfield-hint', p.hint) : null);
  box.dataset.key = p.key;
  return box;
}

/** The board's name (T-127): taken in when the field is left, and written with the rest on Save. Empty is its tracker's own. */
function boardNameRow(m: ConnectModel): HTMLElement {
  const id = 'connect-board-name';
  const k = `${m.id}:${m.boardName.field}`;
  const input = keptInput(`connect:${k}`, connectTyped.get(k) ?? m.boardName.value, m.boardName.placeholder, (v) => connectTyped.set(k, v), () => input.blur(), 'text');
  input.id = id;
  input.maxLength = m.boardName.max;
  input.setAttribute('aria-label', 'Board\'s name');
  input.addEventListener('change', () => { connectSend(m, { type: 'connect-set', field: m.boardName.field, value: input.value }); connectSent.set(k, m.rev); });
  return connectRow(id, 'Board\'s name', [el('div', 'cfield-input', input)], m.boardName.hint, null);
}

/** The tick that keeps the sign-in for every project on its site, or this one only (GH-79). Sent when it changes. */
function connectShare(m: ConnectModel): HTMLElement {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'connect-share';
  box.checked = m.share.on;
  box.dataset.keep = `connect:${m.id}:share`;
  box.addEventListener('change', () => connectSend(m, { type: 'connect-share', on: box.checked }));
  return el('div', 'connect-share', el('label', `tick${m.share.on ? ' on' : ''}`, box, m.share.label), el('div', 'muted small cfield-hint', icon(m.share.on ? 'globe' : 'repo'), ` ${m.share.hint}`));
}

/** Each step's icon, beside its title (T-140). */
const STEP_ICON: Record<ConnectStep, string> = { tracker: 'plug', site: 'account', board: 'project', save: 'check' };

/**
 * The step bar (T-140): each step's number and title, and where it stands as an icon: a tick done, a dot here,
 * a ring to do. One that can be gone to is a button; one that can't yet is off, with why in its title.
 */
function stepBar(m: ConnectModel): HTMLElement {
  const list = el('ol', 'cstep-bar', ...m.steps.map((x, i) => {
    const mark = x.state === 'done' ? icon('pass-filled', 'blue') : x.state === 'current' ? icon('circle-filled', 'blue') : icon('circle-large-outline');
    const b = el('button', `cstep ${x.state}`, mark, el('span', 'cstep-name', `${i + 1}. ${x.title}`)) as HTMLButtonElement;
    b.type = 'button';
    b.disabled = !x.can && x.state !== 'current';
    b.title = x.state === 'current' ? `${x.title}: you are here` : x.can ? `Go to ${x.title}` : `${x.title}: finish the steps before it first`;
    if (x.state === 'current') b.setAttribute('aria-current', 'step');
    b.addEventListener('click', () => { if (x.state !== 'current') connectSend(m, { type: 'connect-step', step: x.id }); });
    return el('li', '', b);
  }));
  list.setAttribute('aria-label', 'Steps');
  return list;
}

/** Step 1 (T-140): the project, when there are several, and the tracker; an existing board's are kept, and shown. */
function trackerStep(m: ConnectModel): Child[] {
  return [
    m.projects.length ? el('div', 'connect-choose', el('span', 'muted', 'Project'), segmented('Project', m.projects.map((p) => ({ key: p.root, label: p.name, icon: 'repo', on: p.on })), (root) => connectSend(m, { type: 'connect-project', root }))) : null,
    m.kinds.length ? el('div', 'connect-choose', el('span', 'muted', 'Tracker'), segmented('Tracker', m.kinds.map((k) => ({ key: k.kind, label: k.name, icon: k.icon, on: k.on })), (kind) => connectSend(m, { type: 'connect-kind', kind })))
      : el('div', 'connect-choose', el('span', 'muted', 'Tracker'), el('span', 'cfield-fixed', icon(m.icon), el('span', '', m.name))),
    el('p', 'muted small connect-hint', m.summary),
  ];
}

/** Step 2 (T-140): its site or account, and signing in; once signed in, who as, with Sign in again. */
function siteStep(m: ConnectModel, test: () => void): Child[] {
  const testButton = button(m.method.test, 'plug', test, m.signIn.look.tone === 'blue' && m.signIn.look.icon === 'pass' ? '' : 'primary');
  testButton.disabled = !m.signIn.canTest;
  if (m.signIn.why) testButton.title = m.signIn.why.label;
  const signIn: Child[] = m.signIn.editing ? [
    m.methods.length ? el('div', 'connect-choose', segmented('How to sign in', m.methods.map((x) => ({ key: x.id, label: x.label, icon: x.icon, on: x.on })), (method) => connectSend(m, { type: 'connect-method', method }))) : null,
    el('p', 'muted small connect-hint', m.method.hint),
    ...m.fields.map((f) => connectInput(m, f, test)),
    m.share.shown ? connectShare(m) : null,
    el('div', 'connect-test', testButton, el('div', `cfield-status tone-${m.signIn.look.tone}`, icon(m.signIn.look.icon, m.signIn.look.tone), el('span', '', m.signIn.look.label)), m.signIn.why ? status(m.signIn.why) : null),
  ] : [el('div', 'connect-test', status(m.signIn.look), button('Sign in again', 'account', () => connectSend(m, { type: 'connect-again' }), 'ghost'))];
  return [connectInput(m, m.host, test), ...signIn];
}

/** Step 3 (T-140): the lists as dropdowns across the top, and the board they make under them, drawn again as each changes. */
function boardStep(m: ConnectModel): Child[] {
  return [el('div', 'cpick-row', ...m.pickers.filter((p) => !p.hidden).map((p) => connectPicker(m, p))), previewPanel(m)];
}

/** Step 4 (T-140): an existing board's tickets before and after, what Save keeps with each change marked, its changes field and its name. */
function saveStep(m: ConnectModel): Child[] {
  const rows = el('dl', 'csave-list', ...m.kept.flatMap((k) => [
    el('dt', '', k.label),
    el('dd', '', el('span', '', k.value || 'None'), k.changed ? el('span', 'csave-mark tone-orange', icon('diff-modified', 'orange'), el('span', '', 'changes')) : null),
  ]));
  const change = m.change ? el('div', 'csave-change',
    el('span', 'csave-count', icon('history'), el('span', '', `Before: ${m.change.before}`)),
    icon('arrow-right'),
    el('span', 'csave-count', icon('project', 'blue'), el('span', '', `After: ${m.change.after}`))) : null;
  return [change, rows, m.changesField ? changesFieldConnect(m.changesField) : null, boardNameRow(m)];
}

/**
 * The modal's foot (T-140): Back, why the next step is off, Cancel, and Next, or Save on the last step, which
 * alone writes the board. Remove this board… sits on Save's step for an existing one.
 */
function foot(m: ConnectModel): HTMLElement {
  const i = m.steps.findIndex((x) => x.id === m.step);
  const back = i > 0 ? button('Back', 'arrow-left', () => connectSend(m, { type: 'connect-step', step: m.steps[i - 1]!.id }), 'ghost') : null;
  const cancel = button('Cancel', 'close', () => connectSend(m, { type: 'connect-cancel' }), 'ghost');
  cancel.disabled = !m.cancel.can;
  if (m.cancel.why) cancel.title = m.cancel.why;
  const go = m.next ? button('Next', 'arrow-right', () => connectSend(m, { type: 'connect-step', step: m.steps[i + 1]!.id }), 'primary')
    : button(m.save.label, 'check', () => connectSend(m, { type: 'connect-save' }), 'primary');
  go.disabled = m.next ? !m.next.can : !m.save.can;
  const why = m.next ? m.next.why : m.save.look ?? m.save.why;
  if (go.disabled && why) go.title = why.label;
  // Remove an existing board (T-127): the extension asks first, naming it.
  const remove = !m.next && m.remove ? button(m.remove.label, 'trash', () => api.postMessage({ type: 'toolbar', command: m.remove!.command, arg: m.remove!.arg }), 'ghost connect-remove') : null;
  return el('div', 'connect-foot', back, remove, el('div', 'connect-foot-why', why ? status(why) : null), cancel, go);
}

/**
 * The modal's content: the step bar, then the step on show, from the tracker's description. Nothing here
 * knows one tracker from another: a new tracker is a new description, not more of this.
 */
export function renderConnect(m: ConnectModel): Node[] {
  if (connectShown !== m.id) {
    connectTyped.clear();
    connectSent.clear();
    connectShown = m.id;
  }
  // Taken in by the extension: its value shows now. Once signed in, the token typed is forgotten.
  for (const [k, rev] of connectSent) if (m.rev > rev) { connectTyped.delete(k); connectSent.delete(k); }
  // Signed in, the page shows no sign-in fields, so what was typed there (the token) is forgotten by key.
  if (!m.signIn.editing) for (const k of [...connectTyped.keys()]) if (k.startsWith(`${m.id}:`) && k !== `${m.id}:${m.host.key}`) connectTyped.delete(k);
  const test = () => {
    const typed = (key: string, value: string) => connectTyped.get(`${m.id}:${key}`) ?? value;
    connectSend(m, { type: 'connect-test', host: typed(m.host.key, m.host.value), fields: Object.fromEntries(m.fields.map((f) => [f.key, typed(f.key, f.value)])) });
  };
  const current = m.steps.find((x) => x.id === m.step)!;
  const content = m.step === 'tracker' ? trackerStep(m) : m.step === 'site' ? siteStep(m, test) : m.step === 'board' ? boardStep(m) : saveStep(m);
  const heading = el('h2', '', icon(STEP_ICON[m.step]), current.title);
  heading.tabIndex = -1;
  return [el('div', 'connect', stepBar(m), el('section', `connect-step cstep-${m.step}`, heading, ...content))];
}

/** The modal, made the first time a board is added or changed: its title, the part that scrolls, and its foot. */
let dialog: HTMLDialogElement | null = null;
let body: HTMLElement | null = null;
let title: HTMLElement | null = null;
let footBox: HTMLElement | null = null;
/** The model last drawn in it, so Escape and the backdrop cancel that page. */
let drawn: ConnectModel | null = null;

function make(): HTMLDialogElement {
  title = el('h1', 'connect-title');
  const close = button('Close', 'close', () => shut(), 'ghost task-modal-close');
  close.title = 'Close it, and keep nothing (Escape)';
  const m = makeModal('connect-modal', [title, close], shut);
  body = m.body;
  // The foot stays in view under the part that scrolls, so Next and Save are always a click away.
  footBox = el('div', 'connect-modal-foot');
  m.dialog.append(footBox);
  return m.dialog;
}

/** The modal's wait, from the click until a model holds the page (T-162). */
const waiting = new Opening();
/** Closed while it loaded: until when the page that comes after is cancelled, not shown. */
let dropUntil = 0;

/** Connect a tracker was clicked: the modal opens now, loading, until a model holds the page. */
function waitFor(msg: Record<string, unknown>): void {
  dialog ??= make();
  dropUntil = 0;
  title!.replaceChildren(icon('plug'), el('span', '', 'Connect a tracker'));
  dialog.setAttribute('aria-label', 'Connect a tracker');
  footBox!.replaceChildren();
  waiting.start('connect', body!, 'Opening Connect a tracker…', 'Connect a tracker', [], () => api.postMessage(msg));
  if (!dialog.open) dialog.showModal();
  body!.focus({ preventScroll: true });
}

/** Cancel, Escape or the backdrop (T-140): the extension forgets the choices and writes nothing, and the model it sends then closes the modal. */
function shut(): void {
  if (drawn) return connectSend(drawn, { type: 'connect-cancel' });
  // Still loading: it closes now, and the page the extension opens for it is cancelled as it comes.
  if (!waiting.key) return;
  waiting.end();
  dropUntil = Date.now() + LOAD_LIMIT_MS;
  if (dialog?.open) dialog.close();
}

/** Draws the modal for the model, opening it, or closes it when no board is being added or changed. */
function show(m: ConnectModel | null): void {
  // Loading: a model with no page yet leaves it loading.
  if (!m && waiting.key) return;
  if (m && !drawn && Date.now() < dropUntil) {
    dropUntil = 0;
    return connectSend(m, { type: 'connect-cancel' });
  }
  waiting.end();
  if (!m) {
    drawn = null;
    connectShown = null;
    connectTyped.clear();
    if (dialog?.open) dialog.close();
    body?.replaceChildren();
    footBox?.replaceChildren();
    return;
  }
  dialog ??= make();
  const same = dialog.open && drawn?.id === m.id && drawn.step === m.step;
  const y = same ? body!.scrollTop : 0;
  const keep = keepFocus();
  drawn = m;
  title!.replaceChildren(icon(m.icon), el('span', '', m.title));
  dialog.setAttribute('aria-label', m.title);
  body!.replaceChildren(...renderConnect(m));
  footBox!.replaceChildren(foot(m));
  body!.scrollTop = y;
  if (!dialog.open) dialog.showModal();
  // Another step starts at its top, with focus on its heading; the same step keeps its place and its focus.
  if (same) keep();
  else body!.querySelector<HTMLElement>('.connect-step h2')?.focus({ preventScroll: true });
}

onSent((m) => { if (m.type === 'toolbar' && m.command === 'acc.trackers.add') waitFor(m); });

export const area: PageArea = {
  // The modal follows the model (T-140): open while a board is added or changed, closed when it isn't.
  after(model: Model) {
    show(model.kind === 'home' ? (model as HomeModel).connect ?? null : null);
  },
};
