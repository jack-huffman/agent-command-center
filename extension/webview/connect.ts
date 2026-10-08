// The Connect page, drawn over the section that was showing.

import type { Look } from '../src/model/shared.ts';
import type { ConnectField, ConnectModel, ConnectPicker } from '../src/model/connect.ts';
import { button, type Child, el, icon, keptInput, segmented, status } from './dom.ts';
import { api, type PageArea, state } from './state.ts';

// ---------------------------------------------------------------- connecting a tracker (GH-51)

/**
 * What's typed on the Connect page that the extension hasn't taken in yet, by page and field. A token is
 * kept only here, never in the tab's memory, and goes when the page signs in or closes.
 */
export const connectTyped = new Map<string, string>();
/** Fields sent to the extension, with the page's revision then: a newer revision has taken them in. */
const connectSent = new Map<string, number>();
export let connectShown: string | null = null;

const connectSend = (m: ConnectModel, msg: Record<string, unknown>): void => api.postMessage({ ...msg, session: m.id });

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

/** A choice another repo on this machine uses already (GH-81): an icon and its words, never colour alone. */
const usedMark = (words: string): HTMLElement => el('span', 'used-by tone-orange', icon('warning', 'orange'), el('span', '', words));

function connectPicker(m: ConnectModel, p: ConnectPicker): HTMLElement {
  const id = `connect-${p.key}`;
  const text = (o: { label: string; detail: string | null }) => (o.detail ? `${o.label} · ${o.detail}` : o.label);
  const used = p.used ? el('div', `cfield-status tone-${p.used.tone}`, icon(p.used.icon, p.used.tone), el('span', '', p.used.label)) : null;
  if (p.fixed) {
    const o = p.options.find((x) => x.value === p.selected[0]);
    return connectRow(id, p.label, [el('span', 'cfield-fixed', icon('lock'), o ? text(o) : p.selected[0] ?? '')], 'Another one is another tracker: connect it on its own.', null);
  }
  if (p.multi) {
    const ticks = el('div', 'ticks');
    ticks.id = id;
    ticks.setAttribute('role', 'group');
    ticks.setAttribute('aria-label', p.label);
    for (const o of p.options) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = p.selected.includes(o.value);
      box.disabled = p.disabled;
      box.value = o.value;
      box.dataset.keep = `connect:${m.id}:${p.key}:${o.value}`;
      box.addEventListener('change', () => connectSend(m, { type: 'connect-pick', key: p.key, value: [...ticks.querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value) }));
      ticks.append(el('label', `tick${box.checked ? ' on' : ''}`, box, text(o), o.usedBy ? usedMark(o.usedBy) : null));
    }
    const none = p.whole ? el('div', 'muted small', icon(p.selected.length ? 'filter' : 'project'), p.selected.length ? ` Only issues with ${p.selected.length === 1 ? 'this label' : 'one of these labels'}.` : ` None ticked: ${p.whole}.`) : null;
    return connectRow(id, p.label, [p.options.length ? ticks : null, none, used], p.hint, p.look);
  }
  const select = document.createElement('select');
  select.id = id;
  select.className = 'select-input';
  select.disabled = p.disabled;
  select.dataset.keep = `connect:${m.id}:${p.key}`;
  const add = (value: string, label: string, disabled = false) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    o.disabled = disabled;
    select.append(o);
  };
  const label = p.label.toLowerCase();
  if (p.whole) add('', p.whole);
  else if (!p.selected.length) add('', p.look?.icon === 'sync~spin' ? 'Loading…' : p.disabled ? '' : `Choose ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}…`, true);
  // A list's own words carry the mark: an option can't hold an icon, so the one chosen shows it below.
  for (const o of p.options) add(o.value, o.usedBy ? `${text(o)} · ${o.usedBy}` : text(o));
  select.value = p.selected[0] ?? '';
  select.addEventListener('change', () => connectSend(m, { type: 'connect-pick', key: p.key, value: select.value || null }));
  return connectRow(id, p.label, [select, used], p.hint, p.look);
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

/**
 * The Connect page: one tracker's site, sign-in, place and board, each from its description. Nothing here
 * knows one tracker from another: a new tracker is a new description, not more of this.
 */
export function renderConnect(m: ConnectModel): Node[] {
  if (connectShown !== m.id) {
    connectTyped.clear();
    connectSent.clear();
    connectShown = m.id;
    state.scrolledTo = true;
  }
  // Taken in by the extension: its value shows now. Once signed in, the token typed is forgotten.
  for (const [k, rev] of connectSent) if (m.rev > rev) { connectTyped.delete(k); connectSent.delete(k); }
  // Signed in, the page shows no sign-in fields, so what was typed there (the token) is forgotten by key.
  if (!m.signIn.editing) for (const k of [...connectTyped.keys()]) if (k.startsWith(`${m.id}:`) && k !== `${m.id}:${m.host.key}`) connectTyped.delete(k);
  const back = button(m.back.label, 'arrow-left', () => connectSend(m, { type: 'connect-cancel' }), 'ghost');
  const test = () => {
    const typed = (key: string, value: string) => connectTyped.get(`${m.id}:${key}`) ?? value;
    connectSend(m, { type: 'connect-test', host: typed(m.host.key, m.host.value), fields: Object.fromEntries(m.fields.map((f) => [f.key, typed(f.key, f.value)])) });
  };
  const out: Node[] = [el('header', 'page-header', el('div', 'titles', el('h1', '', icon(m.icon), m.title), el('p', 'summary', m.summary)), el('div', 'toolbar', back))];
  if (m.projects.length) out.push(el('div', 'connect-choose', el('span', 'muted', 'Project'), segmented('Project', m.projects.map((p) => ({ key: p.root, label: p.name, icon: 'repo', on: p.on })), (root) => connectSend(m, { type: 'connect-project', root }))));
  if (m.kinds.length) out.push(el('div', 'connect-choose', el('span', 'muted', 'Tracker'), segmented('Tracker', m.kinds.map((k) => ({ key: k.kind, label: k.name, icon: k.icon, on: k.on })), (kind) => connectSend(m, { type: 'connect-kind', kind }))));
  const step = (n: number, title: string, ...rows: Child[]) => el('section', 'connect-step', el('h2', '', el('span', 'step-n', String(n)), title), ...rows);
  out.push(step(1, `Where it is`, connectInput(m, m.host, test)));
  const testButton = button(m.method.test, 'plug', test, m.signIn.look.tone === 'blue' && m.signIn.look.icon === 'pass' ? '' : 'primary');
  testButton.disabled = !m.signIn.canTest;
  const signIn: Child[] = m.signIn.editing ? [
    m.methods.length ? el('div', 'connect-choose', segmented('How to sign in', m.methods.map((x) => ({ key: x.id, label: x.label, icon: x.icon, on: x.on })), (method) => connectSend(m, { type: 'connect-method', method }))) : null,
    el('p', 'muted small connect-hint', m.method.hint),
    ...m.fields.map((f) => connectInput(m, f, test)),
    m.share.shown ? connectShare(m) : null,
    el('div', 'connect-test', testButton, el('div', `cfield-status tone-${m.signIn.look.tone}`, icon(m.signIn.look.icon, m.signIn.look.tone), el('span', '', m.signIn.look.label))),
  ] : [el('div', 'connect-test', status(m.signIn.look), button('Sign in again', 'account', () => connectSend(m, { type: 'connect-again' }), 'ghost'))];
  out.push(step(2, 'Sign in', ...signIn));
  // Until it's signed in there's nothing to list: say so, rather than show empty lists that look ready.
  const waiting = m.signIn.editing && m.pickers.some((p) => !p.fixed) ? el('p', 'muted small connect-hint', icon('lock'), ' Sign in above, and its lists fill in here.') : null;
  out.push(step(3, 'Its tickets and board', waiting, ...m.pickers.filter((p) => !p.hidden).map((p) => connectPicker(m, p))));
  const save = button(m.save.label, 'check', () => connectSend(m, { type: 'connect-save' }), 'primary');
  save.disabled = !m.save.can;
  out.push(el('div', 'connect-foot', save, button('Cancel', 'close', () => connectSend(m, { type: 'connect-cancel' }), 'ghost'), m.save.look ? status(m.save.look) : null));
  return [el('div', 'connect', ...out)];
}

export const area: PageArea = {
  cover(m) {
    if (!m.connect && connectShown) {
      connectShown = null;
      connectTyped.clear();
      state.scrolledTo = true;
    }
    return m.connect ? renderConnect(m.connect) : null;
  },
};
