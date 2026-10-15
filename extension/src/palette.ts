// The command palette's key (T-52): acc.palette, bound to Cmd+K on a Mac and Ctrl+K elsewhere while the
// Command Center's tab has focus (package.json), tells the page to open its palette. The page searches and
// runs; this only opens it, and opens the page first when it's closed.
import type { ExtensionArea } from './area.ts';

/** What the page opens its palette on (webview/palette.ts). */
export const PALETTE_MESSAGE = { type: 'palette' } as const;

export const area: ExtensionArea = {
  register({ panels, reg }) {
    reg('acc.palette', () => panels.tell({ ...PALETTE_MESSAGE }));
  },
};
