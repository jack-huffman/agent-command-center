// The page's own tables of how a state shows (GH-105). Plain data with no DOM, so the looks test can walk
// them: every other module here reaches the VSCode API as it loads. What the model decides, it sends.

import type { Tone } from '../src/logic/shared.ts';

/** Jira's panels: orange for the ones that ask for care, blue for the rest, and each with its own icon. The panel's name is its label. */
export const PANEL: Record<string, { icon: string; tone: Tone }> = {
  Info: { icon: 'info', tone: 'blue' }, Note: { icon: 'note', tone: 'blue' }, Tip: { icon: 'lightbulb', tone: 'blue' }, Success: { icon: 'pass', tone: 'blue' },
  Warning: { icon: 'warning', tone: 'orange' }, Error: { icon: 'error', tone: 'orange' }, Details: { icon: 'chevron-right', tone: 'neutral' },
};

/** A panel Jira named some other way: Info's look. */
export const panelLook = (name: string): { icon: string; tone: Tone } => (Object.hasOwn(PANEL, name) ? PANEL[name]! : PANEL.Info!);
