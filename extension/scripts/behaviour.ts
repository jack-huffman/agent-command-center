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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JIRA } from '../../packages/core/src/trackers/connect.ts';
import { blankConnect, connectModel, type ConnectModel } from '../src/model/connect.ts';
import type { HomeModel, Model } from '../src/model/home.ts';
import { loadingScreen } from '../src/logic/loading.ts';
import { isFromWebview, type FromWebview } from '../src/model/messages.ts';
import { type HistoryItem, historyItems } from '../src/model/history.ts';
import { LOOK } from '../src/model/shared.ts';
import { type TrackerCard, trackerBoard } from '../src/model/boards.ts';
import { everyoneKept, sampleSeveralBoards } from './fixtures/boards.ts';
import { PERSON } from '../webview/person-filter.ts';
import { HISTORY_PAGE, historyReply } from '../src/model/history-pages.ts';
import { foldsMeaning, meaningKey, sectionOfPart, settingsKey, settingsMeanings } from '../src/model/settings.ts';
import { NOTHING_FINISHED, paletteItems } from '../src/model/palette.ts';
import { paletteResults } from '../webview/fuzzy.ts';
import { sampleTicket } from './fixtures/task-page.ts';
import { sampleTalkApproved } from './fixtures/talk.ts';
import { sampleConversationQuestions, sampleConversationReady, sampleConversationStart, sampleConversationTicket } from './fixtures/conversation.ts';
import { conversationModel } from '../src/model/conversation.ts';
import { sampleReport } from './fixtures/report.ts';
import { issueBody } from '../webview/report-text.ts';
import { sampleChoosing, sampleConnect } from './fixtures/connect.ts';
import { sampleCloudSetup } from './fixtures/cloud-setup.ts';
import type { CloudSetupModel } from '../src/model/cloud-setup.ts';
import { sampleSheet, sampleSheetInput } from './fixtures/dispatch-sheet.ts';
import { SAMPLE_THEIRS, SAMPLE_WORDING_FIXED, sampleTaskSheet } from './fixtures/task-sheet.ts';
import { wordingOff, wordingReply } from '../src/model/sheet-wording.ts';
import { taskSheetOff } from '../src/model/task-sheet.ts';
import { withSheetCriteria } from '../src/model/criteria.ts';
import { sampleCriteria } from './fixtures/criteria.ts';
import { dispatchChoiceArgs, dispatchSheet } from '../src/model/dispatch-sheet.ts';
import { ROOT } from './fixtures/shared.ts';
import { sampleLongHub } from './fixtures/landing.ts';
import { sampleStepRun } from './fixtures/run-steps.ts';
import { runCard } from '../src/model/runs.ts';
import { palettes, vscodeDefaults } from './styles.ts';
import { pool, type Ran } from './jobs.ts';
import { FIRST_STEPS } from '../webview/plain-words.ts';
import { deployOff } from '../src/model/ticket-deploy.ts';
import { CONFIG as DEPLOY_CONFIG, ENVS as DEPLOY_ENVS } from './fixtures/ticket-deploy.ts';

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
  /** Scrolls a box to `top`, and fires its scroll event, as the browser would once it drew the frame. */
  scroll(box: HTMLElement, top: number): Promise<void>;
  /** Types into a text box, as a person would. */
  type(box: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void>;
  /** The messages the page sent the extension, of a type. */
  sent(type: string): Record<string, unknown>[];
  /** The tab's memory, as the page last set it. */
  memory(): Record<string, unknown>;
  /** Changes the tab's memory, as a tab the page was rebuilt in remembers it: the next draw reads it. */
  remember(change: Record<string, unknown>): void;
  /** The page's model, as the extension sent it, for posting again. */
  model: Model;
  /** What Node expects, from the same fixtures: the oracle. */
  data: BehaviourData;
}

/** What the cases expect, worked out in Node from the fixtures the page is drawn from. */
export interface BehaviourData {
  /** The Tasks tab's first steps, in order, as someone new reads them (T-96). */
  firstSteps: string[];
  /** Why ACME-12's Deploy is off once only its conflict with dev holds it up, as the model says it (T-138). */
  deployConflict: string;
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
  /**
   * Since you last looked (D-164), on the Overview with news held while away: its heading's part, its title,
   * each line's task in order, and what a click on the first line sends.
   */
  since: { part: string; title: string; tasks: (string | null)[]; open: Record<string, unknown> };
  /** How many facts In progress's machine line holds, at the top of its detail. */
  machine: number;
  /**
   * History a page at a time (D-170), on the Overview with 100 entries: how many rows its first page shows,
   * and for the next page, the Commands filter and an entry on a later page, what the page asks for, the
   * extension's answer, and how many rows show once it's here. `id` is the later entry's. `newer` is the
   * model a refresh sends once a command has finished since.
   */
  history: { first: number; count: number; next: Exchange; filter: Exchange; upTo: Exchange & { id: string }; newer: Model };
  /** The project the header's Start an agent and Add a tracker act on. */
  project: string;
  /**
   * Settings (T-40, T-139): its sections in order, a part to open at and the section that shows; each explanation that
   * folds, by its id, the key the tab remembers it by and the section it's in; and how many stay in view.
   */
  settings: { sections: string[]; open: string; opened: string; deep: { part: string; section: string }; folds: { id: string; key: string; section: string }[]; kept: number };
  /**
 * The Connect page before it's signed in (T-45): Save's label, and the reason its model gives for it being off.
 * `none` is the same page with no project chosen, where Test connection is off too: its model, and the reason it gives.
 */
  connect: { site: ConnectModel; why: string; testing: { model: ConnectModel; why: string } };
  /**
   * Set up cloud builders (T-145) at The token on Windows: not done, with why Next is off, and done, with the step
   * Next goes to; and a token that fits its field.
   */
  cloud: { todo: CloudSetupModel; why: string; done: CloudSetupModel; next: string; token: string };
  /**
   * Choosing a board by seeing it (T-106): the Jira page with its preview still being read, drawn for ACME-31,
   * and with ACME-30 chosen; each preview's line, Use this board's label and why it's off while it reads.
   */
  choose: { reading: ConnectModel; shown: ConnectModel; epic: ConnectModel; save: ConnectModel; line: string; epicLine: string; use: string; wait: string };
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
  /**
   * A review in the output panel (T-63), over the Tasks board: the run it opens on and the runs message that
   * opens it, as the extension sends one when a review starts; its header's verdict and count; each row's key,
   * state and text in order; how many criteria the met row folds; its output's rows (T-64); and what a click on
   * the first finding's file and line, and on the next step, sends.
   */
  dock: { run: string; runs: Record<string, unknown>; look: string; count: string; rows: { key: string; label: string; text: string }[]; met: number; lines: string[]; click: Record<string, unknown>; next: Record<string, unknown> };
  /**
   * Dispatch's sheet (D-168). From a card: ACME-16's Dispatch, the run it sends, and the sheet the extension
   * sends back, on a builder whose model takes no effort, with the line that says so; the model the case picks,
   * its levels and the one chosen; and the message Enter sends, with acc's arguments for it. From the task
   * page: ACME-19's page in the modal, the run its Re-dispatch sends, its sheet with the cloud off and why.
   */
  sheet: {
    card: { task: string; run: Record<string, unknown>; message: Record<string, unknown>; none: string; pick: string; levels: string[]; chosen: string; sent: Record<string, unknown>; args: string[] };
    /** Another model…: its row's label, what Dispatch says while the box is empty, and the message for a name typed, with acc's arguments. */
    another: { label: string; empty: string; name: string; sent: Record<string, unknown>; args: string[] };
    page: { modal: Record<string, unknown>; run: Record<string, unknown>; message: Record<string, unknown>; title: string; reason: string };
  };
  /**
   * The task sheet (T-74): a new task's sheet and what Cmd+Enter sends once a title and a description are
   * typed; a manual task's sheet and what Save sends with its notes changed; and a Jira task's sheet with
   * its ticket's link.
   */
  taskSheet: {
    add: { message: Record<string, unknown>; off: string; title: string; brief: string; sent: Record<string, unknown> };
    edit: { message: Record<string, unknown>; notes: string; sent: Record<string, unknown> };
    tracker: { message: Record<string, unknown>; url: string; kept: number };
    /**
     * With edits on (T-80): ACME-19's sheet, the ticket text it opened with, a title typed, a failed write's
     * reason, the ticket's text a colleague wrote meanwhile, and the rows after a Change of its status.
     */
    edits: { message: Record<string, unknown>; project: string; base: Record<string, unknown>; title: string; error: string; theirs: Record<string, unknown>; rows: { field: string; value: string }[] };
    /**
     * Drafted acceptance criteria (T-81): ACME-19's sheet with edits on and a stored draft, its description
     * as it opened, the stored draft's section, a failed draft's reason, and a second draft's section.
     */
    criteria: { message: Record<string, unknown>; project: string; brief: string; section: string; error: string; again: string };
    /**
     * The wording check (T-148): T-4's sheet with a fix and a piece of advice beside its criteria, Save's reason
     * for being off, the description with the fixes, the extension's answer for it, and an answer for older text.
     */
    wording: { message: Record<string, unknown>; project: string; items: number; off: string; fixed: string; reply: Record<string, unknown>; stale: Record<string, unknown> };
  };
  /** A task page's drafted acceptance criteria (T-81): ACME-19's page with a draft, and a refused update's reason. */
  criteria: { model: Model; project: string; error: string };
  /**
   * ACME-21's approved plan (T-97): its page's model, what a change asks first, the Choose this whose change
   * is kept and the one whose change is made, by their names as read out, the message Change it sends, and the
   * remembered keys that open its Choices and the made choice's options to compare (T-136).
   */
  plan: { model: Model; ask: string; keep: string; change: string; sent: Record<string, unknown>; opened: string[] };
  /**
   * ACME-21's first plan (T-136): its made choice and the option chosen, its choice still to make, how many
   * options each has, the remembered keys of the made choice's Compare and of a plan section, less its name, the
   * open choice's recommended option and the message acc sends once it's recorded, and the plan with it made.
   */
  choices: { made: string; chosen: string; open: string; madeOptions: number; openOptions: number; compare: string; section: string; pick: string; done: Record<string, unknown>; allMade: Model };
  /**
   * Talk it through on ACME-21's approved plan (T-98): its page's model, what Use this asks first, the name
   * Use this is read out by, the message Change it sends, and the message Ctrl+Enter sends with the words typed.
   */
  talk: { model: Model; ask: string; use: string; sent: Record<string, unknown>; words: string; send: Record<string, unknown> };
  /**
   * A plan that starts with a conversation (T-111): the question the panel asks first, the words typed and the
   * message they send, the panel with the agent's reply and the reply's words, the message Draft the plan sends,
   * and ACME-21's page before its plan with the conversation's line.
   */
  conversation: { ask: string; words: string; send: Record<string, unknown>; reply: Model; replyText: string; draft: Record<string, unknown>; ticket: Model; line: string };
  /**
   * The agent's questions one at a time (T-113): the panel with its three questions waiting, each question's
   * words, the words typed for the last, and the one message every answer goes in.
   */
  questions: { model: Model; asked: string[]; own: string; sent: Record<string, unknown> };
  /**
   * Report a problem (T-118): the words typed in each box, the line taken out of what's attached, the message
   * Post sends then and the issue text the preview shows, and the draft once GitHub's account can't reach the repo.
   */
  report: { title: string; happened: string; expected: string; cut: string; sent: Record<string, unknown>; text: string; noAccess: Model };
  /**
   * Review plan on ACME-21 (T-109): its title, what Enter on the first step's suggestion sends, what the fourth
   * step's third option sends, the page's model with nothing left for the person, and what Approve then sends.
   */
  planReview: { title: string; answer: Record<string, unknown>; choose: Record<string, unknown>; ready: Model; approve: Record<string, unknown> };
  /**
   * A run in the output panel as rows (T-64), over the Tasks board: the runs message that opens the panel on it;
   * its state, name and time; each row's words in order; its command; how many of its paths are outside its
   * folder; its result card's sentence, last error and exit code; and what Copy log, its first path chip and the
   * result card's button send.
   */
  run: { runs: Record<string, unknown>; look: string; label: string; took: string; rows: string[]; command: string; off: number; sentence: string; error: string; exit: string; copy: Record<string, unknown>; chip: Record<string, unknown>; next: Record<string, unknown> };
  steps: { runs: Record<string, unknown>; labels: string[]; failed: string; note: string; stepRows: string[]; rows: string[]; fold: string; open: string; sentence: string };
  keys: {
    first: string; down: string; last: string; right: string;
    move: { card: string; to: string; lanes: string[]; sent: Record<string, unknown>; moving: string; moved: string; stays: string };
    moved: Model;
    stuck: { card: string; model: Model; says: string };
  };
  /** Ten boards on three Jira sites (T-127): the Tasks tab's model, what's typed to find a site's boards, what it finds, and the board Enter then shows. */
  boards: { model: Model; typed: string; found: string[]; picked: string; id: string };
  /** What the person filter's cases expect (T-79): the Jira board's key, one person with cards in two columns, the arrows through them, a card hidden by it, and the header's words. */
  people: { board: string; person: string; choice: string; first: string; down: string; right: string; hidden: string; labels: string[]; header: string; mine: string; everyone: string };
}

/** What the page asks the extension for, what the extension sends back, and how many rows then show. */
export interface Exchange { asked: Record<string, unknown>; reply: Record<string, unknown>; rows: number }

/** One case: its name, the page it opens, and what it does there. */
export interface Case {
  name: string;
  page: 'tasks' | 'overview-landing' | 'overview-since' | 'overview-pages' | 'ticket-questions' | 'ticket-review' | 'settings-agents' | 'connect-start' | 'agent' | 'output-changes' | 'output-failed' | 'conversation-start' | 'ticket-conversation' | 'ticket-talk' | 'ticket-plan-needs-you' | 'report' | 'ticket-deploy-work' | 'ticket-deploy-deployed' | 'ticket-deploy-passed' | 'ticket-deploy-failed' | 'ticket-deploy-typed' | 'ticket-agent-failed' | 'ticket-blocked-wall';
  /** A tab rebuilt before its first model: its page holds the loading screen, and the tab remembers being scrolled this far down. */
  opening?: { scroll: number };
  run: (t: Probe) => Promise<void>;
}

/** The pages the cases open: the Tasks board, the Overview, and with Since you last looked, ACME-21's and ACME-19's task pages, Settings with two projects, the Connect page, an agent's page, and the Tasks board with a review, and with a failed run, in the output panel, the Overview with History of more than two pages, ACME-21's conversation as Make a plan opens it (T-111), and ACME-21's page before its plan, where Make a plan is clicked (T-112), and Report a problem's draft as it opens (T-118); ACME-12's Changes tab deployed once, and its deploy sheet passed, failed and asking Production's name (T-138); and ACME-12 blocked with a note recorded as one paragraph (T-146). */
export interface CaseModels { tasks: Model; overview: Model; since: Model; ticket: Model; review: Model; settings: Model; connect: Model; agent: Model; dock: Model; run: Model; pages: Model; conversation: Model; beforePlan: Model; talked: Model; needsYou: Model; report: Model; deployed: Model; passed: Model; failed: Model; typed: Model; work: Model; agentFailed: Model; wall: Model }

/** The model a case's page is drawn from. */
export const caseModel = (c: Case, models: CaseModels): Model => (c.page === 'tasks' ? models.tasks : c.page === 'ticket-questions' ? models.ticket : c.page === 'ticket-review' ? models.review : c.page === 'settings-agents' ? models.settings : c.page === 'connect-start' ? models.connect : c.page === 'agent' ? models.agent : c.page === 'overview-since' ? models.since : c.page === 'output-changes' ? models.dock : c.page === 'output-failed' ? models.run : c.page === 'overview-pages' ? models.pages : c.page === 'conversation-start' ? models.conversation : c.page === 'ticket-conversation' ? models.beforePlan : c.page === 'ticket-talk' ? models.talked : c.page === 'ticket-plan-needs-you' ? models.needsYou : c.page === 'report' ? models.report : c.page === 'ticket-deploy-work' ? models.work : c.page === 'ticket-deploy-deployed' ? models.deployed : c.page === 'ticket-deploy-passed' ? models.passed : c.page === 'ticket-deploy-failed' ? models.failed : c.page === 'ticket-deploy-typed' ? models.typed : c.page === 'ticket-agent-failed' ? models.agentFailed : c.page === 'ticket-blocked-wall' ? models.wall : models.overview);

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
    // A task's page, which is long enough to scroll at this size; the calm Overview isn't (T-36). With its content in
    // tabs (T-134) it shows one tab, so it scrolls less: 100 px is still well inside its range.
    page: 'ticket-questions',
    opening: { scroll: 100 },
    async run(t) {
      const main = document.scrollingElement as HTMLElement;
      t.check('the page scrolls at this size, so the scroll is worth checking', main.scrollHeight - main.clientHeight > 100, { scroll: main.scrollHeight, client: main.clientHeight });
      t.check('the first model replaced the loading screen', t.all('.opening').length === 0, t.all('.opening').length);
      t.check('the page is at the saved scroll', main.scrollTop === 100, { now: main.scrollTop });
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
    name: 'task modal: Activity draws a person\'s edit, with who made it and which fields (T-74)',
    page: 'tasks',
    async run(t) {
      const { dialog } = await openTask(t);
      const lines = t.all('.act-feed .act-item', dialog).map((l) => l.textContent ?? '');
      const edit = lines.find((l) => l.includes('edited its'));
      t.check('the edit is a line of the activity', !!edit, lines);
      t.check('it names the fields in words', !!edit && edit.includes('edited its notes for the builder'), edit);
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
      // Opened by a click on the question's line, not its Answer: focus goes back to the line's link, its title (T-59).
      const opener = t.find(`li > .lp-title[role="link"][data-opens="${CSS.escape(t.data.questionOpens)}"]`);
      const line = opener.closest('li')!;
      t.check('the line stays a list item, with no role of its own', !line.hasAttribute('role') && line.tabIndex === -1, line.getAttribute('role'));
      t.check('its link is named by its title first', opener.getAttribute('aria-label')?.startsWith(`${opener.textContent}, `) === true, opener.getAttribute('aria-label'));
      await t.click(t.find('.lp-state', line));
      const dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
      const body = t.find('.task-modal-body', dialog);
      await t.click(body);
      t.check('a click inside it leaves it open', dialog.open);
      await t.backdrop(dialog, true);
      t.check('a press inside released on the backdrop leaves it open', dialog.open);
      await t.backdrop(dialog);
      t.check('a click on the backdrop closes it', !dialog.open);
      t.check('focus goes back to the line\'s link', document.activeElement === opener, document.activeElement?.className);
    },
  },
  {
    name: 'detail modal: Enter on a line\'s link opens it, and Escape sends focus back to the link',
    page: 'overview-landing',
    async run(t) {
      // The line's keyboard path (T-59): its title is the link that takes focus, and Enter on it opens the line.
      const link = t.find(`li > .lp-title[role="link"][data-opens="${CSS.escape(t.data.questionOpens)}"]`);
      t.check('the link is in the tab order', link.tabIndex === 0, link.tabIndex);
      link.focus();
      t.check('nothing is open before the press', !document.querySelector('dialog.detail-modal[open]'));
      const enter = await press(t, link, 'Enter');
      const dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
      t.check('Enter opens the line over the Overview', dialog.open);
      t.check('the page takes the Enter', enter.defaultPrevented);
      t.check('focus moves into it', dialog.contains(document.activeElement), document.activeElement?.className);
      await t.escape(dialog);
      t.check('Escape closes it', !dialog.open);
      t.check('focus goes back to the line\'s link, not its Answer', document.activeElement === link, document.activeElement?.className);
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
    name: 'overview: History loads its next page as a person scrolls to its end, a filter asks for its own first page, and opening it at an entry on a later page loads the pages up to it',
    page: 'overview-pages',
    async run(t) {
      const h = t.data.history;
      await t.click(t.find('[data-overview-card="history"]'));
      let dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
      const rows = () => t.all<HTMLElement>('.history-feed > li', dialog);
      const end = () => t.find('.history-end', dialog).textContent;
      t.check('the first page shows', rows().length === h.first, rows().length);
      const days = t.all('section.history-day > h3.history-day-name', dialog).map((d) => d.textContent);
      t.check('each day under a line with its name, a heading', days.length >= 3 && days[0] === 'Today' && days[1] === 'Yesterday', days);
      t.check('nothing is asked for before the end comes near', t.sent('history-more').length === 0, t.sent('history-more'));
      const body = t.find<HTMLElement>('.task-modal-body', dialog);
      await t.scroll(body, 200);
      t.check('scrolled a little, with the end far off, it asks for nothing', t.sent('history-more').length === 0, t.sent('history-more'));
      await t.scroll(body, body.scrollHeight);
      t.check('near the end, it asks for the next page after its last row', JSON.stringify(t.sent('history-more').at(-1)) === JSON.stringify(h.next.asked), t.sent('history-more').at(-1));
      t.check('a quiet line says it\'s loading', end() === 'Loading…', end());
      await t.settle();
      t.check('it asks once while it waits', t.sent('history-more').length === 1, t.sent('history-more').length);
      await t.post(h.next.reply);
      t.check('the next page arrives under the first', rows().length === h.next.rows, rows().length);
      // A refresh with a new entry, scrolled part way down: it goes on top, and the row in view stays put.
      await t.scroll(body, 1500);
      const top = () => body.getBoundingClientRect().top;
      // In the layout's px: the modal may still be growing in as it opens, which scales what a box measures.
      const inBox = (r: HTMLElement) => (r.getBoundingClientRect().top - top()) / (body.getBoundingClientRect().height / body.offsetHeight);
      const seen = rows().find((r) => r.getBoundingClientRect().bottom > top())!;
      const was = inBox(seen);
      await t.post({ type: 'state', model: h.newer });
      const again = rows().find((r) => r.dataset.id === seen.dataset.id);
      t.check('a refresh adds its new entry on top, and keeps what was loaded', rows().length === h.next.rows + 1, rows().length);
      t.check('and the row in view stays where it was', !!again && Math.abs(inBox(again) - was) < 2, [seen.dataset.id, was, again && inBox(again)]);
      const commands = t.all<HTMLButtonElement>('.history-filters button', dialog).find((b) => b.textContent?.startsWith('Commands'));
      if (!commands) throw new Error('not found: the Commands filter');
      t.check('a filter\'s count is the newer model\'s, not the rows on the page', commands.querySelector('.count')?.textContent === String(h.count + 1), commands.textContent);
      await t.click(commands);
      t.check('a filter asks for its own first page', JSON.stringify(t.sent('history-more').at(-1)) === JSON.stringify(h.filter.asked), t.sent('history-more').at(-1));
      await t.post(h.filter.reply);
      t.check('and shows only its own', rows().length === h.filter.rows + 1 && rows().every((r) => r.classList.contains('history-run')), rows().map((r) => r.className));
      // Its 25 entries are all there are, so the end line says so (T-66 review).
      t.check('with all of them loaded, the end line says that\'s everything', /^That.s everything/.test(end() ?? ''), end());
      await t.escape(dialog);
      // Opened at an entry on a later page, as a tab rebuilt with History open at it is.
      t.remember({ detail: { kind: 'history', at: h.upTo.id } });
      // The browser sends a closed modal's close event a task later; on a busy machine it came after the tab
      // remembered History open again, and closed it before the model drew it (T-69). Sent here, it comes late every time.
      dialog.dispatchEvent(new Event('close'));
      await t.post({ type: 'state', model: t.model });
      dialog = t.find<HTMLDialogElement>('dialog.detail-modal');
      t.check('it opens', dialog.open);
      t.check('it asks for the pages up to the entry, under All', JSON.stringify(t.sent('history-more').at(-1)) === JSON.stringify(h.upTo.asked), t.sent('history-more').at(-1));
      await t.post(h.upTo.reply);
      t.check('the pages up to it arrive', rows().length === h.upTo.rows, rows().length);
      const at = t.find<HTMLElement>('.history-feed > li[data-at]', dialog);
      t.check('the entry is marked, with its detail open', at.dataset.id === h.upTo.id && !!at.querySelector<HTMLDetailsElement>('details')?.open, at.dataset.id);
      const box = t.find('.task-modal-body', dialog).getBoundingClientRect();
      const r = at.getBoundingClientRect();
      t.check('and scrolled into view', r.top >= box.top && r.bottom <= box.bottom, [r.top, r.bottom, box.top, box.bottom]);
    },
  },
  {
    name: 'overview: Since you last looked sits between Needs you and the cards, a line opens its task, and Clear takes the group off and asks the extension to forget it',
    page: 'overview-since',
    async run(t) {
      const group = t.find('[data-overview-group="since"]');
      const order = t.all('.home-main > *').map((e) => (e as HTMLElement).dataset.overviewGroup ?? e.className);
      t.check('between Needs you and the cards', JSON.stringify(order.slice(1, 4)) === JSON.stringify(['needs-you', 'since', 'lp-cards']), order);
      const heading = t.find<HTMLElement>(`h2[data-part="${CSS.escape(t.data.since.part)}"]`, group);
      t.check('headed with its title and count', heading.textContent === `${t.data.since.title}${t.data.since.tasks.length}`, heading.textContent);
      t.check('its heading takes focus, for Show to open it at', heading.tabIndex === -1);
      const lines = t.all('.lp-row', group);
      const keys = lines.map((l) => l.querySelector('.lp-key')?.textContent);
      t.check('a line for each notice, in order, with its task key', JSON.stringify(keys) === JSON.stringify(t.data.since.tasks), keys);
      t.check('each line has its state, an icon and a label', lines.every((l) => !!l.querySelector('.lp-state .codicon') && !!l.querySelector('.lp-state-text')?.textContent));
      await t.click(t.find('.lp-title', lines[0]));
      const asked = t.sent('task-modal-open').at(-1);
      t.check('a click on a line opens its task', JSON.stringify(asked) === JSON.stringify(t.data.since.open), asked);
      const clear = t.all<HTMLButtonElement>('button', group).find((b) => b.textContent?.trim() === 'Clear');
      if (!clear) throw new Error('not found: Clear on Since you last looked');
      await t.click(clear);
      t.check('Clear takes the group off', !document.querySelector('[data-overview-group="since"]'));
      const sent = t.sent('toolbar').at(-1);
      t.check('and asks the extension to forget the list', sent?.command === 'acc.since.clear', sent);
      t.check('focus goes to the page, not lost with the group', document.activeElement === document.querySelector('.home-main'), document.activeElement?.className);
      const home = t.model as unknown as { overview: Record<string, unknown> };
      await t.post({ type: 'state', model: { ...home, overview: { ...home.overview, since: null } } });
      t.check('the extension\'s next model draws none', !document.querySelector('[data-overview-group="since"]') && !!document.querySelector('[data-overview-card]'));
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
      t.check('the list has its heading, with its count', t.find('.an-part-name', box).textContent === `How the requirements read${t.data.wording.length}`, t.find('.an-part-name', box).textContent);
      const items = t.all('li', box);
      t.check('a line for each finding', items.length === t.data.wording.length && items.length > 0, { shown: items.length, expected: t.data.wording.length });
      for (const [i, f] of t.data.wording.entries()) {
        const text = items[i]?.textContent ?? '';
        t.check(`finding ${i + 1} shows its place, why, and its line`, text.startsWith(`${f.place}: ${f.message}`) && text.includes(f.text), text);
      }
    },
  },
  {
    name: 'task page: a Command Center section collapses and expands by click, Enter and Space, and stays collapsed when the page draws again, as Details does (T-132)',
    page: 'ticket-questions',
    async run(t) {
      const sec = (): HTMLElement => t.find('.ticket-main [data-section="plan"]');
      const button = (): HTMLButtonElement => t.find<HTMLButtonElement>('.sec-toggle', sec());
      const hidden = (): boolean => [...sec().children].filter((c) => !c.classList.contains('sec-head')).every((c) => getComputedStyle(c).display === 'none');
      const summary = (): HTMLElement => t.find('.sec-sum', sec());
      // Its heading is the plan's state (T-136): the tab already says Plan.
      t.check('it starts open, its button named for the plan\'s state and expanded', !hidden() && button().textContent === 'Plan v1: not approved yet' && button().getAttribute('aria-expanded') === 'true', button().outerHTML);
      t.check('open, its summary line isn\'t shown', getComputedStyle(summary()).display === 'none');
      t.check('it sits in the Plan tab\'s panel', sec().closest('[role="tabpanel"]')?.getAttribute('data-tab') === 'plan', sec().closest('[role="tabpanel"]')?.outerHTML.slice(0, 120));
      await t.click(button());
      t.check('a click collapses it to its header line', hidden() && button().getAttribute('aria-expanded') === 'false', button().getAttribute('aria-expanded'));
      t.check('collapsed, its state and summary stay in view', getComputedStyle(summary()).display !== 'none' && t.find('.sec-head .status', sec()).getBoundingClientRect().height > 0);
      t.check('focus stays on its button', document.activeElement === button(), document.activeElement?.className);
      const folded = (t.memory().folded ?? []) as string[];
      t.check('the tab remembers it, by ticket and section', folded.length === 1 && folded[0]!.startsWith('section:plan:') && folded[0]!.endsWith('#ACME-21'), folded);
      // Edge: the page drawn again from a new model keeps it collapsed.
      await t.post({ type: 'state', model: t.model });
      t.check('drawn again, it stays collapsed', hidden() && button().getAttribute('aria-expanded') === 'false', button().getAttribute('aria-expanded'));
      const enter = await press(t, button(), 'Enter');
      t.check('Enter expands it, and the button\'s own click doesn\'t follow', !hidden() && button().getAttribute('aria-expanded') === 'true' && enter.defaultPrevented);
      const space = await press(t, button(), ' ');
      t.check('Space collapses it again', hidden() && space.defaultPrevented);
      await t.click(button());
      t.check('a click expands it, and the tab forgets it', !hidden() && ((t.memory().folded ?? []) as string[]).length === 0, t.memory().folded);
      // The side column's Details folds the same way, and stays folded on the next draw.
      const details = (): HTMLElement => t.find('.ticket-side [data-section="details"]');
      await press(t, t.find<HTMLButtonElement>('.sec-toggle', details()), 'Enter');
      await t.post({ type: 'state', model: t.model });
      t.check('Enter collapses Details, and it stays collapsed', getComputedStyle(t.find('.details-list', details())).display === 'none' && t.find('.sec-toggle', details()).getAttribute('aria-expanded') === 'false');
    },
  },
  {
    name: 'task page: the Agent panel says its checks in one line naming what failed, and its Details folds shut and open by click and stays as left (T-142)',
    page: 'ticket-agent-failed',
    async run(t) {
      const panel = (): HTMLElement => t.find('.side-agent');
      const details = (): HTMLDetailsElement => t.find<HTMLDetailsElement>('.agent-details', panel());
      const check = (): HTMLElement => t.find('.agent-details .check', panel());
      const key = (): boolean => ((t.memory().opened ?? []) as string[]).some((k) => k.startsWith('agent-details:') && k.endsWith('#ACME-19'));
      t.check('its checks are one line that names the failed one', t.find('.agent-checks', panel()).textContent?.includes('1 failed: static') === true, t.find('.agent-checks', panel()).textContent);
      t.check('Details starts closed, its checks out of view and nothing remembered', !details().open && !check().checkVisibility() && !key(), details().open);
      await t.click(t.find('summary', details()));
      t.check('a click opens Details, its checks show, and the tab remembers it', details().open && check().checkVisibility() && key(), t.memory().opened);
      // Edge: drawn again from a new model, it stays open.
      await t.post({ type: 'state', model: t.model });
      t.check('drawn again, Details stays open', details().open);
      await t.click(t.find('summary', details()));
      t.check('a click shuts it again, and the tab forgets it', !details().open && !key(), t.memory().opened);
      const more = t.find<HTMLDetailsElement>('.agent-more', panel());
      t.check('More actions starts closed, holding the actions the panel doesn\'t show first', !more.open && more.querySelectorAll('.ta-btn').length > 0);
    },
  },
  {
    name: 'task page: a blocked note recorded as one paragraph is drawn as a headline, a bullet per thing, each option on its own line, and code (T-146)',
    page: 'ticket-blocked-wall',
    async run(t) {
      const notice = (): HTMLElement => t.find('.ticket-top .notice.why');
      const items = (): HTMLElement[] => t.all('.note-item', notice());
      t.check('its headline comes first, alone', t.find('.note-head', notice()).textContent === 'Why it\'s blocked: Plan v2 contradicts itself, so nothing can land without a person\'s choice.', notice().querySelector('.note-head')?.textContent);
      t.check('a bullet per thing: its three', items().length === 3 && items().every((i) => i.getBoundingClientRect().height > 0), items().length);
      const tops = t.all('.note-option', items()[0]).map((o) => Math.round(o.getBoundingClientRect().top));
      t.check('each option on its own line', tops.length === 2 && tops[1]! > tops[0]!, tops);
      t.check('the one recommended says so, in words with its icon', t.all('.note-rec', notice()).length === 2 && t.find('.note-rec', notice()).textContent === 'Recommended' && t.find('.note-rec .codicon-star-full', notice()) !== null);
      const code = t.all('code', notice()).map((c) => c.textContent);
      t.check('API names recorded bare are drawn as code', code.includes('Deal_Territory__c') && code.includes('Territory_Record_Page.flexipage-meta.xml'), code);
      // Edge: drawn again from a new model, it is still a list.
      await t.post({ type: 'state', model: t.model });
      t.check('drawn again, still a list', items().length === 3);
    },
  },
  {
    name: 'task page: its tabs open on the plan that needs you, say so in words, move by arrow keys, Home and End, and follow a link (T-134)',
    page: 'ticket-plan-needs-you',
    async run(t) {
      const tabs = (): HTMLButtonElement[] => t.all<HTMLButtonElement>('[role="tab"]');
      const tab = (id: string): HTMLButtonElement => t.find<HTMLButtonElement>(`[role="tab"][data-tab="${id}"]`);
      const on = (): string | null => tabs().find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab ?? null;
      const visible = (): string[] => t.all('[role="tabpanel"]').filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.dataset.tab!);
      t.check('the tab row is a tablist of the shown tabs', t.find('[role="tablist"]').children.length === tabs().length && tabs().length >= 2, tabs().map((b) => b.dataset.tab));
      t.check('it opens on Plan, which needs the person', on() === 'plan' && visible().join() === 'plan', { on: on(), visible: visible() });
      const needs = t.find('.task-tab-needs', tab('plan'));
      t.check('Plan says it needs you in words, with an icon, in view', needs.textContent === 'needs you' && needs.querySelector('.codicon-bell') !== null && needs.getBoundingClientRect().width > 0, needs.outerHTML);
      t.check('its name, its visible words, says so to a screen reader', !tab('plan').hasAttribute('aria-label') && /^Plan\s*needs you$/.test(tab('plan').innerText.trim()), tab('plan').innerText);
      t.check('each panel is named by its tab', t.all('[role="tabpanel"]').every((p) => document.getElementById(p.getAttribute('aria-labelledby') ?? '')?.getAttribute('aria-controls') === p.id));
      tab('plan').focus();
      await press(t, tab('plan'), 'ArrowRight');
      t.check('ArrowRight moves to the next tab, focus with it', on() !== 'plan' && document.activeElement === tab(on()!) && visible().join() === on(), { on: on(), visible: visible() });
      await press(t, tab(on()!), 'Home');
      t.check('Home goes to the first tab', on() === tabs()[0]!.dataset.tab, on());
      await press(t, tab(on()!), 'ArrowLeft');
      t.check('ArrowLeft from the first wraps to the last', on() === tabs().at(-1)!.dataset.tab, on());
      await press(t, tab(on()!), 'End');
      t.check('End stays on the last', on() === tabs().at(-1)!.dataset.tab);
      await t.click(tab('ticket'));
      t.check('a click shows Ticket, with its description and activity', on() === 'ticket' && visible().join() === 'ticket' && t.find('[role="tabpanel"][data-tab="ticket"] .activity').getBoundingClientRect().height > 0);
      const tabsMem = (t.memory().tabs ?? {}) as Record<string, string>;
      t.check('the tab remembers it for this ticket', Object.entries(tabsMem).some(([k, v]) => k.endsWith('#ACME-21') && v === 'ticket'), tabsMem);
      // Edge: the page drawn again from a new model keeps the tab on show, though Plan still needs the person.
      await t.post({ type: 'state', model: t.model });
      t.check('drawn again, it stays on Ticket', on() === 'ticket', on());
      // A link that names the plan, as Needs you sends it: Plan opens.
      await t.post({ type: 'state', model: { ...t.model, open: { part: 'plan', at: Date.now() } } });
      t.check('a link to the plan opens Plan', on() === 'plan' && visible().join() === 'plan', on());
      // A section still collapses inside its tab.
      const plan = t.find('[role="tabpanel"][data-tab="plan"] [data-section="plan"]');
      await t.click(t.find<HTMLButtonElement>('.sec-toggle', plan));
      t.check('the plan section collapses inside its tab', plan.classList.contains('collapsed'));
    },
  },
  {
    name: 'plan: on an approved plan, Choose this asks first; Keep the approval and Escape send nothing and focus goes back, and Change it sends the choice with its yes (T-97)',
    page: 'ticket-questions',
    async run(t) {
      const d = t.data.plan;
      // Choices open, and the made choice's options open to compare (T-136), as the tab remembers them.
      t.remember({ opened: d.opened });
      await t.post({ type: 'state', model: d.model });
      const named = (label: string): HTMLButtonElement => {
        const b = t.all<HTMLButtonElement>('button').find((x) => x.getAttribute('aria-label') === label);
        if (!b) throw new Error(`not found: ${label}`);
        return b;
      };
      const inDialog = (label: string): HTMLButtonElement => {
        const b = t.all<HTMLButtonElement>('button', t.find('[role="alertdialog"]')).find((x) => x.textContent?.trim() === label);
        if (!b) throw new Error(`not found: the dialog's ${label}`);
        return b;
      };
      await t.click(named(d.keep));
      t.check('nothing goes before the person says', t.sent('plan-choose').length === 0, t.sent('plan-choose'));
      const box = t.find('[role="alertdialog"]');
      t.check('the dialog says a change undoes the approval', box.textContent?.includes(d.ask) === true, box.textContent);
      t.check('focus is on Keep the approval', document.activeElement === inDialog('Keep the approval'), document.activeElement?.textContent);
      await t.click(inDialog('Keep the approval'));
      t.check('Keep the approval closes it, and sends nothing', t.all('[role="alertdialog"]').length === 0 && t.sent('plan-choose').length === 0, t.sent('plan-choose'));
      t.check('focus goes back to the Choose this that asked', document.activeElement === named(d.keep), document.activeElement?.getAttribute('aria-label'));
      // Edge: Escape, from the dialog's button, keeps the approval too.
      await t.click(named(d.keep));
      await press(t, document.activeElement as HTMLElement, 'Escape');
      t.check('Escape closes it, and sends nothing', t.all('[role="alertdialog"]').length === 0 && t.sent('plan-choose').length === 0, t.sent('plan-choose'));
      await t.click(named(d.change));
      await t.click(inDialog('Change it'));
      const sent = t.sent('plan-choose');
      t.check('Change it sends the choice once, with its yes', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.sent), sent);
      t.check('and the dialog has gone', t.all('[role="alertdialog"]').length === 0);
    },
  },
  {
    name: 'plan tab: a made choice is one line with Compare the options, and Choices and Questions open by themselves while they wait on the person; the other sections start closed, and a section closed stays so (T-136)',
    page: 'ticket-questions',
    async run(t) {
      const d = t.data.choices;
      t.remember({ opened: [] });
      await t.post({ type: 'state', model: t.model });
      const part = (id: string): HTMLDetailsElement => t.find<HTMLDetailsElement>(`.plan-tab .an-sec[data-part="${id}"]`);
      const group = (id: string): HTMLElement => t.find(`.plan-decision[aria-label^="Choice ${id}:"]`);
      const cards = (id: string): number => t.all('.plan-option', group(id)).filter((c) => c.getBoundingClientRect().height > 0).length;
      const chosen = (id: string): number => (group(id).textContent?.match(/Chosen/g) ?? []).length;
      t.check('Choices opens by itself, as a choice in it waits on the person', part('choices').open);
      t.check('so do Questions', part('questions').open);
      t.check('the other sections start closed', ['approach', 'criteria', 'risks', 'more'].every((id) => !part(id).open), ['approach', 'criteria', 'risks', 'more'].map((id) => [id, part(id).open]));
      t.check('the choice still to make shows its cards side by side', cards(d.open) === d.openOptions, cards(d.open));
      t.check('the made choice is one line, with no cards', cards(d.made) === 0 && !!group(d.made).querySelector('.pd-line'), cards(d.made));
      t.check('its line names the option chosen, and says Chosen once', group(d.made).textContent?.includes(d.chosen) === true && chosen(d.made) === 1, group(d.made).textContent);
      const compare = (): HTMLButtonElement => t.find<HTMLButtonElement>('.pd-compare', group(d.made));
      t.check('its button offers to compare the options', compare().textContent?.trim() === `Compare the ${d.madeOptions} options` && compare().getAttribute('aria-expanded') === 'false', compare().textContent);
      await t.click(compare());
      t.check('Compare draws its cards side by side', cards(d.made) === d.madeOptions, cards(d.made));
      t.check('still saying Chosen once, on the card chosen', chosen(d.made) === 1 && t.all('.plan-option.chosen .po-chosen', group(d.made)).length === 1, group(d.made).textContent);
      t.check('the tab remembers it', ((t.memory().opened ?? []) as string[]).includes(d.compare), t.memory().opened);
      await t.post({ type: 'state', model: t.model });
      t.check('drawn again, it stays compared', cards(d.made) === d.madeOptions, cards(d.made));
      await t.click(compare());
      t.check('Hide the options folds it back to its line', cards(d.made) === 0 && compare().getAttribute('aria-expanded') === 'false', cards(d.made));
      // Edge: the last choice made in a Choices that opened by itself; acc records it and the page draws again.
      await t.click(t.find(`[aria-label="${d.pick}"]`, group(d.open)));
      await t.post(d.done);
      await t.post({ type: 'state', model: d.allMade });
      t.check('the last choice made, it is a line too', !!group(d.open).querySelector('.pd-line'), group(d.open).textContent);
      t.check('and Choices stays open under the person, though nothing in it waits now', part('choices').open, t.memory().opened);
      await t.post({ type: 'state', model: t.model });
      // Edge: a section that waits on the person, closed by them, stays closed when the page draws again.
      await t.click(t.find('summary', part('choices')));
      await t.post({ type: 'state', model: t.model });
      t.check('Choices closed by the person stays closed, though a choice in it waits', !part('choices').open, ((t.memory().opened ?? []) as string[]).filter((k) => k.startsWith(d.section)));
      await t.click(t.find('summary', part('approach')));
      await t.post({ type: 'state', model: t.model });
      t.check('The approach opened stays open', part('approach').open && ((t.memory().opened ?? []) as string[]).includes(`${d.section}approach`), t.memory().opened);
    },
  },
  {
    name: 'review plan: Enter confirms and goes on, a number key and the arrows pick, Escape and Back keep the pick, Skip marks a step, and the summary approves once nothing is left (T-109)',
    page: 'ticket-questions',
    async run(t) {
      const d = t.data.planReview;
      await t.click(t.find('.plan-actions .rp-open'));
      const dialog = t.find<HTMLDialogElement>('dialog.review-plan');
      const at = () => t.find('.rp-step', dialog).dataset.step;
      const picked = () => t.find('[role="radio"][aria-checked="true"]', dialog).dataset.pick;
      const focused = () => document.activeElement as HTMLElement;
      const footButton = (label: string): HTMLButtonElement => {
        const b = t.all<HTMLButtonElement>('.rp-foot button', dialog).find((x) => x.textContent?.trim() === label);
        if (!b) throw new Error(`not found: the sheet's ${label}`);
        return b;
      };
      t.check('Review plan opens a dialog named for its plan', dialog.open && dialog.getAttribute('aria-label') === d.title, dialog.getAttribute('aria-label'));
      t.check('its options are a radio group named by its question', t.find('[role="radiogroup"]', dialog).getAttribute('aria-labelledby') === t.find('.rp-q', dialog).id);
      t.check('focus starts on the first option', focused().getAttribute('role') === 'radio' && focused().dataset.pick === 'suggested', focused().outerHTML.slice(0, 80));
      await press(t, focused(), 'Enter');
      const answers = t.sent('analysis-answer');
      t.check('Enter confirms: the suggestion goes once, as an answer', answers.length === 1 && JSON.stringify(answers[0]) === JSON.stringify(d.answer), answers);
      t.check('and it goes on to the next step', at() === 'q3' && t.find('.rp-place', dialog).textContent === '2 of 5', [at(), t.find('.rp-place', dialog).textContent]);
      await t.click(footButton('Next'));
      t.check('an answered question goes on with Next', at() === 'd1', at());
      await press(t, focused(), '2');
      t.check('a number key picks its option, and focus goes with it', picked() === 'b' && focused().dataset.pick === 'b', [picked(), focused().dataset.pick]);
      await press(t, focused(), 'ArrowDown');
      t.check('Down moves to the next option, Something else…', picked() === 'own' && focused().dataset.pick === 'own', picked());
      await press(t, focused(), 'ArrowUp');
      t.check('Up moves back', picked() === 'b', picked());
      t.check('nothing is sent while picking', t.sent('plan-choose').length === 0, t.sent('plan-choose'));
      // Edge: Escape mid-step closes it, sends nothing, and keeps the step and its pick for the next open.
      await t.escape(dialog);
      t.check('Escape mid-step closes it and sends nothing', !dialog.open && t.sent('plan-choose').length === 0, t.sent('plan-choose'));
      // Opened again, it starts at the first step not done; the choice's dot goes back to it, its pick still there.
      await t.click(t.find('.plan-actions .rp-open'));
      t.check('it opens again', dialog.open, dialog.open);
      await t.click(t.all<HTMLButtonElement>('.rp-dot', dialog)[2]!);
      t.check('the pick made before Escape is kept', at() === 'd1' && picked() === 'b', [at(), picked()]);
      await t.click(footButton('Back'));
      t.check('Back goes to the step before', at() === 'q3', at());
      await t.click(footButton('Next'));
      t.check('Back kept the pick made in the step it left', at() === 'd1' && picked() === 'b', [at(), picked()]);
      await press(t, focused(), '1');
      await press(t, focused(), 'Enter');
      t.check('Enter on what is already chosen sends nothing, and goes on', at() === 'd2' && t.sent('plan-choose').length === 0, [at(), t.sent('plan-choose')]);
      await press(t, focused(), '3');
      await press(t, focused(), 'Enter');
      const chosen = t.sent('plan-choose');
      t.check('a number key then Enter sends that choice once', chosen.length === 1 && JSON.stringify(chosen[0]) === JSON.stringify(d.choose), chosen);
      t.check('and goes on to the last step', at() === 'q2', at());
      await t.click(footButton('Skip for now'));
      t.check('Skip for now goes on to the summary, sending nothing', at() === 'summary' && t.sent('update-ask').length === 0 && t.sent('analysis-answer').length === 1, at());
      const dots = t.all('.rp-dot', dialog);
      t.check('its dot says it was skipped', dots.at(-1)?.classList.contains('skipped') === true && dots.at(-1)?.getAttribute('aria-label')?.endsWith(': skipped') === true, dots.at(-1)?.getAttribute('aria-label'));
      t.check('its summary line says so', t.all('.rp-sum-value', dialog).at(-1)?.textContent === 'Skipped', t.all('.rp-sum-value', dialog).map((x) => x.textContent));
      const off = footButton('Approve this plan');
      t.check('Approve is off while something for the person is left, and says why', off.disabled && !!off.title && t.find('.rp-foot .plan-why', dialog).textContent?.includes(off.title) === true, [off.disabled, off.title]);
      await t.click(off);
      t.check('and a click on it sends nothing', t.sent('plan-approve').length === 0);
      await t.post({ type: 'state', model: d.ready });
      t.check('a new model leaves the sheet open at the summary', dialog.open && at() === 'summary', at());
      const on = footButton('Approve this plan');
      t.check('with nothing left, Approve is on', !on.disabled, on.title);
      await t.click(on);
      const approved = t.sent('plan-approve');
      t.check('and sends the approval once', approved.length === 1 && JSON.stringify(approved[0]) === JSON.stringify(d.approve), approved);
      await t.escape(dialog);
      t.check('Escape closes it, and focus goes back to Review plan', !dialog.open && focused().classList.contains('rp-open'), focused().className);
    },
  },
  {
    name: 'talk: on an approved plan, Use this asks first; Escape sends nothing and focus goes back to Use this, Change it sends it with its yes, and Ctrl+Enter sends a message but Enter alone doesn\'t (T-98)',
    page: 'conversation-start',
    async run(t) {
      const d = t.data.talk;
      await t.post({ type: 'state', model: d.model });
      const use = (): HTMLButtonElement => {
        const b = t.all<HTMLButtonElement>('button').find((x) => x.getAttribute('aria-label') === d.use);
        if (!b) throw new Error(`not found: ${d.use}`);
        return b;
      };
      const inDialog = (label: string): HTMLButtonElement => {
        const b = t.all<HTMLButtonElement>('button', t.find('#talk [role="alertdialog"]')).find((x) => x.textContent?.trim() === label);
        if (!b) throw new Error(`not found: the dialog's ${label}`);
        return b;
      };
      await t.click(use());
      t.check('nothing goes before the person says', t.sent('talk-use').length === 0, t.sent('talk-use'));
      const box = t.find('#talk [role="alertdialog"]');
      t.check('it says the change undoes the approval', box.textContent?.includes(d.ask) === true, box.textContent);
      t.check('focus is on Keep the approval', document.activeElement === inDialog('Keep the approval'), document.activeElement?.textContent);
      await press(t, document.activeElement as HTMLElement, 'Escape');
      t.check('Escape closes it, and sends nothing', t.all('#talk [role="alertdialog"]').length === 0 && t.sent('talk-use').length === 0, t.sent('talk-use'));
      t.check('focus goes back to Use this', document.activeElement === use(), document.activeElement?.getAttribute('aria-label'));
      await t.click(use());
      await t.click(inDialog('Change it'));
      const sent = t.sent('talk-use');
      t.check('Change it sends the proposal once, with its yes', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.sent), sent);
      // The message box: Enter alone is a new line; Ctrl+Enter sends.
      const text = t.find<HTMLTextAreaElement>('#talk textarea.talk-box');
      text.focus();
      text.value = d.words;
      text.dispatchEvent(new Event('input', { bubbles: true }));
      await press(t, text, 'Enter');
      t.check('Enter alone sends nothing', t.sent('talk-send').length === 0, t.sent('talk-send'));
      text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      await t.settle();
      const said = t.sent('talk-send');
      t.check('Ctrl+Enter sends the words once', said.length === 1 && JSON.stringify(said[0]) === JSON.stringify(d.send), said);
    },
  },
  {
    name: 'conversation: the panel opens at its question with the cursor in the box; Ctrl+Enter sends a message, the reply shows with its questions, and Draft the plan asks for the plan made with the conversation (T-111)',
    page: 'conversation-start',
    async run(t) {
      const d = t.data.conversation;
      t.check('it asks its question first', t.find('.talk-ask').textContent?.trim() === d.ask, t.find('.talk-ask').textContent);
      const box = t.find<HTMLTextAreaElement>('textarea.talk-box');
      await t.settle();
      t.check('the cursor is in the box', document.activeElement === box, document.activeElement?.className);
      const draft = (): HTMLButtonElement => {
        const b = t.all<HTMLButtonElement>('button').find((x) => x.textContent?.trim() === 'Draft the plan');
        if (!b) throw new Error('not found: Draft the plan');
        return b;
      };
      t.check('Draft the plan is off until something is said', draft().disabled, draft().title);
      await t.type(box, d.words);
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      await t.settle();
      const said = t.sent('talk-send');
      t.check('Ctrl+Enter sends the words once', said.length === 1 && JSON.stringify(said[0]) === JSON.stringify(d.send), said);
      await t.post({ type: 'talk-done', action: 'talk-send', project: d.send.project, task: d.send.task, ok: true });
      await t.post({ type: 'state', model: d.reply });
      const agent = t.all('.talk-turn.who-agent');
      t.check('the agent\'s reply shows', agent.some((x) => x.textContent?.includes(d.replyText) === true), agent.map((x) => x.textContent));
      t.check('with no questions waiting, there is no question card', t.all('.talk-card').length === 0, t.all('.talk-card').length);
      t.check('and Draft the plan is on', !draft().disabled, draft().title);
      await t.click(draft());
      const sent = t.sent('conversation-draft');
      t.check('Draft the plan asks once for the plan made with the conversation', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.draft), sent);
    },
  },
  {
    name: 'questions: the agent\'s three questions show one at a time; a number key picks and it counts, a dot or Back moves keeping it, Enter goes on, Skip marks one, Escape keeps the picks, and only Send on the review sends every answer in one message (T-113, T-130)',
    page: 'conversation-start',
    async run(t) {
      const d = t.data.questions;
      await t.post({ type: 'state', model: d.model });
      const card = () => t.find('.talk-card');
      const place = () => t.find('.rp-place', card()).textContent;
      const picked = () => t.find('[role="radio"][aria-checked="true"]', card()).dataset.pick;
      const asked = () => t.find('.rp-q', card()).textContent?.trim();
      const foot = (label: string): HTMLButtonElement => {
        const b = t.all<HTMLButtonElement>('.talk-card-foot button', card()).find((x) => x.textContent?.trim() === label);
        if (!b) throw new Error(`not found: the card's ${label}`);
        return b;
      };
      const answers = () => t.sent('talk-answers');
      t.check('one question shows, the first, of three', t.all('.talk-card .rp-step').length === 1 && t.all('[role="radiogroup"]').length === 1 && place() === 'Question 1 of 3' && asked() === d.asked[0], [t.all('.talk-card .rp-step').length, place(), asked()]);
      t.check('the others aren\'t on the page', !d.asked.slice(1).some((q) => document.body.textContent?.includes(q)), d.asked.slice(1));
      t.check('the suggestion is first, marked Suggested, and picked', picked() === 'o0' && t.find('.rp-option.on .rp-rec', card()).textContent?.trim() === 'Suggested', picked());
      const dots = () => t.all<HTMLButtonElement>('.rp-dot', card());
      t.check('no Confirm: Back, Skip and Next question, with an arrow', t.all('.talk-card-foot button', card()).every((b) => !/Confirm/.test(b.textContent ?? '')) && foot('Next question').querySelector('.codicon-arrow-right') !== null, t.all('.talk-card-foot button', card()).map((b) => b.textContent?.trim()));
      await press(t, t.find('[role="radio"][aria-checked="true"]', card()), '2');
      t.check('a number key picks its answer, and focus goes with it', picked() === 'o1' && (document.activeElement as HTMLElement).dataset.pick === 'o1', picked());
      // A dot moves without losing the answer (T-130): to the last and back, the first's pick is still there and counts.
      await t.click(dots()[2]!);
      t.check('a dot moves, sending nothing', place() === 'Question 3 of 3' && answers().length === 0, [place(), answers()]);
      t.check('the first dot says answered, its tooltip the question', dots()[0]?.getAttribute('aria-label') === 'Question 1: answered' && dots()[0]?.title === d.asked[0] && dots()[0]?.classList.contains('done') === true, [dots()[0]?.getAttribute('aria-label'), dots()[0]?.title]);
      t.check('edge: the second, passed by without a touch, is not answered yet', dots()[1]?.getAttribute('aria-label') === 'Question 2: not answered yet', dots()[1]?.getAttribute('aria-label'));
      await t.click(dots()[0]!);
      t.check('back by its dot, the first\'s pick is kept', place() === 'Question 1 of 3' && picked() === 'o1', [place(), picked()]);
      await press(t, t.find('[role="radio"][aria-checked="true"]', card()), 'Enter');
      t.check('Enter goes on to the second question', place() === 'Question 2 of 3' && asked() === d.asked[1], [place(), asked()]);
      t.check('and nothing is sent', answers().length === 0 && t.sent('talk-send').length === 0, answers());
      await t.click(foot('Back'));
      t.check('Back goes to the first question, its pick kept', place() === 'Question 1 of 3' && picked() === 'o1', [place(), picked()]);
      await t.click(foot('Next question'));
      await t.click(foot('Skip'));
      t.check('Skip goes on to the last, sending nothing', place() === 'Question 3 of 3' && answers().length === 0, [place(), answers()]);
      t.check('the skipped one\'s dot says so', dots()[1]?.classList.contains('skipped') === true && dots()[1]?.getAttribute('aria-label') === 'Question 2: skipped', dots()[1]?.getAttribute('aria-label'));
      await press(t, t.find('[role="radio"][aria-checked="true"]', card()), '3');
      t.check('the last number is Answer in my own words, with its box', picked() === 'own' && t.all('.rp-own input', card()).length === 1, picked());
      // Edge: Escape puts the questions aside and keeps the picks; Answer the questions brings them back where they were.
      await press(t, t.find('[role="radio"][aria-checked="true"]', card()), 'Escape');
      t.check('Escape puts them aside as one line, sending nothing', t.all('.talk-card').length === 0 && t.all('.talk-card-aside').length === 1 && answers().length === 0, t.all('.talk-card-aside').length);
      const back = t.all<HTMLButtonElement>('.talk-card-aside button').find((x) => x.textContent?.trim() === 'Answer the questions');
      if (!back) throw new Error('not found: Answer the questions');
      await t.click(back);
      t.check('Answer the questions comes back at the last, its pick kept', place() === 'Question 3 of 3' && picked() === 'own', [place(), picked()]);
      t.check('on the last, Next question is Review answers', !foot('Review answers').disabled, foot('Review answers').title);
      const box = t.find<HTMLInputElement>('.rp-own input', card());
      await t.type(box, d.own);
      await press(t, box, 'Enter');
      t.check('Enter in the box goes on to the review, sending nothing', place() === 'Review your answers' && answers().length === 0, [place(), answers()]);
      const rows = t.all('.talk-review-row', card());
      t.check('the review lists every question, the skipped one Not answered, each with Change', rows.length === 3 && rows[1]!.textContent?.includes('Not answered: the planning agent decides') === true && rows.every((r) => r.querySelector('button')?.textContent?.trim() === 'Change'), rows.map((r) => r.textContent));
      await press(t, t.find('.talk-review', card()), 'Enter');
      t.check('edge: Enter on the review, away from Send, sends nothing', answers().length === 0, answers());
      await t.click(foot('Send answers to the planning agent'));
      const sent = answers();
      t.check('Send answers to the planning agent sends every answer once, in one message', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.sent) && t.sent('talk-send').length === 0, sent);
    },
  },
  {
    // The panel is a document of its own (data-view="conversation"), so this case ends where the page does: at what
    // the page asks of the extension, which opens the panel beside the ticket (extension/test/conversation-panel.test.ts).
    name: 'conversation: Make a plan on the task page, before its plan, asks the extension for it once, for that task (T-112)',
    page: 'ticket-conversation',
    async run(t) {
      const page = t.data.conversation.ticket as { project: string; key: string };
      const make = t.all<HTMLButtonElement>('button').filter((x) => x.textContent?.trim() === 'Make a plan');
      t.check('the page has one Make a plan', make.length === 1, make.length);
      await t.click(make[0]!);
      const sent = t.sent('run').filter((x) => x.command === 'acc.task.analyze');
      const ref = sent[0]?.ref as { project?: string; task?: string } | undefined;
      t.check('Make a plan asks once, for this task', sent.length === 1 && ref?.project === page.project && ref?.task === page.key, sent);
    },
  },
  {
    name: 'conversation: the task page shows its conversation as one line with Open conversation, never its turns, and Open conversation asks for the panel (T-111)',
    page: 'ticket-questions',
    async run(t) {
      const d = t.data.conversation;
      await t.post({ type: 'state', model: d.ticket });
      const lines = t.all('.convo-line');
      t.check('one line, with how many messages', lines.length === 1 && lines[0]!.textContent?.includes(d.line) === true, lines.map((x) => x.textContent));
      t.check('no turn and no message box on the page', t.all('.talk-turn').length === 0 && t.all('textarea.talk-box').length === 0, t.all('.talk-turn').length);
      const open = t.all<HTMLButtonElement>('button', lines[0]).find((x) => x.textContent?.trim() === 'Open conversation');
      if (!open) throw new Error('not found: Open conversation');
      await t.click(open);
      const sent = t.sent('conversation-open');
      const page = d.ticket as { project: string; key: string };
      t.check('Open conversation asks for the panel once', sent.length === 1 && sent[0]!.project === page.project && sent[0]!.task === page.key && sent[0]!.about === undefined, sent);
    },
  },
  {
    name: 'report: nothing is sent while the draft is written; Post is off until a title and what happened are typed, then sends the issue as the preview shows it, with what was taken out of what\'s attached left out; where it can\'t go, Copy the issue text copies the same (T-118)',
    page: 'report',
    async run(t) {
      const d = t.data.report;
      const post = (): HTMLButtonElement => {
        const b = t.all<HTMLButtonElement>('button').find((x) => x.textContent?.trim() === 'Post to GitHub');
        if (!b) throw new Error('not found: Post to GitHub');
        return b;
      };
      t.check('Post is off with no title, and says why', post().disabled && post().title === 'Give it a title', post().title);
      await t.type(t.find<HTMLInputElement>('#report-title'), d.title);
      t.check('then off until what happened is said', post().disabled && post().title === 'Say what happened', post().title);
      await t.type(t.find<HTMLTextAreaElement>('#report-what-happened'), d.happened);
      await t.type(t.find<HTMLTextAreaElement>('#report-expected'), d.expected);
      const attached = t.find<HTMLTextAreaElement>('#report-attached');
      await t.type(attached, attached.value.split('\n').filter((l) => l !== d.cut).join('\n'));
      await t.settle();
      t.check('nothing is sent while the draft is written', t.sent('report-post').length === 0 && t.sent('report-copy').length === 0, t.sent('report-post'));
      t.check('the preview shows the issue as it will be posted', t.find('.report-preview').textContent === d.text, t.find('.report-preview').textContent);
      t.check('and Post is on', !post().disabled, post().title);
      await t.click(post());
      const sent = t.sent('report-post');
      t.check('Post sends the title and body once, as the preview shows them', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.sent), sent);
      await t.post({ type: 'state', model: d.noAccess });
      const state = t.find('.report-state');
      t.check('where GitHub\'s account can\'t reach the repo, it says so', state.textContent?.includes('can\'t reach') === true, state.textContent);
      t.check('and what was typed is still there', t.find<HTMLTextAreaElement>('#report-what-happened').value === d.happened && t.find<HTMLInputElement>('#report-title').value === d.title);
      const copy = t.all<HTMLButtonElement>('button', state).find((x) => x.textContent?.trim() === 'Copy the issue text');
      if (!copy) throw new Error('not found: Copy the issue text');
      await t.click(copy);
      const copied = t.sent('report-copy');
      t.check('Copy the issue text copies the issue the preview shows', copied.length === 1 && copied[0]!.text === d.text, copied);
    },
  },
  {
    name: 'ticket talk: beside a conversation the plan section has no Make a new plan, which is the conversation panel\'s alone (T-116)',
    page: 'ticket-talk',
    async run(t) {
      t.check('the page has a conversation line', t.all('.convo-line').length === 1, t.all('.convo-line').length);
      const make = t.all<HTMLButtonElement>('button').filter((x) => x.textContent?.trim() === 'Make a new plan');
      t.check('and no Make a new plan, among the plan\'s actions or anywhere on the page', make.length === 0, make.map((x) => x.parentElement?.className));
    },
  },
  {
    name: 'task page: a review lists its findings, must-fix first, each with its lines, and a click on a file and line asks to open it there',
    page: 'ticket-review',
    async run(t) {
      // The review is a tab (T-135): the one a sent-back review opens on, saying in words that it needs the person.
      const rtab = t.find<HTMLButtonElement>('[role="tab"][data-tab="review"]');
      const rneeds = t.find('.task-tab-needs', rtab);
      t.check('the page opens on its Review tab, which needs the person', rtab.getAttribute('aria-selected') === 'true' && getComputedStyle(t.find('.task-panel-review')).display !== 'none', rtab.outerHTML);
      t.check('the Review tab says it needs you, in words, with an orange icon, after its count', rneeds.textContent === 'needs you' && rneeds.querySelector('.codicon-bell') !== null && /^Review\s*3\s*needs you$/.test(rtab.innerText.trim()), rtab.innerText);
      t.check('and the side column holds no Review panel', t.all('.ticket-side .side-review').length === 0 && t.all('.ticket-side [data-section]').every((x) => ['details', 'agent'].includes((x as HTMLElement).dataset.section ?? '')));
      const box = t.find('.review-block');
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
    name: 'output panel: a review shows its verdict and rows, a row opens in place, its file and line and its next step send their messages, and Show output shows its rows',
    page: 'output-changes',
    async run(t) {
      const want = t.data.dock;
      // A review that starts opens the panel on it, as the extension's runs message does.
      await t.post(want.runs);
      // The panel redraws on each click, so it's found again each time.
      const dock = (): HTMLElement => t.find('section.dock');
      const head = t.find('.dr-head', dock());
      t.check('the header line says the verdict', t.find('.status', head).textContent === want.look, t.find('.status', head).textContent);
      t.check('and counts the criteria and findings', t.find('.dr-count', head).textContent === want.count, t.find('.dr-count', head).textContent);
      t.check('the header line hovers who reviewed it, when and how long', /^Reviewed by .+\. It took .+\.$/.test(head.title), head.title);
      t.check('the review, not the rows', t.all('.dock-body', dock()).length === 0, t.all('.dock-body', dock()).length);
      const rows = t.all('.dr-rows > .dr-row:not(.dr-met)', dock());
      const shown = rows.map((r) => ({ key: r.dataset.row, label: t.find('.dr-toggle .status', r).textContent, text: t.find('.dr-text', r).textContent }));
      t.check('a row for each criterion not met, then each finding, must-fix first', JSON.stringify(shown) === JSON.stringify(want.rows), shown);
      t.check('each row starts closed', rows.every((r) => t.find('.dr-toggle', r).getAttribute('aria-expanded') === 'false' && !r.querySelector('.dr-detail')));
      // The first finding: a click on its row opens it in place, with its lines.
      const first = want.rows.find((r) => r.key.startsWith('f'))!;
      await t.click(t.find(`[data-row="${first.key}"] .dr-toggle`, dock()));
      const opened = t.find(`[data-row="${first.key}"]`, dock());
      t.check('a click opens the row in place', t.find('.dr-toggle', opened).getAttribute('aria-expanded') === 'true' && !!opened.querySelector('.dr-detail'));
      t.check('showing the finding whole, and the lines around it', t.find('.dr-message', opened).textContent === first.text && !!opened.querySelector('.rv-excerpt .rv-at'));
      t.check('the other rows stay closed', t.all('.dr-detail', dock()).length === 1, t.all('.dr-detail', dock()).length);
      await t.click(t.find('.dr-line > .rv-place', opened));
      const sent = t.sent('review-file').at(-1);
      t.check('its file and line asks to open the file there', JSON.stringify(sent) === JSON.stringify(want.click), sent);
      // The met criteria, folded into one row.
      await t.click(t.find('.dr-met .dr-toggle', dock()));
      t.check('the met row opens to list them', t.all('.dr-met-list > li', dock()).length === want.met, t.all('.dr-met-list > li', dock()).length);
      const next = t.find<HTMLButtonElement>('.dr-head .dr-next', dock());
      t.check('one primary button', t.all('.btn.primary', dock()).length === 1, t.all('.btn.primary', dock()).length);
      await t.click(next);
      const ran = t.sent('run').at(-1);
      t.check('the next step sends its command for the task', JSON.stringify(ran) === JSON.stringify(want.next), ran);
      // Show output: the run's lines, as before; then the review again.
      const show = t.find<HTMLButtonElement>('.dock-lines', dock());
      t.check('Show output is named so', show.getAttribute('aria-label') === 'Show output', show.getAttribute('aria-label'));
      await t.click(show);
      // As rows, never a block of raw lines (T-64).
      const out = t.all('.dock-body .dock-row').map((r) => r.title);
      t.check('Show output shows its output as rows', JSON.stringify(out) === JSON.stringify(want.lines) && !t.all('.dock pre').length, out);
      t.check('in place of the review', t.all('.dr').length === 0);
      await t.click(t.find('.dock-lines'));
      t.check('Show the review brings it back, the row still open', t.all('.dock-body').length === 0 && !!document.querySelector(`[data-row="${first.key}"] .dr-detail`));
    },
  },
  {
    name: 'output panel: a run shows as rows, Details shows its command, Copy log copies it, a path chip opens its file, and the result card runs it again',
    page: 'output-failed',
    async run(t) {
      const want = t.data.run;
      // A run that ends opens the panel on it, as the extension's runs message does.
      await t.post(want.runs);
      // The panel redraws on each click, so it's found again each time.
      const dock = (): HTMLElement => t.find('section.dock');
      const head = t.find('.dock-title', dock());
      t.check('the header line says the state in words', t.find('.status', head).textContent === want.look, t.find('.status', head).textContent);
      t.check('then the run\'s name and how long it took', t.find('.dock-label', head).textContent === want.label && t.find('.dock-clock', head).textContent === want.took, head.textContent);
      t.check('no block of raw output', t.all('pre, .dock-out', dock()).length === 0, t.all('pre, .dock-out', dock()).length);
      const rows = t.all('.dock-body > .dock-rows > .dock-row', dock());
      t.check('a row for each line, the blank one gone, in order', JSON.stringify(rows.map((r) => r.title)) === JSON.stringify(want.rows), rows.map((r) => r.title));
      t.check('each warning and error says so in words', rows.every((r) => !r.matches('.kind-warning, .kind-error') || t.find('.status', r).textContent === (r.matches('.kind-error') ? 'Error' : 'Warning')));
      t.check('the command is out of view', !dock().textContent!.includes(want.command));
      // Details and Copy log, from the header's menu.
      const pick = async (label: string) => {
        await t.click(t.find('.dock-bar .more-btn', dock()));
        const item = t.all<HTMLButtonElement>('.dock-bar .more-item', dock()).find((b) => b.textContent === label);
        t.check(`the menu holds ${label}`, !!item);
        if (item) await t.click(item);
      };
      await pick('Show details');
      t.check('Details shows the command', t.all('.dock-details .dock-cmd', dock())[0]?.textContent === want.command, t.all('.dock-details', dock())[0]?.textContent);
      await pick('Copy log');
      const copied = t.sent('run-control').at(-1);
      t.check('Copy log asks for the whole output', JSON.stringify(copied) === JSON.stringify(want.copy), copied);
      await t.click(t.find('button.dock-chip', dock()));
      const chip = t.sent('run-file').at(-1);
      t.check('a path chip asks to open its file at its line', JSON.stringify(chip) === JSON.stringify(want.chip), chip);
      t.check('a path outside the folder is a quiet label, not a button', t.all('span.dock-chip.off', dock()).length === want.off, t.all('span.dock-chip.off', dock()).length);
      const card = t.find('.dock-result', dock());
      t.check('the result card says what happened', t.find('.dock-result-text', card).textContent === want.sentence, t.find('.dock-result-text', card).textContent);
      t.check('with the last error and the exit code in words', t.find('.dock-row', card).title === want.error && t.find('.dock-exit', card).textContent === want.exit, card.textContent);
      t.check('one primary button', t.all('.btn.primary', dock()).length === 1, t.all('.btn.primary', dock()).length);
      await t.click(t.find('.dock-next', card));
      const next = t.sent('run-control').at(-1);
      t.check('its button runs it again', JSON.stringify(next) === JSON.stringify(want.next), next);
    },
  },
  {
    name: 'output panel: a run of acc lists its steps, its failed step opens to its own rows on a click, and its output folds into one row that opens (T-65)',
    page: 'output-failed',
    async run(t) {
      const want = t.data.steps;
      await t.post(want.runs);
      const dock = (): HTMLElement => t.find('section.dock');
      const labels = t.all('.dock-step .dock-step-label', dock()).map((l) => l.textContent);
      t.check('a step for each, in order, each with its label', JSON.stringify(labels) === JSON.stringify(want.labels), labels);
      t.check('no output rows until the fold opens', t.all('.dock-body > .dock-rows', dock()).length === 0);
      const failed = (): HTMLElement => t.find('.dock-step.state-failed', dock());
      t.check('the failed step says so in words, and why', t.find('.status', failed()).textContent === 'Failed' && t.find('.dock-step-note', failed()).textContent === want.note, failed().textContent);
      const toggle = (): HTMLButtonElement => t.find<HTMLButtonElement>('.dock-step-toggle', failed());
      t.check('closed, its rows unshown', toggle().getAttribute('aria-expanded') === 'false' && t.all('.dock-step-rows', failed()).length === 0);
      await t.click(toggle());
      const stepRows = t.all('.dock-step-rows .dock-row', failed()).map((r) => r.title);
      t.check('a click opens it to the rows it printed', toggle().getAttribute('aria-expanded') === 'true' && JSON.stringify(stepRows) === JSON.stringify(want.stepRows), stepRows);
      const fold = (): HTMLButtonElement => t.find<HTMLButtonElement>('.dock-output-fold', dock());
      t.check('the output folds into one row that counts its lines', fold().textContent === want.fold && fold().getAttribute('aria-expanded') === 'false', fold().textContent);
      await t.click(fold());
      const rows = t.all('.dock-body > .dock-rows > .dock-row', dock()).map((r) => r.title);
      t.check('a click opens it to every row', fold().textContent === want.open && JSON.stringify(rows) === JSON.stringify(want.rows), rows);
      t.check('and the result card says what acc said', t.find('.dock-result-text', dock()).textContent === want.sentence, t.find('.dock-result-text', dock()).textContent);
    },
  },
  {
    name: 'settings: the jump list shows one section and remembers it, a deep link shows its part\'s section, and each long explanation is a closed What this means that stays open once opened',
    page: 'settings-agents',
    async run(t) {
      const want = t.data.settings;
      const links = (): HTMLElement[] => t.all('nav.settings-jump a[data-section]');
      const shown = (): string[] => t.all('section.settings-section').filter((s) => !s.hidden).map((s) => s.dataset.section ?? '');
      t.check('a link for each section, in order', links().length === want.sections.length && links().every((a, i) => a.dataset.section === want.sections[i]), links().map((a) => a.dataset.section));
      t.check('the jump list is named for screen readers', t.find('nav.settings-jump').getAttribute('aria-label') === 'Sections of Settings');
      t.check('the first section shows until one is picked', JSON.stringify(shown()) === JSON.stringify([want.sections[0]]), shown());
      await t.post({ type: 'state', model: t.model, open: want.open });
      t.check('opened at a part, its section alone shows', JSON.stringify(shown()) === JSON.stringify([want.opened]), shown());
      const to = links().find((a) => a.dataset.section === 'limits');
      if (!to) throw new Error('not found: the link to Checks and limits');
      // Edge: the side list is sticky, so a jump can be made scrolled deep into a long section.
      // Above 820 px the page's main column is what scrolls, under the rail.
      const scroller = t.find('.home-main');
      scroller.scrollTop = scroller.scrollHeight;
      t.check('scrolled down before the jump', scroller.scrollTop > 0, scroller.scrollTop);
      await t.click(to);
      t.check('a jump shows its section alone', JSON.stringify(shown()) === JSON.stringify(['limits']), shown());
      const top = t.find('#settings-section-limits').getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      t.check('a jump made scrolled down brings its section\'s heading into view', top >= 0 && top < scroller.clientHeight, { top, scrollTop: scroller.scrollTop, height: scroller.clientHeight });
      t.check('its link is the current one', links().filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.dataset.section).join() === 'limits');
      t.check('the jump focuses its section\'s heading', document.activeElement === t.find('#settings-section-limits'), document.activeElement?.outerHTML.slice(0, 80));
      t.check('the picker says the same', t.find<HTMLSelectElement>('select.settings-picker').value === 'limits');
      t.check('the tab remembers it', t.memory().settings === 'limits', t.memory().settings);
      await t.post({ type: 'state', model: t.model });
      t.check('a redraw keeps it', JSON.stringify(shown()) === JSON.stringify(['limits']), shown());
      await t.post({ type: 'state', model: t.model, open: want.deep.part });
      t.check('a deep link to a part in another section shows that section', JSON.stringify(shown()) === JSON.stringify([want.deep.section]), shown());
      t.check('and focuses the part', document.activeElement === t.find(`[data-part="${CSS.escape(want.deep.part)}"]`), document.activeElement?.outerHTML.slice(0, 80));
      const folds = t.all<HTMLDetailsElement>('details.settings-fold');
      t.check('a fold for each long explanation', folds.length === want.folds.length && want.folds.length > 0, { drawn: folds.map((d) => d.dataset.fold), expected: want.folds.map((f) => f.id) });
      for (const f of want.folds) t.check(`${f.id} is closed at first`, !t.find<HTMLDetailsElement>(`details.settings-fold[data-fold="${CSS.escape(f.id)}"]`).open);
      t.check('each short explanation stays in view, outside a fold', t.all('.settings-meaning').filter((p) => !p.closest('details')).length >= want.kept, t.all('.settings-meaning').length);
      const first = want.folds[0]!;
      await t.click(links().find((a) => a.dataset.section === first.section)!);
      await t.click(t.find(`details.settings-fold[data-fold="${CSS.escape(first.id)}"] > summary`));
      t.check('a click opens it, and the tab remembers it', ((t.memory().opened as string[] | undefined) ?? []).includes(first.key), t.memory().opened);
      await t.post({ type: 'state', model: t.model });
      t.check('a redraw leaves it open', t.find<HTMLDetailsElement>(`details.settings-fold[data-fold="${CSS.escape(first.id)}"]`).open);
      t.check('and the others closed', t.all<HTMLDetailsElement>('details.settings-fold[open]').length === 1, t.all('details.settings-fold[open]').length);
    },
  },
  {
    name: 'cloud setup: Next stays off until the step passes, says why in its title and beside it, and a click on it goes nowhere',
    page: 'settings-agents',
    async run(t) {
      const want = t.data.cloud;
      const show = async (m: CloudSetupModel) => { const home = structuredClone(t.model) as HomeModel; home.cloudSetup = m; await t.post({ type: 'state', model: home }); };
      const next = () => {
        const b = t.all<HTMLButtonElement>('.cloud-modal .connect-foot button').find((x) => x.textContent?.trim() === 'Next');
        if (!b) throw new Error('not found: the Next button');
        return b;
      };
      await show(want.todo);
      t.check('it is a modal', t.find<HTMLDialogElement>('dialog.cloud-modal').open);
      t.check('Next is off while the token isn\'t kept', next().disabled);
      t.check('its title is the reason', next().title === want.why, next().title);
      const line = t.find('.cloud-modal .connect-foot .status');
      t.check('a status line beside it says the same, with an icon', line.textContent?.trim() === want.why && !!line.querySelector('.codicon'), line.textContent);
      await t.click(next());
      t.check('a click on it asks for no step', t.sent('cloud-setup-step').length === 0, t.sent('cloud-setup-step'));
      await show(want.done);
      t.check('once the step passes, Next is on', !next().disabled);
      await t.click(next());
      const asked = t.sent('cloud-setup-step');
      t.check('and asks for the next step', asked.length === 1 && asked[0]?.step === want.next, asked);
    },
  },
  {
    name: 'cloud setup: the token is typed hidden, checked as it is typed, sent once, and kept nowhere in the page',
    page: 'settings-agents',
    async run(t) {
      const want = t.data.cloud;
      const home = structuredClone(t.model) as HomeModel;
      home.cloudSetup = want.todo;
      await t.post({ type: 'state', model: home });
      const box = t.find<HTMLInputElement>('#cloud-token');
      const keep = () => {
        const b = t.all<HTMLButtonElement>('.cloud-field button').find((x) => x.textContent?.trim() === 'Keep the token');
        if (!b) throw new Error('not found: Keep the token');
        return b;
      };
      t.check('the box hides what is typed', box.type === 'password');
      t.check('Keep the token is off before anything is typed, with why', keep().disabled && keep().title !== '', keep().title);
      await t.type(box, 'tok_short');
      t.check('a token that doesn\'t fit keeps it off, and says why beside it', keep().disabled && /A token is letters/.test(t.find('.cloud-field-check').textContent ?? ''), t.find('.cloud-field-check').textContent);
      await t.type(box, want.token);
      t.check('one that fits turns it on', !keep().disabled, keep().title);
      await t.click(keep());
      const sent = t.sent('cloud-setup-act');
      t.check('it is sent once, with the token', sent.length === 1 && sent[0]?.action === 'keepToken' && sent[0]?.value === want.token, sent);
      t.check('the tab\'s memory never holds it', !JSON.stringify(t.memory()).includes(want.token), t.memory());
      await t.post({ type: 'state', model: home });
      t.check('drawn again, the box is empty: it was forgotten once sent', t.find<HTMLInputElement>('#cloud-token').value === '', t.find<HTMLInputElement>('#cloud-token').value);
    },
  },
  {
    name: 'connect: Next that is off gives its reason in its title and in a status line beside it',
    page: 'connect-start',
    async run(t) {
      const want = t.data.connect;
      const home = structuredClone(t.model) as HomeModel;
      home.connect = want.site;
      await t.post({ type: 'state', model: home });
      t.check('it is a modal', t.find<HTMLDialogElement>('dialog.connect-modal').open);
      const next = t.all<HTMLButtonElement>('.connect-foot button').find((b) => b.textContent?.trim() === 'Next');
      if (!next) throw new Error('not found: the Next button');
      t.check('Next is off', next.disabled);
      t.check('its title is the reason', next.title === want.why, next.title);
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
    name: 'connect: while it signs in, Test connection is off and gives its reason in its title and in a status line beside it',
    page: 'connect-start',
    async run(t) {
      const testing = t.data.connect.testing;
      const home = structuredClone(t.model) as HomeModel;
      home.connect = testing.model;
      await t.post({ type: 'state', model: home });
      const test = t.all<HTMLButtonElement>('.connect-test button').find((b) => b.textContent?.trim() === 'Test connection');
      if (!test) throw new Error('not found: the Test connection button');
      t.check('Test connection is off', test.disabled);
      t.check('its title is the reason', test.title === testing.why, test.title);
      const line = t.find('.connect-test .status');
      t.check('a status line beside it says the same', line.textContent?.trim() === testing.why, line.textContent);
      t.check('with an icon, never colour alone', !!line.querySelector('.codicon, svg, [class*="codicon"]'), line.innerHTML.slice(0, 120));
    },
  },
  {
    name: 'connect: the board under the dropdowns follows each choice, and nothing is saved until Save',
    page: 'connect-start',
    async run(t) {
      const want = t.data.choose;
      const show = async (connect: ConnectModel) => {
        const home = structuredClone(t.model) as HomeModel;
        home.connect = connect;
        await t.post({ type: 'state', model: home });
      };
      const foot = (label: string) => {
        const b = t.all<HTMLButtonElement>('.connect-foot button').find((x) => x.textContent?.trim() === label);
        if (!b) throw new Error(`not found: the ${label} button`);
        return b;
      };
      const option = (value: string, list: string) => t.find<HTMLButtonElement>(`#connect-${list} ~ .cdrop-pop .cdrop-option[data-value="${CSS.escape(value)}"]`);
      const line = () => t.find('.connect-preview .cpreview-line .status').textContent?.trim();
      // The board chosen, its board still being read: Next is off and says why, under a quiet skeleton.
      await show(want.reading);
      t.check('while the board is read, Next is off', foot('Next').disabled, foot('Next').title);
      t.check('and its title says why', foot('Next').title === want.wait, foot('Next').title);
      t.check('the board draws a skeleton while it reads', t.all('.connect-preview .ccard-skeleton').length > 0);
      t.check('and says it is reading', t.find('.connect-preview').getAttribute('aria-busy') === 'true');
      // A board picked in its dropdown is sent.
      await t.click(t.find<HTMLButtonElement>('#connect-board'));
      t.check('the board\'s dropdown opens its list', t.find('#connect-board').getAttribute('aria-expanded') === 'true');
      await t.click(option('9', 'board'));
      const picked = t.sent('connect-pick').at(-1);
      t.check('a board picked in its dropdown is sent', picked?.key === 'board' && picked.value === '9', picked);
      t.check('one choice closes the list', t.find('#connect-board').getAttribute('aria-expanded') === 'false');
      // Its board drawn: the line, its columns, and the Tasks tab's cards.
      await show(want.shown);
      t.check('the board says how many tickets, in how many columns', line() === want.line, line());
      t.check('it draws the board\'s columns', t.all('.connect-preview .cpreview-col').length === want.shown.preview.board!.columns.length, t.all('.cpreview-col').length);
      t.check('with the Tasks tab\'s cards', t.all('.connect-preview .tcard').length > 0);
      t.check('the epics\' dropdown names ACME-31', t.find('#connect-epics').textContent?.trim() === 'ACME-31', t.find('#connect-epics').textContent);
      // A long list has a box to find a choice in.
      await t.click(t.find<HTMLButtonElement>('#connect-epics'));
      const find = t.find<HTMLInputElement>('#connect-epics ~ .cdrop-pop input.cdrop-find');
      // Edge: a search that matches no epic says so.
      await t.type(find, 'no such epic');
      t.check('a search that matches none says so', t.all('#connect-epics ~ .cdrop-pop .cdrop-none').length === 1);
      await t.type(find, 'partner');
      const shown = t.all<HTMLElement>('#connect-epics ~ .cdrop-pop .cdrop-option').map((c) => c.dataset.value).filter(Boolean);
      t.check('the search shows only the epics it matches', shown.length === 1 && shown[0] === 'ACME-30', shown);
      // Ticking another epic keeps the first: both are sent, and the board follows them.
      await t.click(option('ACME-30', 'epics'));
      const epic = t.sent('connect-pick').at(-1);
      const ticked = Array.isArray(epic?.value) ? (epic.value as string[]).join(' ') : '';
      t.check('ticking an epic sends every epic ticked, the one the search hides too', epic?.key === 'epics' && ticked === 'ACME-31 ACME-30', epic);
      await show(want.epic);
      t.check('the board is drawn again with the epics ticked', line() === want.epicLine && want.epicLine !== want.line, line());
      t.check('a list that ticks several stays open while it\'s ticked', t.find('#connect-epics').getAttribute('aria-expanded') === 'true');
      await t.type(t.find<HTMLInputElement>('#connect-epics ~ .cdrop-pop input.cdrop-find'), '');
      t.check('the box kept what was typed through the redraw, and clearing it shows every epic again', t.all('#connect-epics ~ .cdrop-pop .cdrop-option').length > 2);
      t.check('and both epics are ticked now', option('ACME-30', 'epics').getAttribute('aria-selected') === 'true' && option('ACME-31', 'epics').getAttribute('aria-selected') === 'true');
      t.check('picking saved nothing', t.sent('connect-save').length === 0, t.sent('connect-save'));
      // Save, on its own step, is the one thing that writes.
      await show(want.save);
      t.check('Save shows what it keeps', t.all('.csave-list dt').length > 0);
      t.check('Save is on', !foot(want.use).disabled);
      t.check('still nothing saved before the click', t.sent('connect-save').length === 0);
      await t.click(foot(want.use));
      t.check('Save saves the board, once', t.sent('connect-save').length === 1, t.sent('connect-save'));
    },
  },
  {
    name: 'connect: Back and Next move between steps, and Cancel, Escape and the backdrop change nothing',
    page: 'connect-start',
    async run(t) {
      const want = t.data.choose;
      const home = structuredClone(t.model) as HomeModel;
      home.connect = want.shown;
      await t.post({ type: 'state', model: home });
      const dialog = t.find<HTMLDialogElement>('dialog.connect-modal');
      const foot = (label: string) => {
        const b = t.all<HTMLButtonElement>('.connect-foot button').find((x) => x.textContent?.trim() === label);
        if (!b) throw new Error(`not found: the ${label} button`);
        return b;
      };
      t.check('the step bar marks the board step as here', t.find('.cstep[aria-current="step"]').textContent?.includes('Choose a board'));
      await t.click(foot('Next'));
      t.check('Next asks for Save\'s step', t.sent('connect-step').at(-1)?.step === 'save', t.sent('connect-step').at(-1));
      await t.click(foot('Back'));
      t.check('Back asks for the sign-in step', t.sent('connect-step').at(-1)?.step === 'site', t.sent('connect-step').at(-1));
      // Edge: a step that can't be gone to yet is off on the step bar.
      const reading = structuredClone(t.model) as HomeModel;
      reading.connect = want.reading;
      await t.post({ type: 'state', model: reading });
      const saveStep = t.all<HTMLButtonElement>('.cstep').find((b) => b.textContent?.includes('Save'));
      t.check('Save\'s step is off while the board is read', !!saveStep?.disabled, saveStep?.title);
      await t.click(foot('Cancel'));
      t.check('Cancel asks to close, keeping nothing', t.sent('connect-cancel').length === 1);
      await t.escape(dialog);
      t.check('Escape does the same', t.sent('connect-cancel').length === 2);
      t.check('and the modal waits for the extension to close it', dialog.open);
      await t.backdrop(dialog);
      t.check('so does a click on the backdrop', t.sent('connect-cancel').length === 3);
      t.check('nothing was saved', t.sent('connect-save').length === 0);
      const closed = structuredClone(t.model) as HomeModel;
      closed.connect = null;
      await t.post({ type: 'state', model: closed });
      t.check('the model without it closes the modal', !dialog.open);
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
    name: 'first steps: Got it hides the five steps, the tab remembers it, and a redraw keeps them hidden (T-96)',
    page: 'tasks',
    async run(t) {
      const line = t.find('.first-steps');
      t.check('someone new sees how it works, in five steps', t.all('.first-steps-list li', line).map((li) => li.textContent?.replace(/^\d+\.\s*/, '').trim()).join(' / ') === t.data.firstSteps.join(' / '), line.textContent);
      const done = t.all<HTMLButtonElement>('button', line).find((b) => b.textContent?.includes('Got it'));
      if (!done) throw new Error('not found: the first steps\' Got it');
      await t.click(done);
      t.check('Got it hides them', t.all('.first-steps').length === 0);
      t.check('the tab remembers they were dismissed', t.memory().firstStepsSeen === true, t.memory());
      // Edge: the next model, as a refresh sends, draws them hidden still.
      await t.post({ type: 'state', model: t.model });
      t.check('a redraw keeps them hidden', t.all('.first-steps').length === 0);
    },
  },
  {
    name: 'board keys: Space on a card no column takes says why, and holds nothing',
    page: 'tasks',
    async run(t) {
      await t.post({ type: 'state', model: t.data.keys.stuck.model });
      const seg = t.all<HTMLButtonElement>('.segmented .seg').find((b) => b.textContent?.includes('My work'));
      if (!seg) throw new Error('not found: the My work button');
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
    name: 'dispatch sheet: a card\'s Dispatch opens it, a model picked changes the efforts, and Enter sends the choice',
    page: 'tasks',
    async run(t) {
      const d = t.data.sheet.card;
      const button = t.find(`article.card[data-card-id="${CSS.escape(d.task)}"] .ta-btn.primary`);
      t.check('the card\'s next step is Build it', button.textContent?.trim() === 'Build it', button.textContent);
      await t.click(button);
      const ran = t.sent('run').at(-1);
      t.check('a click asks the extension for the sheet, and dispatches nothing', JSON.stringify(ran) === JSON.stringify(d.run) && t.sent('dispatch-sheet-go').length === 0, ran);
      t.check('nothing opens before the extension answers', t.all('dialog.dispatch-sheet[open]').length === 0);
      await t.post(d.message);
      const dialog = t.find<HTMLDialogElement>('dialog.dispatch-sheet');
      t.check('the sheet opens', dialog.open);
      t.check('focus is on the model chosen', document.activeElement === t.find('[data-part="model"] [aria-checked="true"]', dialog), document.activeElement?.className);
      // Edge: the builder's model takes no effort, so Effort shows no levels, and a line says so.
      t.check('a model that takes no effort shows no levels', t.all('[data-part="effort"]', dialog).length === 0);
      t.check('and says so in a line', t.find('[data-section="effort"] .ds-note', dialog).textContent === d.none, t.find('[data-section="effort"] .ds-note', dialog).textContent);
      const pick = t.all('[data-part="model"] [role=radio]', dialog).find((r) => r.querySelector('.ds-row-name')?.textContent === d.pick);
      if (!pick) throw new Error(`not found: the model ${d.pick}`);
      await t.click(pick);
      const levels = t.all('[data-part="effort"] [role=radio]', dialog).map((e) => e.textContent);
      t.check('picking another model shows its levels', JSON.stringify(levels) === JSON.stringify(d.levels), levels);
      t.check('with the one the builder runs with chosen', t.find('[data-part="effort"] [aria-checked="true"]', dialog).textContent === d.chosen, t.find('[data-part="effort"] [aria-checked="true"]', dialog).textContent);
      t.check('and the model it picked chosen, with focus on it', t.find('[data-part="model"] [aria-checked="true"] .ds-row-name', dialog).textContent === d.pick && document.activeElement === t.find('[data-part="model"] [aria-checked="true"]', dialog));
      await press(t, document.activeElement as HTMLElement, 'Enter');
      const sent = t.sent('dispatch-sheet-go');
      t.check(`Enter sends the choice once, which acc gets as: ${d.args.join(' ')}`, sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.sent), sent);
      t.check('the sheet closes', !dialog.open);
      t.check('focus goes back to the Dispatch that opened it', document.activeElement === button, document.activeElement?.className);
    },
  },
  {
    name: 'dispatch sheet: Another model… asks for a name, and Dispatch is off until it holds one',
    page: 'tasks',
    async run(t) {
      const d = t.data.sheet.another;
      await t.post(t.data.sheet.card.message);
      const dialog = t.find<HTMLDialogElement>('dialog.dispatch-sheet');
      t.check('no name box before Another model… is picked', t.all('.ds-name', dialog).length === 0);
      const row = t.all('[data-part="model"] [role=radio]', dialog).find((r) => r.querySelector('.ds-row-name')?.textContent === d.label);
      if (!row) throw new Error(`not found: ${d.label}`);
      await t.click(row);
      const box = t.find<HTMLInputElement>('.ds-name', dialog);
      const go = t.find<HTMLButtonElement>('.ds-go', dialog);
      t.check('picking it shows a box for the name', !!box && box.value === '');
      t.check('Dispatch is off, saying why', go.disabled && go.title === d.empty, go.title);
      // Edge: Enter with the box empty sends nothing, and the sheet stays.
      await press(t, box, 'Enter');
      t.check('Enter with no name sends nothing', t.sent('dispatch-sheet-go').length === 0 && dialog.open);
      await t.type(box, d.name);
      t.check('a name turns Dispatch on', !go.disabled, go.title);
      await press(t, box, 'Enter');
      const sent = t.sent('dispatch-sheet-go');
      t.check(`Enter sends the name typed, which acc gets as: ${d.args.join(' ')}`, sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.sent), sent);
      t.check('the sheet closes', !dialog.open);
    },
  },
  {
    name: 'dispatch sheet: the task page\'s Re-dispatch opens it over the page, with the cloud off and why, and Escape sends nothing',
    page: 'tasks',
    async run(t) {
      const d = t.data.sheet.page;
      await t.post(d.modal);
      const modal = t.find<HTMLDialogElement>('dialog.task-modal:not(.detail-modal):not(.palette-modal):not(.dispatch-sheet)');
      t.check('the task page is open over the board', modal.open);
      const go = t.find('.task-actions > .ta-btn.primary', modal);
      await t.click(go);
      const ran = t.sent('run').at(-1);
      t.check('Re-dispatch asks the extension for the sheet, and dispatches nothing', JSON.stringify(ran) === JSON.stringify(d.run) && t.sent('dispatch-sheet-go').length === 0, ran);
      await t.post(d.message);
      const dialog = t.find<HTMLDialogElement>('dialog.dispatch-sheet');
      t.check('the sheet opens over the task page', dialog.open && modal.open);
      t.check('it is titled for a rework', t.find('.ds-title', dialog).textContent === d.title, t.find('.ds-title', dialog).textContent);
      const cloud = (): HTMLElement => t.all('[data-part="where"] [role=radio]', dialog)[1]!;
      t.check('the cloud is off, with its reason in its title', cloud().getAttribute('aria-disabled') === 'true' && cloud().title.includes(d.reason), cloud().title);
      t.check('and a line says why', t.find('[data-section="where"] .ds-note', dialog).textContent === d.reason, t.find('[data-section="where"] .ds-note', dialog).textContent);
      // Edge: a click on the cloud, which is off, chooses nothing.
      await t.click(cloud());
      t.check('a click on it leaves This Mac chosen', cloud().getAttribute('aria-checked') === 'false');
      await t.escape(dialog);
      t.check('Escape closes the sheet', !dialog.open);
      t.check('and leaves the task page open under it', modal.open);
      t.check('and sends nothing', t.sent('dispatch-sheet-go').length === 0, t.sent('dispatch-sheet-go'));
      t.check('focus goes back to Re-dispatch', document.activeElement === go, document.activeElement?.className);
    },
  },
  {
    name: 'task sheet: a new task\'s Save is off without a title, Enter in the description is a new line, and Cmd+Enter adds it',
    page: 'tasks',
    async run(t) {
      const d = t.data.taskSheet.add;
      await t.post(d.message);
      const dialog = t.find<HTMLDialogElement>('dialog.task-sheet');
      const title = t.find<HTMLInputElement>('input.ts-box', dialog);
      const brief = t.find<HTMLTextAreaElement>('textarea.ts-box', dialog);
      const go = t.find<HTMLButtonElement>('.ts-go', dialog);
      t.check('the sheet opens with focus on the title', dialog.open && document.activeElement === title, document.activeElement?.className);
      t.check('Add task is off, saying why', go.disabled && go.title === d.off, go.title);
      // Edge: Enter with no title sends nothing, and the sheet stays.
      await press(t, title, 'Enter');
      t.check('Enter with no title sends nothing', t.sent('task-sheet-go').length === 0 && dialog.open);
      await t.type(title, d.title);
      t.check('a title turns Add task on', !go.disabled, go.title);
      await t.type(brief, d.brief);
      const enter = await press(t, brief, 'Enter');
      t.check('Enter in the description is a new line: it sends nothing', !enter.defaultPrevented && t.sent('task-sheet-go').length === 0 && dialog.open);
      brief.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
      await t.settle();
      const sent = t.sent('task-sheet-go');
      t.check('Cmd+Enter sends what was written, once', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.sent), sent);
      t.check('the sheet closes', !dialog.open);
    },
  },
  {
    name: 'task sheet: a manual task\'s Save sends its fields with the notes changed',
    page: 'tasks',
    async run(t) {
      const d = t.data.taskSheet.edit;
      await t.post(d.message);
      const dialog = t.find<HTMLDialogElement>('dialog.task-sheet');
      const boxes = t.all<HTMLTextAreaElement>('textarea.ts-box', dialog);
      t.check('a manual task has a description and notes to change', boxes.length === 2, boxes.length);
      await t.type(boxes[1]!, d.notes);
      await t.click(t.find('.ts-go', dialog));
      const sent = t.sent('task-sheet-go');
      t.check('Save sends the task and its fields, once', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(d.sent), sent);
      t.check('the sheet closes', !dialog.open);
    },
  },
  {
    name: 'task sheet: a Jira task shows what its ticket owns read-only, opens the ticket, and Escape sends nothing',
    page: 'tasks',
    async run(t) {
      const d = t.data.taskSheet.tracker;
      await t.post(d.message);
      const dialog = t.find<HTMLDialogElement>('dialog.task-sheet');
      t.check('its title, description, dependencies and labels are text, not boxes', t.all('.ts-kept', dialog).length === d.kept && t.all('input.ts-box', dialog).length === 0, t.all('.ts-kept', dialog).length);
      t.check('focus is on the environment, the first field a person may change', document.activeElement === t.find('select.ts-box', dialog), document.activeElement?.className);
      await t.click(t.find('.ts-ticket', dialog));
      const opened = t.sent('open').at(-1);
      t.check('Open in Jira sends its link', opened?.url === d.url, opened);
      await t.escape(dialog);
      t.check('Escape closes the sheet, and sends nothing', !dialog.open && t.sent('task-sheet-go').length === 0, t.sent('task-sheet-go'));
    },
  },
  {
    name: 'task sheet: with edits on, Save waits for its ticket, a failed write keeps the text, a change made meanwhile shows both versions, and Keep mine saves again',
    page: 'tasks',
    async run(t) {
      const d = t.data.taskSheet.edits;
      await t.post(d.message);
      const dialog = t.find<HTMLDialogElement>('dialog.task-sheet');
      const title = t.find<HTMLInputElement>('input.ts-box', dialog);
      t.check('the ticket\'s title and description are boxes', title.value === (d.base as { title: string }).title && t.all('textarea.ts-box', dialog).length === 2, title.value);
      await t.type(title, d.title);
      const changes = t.all<HTMLButtonElement>('.ts-change', dialog);
      t.check('its status, assignee and labels each have a Change', changes.length === 3, changes.length);
      await t.click(changes[0]!);
      t.check('Change asks for its field, and the others wait', JSON.stringify(t.sent('task-sheet-field').at(-1)) === JSON.stringify({ type: 'task-sheet-field', project: d.project, task: 'ACME-19', field: 'status' }) && t.all<HTMLButtonElement>('.ts-change', dialog).every((b) => b.disabled), t.sent('task-sheet-field'));
      await t.post({ type: 'task-sheet-rows', project: d.project, task: 'ACME-19', field: 'status', ok: true, changed: true, rows: d.rows });
      t.check('the rows show the ticket as it is now, and what was typed stays', t.find('.ts-row .ts-kept', dialog).textContent === d.rows[0]!.value && t.find<HTMLInputElement>('input.ts-box', dialog).value === d.title, t.find('.ts-row .ts-kept', dialog).textContent);
      await t.click(t.find('.ts-go', dialog));
      const first = t.sent('task-sheet-go');
      t.check('Save sends the text it opened with, once', first.length === 1 && JSON.stringify(first[0]!.base) === JSON.stringify(d.base) && first[0]!.title === d.title, first);
      t.check('the sheet waits for its ticket, with Save off', dialog.open && t.find<HTMLButtonElement>('.ts-go', dialog).disabled, t.find('.ts-go', dialog).title);
      // Edge: the write failed. The sheet says why and keeps what was typed.
      await t.post({ type: 'task-sheet-done', project: d.project, task: 'ACME-19', ok: false, error: d.error });
      t.check('a failed write says why, keeps the text, and Save is on again', dialog.open && dialog.textContent!.includes(d.error) && t.find<HTMLInputElement>('input.ts-box', dialog).value === d.title && !t.find<HTMLButtonElement>('.ts-go', dialog).disabled);
      await t.click(t.find('.ts-go', dialog));
      await t.post({ type: 'task-sheet-done', project: d.project, task: 'ACME-19', ok: false, conflict: d.theirs });
      const versions = t.all('.ts-version', dialog);
      t.check('a change made meanwhile shows both versions, with Save off until one is picked', versions.length === 2 && versions[0]!.textContent!.includes((d.theirs as { title: string }).title) && versions[1]!.textContent!.includes(d.title) && t.find<HTMLButtonElement>('.ts-go', dialog).disabled, versions.map((v) => v.textContent));
      t.check('what was typed stays in its box', t.find<HTMLInputElement>('input.ts-box', dialog).value === d.title);
      await t.click(t.all<HTMLButtonElement>('.ts-pick button', dialog)[1]!);
      const again = t.sent('task-sheet-go');
      t.check('Keep mine saves the person\'s text against the ticket\'s as it is now', again.length === 3 && JSON.stringify(again[2]!.base) === JSON.stringify(d.theirs) && again[2]!.title === d.title, again.at(-1));
      await t.post({ type: 'task-sheet-done', project: d.project, task: 'ACME-19', ok: true });
      t.check('done, the sheet closes', !dialog.open);
    },
  },
  {
    name: 'task sheet: each wording finding shows beside its criterion, Save is off until the fixes, and the check comes again as the description changes',
    page: 'tasks',
    async run(t) {
      const d = t.data.taskSheet.wording;
      await t.post(d.message);
      const dialog = t.find<HTMLDialogElement>('dialog.task-sheet');
      const brief = t.all<HTMLTextAreaElement>('textarea.ts-box', dialog)[0]!;
      const go = () => t.find<HTMLButtonElement>('.ts-go', dialog);
      const items = t.all('.ts-wording-item', dialog);
      t.check('each criterion with a finding shows it beside its text', items.length === d.items && items.every((i) => i.querySelector('.ts-wording-text')?.textContent && i.querySelector('.ts-wording-finding')), items.map((i) => i.textContent));
      t.check('a fix is orange with its warning icon, and advice is blue with its info icon', t.all('.ts-wording-finding .codicon-warning.tone-orange', dialog).length === 2 && t.all('.ts-wording-finding .codicon-info.tone-blue', dialog).length === 1);
      // Edge: acc edit doesn't check a description left as it was, so an edit of the notes alone can still save.
      t.check('with the description as it opened, Save is on, and the findings say they stop it once it changes', !go().disabled && t.find('.ts-wording-head', dialog).textContent!.includes('once you change the description'), go().title);
      t.check('the findings are read out as they change', t.find('.ts-wording', dialog).getAttribute('aria-live') === 'polite');
      await t.type(brief, d.fixed);
      t.check('once the description changes, Save is off until the check comes back clean, saying why', go().disabled && go().title === d.off, go().title);
      await t.settle();
      await t.settle();
      const asked = t.sent('task-sheet-wording');
      t.check('a moment after the description changes, the sheet asks for the check once, with the text in the box', asked.length === 1 && asked[0]!.brief === d.fixed && asked[0]!.project === d.project, asked);
      // Edge: an answer for older text is not this text's: Save stays off.
      await t.post(d.stale);
      t.check('an answer for older text changes nothing', go().disabled && t.all('.ts-wording-item', dialog).length === d.items);
      await t.post(d.reply);
      t.check('the answer for this text shows only the advice, and Save is on', !go().disabled && t.all('.ts-wording-finding .codicon-warning', dialog).length === 0 && t.all('.ts-wording-item', dialog).length === 1, go().title);
      t.check('the description keeps its focus and its text', document.activeElement === brief && brief.value === d.fixed);
      await t.click(go());
      const sent = t.sent('task-sheet-go');
      t.check('Save sends the description with the fixes', sent.length === 1 && sent[0]!.brief === d.fixed, sent);
    },
  },
  {
    name: 'task sheet: drafted acceptance criteria go below the description, a failed draft says why, and nothing is saved until Save',
    page: 'tasks',
    async run(t) {
      const d = t.data.taskSheet.criteria;
      await t.post(d.message);
      const dialog = t.find<HTMLDialogElement>('dialog.task-sheet');
      const brief = () => t.all<HTMLTextAreaElement>('textarea.ts-box', dialog)[0]!;
      const named = (label: string) => t.all<HTMLButtonElement>('button', dialog).find((b) => b.textContent?.trim() === label);
      t.check('the description opens as its ticket has it', brief().value === d.brief, brief().value);
      await t.click(named('Add the draft')!);
      t.check('Add the draft puts the draft below the text, under its own heading', brief().value === `${d.brief}\n\n${d.section}`, brief().value);
      t.check('it says nothing reaches the ticket until Save, and Add the draft goes', dialog.textContent!.includes('nothing reaches the ticket until you save') && !named('Add the draft'));
      t.check('nothing was sent: the draft is in the box only', t.sent('task-sheet-go').length === 0 && t.sent('task-sheet-criteria').length === 0);
      await t.click(named('Draft again')!);
      t.check('Draft again asks the extension for a draft of this task', JSON.stringify(t.sent('task-sheet-criteria').at(-1)) === JSON.stringify({ type: 'task-sheet-criteria', project: d.project, task: 'ACME-19' }), t.sent('task-sheet-criteria'));
      t.check('while it drafts, its button is off and says so', !!named('Drafting…')?.disabled);
      // Edge: the draft failed. The sheet says why, keeps the text, and can draft again.
      await t.post({ type: 'task-sheet-draft', project: d.project, task: 'ACME-19', ok: false, error: d.error });
      t.check('a failed draft says why, and the text stays', dialog.textContent!.includes(d.error) && brief().value === `${d.brief}\n\n${d.section}`);
      await t.click(named('Draft again')!);
      await t.post({ type: 'task-sheet-draft', project: d.project, task: 'ACME-19', ok: true, section: d.again });
      t.check('a new draft goes below what is written', brief().value === `${d.brief}\n\n${d.section}\n\n${d.again}`, brief().value);
      t.check('a reply for another task changes nothing', await (async () => { await t.post({ type: 'task-sheet-draft', project: d.project, task: 'ACME-20', ok: true, section: 'x' }); return !brief().value.endsWith('x'); })());
      await t.click(t.find('.ts-go', dialog));
      const go = t.sent('task-sheet-go');
      t.check('Save sends the description with the draft in it, once', go.length === 1 && go[0]!.brief === `${d.brief}\n\n${d.section}\n\n${d.again}`, go);
    },
  },
  {
    name: 'task page: a draft shows with Add to the description and Open as an update, each asks for its task, and a refusal says why',
    page: 'ticket-review',
    async run(t) {
      const d = t.data.criteria;
      await t.post({ type: 'state', model: d.model });
      const sec = t.find('section.criteria');
      const named = (label: string) => t.all<HTMLButtonElement>('button', sec).find((b) => b.textContent?.trim() === label);
      t.check('the draft shows, with what it was drafted from', sec.textContent!.includes('A new contact gets the welcome email one time.') && sec.textContent!.includes('Drafted from the ticket, 2 comments and 1 related ticket.'), sec.textContent);
      await t.click(named('Open as an update')!);
      t.check('Open as an update asks for an update draft of this task', JSON.stringify(t.sent('criteria-update').at(-1)) === JSON.stringify({ type: 'criteria-update', project: d.project, task: 'ACME-19' }), t.sent('criteria-update'));
      const busy = t.find('section.criteria');
      t.check('while it goes, the others wait', t.all<HTMLButtonElement>('.an-actions button', busy).every((b) => b.disabled), t.all('.an-actions button', busy).map((b) => b.textContent));
      await t.post({ type: 'criteria-done', action: 'criteria-update', project: d.project, task: 'ACME-19', ok: false, error: d.error });
      const again = t.find('section.criteria');
      t.check('a refusal says why, and the buttons are on again', again.textContent!.includes(d.error) && t.all<HTMLButtonElement>('.an-actions button', again).every((b) => !b.disabled));
      await t.click(t.all<HTMLButtonElement>('button', again).find((b) => b.textContent?.trim() === 'Add to the description')!);
      t.check('Add to the description asks for the sheet with the draft', JSON.stringify(t.sent('criteria-sheet').at(-1)) === JSON.stringify({ type: 'criteria-sheet', project: d.project, task: 'ACME-19' }), t.sent('criteria-sheet'));
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
  {
    name: 'person filter: the menu lists each choice with an icon and a label, a pick shows only that person\'s cards with a count, and the choice outlasts a redraw',
    page: 'tasks',
    async run(t) {
      const p = t.data.people;
      const tracker = () => t.find(`.board[data-keys="${CSS.escape(p.board)}"]`).closest<HTMLElement>('.tracker')!;
      const button = () => t.find('.person-btn', tracker());
      t.check('the header says Mine with its count, since the board knows who is signed in and nothing was chosen (T-143)', button().textContent?.trim() === p.mine, button().textContent);
      t.check('the menu is shut', !!t.find('.person-menu', tracker()).hidden);
      await t.click(button());
      const items = t.all('.person-item', tracker());
      t.check('it opens, and lists Everyone, Mine, Unassigned and each person', !t.find('.person-menu', tracker()).hidden && JSON.stringify(items.map((i) => i.querySelector('.person-name')?.textContent)) === JSON.stringify(p.labels), items.map((i) => i.querySelector('.person-name')?.textContent));
      t.check('each choice has an icon, a label and a count', items.every((i) => !!i.querySelector('.codicon') && !!i.querySelector('.person-name')?.textContent && /^\d+$/.test(i.querySelector('.person-count')?.textContent ?? '')));
      t.check('Mine is on, since the board knows who is signed in', !(items[1] as HTMLButtonElement).disabled);
      // Edge: Escape shuts it and puts focus back on the button.
      await press(t, items[0]!, 'Escape');
      t.check('Escape shuts it, and focus goes back to its button', t.find('.person-menu', tracker()).hidden && document.activeElement === button(), document.activeElement?.className);
      await t.click(button());
      await t.click(t.all('.person-item', tracker()).find((i) => i.querySelector('.person-name')?.textContent === p.person)!);
      t.check('the header says the person and how many of the cards are theirs', button().textContent?.trim() === p.header, button().textContent);
      const shown = () => t.all('article.card', t.find(`.board[data-keys="${CSS.escape(p.board)}"]`)).map((a) => a.dataset.cardId);
      t.check('the board draws only their cards', shown().length === Number(p.header.split(' · ')[1]!.split(' ')[0]) && !shown().includes(p.hidden), shown());
      t.check('the choice is kept in the tab\'s memory, by the board\'s key', (t.memory().filters as Record<string, string>)[p.board] === p.choice, t.memory().filters);
      await t.post({ type: 'state', model: t.model });
      t.check('a redraw keeps the choice, the header and the cards', button().textContent?.trim() === p.header && !shown().includes(p.hidden), button().textContent);
      await t.click(button());
      await t.click(t.all('.person-item', tracker()).find((i) => i.querySelector('.person-name')?.textContent === 'Mine')!);
      t.check('Mine shows the signed-in person\'s cards', button().textContent?.trim() === p.mine, button().textContent);
    },
  },
  {
    name: 'board switch: ten boards open one list from its button, a typed site finds its boards, Down goes to them, Enter on the box shows the first, and Escape shuts it (T-127)',
    page: 'tasks',
    async run(t) {
      const b = t.data.boards;
      await t.post({ type: 'state', model: b.model });
      const button = () => t.find<HTMLButtonElement>('.board-switch-btn');
      const menu = () => t.find('.board-menu');
      t.check('the list is shut, and its button is named for the board on show', !!menu().hidden && /^Board on show: /.test(button().getAttribute('aria-label') ?? ''), button().getAttribute('aria-label'));
      await t.click(button());
      const box = t.find<HTMLInputElement>('.board-find');
      t.check('it opens, and focus goes to the box to find a board', !menu().hidden && document.activeElement === box && button().getAttribute('aria-expanded') === 'true', document.activeElement?.className);
      box.value = b.typed;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await t.settle();
      const names = () => t.all('.board-item', menu()).map((i) => i.querySelector('.board-item-name')?.textContent);
      t.check('what\'s typed finds that site\'s boards, and only them', JSON.stringify(names()) === JSON.stringify(b.found), names());
      await press(t, box, 'ArrowDown');
      t.check('Down goes from the box to the first board found', document.activeElement === t.all('.board-item', menu())[0], document.activeElement?.textContent);
      await press(t, document.activeElement as HTMLElement, 'Escape');
      t.check('Escape shuts it, and focus goes back to its button', !!menu().hidden && document.activeElement === button(), document.activeElement?.className);
      await t.click(button());
      await press(t, t.find('.board-find'), 'Enter');
      t.check('Enter in the box shows the first board found, and the button names it', button().textContent?.includes(b.picked) === true, button().textContent);
      t.check('the choice is kept for the project', (t.memory().modes as Record<string, string>)[t.data.project] === `board:${b.id}`, t.memory().modes);
      t.check('the extension is told which board is on show, to read it first', t.sent('board-shown').some((m) => m.board === b.id), t.sent('board-shown'));
      // All boards with one opened: the opened board draws whole, and the folds under it don't share the page's height.
      t.remember({ modes: { [t.data.project]: 'all' }, opened: [] });
      await t.post({ type: 'state', model: b.model });
      await t.click(t.all<HTMLButtonElement>('.board-fold')[1]!);
      const opened = t.find('.board');
      t.check('edge case: All boards with one opened scrolls as a page, and the opened board is drawn whole, not squeezed', !t.find('.home-main').classList.contains('fill-board') && opened.getBoundingClientRect().height >= 120, opened.getBoundingClientRect().height);
    },
  },
  {
    name: 'person filter: Down and Right go between the cards that show, and skip the ones it hides',
    page: 'tasks',
    async run(t) {
      const p = t.data.people;
      t.remember({ filters: { [p.board]: p.choice } });
      await t.post({ type: 'state', model: t.model });
      t.check('the card the filter hides is not on the page', t.all(`article.card[data-card-id="${CSS.escape(p.hidden)}"]`).length === 0);
      const first = boardCard(t, p.first);
      first.focus.focus();
      await press(t, first.focus, 'ArrowDown');
      t.check('Down goes to their next card, past the ones in between', document.activeElement === boardCard(t, p.down).focus, document.activeElement?.textContent?.slice(0, 80));
      await press(t, document.activeElement as HTMLElement, 'ArrowUp');
      await press(t, first.focus, 'ArrowRight');
      t.check('Right goes to their card in the next column that has one, past the column that has none', document.activeElement === boardCard(t, p.right).focus, document.activeElement?.textContent?.slice(0, 80));
    },
  },
  {
    name: 'person filter: a board where no card matches says so, and Show everyone brings the cards back',
    page: 'tasks',
    async run(t) {
      const p = t.data.people;
      t.remember({ filters: { [p.board]: 'person:gone' } });
      await t.post({ type: 'state', model: t.model });
      const tracker = () => t.find('.person-btn').closest<HTMLElement>('.tracker')!;
      t.check('the header counts none', t.find('.person-btn', tracker()).textContent?.trim().startsWith('gone · 0 of') === true, t.find('.person-btn', tracker()).textContent);
      t.check('the board says no card matches', t.find('.person-none', tracker()).textContent?.includes('No card here is gone') === true, t.find('.person-none', tracker()).textContent);
      t.check('no card is drawn on it', t.all('article.card', tracker()).length === 0);
      await t.click(t.find('.person-none button', tracker()));
      t.check('Show everyone brings every card back, and the header says Everyone', t.find('.person-btn', tracker()).textContent?.trim() === p.everyone && t.all('article.card', tracker()).length > 0, t.find('.person-btn', tracker()).textContent);
      t.check('Everyone is kept as the person\'s choice, so the board does not go back to Mine (T-143)', (t.memory().filters as Record<string, string> | undefined)?.[p.board] === 'everyone', t.memory().filters);
    },
  },
  {
    name: 'person filter: a board opens on Mine when the tracker knows the person, else on Everyone with its line, and a choice kept wins (T-143)',
    page: 'tasks',
    async run(t) {
      const p = t.data.people;
      const tracker = () => t.find('.person-btn').closest<HTMLElement>('.tracker')!;
      const header = () => t.find('.person-btn', tracker()).textContent?.trim();
      t.check('a known person: the board opens on Mine', header() === p.mine, header());
      t.check('a known person: no line says why not', t.all('.person-why', tracker()).length === 0);
      const unknown = structuredClone(t.model) as typeof t.model;
      if (unknown.kind !== 'home') throw new Error('The person filter cases need a home model.');
      unknown.tasks.projects[0]!.boards[0]!.me = null;
      await t.post({ type: 'state', model: unknown });
      t.check('edge case: nobody known: the board opens on Everyone', header() === p.everyone, header());
      t.check('edge case: nobody known: a quiet line says to sign in', /^Showing everyone: sign in to .+ to see just yours$/.test(t.find('.person-why', tracker()).textContent ?? ''), t.all('.person-why', tracker()).map((w) => w.textContent));
      t.remember({ filters: { [p.board]: p.choice } });
      await t.post({ type: 'state', model: unknown });
      t.check('a kept choice wins over the default, and the line goes', header()?.startsWith(`${p.person} · `) === true && t.all('.person-why', tracker()).length === 0, header());
      t.remember({ filters: { [p.board]: 'everyone' } });
      await t.post({ type: 'state', model: t.model });
      t.check('a kept Everyone wins over Mine on a board that knows the person', header() === p.everyone, header());
    },
  },
  {
    name: 'person filter: board switching: each board opens on its own choice, a kept one or the default (T-143)',
    page: 'tasks',
    async run(t) {
      const b = t.data.boards;
      const model = structuredClone(b.model) as typeof t.model;
      if (model.kind !== 'home') throw new Error('The person filter cases need a home model.');
      const [one, two] = model.tasks.projects[0]!.boards;
      one!.me = 'jordan'; two!.me = 'jordan';
      const key = (x: { index: number }) => `tracker:${t.data.project}#${x.index}`;
      t.remember({ modes: { [t.data.project]: `board:${one!.id}` }, filters: { [key(two!)]: 'everyone' } });
      await t.post({ type: 'state', model });
      const header = () => t.find('.person-btn').textContent?.trim() ?? '';
      t.check('the board with no kept choice opens on Mine', header().startsWith('Mine'), header());
      t.remember({ modes: { [t.data.project]: `board:${two!.id}` }, filters: { [key(two!)]: 'everyone' } });
      await t.post({ type: 'state', model });
      t.check('the board with a kept Everyone opens on it', header().startsWith('Everyone'), header());
    },
  },
  {
    name: 'person filter: the agent board in My work opens on Mine when it knows the person, and Everyone when it does not (T-143)',
    page: 'tasks',
    async run(t) {
      const model = structuredClone(t.model) as typeof t.model;
      if (model.kind !== 'home') throw new Error('The person filter cases need a home model.');
      const project = model.tasks.projects[0]!;
      project.me = 'dispatcher';
      t.remember({ modes: { [project.root]: 'agents' }, filters: {} });
      await t.post({ type: 'state', model });
      const header = () => t.find('.agent-board').closest<HTMLElement>('.project')!.querySelector('.person-btn')?.textContent?.trim() ?? '';
      t.check('the agent board, with no kept choice and a known person, opens on Mine', header().startsWith('Mine'), header());
      project.me = null;
      await t.post({ type: 'state', model });
      t.check('edge case: the agent board with nobody known opens on Everyone', header().startsWith('Everyone'), header());
    },
  },
  {
    name: 'person filter: edge case: Mine with nothing in it says so, with Show everyone (T-143)',
    page: 'tasks',
    async run(t) {
      const p = t.data.people;
      const model = structuredClone(t.model) as typeof t.model;
      if (model.kind !== 'home') throw new Error('The person filter cases need a home model.');
      model.tasks.projects[0]!.boards[0]!.me = 'nobody-here';
      await t.post({ type: 'state', model });
      const none = () => t.find('.person-none');
      t.check('the board opens on Mine and says nothing is assigned to the person', none().textContent?.includes('Nothing assigned to you here.') === true, none().textContent);
      await t.click(t.find('.person-none button'));
      t.check('Show everyone brings the cards back, and the board stays on Everyone', t.find('.person-btn').textContent?.trim() === p.everyone && t.all('.person-none').length === 0, t.find('.person-btn').textContent);
    },
  },
  {
    name: 'person filter: edge case: a tracker board with columns and no card says nothing about the choice, on a choice that hides everything too',
    page: 'tasks',
    async run(t) {
      const p = t.data.people;
      const model = structuredClone(t.model) as typeof t.model;
      if (model.kind !== 'home') throw new Error('The person filter cases need a home model.');
      for (const c of model.tasks.projects[0]!.boards[0]!.columns) c.cards = [];
      t.remember({ filters: { [p.board]: 'person:gone' } });
      await t.post({ type: 'state', model });
      const board = t.find(`.board[data-keys="${CSS.escape(p.board)}"]`);
      t.check('the board draws its columns', t.all('section.column', board).length > 0);
      t.check('no card is drawn', t.all('article.card', board).length === 0);
      t.check('no line says a choice hides the cards', t.all('.person-none').length === 0, t.all('.person-none').length);
      t.check('the board is not made a group for that line', board.getAttribute('role') !== 'group', board.getAttribute('role'));
    },
  },
  {
    name: 'narrow card: a card of five labels shows as many as fit whole, at least one, and +N names the rest in its title (T-94)',
    page: 'tasks',
    async run(t) {
      const model = structuredClone(t.model) as typeof t.model;
      if (model.kind !== 'home') throw new Error('The narrow card case needs a home model.');
      const names = ['service', 'history', 'premium', 'audit', 'reporting'];
      const card = model.tasks.projects.flatMap((p) => p.boards).flatMap((b) => b.columns).flatMap((c) => c.cards)[0];
      if (!card) throw new Error('not found: a tracker\'s card on the Tasks board');
      card.labels = names.map((name) => ({ name, color: null }));
      // The card's width is set before each draw, as a narrow page's lane sets it, and the page draws it again.
      const sized = document.head.appendChild(document.createElement('style'));
      const draw = async (width: number) => {
        sized.textContent = `article.tcard[data-key="${CSS.escape(card.key)}"] { width: ${width}px; }`;
        await t.post({ type: 'state', model });
        const row = t.find(`article.tcard[data-key="${CSS.escape(card.key)}"] .tcard-foot .labels`);
        return { row, shown: t.all('.label:not(.label-more)', row).filter((c) => !c.hidden), more: t.find('.label-more', row) };
      };
      const whole = (c: HTMLElement) => { const n = c.querySelector<HTMLElement>('.label-name')!; return n.scrollWidth <= n.clientWidth; };
      for (const width of [150, 190, 240]) {
        const { row, shown: s, more: m } = await draw(width);
        t.check(`at ${width}px it shows at least one label and fewer than five`, s.length >= 1 && s.length < names.length, s.length);
        t.check(`at ${width}px each label it shows is whole`, s.every(whole), s.map((c) => c.textContent));
        t.check(`at ${width}px +N counts the rest and names each in its title`, !m.hidden && m.textContent === `+${names.length - s.length}` && m.title === names.slice(s.length).join(', '), [m.textContent, m.title]);
        t.check(`at ${width}px the row holds them and the +N without spilling over`, row.scrollWidth <= row.clientWidth + 1, [row.scrollWidth, row.clientWidth]);
      }
      // Edge case: a card that grows again shows every label, and no +N.
      const wide = await draw(640);
      t.check('a wide card shows all five whole, and no +N', wide.shown.length === names.length && wide.shown.every(whole) && wide.more.hidden === true, wide.shown.length);
      sized.remove();
    },
  },
  {
    name: 'changes tab: Deploy to UAT asks for the check and never deploys; More opens what moved under it (T-138)',
    page: 'ticket-deploy-deployed',
    async run(t) {
      const go = t.find<HTMLButtonElement>('.dp-go');
      t.check('the tab\'s one primary button is Deploy to UAT, and it\'s on', go.textContent === 'Deploy to UAT' && !go.disabled && t.all('[role="tabpanel"][data-tab="changes"] .btn.primary').length === 1, go.textContent);
      t.check('the path says where it is, in words', /Dev, merged.*QA, deployed.*UAT, next/.test(t.find('.dp-path').textContent ?? ''), t.find('.dp-path').textContent);
      await t.click(go);
      t.check('it asks the extension for the check, once', t.sent('deploy-check').length === 1 && t.sent('deploy-check')[0]?.to === 'uat', t.sent('deploy-check'));
      t.check('nothing deploys from the tab', t.sent('deploy-go').length === 0, t.sent('deploy-go'));
      const more = t.find<HTMLButtonElement>('.chg-more-btn');
      t.check('More is closed to start', more.getAttribute('aria-expanded') === 'false' && t.all('.chg-more-body').length === 0);
      await t.click(more);
      t.check('More opens, and holds the builder\'s deploys and what moved', t.find<HTMLButtonElement>('.chg-more-btn').getAttribute('aria-expanded') === 'true' && t.all('.chg-more-body').length === 1);
    },
  },
  {
    name: 'changes tab: Deploy sits above the list, and is off with why while its checks fail or it conflicts with dev; off, it sends nothing (T-138)',
    page: 'ticket-deploy-work',
    async run(t) {
      const panel = t.find('[role="tabpanel"][data-tab="changes"]');
      const parts = Array.from(panel.children).map((c) => c.className);
      t.check('the path and Deploy come before the list', parts.indexOf('block dp') === 0 && parts.indexOf('block chg') > 0, parts);
      const go = t.find<HTMLButtonElement>('.dp-go');
      const why = t.find('.dp-why').textContent ?? '';
      t.check('Deploy to QA is off, naming the checks that failed (validate among them) and how to clear them', go.disabled && /^The validate, .+ and .+ checks failed: fix them, or accept them anyway, first\.$/.test(why) && go.title.endsWith(why), [go.disabled, why, go.title]);
      await t.click(go);
      t.check('off, a click sends nothing', t.sent('deploy-check').length === 0 && t.sent('deploy-go').length === 0);
      // With its checks cleared, the conflict with dev holds it up, in its own words.
      const m = t.model as unknown as { deploy: { deploy: { disabled: string | null } } };
      await t.post({ type: 'state', model: { ...m, deploy: { ...m.deploy, deploy: { ...m.deploy.deploy, disabled: t.data.deployConflict } } } });
      t.check('a conflict says to take in dev first, in the model\'s own words', /^It conflicts with dev: take in dev first\.$/.test(t.data.deployConflict) && t.find('.dp-why').textContent === t.data.deployConflict && t.find<HTMLButtonElement>('.dp-go').disabled, t.data.deployConflict);
    },
  },
  {
    name: 'deploy sheet: a passed check deploys only on the sheet\'s own Deploy, with its id; Cancel sends nothing to deploy (T-138)',
    page: 'ticket-deploy-passed',
    async run(t) {
      const dialog = t.find<HTMLDialogElement>('dialog.deploy-sheet');
      t.check('the sheet is open over the tab', dialog.open);
      t.check('opening it deploys nothing', t.sent('deploy-go').length === 0, t.sent('deploy-go'));
      t.check('it says the destination, the components, the tests and what\'s by hand', /Destination.*UAT.*acme-uat.*Components.*5 components.*Tests.*By hand.*Deletions: 1.*Record changes: 1/.test(dialog.textContent ?? ''), dialog.textContent);
      const go = t.find<HTMLButtonElement>('.dsh-go', dialog);
      t.check('its Deploy is on, and says where', !go.hidden && !go.disabled && go.textContent === 'Deploy to UAT', [go.hidden, go.disabled, go.textContent]);
      await t.click(go);
      const yes = t.sent('deploy-go');
      t.check('Deploy sends the yes once, with the check\'s id', yes.length === 1 && yes[0]?.checkId === '0AfKj000003Ck9pKAC' && yes[0]?.to === 'uat' && !('typed' in yes[0]!), yes);
      // Edge: drawn again from the same model, the sheet stays as it was and sends nothing more.
      await t.post({ type: 'state', model: t.model });
      t.check('a redraw sends no second yes', t.sent('deploy-go').length === 1);
      await t.click(t.find<HTMLButtonElement>('.ds-cancel', dialog));
      t.check('Cancel closes it and tells the extension', !dialog.open && t.sent('deploy-close').length === 1, t.sent('deploy-close'));
      await t.post({ type: 'state', model: t.model });
      t.check('a draw before the extension lets go doesn\'t open it again', !dialog.open);
    },
  },
  {
    name: 'deploy sheet: a failed check says why per component and offers nothing to deploy; Escape closes it (T-138)',
    page: 'ticket-deploy-failed',
    async run(t) {
      const dialog = t.find<HTMLDialogElement>('dialog.deploy-sheet');
      t.check('the sheet is open, saying the check failed', dialog.open && /The check failed/.test(dialog.textContent ?? ''), dialog.textContent);
      const problems = t.all('.dsh-failed li', dialog);
      t.check('each component\'s problem is listed', problems.length === 2 && /CaseRouting/.test(problems[0]!.textContent ?? ''), problems.map((p) => p.textContent));
      const go = t.find<HTMLButtonElement>('.dsh-go', dialog);
      t.check('there\'s no Deploy to press, and it says why', go.hidden && go.disabled && getComputedStyle(go).display === 'none' && go.title === 'The check failed: there\'s nothing to deploy', [go.hidden, go.disabled, go.title]);
      await t.click(go);
      t.check('nothing deploys', t.sent('deploy-go').length === 0);
      t.check('its other button says Close', t.find('.ds-cancel', dialog).textContent === 'Close');
      await t.escape(dialog);
      t.check('Escape closes it and tells the extension', !dialog.open && t.sent('deploy-close').length === 1);
    },
  },
  {
    name: 'deploy sheet: Production asks for its name typed before Deploy is on, and sends what was typed (T-138)',
    page: 'ticket-deploy-typed',
    async run(t) {
      const dialog = t.find<HTMLDialogElement>('dialog.deploy-sheet');
      const go = (): HTMLButtonElement => t.find<HTMLButtonElement>('.dsh-go', dialog);
      t.check('Deploy is off until the name is typed', !go().hidden && go().disabled && go().title === 'Type Production to deploy to it', go().title);
      const box = t.find<HTMLInputElement>('.dsh-name', dialog);
      t.check('the box is named by its label', !!box.labels?.[0] && /Type Production/.test(box.labels[0]!.textContent ?? ''));
      await t.type(box, 'production');
      t.check('the name in another case keeps it off', go().disabled);
      await t.click(go());
      t.check('a click on it while off sends nothing', t.sent('deploy-go').length === 0);
      box.value = '';
      await t.type(box, 'Production');
      t.check('the exact name turns it on', !go().disabled);
      // Edge: a redraw keeps what was typed, and Deploy stays on.
      await t.post({ type: 'state', model: t.model });
      t.check('a redraw keeps the name typed', t.find<HTMLInputElement>('.dsh-name', dialog).value === 'Production' && !go().disabled);
      await t.click(go());
      const yes = t.sent('deploy-go');
      t.check('it sends the yes with the name typed', yes.length === 1 && yes[0]?.typed === 'Production' && yes[0]?.to === 'production', yes);
    },
  },
  {
    name: 'working: a card\'s Clean up says Cleaning up… at once, busy, not to be pressed again and keeping focus, until the extension answers; its question puts it back, a yes works again, a refusal says why on the card, and a cancel leaves it as it was (T-147)',
    page: 'tasks',
    async run(t) {
      const model = t.model;
      if (model.kind !== 'home') throw new Error('The working case needs a home model.');
      const root = model.tasks.projects[0]!.root;
      const card = model.tasks.projects[0]!.columns.find((c) => c.group === 'done')!.cards[0]!;
      const clean = card.actions.find((a) => a.command === 'acc.task.cleanup' && a.primary);
      if (!clean) throw new Error(`not found: ${card.id}'s Clean up, its next step`);
      t.remember({ modes: { [root]: 'agents' } });
      await t.post({ type: 'state', model });
      const button = (): HTMLButtonElement => t.find<HTMLButtonElement>(`section.column article.card[data-task="${CSS.escape(card.id)}"] .ta-btn.primary`);
      const looks = () => ({ text: button().textContent?.trim(), busy: button().getAttribute('aria-busy'), off: button().getAttribute('aria-disabled') === 'true', spin: !!button().querySelector('.codicon-modifier-spin') });
      t.check(`${card.id}'s next step is Clean up`, JSON.stringify(looks()) === JSON.stringify({ text: 'Clean up', busy: null, off: false, spin: false }), looks());
      await t.click(button());
      t.check('a click sends Clean up once', JSON.stringify(t.sent('run')) === JSON.stringify([{ type: 'run', command: clean.command, ref: clean.ref }]), t.sent('run'));
      t.check('at once, before any answer: it spins, says Cleaning up…, is busy and can\'t be pressed', JSON.stringify(looks()) === JSON.stringify({ text: 'Cleaning up…', busy: 'true', off: true, spin: true }), looks());
      t.check('the same button keeps focus while it works, so what it opens can give focus back', document.activeElement === button(), document.activeElement?.className);
      await t.click(button());
      t.check('a second click sends nothing', t.sent('run').length === 1, t.sent('run').length);
      // Edge: the extension's next poll redraws the board while it waits.
      await t.post({ type: 'state', model });
      t.check('a redraw while it waits keeps it working', looks().text === 'Cleaning up…' && looks().off, looks());
      const ran = (phase: string, more: Record<string, unknown> = {}) => t.post({ type: 'ran', command: clean.command, ref: clean.ref, phase, ...more });
      await ran('asked');
      t.check('the question opened: the button is back', JSON.stringify(looks()) === JSON.stringify({ text: 'Clean up', busy: null, off: false, spin: false }), looks());
      await ran('running');
      t.check('a yes: it works again until the result', looks().text === 'Cleaning up…' && looks().spin, looks());
      const why = 'Kept the worktree: The worktree has 2 uncommitted change(s).';
      await ran('done', { ok: false, error: why });
      const refused = t.find(`section.column article.card[data-task="${CSS.escape(card.id)}"] .run-refused`);
      t.check('refused: back, and the card says why', looks().text === 'Clean up' && !looks().off && refused.textContent === why, refused.textContent);
      t.check('and it stays in Done', !!t.find('section.column[data-group="done"]').querySelector(`:scope > article.card[data-task="${CSS.escape(card.id)}"]`));
      await t.click(button());
      t.check('tried again: the old reason goes at once', t.all('.run-refused').length === 0 && looks().text === 'Cleaning up…');
      await ran('asked');
      await ran('done', { ok: true });
      t.check('cancelled: as it was, with nothing said', JSON.stringify(looks()) === JSON.stringify({ text: 'Clean up', busy: null, off: false, spin: false }) && t.all('.run-refused').length === 0, looks());
    },
  },
  {
    name: 'working: a task Clean up removed leaves Done at once, on the extension\'s answer alone, for the closed Cleaned up fold at the lane\'s foot, which opens to show it (T-147)',
    page: 'tasks',
    async run(t) {
      const model = t.model;
      if (model.kind !== 'home') throw new Error('The fold case needs a home model.');
      const root = model.tasks.projects[0]!.root;
      const done = model.tasks.projects[0]!.columns.find((c) => c.group === 'done')!;
      const card = done.cards[0]!;
      const clean = card.actions.find((a) => a.command === 'acc.task.cleanup')!;
      const before = done.cleaned?.length ?? 0;
      t.check('the sample has cleaned-up tasks to fold', before > 0, before);
      t.remember({ modes: { [root]: 'agents' }, opened: [] });
      await t.post({ type: 'state', model });
      const lane = () => t.find('section.column[data-group="done"]');
      const inLane = () => [...lane().querySelectorAll<HTMLElement>(':scope > article.card')].map((a) => a.dataset.task);
      const fold = () => t.find<HTMLDetailsElement>('details.done-fold', lane());
      t.check('Done holds the tasks still to clean up', JSON.stringify(inLane()) === JSON.stringify(done.cards.map((c) => c.id)), inLane());
      t.check('under them, the fold, closed, counting the rest', !fold().open && fold().querySelector('summary')?.textContent?.trim() === `Cleaned up (${before})`, fold().querySelector('summary')?.textContent);
      t.check('the lane counts what it shows', lane().querySelector('.count')?.textContent === String(done.cards.length));
      await t.click(t.find(`article.card[data-task="${CSS.escape(card.id)}"] .ta-btn.primary`, lane()));
      for (const phase of ['asked', 'running']) await t.post({ type: 'ran', command: clean.command, ref: clean.ref, phase });
      await t.post({ type: 'ran', command: clean.command, ref: clean.ref, phase: 'done', ok: true, cleaned: true });
      t.check('acc\'s answer alone takes it out of the lane', !inLane().includes(card.id), inLane());
      t.check('into the fold, which still counts it and stays closed', !fold().open && fold().querySelector('summary')?.textContent?.trim() === `Cleaned up (${before + 1})`, fold().querySelector('summary')?.textContent);
      t.check('the lane counts one fewer', lane().querySelector('.count')?.textContent === String(done.cards.length - 1), lane().querySelector('.count')?.textContent);
      // Edge: the extension's next poll still holds the old model, read before acc changed the record.
      await t.post({ type: 'state', model });
      t.check('a model from before the cleanup doesn\'t bring it back', !inLane().includes(card.id), inLane());
      await t.click(t.find('summary', fold()));
      t.check('the fold opens', fold().open);
      const folded = [...fold().querySelectorAll<HTMLElement>('.done-fold-cards > article.card')].map((a) => a.dataset.task);
      t.check('and shows it first, then the rest', folded[0] === card.id && folded.length === before + 1, folded);
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
  { name: 'the button shows nothing while it waits', file: 'working.ts', find: 'const on = !!working.what(was.key);', replace: 'const on = false;', kills: [caseNamed('working: a card\'s Clean up says Cleaning up…')] },
  { name: 'a cleaned-up task stays in Done', file: 'working.ts', find: 'cleaned.add(cleanedKey(msg.ref.project, msg.ref.task));', replace: 'void 0;', kills: [caseNamed('working: a task Clean up removed leaves Done')] },
  { name: 'a note is drawn as one paragraph again', file: 'task-page.ts', find: "if (!n.shape) return foldable(key, el('div', 'notice attention why',", replace: "if (n) return foldable(key, el('div', 'notice attention why',", kills: [caseNamed('task page: a blocked note recorded as one paragraph')] },
  // Set up cloud builders (T-145): Next on before its step passes, the token kept in the page, and a field's button on before what's typed fits.
  { name: 'cloud setup: Next goes on before the step passes', file: 'cloud-setup.ts', find: 'go.disabled = m.next ? !m.next.can : !m.cancel.can;', replace: 'go.disabled = false;', kills: [caseNamed('cloud setup: Next stays off')] },
  { name: 'cloud setup: the token is written to the tab\'s memory', file: 'cloud-setup.ts', find: "  if (action === 'keepToken') cloudTyped.delete(`${m.id}:token`);", replace: "  if (action === 'keepToken') api.setState({ ...(api.getState() as object), token: value });", kills: [caseNamed('cloud setup: the token is typed hidden')] },
  { name: 'cloud setup: Keep the token goes on before the token fits', file: 'cloud-setup.ts', find: "const off = f.keep.disabled ?? (fits ? null : v.trim() ? f.problem : `Paste the ${f.label.toLowerCase()} first`);", replace: 'const off = f.keep.disabled;', kills: [caseNamed('cloud setup: the token is typed hidden')] },
  { name: 'a failed check isn\'t named in the summary', file: 'agent-glance.ts', find: 'failed.length ? `${failed.length} failed: ${names(failed)}` : null,', replace: 'failed.length ? `${failed.length} failed` : null,', kills: [caseNamed('task page: the Agent panel says its checks')] },
  { name: 'Details doesn\'t stay open once opened', file: 'agent-panel.ts', find: 'd.open = memory().opened.includes(key);', replace: 'd.open = false;', kills: [caseNamed('task page: the Agent panel says its checks')] },
  { name: 'a collapsed section doesn\'t stay collapsed', file: 'collapse.ts', find: 'show(memory().folded.includes(k));', replace: 'show(false);', kills: [caseNamed('task page: a Command Center section collapses')] },
  { name: 'a tab that needs you doesn\'t say so', file: 'task-tabs.ts', find: "t.needs ? el('span', 'task-tab-needs', icon('bell', 'orange'), NEEDS_YOU) : null", replace: 'null', kills: [caseNamed('task page: its tabs open on the plan')] },
  { name: 'a review that needs you doesn\'t say so on its tab', file: 'tab-rules.ts', find: 'orange(m.review.look)', replace: 'null', kills: [caseNamed('task page: a review lists its findings')] },
  { name: 'the opening tab ignores what needs you', file: 'tab-rules.ts', find: '  if (needs) return needs;\n', replace: '', kills: [caseNamed('task page: its tabs open on the plan')] },
  { name: 'the arrow keys move between no tabs', file: 'task-tabs.ts', find: "      if (to < 0) return;\n", replace: '      return;\n', kills: [caseNamed('task page: its tabs open on the plan')] },
  { name: 'Enter and Space on a section\'s button do nothing', file: 'collapse.ts', find: "if (e.key !== 'Enter' && e.key !== ' ') return;", replace: 'return;', kills: [caseNamed('task page: a Command Center section collapses')] },
  { name: 'typing in the board list finds nothing', file: 'board-switch.ts', find: "find.addEventListener('input', () => { typed.set(root, find.value); fill(find.value); });", replace: "find.addEventListener('input', () => { typed.set(root, find.value); });", kills: [caseNamed('board switch: ten boards')] },
  { name: 'All boards with one opened fills the page\'s height', file: 'main.ts', find: " && main.querySelectorAll('.tracker').length <= 1) main.classList.add('fill-board');", replace: ") main.classList.add('fill-board');", kills: [caseNamed('board switch: ten boards')] },
  { name: 'Enter in the board list\'s box picks nothing', file: 'board-switch.ts', find: "items.querySelector<HTMLElement>('.board-group .board-item')?.click();", replace: '', kills: [caseNamed('board switch: ten boards')] },
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
  { name: 'Enter on a line\'s link opens nothing', file: 'landing.ts', find: "title.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });", replace: '', kills: [caseNamed('detail modal: Enter on a line')] },
  { name: 'the activity names no fields in a person\'s edit', file: 'task-page.ts', find: 'el(\'span\', \'\', `edited its ${e.fields}`)', replace: 'el(\'span\', \'\', \'edited it\')', kills: [caseNamed('task modal: Activity draws a person')] },
  { name: 'History never asks for its next page', file: 'history.ts', find: "        ask();\n        end.textContent = 'Loading…';\n", replace: "        end.textContent = 'Loading…';\n", kills: [caseNamed('overview: History loads its next page')] },
  { name: 'History drops the page the extension sends', file: 'history.ts', find: '      loaded = next;\n', replace: '      void next;\n', kills: [caseNamed('overview: History loads its next page')] },
  { name: 'History shows a filter from All\'s first page, never asking for its own', file: 'history-store.ts', find: "    : { filter, items: [], more: true, waiting: true, counts: first.counts };", replace: "    : { filter, items: first.items.filter((i) => historyKind(i) === filter), more: false, waiting: false, counts: first.counts };", kills: [caseNamed('overview: History loads its next page')] },
  { name: 'History opened at an entry it hasn\'t loaded asks for nothing', file: 'history.ts', find: '    sought = at;\n    ask(at);\n', replace: '    sought = at;\n', kills: [caseNamed('overview: History loads its next page')] },
  { name: 'History opened at an entry opens at none', file: 'detail.ts', find: 'renderHistory(o.history, o.projects.length > 1, d.at)', replace: 'renderHistory(o.history, o.projects.length > 1)', kills: [caseNamed('overview: History loads its next page')] },
  { name: 'a late close event closes History the tab remembered open again', file: 'detail.ts', find: 'if (!m.dialog.open && drawn !== null && memory().detail) closeDetail();', replace: 'if (!m.dialog.open && memory().detail) closeDetail();', kills: [caseNamed('overview: History loads its next page')] },
  { name: 'History jumps when new entries come in above', file: 'detail.ts', find: '  keep();\n  place();\n', replace: '  keep();\n', kills: [caseNamed('overview: History loads its next page')] },
  { name: 'Clear leaves the group on the page', file: 'since.ts', find: '    box.remove();\n', replace: '', kills: [caseNamed('overview: Since you last looked')] },
  { name: 'Clear tells the extension nothing', file: 'since.ts', find: "    api.postMessage({ type: 'toolbar', command: g.clear.command });\n", replace: '', kills: [caseNamed('overview: Since you last looked')] },
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
  { name: 'a finding\'s file and line sends nothing', file: 'review.ts', find: "b.addEventListener('click', () => api.postMessage({ type: 'review-file', ...opens }));", replace: "b.addEventListener('click', () => void opens);", kills: [caseNamed('task page: a review lists its findings'), caseNamed('output panel: a review')] },
  { name: 'the output panel drops the verdict and shows only the lines', file: 'dock.ts', find: 'const body = open && review ? renderDockReview(run.id, review, redrawDock) : null;', replace: 'const body = null;', kills: [caseNamed('output panel: a review')] },
  { name: 'a review\'s row opens nothing', file: 'dock-review.ts', find: "toggle.addEventListener('click', () => flip(key, redraw));\n  const li = el('li', `dr-row tone-row", replace: "const li = el('li', `dr-row tone-row", kills: [caseNamed('output panel: a review')] },
  { name: 'a review\'s next step sends nothing', file: 'dock-review.ts', find: "b.addEventListener('click', () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }));", replace: "b.addEventListener('click', () => void a);", kills: [caseNamed('output panel: a review')] },
  { name: 'the output panel shows the raw lines again', file: 'run-view.ts', find: "const box = el('div', 'dock-body', ...body,", replace: "const box = el('div', 'dock-body', el('pre', 'dock-out', run.lines.join('\\n')),", kills: [caseNamed('output panel: a run shows as rows')] },
  { name: 'a failed step opens to nothing', file: 'run-steps.ts', find: "head.addEventListener('click', () => toggle(key, open));", replace: '', kills: [caseNamed('output panel: a run of acc lists its steps')] },
  { name: 'the folded output stays folded', file: 'run-steps.ts', find: "fold.addEventListener('click', () => toggle(key, open));", replace: '', kills: [caseNamed('output panel: a run of acc lists its steps')] },
  { name: 'Details shows nothing', file: 'dock.ts', find: 'if (open && shown) dock.append(details(run));', replace: '', kills: [caseNamed('output panel: a run shows as rows')] },
  { name: 'Copy log sends nothing', file: 'dock.ts', find: "if (a.command !== 'details') { control(a.command); return; }", replace: "if (a.command !== 'details') return;", kills: [caseNamed('output panel: a run shows as rows')] },
  { name: 'a path chip opens nothing', file: 'run-view.ts', find: "b.addEventListener('click', () => api.postMessage({ type: 'run-file', run, file: opens, ...(p.line ? { line: p.line } : {}) }));", replace: "b.addEventListener('click', () => void opens);", kills: [caseNamed('output panel: a run shows as rows')] },
  { name: 'the result card\'s button sends nothing', file: 'run-view.ts', find: "if (n.kind === 'rerun') { api.postMessage({ type: 'run-control', run: run.id, action: 'rerun' }); return; }", replace: "if (n.kind === 'rerun') return;", kills: [caseNamed('output panel: a run shows as rows')] },
  { name: 'Show output does nothing', file: 'dock.ts', find: 'x.opened = lines ? x.opened.filter((y) => y !== k) : [...x.opened, k];', replace: '', kills: [caseNamed('output panel: a review')] },
  { name: 'a section\'s jump goes nowhere', file: 'settings.ts', find: "a.addEventListener('click', (e) => { (e as Event).preventDefault(); jump(s.id); });", replace: "a.addEventListener('click', (e) => { (e as Event).preventDefault(); });", kills: [caseNamed('settings: the jump list')] },
  { name: 'a jump never scrolls to its section', file: 'settings.ts', find: 'if (heading) scrollToHeading(heading);', replace: 'heading?.focus({ preventScroll: true });', kills: [caseNamed('settings: the jump list')] },
  { name: 'the section shown is forgotten on a redraw', file: 'settings.ts', find: 'sections.find((s) => s.id === memory().settings) ?? sections[0]', replace: 'sections[0]', kills: [caseNamed('settings: the jump list')] },
  { name: 'a deep link leaves its part\'s section hidden', file: 'state.ts', find: "heading.closest<HTMLElement>('[hidden]')?.dispatchEvent(new Event('reveal'));", replace: '', kills: [caseNamed('settings: the jump list')] },
  { name: 'every explanation stays in view', file: 'dom.ts', find: 'if (!folded.includes(id)) return', replace: 'if (text) return', kills: [caseNamed('settings: the jump list')] },
  { name: 'an opened explanation closes on a redraw', file: 'dom.ts', find: 'd.dataset.fold = id;\n  return d;', replace: 'd.dataset.fold = id;\n  d.open = false;\n  return d;', kills: [caseNamed('settings: the jump list')] },
  { name: 'the Connect modal draws no status line beside Next', file: 'connect.ts', find: "el('div', 'connect-foot-why', why ? status(why) : null)", replace: "el('div', 'connect-foot-why', null)", kills: [caseNamed('connect: Next that is off')] },
  { name: 'the Connect modal leaves Next\'s title empty', file: 'connect.ts', find: 'if (go.disabled && why) go.title = why.label;', replace: '', kills: [caseNamed('connect: Next that is off'), caseNamed('connect: the board under the dropdowns')] },
  { name: 'Next goes on before the board is read', file: 'connect.ts', find: 'go.disabled = m.next ? !m.next.can : !m.save.can;', replace: 'go.disabled = m.next ? false : !m.save.can;', kills: [caseNamed('connect: Next that is off'), caseNamed('connect: the board under the dropdowns')] },
  { name: 'the preview draws no board', file: 'choose-board.ts', find: 'const board = p.board ? el(', replace: 'const board = p.board && false ? el(', kills: [caseNamed('connect: the board under the dropdowns')] },
  { name: 'the preview doesn\'t follow the dropdown: one choice is never sent', file: 'dropdown.ts', find: "connectSend(m, { type: 'connect-pick', key: p.key, value: value || null });", replace: '{}', kills: [caseNamed('connect: the board under the dropdowns')] },
  { name: 'the preview doesn\'t follow the dropdown: ticks are never sent', file: 'dropdown.ts', find: "connectSend(m, { type: 'connect-pick', key: p.key, value: next });", replace: '', kills: [caseNamed('connect: the board under the dropdowns')] },
  { name: 'picking writes the settings before Save', file: 'dropdown.ts', find: "connectSend(m, { type: 'connect-pick', key: p.key, value: next });", replace: "connectSend(m, { type: 'connect-pick', key: p.key, value: next }); connectSend(m, { type: 'connect-save' });", kills: [caseNamed('connect: the board under the dropdowns')] },
  { name: 'a dropdown\'s search hides nothing', file: 'dropdown.ts', find: "return all.filter((o) => !q || !o.value || `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q));", replace: 'return all;', kills: [caseNamed('connect: the board under the dropdowns')] },
  { name: 'Cancel saves', file: 'connect.ts', find: "const cancel = button('Cancel', 'close', () => connectSend(m, { type: 'connect-cancel' }), 'ghost');", replace: "const cancel = button('Cancel', 'close', () => connectSend(m, { type: 'connect-save' }), 'ghost');", kills: [caseNamed('connect: Back and Next move')] },
  { name: 'Back goes nowhere', file: 'connect.ts', find: "const back = i > 0 ? button('Back', 'arrow-left', () => connectSend(m, { type: 'connect-step', step: m.steps[i - 1]!.id }), 'ghost') : null;", replace: "const back = i > 0 ? button('Back', 'arrow-left', () => {}, 'ghost') : null;", kills: [caseNamed('connect: Back and Next move')] },
  { name: 'Escape leaves the modal without a word', file: 'connect.ts', find: "  if (drawn) connectSend(drawn, { type: 'connect-cancel' });", replace: '', kills: [caseNamed('connect: Back and Next move')] },
  { name: 'the Connect modal draws no status line beside Test connection', file: 'connect.ts', find: 'm.signIn.why ? status(m.signIn.why) : null', replace: 'null', kills: [caseNamed('connect: while it signs in')] },
  { name: 'the Connect modal leaves Test connection\'s title empty', file: 'connect.ts', find: 'if (m.signIn.why) testButton.title = m.signIn.why.label;', replace: '', kills: [caseNamed('connect: while it signs in')] },
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
  { name: 'a person\'s choice shows every card', file: 'person-filter.ts', find: 'return people.some((p) => PERSON + p.key === c);', replace: 'return true;', kills: [caseNamed('person filter: the menu'), caseNamed('person filter: Down and Right')] },
  { name: 'a board draws every card, whatever the filter shows', file: 'tasks.ts', find: "const cards = c.cards.filter(showing);\n    const col = el('section', `column tone-edge-${c.tone}${c.done ?", replace: "const cards = c.cards;\n    const col = el('section', `column tone-edge-${c.tone}${c.done ?", kills: [caseNamed('person filter: the menu'), caseNamed('person filter: Down and Right'), caseNamed('person filter: a board where no card')] },
  { name: 'a board forgets its choice on a redraw', file: 'person-menu.ts', find: 'const kept = memory().filters?.[key];', replace: 'const kept: string | undefined = undefined;', kills: [caseNamed('person filter: the menu'), caseNamed('person filter: Down and Right')] },
  { name: 'a board with no card says a choice hides them', file: 'tasks.ts', find: 'if (b.columns.some((c) => c.cards.length) && !b.columns.some((c) => c.cards.some(showing))) out.append', replace: 'if (!b.columns.some((c) => c.cards.some(showing))) out.append', kills: [caseNamed('person filter: edge case: a tracker board')] },
  { name: 'a board with a known person opens on Everyone', file: 'person-filter.ts', find: '(!choice ? (me ? MINE : EVERYONE)', replace: '(!choice ? EVERYONE', kills: [caseNamed('person filter: a board opens on Mine'), caseNamed('person filter: board switching'), caseNamed('person filter: the agent board'), caseNamed('person filter: edge case: Mine with nothing')] },
  { name: 'Show everyone does nothing', file: 'person-menu.ts', find: "back.addEventListener('click', () => keep(key, EVERYONE));", replace: "back.addEventListener('click', () => {});", kills: [caseNamed('person filter: a board where no card')] },
  { name: 'the board\'s live line stays silent', file: 'board-nav.ts', find: "live.replaceChildren(icon(look.icon, look.tone), el('span', '', text));", replace: 'void look;', kills: [caseNamed('board keys: Space, Right and Enter'), caseNamed('board keys: Escape'), caseNamed('board keys: Space on a card')] },
  { name: 'Dispatch goes without the sheet', file: 'dispatch-sheet.ts', find: "receive: { 'dispatch-sheet': (msg: { sheet?: DispatchSheet }) => { if (msg.sheet?.models?.length) openSheet(msg.sheet); } },", replace: "receive: { 'dispatch-sheet': (msg: { sheet?: DispatchSheet }) => { if (msg.sheet?.models?.length) api.postMessage({ type: 'dispatch-sheet-go', project: msg.sheet.project, task: msg.sheet.task, model: msg.sheet.models[0]!.value, where: msg.sheet.place }); } },", kills: [caseNamed('dispatch sheet: a card'), caseNamed('dispatch sheet: the task page')] },
  { name: 'Escape on the task sheet saves', file: 'task-sheet.ts', find: "const m = makeModal('task-sheet', [heading], shut);", replace: "const m = makeModal('task-sheet', [heading], save);", kills: [caseNamed('task sheet: a Jira task')] },
  { name: 'Enter in the description saves', file: 'task-sheet.ts', find: '    if (e.target instanceof HTMLTextAreaElement && !e.metaKey && !e.ctrlKey) return;\n', replace: '', kills: [caseNamed('task sheet: a new task')] },
  { name: 'the task sheet\'s Save drops the notes typed', file: 'task-sheet.ts', find: "labels: v('labels'), notes: v('notes') };", replace: "labels: v('labels'), notes: s.fields.notes };", kills: [caseNamed('task sheet: a manual task')] },
  { name: 'the task sheet saves with no title', file: 'task-sheet.ts', find: ": !written().title.trim() ? 'A task needs a title'\n", replace: '\n', kills: [caseNamed('task sheet: a new task')] },
  { name: 'the task sheet saves with a wording finding to fix', file: 'task-sheet.ts', find: "  : open?.wording?.hard && briefChanged() ? `Fix the wording of the acceptance criteria first: ${plural(open.wording.hard, 'finding')}` : null);", replace: '  : null);', kills: [caseNamed('task sheet: each wording finding')] },
  { name: 'the task sheet holds Save for a description left as it was', file: 'task-sheet.ts', find: '  : open?.wording?.hard && briefChanged() ?', replace: '  : open?.wording?.hard ?', kills: [caseNamed('task sheet: each wording finding')] },
  { name: 'the task sheet never asks for the wording check again', file: 'task-sheet.ts', find: "  if (key === 'brief' && open!.wording) b.addEventListener('input', askWording);\n", replace: '', kills: [caseNamed('task sheet: each wording finding')] },
  { name: 'the task sheet takes an answer for older text', file: 'task-sheet.ts', find: ' || msg.wording.brief !== written().brief) return;', replace: ') return;', kills: [caseNamed('task sheet: each wording finding')] },
  { name: 'the task sheet shows no wording findings', file: 'task-sheet.ts', find: '  at.replaceChildren(...wordingParts(open.wording));\n', replace: '', kills: [caseNamed('task sheet: each wording finding')] },
  { name: 'the task sheet closes before its ticket answers', file: 'task-sheet.ts', find: '  if (!open.base) return shut();\n', replace: '  return shut();\n', kills: [caseNamed('task sheet: with edits on')] },
  { name: 'Add the draft leaves the description as it was', file: 'task-sheet.ts', find: '  open.sheet = { ...open.sheet, fields: { ...written(), brief: below(written().brief, section) } };', replace: '  open.sheet = { ...open.sheet, fields: written() };', kills: [caseNamed('task sheet: drafted acceptance criteria')] },
  { name: 'a failed draft says nothing', file: 'task-sheet.ts', find: "  open.error = msg.error || 'The draft didn\\'t come back.';", replace: '  open.error = null;', kills: [caseNamed('task sheet: drafted acceptance criteria')] },
  { name: 'Open as an update asks for the sheet', file: 'criteria.ts', find: "    ...(c.update ? [action(m, c, c.update, 'criteria-update', 'comment-draft', false)] : []),", replace: "    ...(c.update ? [action(m, c, c.update, 'criteria-sheet', 'comment-draft', false)] : []),", kills: [caseNamed('task page: a draft shows')] },
  { name: 'Got it leaves the first steps unremembered', file: 'first-steps.ts', find: '    remember((m) => { m.firstStepsSeen = true; });', replace: '', kills: [caseNamed('first steps: Got it hides')] },
  { name: 'a failed draft section button forgets why', file: 'ticket-asks.ts', find: '    this.pending.settle(key, msg.ok ? null : msg.error?.trim() || NO_REASON);', replace: '    this.pending.settle(key, null);', kills: [caseNamed('task page: a draft shows')] },
  { name: 'a failed Save closes the task sheet', file: 'task-sheet.ts', find: '  if (msg.ok) return shut();\n', replace: '  return shut();\n', kills: [caseNamed('task sheet: with edits on')] },
  { name: 'Keep mine saves against the text the sheet opened with', file: 'task-sheet.ts', find: '  open.base = open.theirs;\n  open.theirs = null;\n  save();', replace: '  open.theirs = null;\n  save();', kills: [caseNamed('task sheet: with edits on')] },
  { name: 'Escape on the sheet dispatches', file: 'dispatch-sheet.ts', find: "const m = makeModal('dispatch-sheet', [title], shut);", replace: "const m = makeModal('dispatch-sheet', [title], dispatch);", kills: [caseNamed('dispatch sheet: the task page')] },
  { name: 'Enter on the sheet does nothing', file: 'dispatch-sheet.ts', find: '    e.preventDefault();\n    dispatch();\n', replace: '    e.preventDefault();\n', kills: [caseNamed('dispatch sheet: a card')] },
  { name: 'a model picked leaves the efforts as they were', file: 'dispatch-sheet.ts', find: '(i) => { open!.model = i; draw(); }', replace: '(i) => { void i; draw(); }', kills: [caseNamed('dispatch sheet: a card')] },
  { name: 'the sheet dispatches with no model name', file: 'dispatch-sheet.ts', find: "const goOff = (): string | null => (modelName() === null ?", replace: "const goOff = (): string | null => (modelName() === undefined ?", kills: [caseNamed('dispatch sheet: Another model')] },
  { name: 'the sheet leaves out why the cloud is off', file: 'dispatch-sheet.ts', find: "off ? el('p', 'ds-note muted', icon('info'), el('span', '', off.disabled!)) : null", replace: 'null', kills: [caseNamed('dispatch sheet: the task page')] },
  { name: 'a redraw drops the focused card\'s focus', file: 'board-nav.ts', find: 'if (again) focusOf(again).focus({ preventScroll: true });', replace: '', kills: [caseNamed('board keys: focus stays')] },
  { name: 'a card shows every label, cut short, whatever its width', file: 'fit-labels.ts', find: 'show(chips, more, names, labelsThatFit(widths, room, gap, plus));', replace: 'show(chips, more, names, chips.length);', kills: [caseNamed('narrow card:')] },
  { name: 'a card never measures its labels', file: 'fit-labels.ts', find: '  setTimeout(fit, 0);\n  observer.observe(row);\n', replace: '', kills: [caseNamed('narrow card:')] },
  // A change to an approved plan's choice asks first (T-97).
  { name: 'Enter confirms but stays on its step', file: 'review-plan.ts', find: '  goTo(next(review, s.id));\n}', replace: '  redraw();\n}', kills: [caseNamed('review plan:')] },
  { name: 'the agent\'s questions all show at once', file: 'talk-questions.ts', find: '    at === REVIEW ? reviewStep(c) : questionStep(c, at),\n', replace: "    at === REVIEW ? reviewStep(c) : questionStep(c, at),\n    ...q.items.map((x, k) => (k === at ? null : el('div', 'rp-step', el('h3', 'rp-q', md(x.question))))),\n", kills: [caseNamed('questions:')] },
  { name: 'Next question sends the answers', file: 'talk-questions.ts', find: '  if (!memory().drafts[pickKey(c.b, at)] && shown !== OWN) pick(c, at, shown);\n', replace: '  if (!memory().drafts[pickKey(c.b, at)] && shown !== OWN) pick(c, at, shown);\n  c.send.go(c.q.turn, answersOf(c.b, c.q));\n', kills: [caseNamed('questions:')] },
  { name: 'Back on a question forgets what was picked', file: 'talk-questions.ts', find: '  else if (at > 0) goTo(c, at - 1);', replace: "  else if (at > 0) { remember((x) => { for (const key of Object.keys(x.drafts)) if (key.includes(':pick:')) delete x.drafts[key]; }); goTo(c, at - 1); }", kills: [caseNamed('questions:')] },
  { name: 'a dot move drops the answer', file: 'talk-questions.ts', find: ', dots, (k) => goTo(c, k), name)', replace: ', dots, (k) => { remember((x) => { delete x.drafts[pickKey(c.b, Number(at))]; }); goTo(c, k); }, name)', kills: [caseNamed('questions:')] },
  { name: 'Back forgets what was picked', file: 'review-plan.ts', find: 'if (i > 0) goTo(review.steps[i - 1]!.id);', replace: "if (i > 0) { remember((x) => { for (const k of Object.keys(x.drafts)) if (k.includes(':pick:')) delete x.drafts[k]; }); goTo(review.steps[i - 1]!.id); }", kills: [caseNamed('review plan:')] },
  { name: 'Escape forgets what was picked', file: 'review-plan.ts', find: '  if (shown) toggle(openKey(shown.m.project, shown.task), false);\n', replace: "  if (shown) toggle(openKey(shown.m.project, shown.task), false);\n  remember((x) => { for (const k of Object.keys(x.drafts)) if (k.includes(':pick:')) delete x.drafts[k]; });\n", kills: [caseNamed('review plan:')] },
  { name: 'Approve is on with an item left', file: 'plan.ts', find: '  b.disabled = !!why;\n  if (why) { b.title = why;', replace: '  b.disabled = false;\n  if (why) { b.title = why;', kills: [caseNamed('review plan:')] },
  { name: 'an approved plan\'s choice goes without asking', file: 'plan.ts', find: 'if (!plan.changeAsk || same) return sendPlan(', replace: 'if (plan || same) return sendPlan(', kills: [caseNamed('plan: on an approved plan')] },
  { name: 'Keep the approval makes the change', file: 'plan.ts', find: "button('Keep the approval', 'verified', keep)", replace: "button('Keep the approval', 'verified', change)", kills: [caseNamed('plan: on an approved plan')] },
  { name: 'Escape in the plan\'s dialog does nothing', file: 'plan.ts', find: "if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); keep();", replace: "if (e.key !== 'Escape') return;", kills: [caseNamed('plan: on an approved plan')] },
  { name: 'Keep the approval leaves focus where it falls', file: 'plan.ts', find: '    focusNext = confirmKey(key, pickId);\n', replace: '', kills: [caseNamed('plan: on an approved plan')] },
  { name: 'the plan\'s dialog takes no focus', file: 'plan.ts', find: "focusOnceDrawn(no, confirmKey(key, 'keep'));", replace: '', kills: [caseNamed('plan: on an approved plan')] },
  { name: 'Use this on an approved plan goes without asking', file: 'talk.ts', find: 'if (p.ask && !yes) {', replace: 'if (false) {', kills: [caseNamed('talk: on an approved plan')] },
  { name: 'Escape in Use this\'s question does nothing', file: 'talk.ts', find: "if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); keep();", replace: "if (e.key !== 'Escape') return;", kills: [caseNamed('talk: on an approved plan')] },
  { name: 'Keeping the approval leaves focus where it falls', file: 'talk.ts', find: '); focusUse = key; redraw(); };', replace: '); redraw(); };', kills: [caseNamed('talk: on an approved plan')] },
  { name: 'Change it in Use this\'s question sends no yes', file: 'talk.ts', find: 'use(project, s, t, p, true); };', replace: 'use(project, s, t, p); };', kills: [caseNamed('talk: on an approved plan')] },
  { name: 'Ctrl+Enter in the message box sends nothing', file: 'talk.ts', find: "(e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }", replace: "(e.metaKey || e.ctrlKey)) { e.preventDefault(); }", kills: [caseNamed('talk: on an approved plan')] },
  { name: 'The task page draws the conversation\'s turns', file: 'talk.ts', find: "const line = el('div', 'convo-line', icon('comment-discussion'),", replace: "const line = el('div', 'convo-line', ...s.turns.map((x) => turn(project, s, x)), icon('comment-discussion'),", kills: [caseNamed('conversation: the task page shows')] },
  { name: 'Make a plan on the task page asks for another command', file: 'dom.ts', find: "api.postMessage({ type: 'run', command: a.command, ref: a.ref })", replace: "api.postMessage({ type: 'run', command: a.command === 'acc.task.analyze' ? 'acc.task.show' : a.command, ref: a.ref })", kills: [caseNamed('conversation: Make a plan on the task page')] },
  { name: 'Draft the plan ignores the opening conversation', file: 'talk.ts', find: "api.postMessage({ type: 'conversation-draft', project, task: s.task }), s.draft.disabled", replace: "api.postMessage({ type: 'conversation-draft', project, task: s.task, skip: true }), s.draft.disabled", kills: [caseNamed('conversation: the panel opens at its question')] },
  { name: 'Post sends what was attached before the person changed it', file: 'report.ts', find: 'body: issueBody(t.fields) });', replace: 'body: issueBody({ ...t.fields, attached: m.attached }) });', kills: [caseNamed('report:')] },
  { name: 'the draft is sent as it is typed', file: 'report.ts', find: 'keep(s.id, b.value); update(); });', replace: "keep(s.id, b.value); update(); api.postMessage({ type: 'report-post', title: t.title, body: issueBody(t.fields) }); });", kills: [caseNamed('report:')] },
  { name: 'the plan section keeps Make a new plan beside a conversation', file: 'analysis.ts', find: 'const actions = m.talk?.newPlan ? a.actions.filter((x) => x.command !== m.talk!.newPlan!.command) : a.actions;', replace: 'const actions = a.actions;', kills: [caseNamed('ticket talk: beside a conversation the plan section')] },
  { name: 'Enter alone sends the message', file: 'talk.ts', find: "if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))", replace: "if (e.key === 'Enter')", kills: [caseNamed('talk: on an approved plan')] },
  { name: 'a made choice still draws every card', file: 'plan.ts', find: 'const full = !d.choice || compared', replace: 'const full = true || compared', kills: [caseNamed('plan tab: a made choice is one line')] },
  { name: 'a choice waiting on the person is folded away', file: 'analysis.ts', find: '!!p && p.decisions.some((d) => choiceWaits(m, a.task, p, d))', replace: 'false', kills: [caseNamed('plan tab: a made choice is one line')] },
  { name: 'a section the person closed opens again on the next draw', file: 'analysis.ts', find: '(waits && !opened.includes(shut))', replace: 'waits', kills: [caseNamed('plan tab: a made choice is one line')] },
  { name: 'a section open by itself isn\'t remembered open, so the last choice folds Choices away', file: 'analysis.ts', find: 'x.opened = d.open ? [...rest, k]', replace: 'x.opened = d.open && !waits ? [...rest, k]', kills: [caseNamed('plan tab: a made choice is one line')] },
  { name: 'Compare the options isn\'t remembered', file: 'plan.ts', find: 'const compared = opened.includes(compareKey(key));', replace: 'const compared = false;', kills: [caseNamed('plan tab: a made choice is one line')] },
  { name: 'Deploy runs without the sheet\'s confirmation', file: 'deploy-sheet.ts', find: '    parts.cancel.focus();\n', replace: '    parts.cancel.focus();\n    go();\n', kills: [caseNamed('deploy sheet: a passed check deploys only')] },
  { name: 'a failed check still offers Deploy', file: 'deploy-sheet.ts', find: "  if (s.phase === 'failed') return 'The check failed: there\\'s nothing to deploy';\n", replace: '', kills: [caseNamed('deploy sheet: a failed check')] },
  { name: 'a failed check shows its Deploy', file: 'deploy-sheet.ts', find: "parts.go.hidden = s.phase !== 'passed';", replace: "parts.go.hidden = s.phase !== 'passed' && s.phase !== 'failed';", kills: [caseNamed('deploy sheet: a failed check')] },
  { name: 'Production deploys without its name typed', file: 'deploy-sheet.ts', find: '  if (s.confirm && name.trim() !== s.confirm && name.trim() !== s.org) return `Type ${s.confirm} to deploy to it`;\n', replace: '', kills: [caseNamed('deploy sheet: Production asks')] },
  { name: 'Deploy off doesn\'t say why beside it', file: 'changes.ts', find: "    if (d.deploy.disabled) sec.append(el('p', 'muted small dp-why', icon('info'), el('span', '', d.deploy.disabled)));\n", replace: '', kills: [caseNamed('changes tab: Deploy sits above the list')] },
  { name: 'Deploy on the tab deploys at once', file: 'changes.ts', find: "api.postMessage({ type: 'deploy-check', project: m.project, task: d.task, to: b.to });", replace: "api.postMessage({ type: 'deploy-go', project: m.project, task: d.task, to: b.to, checkId: 'none' });", kills: [caseNamed('changes tab: Deploy to UAT')] },
  { name: 'Change it sends no yes', file: 'plan.ts', find: '...(option ? { option: option.id } : { text }), yes: true });', replace: '...(option ? { option: option.id } : { text }) });', kills: [caseNamed('plan: on an approved plan')] },
];

/** How many times `find` is in `source`: a mutant applies only where it's there exactly once. */
export const occurrences = (source: string, find: string): number => (find ? source.split(find).length - 1 : 0);

// ---------------------------------------------------------------- what Node expects, and the page

/** What the Connect case expects (T-45): the reason Save is off, from the model the page is drawn from. */
function connectData(): BehaviourData['connect'] {
  const site = sampleConnect('shared');
  if (site.step !== 'site' || !site.next?.why) throw new Error('The Connect case needs the sign-in step, its Next off with a reason.');
  const s = blankConnect(JIRA, { id: 'c-testing', root: '/Users/me/code/acme-service', projectName: 'Acme Service', ownRepo: null, ghAccount: null, from: 'tasks' });
  s.step = 'site';
  s.host = 'acme.atlassian.net';
  s.signIn = { state: 'testing', who: null, error: null, again: false };
  const testing = connectModel(s);
  if (!testing.signIn.why) throw new Error('The Connect case needs a page signing in, its Test connection off with a reason.');
  return { site, why: site.next.why.label, testing: { model: testing, why: testing.signIn.why.label } };
}

/** What the case for choosing a board expects (T-106): its three moments, from the fixtures the shots draw. */
function chooseData(): BehaviourData['choose'] {
  const [reading, shown, epic, save] = [sampleChoosing('reading'), sampleChoosing('shown'), sampleChoosing('epic'), sampleConnect('jira-save')];
  if (reading.preview.state !== 'loading' || !reading.next?.why || shown.preview.state !== 'ready' || epic.preview.state !== 'ready' || save.step !== 'save') throw new Error('The case for choosing a board needs a preview being read, then two drawn, then Save.');
  return { reading, shown, epic, save, line: shown.preview.look.label, epicLine: epic.preview.look.label, use: save.save.label, wait: reading.next.why.label };
}

/** Where each explanation is drawn: the part whose rows hold it, by its id's first word. */
const MEANING_PART = { theme: 'appearance', autonomy: 'agents', 'auto-merge': 'agents', cloud: 'agents', billing: 'agents', page: 'page', about: 'about' } as const;

/** What Settings' case expects (T-40, T-139): from the model, its sections, a deep link's, and each explanation, folded or kept. */
function settingsData(model: Model): BehaviourData['settings'] {
  if (model.kind !== 'home') throw new Error('The Settings case needs a home model.');
  const meanings = settingsMeanings(model.settings);
  const sectionOf = (id: string): string => {
    const part = MEANING_PART[id.split(':')[0] as keyof typeof MEANING_PART];
    if (!part) throw new Error(`MEANING_PART has no part for the explanation ${id}: add its first word.`);
    return sectionOfPart(part);
  };
  return {
    sections: model.settings.sections.map((s) => s.id),
    open: settingsKey('agents'),
    opened: sectionOfPart('agents'),
    deep: { part: settingsKey('github'), section: sectionOfPart('github') },
    folds: meanings.filter((x) => foldsMeaning(x.text)).map((x) => ({ id: x.id, key: meaningKey(x.id), section: sectionOf(x.id) })),
    kept: meanings.filter((x) => !foldsMeaning(x.text)).length,
  };
}

/** The oracle: what each case should see, from the fixtures the pages are drawn from. */
/** Set up cloud builders' token step (T-145), from the fixtures the screenshots draw. */
function cloudData(): BehaviourData['cloud'] {
  const todo = sampleCloudSetup('cloud-setup-token-win-todo')!;
  const done = sampleCloudSetup('cloud-setup-token-win-done')!;
  return { todo, why: todo.next!.why!.label, done, next: done.steps[done.steps.findIndex((s) => s.id === 'token') + 1]!.id, token: 'tok_0123456789abcdefghijKLMN' };
}

export function behaviourData(models: CaseModels, now: number): BehaviourData {
  const ticket = sampleTicket(now);
  const o = (models.overview as HomeModel).overview;
  const rules = o.attention.flatMap((a) => (a.rule ? [a.rule] : []));
  // The inline Confirm's message (D-116), from the card as drafted: nothing typed, so acc's own words.
  const accept = (r: (typeof rules)[number]) => ({ type: 'rule-accept', project: r.project, id: r.id, line: r.line, title: r.title, check: r.check });
  const list = o.landing.find((g) => g.more?.do.kind === 'detail' && g.more.do.detail.kind === 'list');
  if (!list) throw new Error('The Overview fixture has no list with more than its page shows.');
  return {
    firstSteps: FIRST_STEPS.map((s) => s.step),
    // ACME-12's Deploy to QA once its checks pass and only its conflict with dev holds it up, in the model's own words (T-138).
    deployConflict: deployOff({ config: DEPLOY_CONFIG, task: { id: 'ACME-12', state: 'review', environment: 'dev', run: { branch: 'task/ACME-12' }, pr: { number: 58, url: 'u', state: 'open' }, deps: [] } as never, tasks: [], running: false, run: null, conflicts: 'dev' }, DEPLOY_ENVS[1]!) ?? '',
    task: { project: ROOT, key: ticket.key, peek: `${ROOT}#${ticket.key.toUpperCase()}`, message: { type: 'task-modal', model: ticket, tab: { type: 'ticket', project: ROOT, tracker: 0, key: ticket.key } } },
    rules: rules.map((r) => ({ id: r.id, line: r.line, sources: r.sources.length, accept: accept(r) })),
    rulesOpens: JSON.stringify({ kind: 'rules' }),
    questionOpens: JSON.stringify({ kind: 'question', id: o.questions[0]!.id }),
    list: { key: list.key, title: list.title, shown: list.rows.length, total: list.total },
    since: sinceData(models.since),
    cards: o.cards.map((c) => {
      const g = o.landing.find((x) => x.key === c.key)!;
      return { key: c.key, name: `${c.title}, ${c.count}: ${c.line}`, opens: JSON.stringify(c.opens), title: c.opens.kind === 'history' ? 'History' : `${g.title}: ${g.total}`, lines: g.total, history: c.opens.kind === 'history' };
    }),
    machine: o.inProgress.machine.length,
    history: historyData(models.pages, now),
    project: ROOT,
    settings: settingsData(models.settings),
    connect: connectData(),
    cloud: cloudData(),
    choose: chooseData(),
    wording: (sampleTicket(now, 'ACME-21').analysis?.wording?.findings ?? []).map((f) => ({ place: f.place, message: f.message, text: f.text })),
    palette: paletteData(models.tasks, now),
    review: reviewData(models.review),
    dock: dockData(models.dock),
    run: runData(models.run),
    steps: stepsData(now),
    keys: keysData(models.tasks),
    people: peopleData(models.tasks),
    boards: boardsData(models.tasks),
    sheet: sheetData(now),
    taskSheet: taskSheetData(now),
    criteria: { model: sampleTicket(now, 'ACME-19', true, 'drafted'), project: ROOT, error: 'ACME-19\'s ticket can\'t take an update.' },
    plan: planData(now),
    talk: talkData(now),
    conversation: conversationData(now),
    report: reportData(),
    questions: questionsData(now),
    planReview: planReviewData(models.ticket),
    choices: choicesData(models.ticket),
  };
}

/** What Report a problem's case expects (T-118), from the draft's fixture and the body the page's own module builds: the oracle. */
function reportData(): BehaviourData['report'] {
  const typed = { title: 'The checks stop on the org check', happened: 'I clicked Run the checks, and it stopped.', expected: 'The checks to run.' };
  const m = sampleReport('report');
  const cut = m.attached.split('\n').find((l) => l.startsWith('- This machine:'));
  if (!cut) throw new Error('The report case needs the draft to attach this machine\'s line.');
  const fields = { 'what-happened': typed.happened, expected: typed.expected, attached: m.attached.split('\n').filter((l) => l !== cut).join('\n') };
  const body = issueBody(fields);
  return { ...typed, cut, sent: { type: 'report-post', title: typed.title, body }, text: `${typed.title}\n\n${body}`, noAccess: sampleReport('report-no-access') };
}

/** What Review plan's case expects (T-109), from ACME-21's page: the steps in their order, and the messages its confirms send. */
function planReviewData(model: Model): BehaviourData['planReview'] {
  const a = model.kind === 'ticket' ? model.analysis : null;
  const r = a?.review;
  const ids = r?.steps.map((s) => s.id).join(' ');
  const q1 = r?.steps[0];
  const d2 = r?.steps[3];
  if (model.kind !== 'ticket' || !a?.planState || !r || ids !== 'q1 q3 d1 d2 q2' || q1?.kind !== 'question' || d2?.kind !== 'choice') throw new Error(`The Review plan case needs ACME-21's plan with its steps q1 q3 d1 d2 q2, not ${ids}.`);
  const ready: Model = { ...model, analysis: { ...a, planState: { ...a.planState, approve: { disabled: null } } } };
  return {
    title: r.title, ready,
    answer: { type: 'analysis-answer', project: model.project, task: a.task, question: q1.id, text: q1.suggested },
    choose: { type: 'plan-choose', project: model.project, task: a.task, decision: d2.id, option: d2.options[2]!.id },
    approve: { type: 'plan-approve', project: model.project, task: a.task },
  };
}

/** What Talk it through's case expects (T-98): the agent's first proposal on ACME-21's approved v2, which asks first. */
function talkData(now: number): BehaviourData['talk'] {
  const page = sampleTalkApproved(now);
  // The conversation is drawn in its own panel (T-111).
  const model = conversationModel({ project: page.project, key: page.key, taskTitle: page.title, talk: page.talk ?? null });
  const turn = model.talk?.turns.find((t) => t.proposals.some((p) => p.use && !p.use.disabled && p.ask));
  const p = turn?.proposals.find((x) => x.use && !x.use.disabled && x.ask);
  if (!turn || !p?.ask) throw new Error('The talk case needs ACME-21\'s approved plan with a proposal Use this asks about first.');
  const words = 'Would Open deals only still fix the quarterly report?';
  return {
    model, ask: p.ask, use: `Use this: ${p.words}`, words,
    sent: { type: 'talk-use', project: model.project, task: model.key, turn: turn.id, proposal: p.id, yes: true },
    send: { type: 'talk-send', project: model.project, task: model.key, text: words },
  };
}

/**
 * What the conversation's cases expect (T-111): the panel as Make a plan opens it on ACME-21, a first message and
 * what it sends, the panel once the agent replied and its questions, Draft the plan's message, and ACME-21's page
 * before its plan with the conversation's line.
 */
function conversationData(now: number): BehaviourData['conversation'] {
  const start = sampleConversationStart(now);
  const reply = sampleConversationReady(now);
  const answer = reply.talk?.turns.at(-1);
  const ticket = sampleConversationTicket(now);
  if (!start.talk?.ask || answer?.who !== 'agent' || !ticket.talk?.line) throw new Error('The conversation cases need ACME-21 before its plan, with the agent\'s last reply and the page\'s line.');
  const words = 'Reps forget the contact roles. Every conversion, from now on.';
  return {
    ask: start.talk.ask, words, reply, replyText: answer.text, ticket, line: ticket.talk.line.words,
    send: { type: 'talk-send', project: start.project, task: start.key, text: words },
    draft: { type: 'conversation-draft', project: start.project, task: start.key },
  };
}

/** What the questions' case expects (T-113): ACME-21's three questions before its plan, and the answers' one message. */
function questionsData(now: number): BehaviourData['questions'] {
  const model = sampleConversationQuestions(now);
  const q = model.talk?.questions;
  if (q?.items.length !== 3 || q.items[2]!.options.length < 2) throw new Error('The questions case needs ACME-21\'s three questions waiting, the last with answers to pick from.');
  const own = 'The lead\'s own contact, unless it has none';
  return {
    model, asked: q.items.map((x) => x.question), own,
    sent: { type: 'talk-answers', project: model.project, task: model.key, turn: q.turn, answers: [{ option: 1 }, null, { text: own }] },
  };
}

/** What the approved plan's case expects (T-97): ACME-21's second choice, From now on chosen, and its other two options. */
function planData(now: number): BehaviourData['plan'] {
  const model = sampleTicket(now, 'ACME-21', false, null, null, 'approved');
  const p = model.analysis?.planState;
  const d = p?.decisions[1];
  const [keep, change] = d ? d.options.filter((o) => o.id !== d.choice?.option) : [];
  if (!p?.changeAsk || !d || !keep || !change) throw new Error('The plan case needs ACME-21\'s approved plan, with a choice made and two other options.');
  const label = (name: string) => `Choose this: ${name}, for ${d.title}`;
  return { model, ask: p.changeAsk, keep: label(keep.name), change: label(change.name), sent: { type: 'plan-choose', project: model.project, task: model.key, decision: d.id, option: change.id, yes: true }, opened: [`an:${model.project}#${model.key}:sec:choices`, `plan:${model.project}#${model.key}:${d.id}:compare`] };
}

/** What the Plan tab's choices case expects (T-136), from ACME-21's first plan: a choice made and one still to make. */
function choicesData(model: Model): BehaviourData['choices'] {
  const p = model.kind === 'ticket' ? model.analysis?.planState : null;
  const made = p?.decisions.find((d) => d.choice?.option);
  const open = p?.decisions.find((d) => !d.choice);
  const chosen = made?.options.find((o) => o.id === made.choice?.option);
  if (model.kind !== 'ticket' || !p || !made || !open || !chosen || made.options.length < 2) throw new Error('The choices case needs ACME-21\'s first plan, with a choice made from two options or more and one still to make.');
  const pick = open.options.find((o) => o.id === open.recommended) ?? open.options[0]!;
  // The plan once acc has recorded the last choice: nothing in Choices waits on the person any more.
  const decisions = p.decisions.map((d) => (d.id === open.id ? { ...d, choice: { option: pick.id, name: pick.name, by: 'jordan', at: made.choice!.at } } : d));
  const allMade = { ...model, analysis: { ...model.analysis!, planState: { ...p, decisions } } };
  return {
    made: made.id, chosen: chosen.name, open: open.id, madeOptions: made.options.length, openOptions: open.options.length, compare: `plan:${model.project}#${model.key}:${made.id}:compare`, section: `an:${model.project}#${model.key}:sec:`,
    pick: `Choose this: ${pick.name}, for ${open.title}`, done: { type: 'plan-done', action: 'plan-choose', project: model.project, task: model.key, decision: open.id, ok: true }, allMade,
  };
}

/**
 * What History's case expects (D-170), from the Overview with 100 entries: what the page asks for and what the
 * extension sends, worked out from every entry by the model's own pages.
 */
function historyData(model: Model, now: number): BehaviourData['history'] {
  if (model.kind !== 'home' || !model.overview.history.more) throw new Error('The History case needs an Overview whose History has more than a page.');
  const long = sampleLongHub(now);
  const items = historyItems(long.hub, long.runs);
  const first = model.overview.history.items;
  const last = first.at(-1)!;
  const exchange = (asked: Extract<FromWebview, { type: 'history-more' }>, rows: number) => {
    const reply = historyReply(items, asked);
    return { asked: { ...asked }, reply: { ...reply }, rows: rows + reply.page.items.length };
  };
  const after = { at: last.at, id: last.id };
  const later = items[HISTORY_PAGE * 2 + 5]!;
  const fresh: HistoryItem = { kind: 'run', id: 'run:fresh', at: new Date(now).toISOString(), label: 'Pull the boards', command: 'acc sync', look: LOOK('Done', 'pass', 'blue'), lines: [] };
  return {
    first: first.length, count: model.overview.history.counts.run,
    next: exchange({ type: 'history-more', filter: 'all', after }, first.length),
    filter: exchange({ type: 'history-more', filter: 'run' }, 0),
    upTo: { ...exchange({ type: 'history-more', filter: 'all', after, upTo: later.id }, first.length), id: later.id },
    newer: { ...model, overview: { ...model.overview, history: { ...model.overview.history, items: [fresh, ...first], counts: { ...model.overview.history.counts, all: model.overview.history.counts.all + 1, run: model.overview.history.counts.run + 1 } } } },
  };
}

/** What Since you last looked's case expects (D-164), from the Overview drawn with news held while away. */
function sinceData(model: Model): BehaviourData['since'] {
  const g = model.kind === 'home' ? model.overview.since : null;
  const first = g?.rows[0]?.open;
  if (!g || first?.kind !== 'task') throw new Error('The Since you last looked case needs an Overview with news held, whose first line opens its task.');
  return { part: g.part, title: g.title, tasks: g.rows.map((r) => r.id), open: { type: 'task-modal-open', project: first.project, key: first.key } };
}

/** What the Dispatch sheet's cases expect (D-168): ACME-16's sheet, whose builder's model takes no effort, Another model…, and ACME-19's rework sheet with the cloud off. */
function sheetData(now: number): BehaviourData['sheet'] {
  const input = sampleSheetInput(now, 'no-effort');
  const sheet = dispatchSheet(input);
  const first = sheet.models[0]!;
  const pick = sheet.models.find((m) => m.value === 'claude-opus-5-5');
  if (first.efforts.length || !first.none || !pick?.efforts.length) throw new Error('The sheet case needs a builder whose model takes no effort, and Opus 5.5 to pick.');
  const chosen = pick.efforts[pick.effort]!;
  const choice = { model: pick.value!, effort: chosen.value, where: sheet.place };
  const task = input.row.id;
  const another = sheet.models.at(-1)!;
  if (another.value !== null || !another.efforts.length) throw new Error('The sheet case needs Another model… last, taking every level.');
  const named = { model: 'opus', effort: another.efforts[another.effort]!.value, where: sheet.place };
  const rework = sampleSheet(now, 'rework');
  const reason = rework.places.find((p) => p.value === 'cloud')?.disabled;
  if (!reason) throw new Error('The sheet case needs the rework sheet with the cloud off.');
  return {
    card: {
      task, run: { type: 'run', command: 'acc.task.dispatch', ref: { project: ROOT, task } }, message: { type: 'dispatch-sheet', sheet }, none: first.none,
      pick: pick.value!, levels: pick.efforts.map((e) => e.label), chosen: chosen.label,
      sent: { type: 'dispatch-sheet-go', project: ROOT, task, ...choice }, args: dispatchChoiceArgs(input, choice).args,
    },
    another: { label: another.label, empty: 'Type a model\'s name first', name: named.model, sent: { type: 'dispatch-sheet-go', project: ROOT, task, ...named }, args: dispatchChoiceArgs(input, named).args },
    page: {
      modal: { type: 'task-modal', model: sampleTicket(now, 'ACME-19'), tab: { type: 'ticket', project: ROOT, tracker: 0, key: 'ACME-19' } },
      run: { type: 'run', command: 'acc.task.dispatch', ref: { project: ROOT, task: 'ACME-19' } }, message: { type: 'dispatch-sheet', sheet: rework }, title: rework.title, reason,
    },
  };
}

/** What the task sheet's cases expect (T-74): a new task, a manual task's edit and a Jira task's, and with edits on, ACME-19's (T-80). */
function taskSheetData(now: number): BehaviourData['taskSheet'] {
  const add = sampleTaskSheet(now, 'new');
  const edit = sampleTaskSheet(now, 'manual');
  const tracker = sampleTaskSheet(now, 'tracker');
  const edits = sampleTaskSheet(now, 'edits');
  if (!edits.ticketEdits?.base) throw new Error('The edits case needs a Jira task whose ticket text the sheet writes.');
  const drafted = withSheetCriteria(edits, sampleCriteria(now), false);
  if (!drafted.criteria?.section) throw new Error('The criteria case needs a sheet with a stored draft.');
  if (!tracker.ticket || !tracker.locked) throw new Error('The task sheet case needs a Jira task with its ticket\'s link.');
  const worded = sampleTaskSheet(now, 'wording');
  if (!worded.wording?.hard || worded.wording.criteria.length !== 2) throw new Error('The wording case needs a sheet with a fix and a piece of advice on two criteria.');
  if (wordingReply({ type: 'task-sheet-wording', project: ROOT, brief: SAMPLE_WORDING_FIXED }).wording.hard) throw new Error('The wording case\'s fixed text needs no fix.');
  const title = 'Write the release notes';
  const brief = 'One page for the sales team.';
  const notes = 'Ask the sales lead before it goes out.';
  return {
    add: { message: { type: 'task-sheet', sheet: add }, off: taskSheetOff({ title: '' })!, title, brief, sent: { type: 'task-sheet-go', project: ROOT, ...add.fields, title, brief } },
    edit: { message: { type: 'task-sheet', sheet: edit }, notes, sent: { type: 'task-sheet-go', project: ROOT, task: edit.task, ...edit.fields, notes } },
    tracker: { message: { type: 'task-sheet', sheet: tracker }, url: tracker.ticket.url, kept: 4 },
    edits: {
      message: { type: 'task-sheet', sheet: edits }, project: ROOT, base: { ...edits.ticketEdits!.base! }, title: 'Send the welcome email once per contact',
      error: 'Its ticket wasn\'t changed. Jira said: HTTP 500', theirs: { ...SAMPLE_THEIRS },
      rows: edits.ticketEdits!.rows.map((r) => (r.field === 'status' ? { ...r, value: 'In Review' } : r)),
    },
    criteria: {
      message: { type: 'task-sheet', sheet: drafted }, project: ROOT, brief: drafted.fields.brief, section: drafted.criteria!.section!,
      error: 'The draft held no acceptance criteria.', again: '## Drafted acceptance criteria\n\n### Acceptance criteria\n\n1. A new contact gets one welcome email.',
    },
    wording: {
      message: { type: 'task-sheet', sheet: worded }, project: ROOT, items: worded.wording!.criteria.length, off: wordingOff(worded.wording)!, fixed: SAMPLE_WORDING_FIXED,
      reply: wordingReply({ type: 'task-sheet-wording', project: ROOT, brief: SAMPLE_WORDING_FIXED }),
      // An answer for text the box held a moment before, which passes: taken, it would turn Save on.
      stale: wordingReply({ type: 'task-sheet-wording', project: ROOT, brief: '## Acceptance criteria\n\n- [ ] The page lists each field.' }),
    },
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

/**
 * What the person filter's cases expect (T-79), from the Jira board's model: one person who has cards in two
 * columns with a column between them that has none of theirs, and the cards an arrow goes between.
 */
/** The Tasks tab with ten boards on three Jira sites (T-127), the boards drawn as the extension draws them. */
function boardsData(model: Model): BehaviourData['boards'] {
  if (model.kind !== 'home') throw new Error('The board switch case needs a home model.');
  const boards = sampleSeveralBoards(10).map((b) => trackerBoard(b, [], ROOT));
  const tasks = { ...model.tasks, projects: model.tasks.projects.map((p, i) => (i === 0 ? { ...p, boards } : p)) };
  const found = boards.filter((b) => b.group === 'globex.atlassian.net');
  return { model: { ...model, tasks }, typed: 'globex', found: found.map((b) => b.name), picked: found[0]!.name, id: found[0]!.id };
}

function peopleData(model: Model): BehaviourData['people'] {
  if (model.kind !== 'home') throw new Error('The person filter cases need a home model.');
  const project = model.tasks.projects[0]!;
  const board = project.boards[0]!;
  const all = board.columns.flatMap((c) => c.cards);
  const person = all.flatMap((c) => c.people).find((w) => w.name === 'Pat Lee');
  const theirs = (w: { key: string }) => board.columns.map((c) => c.cards.filter((x) => x.people.some((p) => p.key === w.key)));
  const cols = person ? theirs(person) : [];
  const at = cols.findIndex((c) => c.length >= 2);
  const next = cols.findIndex((c, i) => i > at && c.length > 0);
  const hidden = at >= 0 ? board.columns[at]!.cards.find((c) => !c.people.length)?.key : undefined;
  if (!person || at < 0 || next < 0 || !hidden || board.me === null) throw new Error('The person filter cases need a board where one person has two cards in a column and some in a later one, a card nobody has, and a signed-in person.');
  const count = (f: (c: TrackerCard) => boolean) => all.filter(f).length;
  const mine = count((c) => c.people.some((p) => p.key === board.me));
  return {
    board: `tracker:${project.root}#${board.index}`, person: person.name, choice: PERSON + person.key,
    first: cols[at]![0]!.key, down: cols[at]![1]!.key, right: cols[next]![0]!.key, hidden,
    labels: ['Everyone', 'Mine', 'Unassigned', ...[...new Set(all.flatMap((c) => c.people.map((p) => p.name)))].sort((a, b) => a.localeCompare(b))],
    header: `${person.name} · ${count((c) => c.people.some((p) => p.key === person.key))} of ${all.length}`, mine: `Mine · ${mine} of ${all.length}`, everyone: `Everyone · ${all.length}`,
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

/** What the output panel's case expects (T-63): from the Tasks board's model, its review run and what it shows. */
function dockData(model: Model): BehaviourData['dock'] {
  const run = model.kind === 'home' ? model.runs.find((r) => r.review?.phase === 'done') : undefined;
  const r = run?.review?.phase === 'done' ? run.review : null;
  const opens = r?.rows.find((x) => x.finding?.opens)?.finding?.opens;
  if (!run || !r || !r.met || !opens || model.kind !== 'home') throw new Error('The output panel case needs a home model with a finished review whose finding opens and some criteria met.');
  return {
    run: run.id, runs: { type: 'runs', runs: model.runs, focus: run.id }, look: r.look.label, count: r.count,
    rows: r.rows.map((x) => ({ key: x.key, label: x.look.label, text: x.text })), met: r.met.items.length, lines: run.rows.map((x) => x.text),
    click: { type: 'review-file', ...opens }, next: { type: 'run', command: r.next.command, ref: r.next.ref },
  };
}

/** What the output panel's run case expects (T-64): from the Tasks board's model, its failed run and what it shows. */
function runData(model: Model): BehaviourData['run'] {
  const run = model.kind === 'home' ? model.runs[0] : undefined;
  const r = run?.result;
  const chip = run?.rows.flatMap((x) => x.parts).find((p): p is Extract<typeof p, { opens: string | null }> => 'path' in p && !!p.opens);
  if (!run || !r?.error || !r.exit || r.next?.kind !== 'rerun' || !chip?.opens || model.kind !== 'home') throw new Error('The output panel\'s run case needs a home model whose first run failed with an error row, runs again, and names a path in its folder.');
  return {
    runs: { type: 'runs', runs: model.runs, focus: run.id }, look: run.look.label, label: run.label, took: run.took!, rows: run.rows.map((x) => x.text), command: run.command,
    off: run.rows.flatMap((x) => x.parts).filter((p) => 'path' in p && !p.opens).length, sentence: r.sentence, error: r.error.text, exit: r.exit,
    copy: { type: 'run-control', run: run.id, action: 'copy' }, chip: { type: 'run-file', run: run.id, file: chip.opens, ...(chip.line ? { line: chip.line } : {}) },
    next: { type: 'run-control', run: run.id, action: 'rerun' },
  };
}

/** What the panel's steps case expects (T-65): the promotion that failed at its check, as its card shows it. */
function stepsData(now: number): BehaviourData['steps'] {
  const run = runCard(sampleStepRun(now, 'steps-failed'));
  const failed = run.steps?.find((x) => x.look.label === 'Failed');
  if (!run.steps || !failed?.rows.length || !failed.note || !run.result || !run.lineCount) throw new Error('The panel\'s steps case needs a run of acc whose failed step has a note and rows, and a result.');
  return {
    runs: { type: 'runs', runs: [run], focus: run.id }, labels: run.steps.map((x) => x.label), failed: failed.label, note: failed.note, stepRows: failed.rows.map((r) => r.text),
    rows: run.rows.map((r) => r.text), fold: `Show ${run.lineCount} lines`, open: `Hide ${run.lineCount} lines`, sentence: run.result.sentence,
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
  // A board with no kept choice opens on Mine (T-143), which hides the cards most cases look for: every case but the person filter's own starts with each board kept on Everyone.
  const everyone: Record<string, string> = {};
  if (model.kind === 'home' && !c.name.startsWith('person filter:')) for (const pr of model.tasks?.projects ?? []) Object.assign(everyone, everyoneKept(pr.root));
  const seeded0 = c.opening ? { opened: [], drafts: {}, section: model.kind === 'home' ? model.section : undefined, scroll: { [key]: { y: c.opening.scroll, boards: [] } } } : undefined;
  const seeded = Object.keys(everyone).length ? { ...seeded0, filters: everyone } : seeded0;
  const fns = [...HELPERS.map((f) => `const ${f.name} = ${f.toString().replace(/^async function \w+/, 'async function').replace(/^function \w+/, 'function')};`), `const RUN = ${c.run.toString().replace(/^async run/, 'async function')};`].join('\n');
  return `
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
// Chrome run with --dump-dom and a virtual time budget draws no frames, so an IntersectionObserver never
// reports, and a scroll fires no event. This one reports from the boxes, its root's grown by its margin's
// bottom, once it's given a target and on each scroll event of its root, which the probe's scroll fires.
window.IntersectionObserver = class {
  constructor(cb, o = {}) {
    this.cb = cb; this.root = o.root || null; this.els = [];
    this.bottom = parseFloat(String(o.rootMargin || '0px').split(/\\s+/)[2] || '0') || 0;
    this.look = () => {
      if (!this.els.length) return;
      const r = this.root ? this.root.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      this.cb(this.els.map((e) => { const b = e.getBoundingClientRect(); return { target: e, isIntersecting: b.top < r.bottom + this.bottom && b.bottom > r.top }; }), this);
    };
    (this.root || window).addEventListener('scroll', this.look);
  }
  observe(e) { this.els.push(e); setTimeout(this.look, 0); }
  unobserve(e) { this.els = this.els.filter((x) => x !== e); }
  disconnect() { this.els = []; (this.root || window).removeEventListener('scroll', this.look); }
  takeRecords() { return []; }
};
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
    async scroll(box, top) { box.scrollTop = top; box.dispatchEvent(new Event('scroll')); await settle(); },
    async type(box, text) { box.focus(); box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); await settle(); },
    sent(type) { return SENT.filter((m) => m && m.type === type); },
    memory() { return clone(MEMORY) ?? {}; },
    remember(change) { MEMORY = { ...(MEMORY ?? {}), ...clone(change) }; },
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

/** A case's page, with its model and data, under VSCode's light theme with the page's own theme set to Dark. `fonts` are the fonts VSCode would set; the screenshot run's own (FONTS in screenshot.ts) is passed in, so this file imports nothing of it. */
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
<body class="vscode-light" data-view="${model.kind === 'ticket' || model.kind === 'agent' || model.kind === 'conversation' || model.kind === 'report' ? model.kind : 'home'}" data-logo-dark="webview/acc-dark.svg" data-logo-light="webview/acc-light.svg"><main id="app">${c.opening ? loadingScreen(model.kind === 'ticket' ? 'ticket' : 'home', { dark: 'webview/acc-dark.svg', light: 'webview/acc-light.svg' }) : ''}</main><script src="${script}"></script></body></html>
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
  /** How many cases, or mutants, run at once (T-58). */
  jobs: number;
  /** Runs Chrome in a slot, 0 to jobs - 1, whose profile no other run uses meanwhile. */
  run: (chrome: string, args: string[], slot: number) => Promise<Ran>;
  log: (line: string) => void;
}

async function runCase(d: BehaviourDeps, c: Case, data: BehaviourData, slot: number, script?: string, tag = 'case'): Promise<BehaviourRun> {
  const file = join(d.work, `behaviour-${tag}-${CASES.indexOf(c)}.html`);
  writeFileSync(file, behaviourPage(c, caseModel(c, d.models), data, d.fonts, script));
  const r = await d.run(d.chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--virtual-time-budget=8000', `--window-size=${BEHAVIOUR_WINDOW.width},${BEHAVIOUR_WINDOW.height}`, '--dump-dom', pathToFileURL(file).href], slot);
  return { name: c.name, report: r.error ? null : dumpedBehaviour(String(r.stdout ?? '')) };
}

/**
 * Builds the webview with one mutant's change into its own folder, work/mutant-<index>/, so builds running
 * at once never write the same file (T-58). Returns its script's path from work, and how often the change applied.
 */
async function buildMutant(work: string, m: Mutant, index: number): Promise<{ script: string; applied: number }> {
  const { build } = await import('esbuild');
  const webview = join(import.meta.dirname, '..', 'webview');
  const target = join(webview, m.file);
  let applied = 0;
  const out = `mutant-${index}/main.js`;
  mkdirSync(join(work, `mutant-${index}`), { recursive: true });
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
 * Runs every case on the built page, then every mutant's cases on the page built with its change, d.jobs
 * at a time (T-58): a mutant's cases run one after another in its slot. Returns the failures; each case's
 * checks and each mutant are counted in the log, in CASES' and mutants' order whatever finished first.
 */
export async function behaviourCheck(d: BehaviourDeps, mutants = MUTANTS): Promise<string[]> {
  const data = behaviourData(d.models, d.now);
  const runs = await pool(CASES, d.jobs, (c, slot) => runCase(d, c, data, slot), (r, i) => {
    d.log(`${r.report && !caseFailed(r.report) ? 'pass' : 'FAIL'}  ${CASES[i]!.name}  (${r.report?.checks.length ?? 0} checks)`);
  });
  const judged = judgeBehaviour(runs);
  d.log(`Behaviour: ${runs.length} cases, ${judged.checks} checks, ${judged.failures.length} failure${judged.failures.length === 1 ? '' : 's'}.`);
  const results = await pool(mutants, d.jobs, async (m, slot, i) => {
    const built = await buildMutant(d.work, m, i);
    const mruns: BehaviourRun[] = [];
    if (built.applied === 1) for (const name of m.kills) mruns.push(await runCase(d, CASES.find((c) => c.name === name)!, data, slot, built.script, `mutant-${i}`));
    return { mutant: m, applied: built.applied, runs: mruns };
  }, ({ mutant: m, applied, runs: mruns }) => {
    // What caught it: each case's first failed check, or what stopped it.
    const why = mruns.map((r) => r.report?.error ?? r.report?.checks.find((c) => !c.ok)?.what ?? 'passed').join('; ');
    d.log(`mutant "${m.name}": ${applied !== 1 ? `its change applied ${applied} times` : mruns.every((r) => caseFailed(r.report)) ? `caught: ${why}` : `NOT caught: ${why}`}`);
  });
  const missed = judgeMutants(results);
  const caught = results.filter((r) => r.applied === 1 && r.mutant.kills.length && r.runs.every((x) => caseFailed(x.report))).length;
  d.log(`Mutants: ${results.length}, ${caught} caught.`);
  return [...judged.failures, ...missed];
}
