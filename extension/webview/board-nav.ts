// A board from the keyboard (T-54): one card in the tab order, arrows between cards, and Space to pick a
// card up and move it, said on the board's live line. Which card and which lane come from board-keys.ts.

import type { Look } from '../src/model/shared.ts';
import { MOVE_LOOK, MOVE_WORDS, nextCard, nextLane } from './board-keys.ts';
import { el, icon } from './dom.ts';
import { api, type PageArea } from './state.ts';

/** What a board tells its keys: its name, how to read its columns and cards, and the move a drop sends. */
export interface BoardKeys {
  /** Names the board, so its last card, its held card and its live line outlast a redraw. */
  key: string;
  /** A column's id: the agent board's group, a tracker's column. */
  column(col: HTMLElement): string;
  /** A card's id: its task or its ticket's key. */
  card(art: HTMLElement): string;
  /** The columns a card may land in. */
  lanes(art: HTMLElement): string[];
  /** Sends the move, as a drop on that column does. */
  move(card: string, column: string): void;
}

/** The card held up by Space, on its board, and the lane chosen for it: its own column before a choice. */
interface Held { board?: string; card: string; at: string }

/** What a card's keys do, said after what it says of itself. */
export const KEYS_DESCRIPTION = 'Arrows go to other cards. Enter opens it. Space picks it up to move it.';

/** Each board's card last focused, so Tab from outside lands on it again after a redraw. */
const last = new Map<string, string>();
/** What each board's live line last said, so a redraw shows it still. */
const said = new Map<string, { look: Look; text: string }>();
/** The card focused as the page redrew, to focus again in the new page, in whatever column it is now. */
let focused: { board: string; card: string } | null = null;
// The screenshot harness can start with a card held, to see it laid out: its board is the first that has it.
let held: Held | null = ((api.getState() as { holding?: Held } | undefined)?.holding) ?? null;

/** What takes focus for a card: the card, or its title where the card's own buttons sit around it. */
const focusOf = (art: HTMLElement): HTMLElement => (art.matches('[data-peek]') ? art : art.querySelector<HTMLElement>('[data-peek]') ?? art);

/** A board's live line: empty until a key says something, and kept in view of a screen reader. */
export function liveLine(key: string): HTMLElement {
  const line = el('div', 'board-live');
  line.setAttribute('role', 'status');
  line.setAttribute('aria-live', 'polite');
  line.dataset.liveFor = key;
  const was = said.get(key);
  if (was) line.append(icon(was.look.icon, was.look.tone), el('span', '', was.text));
  return line;
}

/** Wires a drawn board's cards to the keys: call it once its columns and cards are in it. */
export function boardKeys(board: HTMLElement, live: HTMLElement, o: BoardKeys): void {
  board.dataset.keys = o.key;
  const columns = [...board.querySelectorAll<HTMLElement>(':scope > .column')];
  const ids = columns.map(o.column);
  const cardsIn = (col: HTMLElement): HTMLElement[] => [...col.querySelectorAll<HTMLElement>(':scope > article.card')];
  const say = (look: Look, text: string): void => {
    said.set(o.key, { look, text });
    live.replaceChildren(icon(look.icon, look.tone), el('span', '', text));
  };
  const quiet = (): void => { said.delete(o.key); live.replaceChildren(); };
  const home = (art: HTMLElement): HTMLElement => art.closest<HTMLElement>('.column')!;
  // A column's name is its heading's words, without the count beside them.
  const nameOf = (id: string): string => [...columns[ids.indexOf(id)]?.querySelector('h2')?.childNodes ?? []]
    .filter((n) => !(n instanceof HTMLElement && n.classList.contains('count'))).map((n) => n.textContent).join('').trim() || id;
  const cardNamed = (id: string): HTMLElement | undefined => [...board.querySelectorAll<HTMLElement>('article.card')].find((a) => a.dataset.cardId === id);
  const rove = (to: HTMLElement | undefined): void => {
    for (const a of board.querySelectorAll<HTMLElement>('article.card')) focusOf(a).tabIndex = a === to ? 0 : -1;
  };

  /** Shows the hold: the card says Moving, the lanes it may land in are marked, and the chosen one more so. */
  const mark = (): void => {
    const h = held?.board === o.key ? held : null;
    const art = h ? cardNamed(h.card) : undefined;
    const lanes = art ? o.lanes(art) : [];
    board.classList.toggle('holding', !!art);
    columns.forEach((c, i) => {
      c.classList.toggle('can-drop', lanes.includes(ids[i]!));
      c.classList.toggle('drop-target', !!h && lanes.includes(ids[i]!) && h.at === ids[i]);
    });
    for (const a of board.querySelectorAll<HTMLElement>('article.card')) {
      const on = a === art;
      a.classList.toggle('held', on);
      const badge = a.querySelector(':scope > .card-moving');
      if (on && !badge) a.prepend(el('div', 'card-moving', icon(MOVE_LOOK.moving.icon, MOVE_LOOK.moving.tone), MOVE_LOOK.moving.label));
      if (!on) badge?.remove();
    }
  };
  const putDown = (): void => { held = null; mark(); };

  const cards = columns.flatMap(cardsIn);
  for (const art of cards) art.dataset.cardId = o.card(art);
  // A held card that's gone, or a lane it may no longer land in, ends the hold.
  if (held && (held.board ?? o.key) === o.key) {
    const art = cardNamed(held.card);
    if (art && (held.at === o.column(home(art)) || o.lanes(art).includes(held.at))) {
      // The hold the page started with is said as Space says it.
      if (!held.board) say(MOVE_LOOK.moving, MOVE_WORDS.moving(held.card));
      held.board = o.key;
    } else if (held.board) held = null;
  }
  rove(cards.find((a) => a.dataset.cardId === last.get(o.key)) ?? cards[0]);
  mark();

  for (const art of cards) {
    const target = focusOf(art);
    // After what the card says of itself, such as a ticket's status (T-59).
    target.setAttribute('aria-description', [target.getAttribute('aria-description'), KEYS_DESCRIPTION].filter(Boolean).join(' '));
    art.addEventListener('focusin', (e) => {
      if (e.target !== target) return;
      last.set(o.key, o.card(art));
      rove(art);
      // Focus on another card puts a held one down where it was.
      if (held?.board === o.key && held.card !== o.card(art)) putDown();
    });
    // Heard before the card's own Enter, which opens it, so a held card's Enter drops it instead.
    art.addEventListener('keydown', (e) => {
      if (e.target !== target || e.altKey || e.ctrlKey || e.metaKey) return;
      const id = o.card(art);
      const own = o.column(home(art));
      if (held?.board === o.key && held.card === id) {
        const lanes = o.lanes(art);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          held.at = nextLane(ids, lanes, held.at, e.key) ?? held.at;
          mark();
          if (held.at !== own) say(MOVE_LOOK.moving, MOVE_WORDS.choice(id, nameOf(held.at)));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopImmediatePropagation();
          const to = held.at;
          putDown();
          if (to === own) { say(MOVE_LOOK.stays, MOVE_WORDS.stays(id, nameOf(own))); return; }
          // Shown in place at once, as a drop is; the board redraws from the ledger or the tracker, or snaps back if it's refused.
          const col = columns[ids.indexOf(to)]!;
          col.querySelector('.drop-hint')?.remove();
          col.append(art);
          target.focus({ preventScroll: true });
          o.move(id, to);
          say(MOVE_LOOK.moved, MOVE_WORDS.moved(id, nameOf(to)));
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          putDown();
          say(MOVE_LOOK.stays, MOVE_WORDS.stays(id, nameOf(own)));
        } else if (e.key === 'Tab') {
          putDown();
          say(MOVE_LOOK.stays, MOVE_WORDS.stays(id, nameOf(own)));
        } else if (e.key !== 'Shift') e.preventDefault();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        if (!o.lanes(art).length) { say(MOVE_LOOK.cannot, MOVE_WORDS.cannot(id, nameOf(own))); return; }
        held = { board: o.key, card: id, at: own };
        mark();
        say(MOVE_LOOK.moving, MOVE_WORDS.moving(id));
        return;
      }
      const next = nextCard(columns.map((c) => cardsIn(c).map(o.card)), id, e.key);
      if (next === null) return;
      e.preventDefault();
      const to = cardNamed(next);
      if (to && to !== art) {
        quiet();
        focusOf(to).focus();
        focusOf(to).scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }, true);
  }
}

export const area: PageArea = {
  // A redraw replaces every card: the one focused is found again by its id, in its new column if it moved.
  before() {
    const a = document.activeElement as HTMLElement | null;
    const art = a?.closest<HTMLElement>('.board[data-keys] article.card');
    const board = art?.closest<HTMLElement>('.board')?.dataset.keys;
    focused = art && board && focusOf(art) === a ? { board, card: art.dataset.cardId ?? '' } : null;
  },
  after() {
    if (!focused) return;
    const { board, card } = focused;
    focused = null;
    const again = [...document.querySelectorAll<HTMLElement>(`.board[data-keys="${CSS.escape(board)}"] article.card`)].find((a) => a.dataset.cardId === card);
    if (again) focusOf(again).focus({ preventScroll: true });
  },
};
