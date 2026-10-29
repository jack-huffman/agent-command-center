/**
 * Connecting a tracker: the Connect page, drawn from a tracker's description.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { type ConfigPath, keyShown, TRACKER_NAME_MAX, UNREAD_KEYS } from '../../../packages/core/src/config.ts';
import { declaredKeys, DESCRIPTIONS, type Option, type TrackerDescription, type Values } from '../../../packages/core/src/trackers/connect.ts';
import { CARD_TITLES, countValues, placeKey, PREVIEW_CARDS, previewLine } from '../../../packages/core/src/trackers/preview.ts';
import { type Board, orList } from '../../../packages/core/src/trackers/types.ts';
import { signInScope } from '../logic/connect.ts';
import type { ChangesFieldRow } from './changes-field.ts';
import { inProcessWords } from '../logic/processes.ts';
import { trackerBoard, type TrackerBoard } from './boards.ts';
import { settingsKey } from './settings.ts';
import { type HomeSection, type Look, LOOK, type ModelArea, short, VIEW_TITLES } from './shared.ts';
import { taskNames } from '../logic/shared.ts';
import { isObj } from '../../../packages/core/src/text.ts';

// ---------------------------------------------------------------- connecting a tracker (GH-51)

/** A choice in a list, and which other repo on this machine uses it already, in words (GH-81). */
export type ConnectOption = Option & { usedBy?: string };

/** A place's board as the Connect page read it (T-106): reading, read, or why it couldn't be. */
export interface PlaceRead {
  state: 'loading' | 'ready' | 'failed';
  board: Board | null;
  /** Words for a place that has no board, such as a Slack channel with no reaction. */
  none: string | null;
  error: string | null;
}

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
  /**
   * The tracker being changed, by its place in the list, or null for a new one. given: the name its tracker gives
   * its board (T-127), which an empty name keeps.
   */
  existing: { index: number; title: string; given?: string } | null;
  /** Add a board (T-127): Save adds another board, never in place of one for the same project. */
  add: boolean;
  /** The board's name as typed (T-127): its own name, or empty for the one its tracker gives. */
  name: string;
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
  /**
   * Each place's board read so far (T-106), by placeKey: the preview's, and each card's count, which is the
   * board with that choice made. Kept while the page is open, so going back to a choice is instant.
   */
  boards: Record<string, PlaceRead>;
  saving: boolean;
  saveError: string | null;
  /** The modal's step on show (T-140): the tracker, its site and sign-in, the board, then Save. */
  step: ConnectStep;
  /** The list last changed (T-140): a board that can't be read for it says why beside that dropdown. */
  lastPicked: string | null;
  /** An existing board's values when the modal opened (T-140), so Save can say what changes. Null for a new one. */
  was: Values | null;
}

/** The modal's steps, in order (T-140): which tracker, its site and sign-in, what to follow with its board below, then Save. */
export const CONNECT_STEPS = ['tracker', 'site', 'board', 'save'] as const;
export type ConnectStep = (typeof CONNECT_STEPS)[number];

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

/**
 * How many tickets a card's choice would put on the board (T-106). waiting: not asked yet, so the page asks as
 * it draws the card; loading: a skeleton; failed: says so on its card, and the card can still be chosen.
 * titles: the first few tickets' titles, for an epic or a label.
 */
export interface CardCount {
  state: 'waiting' | 'loading' | 'ready' | 'failed';
  label: string;
  titles: string[];
}

export interface ConnectPicker {
  key: string;
  label: string;
  multi: boolean;
  /** The whole project, listed first; chosen when nothing is. */
  whole: string | null;
  /** The whole project's count, when the list counts (T-106). */
  wholeCount: CardCount | null;
  /**
   * usedBy: "used by acme-portal", when another repo on this machine uses it already (GH-81). count: how many
   * tickets it would hold, for a list that counts (T-106), else null.
   */
  options: { value: string; label: string; detail: string | null; usedBy: string | null; count: CardCount | null }[];
  /** Its cards get a search box (T-106): there are more than SEARCH_FROM. */
  search: boolean;
  selected: string[];
  /** Loading, or why the list couldn't be read, beside it. Null when there's nothing to say. */
  look: Look | null;
  /** The board couldn't be read with the choice made last here (T-140): why, beside this dropdown. */
  error: Look | null;
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
  /** The board the choices would make (T-106), drawn before it's kept. */
  preview: ConnectPreview;
  /** How many cards' counts the page asks for at once (T-106): COUNT_MOST, which the extension holds it to. */
  countMost: number;
  /** why: the reason the button is off, in words, beside it; null when it's on (T-43). */
  save: { can: boolean; label: string; look: Look | null; why: Look | null };
  /** Where a ticket's changes are kept (T-105), once the place is chosen; left out before. */
  changesField?: ChangesFieldRow | null;
  /** The board's name (T-127): as typed, the tracker's own name for it when it's left empty, and what it's for. */
  boardName: { field: string; max: number; value: string; placeholder: string; hint: string };
  /** Remove an existing board (T-127): the command and its tracker, which asks first. Null for a new one. */
  remove: { command: 'acc.trackers.remove'; arg: string; label: string } | null;
  /** The step on show (T-140), and each step: its title, where it stands, and whether it can be gone to now. */
  step: ConnectStep;
  steps: { id: ConnectStep; title: string; state: 'current' | 'done' | 'todo'; can: boolean }[];
  /** Next (T-140), with why it's off in words beside it; null on Save, the last step. */
  next: { can: boolean; why: Look | null } | null;
  /** What Save keeps (T-140): the site and each choice in words, marked where it changes; and, for an existing board, its tickets before and after. */
  kept: { label: string; value: string; changed: boolean }[];
  change: { before: string; after: string } | null;
}

/**
 * The board the choices so far would make (T-106), as the Tasks tab draws it: its columns, each with its first
 * cards and how many it holds. waiting: the choices make no place yet. `look` is its line: "47 tickets would
 * be on your board, in 5 columns.", reading, or why it couldn't be read. `empty` says what to change when it
 * holds none; `none` is a place with no board (a Slack channel with no reaction).
 */
export interface ConnectPreview {
  state: 'waiting' | 'loading' | 'ready' | 'failed';
  look: Look;
  board: TrackerBoard | null;
  /** How many cards each of the board's columns holds, in its order: a column shows PREVIEW_CARDS of them. */
  totals: number[];
  empty: string | null;
  none: string | null;
  /** Read it again: shown when it failed. */
  retry: boolean;
}

/** The usual heading of the Connect page's third step (T-43, T-106). */
export const LISTS_TITLE = 'Choose a board';

/** What saves the place (T-106): only from its preview, so a person sees the board before it's kept. */
export const USE_BOARD = 'Use this board';

/** A list with more choices than this gets a search box over its cards (T-106). */
export const SEARCH_FROM = 8;

/**
 * A card's count of tickets, from the board read with its choice made (T-106). `titles`: its first tickets'
 * titles too, for a card of the place (an epic, labels, an area path, a group), where they say what it holds.
 */
export function cardCount(read: PlaceRead | undefined, titles = false): CardCount {
  if (!read) return { state: 'waiting', label: 'Counting', titles: [] };
  if (read.state === 'loading') return { state: 'loading', label: 'Counting', titles: [] };
  if (read.state === 'failed') return { state: 'failed', label: `Couldn't count its tickets: ${read.error ?? 'no answer'}`, titles: [] };
  if (!read.board) return { state: 'ready', label: read.none ?? 'No board', titles: [] };
  const n = read.board.cards.length;
  return { state: 'ready', label: `${n} ticket${n === 1 ? '' : 's'}`, titles: titles ? read.board.cards.slice(0, CARD_TITLES).map((c) => c.title) : [] };
}

/**
 * The preview's model (T-106): the board read for the values chosen, its columns cut to their first cards.
 * `place` says whether the choices make one yet: until then it waits, and `waiting` says what's left to do.
 * `change` is what to change when the place holds no tickets.
 */
export function connectPreview(s: ConnectState, values: Values, place: boolean, waiting: string, change: string): ConnectPreview {
  const quiet = { board: null, totals: [], empty: null, none: null, retry: false };
  if (!place) return { state: 'waiting', look: LOOK(waiting, 'eye', 'neutral'), ...quiet };
  const read = s.boards[placeKey(values)];
  if (!read || read.state === 'loading') return { state: 'loading', look: LOOK('Reading the board', 'sync~spin', 'blue'), ...quiet };
  if (read.state === 'failed') return { state: 'failed', look: LOOK(`Couldn't read the board: ${read.error ?? 'no answer'}`, 'warning', 'orange'), ...quiet, retry: true };
  if (!read.board) return { state: 'ready', look: LOOK(read.none ?? 'No board', 'info', 'neutral'), ...quiet, none: read.none };
  const b = read.board;
  const full = trackerBoard({ index: -1, kind: s.kind as TrackerBoard['kind'], title: b.title, board: b, error: null, connect: null, loading: false, place: b.place }, [], s.root ?? '');
  // Nothing to add to your work or move here: the preview only shows the board.
  const board: TrackerBoard = { ...full, moves: false, columns: full.columns.map((c) => ({ ...c, cards: c.cards.slice(0, PREVIEW_CARDS).map((x) => ({ ...x, track: null, acc: null })) })) };
  const tickets = full.columns.reduce((n, c) => n + c.cards.length, 0);
  return {
    state: 'ready', look: LOOK(previewLine(tickets, full.columns.length), 'project', 'blue'), board, totals: full.columns.map((c) => c.cards.length),
    empty: tickets ? null : `No tickets would be on your board. ${change}`, none: null, retry: false,
  };
}

/** Why a button is off, as a word and an icon beside it: "Sign in and choose a project first." (T-43) */
const whyOff = (words: string): Look => LOOK(words, 'lock', 'neutral');

/** A fresh page for one kind of tracker, or for an existing one with its choices filled in. */
export function blankConnect(d: TrackerDescription, i: {
  id: string; root: string | null; projects?: ConnectState['projects']; projectName: string; ownRepo: string | null; ghAccount: string | null; from: HomeSection;
  gitEmail?: string | null; existing?: { index: number; title: string; host: string; values: Values; name?: string | null; given?: string } | null; start?: boolean; add?: boolean;
}): ConnectState {
  const method = d.methods[0]!;
  const fields = Object.fromEntries(d.methods.flatMap((m) => m.fields).filter((f) => f.type !== 'secret').map((f) => [f.key, f.prefill === 'git-email' ? i.gitEmail ?? '' : '']));
  const was = i.existing?.values ?? {};
  const pickers = Object.fromEntries(d.pickers.map((p) => {
    const v = was[p.key];
    return [p.key, { options: [], selected: Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [], state: 'waiting', error: null } satisfies ConnectPickerState];
  }));
  const s: ConnectState = {
    id: i.id, rev: 0, root: i.root, projects: i.projects ?? [], projectName: i.projectName, ownRepo: i.ownRepo, ghAccount: i.ghAccount, kind: d.kind,
    existing: i.existing ? { index: i.existing.index, title: i.existing.title, ...(i.existing.given ? { given: i.existing.given } : {}) } : null, start: !!i.start && !i.existing, from: i.from,
    add: !!i.add && !i.existing && !i.start, name: i.existing?.name ?? '',
    host: i.existing?.host ?? (d.host.prefill === 'github-repo' ? i.ownRepo ?? '' : ''), hostError: null,
    method: method.id, fields, fieldErrors: {}, signIn: { state: 'none', who: null, error: null, again: false }, share: true, shareTouched: false, pickers, boards: {}, saving: false, saveError: null,
    // An existing board opens on its board (T-140): its tracker and site are kept, and shown a step back.
    step: i.existing ? 'board' : 'tracker', lastPicked: null, was: null,
  };
  if (i.existing) s.was = connectValues(s, d);
  return s;
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
    // Set aside while another list has a choice (T-128): a queue board takes no epic, board or sprint.
    const off = !!p.unless && !!s.pickers[p.unless]?.selected.length;
    // Starting a project from its place, the place is required: the whole project is Other project's (GH-81).
    const place = s.start && p.key === d.place.key;
    const whole = p.whole && !place ? p.whole({ host: s.host, values, labels }) : null;
    const pickerLook = fixed ? null : ps.state === 'loading' ? LOOK('Loading', 'sync~spin', 'blue')
      : ps.state === 'failed' ? LOOK(`Couldn't list them: ${ps.error ?? 'no answer'}${whole ? ' You can take the whole project now, and narrow it later.' : p.fallback ? ` ${p.fallback}` : ''}`, 'warning', 'orange')
        : ps.state === 'ready' && !ps.options.length && !whole && !p.hideEmpty ? LOOK('None that this sign-in can see', 'warning', 'orange') : null;
    // A card's count is the board with its choice made (T-106): read once the page asks, as it draws the card.
    const counts = !!p.counts && !fixed && ok;
    const count = (v: string) => (counts ? cardCount(s.boards[placeKey(countValues(d.pickers, values, p.key, v))], p.key === d.place.key && !!v) : null);
    // Each option once, and a choice the list no longer has (an epic that's done) kept, so Save doesn't drop it.
    // A detail in a tracker's own words, such as how to give gh access to Projects (T-107), is said as processes (D-132).
    const options = ps.options.map((o) => ({ value: o.value, label: o.label, detail: o.detail ? inProcessWords(o.detail) : null, usedBy: o.usedBy ?? null, count: count(o.value) }));
    for (const v of ps.selected) if (!options.some((o) => o.value === v)) options.unshift({ value: v, label: v, detail: ps.state === 'ready' && !fixed ? 'chosen before, not listed now' : null, usedBy: null, count: count(v) });
    // A choice another repo here uses already says so under the list, with an icon and words (GH-81).
    const used = options.filter((o) => o.usedBy && ps.selected.includes(o.value));
    return {
      key: p.key, label: p.label, multi: !!p.multi, whole, wholeCount: whole ? count('') : null, options, search: options.length > SEARCH_FROM, selected: ps.selected, look: pickerLook, error: null,
      used: used.length ? LOOK(`${used.map((o) => `${o.label}: ${o.usedBy}`).join('; ')}, so two repos would show ${used.every((o) => o.usedBy!.startsWith('overlaps')) ? 'some of ' : ''}the same tickets.`, 'warning', 'orange') : null,
      // One whose list failed needn't hold Save when the tracker does without it (Jira's first board).
      disabled: !fixed && (!ok || ps.state === 'waiting' || ps.state === 'loading'), fixed, required: !off && (place || (!p.whole && !p.multi && !(p.fallback && ps.state === 'failed'))),
      // Shown once there's a choice to make, or to say why its list couldn't be read.
      // A list that's only drawn with something in it (T-128) waits unseen while it loads, and is drawn when it fails, to say why.
      hidden: off || (!!p.hideSingle && ps.state !== 'failed' && options.length <= 1) || (!!p.hideEmpty && ps.state !== 'failed' && !options.length), hint: place ? d.place.words : p.hint ?? null,
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
  // A required list that is hidden has no choice and nothing loads for it: name it, don't say to wait (T-45).
  const loadingNow = pickers.some((p) => p.look?.icon === 'sync~spin');
  const noChoice = pickers.filter((p) => !p.fixed && p.required && !p.selected.length).map((p) => `${/^[aeiou]/i.test(p.label) ? 'an' : 'a'} ${p.label.toLowerCase()}`);
  // The board those choices make (T-106): drawn once they make a place, and what to change when it's empty.
  const chosen = pickers.filter((p) => !p.fixed && !p.hidden && p.selected.length).map((p) => p.label.toLowerCase());
  // The choice to widen when the board is empty (T-140): the last list chosen that has a wider choice, named.
  const narrow = [...pickers].reverse().find((p) => p.whole && !p.fixed && !p.hidden && p.selected.length);
  const lower = (t: string) => t.replace(/^./, (c) => c.toLowerCase());
  const change = narrow ? `Widen the ${narrow.label.toLowerCase()}: choose ${lower(narrow.whole!)}${narrow.multi ? ', or tick more' : ''}.`
    : chosen.length ? `Choose another ${orList(chosen)}.` : `${name} has none here yet.`;
  const placeMade = !!s.root && ok && ready && !todo.length;
  const todoWords = taskNames(todo).replace(/^./, (c) => c.toUpperCase());
  const preview = connectPreview(s, values, placeMade, todo.length ? `${todoWords}, and the board shows here.` : 'The board shows here once its lists load.', change);
  const seen = preview.state === 'ready';
  const saveWhy = s.saving ? whyOff('Saving now.') : todo.length ? whyOff(`${todoWords} first.`)
    : !ready ? whyOff(loadingNow ? 'Wait for its lists to load first.' : `Choose ${taskNames(noChoice)} first.`)
      : preview.state === 'failed' ? whyOff('The board couldn\'t be read: change a choice, or read it again.')
        : !seen ? whyOff('Wait for the board to show first.') : null;
  // A board that couldn't be read says why beside the list chosen last (T-140), or the last one chosen.
  if (preview.state === 'failed') {
    const from = pickers.find((p) => p.key === s.lastPicked && !p.hidden) ?? [...pickers].reverse().find((p) => !p.fixed && !p.hidden && p.selected.length);
    const read = s.boards[placeKey(values)];
    if (from) from.error = LOOK(`Couldn't read the board with this choice: ${read?.error ?? 'no answer'}`, 'warning', 'orange');
  }
  const steps = connectSteps(s, { site: !!s.root, board: !!s.root && ok, save: placeMade && seen && !s.saving }, d.listsTitle ?? LISTS_TITLE);
  const at = steps.find((x) => x.state === 'current')!.id;
  const after = steps[CONNECT_STEPS.indexOf(at) + 1];
  const nextWhy = !after || after.can ? null : after.id === 'site' ? whyOff('Choose a project first.') : after.id === 'board' ? whyOff(testing ? 'Signing in now.' : 'Sign in first.') : saveWhy;
  // What Save keeps, in words (T-140): the site, then each list's choice, marked where it changes.
  const text = (p: ConnectPicker) => (p.selected.length ? p.selected.map((v) => p.options.find((o) => o.value === v)?.label ?? v).join(', ') : p.whole ?? 'None');
  const before = s.was ? Object.fromEntries(d.pickers.map((p) => { const v = s.was![p.key]; return [p.key, (Array.isArray(v) ? v : v ? [v] : []).join('\n')]; })) : null;
  const kept = [{ label: d.host.label, value: s.host, changed: false },
    ...pickers.filter((p) => !p.hidden).map((p) => ({ label: p.label, value: text(p), changed: !!before && before[p.key] !== p.selected.join('\n') }))];
  return {
    id: s.id, rev: s.rev,
    title: s.start ? `Start ${s.projectName} from ${placeName} in ${name}` : s.existing ? `Change ${s.name || s.existing.given || s.existing.title}` : s.add ? `Add a board to ${s.projectName}` : 'Connect a tracker',
    summary: s.start ? `Starting the project writes ${s.projectName}'s settings, with its tickets from the ${placeLabel} you pick. Until then nothing is written, and picking only reads ${name}: nothing is ever written to it. The sign-in stays in VSCode on this machine.`
      : s.root ? `For ${s.projectName}. The Command Center writes it to the project's settings, and the sign-in stays in VSCode on this machine, never in the settings.` : 'Choose the project to connect a tracker to.',
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
    preview,
    countMost: COUNT_MOST,
    boardName: {
      field: BOARD_NAME_FIELD, max: TRACKER_NAME_MAX, value: s.name, placeholder: s.existing?.given ?? 'The name its tracker gives it',
      hint: 'Shown on the Tasks tab\'s switch between boards, and in Settings. Leave it empty for the name its tracker gives it.',
    },
    remove: s.existing && s.root ? { command: 'acc.trackers.remove', arg: JSON.stringify({ root: s.root, index: s.existing.index }), label: 'Remove this board…' } : null,
    save: {
      // Only from the preview (T-106): the place is kept once its board has been drawn.
      can: placeMade && seen && !s.saving, label: s.start ? 'Start the project' : USE_BOARD,
      why: saveWhy,
      look: s.saving ? LOOK(s.start ? 'Starting the project' : 'Saving', 'sync~spin', 'blue') : s.saveError ? LOOK(s.saveError, 'warning', 'orange') : null,
    },
    step: at, steps, next: after ? { can: after.can, why: nextWhy } : null, kept,
    // Before and after (T-140): the board as it was opened, and as these choices make it, each counted.
    change: s.was ? { before: cardCount(s.boards[placeKey(s.was)]).label, after: cardCount(seen ? s.boards[placeKey(values)] : undefined).label } : null,
  };
}

/** Each step's title in the modal (T-140); the board's is its tracker's (Choose a board, or Slack's Its channel). */
const STEP_TITLE: Record<Exclude<ConnectStep, 'board'>, string> = { tracker: 'Tracker', site: 'Sign in', save: 'Save' };

/**
 * The modal's steps (T-140): each can be gone to once every step before it is done. The step on show is the
 * one kept, moved back to the last it can be: to Sign in when its sign-in needs the person again, or to the
 * board while what Save needs isn't there. While it signs in, or saves, it stays where it is.
 */
export function connectSteps(s: ConnectState, reach: Record<Exclude<ConnectStep, 'tracker'>, boolean>, boardTitle: string): ConnectModel['steps'] {
  const can = (id: ConnectStep): boolean => CONNECT_STEPS.slice(1, CONNECT_STEPS.indexOf(id) + 1).every((k) => reach[k as Exclude<ConnectStep, 'tracker'>]);
  const signing = s.signIn.state === 'testing' || (s.signIn.state === 'none' && !s.signIn.again && !!s.existing);
  let at = CONNECT_STEPS.indexOf(s.step);
  if (at >= 1 && !s.root) at = 0;
  else if (at >= 2 && (s.signIn.state === 'failed' || s.signIn.again || (!reach.board && !signing))) at = 1;
  else if (at === 3 && !reach.save && !s.saving) at = 2;
  return CONNECT_STEPS.map((id, i) => ({
    id, title: id === 'board' ? boardTitle : STEP_TITLE[id], state: i < at ? 'done' : i === at ? 'current' : 'todo', can: i === 0 || can(id) || (i <= at && signing),
  }));
}

export type ConnectMessage = Extract<Message, { session: string }>;

export const CONNECT = declaredKeys();
/** The board's name on the Connect page (T-127), sent as connect-set's field. No tracker's sign-in has a field by this key. */
export const BOARD_NAME_FIELD = 'boardName';
/** How many cards' counts the page asks for at once (T-106): the first ones a list or its search shows. */
export const COUNT_MOST = 24;
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
  /** The cards drawn whose counts aren't read yet (T-106): '' is the whole project's. */
  | { type: 'connect-count'; session: string; key: string; values: string[] }
  /** Read the preview's board again, after it failed (T-106). */
  | { type: 'connect-preview'; session: string }
  /** Back, Next or a step's dot (T-140): the extension goes there only when it can be gone to. */
  | { type: 'connect-step'; session: string; step: ConnectStep }
  | { type: 'connect-save'; session: string }
  | { type: 'connect-cancel'; session: string };

const session = (x: Record<string, unknown>): boolean => short(x.session, 64);

export const area: ModelArea = {
  messages: {
    'connect-project': (x) => session(x) && short(x.root, 4096),
    'connect-kind': (x) => session(x) && CONNECT.kinds.has(x.kind as string),
    'connect-method': (x) => session(x) && CONNECT.methods.has(x.method as string),
    'connect-set': (x) => session(x) && (CONNECT.fields.has(x.field as string) || x.field === BOARD_NAME_FIELD) && typeof x.value === 'string' && x.value.length <= 4096,
    'connect-test': (x) => {
      if (!session(x) || typeof x.host !== 'string' || x.host.length > 4096) return false;
      const f = x.fields as Record<string, unknown> | null;
      return isObj(f) && Object.keys(f).length <= 8 && Object.entries(f).every(([k, v]) => CONNECT.fields.has(k) && typeof v === 'string' && v.length <= 4096);
    },
    'connect-pick': (x) => session(x) && CONNECT.pickers.has(x.key as string) && connectValue(x.value),
    'connect-share': (x) => session(x) && typeof x.on === 'boolean',
    'connect-count': (x) => session(x) && CONNECT.pickers.has(x.key as string) && Array.isArray(x.values) && x.values.length <= COUNT_MOST && x.values.every((v) => typeof v === 'string' && v.length <= 500),
    'connect-preview': session,
    'connect-again': session,
    'connect-step': (x) => session(x) && (CONNECT_STEPS as readonly unknown[]).includes(x.step),
    'connect-save': session,
    'connect-cancel': session,
  },
};
