// The page's theme (GH-109): Match VSCode, Light or Dark, on <html data-theme>, where theme.css's palettes
// key on it. The extension writes it into the page's HTML, and says when Settings changes it, so an open
// tab restyles in place without reloading.

import type { ThemeChoice } from '../src/model/settings.ts';
import type { PageArea } from './state.ts';

/** Every choice, and no other: the type checks it against the model's THEME_CHOICES, which the page can't import. */
const CHOICES: Record<ThemeChoice, true> = { vscode: true, light: true, dark: true };

/** Puts a theme on the page. Anything but the three choices changes nothing. */
export function applyTheme(theme: unknown): void {
  if (typeof theme === 'string' && Object.hasOwn(CHOICES, theme)) document.documentElement.dataset.theme = theme;
}

export const area: PageArea = {
  receive: {
    theme: (msg) => applyTheme((msg as { theme?: unknown }).theme),
  },
};
