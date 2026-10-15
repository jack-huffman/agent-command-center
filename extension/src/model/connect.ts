/**
 * Connecting a tracker: the Connect page, drawn from a tracker's description.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { type ConfigPath, keyShown, UNREAD_KEYS } from '../../../packages/core/src/config.ts';
import { declaredKeys, DESCRIPTIONS, type Option, type TrackerDescription, type Values } from '../../../packages/core/src/trackers/connect.ts';
import { signInScope } from '../logic/connect.ts';
import { settingsKey } from './settings.ts';
import { type HomeSection, type Look, LOOK, type ModelArea, short, taskNames, VIEW_TITLES } from './shared.ts';

// ---------------------------------------------------------------- connecting a tracker (GH-51)

/** A choice in a list, and which other repo on this machine uses it already, in words (GH-81). */
export type ConnectOption = Option & { usedBy?: string };

/** One list on the Connect page, as the extension keeps it while the page is open. */
export interface ConnectPickerState {
  options: ConnectOption[];
  /** The values chosen. None is the whole project for a picker that has one. */
  selected: string[];
  state: 'waiting' | 'loading' | 'ready' | 'failed';
  error: string | null;
}

/**
 * The Connect page while it's open, as the extension keeps it. It never holds a token: a secret is typed
 * on the page, sent once to sign in, and kept only in VSCode's secret storage (D-027).
 */
export interface ConnectState {
  id: string;
  /** Goes up with every change, so the page knows its typing has been taken in. */
  rev: number;
  root: string | null;
  /** The projects to choose from, when it was opened with none named and there are several. */
  projects: { root: string; name: string }[];
  projectName: string;
  /** The project's own GitHub repo and account, which a GitHub tracker uses by default. */
  ownRepo: string | null;
  ghAccount: string | null;
  kind: string;
  /** The tracker being changed, by its place in the list, or null for a new one. */
  existing: { index: number; title: string } | null;
  /**
   * A project being started from an epic, an area path or labels (GH-81): acc init writes its config on
   * Save, the place is required, and the whole project isn't offered.
   */
  start: boolean;
  /** The section to go back to. */
  from: HomeSection;
  host: string;
  hostError: string | null;
  method: string;
  /** What's typed in the sign-in's fields, secrets left out. */
  fields: Record<string, string>;
  fieldErrors: Record<string, string>;
  /**
   * again: Sign in again was clicked, so the fields show though it's signed in. shared: where the sign-in
   * in use is kept (GH-79), for every project on the site or this repo only; absent for gh.
   */
  signIn: { state: 'none' | 'testing' | 'ok' | 'failed'; who: string | null; error: string | null; again: boolean; shared?: boolean };
  /** The tick: keep the next sign-in for every project on the site (GH-79), rather than this repo only. */
  share: boolean;
  /** The person ticked or unticked it, so its default no longer applies, whatever site is typed next. */
  shareTouched: boolean;
  pickers: Record<string, ConnectPickerState>;
  saving: boolean;
  saveError: string | null;
}

export interface ConnectField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'secret';
  /** Always empty for a secret. */
  value: string;
  placeholder: string;
  hint: string | null;
  error: string | null;
  /** Shown as text: an existing tracker's site, organization or repo isn't changed here. */
  fixed: boolean;
  help: { label: string; url: string } | null;
}

export interface ConnectPicker {
  key: string;
  label: string;
  multi: boolean;
  /** The whole project, listed first; chosen when nothing is. */
  whole: string | null;
  /** usedBy: "used by acme-portal", when another repo on this machine uses it already (GH-81). */
  options: { value: string; label: string; detail: string | null; usedBy: string | null }[];
  selected: string[];
  /** Loading, or why the list couldn't be read, beside it. Null when there's nothing to say. */
  look: Look | null;
  /** A choice another repo here uses already, with an icon and words under the list (GH-81). */
  used: Look | null;
  disabled: boolean;
  fixed: boolean;
  /** It needs a choice before Save. */
  required: boolean;
  /** Not drawn: its one choice is made already, so there's nothing to pick. */
  hidden: boolean;
  hint: string | null;
}

/** What the Connect page draws (GH-51). Every part comes from a tracker's description: the page has no tracker of its own. */
export interface ConnectModel {
  id: string;
  rev: number;
  title: string;
  summary: string;
  /** The section to go back to, and, opened from Settings, its part: Trackers and sign-ins (GH-112). */
  back: { section: HomeSection; label: string; part: string | null };
  /** A project to choose, when there are several and none was named. */
  projects: { root: string; name: string; on: boolean }[];
  /** The kinds to choose from; empty for an existing tracker. */
  kinds: { kind: string; name: string; icon: string; on: boolean }[];
  kind: string;
  name: string;
  icon: string;
  host: ConnectField;
  /** The ways to sign in, when there's more than one. */
  methods: { id: string; label: string; icon: string; on: boolean }[];
  method: { id: string; hint: string; test: string };
  fields: ConnectField[];
  /** why: the reason Test connection is off, in words, beside it; null when it's on (T-43). */
  signIn: { look: Look; editing: boolean; canTest: boolean; why: Look | null };
  /** Use this sign-in for every project on the site (GH-79): shown while a sign-in is typed, never for gh. */
  share: { shown: boolean; on: boolean; label: string; hint: string };
  pickers: ConnectPicker[];
  /** The third step's heading, from the description (T-43). */
  listsTitle: string;
  /** Starting a project (GH-81): which list stands in for an epic, and the description's words for it. Null otherwise. */
  place: { key: string; words: string } | null;
  /** why: the reason the button is off, in words, beside it; null when it's on (T-43). */
  save: { can: boolean; label: string; look: Look | null; why: Look | null };
}

/** The usual heading of the Connect page's third step (T-43). */
export const LISTS_TITLE = 'Its tickets and board';

/** Why a button is off, as a word and an icon beside it: "Sign in and choose a project first." (T-43) */
const whyOff = (words: string): Look => LOOK(words, 'lock', 'neutral');

/** A fresh page for one kind of tracker, or for an existing one with its choices filled in. */
export function blankConnect(d: TrackerDescription, i: {
  id: string; root: string | null; projects?: ConnectState['projects']; projectName: string; ownRepo: string | null; ghAccount: string | null; from: HomeSection;
  gitEmail?: string | null; existing?: { index: number; title: string; host: string; values: Values } | null; start?: boolean;
}): ConnectState {
  const method = d.methods[0]!;
  const fields = Object.fromEntries(d.methods.flatMap((m) => m.fields).filter((f) => f.type !== 'secret').map((f) => [f.key, f.prefill === 'git-email' ? i.gitEmail ?? '' : '']));
  const was = i.existing?.values ?? {};
  const pickers = Object.fromEntries(d.pickers.map((p) => {
    const v = was[p.key];
    return [p.key, { options: [], selected: Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [], state: 'waiting', error: null } satisfies ConnectPickerState];
  }));
  return {
    id: i.id, rev: 0, root: i.root, projects: i.projects ?? [], projectName: i.projectName, ownRepo: i.ownRepo, ghAccount: i.ghAccount, kind: d.kind,
    existing: i.existing ? { index: i.existing.index, title: i.existing.title } : null, start: !!i.start && !i.existing, from: i.from,
    host: i.existing?.host ?? (d.host.prefill === 'github-repo' ? i.ownRepo ?? '' : ''), hostError: null,
    method: method.id, fields, fieldErrors: {}, signIn: { state: 'none', who: null, error: null, again: false }, share: true, shareTouched: false, pickers, saving: false, saveError: null,
  };
}

/** The values chosen so far, as a description's lists and toConfig read them. */
export function connectValues(s: ConnectState, d: TrackerDescription): Values {
  return Object.fromEntries(d.pickers.map((p) => {
    const sel = s.pickers[p.key]?.selected ?? [];
    return [p.key, p.multi ? (sel.length ? sel : null) : sel[0] ?? null];
  }));
}

const SECTION_WORD: Record<HomeSection, string> = { overview: 'Overview', ...VIEW_TITLES };

/** What the Connect page draws. A picker whose tracker key nothing reads yet isn't offered (GH-107): `unread` is UNREAD_KEYS, or a test's own. */
export function connectModel(s: ConnectState, list: TrackerDescription[] = DESCRIPTIONS, unread: Partial<Record<ConfigPath, string>> = UNREAD_KEYS): ConnectModel {
  const d = list.find((x) => x.kind === s.kind) ?? list[0]!;
  const method = d.methods.find((m) => m.id === s.method) ?? d.methods[0]!;
  const ok = s.signIn.state === 'ok';
  const editing = !ok || s.signIn.again;
  const values = connectValues(s, d);
  // What each list's choice is called, for words such as "Every group on Client work".
  const labels = Object.fromEntries(d.pickers.map((p) => {
    const ps = s.pickers[p.key];
    return [p.key, ps?.options.find((o) => o.value === ps.selected[0])?.label ?? null];
  }));
  const host: ConnectField = {
    key: d.host.key, label: d.host.label, type: 'text', value: s.host, placeholder: d.host.placeholder, hint: d.host.hint, error: s.hostError, fixed: !!s.existing, help: null,
  };
  const fields: ConnectField[] = method.fields.map((f) => {
    const url = f.help?.url(s.hostError ? '' : s.host) ?? null;
    return {
      key: f.key, label: f.label, type: f.type, value: f.type === 'secret' ? '' : s.fields[f.key] ?? '', placeholder: f.placeholder, hint: f.hint ?? null,
      error: s.fieldErrors[f.key] ?? null, fixed: false, help: f.help && url ? { label: f.help.label, url } : null,
    };
  });
  const testing = s.signIn.state === 'testing';
  // The site, organization or account, by name once it's known (GH-79).
  const site = s.host && !s.hostError ? s.host : `this ${d.host.label.toLowerCase()}`;
  const scope = s.signIn.shared === undefined ? '' : `, ${signInScope(s.signIn.shared, site)}`;
  const look: Look = testing ? LOOK(method.via === 'microsoft' ? 'Waiting for the Microsoft sign-in' : 'Testing the connection', 'sync~spin', 'blue')
    : ok ? LOOK(`Signed in as ${s.signIn.who}${scope}`, 'pass', 'blue')
      : s.signIn.state === 'failed' ? LOOK(s.signIn.error ?? 'Not signed in', 'warning', 'orange')
        : LOOK(method.via === 'gh' && s.ghAccount ? `Signs in as ${s.ghAccount}` : 'Not signed in yet', 'circle-large-outline', 'neutral');
  const pickers: ConnectPicker[] = d.pickers.filter((p) => keyShown(`trackers[].${p.key}` as ConfigPath, unread)).map((p) => {
    const ps = s.pickers[p.key] ?? { options: [], selected: [], state: 'waiting', error: null };
    const fixed = !!s.existing && !!p.identifies;
    // Starting a project from its place, the place is required: the whole project is Other project's (GH-81).
    const place = s.start && p.key === d.place.key;
    const whole = p.whole && !place ? p.whole({ host: s.host, values, labels }) : null;
    const pickerLook = fixed ? null : ps.state === 'loading' ? LOOK('Loading', 'sync~spin', 'blue')
      : ps.state === 'failed' ? LOOK(`Couldn't list them: ${ps.error ?? 'no answer'}${whole ? ' You can take the whole project now, and narrow it later.' : p.fallback ? ` ${p.fallback}` : ''}`, 'warning', 'orange')
        : ps.state === 'ready' && !ps.options.length && !whole ? LOOK('None that this sign-in can see', 'warning', 'orange') : null;
    // Each option once, and a choice the list no longer has (an epic that's done) kept, so Save doesn't drop it.
    const options = ps.options.map((o) => ({ value: o.value, label: o.label, detail: o.detail ?? null, usedBy: o.usedBy ?? null }));
    for (const v of ps.selected) if (!options.some((o) => o.value === v)) options.unshift({ value: v, label: v, detail: ps.state === 'ready' && !fixed ? 'chosen before, not listed now' : null, usedBy: null });
    // A choice another repo here uses already says so under the list, with an icon and words (GH-81).
    const used = options.filter((o) => o.usedBy && ps.selected.includes(o.value));
    return {
      key: p.key, label: p.label, multi: !!p.multi, whole, options, selected: ps.selected, look: pickerLook,
      used: used.length ? LOOK(`${used.map((o) => `${o.label}: ${o.usedBy}`).join('; ')}, so two repos would show ${used.every((o) => o.usedBy!.startsWith('overlaps')) ? 'some of ' : ''}the same tickets.`, 'warning', 'orange') : null,
      // One whose list failed needn't hold Save when the tracker does without it (Jira's first board).
      disabled: !fixed && (!ok || ps.state === 'waiting' || ps.state === 'loading'), fixed, required: place || (!p.whole && !p.multi && !(p.fallback && ps.state === 'failed')),
      // Shown once there's a choice to make, or to say why its list couldn't be read.
      hidden: !!p.hideSingle && ps.state !== 'failed' && options.length <= 1, hint: place ? d.place.words : p.hint ?? null,
    };
  });
  const ready = pickers.every((p) => p.fixed || !p.required || p.selected.length) && pickers.every((p) => p.look?.icon !== 'sync~spin');
  const name = d.name;
  const placePicker = d.pickers.find((p) => p.key === d.place.key);
  const placeLabel = (placePicker?.label ?? 'place').toLowerCase();
  // "an epic", "an area path", "labels", "a group": what the project is started from.
  const placeName = placePicker?.multi ? placeLabel : `${/^[aeiou]/.test(placeLabel) ? 'an' : 'a'} ${placeLabel}`;
  // What's still to do before Save, in the order a person does it: sign in, then each choice (T-43).
  // Before it's signed in the lists are empty, so only the first is named: the rest come after.
  const open = pickers.filter((p) => !p.fixed && !p.hidden && p.required && !p.selected.length).map((p) => `${/^[aeiou]/i.test(p.label) ? 'an' : 'a'} ${p.label.toLowerCase()}`);
  const choices = [...new Set([...(s.root ? [] : ['a project']), ...(ok ? open : open.slice(0, 1))])];
  const todo = [...(ok ? [] : ['sign in']), ...(choices.length ? [`choose ${taskNames(choices)}`] : [])];
  const saveWhy = s.saving ? whyOff('Saving now.') : todo.length ? whyOff(`${taskNames(todo).replace(/^./, (c) => c.toUpperCase())} first.`)
    : !ready ? whyOff('Wait for its lists to load first.') : null;
  return {
    id: s.id, rev: s.rev,
    title: s.start ? `Start ${s.projectName} from ${placeName} in ${name}` : s.existing ? `Change ${s.existing.title}` : 'Connect a tracker',
    summary: s.start ? `Starting the project writes ${s.projectName}'s settings, with its tickets from the ${placeLabel} you pick. Until then nothing is written, and picking only reads ${name}: nothing is ever written to it. The sign-in stays in VSCode on this machine.`
      : s.root ? `For ${s.projectName}. acc writes it to the project's settings, and the sign-in stays in VSCode on this machine, never in the settings.` : 'Choose the project to connect a tracker to.',
    back: { section: s.from, label: `Back to ${SECTION_WORD[s.from]}`, part: s.from === 'settings' ? settingsKey('trackers') : null },
    projects: s.existing || s.projects.length < 2 ? [] : s.projects.map((p) => ({ ...p, on: p.root === s.root })),
    kinds: s.existing ? [] : list.map((x) => ({ kind: x.kind, name: x.name, icon: x.icon, on: x.kind === d.kind })),
    kind: d.kind, name, icon: d.icon, host,
    methods: editing && d.methods.length > 1 ? d.methods.map((m) => ({ id: m.id, label: m.label, icon: m.icon, on: m.id === method.id })) : [],
    method: { id: method.id, hint: method.hint, test: method.test },
    fields: editing ? fields : [],
    // Not held back by an empty site: Test sends what's typed there, and says beside it what's wrong.
    signIn: { look, editing, canTest: !!s.root && !testing && !s.saving, why: !s.root ? whyOff('Choose a project first.') : testing ? whyOff('Testing the connection now.') : s.saving ? whyOff('Saving now.') : null },
    share: {
      shown: editing && method.via !== 'gh' && !!s.root, on: s.share, label: `Use this sign-in for every project on ${site}`,
      hint: s.share ? `Every project on this machine that uses ${site} signs in with it, unless it has a sign-in of its own.` : `Kept for ${s.projectName || 'this project'} only. Other projects on ${site} sign in on their own.`,
    },
    pickers,
    listsTitle: d.listsTitle ?? LISTS_TITLE,
    place: s.start ? { key: d.place.key, words: d.place.words } : null,
    save: {
      can: !!s.root && ok && ready && !s.saving, label: s.start ? 'Start the project' : s.existing ? 'Save changes' : `Connect ${name}`,
      why: saveWhy,
      look: s.saving ? LOOK(s.start ? 'Starting the project' : 'Saving', 'sync~spin', 'blue') : s.saveError ? LOOK(s.saveError, 'warning', 'orange') : null,
    },
  };
}

export type ConnectMessage = Extract<Message, { session: string }>;

export const CONNECT = declaredKeys();
export const connectValue = (v: unknown): boolean => v === null || (typeof v === 'string' && v.length <= 500) || (Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === 'string' && x.length <= 500));

export type Message =
  /**
   * The Connect page (GH-51), each for the page that's open (session). A secret travels once, in
   * connect-test, and is never sent back.
   */
  | { type: 'connect-project'; session: string; root: string }
  | { type: 'connect-kind'; session: string; kind: string }
  | { type: 'connect-method'; session: string; method: string }
  | { type: 'connect-set'; session: string; field: string; value: string }
  | { type: 'connect-test'; session: string; host: string; fields: Record<string, string> }
  | { type: 'connect-again'; session: string }
  /** The tick for keeping the sign-in for every project on the site (GH-79). */
  | { type: 'connect-share'; session: string; on: boolean }
  | { type: 'connect-pick'; session: string; key: string; value: string | string[] | null }
  | { type: 'connect-save'; session: string }
  | { type: 'connect-cancel'; session: string };

const session = (x: Record<string, unknown>): boolean => short(x.session, 64);

export const area: ModelArea = {
  messages: {
    'connect-project': (x) => short(x.session, 64) && short(x.root, 4096),
    'connect-kind': (x) => short(x.session, 64) && CONNECT.kinds.has(x.kind as string),
    'connect-method': (x) => short(x.session, 64) && CONNECT.methods.has(x.method as string),
    'connect-set': (x) => short(x.session, 64) && CONNECT.fields.has(x.field as string) && typeof x.value === 'string' && x.value.length <= 4096,
    'connect-test': (x) => {
      if (!short(x.session, 64) || typeof x.host !== 'string' || x.host.length > 4096) return false;
      const f = x.fields as Record<string, unknown> | null;
      return !!f && typeof f === 'object' && !Array.isArray(f) && Object.keys(f).length <= 8 && Object.entries(f).every(([k, v]) => CONNECT.fields.has(k) && typeof v === 'string' && v.length <= 4096);
    },
    'connect-pick': (x) => short(x.session, 64) && CONNECT.pickers.has(x.key as string) && connectValue(x.value),
    'connect-share': (x) => short(x.session, 64) && typeof x.on === 'boolean',
    'connect-again': session,
    'connect-save': session,
    'connect-cancel': session,
  },
};
