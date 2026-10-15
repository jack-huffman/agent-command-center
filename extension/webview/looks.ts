// The page's own tables of how a state shows (GH-105). Plain data with no DOM, so the looks test can walk
// them: most other modules here reach the VSCode API as they load. What the model decides, it sends.

import type { Tone } from '../src/logic/shared.ts';

/** Jira's panels: orange for the ones that ask for care, blue for the rest, and each with its own icon. The panel's name is its label. */
export const PANEL: Record<string, { icon: string; tone: Tone }> = {
  Info: { icon: 'info', tone: 'blue' }, Note: { icon: 'note', tone: 'blue' }, Tip: { icon: 'lightbulb', tone: 'blue' }, Success: { icon: 'pass', tone: 'blue' },
  Warning: { icon: 'warning', tone: 'orange' }, Error: { icon: 'error', tone: 'orange' }, Details: { icon: 'chevron-right', tone: 'neutral' },
};

/** A panel Jira named some other way: Info's look. */
export const panelLook = (name: string): { icon: string; tone: Tone } => (Object.hasOwn(PANEL, name) ? PANEL[name]! : PANEL.Info!);

/** A run's name as the picker's list shows it: cut at 36 characters, a running one marked. The title holds the full name. */
export const pickerName = (label: string, running: boolean): string => `${running ? '● ' : ''}${label.length > 36 ? `${label.slice(0, 36)}…` : label}`;

/**
 * The output panel's picker once there is more than one run. Closed, it reads "1 of 4" (the panel's head already
 * names the run); open, its list names every run. Its title gives the selected run's full name.
 */
export function pickerOf(runs: { id: string; label: string; running: boolean }[], selected: string, listing: boolean): { options: { id: string; text: string; selected: boolean }[]; title: string } {
  const at = Math.max(0, runs.findIndex((r) => r.id === selected));
  return {
    options: runs.map((r, i) => ({ id: r.id, selected: i === at, text: listing ? pickerName(r.label, r.running) : `${i + 1} of ${runs.length}` })),
    title: runs[at]?.label ?? '',
  };
}
