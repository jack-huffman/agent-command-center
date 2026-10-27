/**
 * What a tab shows while it opens (T-16): the acc mark in a turning ring at the tab's center, with one line
 * that says what is opening. It is the tab's HTML until the page script draws the first model over it. Plain
 * HTML, no vscode import, so the screenshot run draws the same screen the tab does.
 */

/** The kinds of tab the Command Center opens. */
export type TabKind = 'home' | 'ticket' | 'agent' | 'conversation' | 'report';

/** The line under the ring, for each kind of tab. It is the loading screen's accessible name too. */
export const OPENING: Record<TabKind, string> = {
  home: 'Opening the Command Center',
  ticket: 'Opening the task',
  agent: 'Opening the agent',
  conversation: 'Opening the conversation',
  report: 'Opening the report',
};

/** The id of the line, which names the screen. */
export const OPENING_WORDS_ID = 'opening-words';

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The loading screen's HTML for a kind of tab, with the dark and light marks' URLs, as the rail draws them. */
export function loadingScreen(kind: TabKind, logos: { dark: string; light: string }): string {
  const marks = (['dark', 'light'] as const).map((t) => `<img class="opening-mark logo-${t}" src="${attr(logos[t])}" alt="">`).join('');
  return `<div class="opening" role="status" aria-live="polite" aria-labelledby="${OPENING_WORDS_ID}">`
    + `<div class="opening-ring">${marks}</div>`
    + `<p class="opening-words" id="${OPENING_WORDS_ID}">${OPENING[kind]}</p></div>`;
}
