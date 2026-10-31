// A card's or a task page's action, shown working from the click until the extension answers (T-147): its
// button spins, says the action under way, is busy and can't be pressed again. One state for every action
// that waits on the extension, on a card, in its ⋯ menu, on a task's page and in the modal over the board.
// The answer ends it: the action asked its question (a confirmation opened), came to its result, or failed.
// A yes to the question starts it working again until the result. A refusal stays, saying why, on the card.

import type { Action, Ref } from '../src/model/shared.ts';
import type { RanMessage } from '../src/logic/ran.ts';
import { Pending } from './pending.ts';
import { el, icon } from './dom.ts';
import { api, type PageArea, state } from './state.ts';

/** An action's key: its command and everything its ref names, so two buttons for one action share their state. */
export const runKey = (command: string, ref: Ref): string => JSON.stringify([command, ref.project ?? '', ref.task ?? '', ref.session ?? '', ref.worktree ?? '', ref.env ?? '', ref.step ?? '', ref.part ?? '']);

/** What each action says while it's under way; the rest say Working…. */
const UNDER_WAY: Record<string, string> = {
  'acc.task.cleanup': 'Cleaning up…',
  'acc.task.block': 'Blocking…',
  'acc.task.unblock': 'Unblocking…',
  'acc.task.abandon': 'Abandoning…',
  'acc.task.resume': 'Resuming…',
  'acc.task.review': 'Starting the review…',
  'acc.task.reviewLocal': 'Starting the review…',
  'acc.task.analyze': 'Starting the plan…',
  'acc.task.collect': 'Collecting…',
  'acc.task.dispatchAgain': 'Starting…',
  'acc.task.stopWaiting': 'Stopping the wait…',
};

/** The words a button shows while its action is under way: Cleaning up… for Clean up. */
export const underWay = (command: string): string => UNDER_WAY[command] ?? 'Working…';

/**
 * Each action on its way, by runKey: waiting for the extension's first word, or running after a yes; and
 * why the last try was refused. The screenshot run can start with some on their way, to see them drawn.
 */
export const working = new Pending<'waiting' | 'running'>();
const shot = (api.getState() as { working?: string[]; refused?: Record<string, string> } | undefined) ?? {};
for (const k of shot.working ?? []) working.start(k, 'waiting');
for (const [k, why] of Object.entries(shot.refused ?? {})) working.settle(k, why);

/** What else hears the extension's answers (T-162): a sheet that opened loading at the click, to say a refusal in it. */
const hearing: ((msg: RanMessage) => void)[] = [];
export const onRan = (f: (msg: RanMessage) => void): void => { hearing.push(f); };

/** Actions whose question is open: the button is back, and the answer to the question is still to come. */
const asking = new Set<string>();

/**
 * Sends an action to the extension, and shows its button working at once. A second press while it's on its
 * way sends nothing. The button changes where it is, so it keeps focus, and a sheet the action opens can
 * give focus back to it; a reason left from the last try goes with it.
 */
export function press(a: Pick<Action, 'command' | 'ref'>): void {
  const k = runKey(a.command, a.ref);
  const refused = !!working.error(k);
  if (!working.start(k, 'waiting')) return;
  api.postMessage({ type: 'run', command: a.command, ref: a.ref });
  if (refused) for (const e of document.querySelectorAll<HTMLElement>('.run-refused')) if (e.dataset.run === k) e.remove();
  repaint();
}

/** How a button was built, to put back once its action is answered. */
interface Built { key: string; command: string; icon: Element | null; label: HTMLElement | null; words: string; title: string }
const built = new WeakMap<HTMLElement, Built>();

/**
 * Marks a button as an action's, and draws it as its action stands: while it works, a spinning icon, the
 * action under way, busy, and not to be pressed again, with the words in its title; otherwise as it was
 * built. `label` is the element that holds its words. It stays focusable, so focus isn't lost while it works.
 */
export function dress(b: HTMLButtonElement, a: Pick<Action, 'command' | 'ref'>, label: HTMLElement | null = null): HTMLButtonElement {
  const first = (b.children as ArrayLike<Element>)[0];
  built.set(b, { key: runKey(a.command, a.ref), command: a.command, icon: first?.classList?.contains('codicon') ? first : null, label, words: label?.textContent ?? '', title: b.title });
  b.classList.add('run-btn');
  paint(b);
  return b;
}

/** Draws one action's button as its action stands now. */
function paint(b: HTMLElement): void {
  const was = built.get(b);
  if (!was) return;
  const on = !!working.what(was.key);
  const words = underWay(was.command);
  if (was.icon) b.replaceChildren(on ? icon('sync~spin') : was.icon, ...Array.from(b.children as ArrayLike<Element>).slice(1));
  if (was.label) was.label.textContent = on ? words : was.words;
  b.title = on ? words : was.title;
  b.classList.toggle('working', on);
  for (const [name, value] of [['aria-busy', 'true'], ['aria-disabled', 'true']] as const) {
    if (on) b.setAttribute(name, value);
    else b.removeAttribute(name);
  }
}

/**
 * A ⋯ menu's button, for the actions in it: while one is on its way, it spins and says which, and still opens
 * to the rest. `name` is what it's for, as its label says.
 */
export function dressMenu(b: HTMLButtonElement, actions: Pick<Action, 'command' | 'ref'>[], name: string): HTMLButtonElement {
  menus.set(b, { keys: actions.map((a) => [runKey(a.command, a.ref), a.command]), icon: (b.children as ArrayLike<Element>)[0] ?? null, title: b.title, name });
  b.classList.add('run-menu');
  paintMenu(b);
  return b;
}
const menus = new WeakMap<HTMLElement, { keys: [string, string][]; icon: Element | null; title: string; name: string }>();

function paintMenu(b: HTMLElement): void {
  const was = menus.get(b);
  if (!was) return;
  const busy = was.keys.find(([k]) => working.what(k))?.[1];
  if (was.icon) b.replaceChildren(busy ? icon('sync~spin') : was.icon);
  b.title = busy ? underWay(busy) : was.title;
  b.setAttribute('aria-label', `${busy ? `${underWay(busy)} ` : ''}More actions for ${was.name}`);
  if (busy) b.setAttribute('aria-busy', 'true');
  else b.removeAttribute('aria-busy');
}

/** Every action's button on the page drawn again as its action stands, where it is: no redraw. */
function repaint(): void {
  for (const b of document.querySelectorAll<HTMLElement>('.run-btn')) paint(b);
  for (const b of document.querySelectorAll<HTMLElement>('.run-menu')) paintMenu(b);
}

/** Why an action on a card or a page was refused last, in orange with its icon, or null: shown until it's tried again. */
export function refusal(actions: Pick<Action, 'command' | 'ref'>[]): HTMLElement | null {
  const key = actions.map((a) => runKey(a.command, a.ref)).find((k) => working.error(k));
  if (!key) return null;
  const note = el('div', 'card-note conflict run-refused', icon('warning'), el('span', '', working.error(key)!));
  note.dataset.run = key;
  return note;
}

/** Tasks Clean up took out of Done, by `<project>#<task>`, from the extension's answer: the board moves them before the next model does. */
export const cleaned = new Set<string>();
export const cleanedKey = (project: string, task: string): string => `${project}#${task}`;

/**
 * The extension's answer to an action the page sent. Asked: the confirmation is open, so the button goes back.
 * Running: a yes started it, so it works again. Done: it goes back, a refusal keeping why, and a task Clean up
 * removed leaves Done at once. An answer to an action the page didn't show working changes nothing.
 */
export function heard(msg: RanMessage): void {
  for (const f of hearing) f(msg);
  const k = runKey(msg.command, msg.ref ?? {});
  if (!working.what(k) && !asking.has(k)) return;
  if (msg.phase === 'asked') asking.add(k);
  else asking.delete(k);
  if (msg.phase === 'running') working.start(k, 'running');
  else working.settle(k, msg.phase === 'done' && msg.ok === false ? msg.error?.trim() || 'It didn\'t go, and the Command Center didn\'t say why.' : null);
  if (msg.phase === 'done' && msg.cleaned && msg.ref?.project && msg.ref.task) cleaned.add(cleanedKey(msg.ref.project, msg.ref.task));
  // A card that moves, or a reason to show on it, needs the page drawn again; the rest change where they are.
  if (msg.phase === 'done' && (msg.cleaned || working.error(k))) redraw();
  else repaint();
}

/** Draws the page again from the model it last drew, the modal over it too. */
const redraw = (): void => { if (state.last) state.draw(state.last); };

export const area: PageArea = {
  receive: { ran: heard },
};
