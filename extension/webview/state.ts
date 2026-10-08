// The tab's state, with one owner: the VS Code API, what the page last drew, the section it shows, the
// output panel's commands, and its memory across redraws. Every module of the page reads and changes it here.

import type { HomeSection, ViewKind } from '../src/model/shared.ts';
import type { HomeModel, Model } from '../src/model/home.ts';
import type { RunCard } from '../src/model/runs.ts';
import type { EditBase } from './pending.ts';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
export const api = acquireVsCodeApi();
export const app = document.getElementById('app')!;
export const view = document.body.dataset.view as ViewKind | 'ticket' | 'home' | 'agent';

/** A half-made answer to an agent's question, kept while the page redraws. */
export interface Draft { picks: Record<number, string[]>; other: Record<number, string>; denying: boolean; reason: string; sent: boolean; choice?: string; command?: string }

/**
 * Per-tab memory that survives re-renders and the tab being hidden: board modes, comment drafts, answers
 * being written, the output panel, and which of an agent's steps are opened.
 */
interface Memory {
  modes: Record<string, 'tracker' | 'agents'>;
  drafts: Record<string, string>;
  /** What each update's edit was typed against, by its draft's key (GH-46). */
  bases: Record<string, EditBase>;
  section?: HomeSection;
  answers: Record<string, Draft>;
  dock: { open: boolean; run: string | null };
  opened: string[];
  /** Which kind of history the Overview shows. */
  history?: 'all' | 'answer' | 'move' | 'run';
  /** Setup sections opened or closed by hand; the rest open while they have something to do. */
  sections?: Record<string, boolean>;
  /**
   * Where each page was scrolled to, its boards sideways included. A hidden tab's page is rebuilt when it
   * comes back (VSCode doesn't keep it), so this is how it returns to where you were.
   */
  scroll?: Record<string, SavedScroll>;
}
interface SavedScroll { y: number; boards: { x: number; lanes: number[] }[] }
export function memory(): Memory {
  const s = (api.getState() as Partial<Memory> | undefined) ?? {};
  return { modes: s.modes ?? {}, drafts: s.drafts ?? {}, bases: s.bases ?? {}, section: s.section, answers: s.answers ?? {}, dock: s.dock ?? { open: false, run: null }, opened: s.opened ?? [], history: s.history, sections: s.sections ?? {}, scroll: s.scroll ?? {} };
}
export function remember(change: (m: Memory) => void): void {
  const m = memory();
  change(m);
  api.setState(m);
}

/**
 * What the page holds between draws, in one object every module can change: another module's `let` can't
 * be set from outside it.
 */
export const state: {
  /** The model the page last drew. */
  last: Model | null;
  /** The commands acc ran for you, as the output panel shows them. */
  runs: RunCard[];
  /** The section the page shows, once it's been told or you've moved. */
  section: HomeSection | null;
  /** Set when the page moved to another section, so the next draw starts at its top. */
  scrolledTo: boolean;
  /** Draws a model on the page: main.ts sets it, so any part of the page can redraw it. */
  draw: (model: Model) => void;
} = { last: null, runs: [], section: memory().section ?? null, scrolledTo: false, draw: () => {} };

/**
 * What one area draws and handles on the page, declared in its own module as `export const area` (D-099).
 * areas.ts, which npm run build writes, gathers them for main.ts, so a new section, tab or message from the
 * extension edits only its area.
 */
export interface PageArea {
  /** The Command Center's sections it draws. With fill, a lone board fills the height below its heading. */
  sections?: { [S in HomeSection]?: { draw(m: HomeModel): Node[]; fill?: boolean } };
  /** Tabs of their own it draws, by their model's kind. */
  views?: { [K in Exclude<Model['kind'], 'home'>]?: (m: Extract<Model, { kind: K }>) => Node[] };
  /** It draws whatever section or tab no area claims, as Setup always has. */
  fallback?: boolean;
  /** What it draws over the section, as the Connect page does while it's open; null when nothing. */
  cover?(m: HomeModel): Node[] | null;
  /** Before each draw, while the old page is still up, and after it. */
  before?(m: Model): void;
  after?(m: Model): void;
  /** The extension's messages it takes, by type. */
  receive?: Record<string, (msg: never) => void>;
}

export function setSection(s: HomeSection, tell = true): void {
  if (s !== state.section) state.scrolledTo = true;
  state.section = s;
  remember((m) => { m.section = s; });
  if (tell) api.postMessage({ type: 'nav', section: s });
}

/**
 * Moves to a section. With part, it goes to the heading of that name there, such as Settings' How agents
 * run from Agents' Settings button (GH-110); otherwise the section takes focus.
 */
export function go(s: HomeSection, part?: string): void {
  setSection(s);
  // Leaving the Connect page for a section closes it, as Back does.
  if (state.last?.kind === 'home' && state.last.connect) {
    api.postMessage({ type: 'connect-cancel', session: state.last.connect.id });
    state.last = { ...state.last, connect: null };
  }
  if (state.last) state.draw(state.last);
  if (!part || !jumpTo(part)) document.querySelector<HTMLElement>('.home-main')?.focus({ preventScroll: true });
}

/**
 * Scrolls to the heading a part names with data-part, and focuses it, so a screen reader starts there too.
 * False when the page has no such heading.
 */
export function jumpTo(part: string): boolean {
  const heading = document.querySelector<HTMLElement>(`[data-part="${CSS.escape(part)}"]`);
  if (!heading) return false;
  heading.scrollIntoView({ block: 'start' });
  heading.focus({ preventScroll: true });
  return true;
}
