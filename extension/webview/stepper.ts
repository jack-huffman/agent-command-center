// One step at a time, as Claude Code asks its own questions (T-109, T-113): "2 of 5" and a dot for each step, a
// step's options as numbered radios, and the keys that pick one (a number, Up and Down). Review plan's sheet and
// the conversation's question card both draw their steps with these, and keep what's picked themselves.

import { el, icon, md } from './dom.ts';

/** Where a step stands, as its dot shows it. */
export type StepState = 'current' | 'done' | 'skipped' | 'todo';

const DOT_ICON: Record<StepState, string> = { current: 'circle-filled', done: 'pass-filled', skipped: 'debug-step-over', todo: 'circle-large-outline' };
const DOT_WORD: Record<StepState, string> = { current: 'you are here', done: 'done', skipped: 'skipped', todo: 'to do' };
const DOT_COLOUR = { current: undefined, done: 'blue', skipped: 'orange', todo: undefined } as const;

/**
 * Where it is, in words ("2 of 5"), and a dot for each step, each a click away. Only a skipped step is orange,
 * as orange asks for attention elsewhere in the app; a done one is blue with a check; one not yet seen is plain.
 * With `name`, a dot is named by it ("Question 2: answered") and its tooltip is the step's title alone.
 */
export function stepProgress(words: string, dots: { title: string; state: StepState }[], go: (k: number) => void, name?: (k: number) => string): HTMLElement {
  const list = el('ol', 'rp-dots', ...dots.map((s, k) => {
    const d = el('button', `rp-dot ${s.state}`, icon(DOT_ICON[s.state], DOT_COLOUR[s.state])) as HTMLButtonElement;
    d.type = 'button';
    d.title = name ? s.title : `${k + 1}. ${s.title}: ${DOT_WORD[s.state]}`;
    d.setAttribute('aria-label', name ? name(k) : d.title);
    if (s.state === 'current') d.setAttribute('aria-current', 'step');
    d.addEventListener('click', () => go(k));
    return el('li', '', d);
  }));
  list.setAttribute('aria-label', 'Steps');
  return el('div', 'rp-progress', el('span', 'rp-place', words), list);
}

/** A mark beside an option's name, with an icon and words, never colour alone: Recommended, Suggested, Your current choice. */
export const stepTag = (cls: string, iconName: string, words: string): HTMLElement => el('span', `rp-tag ${cls}`, icon(iconName), words);

/** One option's radio: its number, its name with its marks, and its line under it. Only the picked one takes Tab. */
export function stepRadio(o: { n: number; name: string; line?: string; tags?: (HTMLElement | null)[]; on: boolean; pick: string; click: () => void }): HTMLButtonElement {
  const radio = el('button', `rp-radio${o.on ? ' on' : ''}`,
    el('span', 'rp-num', String(o.n)), icon(o.on ? 'circle-filled' : 'circle-large-outline', o.on ? 'blue' : undefined),
    el('span', 'rp-text', el('span', 'rp-name', o.name, ...(o.tags ?? [])), o.line ? el('span', 'rp-line muted', md(o.line)) : null)) as HTMLButtonElement;
  radio.type = 'button';
  radio.setAttribute('role', 'radio');
  radio.setAttribute('aria-checked', String(o.on));
  radio.tabIndex = o.on ? 0 : -1;
  radio.dataset.pick = o.pick;
  radio.addEventListener('click', o.click);
  return radio;
}

/** A number picks that option, and Up and Down move between them, round. True when the key was one of those. */
export function pickByKey(e: KeyboardEvent, picks: string[], current: string, pick: (id: string) => void): boolean {
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= picks.length) { e.preventDefault(); pick(picks[n - 1]!); return true; }
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return false;
  e.preventDefault();
  const i = picks.indexOf(current);
  pick(picks[(i + step + picks.length) % picks.length]!);
  return true;
}
