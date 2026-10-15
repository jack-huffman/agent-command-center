/**
 * The modals' behaviour in a browser (GH-170). The task modal over the Tasks board (D-129) and the
 * Overview's detail modal (D-131) were checked by hand: Escape and the backdrop closing them, focus going
 * back to what opened them, a redraw under them leaving them as they were, a fold redrawing them, Show all
 * and the suggested rules' Previous and Next. One case reads a task page as drawn: ACME-21's wording list
 * (T-12, T-13), a line for each finding; another, ACME-19's review (T-53), its findings in order and the
 * message a click on a file and line sends. One reads Settings as drawn (T-40): a guide link for each part, and
 * a closed What this means for each long explanation, which stays open once opened. Each case here opens the built page from its fixture in
 * headless Chrome, posts what the extension would post and dispatches what a person's keys and clicks
 * would, then checks the DOM, and writes what it found into a JSON script element Chrome's --dump-dom
 * prints. judgeBehaviour() decides, with no browser, so its rules are unit-tested.
 *
 *   npm run screenshot                          the shots, then every case and every mutant
 *   npm run screenshot -- --behaviour           just the cases and the mutants
 *
 * A case proves it ran: one that reports no checks, or none at all, fails, and an element it looks for
 * that isn't there fails it, never skips it. And each catches a stub: a mutant is the page built with one
 * change to its source that breaks a behaviour, such as an Escape handler that does nothing, and the run
 * fails unless each mutant fails every case it names. A mutant whose change no longer matches its source
 * exactly once fails too, so none goes quiet when the code moves.
 *
 * Escape is the cancel event the browser fires on a modal dialog for it, then the browser's own close when
 * nothing prevented it, as Chrome does; a backdrop click is a mousedown and a click on the dialog outside
 * its box, which is where the browser sends them. A page's script can't make a trusted key press.
 *
 * Each case and helper below runs in the page, not in Node: the page gets its source (Function's
 * toString, after Node strips the types), so it may use only its argument, the DOM, and the helpers in
 * HELPERS, by the same names.
 */

import type { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JIRA } from '../../packages/core/src/trackers/connect.ts';
import { blankConnect, connectModel, type ConnectModel } from '../src/model/connect.ts';
import type { HomeModel, Model } from '../src/model/home.ts';
import { loadingScreen } from '../src/logic/loading.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { foldsMeaning, meaningKey, settingsGuide, settingsMeanings } from '../src/model/settings.ts';
import { NOTHING_FINISHED, paletteItems } from '../src/model/palette.ts';
import { paletteResults } from '../webview/fuzzy.ts';
import { sampleTicket } from './fixtures/task-page.ts';
import { ROOT } from './fixtures/shared.ts';
import { palettes, vscodeDefaults } from './styles.ts';

/** What the page hands each case: ways to find, act and check, and what Node worked out it should see. */
export interface Probe {
  /** The element, or the case fails saying what wasn't there. */
  find<E extends Element = HTMLElement>(selector: string, within?: ParentNode): E;
  /** Every match, none being an answer too. */
  all<E extends Element = HTMLElement>(selector: string, within?: ParentNode): E[];
  /** One assertion. */
  check(what: string, ok: boolean, detail?: unknown): void;
  /** Posts a message to the page, as the extension does, and lets it draw. */
  post(message: unknown): Promise<void>;
  /** Lets the page finish what it started: its messages, timers and frames. */
  settle(): Promise<void>;
  /** A click, as a person's: focus first where the element takes it, then mousedown and click on it. */
  click(e: HTMLElement): Promise<void>;
  /** Escape on the open modal, as the browser handles it. */
  escape(d: HTMLDialogElement): Promise<void>;
  /** A click on the backdrop outside the modal's box; with downInside, pressed inside it and released there, as a drag out of a text box. */
  backdrop(d: HTMLDialogElement, downInside?: boolean): Promise<void>;
  /** Types into a text box, as a person would. */
  type(box: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void>;
  /** The messages the page sent the extension, of a type. */
  sent(type: string): Record<string, unknown>[];
  /** The tab's memory, as the page last set it. */
  memory(): Record<string, unknown>;
  /** The page's model, as the extension sent it, for posting again. */
  model: Model;
  /** What Node expects, from the same fixtures: the oracle. */
  data: BehaviourData;
}

/** What the cases expect, worked out in Node from the fixtures the page is drawn from. */
export interface BehaviourData {
  /** The task the board's card opens, as the extension would send it in the modal. */
  task: { project: string; key: string; peek: string; message: Record<string, unknown> };
  /** The suggested rules, in the Overview's order, and the message each one's Accept and Confirm sends. */
  rules: { id: string; line: string; sources: number; accept: Record<string, unknown> }[];
  /** The opener Review on the suggested rules' line carries. */
  rulesOpens: string;
  /** The opener the first question in Needs you carries, on its line and its Answer. */
  questionOpens: string;
  /** A list with more than its page shows: its key, its heading, how many it shows and how many it holds. */
  list: { key: string; title: string; shown: number; total: number };
  /** The wording findings ACME-21's page lists (T-12), in its order: where each is, why, and its line. */
  wording: { place: string; message: string; text: string }[];
  /**
   * ACME-19's review (T-53), from its model: each finding's state and message, in the page's order, and what
   * a click on the first file and line that opens sends.
   */
  review: { findings: { label: string; message: string }[]; click: Record<string, unknown> };
  /**
   * The Overview's cards (T-36), in its order: each one's list, its name as read out, and what it opens:
   * the list's title and every line, or History.
   */
  cards: { key: string; name: string; opens: string; title: string; lines: number; history: boolean }[];
  /** How many facts In progress's machine line holds, at the top of its detail. */
  machine: number;
  /** The project the header's Start an agent and Add a tracker act on. */
  project: string;
  /**
   * Settings (T-40): the heading each guide link opens, in order; each explanation that folds, by its id and
   * the key the tab remembers it by; and how many stay in view.
   */
  settings: { parts: string[]; folds: { id: string; key: string }[]; kept: number };
  /**
 * The Connect page before it's signed in (T-45): Save's label, and the reason its model gives for it being off.
 * `none` is the same page with no project chosen, where Test connection is off too: its model, and the reason it gives.
 */
  connect: { save: string; why: string; none: { model: ConnectModel; testWhy: string } };
  /**
   * The command palette (T-52), on the Tasks board: the sections an empty query shows, in order; the task
   * "16" finds first, with the message that opens it in the modal; the query whose second result Down and
   * Enter run, that result's title and the message it sends; and the board's model with Stop finished off,
   * its title and its reason.
   */
  palette: {
    sections: string[];
    task: { id: string; key: string; project: string; message: Record<string, unknown> };
    second: { query: string; title: string; sent: Record<string, unknown> };
    disabled: { model: Model; title: string; reason: string };
  };
  /**
   * The Tasks board from the keyboard (T-54), on the Jira board the page opens on: its first card, the card
   * under it, its column's last card, and the card at the same place in the next column. Then the move
   * Space, Right and Enter make of the first card: the column it lands in, the columns it may land in, the
   * message a drop there sends, and what the live line says at each step; and the page's model with the card
   * in that column, as the extension sends it once the move is made. Last, on the agent board, a card no
   * column takes, the model that holds it, and what the live line says on its Space.
   */
  keys: {
    first: string; down: string; last: string; right: string;
    move: { card: string; to: string; lanes: string[]; sent: Record<string, unknown>; moving: string; moved: string; stays: string };
    moved: Model;
    stuck: { card: string; model: Model; says: string };
  };
}

/** One case: its name, the page it opens, and what it does there. */
export interface Case {
  name: string;
  page: 'tasks' | 'overview-landing' | 'ticket-questions' | 'ticket-review' | 'settings-agents' | 'connect-start' | 'agent';
  /** A tab rebuilt before its first model: its page holds the loading screen, and the tab remembers being scrolled this far down. */
  opening?: { scroll: number };
  run: (t: Probe) => Promise<void>;
}

/** The pages the cases open: the Tasks board, the Overview, ACME-21's and ACME-19's task pages, Settings with two projects, the Connect page, and an agent's page. */
export interface CaseModels { tasks: Model; overview: Model; ticket: Model; review: Model; settings: Model; connect: Model; agent: Model }

/** The model a case's page is drawn from. */
export const caseModel = (c: Case, models: CaseModels): Model => (c.page === 'tasks' ? models.tasks : c.page === 'ticket-questions' ? models.ticket : c.page === 'ticket-review' ? models.review : c.page === 'settings-agents' ? models.settings : c.page === 'connect-start' ? models.connect : c.page === 'agent' ? models.agent : models.overview);

// ---------------------------------------------------------------- helpers, run in the page

/** Opens ACME-12 from its card on the board, as a click and the extension's reply do. Returns the card. */
async function openTask(t: Probe): Promise<{ dialog: HTMLDialogElement; body: HTMLElement; card: HTMLElement }> {
  const card = t.find(`[data-peek="${CSS.escape(t.data.task.peek)}"]`);
  await t.click(card);
  const asked = t.sent('task-modal-open').at(-1);
  t.check('a card\'s click asks the extension for its task in the modal', asked?.project === t.data.task.project && asked?.key === t.data.task.key, asked);
  await t.post(t.data.task.message);
  const dialog = t.find<HTMLDialogElement>('dialog.task-modal:not(.detail-modal):not(.palette-modal)');
  t.check('the modal opens', dialog.open);
  t.check('focus moves into it', dialog.contains(document.activeElement), document.activeElement?.className);
  return { dialog, body: t.find('.task-modal-body', dialog), card };
}

/**
 * Opens the suggested rules over the Overview: the When you have a moment card, then Review on their line in
 * the list it opens (T-36). Returns the card, which focus goes back to when they close.
 */
async function openRules(t: Probe): Promise<{ dialog: HTMLDialogElement; body: HTMLElement; opener: HTMLElement }> {
  const opener = t.find('[data-overview-card="moment"]');
  await t.click(opener);
  await t.click(t.find(`button[data-opens="${CSS.escape(t.data.rulesOpens)}"]`, t.find('dialog.detail-modal')));
  const dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
  t.check('the suggested rules open over the Overview', dialog.open);
  t.check('its title counts them', t.find('.detail-title', dialog).textContent === `Suggested rules: ${t.data.rules.length}`, t.find('.detail-title', dialog).textContent);
  return { dialog, body: t.find('.task-modal-body', dialog), opener };
}

/** Which rule the detail shows: its place, "2 of 10", and its line. */
function shownRule(t: Probe, dialog: HTMLDialogElement): { place: string; line: string } {
  return { place: t.find('.detail-place', dialog).textContent ?? '', line: t.find('.rule-line', dialog).textContent ?? '' };
}

/** Clicks the pager's Previous or Next. */
async function page(t: Probe, dialog: HTMLDialogElement, which: 'Previous' | 'Next'): Promise<void> {
  const b = t.all<HTMLButtonElement>('.detail-pager button', dialog).find((x) => x.textContent?.trim() === which);
  if (!b) throw new Error(`not found: the pager's ${which}`);
  await t.click(b);
}

/** A key pressed on an element, as the page hears it; returns its event, to see whether the page took it. */
async function press(t: Probe, target: HTMLElement, key: string, shift = false): Promise<KeyboardEvent> {
  const ev = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  await t.settle();
  return ev;
}

/** Opens the command palette from the rail's button (T-52). Returns the button, the palette and its box. */
async function openPalette(t: Probe): Promise<{ button: HTMLElement; dialog: HTMLDialogElement; box: HTMLInputElement }> {
  const button = t.find('.rail .palette-btn');
  await t.click(button);
  const dialog = t.find<HTMLDialogElement>('dialog.palette-modal');
  t.check('the palette opens', dialog.open);
  const box = t.find<HTMLInputElement>('.palette-box', dialog);
  t.check('focus is in its box', document.activeElement === box, document.activeElement?.className);
  return { button, dialog, box };
}

/** A card on a keyed board by its id (T-54), and what takes its focus: the card, or its title on the agent board. */
function boardCard(t: Probe, id: string): { card: HTMLElement; focus: HTMLElement; board: HTMLElement; live: HTMLElement } {
  const card = t.find(`.board[data-keys] article.card[data-card-id="${CSS.escape(id)}"]`);
  const board = card.closest<HTMLElement>('.board')!;
  const live = board.previousElementSibling as HTMLElement | null;
  if (!live?.matches('.board-live[aria-live]')) throw new Error('not found: the live line above the board');
  return { card, focus: card.matches('[data-peek]') ? card : t.find('[data-peek]', card), board, live };
}

export const HELPERS = [openTask, openRules, shownRule, page, press, openPalette, boardCard];

// ---------------------------------------------------------------- the cases

export const CASES: Case[] = [
  {
    name: 'loading screen: a tab rebuilt with a saved scroll returns to it on its first model',
    // A task's page, which is long enough to scroll at this size; the calm Overview isn't (T-36).
    page: 'ticket-questions',
    opening: { scroll: 150 },
    async run(t) {
      const main = document.scrollingElement as HTMLElement;
      t.check('the page scrolls at this size, so the scroll is worth checking', main.scrollHeight - main.clientHeight > 150, { scroll: main.scrollHeight, client: main.clientHeight });
      t.check('the first model replaced the loading screen', t.all('.opening').length === 0, t.all('.opening').length);
      t.check('the page is at the saved scroll', main.scrollTop === 150, { now: main.scrollTop });
    },
  },
  {
    name: 'task modal: Escape closes it, tells the extension, and focus goes back to its card',
    page: 'tasks',
    async run(t) {
      const { dialog, card } = await openTask(t);
      await t.escape(dialog);
      t.check('Escape closes it', !dialog.open);
      const closed = t.sent('task-modal-close');
      t.check('the extension hears it closed, once', closed.length === 1 && closed[0]?.project === t.data.task.project && closed[0]?.key === t.data.task.key, closed);
      t.check('focus goes back to the card that opened it', document.activeElement === card, document.activeElement?.className);
      // Edge: Escape with it already closed does nothing more.
      await t.escape(dialog);
      t.check('a second Escape sends no second close', t.sent('task-modal-close').length === 1, t.sent('task-modal-close').length);
    },
  },
  {
    name: 'task modal: it opens from its card, and closes back to it',
    page: 'tasks',
    async run(t) {
      const { dialog, card } = await openTask(t);
      const at = (): { x: number; y: number } => { const [x, y] = getComputedStyle(dialog).transformOrigin.split(' ').map(parseFloat); return { x: x!, y: y! }; };
      const want = (c: HTMLElement): { x: number; y: number } => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2 - dialog.offsetLeft, y: r.top + r.height / 2 - dialog.offsetTop }; };
      const near = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => Math.abs(a.x - b.x) < 1.5 && Math.abs(a.y - b.y) < 1.5;
      t.check('it scales from its card\'s centre', near(at(), want(card)), JSON.stringify([at(), want(card)]));
      // Edge: a card at the dialog's own centre would pass with no origin set, so it must be somewhere else.
      t.check('that is not the modal\'s own centre, the default', !near(at(), { x: dialog.offsetWidth / 2, y: dialog.offsetHeight / 2 }), JSON.stringify(at()));
      // Edge: the board redrew under it, so the card is a new element: closing aims at that one.
      await t.post({ type: 'state', model: t.model });
      const again = t.find(`[data-peek="${CSS.escape(t.data.task.peek)}"]`);
      await t.click(t.find('.task-modal-close', dialog));
      t.check('it closes toward the card for its task now on the board', near(at(), want(again)), JSON.stringify([at(), want(again)]));
    },
  },
  {
    name: 'task modal: a click on the backdrop closes it; one inside it, or a drag out of it, doesn\'t',
    page: 'tasks',
    async run(t) {
      const { dialog, body } = await openTask(t);
      await t.click(body);
      t.check('a click inside it leaves it open', dialog.open);
      await t.backdrop(dialog, true);
      t.check('a press inside released on the backdrop, as a drag out of a text box, leaves it open', dialog.open);
      await t.backdrop(dialog);
      t.check('a click on the backdrop closes it', !dialog.open);
      t.check('the extension hears it closed', t.sent('task-modal-close').length === 1, t.sent('task-modal-close'));
    },
  },
  {
    name: 'task modal: Close sends focus back to its card, found again after the board redrew under it',
    page: 'tasks',
    async run(t) {
      const { dialog, card } = await openTask(t);
      await t.post({ type: 'state', model: t.model });
      t.check('the board redrew: the card that opened it has gone from the page', !card.isConnected);
      const again = t.find(`[data-peek="${CSS.escape(t.data.task.peek)}"]`);
      await t.click(t.find('.task-modal-close', dialog));
      t.check('Close closes it', !dialog.open);
      t.check('focus goes to the card for its task on the redrawn board', document.activeElement === again, document.activeElement?.className);
    },
  },
  {
    name: 'task modal: a new board model under it leaves it open, scrolled and typed in as it was',
    page: 'tasks',
    async run(t) {
      const { dialog, body } = await openTask(t);
      const box = t.find<HTMLTextAreaElement>('textarea.comment-box', dialog);
      await t.type(box, 'A comment half written');
      body.scrollTop = Math.floor((body.scrollHeight - body.clientHeight) / 2);
      const y = body.scrollTop;
      t.check('its body scrolls at this size, so the scroll is worth checking', y > 0, { y, scroll: body.scrollHeight, client: body.clientHeight });
      await t.post({ type: 'state', model: t.model });
      t.check('it stays open', dialog.open);
      t.check('it keeps its scroll', body.scrollTop === y, { was: y, now: body.scrollTop });
      t.check('the comment box keeps what\'s typed', box.isConnected && box.value === 'A comment half written', { connected: box.isConnected, value: t.find<HTMLTextAreaElement>('textarea.comment-box', dialog).value });
      t.check('and keeps focus', document.activeElement === box, document.activeElement?.className);
      t.check('the extension hears nothing closed', t.sent('task-modal-close').length === 0);
    },
  },
  {
    name: 'task modal: Show all on a fold in it redraws it, unfolded',
    page: 'tasks',
    async run(t) {
      const { dialog } = await openTask(t);
      // The first fold long enough to keep its Show all: a step's reason in Activity, on ACME-12.
      const folds = t.all('.foldable', dialog);
      const at = folds.findIndex((f) => !!f.querySelector(':scope > .fold-toggle'));
      if (at < 0) throw new Error('not found: a fold in the modal with Show all');
      const fold = folds[at]!;
      t.check('it starts folded', !!fold.querySelector('.clamped'));
      const toggle = t.find(':scope > .fold-toggle', fold);
      t.check('its toggle says Show all', toggle.textContent?.trim() === 'Show all', toggle.textContent);
      await t.click(toggle);
      t.check('it stays open', dialog.open);
      const now = t.all('.foldable', dialog)[at];
      if (!now) throw new Error('not found: the fold again after the redraw');
      t.check('the fold is redrawn in the modal: a new element', now !== fold);
      t.check('unfolded', !now.querySelector('.clamped'));
      t.check('its toggle says Show less', t.find(':scope > .fold-toggle', now).textContent?.trim() === 'Show less', t.find(':scope > .fold-toggle', now).textContent);
    },
  },
  {
    name: 'detail modal: Escape closes it and focus goes back to Answer, which opened it',
    page: 'overview-landing',
    async run(t) {
      const opener = t.find(`button[data-opens="${CSS.escape(t.data.questionOpens)}"]`);
      await t.click(opener);
      const dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
      t.check('the question opens over the Overview', dialog.open);
      t.check('focus moves into it', dialog.contains(document.activeElement), document.activeElement?.className);
      await t.escape(dialog);
      t.check('Escape closes it', !dialog.open);
      t.check('the tab forgets it was open', t.memory().detail === undefined, t.memory().detail);
      t.check('focus goes back to Answer, not its line', document.activeElement === opener, document.activeElement?.className);
    },
  },
  {
    name: 'detail modal: a click on the backdrop closes it; one inside it, or a drag out of it, doesn\'t; focus goes back to the line that opened it',
    page: 'overview-landing',
    async run(t) {
      // Opened by a click on the question's line, not its Answer: focus goes back to the line.
      const opener = t.find(`li[data-opens="${CSS.escape(t.data.questionOpens)}"]`);
      await t.click(opener);
      const dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
      const body = t.find('.task-modal-body', dialog);
      await t.click(body);
      t.check('a click inside it leaves it open', dialog.open);
      await t.backdrop(dialog, true);
      t.check('a press inside released on the backdrop leaves it open', dialog.open);
      await t.backdrop(dialog);
      t.check('a click on the backdrop closes it', !dialog.open);
      t.check('focus goes back to the line', document.activeElement === opener, document.activeElement?.className);
    },
  },
  {
    name: 'detail modal: a new model under it leaves it open on the same rule, scrolled and typed in, and focus finds the card that opened its list again',
    page: 'overview-landing',
    async run(t) {
      const { dialog, body, opener } = await openRules(t);
      await page(t, dialog, 'Next');
      const accept = t.all<HTMLButtonElement>('.detail-actions button', dialog).find((b) => b.textContent?.trim() === 'Accept…');
      if (!accept) throw new Error('not found: Accept… on the second rule');
      await t.click(accept);
      const box = t.find<HTMLTextAreaElement>('textarea.rule-input', dialog);
      await t.type(box, 'A rule line, edited');
      body.scrollTop = Math.floor((body.scrollHeight - body.clientHeight) / 2);
      const y = body.scrollTop;
      t.check('its body scrolls at this size, so the scroll is worth checking', y > 0, { y, scroll: body.scrollHeight, client: body.clientHeight });
      await t.post({ type: 'state', model: t.model });
      t.check('it stays open', dialog.open);
      t.check('on the same rule', shownRule(t, dialog).place === `2 of ${t.data.rules.length}`, shownRule(t, dialog));
      t.check('it keeps its scroll', body.scrollTop === y, { was: y, now: body.scrollTop });
      const again = t.find<HTMLTextAreaElement>('textarea.rule-input', dialog);
      t.check('the draft keeps what\'s typed', again.value === 'A rule line, edited', again.value);
      t.check('and keeps focus', document.activeElement === again, document.activeElement?.className);
      t.check('the page redrew: the card that opened its list has gone', !opener.isConnected);
      await t.escape(dialog);
      const card = t.find('[data-overview-card="moment"]');
      t.check('focus goes to the card on the redrawn page', document.activeElement === card, document.activeElement?.className);
    },
  },
  {
    name: 'detail modal: Show all opens the whole list over the page',
    page: 'overview-landing',
    async run(t) {
      const group = t.find(`[data-overview-group="${CSS.escape(t.data.list.key)}"]`);
      t.check('the page shows the first few', t.all('.lp-row', group).length === t.data.list.shown, t.all('.lp-row', group).length);
      const more = t.find<HTMLButtonElement>('.lp-more', group);
      t.check('Show all counts them', more.textContent?.trim() === `Show all ${t.data.list.total}`, more.textContent);
      await t.click(more);
      const dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
      t.check('it opens', dialog.open);
      t.check('headed with the list and its count', t.find('.detail-title', dialog).textContent === `${t.data.list.title}: ${t.data.list.total}`, t.find('.detail-title', dialog).textContent);
      t.check('holding every line', t.all('.lp-row', dialog).length === t.data.list.total, t.all('.lp-row', dialog).length);
      await t.escape(dialog);
      t.check('focus goes back to Show all', document.activeElement === more, document.activeElement?.className);
    },
  },
  {
    name: 'overview: each card opens its list in full over the page, In progress with its machine line, and focus comes back to it',
    page: 'overview-landing',
    async run(t) {
      const cards = t.all<HTMLButtonElement>('[data-overview-card]');
      t.check('a card for each list but Needs you that holds a line, in order', JSON.stringify(cards.map((c) => c.dataset.overviewCard)) === JSON.stringify(t.data.cards.map((c) => c.key)), cards.map((c) => c.dataset.overviewCard));
      for (const want of t.data.cards) {
        const card = t.find<HTMLButtonElement>(`[data-overview-card="${CSS.escape(want.key)}"]`);
        t.check(`${want.key}: a button, so Enter and Space open it too`, card.tagName === 'BUTTON' && card.type === 'button', card.tagName);
        t.check(`${want.key}: its name holds its count`, card.getAttribute('aria-label') === want.name, card.getAttribute('aria-label'));
        await t.click(card);
        const dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
        t.check(`${want.key}: it opens`, dialog.open);
        t.check(`${want.key}: the tab remembers what it opened`, JSON.stringify(t.memory().detail) === want.opens, t.memory().detail);
        t.check(`${want.key}: headed with its list`, t.find('.detail-title', dialog).textContent === want.title, t.find('.detail-title', dialog).textContent);
        const lines = t.all(want.history ? '.history-feed > li' : '.lp-row', dialog).length;
        t.check(`${want.key}: holding every line`, lines === want.lines, lines);
        if (want.key === 'progress') t.check('In progress: its machine line on top', t.all('.machine-line .status', dialog).length === t.data.machine, t.all('.machine-line .status', dialog).length);
        await t.escape(dialog);
        t.check(`${want.key}: focus comes back to the card`, document.activeElement === card, document.activeElement?.className);
      }
    },
  },
  {
    name: 'overview: the header\'s one button is Add task, and its ⋯ menu sends what Start an agent, Add a tracker and Refresh did',
    page: 'overview-landing',
    async run(t) {
      const header = t.find('.page-header');
      const buttons = t.all<HTMLButtonElement>('.toolbar > .btn', header);
      t.check('one button in the header: Add task', buttons.length === 1 && buttons[0]!.textContent?.trim() === 'Add task', buttons.map((b) => b.textContent?.trim()));
      const open = async () => {
        await t.click(t.find<HTMLButtonElement>('.more-btn', header));
        return t.all<HTMLButtonElement>('.more-item', header);
      };
      const items = await open();
      t.check('the menu names each, with its icon', JSON.stringify(items.map((b) => [b.textContent?.trim(), !!b.querySelector('.codicon')])) === JSON.stringify([['Start an agent', true], ['Add a tracker', true], ['Refresh', true]]), items.map((b) => b.textContent?.trim()));
      t.check('it opens with focus on its first item', document.activeElement === items[0], document.activeElement?.className);
      for (const label of ['Start an agent', 'Add a tracker', 'Refresh']) {
        const item = (await open()).find((b) => b.textContent?.trim() === label);
        if (!item) throw new Error(`not found: ${label} in the header's menu`);
        await t.click(item);
      }
      const toolbar = t.sent('toolbar').map((m) => [m.command, m.project]);
      t.check('Start an agent and Add a tracker run their commands on the project, as their buttons did', JSON.stringify(toolbar) === JSON.stringify([['acc.agent.new', t.data.project], ['acc.trackers.add', t.data.project]]), toolbar);
      t.check('Refresh asks the extension to read again, as its button did', t.sent('refresh').length === 1, t.sent('refresh'));
      t.check('a pick closes the menu', t.all('.more-menu:not([hidden])', header).length === 0);
    },
  },
  {
    name: 'detail modal: Previous and Next walk the suggested rules, one at a time, to each end',
    page: 'overview-landing',
    async run(t) {
      const { dialog } = await openRules(t);
      const n = t.data.rules.length;
      const prev = () => t.all<HTMLButtonElement>('.detail-pager button', dialog).find((b) => b.textContent?.trim() === 'Previous');
      const next = () => t.all<HTMLButtonElement>('.detail-pager button', dialog).find((b) => b.textContent?.trim() === 'Next');
      t.check('it starts at the first', shownRule(t, dialog).place === `1 of ${n}` && shownRule(t, dialog).line === t.data.rules[0]?.line, shownRule(t, dialog));
      t.check('Previous is off at the first', prev()?.disabled === true);
      await page(t, dialog, 'Next');
      t.check('Next shows the second', shownRule(t, dialog).place === `2 of ${n}` && shownRule(t, dialog).line === t.data.rules[1]?.line, shownRule(t, dialog));
      await page(t, dialog, 'Previous');
      t.check('Previous goes back to the first', shownRule(t, dialog).place === `1 of ${n}` && shownRule(t, dialog).line === t.data.rules[0]?.line, shownRule(t, dialog));
      for (let i = 1; i < n; i++) await page(t, dialog, 'Next');
      t.check('Next walks to the last', shownRule(t, dialog).place === `${n} of ${n}` && shownRule(t, dialog).line === t.data.rules[n - 1]?.line, shownRule(t, dialog));
      t.check('Next is off at the last', next()?.disabled === true);
      t.check('walking sends the extension nothing', t.sent('rule-accept').length + t.sent('rule-dismiss').length === 0);
    },
  },
  {
    name: 'detail modal: Accept and Confirm on the second rule send what the inline button did',
    page: 'overview-landing',
    async run(t) {
      const { dialog } = await openRules(t);
      await page(t, dialog, 'Next');
      const accept = t.all<HTMLButtonElement>('.detail-actions button', dialog).find((b) => b.textContent?.trim() === 'Accept…');
      if (!accept) throw new Error('not found: Accept… on the second rule');
      await t.click(accept);
      t.check('Accept opens its draft in the modal', !!dialog.querySelector('.rule-draft'));
      const confirm = t.all<HTMLButtonElement>('.rule-draft-bar button', dialog).find((b) => b.textContent?.trim() === 'Confirm');
      if (!confirm) throw new Error('not found: Confirm in the draft');
      await t.click(confirm);
      const sent = t.sent('rule-accept');
      const want = t.data.rules[1]?.accept;
      const same = (a: unknown, b: unknown) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
      t.check('Confirm sends one accept, for the second rule, as the inline button did', sent.length === 1 && same(sent[0], want), { sent, want });
    },
  },
  {
    name: 'detail modal: a rule acc accepted leaves at once, though the next model still holds it; a refused one says why; the last one dismissed closes it',
    page: 'overview-landing',
    async run(t) {
      const { dialog } = await openRules(t);
      const n = t.data.rules.length;
      const first = t.data.rules[0]!;
      // The rules' line leads the When you have a moment card (T-36), as it leads that list.
      const line = () => document.querySelector('[data-overview-card="moment"]')?.textContent ?? '';
      t.check('the card\'s line counts them all', line().includes(`${n} suggested rules`), line());
      const accept = t.all<HTMLButtonElement>('.detail-actions button', dialog).find((b) => b.textContent?.trim() === 'Accept…');
      if (!accept) throw new Error('not found: Accept… on the first rule');
      await t.click(accept);
      const confirm = t.all<HTMLButtonElement>('.rule-draft-bar button', dialog).find((b) => b.textContent?.trim() === 'Confirm');
      if (!confirm) throw new Error('not found: Confirm in the draft');
      await t.click(confirm);
      t.check('Confirm sent its accept', t.sent('rule-accept').length === 1);
      // acc's reply comes before any model without it.
      await t.post({ type: 'rule-done', action: 'rule-accept', project: first.accept.project, id: first.id, ok: true, task: 'T-9' });
      const gone = () => !t.all('.rule-line', dialog).some((e) => e.textContent === first.line) && !t.all<HTMLButtonElement>('button', dialog).some((b) => b.textContent?.trim() === 'Confirm');
      t.check('from acc\'s reply, it and its Confirm are gone', gone(), shownRule(t, dialog));
      t.check('the detail shows the next one, counting one fewer', shownRule(t, dialog).place === `1 of ${n - 1}` && shownRule(t, dialog).line === t.data.rules[1]?.line, shownRule(t, dialog));
      t.check('its title counts one fewer', t.find('.detail-title', dialog).textContent === `Suggested rules: ${n - 1}`, t.find('.detail-title', dialog).textContent);
      t.check('the card\'s line counts one fewer', line().includes(`${n - 1} suggested rules`), line());
      await t.post({ type: 'state', model: t.model });
      t.check('a model that still holds it doesn\'t bring it back', gone() && shownRule(t, dialog).place === `1 of ${n - 1}`, shownRule(t, dialog));
      // The next one's accept, which acc refuses, as it does one another window already accepted: its reason shows, and it stays.
      const second = t.data.rules[1]!;
      const accept2 = t.all<HTMLButtonElement>('.detail-actions button', dialog).find((b) => b.textContent?.trim() === 'Accept…');
      if (!accept2) throw new Error('not found: Accept… on the next rule');
      await t.click(accept2);
      const confirm2 = t.all<HTMLButtonElement>('.rule-draft-bar button', dialog).find((b) => b.textContent?.trim() === 'Confirm');
      if (!confirm2) throw new Error('not found: Confirm in the next rule\'s draft');
      await t.click(confirm2);
      const why = `No rule is suggested as ${second.id} now. "See the suggested rules" lists them.`;
      await t.post({ type: 'rule-done', action: 'rule-accept', project: second.accept.project, id: second.id, ok: false, error: why });
      const said = dialog.querySelector('.aq-error')?.textContent ?? '';
      t.check('a refused accept shows acc\'s reason in words', said === `The task wasn't added: ${why}`, said);
      t.check('and the rule stays, to try again', shownRule(t, dialog).line === second.line && !!dialog.querySelector('.rule-draft'), shownRule(t, dialog));
      // Dismiss the rest, each answered by acc: the last one closes the detail, and the line goes.
      for (const r of t.data.rules.slice(1)) {
        const dismiss = t.all<HTMLButtonElement>('.detail-actions button', dialog).find((b) => b.textContent?.trim() === 'Dismiss');
        if (!dismiss) throw new Error(`not found: Dismiss on ${r.id}`);
        await t.click(dismiss);
        await t.post({ type: 'rule-done', action: 'rule-dismiss', project: r.accept.project, id: r.id, ok: true });
      }
      t.check('every one sent its dismiss', t.sent('rule-dismiss').length === n - 1, t.sent('rule-dismiss').length);
      t.check('none left, the detail closes', !dialog.open);
      t.check('and the rules\' line goes from the card', !line().includes('suggested rule'), line());
    },
  },
  {
    name: 'detail modal: Show all on a rule\'s reviews, a fold, redraws it with every review',
    page: 'overview-landing',
    async run(t) {
      const { dialog } = await openRules(t);
      await page(t, dialog, 'Next');
      const want = t.data.rules[1]?.sources ?? 0;
      t.check('the second rule has more reviews than it shows', want > t.all('.rule-source', dialog).length, { shown: t.all('.rule-source', dialog).length, want });
      const toggle = t.find('.rule-sources-wrap .fold-toggle', dialog);
      await t.click(toggle);
      t.check('it stays open, on the same rule', dialog.open && shownRule(t, dialog).place === `2 of ${t.data.rules.length}`, shownRule(t, dialog));
      t.check('it shows every review', t.all('.rule-source', dialog).length === want, t.all('.rule-source', dialog).length);
    },
  },
  {
    name: 'task page: an analysis with wording findings shows its wording list, a line for each finding with its place and why',
    page: 'ticket-questions',
    async run(t) {
      const box = t.find('.an-wording');
      t.check('the list has its heading', t.find('.strong', box).textContent === 'How the requirements read', t.find('.strong', box).textContent);
      const items = t.all('li', box);
      t.check('a line for each finding', items.length === t.data.wording.length && items.length > 0, { shown: items.length, expected: t.data.wording.length });
      for (const [i, f] of t.data.wording.entries()) {
        const text = items[i]?.textContent ?? '';
        t.check(`finding ${i + 1} shows its place, why, and its line`, text.startsWith(`${f.place}: ${f.message}`) && text.includes(f.text), text);
      }
    },
  },
  {
    name: 'task page: a review lists its findings, must-fix first, each with its lines, and a click on a file and line asks to open it there',
    page: 'ticket-review',
    async run(t) {
      const box = t.find('.side-review');
      const items = t.all('.rv-finding', box);
      const want = t.data.review.findings;
      t.check('a finding for each in the model', items.length === want.length && items.length > 0, { shown: items.length, expected: want.length });
      const shown = items.map((li) => ({ label: t.find('.status', li).textContent ?? '', message: t.find('.rv-message', li).textContent ?? '' }));
      // The order itself, not only the model's: no Must fix after a Worth a look.
      const firstWorth = shown.findIndex((s) => s.label === 'Worth a look');
      t.check('must-fix findings come first', firstWorth > 0 && shown.slice(firstWorth).every((s) => s.label !== 'Must fix'), shown.map((s) => s.label));
      for (const [i, f] of want.entries()) t.check(`finding ${i + 1} shows its state and message, in the model's order`, shown[i]?.label === f.label && shown[i]?.message === f.message, shown[i]);
      t.check('an added and a removed line each name their mark', !!box.querySelector('.rv-add .rv-sign[aria-label="added"]') && !!box.querySelector('.rv-del .rv-sign[aria-label="removed"]'));
      t.check('the finding\'s own line is marked', t.all('.rv-at', box).length >= 1);
      const link = t.all<HTMLButtonElement>('button.rv-place', box).find((b) => !b.disabled);
      if (!link) throw new Error('not found: a file and line that opens');
      await t.click(link);
      const sent = t.sent('review-file').at(-1);
      const click = t.data.review.click;
      t.check('a click on the file and line sends its path and line, for its task', !!sent && ['project', 'task', 'file', 'line'].every((k) => sent[k] === click[k]), sent);
    },
  },
  {
    name: 'settings: a link for each part opens its heading, and each long explanation is a closed What this means that stays open once opened',
    page: 'settings-agents',
    async run(t) {
      const want = t.data.settings;
      const links = t.all('.settings-guide a[data-guide]');
      t.check('a link for each part, in order', links.length === want.parts.length && links.every((a, i) => a.dataset.guide === want.parts[i]), links.map((a) => a.dataset.guide));
      t.check('the guide is named for screen readers', t.find('nav.settings-guide').getAttribute('aria-label') === 'Parts of Settings');
      const limits = links.find((a) => a.dataset.guide === 'settings:limits');
      if (!limits) throw new Error('not found: the link to Limits and checks');
      await t.click(limits);
      t.check('the link focuses its part\'s heading', document.activeElement === t.find('[data-part="settings:limits"]'), document.activeElement?.outerHTML.slice(0, 80));
      const folds = t.all<HTMLDetailsElement>('details.settings-fold');
      t.check('a fold for each long explanation', folds.length === want.folds.length && want.folds.length > 0, { drawn: folds.map((d) => d.dataset.fold), expected: want.folds.map((f) => f.id) });
      for (const f of want.folds) t.check(`${f.id} is closed at first`, !t.find<HTMLDetailsElement>(`details.settings-fold[data-fold="${CSS.escape(f.id)}"]`).open);
      t.check('each short explanation stays in view, outside a fold', t.all('.settings-meaning').filter((p) => !p.closest('details')).length >= want.kept, t.all('.settings-meaning').length);
      const first = want.folds[0]!;
      await t.click(t.find(`details.settings-fold[data-fold="${CSS.escape(first.id)}"] > summary`));
      t.check('a click opens it, and the tab remembers it', ((t.memory().opened as string[] | undefined) ?? []).includes(first.key), t.memory().opened);
      await t.post({ type: 'state', model: t.model });
      t.check('a redraw leaves it open', t.find<HTMLDetailsElement>(`details.settings-fold[data-fold="${CSS.escape(first.id)}"]`).open);
      t.check('and the others closed', t.all<HTMLDetailsElement>('details.settings-fold[open]').length === 1, t.all('details.settings-fold[open]').length);
    },
  },
  {
    name: 'connect: a button that is off gives its reason in its title and, for Save, in a status line beside it',
    page: 'connect-start',
    async run(t) {
      const want = t.data.connect;
      const save = t.all<HTMLButtonElement>('.connect-foot button').find((b) => b.textContent?.trim() === want.save);
      if (!save) throw new Error(`not found: the ${want.save} button`);
      t.check('Save is off', save.disabled);
      t.check('its title is the reason', save.title === want.why, save.title);
      const line = t.find('.connect-foot .status');
      t.check('a status line beside it says the same', line.textContent?.trim() === want.why, line.textContent);
      t.check('with an icon, never colour alone', !!line.querySelector('.codicon, svg, [class*="codicon"]'), line.innerHTML.slice(0, 120));
      // Edge: Test connection is on here (a project is chosen), so it has no reason and no title.
      const test = t.all<HTMLButtonElement>('.connect-test button').find((b) => b.textContent?.trim() === 'Test connection');
      if (!test) throw new Error('not found: the Test connection button');
      t.check('Test connection is on, with nothing to explain', !test.disabled && test.title === '' && t.all('.connect-test .status').length === 0, { title: test.title });
    },
  },
  {
    name: 'connect: with no project chosen, Test connection is off and gives its reason in its title and in a status line beside it',
    page: 'connect-start',
    async run(t) {
      const none = t.data.connect.none;
      const home = structuredClone(t.model) as HomeModel;
      home.connect = none.model;
      await t.post({ type: 'state', model: home });
      const test = t.all<HTMLButtonElement>('.connect-test button').find((b) => b.textContent?.trim() === 'Test connection');
      if (!test) throw new Error('not found: the Test connection button');
      t.check('Test connection is off', test.disabled);
      t.check('its title is the reason', test.title === none.testWhy, test.title);
      const line = t.find('.connect-test .status');
      t.check('a status line beside it says the same', line.textContent?.trim() === none.testWhy, line.textContent);
      t.check('with an icon, never colour alone', !!line.querySelector('.codicon, svg, [class*="codicon"]'), line.innerHTML.slice(0, 120));
    },
  },
  {
    name: 'agent page: Stop stands apart from the header\'s other buttons, and the question card keeps In the terminal but not In Claude Code, unless the header has none',
    page: 'agent',
    async run(t) {
      const text = (b: Element) => b.textContent?.trim() ?? '';
      const bar = t.find('.agent-head .ticket-bar');
      const apart = t.all<HTMLButtonElement>('.actions-stop button', bar).map(text);
      t.check('Stop is alone in its own group, and keeps its name', apart.length === 1 && apart[0] === 'Stop', apart);
      const rest = t.all<HTMLButtonElement>('.actions:not(.actions-stop) button', bar).map(text);
      t.check('the buttons that only open things are in the other group, with no Stop among them', rest.includes('Open in Claude Code') && rest.includes('Attach in terminal') && !rest.includes('Stop'), rest);
      const card = t.find('.agent-asks article.question');
      const labels = () => t.all<HTMLButtonElement>('button', card).map(text);
      t.check('the card leaves out In Claude Code, which the header has', !labels().includes('In Claude Code'), labels());
      t.check('the card keeps In the terminal: it hands the question back, which Attach in terminal doesn\'t', labels().includes('In the terminal'), labels());
      // Edge: a header with no Open in Claude Code leaves the card as the only way there.
      const bare = structuredClone(t.model) as unknown as { actions: { command: string }[] };
      bare.actions = bare.actions.filter((a) => a.command !== 'acc.agent.openInClaude');
      await t.post({ type: 'state', model: bare });
      t.check('with no Open in Claude Code in the header, the card shows In Claude Code', t.all<HTMLButtonElement>('.agent-asks article.question button').map(text).includes('In Claude Code'));
      await t.post({ type: 'state', model: t.model });
      const term = t.all<HTMLButtonElement>('.agent-asks article.question button').find((b) => text(b) === 'In the terminal');
      if (!term) throw new Error('not found: In the terminal on the card');
      await t.click(term);
      const answer = t.sent('answer').at(-1);
      t.check('In the terminal sends the answer that releases the waiting hook', answer?.decision === 'terminal', answer);
    },
  },
  {
    name: 'palette: the rail\'s button opens it with focus in the box, a combobox over a listbox of options, and the sections for an empty query',
    page: 'tasks',
    async run(t) {
      const { button, dialog, box } = await openPalette(t);
      t.check('the button names it, with the key in its title', button.getAttribute('aria-label') === 'Search or run a command' && /K/.test(button.title), button.title);
      const list = t.find('[role=listbox]', dialog);
      t.check('the box is a combobox that controls the list', box.getAttribute('role') === 'combobox' && box.getAttribute('aria-controls') === list.id, box.outerHTML.slice(0, 200));
      const options = t.all('[role=option]', list);
      t.check('nothing run yet: the sections, in order', JSON.stringify(options.map((o) => t.find('.palette-title', o).textContent)) === JSON.stringify(t.data.palette.sections), options.map((o) => o.textContent));
      t.check('the box names the first as the choice', box.getAttribute('aria-activedescendant') === options[0]?.id && options[0]?.getAttribute('aria-selected') === 'true', box.getAttribute('aria-activedescendant'));
      const live = t.find('[aria-live]', dialog);
      t.check('a live line says how many results there are', live.textContent?.startsWith(`${options.length} results`) === true, live.textContent);
      t.check('a heading names the group', t.all('.palette-head', list).map((h) => h.textContent).join() === 'Sections', t.all('.palette-head', list).map((h) => h.textContent));
      // `/` opens it too, but not while typing in a text box, where it's a character.
      await t.escape(dialog);
      const field = document.createElement('input');
      document.body.append(field);
      field.focus();
      const typed = await press(t, field, '/');
      t.check('/ in a text box opens nothing, and stays a character', !dialog.open && !typed.defaultPrevented);
      field.remove();
      const slash = await press(t, document.body, '/');
      t.check('/ elsewhere on the page opens it, with focus in the box', dialog.open && slash.defaultPrevented && document.activeElement === box, document.activeElement?.className);
    },
  },
  {
    name: 'palette: the extension\'s message opens it, with focus in the box',
    page: 'tasks',
    async run(t) {
      t.check('it isn\'t open before', t.all('dialog.palette-modal[open]').length === 0);
      await t.post({ type: 'palette' });
      const dialog = t.find<HTMLDialogElement>('dialog.palette-modal');
      t.check('the message opens it', dialog.open);
      t.check('focus is in its box', document.activeElement === t.find('.palette-box', dialog), document.activeElement?.className);
      // Edge: a second message while it's open opens no second palette.
      await t.post({ type: 'palette' });
      t.check('a second message leaves one palette open', t.all('dialog.palette-modal[open]').length === 1);
    },
  },
  {
    name: 'palette: typing 16 and Enter opens ACME-16 over the board, and it is remembered as run',
    page: 'tasks',
    async run(t) {
      const { dialog, box } = await openPalette(t);
      await t.type(box, '16');
      const first = t.find('[role=option]', dialog);
      t.check('16 finds ACME-16 first, its key in bold', t.find('.palette-hint', first).textContent === t.data.palette.task.key && t.find('.palette-hint b', first).textContent === '16', first.textContent);
      await press(t, box, 'Enter');
      t.check('Enter closes the palette', !dialog.open);
      const asked = t.sent('task-modal-open').at(-1);
      t.check('it asks for ACME-16 in the modal, as its card\'s click does', asked?.project === t.data.palette.task.project && asked?.key === t.data.palette.task.key && !('tracker' in (asked ?? {})), asked);
      await t.post(t.data.palette.task.message);
      const modal = t.find<HTMLDialogElement>('dialog.task-modal:not(.detail-modal):not(.palette-modal)');
      t.check('ACME-16 opens over the board', modal.open && modal.getAttribute('aria-label')?.startsWith(`${t.data.palette.task.key}:`) === true, modal.getAttribute('aria-label'));
      const ran = (t.memory().palette as string[] | undefined) ?? [];
      t.check('the page remembers it as run', ran[0] === t.data.palette.task.id, ran);
    },
  },
  {
    name: 'palette: Down then Enter runs the second result',
    page: 'tasks',
    async run(t) {
      const { dialog, box } = await openPalette(t);
      await t.type(box, t.data.palette.second.query);
      const options = t.all('[role=option]', dialog);
      t.check('the second result is the one Node expects', t.find('.palette-title', options[1]!).textContent === t.data.palette.second.title, options.map((o) => o.textContent));
      await press(t, box, 'ArrowDown');
      t.check('Down makes the second the choice', box.getAttribute('aria-activedescendant') === options[1]!.id && options[1]!.getAttribute('aria-selected') === 'true', box.getAttribute('aria-activedescendant'));
      // Edge: End and Home go to the ends, and Up at the top stays there.
      await press(t, box, 'End');
      t.check('End goes to the last', box.getAttribute('aria-activedescendant') === options.at(-1)!.id);
      await press(t, box, 'Home');
      await press(t, box, 'ArrowUp');
      t.check('Home goes to the first, and Up there stays', box.getAttribute('aria-activedescendant') === options[0]!.id);
      await press(t, box, 'ArrowDown');
      const type = String(t.data.palette.second.sent.type);
      const before = t.sent(type).length;
      await press(t, box, 'Enter');
      const sent = t.sent(type);
      t.check('Enter runs the second result: it sends what its control sends', sent.length === before + 1 && JSON.stringify(sent.at(-1)) === JSON.stringify(t.data.palette.second.sent), sent.at(-1));
      t.check('and closes the palette', !dialog.open);
    },
  },
  {
    name: 'palette: Escape closes it, and focus returns to the rail\'s button that opened it',
    page: 'tasks',
    async run(t) {
      const { button, dialog } = await openPalette(t);
      // A new model while it's open redraws the rail under it, with a new button.
      await t.post({ type: 'state', model: t.model });
      t.check('a new model leaves it open', dialog.open);
      t.check('the rail was drawn again', !button.isConnected);
      await t.escape(dialog);
      t.check('Escape closes it', !dialog.open);
      t.check('focus goes back to the button, found again', (document.activeElement as HTMLElement | null)?.classList.contains('palette-btn') === true, document.activeElement?.className);
      t.check('it ran nothing', t.sent('run').length + t.sent('toolbar').length + t.sent('task-modal-open').length === 0);
    },
  },
  {
    name: 'palette: Tab and Shift+Tab stay inside it, and typing goes to the box',
    page: 'tasks',
    async run(t) {
      const { dialog, box } = await openPalette(t);
      const tab = await press(t, box, 'Tab');
      t.check('Tab is kept: the page takes it, so focus can\'t leave', tab.defaultPrevented, tab.defaultPrevented);
      t.check('focus stays in the box', document.activeElement === box, document.activeElement?.className);
      const back = await press(t, box, 'Tab', true);
      t.check('Shift+Tab is kept too', back.defaultPrevented && document.activeElement === box, document.activeElement?.className);
      // Focus somewhere else in it, as a click on a heading leaves it: a key typed there goes to the box.
      const head = t.find('.palette-head', dialog);
      head.tabIndex = -1;
      head.focus();
      await press(t, head, 'a');
      t.check('typing goes to the box', document.activeElement === box, document.activeElement?.className);
      t.check('it stays open', dialog.open);
    },
  },
  {
    name: 'palette: a disabled result does not run, and its reason shows',
    page: 'tasks',
    async run(t) {
      await t.post({ type: 'state', model: t.data.palette.disabled.model });
      const { dialog, box } = await openPalette(t);
      await t.type(box, t.data.palette.disabled.title);
      const first = t.find('[role=option]', dialog);
      t.check('the result is the disabled one, marked so', t.find('.palette-title', first).textContent === t.data.palette.disabled.title && first.getAttribute('aria-disabled') === 'true', first.outerHTML.slice(0, 200));
      t.check('its reason shows beside it, with an icon', t.find('.palette-hint', first).textContent === t.data.palette.disabled.reason && !!t.find('.palette-hint', first).querySelector('.codicon'), t.find('.palette-hint', first).textContent);
      await press(t, box, 'Enter');
      t.check('Enter runs nothing', t.sent('toolbar').length === 0 && t.sent('run').length === 0, t.sent('toolbar'));
      t.check('it stays open', dialog.open);
      t.check('the live line says why', t.find('[aria-live]', dialog).textContent?.includes(t.data.palette.disabled.reason) === true, t.find('[aria-live]', dialog).textContent);
      // Edge: a click on it runs nothing either.
      await t.click(first);
      t.check('a click runs nothing', t.sent('toolbar').length === 0 && dialog.open);
    },
  },  {
    name: 'board keys: one card on each board is in the tab order, and Right moves focus to the next column\'s card',
    page: 'tasks',
    async run(t) {
      const boards = t.all('.board[data-keys]');
      t.check('the board is wired to its keys', boards.length > 0, boards.length);
      for (const b of boards) {
        const inTab = t.all('article.card', b).map((a) => (a.matches('[data-peek]') ? a : a.querySelector<HTMLElement>('[data-peek]'))).filter((e) => e?.tabIndex === 0);
        t.check(`one card on ${b.dataset.keys} is in the tab order`, inTab.length === 1, inTab.length);
      }
      const first = boardCard(t, t.data.keys.first);
      t.check('Tab from outside lands on the first card: it is the one in the tab order', first.focus.tabIndex === 0, first.focus.tabIndex);
      first.focus.focus();
      const right = await press(t, first.focus, 'ArrowRight');
      const next = boardCard(t, t.data.keys.right);
      t.check('Right moves focus to the card at the same place in the next column', document.activeElement === next.focus, document.activeElement?.textContent?.slice(0, 80));
      t.check('the page takes Right, so the board doesn\'t scroll', right.defaultPrevented);
      t.check('the card focused now is the one in the tab order', next.focus.tabIndex === 0 && first.focus.tabIndex === -1, [next.focus.tabIndex, first.focus.tabIndex]);
      await press(t, next.focus, 'ArrowLeft');
      t.check('Left goes back', document.activeElement === first.focus, document.activeElement?.textContent?.slice(0, 80));
      await press(t, first.focus, 'ArrowDown');
      t.check('Down goes to the next card in the column', document.activeElement === boardCard(t, t.data.keys.down).focus, document.activeElement?.textContent?.slice(0, 80));
      await press(t, document.activeElement as HTMLElement, 'End');
      t.check('End goes to the column\'s last card', document.activeElement === boardCard(t, t.data.keys.last).focus, document.activeElement?.textContent?.slice(0, 80));
      await press(t, document.activeElement as HTMLElement, 'Home');
      t.check('Home goes to its first', document.activeElement === first.focus, document.activeElement?.textContent?.slice(0, 80));
      // Edge: a key the board doesn't take is left alone.
      const other = await press(t, first.focus, 'a');
      t.check('a key it doesn\'t take leaves focus and the key alone', document.activeElement === first.focus && !other.defaultPrevented);
      await press(t, first.focus, 'Enter');
      const asked = t.sent('task-modal-open');
      t.check('Enter opens the card', asked.length === 1 && asked[0]?.key === t.data.keys.first, asked);
    },
  },
  {
    name: 'board keys: Space, Right and Enter move a card as a drop does, and the live line says so',
    page: 'tasks',
    async run(t) {
      const { card, focus, board, live } = boardCard(t, t.data.keys.move.card);
      const m = t.data.keys.move;
      focus.focus();
      await press(t, focus, ' ');
      t.check('Space picks it up: it says Moving, with an icon', card.classList.contains('held') && t.find('.card-moving', card).textContent === 'Moving' && !!t.find('.card-moving .codicon', card));
      t.check('the live line says it is moving, and how to drop it', live.textContent === m.moving, live.textContent);
      t.check('the columns it may land in are marked', JSON.stringify(t.all('.column.can-drop', board).map((c) => c.dataset.col)) === JSON.stringify(m.lanes), t.all('.column.can-drop', board).map((c) => c.dataset.col));
      t.check('none is chosen yet', t.all('.column.drop-target', board).length === 0);
      await press(t, focus, 'ArrowRight');
      t.check('Right chooses the next column', JSON.stringify(t.all('.column.drop-target', board).map((c) => c.dataset.col)) === JSON.stringify([m.to]), t.all('.column.drop-target', board).map((c) => c.dataset.col));
      t.check('focus stays on the held card', document.activeElement === focus);
      await press(t, focus, 'Enter');
      const sent = t.sent('move');
      t.check('Enter sends the move, once', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(m.sent), sent);
      t.check('Enter drops it rather than opening it', t.sent('task-modal-open').length === 0, t.sent('task-modal-open'));
      t.check('the live line says where it moved', live.textContent === m.moved, live.textContent);
      t.check('it shows in its new column at once, put down', (card.closest('.column') as HTMLElement | null)?.dataset.col === m.to && !card.classList.contains('held') && !card.querySelector('.card-moving'));
      t.check('no column is marked any more', t.all('.column.can-drop, .column.drop-target', board).length === 0);
      t.check('focus stays on it', document.activeElement === focus);
      // A drop of another card on the same column sends the same message, with its own key.
      const other = t.find(`.column[data-col="${CSS.escape(t.all('.column', board)[0]!.dataset.col!)}"] article.card`, board);
      const dt = new DataTransfer();
      dt.setData('text/x-acc-card', other.dataset.cardId!);
      t.find(`.column[data-col="${CSS.escape(m.to)}"]`, board).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await t.settle();
      const drop = t.sent('move');
      t.check('a drop there sends the same message', drop.length === 2 && JSON.stringify({ ...drop[1], key: m.card }) === JSON.stringify(m.sent), drop);
    },
  },
  {
    name: 'board keys: Escape puts a held card down where it was and sends nothing',
    page: 'tasks',
    async run(t) {
      const { card, focus, board, live } = boardCard(t, t.data.keys.move.card);
      const home = (card.closest('.column') as HTMLElement).dataset.col;
      focus.focus();
      await press(t, focus, ' ');
      await press(t, focus, 'ArrowRight');
      const esc = await press(t, focus, 'Escape');
      t.check('the page takes Escape', esc.defaultPrevented);
      t.check('Escape sends no move', t.sent('move').length === 0, t.sent('move'));
      t.check('the card is put down in its own column', !card.classList.contains('held') && !card.querySelector('.card-moving') && (card.closest('.column') as HTMLElement).dataset.col === home);
      t.check('no column is marked any more', t.all('.column.can-drop, .column.drop-target', board).length === 0 && !board.classList.contains('holding'));
      t.check('the live line says it stays', live.textContent === t.data.keys.move.stays, live.textContent);
      t.check('focus stays on it', document.activeElement === focus);
      // Edge: Enter after Escape opens the card, as it did before the hold.
      await press(t, focus, 'Enter');
      t.check('Enter then opens it, and moves nothing', t.sent('task-modal-open').length === 1 && t.sent('move').length === 0, t.sent('task-modal-open'));
    },
  },
  {
    name: 'board keys: Space on a card no column takes says why, and holds nothing',
    page: 'tasks',
    async run(t) {
      await t.post({ type: 'state', model: t.data.keys.stuck.model });
      const seg = t.all<HTMLButtonElement>('.segmented .seg').find((b) => b.textContent?.includes('Agent board'));
      if (!seg) throw new Error('not found: the Agent board button');
      await t.click(seg);
      const { card, focus, board, live } = boardCard(t, t.data.keys.stuck.card);
      focus.focus();
      const space = await press(t, focus, ' ');
      t.check('the page takes Space', space.defaultPrevented);
      t.check('the live line says why it can\'t move', live.textContent === t.data.keys.stuck.says, live.textContent);
      t.check('it says so with an icon', !!live.querySelector('.codicon'));
      t.check('nothing is held or marked', !card.classList.contains('held') && !board.classList.contains('holding') && t.all('.column.can-drop', board).length === 0);
      // Edge: Enter after it opens the card, and moves nothing.
      await press(t, focus, 'Enter');
      t.check('Enter then opens it, and sends no move', t.sent('task-modal-open').length === 1 && t.sent('move-task').length === 0, t.sent('move-task'));
    },
  },
  {
    name: 'board keys: focus stays on the same card after a redraw, in its new column',
    page: 'tasks',
    async run(t) {
      const m = t.data.keys.move;
      boardCard(t, m.card).focus.focus();
      await t.post({ type: 'state', model: t.model });
      const again = boardCard(t, m.card);
      t.check('a redraw keeps focus on the card, a new element', document.activeElement === again.focus, document.activeElement?.className);
      await press(t, again.focus, ' ');
      await press(t, again.focus, 'ArrowRight');
      await press(t, again.focus, 'Enter');
      await t.post({ type: 'state', model: t.data.keys.moved });
      const moved = boardCard(t, m.card);
      t.check('the redrawn board has it in its new column', (moved.card.closest('.column') as HTMLElement).dataset.col === m.to);
      t.check('focus is on it there', document.activeElement === moved.focus, document.activeElement?.className);
      t.check('it is the card in the tab order', moved.focus.tabIndex === 0 && t.all('[data-peek]', moved.board).filter((e) => e.tabIndex === 0).length === 1);
      t.check('the live line still says where it moved', moved.live.textContent === m.moved, moved.live.textContent);
    },
  },
];

// ---------------------------------------------------------------- mutants: the page with one behaviour broken

/** One change to the webview's source that breaks a behaviour, and the cases that must fail on it. */
export interface Mutant { name: string; file: string; find: string; replace: string; kills: string[] }

const caseNamed = (start: string): string => {
  const c = CASES.find((x) => x.name.startsWith(start));
  if (!c) throw new Error(`No case starts "${start}".`);
  return c.name;
};

export const MUTANTS: Mutant[] = [
  { name: 'Escape does nothing', file: 'modal.ts', find: "dialog.addEventListener('cancel', (e) => { e.preventDefault(); shut(); });", replace: "dialog.addEventListener('cancel', (e) => { e.preventDefault(); });", kills: [caseNamed('task modal: Escape'), caseNamed('detail modal: Escape'), caseNamed('palette: Escape')] },
  { name: 'a backdrop click does nothing', file: 'modal.ts', find: 'if (downOnBackdrop && onBackdrop(dialog, e)) shut();', replace: 'if (downOnBackdrop && onBackdrop(dialog, e)) { /* stub */ }', kills: [caseNamed('task modal: a click on the backdrop'), caseNamed('detail modal: a click on the backdrop')] },
  { name: 'a drag out of it closes it', file: 'modal.ts', find: 'if (downOnBackdrop && onBackdrop(dialog, e)) shut();', replace: 'if (onBackdrop(dialog, e)) shut();', kills: [caseNamed('task modal: a click on the backdrop'), caseNamed('detail modal: a click on the backdrop')] },
  { name: 'the task modal leaves focus where it falls', file: 'task-modal.ts', find: 'cardOf(m)?.focus();', replace: '', kills: [caseNamed('task modal: Close sends focus back')] },
  { name: 'the task modal has no origin to grow from', file: 'task-modal.ts', find: "d.style.setProperty('--origin',", replace: "void ('--origin',", kills: [caseNamed('task modal: it opens from its card')] },
  { name: 'the detail leaves focus where it falls', file: 'detail.ts', find: '(openers.find((e) => e.tagName === openedBy) ?? openers[0])?.focus();', replace: '', kills: [caseNamed('detail modal: a new model under it')] },
  { name: 'a detail opened from a card\'s list sends focus nowhere', file: 'detail.ts', find: 'CSS.escape(from ?? opensKey(d))', replace: 'CSS.escape(opensKey(d))', kills: [caseNamed('detail modal: a new model under it')] },
  { name: 'the detail sends focus to the first thing that opens it', file: 'detail.ts', find: '(openers.find((e) => e.tagName === openedBy) ?? openers[0])?.focus();', replace: 'openers[0]?.focus();', kills: [caseNamed('detail modal: Escape')] },
  { name: 'the task modal draws again with every board model', file: 'task-modal.ts', find: 'const own = model === under;', replace: 'const own = true;', kills: [caseNamed('task modal: a new board model')] },
  { name: 'the task modal doesn\'t draw again with its own fold', file: 'task-modal.ts', find: 'if (own && state.modal && dialog?.open) draw();', replace: 'if (!own && state.modal && dialog?.open) draw();', kills: [caseNamed('task modal: Show all on a fold')] },
  { name: 'the detail starts at its top on every draw', file: 'detail.ts', find: 'const y = fresh ? 0 : modal.body.scrollTop;', replace: 'const y = 0;', kills: [caseNamed('detail modal: a new model under it')] },
  { name: 'a rule\'s draft forgets what\'s typed', file: 'rules.ts', find: "box.addEventListener('input', () => { keep(c, name, box.value); onInput(); });", replace: "box.addEventListener('input', () => { onInput(); });", kills: [caseNamed('detail modal: a new model under it')] },
  { name: 'the detail doesn\'t draw again after the page does', file: 'detail.ts', find: "if (model.kind === 'home' && memory().detail) draw();", replace: "if (model.kind === 'home' && memory().detail && model !== state.last) draw();", kills: [caseNamed('detail modal: Show all on a rule'), caseNamed('detail modal: Accept')] },
  { name: 'Show all opens only what the page shows', file: 'detail.ts', find: 'const rows = g ? g.all : [];', replace: 'const rows = g ? g.rows : [];', kills: [caseNamed('detail modal: Show all opens'), caseNamed('overview: each card opens')] },
  { name: 'a card opens nothing', file: 'landing.ts', find: "b.addEventListener('click', () => openDetail(c.opens));", replace: "b.addEventListener('click', () => undefined);", kills: [caseNamed('overview: each card opens')] },
  { name: 'In progress\'s detail drops its machine line', file: 'detail.ts', find: "const top = d.group === 'progress' ? machineLine(o.inProgress) : null;", replace: 'const top = null;', kills: [caseNamed('overview: each card opens')] },
  { name: 'the header\'s menu runs each item as a task\'s action', file: 'overview.ts', find: "(a.command === 'refresh' ? refreshPage() : api.postMessage({ type: 'toolbar', command: a.command, project: root }))", replace: "api.postMessage({ type: 'run', command: a.command, ref: a.ref })", kills: [caseNamed('overview: the header')] },
  { name: 'Next stays put', file: 'detail.ts', find: "const next = button('Next', 'arrow-right', () => go(at + 1), 'ghost small');", replace: "const next = button('Next', 'arrow-right', () => go(at), 'ghost small');", kills: [caseNamed('detail modal: Previous and Next'), caseNamed('detail modal: Accept')] },
  { name: 'Previous stays put', file: 'detail.ts', find: "const prev = button('Previous', 'arrow-left', () => go(at - 1), 'ghost small');", replace: "const prev = button('Previous', 'arrow-left', () => go(at), 'ghost small');", kills: [caseNamed('detail modal: Previous and Next')] },
  { name: 'the detail shows the first rule whatever the pager says', file: 'detail.ts', find: 'card(items[at]!)', replace: 'card(items[0]!)', kills: [caseNamed('detail modal: Previous and Next'), caseNamed('detail modal: Accept')] },
  { name: 'Confirm leaves out the check it asks for', file: 'rules.ts', find: 'title: now.title.trim(), check: now.check,', replace: 'title: now.title.trim(),', kills: [caseNamed('detail modal: Accept')] },
  { name: 'a rule acc accepted stays until a model without it comes', file: 'rules.ts', find: '    settled.add(ruleKey(c));\n', replace: '', kills: [caseNamed('detail modal: a rule acc accepted leaves')] },
  { name: 'a model that still holds an accepted rule brings it back', file: 'rules.ts', find: 'for (const k of [...settled]) if (!live.has(k)) settled.delete(k);', replace: 'settled.clear();', kills: [caseNamed('detail modal: a rule acc accepted leaves')] },
  { name: 'the task page shows no wording list', file: 'analysis.ts', find: 'if (a.wording) {', replace: 'if (a.wording && !a.wording) {', kills: [caseNamed('task page: an analysis with wording findings')] },
  { name: 'the wording list leaves out where each finding is', file: 'analysis.ts', find: "el('strong', '', `${f.place}: `)", replace: "el('strong', '', '')", kills: [caseNamed('task page: an analysis with wording findings')] },
  { name: 'the review lists its findings in the reviewer\'s order', file: 'review.ts', find: 'r.findings.map(finding)', replace: '[...r.findings].reverse().map(finding)', kills: [caseNamed('task page: a review lists its findings')] },
  { name: 'a finding\'s file and line sends nothing', file: 'review.ts', find: "b.addEventListener('click', () => api.postMessage({ type: 'review-file', ...opens }));", replace: "b.addEventListener('click', () => void opens);", kills: [caseNamed('task page: a review lists its findings')] },
  { name: 'a guide link goes nowhere', file: 'settings.ts', find: "a.addEventListener('click', (e) => { e.preventDefault(); jumpTo(g.part); });", replace: "a.addEventListener('click', (e) => { e.preventDefault(); });", kills: [caseNamed('settings: a link for each part')] },
  { name: 'every explanation stays in view', file: 'dom.ts', find: 'if (!folded.includes(id)) return', replace: 'if (text) return', kills: [caseNamed('settings: a link for each part')] },
  { name: 'an opened explanation closes on a redraw', file: 'dom.ts', find: 'd.open = memory().opened.includes(key);', replace: 'd.open = false;', kills: [caseNamed('settings: a link for each part')] },
  { name: 'the Connect page draws no status line beside Save', file: 'connect.ts', find: '(m.save.look ?? m.save.why) ? status((m.save.look ?? m.save.why)!) : null', replace: 'm.save.look ? status(m.save.look) : null', kills: [caseNamed('connect: a button that is off')] },
  { name: 'the Connect page leaves Save\'s title empty', file: 'connect.ts', find: 'if (m.save.why) save.title = m.save.why.label;', replace: '', kills: [caseNamed('connect: a button that is off')] },
  { name: 'the Connect page draws no status line beside Test connection', file: 'connect.ts', find: 'm.signIn.why ? status(m.signIn.why) : null', replace: 'null', kills: [caseNamed('connect: with no project chosen')] },
  { name: 'the Connect page leaves Test connection\'s title empty', file: 'connect.ts', find: 'if (m.signIn.why) testButton.title = m.signIn.why.label;', replace: '', kills: [caseNamed('connect: with no project chosen')] },
  { name: 'Stop sits with the other header buttons', file: 'agent-page.ts', find: '.filter((a) => a !== stop)', replace: '.filter(() => true)', kills: [caseNamed('agent page: Stop stands apart')] },
  { name: 'every question card on the agent page repeats In Claude Code', file: 'agent-page.ts', find: "const claudeInHeader = m.actions.some((a) => a.command === 'acc.agent.openInClaude');", replace: 'const claudeInHeader = false;', kills: [caseNamed('agent page: Stop stands apart')] },
  { name: 'no question card on the agent page offers In Claude Code', file: 'agent-page.ts', find: "const claudeInHeader = m.actions.some((a) => a.command === 'acc.agent.openInClaude');", replace: 'const claudeInHeader = true;', kills: [caseNamed('agent page: Stop stands apart')] },
  { name: 'the card drops In the terminal', file: 'questions.ts', find: "const terminal = el('span', 'q-aside-group', inClaude, inTerminal);", replace: "const terminal = el('span', 'q-aside-group', inClaude);", kills: [caseNamed('agent page: Stop stands apart')] },
  { name: 'a page holding only the loading screen isn\'t fresh', file: 'main.ts', find: "const fresh = !app.hasChildNodes() || !!app.querySelector(':scope > .opening');", replace: 'const fresh = !app.hasChildNodes();', kills: [caseNamed('loading screen: a tab rebuilt')] },
  { name: 'the palette\'s Enter runs the first result rather than the choice', file: 'palette.ts', find: 'const choice = shown[active];', replace: 'const choice = shown[0];', kills: [caseNamed('palette: Down then Enter')] },
  { name: 'Tab leaves the palette', file: 'palette.ts', find: "if (e.key === 'Tab') {\n      e.preventDefault();\n      box.focus();", replace: "if (e.key === 'Tab') {", kills: [caseNamed('palette: Tab')] },
  { name: 'the palette\'s match ignores the query', file: 'fuzzy.ts', find: 'const m = fuzzyMatch(query, item.words);', replace: 'const m = fuzzyMatch(item.words, item.words);', kills: [caseNamed('palette: typing 16')] },
  { name: 'the palette leaves focus where it falls', file: 'palette.ts', find: 'again?.focus({ preventScroll: true });', replace: '', kills: [caseNamed('palette: Escape')] },
  { name: 'a disabled palette result runs', file: 'palette.ts', find: '  if (item.disabled) {\n    parts.foot', replace: '  if (!item) {\n    parts.foot', kills: [caseNamed('palette: a disabled result')] },
  { name: 'the extension\'s palette message opens nothing', file: 'palette.ts', find: "receive: { palette: (msg: { query?: string }) => openPalette(typeof msg.query === 'string' ? msg.query : '') },", replace: 'receive: { palette: () => undefined },', kills: [caseNamed('palette: the extension')] },
  { name: 'the rail has no palette button', file: 'rail.ts', find: 'paletteButton(), list,', replace: 'list,', kills: [caseNamed('palette: the rail')] },
  { name: '/ opens no palette', file: 'palette.ts', find: "document.addEventListener('keydown', onSlash);", replace: '', kills: [caseNamed('palette: the rail')] },
  { name: '/ opens the palette from a text box too', file: 'palette.ts', find: "if (t?.closest('input, textarea, select, [contenteditable=\"\"], [contenteditable=\"true\"], dialog[open]')) return;", replace: '', kills: [caseNamed('palette: the rail')] },
  { name: 'Right does nothing on a board', file: 'board-keys.ts', find: "const step = key === 'ArrowRight' ? 1 : -1;", replace: "const step = key === 'ArrowRight' ? 0 : -1;", kills: [caseNamed('board keys: one card')] },
  { name: 'every card on a board is in the tab order', file: 'board-nav.ts', find: 'focusOf(a).tabIndex = a === to ? 0 : -1;', replace: 'focusOf(a).tabIndex = 0;', kills: [caseNamed('board keys: one card')] },
  { name: 'a held card\'s Enter sends no message', file: 'board-nav.ts', find: 'o.move(id, to);', replace: '', kills: [caseNamed('board keys: Space, Right and Enter')] },
  { name: 'Escape still sends the move', file: 'board-nav.ts', find: "} else if (e.key === 'Escape') {\n          e.preventDefault();\n          e.stopImmediatePropagation();\n          putDown();", replace: "} else if (e.key === 'Escape') {\n          e.preventDefault();\n          e.stopImmediatePropagation();\n          o.move(id, held.at);\n          putDown();", kills: [caseNamed('board keys: Escape')] },
  { name: 'the board\'s live line stays silent', file: 'board-nav.ts', find: "live.replaceChildren(icon(look.icon, look.tone), el('span', '', text));", replace: 'void look;', kills: [caseNamed('board keys: Space, Right and Enter'), caseNamed('board keys: Escape'), caseNamed('board keys: Space on a card')] },
  { name: 'a redraw drops the focused card\'s focus', file: 'board-nav.ts', find: 'if (again) focusOf(again).focus({ preventScroll: true });', replace: '', kills: [caseNamed('board keys: focus stays')] },
];

/** How many times `find` is in `source`: a mutant applies only where it's there exactly once. */
export const occurrences = (source: string, find: string): number => (find ? source.split(find).length - 1 : 0);

// ---------------------------------------------------------------- what Node expects, and the page

/** What the Connect case expects (T-45): the reason Save is off, from the model the page is drawn from. */
function connectData(model: Model): BehaviourData['connect'] {
  if (model.kind !== 'home' || !model.connect?.save.why) throw new Error('The Connect case needs a home model whose Save is off with a reason.');
  const none = connectModel(blankConnect(JIRA, { id: 'c-none', root: null, projectName: '', ownRepo: null, ghAccount: null, from: 'tasks' }));
  if (!none.signIn.why) throw new Error('The Connect case needs a page with no project whose Test connection is off with a reason.');
  return { save: model.connect.save.label, why: model.connect.save.why.label, none: { model: none, testWhy: none.signIn.why.label } };
}

/** What Settings' case expects (T-40): from the model, each part's heading and each explanation, folded or kept. */
function settingsData(model: Model): BehaviourData['settings'] {
  if (model.kind !== 'home') throw new Error('The Settings case needs a home model.');
  const meanings = settingsMeanings(model.settings);
  return {
    parts: settingsGuide(model.settings.parts).map((g) => g.part),
    folds: meanings.filter((x) => foldsMeaning(x.text)).map((x) => ({ id: x.id, key: meaningKey(x.id) })),
    kept: meanings.filter((x) => !foldsMeaning(x.text)).length,
  };
}

/** The oracle: what each case should see, from the fixtures the pages are drawn from. */
export function behaviourData(models: CaseModels, now: number): BehaviourData {
  const ticket = sampleTicket(now);
  const o = (models.overview as HomeModel).overview;
  const rules = o.attention.flatMap((a) => (a.rule ? [a.rule] : []));
  // The inline Confirm's message (D-116), from the card as drafted: nothing typed, so acc's own words.
  const accept = (r: (typeof rules)[number]) => ({ type: 'rule-accept', project: r.project, id: r.id, line: r.line, title: r.title, check: r.check });
  const list = o.landing.find((g) => g.more?.do.kind === 'detail' && g.more.do.detail.kind === 'list');
  if (!list) throw new Error('The Overview fixture has no list with more than its page shows.');
  return {
    task: { project: ROOT, key: ticket.key, peek: `${ROOT}#${ticket.key.toUpperCase()}`, message: { type: 'task-modal', model: ticket, tab: { type: 'ticket', project: ROOT, tracker: 0, key: ticket.key } } },
    rules: rules.map((r) => ({ id: r.id, line: r.line, sources: r.sources.length, accept: accept(r) })),
    rulesOpens: JSON.stringify({ kind: 'rules' }),
    questionOpens: JSON.stringify({ kind: 'question', id: o.questions[0]!.id }),
    list: { key: list.key, title: list.title, shown: list.rows.length, total: list.total },
    cards: o.cards.map((c) => {
      const g = o.landing.find((x) => x.key === c.key)!;
      return { key: c.key, name: `${c.title}, ${c.count}: ${c.line}`, opens: JSON.stringify(c.opens), title: c.opens.kind === 'history' ? 'History' : `${g.title}: ${g.total}`, lines: g.total, history: c.opens.kind === 'history' };
    }),
    machine: o.inProgress.machine.length,
    project: ROOT,
    settings: settingsData(models.settings),
    connect: connectData(models.connect),
    wording: (sampleTicket(now, 'ACME-21').analysis?.wording?.findings ?? []).map((f) => ({ place: f.place, message: f.message, text: f.text })),
    palette: paletteData(models.tasks, now),
    review: reviewData(models.review),
    keys: keysData(models.tasks),
  };
}

/** What the board's key cases expect (T-54), from the Tasks board's model: the Jira board it opens on, and the agent board. */
function keysData(model: Model): BehaviourData['keys'] {
  if (model.kind !== 'home') throw new Error('The board key cases need a home model.');
  const board = model.tasks.projects[0]?.boards[0];
  const [home, next] = board?.columns ?? [];
  if (!board || !home || home.cards.length < 3 || !next?.cards.length) throw new Error('The board key cases need a Jira board whose first column has three cards and whose second has one.');
  const card = home.cards[0]!.key;
  const moved = JSON.parse(JSON.stringify(model)) as typeof model;
  const cols = moved.tasks.projects[0]!.boards[0]!.columns;
  cols[1]!.cards.unshift(cols[0]!.cards.shift()!);
  // A task no column takes from where it is: its card's lanes emptied, as the model gives such a task.
  const stuck = JSON.parse(JSON.stringify(model)) as typeof model;
  const done = stuck.tasks.projects[0]!.columns.findLast((c) => c.cards.length)!;
  done.cards[0]!.drops = [];
  return {
    first: card, down: home.cards[1]!.key, last: home.cards.at(-1)!.key, right: next.cards[0]!.key,
    move: {
      card, to: next.id, lanes: board.columns.slice(1).map((c) => c.id),
      sent: { type: 'move', project: model.tasks.projects[0]!.root, tracker: board.index, key: card, to: next.id },
      moving: `Moving ${card}. Left and Right choose a column. Enter drops it. Escape cancels.`,
      moved: `Moved ${card} to ${next.name}`,
      stays: `Put ${card} down. It stays in ${home.name}.`,
    },
    moved,
    stuck: { card: done.cards[0]!.id, model: stuck, says: `${done.cards[0]!.id} can't move from ${done.label}. No other column takes it from here.` },
  };
}

/** What the palette's cases expect (T-52), from the Tasks board's model and the palette's own search. */
function paletteData(model: Model, now: number): BehaviourData['palette'] {
  if (model.kind !== 'home') throw new Error('The palette cases need a home model.');
  const found = paletteResults(model.palette, '16').groups[0]?.items[0]?.item;
  if (found?.does.kind !== 'task') throw new Error('On the Tasks board, "16" should find a task first.');
  const card = model.tasks.projects.flatMap((p) => p.columns.flatMap((c) => c.cards)).find((c) => c.id === found.hint)!;
  const second = paletteResults(model.palette, 'set').groups.flatMap((g) => g.items)[1]?.item;
  if (second?.does.kind !== 'go') throw new Error('On the Tasks board, "set" should find a section second.');
  const none = paletteItems({ ...model, agents: { ...model.agents, stopFinished: 0 } });
  const off = none.find((i) => i.disabled === NOTHING_FINISHED)!;
  return {
    sections: model.nav.map((n) => n.label),
    task: { id: found.id, key: found.does.key, project: found.does.project, message: { type: 'task-modal', model: { ...sampleTicket(now), key: card.id, title: card.title }, tab: { type: 'ticket', project: found.does.project, key: card.id } } },
    second: { query: 'set', title: second.title, sent: { type: 'nav', section: second.does.section } },
    disabled: { model: { ...model, agents: { ...model.agents, stopFinished: 0 }, palette: none }, title: off.title, reason: NOTHING_FINISHED },
  };
}

/** What the review case expects (T-53): from the model, each finding's state and message, and the first link's message. */
function reviewData(model: Model): BehaviourData['review'] {
  const r = model.kind === 'ticket' ? model.review : null;
  const opens = r?.findings.find((f) => f.opens)?.opens;
  if (!r || !opens) throw new Error('The review case needs a task page whose review has a file and line that opens.');
  return { findings: r.findings.map((f) => ({ label: f.look.label, message: f.message })), click: { type: 'review-file', ...opens } };
}

/** What a case found, as the page wrote it. */
export interface BehaviourReport { checks: { what: string; ok: boolean; detail?: string }[]; error: string | null; sent: Record<string, unknown>[] }

/** A case's run: its name, and its report, or null when the page wrote none. */
export interface BehaviourRun { name: string; report: BehaviourReport | null }

/** The report a --dump-dom of a case's page holds, or null when it never wrote one. */
export function dumpedBehaviour(dom: string): BehaviourReport | null {
  const m = /<script[^>]*\bid="acc-behaviour"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  return m ? (JSON.parse(m[1]!) as BehaviourReport) : null;
}

/**
 * What fails a run of the cases: a case that wrote no report, stopped on an error (an element it looked
 * for wasn't there), checked nothing, or failed a check; a message the page sent that the extension
 * wouldn't take; and a run of no cases.
 */
export function judgeBehaviour(runs: BehaviourRun[], accepts: (m: unknown) => boolean = isFromWebview): { failures: string[]; checks: number } {
  const failures: string[] = [];
  let checks = 0;
  if (!runs.length) failures.push('No case was run.');
  for (const { name, report } of runs) {
    if (!report) { failures.push(`${name}: the page wrote no report`); continue; }
    checks += report.checks.length;
    if (report.error) failures.push(`${name}: stopped: ${report.error}`);
    if (!report.checks.length) failures.push(`${name}: checked nothing`);
    for (const c of report.checks) if (!c.ok) failures.push(`${name}: ${c.what}${c.detail ? ` (found ${c.detail})` : ''}`);
    for (const m of report.sent) if (!accepts(m)) failures.push(`${name}: the page sent a message the extension wouldn't take: ${JSON.stringify(m).slice(0, 200)}`);
  }
  return { failures, checks };
}

/** A case failed: its report says so. A mutant is caught only by a case that ran and failed, not one that never wrote. */
export const caseFailed = (r: BehaviourReport | null): boolean => !!r && (!!r.error || r.checks.some((c) => !c.ok));

/**
 * What fails a run of the mutants: one whose change didn't apply exactly once, one a case it names
 * passed on, and one that names no case. Each mutant's runs are the cases it names.
 */
export function judgeMutants(results: { mutant: Mutant; applied: number; runs: BehaviourRun[] }[]): string[] {
  const out: string[] = [];
  if (!results.length) out.push('No mutant was run.');
  for (const { mutant, applied, runs } of results) {
    if (applied !== 1) { out.push(`Mutant "${mutant.name}": its change is in ${mutant.file} ${applied} times, not once: bring it up to date with the source.`); continue; }
    if (!mutant.kills.length) out.push(`Mutant "${mutant.name}" names no case.`);
    for (const name of mutant.kills) {
      const r = runs.find((x) => x.name === name);
      if (!r?.report) out.push(`Mutant "${mutant.name}": "${name}" wrote no report, so it can't be said to have caught it.`);
      else if (!caseFailed(r.report)) out.push(`Mutant "${mutant.name}": "${name}" passed with the behaviour broken: it doesn't catch a stub.`);
    }
  }
  return out;
}

/** The page's side: a VSCode API that keeps what the page sends and remembers, then the case, then its report. */
function harness(c: Case, data: BehaviourData, model: Model): string {
  // Where the page keeps a tab's scroll (the page script's pageKey), for a case whose tab remembers one. It remembers its section too, as a tab that was open does; with none the first model counts as a section change, which skips the scroll.
  const key = model.kind === 'home' ? (model.connect ? 'home:connect' : `home:${model.section}`) : model.kind;
  const seeded = c.opening ? { opened: [], drafts: {}, section: model.kind === 'home' ? model.section : undefined, scroll: { [key]: { y: c.opening.scroll, boards: [] } } } : undefined;
  const fns = [...HELPERS.map((f) => `const ${f.name} = ${f.toString().replace(/^async function \w+/, 'async function').replace(/^function \w+/, 'function')};`), `const RUN = ${c.run.toString().replace(/^async run/, 'async function')};`].join('\n');
  return `
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};
const SENT = [];
let MEMORY = ${JSON.stringify(seeded)};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
${fns}
function report(out) {
  const s = document.createElement('script');
  s.type = 'application/json';
  s.id = 'acc-behaviour';
  s.textContent = JSON.stringify(out).replace(/</g, '\\\\u003c');
  document.body.append(s);
}
async function begin() {
  const checks = [];
  const settle = () => new Promise((r) => setTimeout(r, 120));
  const t = {
    find(sel, within = document) { const e = within.querySelector(sel); if (!e) throw new Error('not found: ' + sel); return e; },
    all(sel, within = document) { return [...within.querySelectorAll(sel)]; },
    check(what, ok, detail) { checks.push({ what, ok: !!ok, ...(ok ? {} : { detail: JSON.stringify(detail === undefined ? null : detail).slice(0, 300) }) }); },
    async post(m) { window.postMessage(clone(m), '*'); await settle(); },
    settle,
    async click(e) {
      if (e.hasAttribute('tabindex') || e.matches('button, a[href], input, textarea, select')) e.focus();
      const r = e.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      e.dispatchEvent(new MouseEvent('mousedown', at));
      e.dispatchEvent(new MouseEvent('mouseup', at));
      e.dispatchEvent(new MouseEvent('click', at));
      await settle();
    },
    async escape(d) {
      const ev = new Event('cancel', { cancelable: true });
      const was = d.open;
      d.dispatchEvent(ev);
      // The browser closes a modal dialog on Escape unless its cancel event was prevented.
      if (was && !ev.defaultPrevented && d.open) d.close();
      await settle();
    },
    async backdrop(d, downInside = false) {
      const r = d.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const spot = r.left >= 4 ? { x: r.left / 2, y: r.top + r.height / 2 } : r.top >= 4 ? { x: r.left + r.width / 2, y: r.top / 2 } : vw - r.right >= 4 ? { x: (r.right + vw) / 2, y: r.top + r.height / 2 } : vh - r.bottom >= 4 ? { x: r.left + r.width / 2, y: (r.bottom + vh) / 2 } : null;
      if (!spot) throw new Error('not found: any backdrop around the modal to click');
      const inside = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const down = downInside ? inside : spot;
      const target = downInside ? (document.elementFromPoint(inside.x, inside.y) ?? d) : d;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: down.x, clientY: down.y }));
      d.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: spot.x, clientY: spot.y }));
      d.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: spot.x, clientY: spot.y }));
      await settle();
    },
    async type(box, text) { box.focus(); box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); await settle(); },
    sent(type) { return SENT.filter((m) => m && m.type === type); },
    memory() { return clone(MEMORY) ?? {}; },
    model: MODEL,
    data: DATA,
  };
  let error = null;
  try {
    window.postMessage({ type: 'state', model: clone(MODEL) }, '*');
    await settle();
    await RUN(t);
  } catch (e) {
    error = String((e && e.message) || e);
  }
  report({ checks, error, sent: SENT });
}
window.acquireVsCodeApi = () => ({
  postMessage(m) { SENT.push(clone(m)); if (m && m.type === 'ready') setTimeout(begin, 0); },
  getState() { return clone(MEMORY); },
  setState(s) { MEMORY = clone(s); },
});`;
}

/** A case's page, with its model and data, in the light theme. `fonts` are the fonts VSCode would set; the screenshot run's own (FONTS in screenshot.ts) is passed in, so this file imports nothing of it. */
export function behaviourPage(c: Case, model: Model, data: BehaviourData, fonts: Record<string, string>, script = 'webview/main.js'): string {
  const vars = Object.entries({ ...palettes().light, ...fonts }).map(([k, v]) => `--vscode-${k}: ${v};`).join(' ');
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark" style="${vars.replace(/"/g, '&quot;')}"><head><meta charset="UTF-8">
<style>${vscodeDefaults()}</style>
<link rel="stylesheet" href="webview/codicons/codicon.css">
<link rel="stylesheet" href="webview/styles.css">
<script>
const MODEL = ${JSON.stringify(model).replace(/</g, '\\u003c')};
${harness(c, data, model)}
</script>
</head>
<body class="vscode-light" data-view="${model.kind === 'ticket' || model.kind === 'agent' ? model.kind : 'home'}" data-logo-dark="webview/acc-dark.svg" data-logo-light="webview/acc-light.svg"><main id="app">${c.opening ? loadingScreen(model.kind === 'ticket' ? 'ticket' : 'home', { dark: 'webview/acc-dark.svg', light: 'webview/acc-light.svg' }) : ''}</main><script src="${script}"></script></body></html>
`;
}

/** The window each case runs in: short enough that each modal's body scrolls. */
export const BEHAVIOUR_WINDOW = { width: 1000, height: 640 } as const;

/** What the run needs from the screenshot script: Chrome, how it runs it, the models, and VSCode's fonts. */
export interface BehaviourDeps {
  chrome: string;
  /** A folder holding the built webview at webview/. */
  work: string;
  models: CaseModels;
  now: number;
  fonts: Record<string, string>;
  run: (chrome: string, args: string[]) => ReturnType<typeof spawnSync>;
  log: (line: string) => void;
}

function runCase(d: BehaviourDeps, c: Case, data: BehaviourData, script?: string, tag = 'case'): BehaviourRun {
  const file = join(d.work, `behaviour-${tag}-${CASES.indexOf(c)}.html`);
  writeFileSync(file, behaviourPage(c, caseModel(c, d.models), data, d.fonts, script));
  const r = d.run(d.chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--virtual-time-budget=8000', `--window-size=${BEHAVIOUR_WINDOW.width},${BEHAVIOUR_WINDOW.height}`, '--dump-dom', pathToFileURL(file).href]);
  return { name: c.name, report: r.error ? null : dumpedBehaviour(String(r.stdout ?? '')) };
}

/** Builds the webview with one mutant's change into work/webview/, returning its script's path and how often the change applied. */
async function buildMutant(work: string, m: Mutant, index: number): Promise<{ script: string; applied: number }> {
  const { build } = await import('esbuild');
  const webview = join(import.meta.dirname, '..', 'webview');
  const target = join(webview, m.file);
  let applied = 0;
  const out = `webview/mutant-${index}.js`;
  await build({
    entryPoints: [join(webview, 'main.ts')], outfile: join(work, out), bundle: true, platform: 'browser', target: 'es2022', format: 'iife', legalComments: 'none', logLevel: 'silent',
    plugins: [{ name: 'mutant', setup(b) {
      b.onLoad({ filter: /\.ts$/ }, (a) => {
        if (a.path !== target) return undefined;
        const src = readFileSync(a.path, 'utf8');
        applied = occurrences(src, m.find);
        return { contents: applied === 1 ? src.replace(m.find, m.replace) : src, loader: 'ts' };
      });
    } }],
  });
  return { script: out, applied };
}

/**
 * Runs every case on the built page, then every mutant's cases on the page built with its change. Returns
 * the failures; each case's checks and each mutant are counted in the log.
 */
export async function behaviourCheck(d: BehaviourDeps, mutants = MUTANTS): Promise<string[]> {
  const data = behaviourData(d.models, d.now);
  const runs: BehaviourRun[] = [];
  for (const c of CASES) {
    const r = runCase(d, c, data);
    runs.push(r);
    d.log(`${r.report && !caseFailed(r.report) ? 'pass' : 'FAIL'}  ${c.name}  (${r.report?.checks.length ?? 0} checks)`);
  }
  const judged = judgeBehaviour(runs);
  d.log(`Behaviour: ${runs.length} cases, ${judged.checks} checks, ${judged.failures.length} failure${judged.failures.length === 1 ? '' : 's'}.`);
  const results: { mutant: Mutant; applied: number; runs: BehaviourRun[] }[] = [];
  for (const [i, m] of mutants.entries()) {
    const built = await buildMutant(d.work, m, i);
    const mruns = built.applied === 1 ? m.kills.map((name) => runCase(d, CASES.find((c) => c.name === name)!, data, built.script, `mutant-${i}`)) : [];
    results.push({ mutant: m, applied: built.applied, runs: mruns });
    // What caught it: each case's first failed check, or what stopped it.
    const why = mruns.map((r) => r.report?.error ?? r.report?.checks.find((c) => !c.ok)?.what ?? 'passed').join('; ');
    d.log(`mutant "${m.name}": ${built.applied !== 1 ? `its change applied ${built.applied} times` : mruns.every((r) => caseFailed(r.report)) ? `caught: ${why}` : `NOT caught: ${why}`}`);
  }
  const missed = judgeMutants(results);
  const caught = results.filter((r) => r.applied === 1 && r.mutant.kills.length && r.runs.every((x) => caseFailed(x.report))).length;
  d.log(`Mutants: ${results.length}, ${caught} caught.`);
  return [...judged.failures, ...missed];
}
