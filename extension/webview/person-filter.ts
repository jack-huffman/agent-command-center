// A board's person filter (T-79): which choices it offers, which cards a choice shows, and what its header
// says. Pure: no page state, so node:test loads it (person-filter.test.ts). person-menu.ts draws it.
// It sits here, not in src/logic, because the page imports no values from outside extension/webview.

import type { Who } from '../src/model/boards.ts';

export const EVERYONE = 'everyone';
export const MINE = 'mine';
export const UNASSIGNED = 'unassigned';
/** A choice for one person is `person:` and their key. */
export const PERSON = 'person:';

/** One choice in the menu: an icon and a label, how many cards it shows, and why it can't be picked, if it can't. */
export interface Choice { id: string; label: string; icon: string; count: number; disabled: string | null }

/** Why Mine is off when the tracker didn't say who is signed in. */
export const NO_ME = 'The tracker did not say who is signed in, so Mine cannot tell which cards are yours.';

/**
 * The choice that applies (T-143): one the person made, else Mine when the tracker knows who they are, else
 * Everyone. Mine with nobody to mean falls back to Everyone, since a filter that hides every card for a reason
 * the person can't act on would only look like an empty board.
 */
export const effective = (choice: string | undefined, me: string | null): string => (!choice ? (me ? MINE : EVERYONE) : choice === MINE && !me ? EVERYONE : choice);

/** The quiet line for a board that opens on Everyone because it can't say who the person is: no choice made, nobody known. */
export const everyoneWhy = (choice: string | undefined, me: string | null, tracker: string): string | null => (!choice && !me ? `Showing everyone: sign in to ${tracker} to see just yours` : null);

/** Whether a card with these people shows under a choice. */
export function shows(choice: string, people: readonly Who[], me: string | null): boolean {
  const c = effective(choice, me);
  if (c === EVERYONE) return true;
  if (c === UNASSIGNED) return people.length === 0;
  if (c === MINE) return people.some((p) => p.key === me);
  return people.some((p) => PERSON + p.key === c);
}

/**
 * The choices a board offers, in order: Everyone, Mine, Unassigned, then each person with a card on it,
 * by name. The person already chosen stays listed with no cards, if they have none now, so the choice can be
 * seen and changed.
 */
export function choicesFor(cards: readonly { people: readonly Who[] }[], me: string | null, chosen: string | undefined): Choice[] {
  const names = new Map<string, string>();
  for (const c of cards) for (const p of c.people) if (!names.has(p.key)) names.set(p.key, p.name);
  const kept = chosen?.startsWith(PERSON) ? chosen.slice(PERSON.length) : null;
  if (kept !== null && !names.has(kept)) names.set(kept, kept);
  const count = (choice: string): number => cards.filter((c) => shows(choice, c.people, me)).length;
  return [
    { id: EVERYONE, label: 'Everyone', icon: 'organization', count: cards.length, disabled: null },
    { id: MINE, label: 'Mine', icon: 'account', count: me ? count(MINE) : 0, disabled: me ? null : NO_ME },
    { id: UNASSIGNED, label: 'Unassigned', icon: 'circle-large-outline', count: count(UNASSIGNED), disabled: null },
    ...[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([key, name]): Choice => ({ id: PERSON + key, label: name, icon: 'person', count: count(PERSON + key), disabled: null })),
  ];
}

/** The header's words: "Everyone · 42", or "Mine · 7 of 42". */
export function headerLine(choices: readonly Choice[], choice: string | undefined, me: string | null, total: number): { choice: Choice; text: string } {
  const id = effective(choice, me);
  const at = choices.find((c) => c.id === id) ?? choices[0]!;
  return { choice: at, text: at.id === EVERYONE ? `${at.label} · ${total}` : `${at.label} · ${at.count} of ${total}` };
}

/** What the board says when its choice shows no card. */
export const noMatch = (label: string): string => (label === 'Unassigned' ? 'Every card on this board has someone.' : label === 'Mine' ? 'Nothing assigned to you here.' : `No card here is ${label}'s.`);
