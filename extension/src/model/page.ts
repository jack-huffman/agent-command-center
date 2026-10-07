/**
 * The page's own messages, whichever tab sends them: it's ready, refresh it, run a command, open a link, or
 * it moved to another section. No vscode import, so it's testable.
 */

import { HOME_SECTIONS, type HomeSection, type ModelArea, type Ref, short } from './shared.ts';

export type Message =
  | { type: 'ready' } | { type: 'refresh' }
  | { type: 'run'; command: string; ref: Ref }
  | { type: 'toolbar'; command: string; project?: string; arg?: string }
  /** A link in a ticket. Only web links are opened. */
  | { type: 'open'; url: string }
  /** The page moved to another section, so reopening it comes back there. */
  | { type: 'nav'; section: HomeSection };

const command = (x: Record<string, unknown>): boolean => typeof x.command === 'string' && x.command.startsWith('acc.') && (x.arg === undefined || short(x.arg));

export const area: ModelArea = {
  messages: {
    ready: () => true,
    refresh: () => true,
    run: command,
    toolbar: command,
    open: (x) => short(x.url, 4096) && /^(https?:|mailto:)/i.test(x.url as string),
    nav: (x) => (HOME_SECTIONS as readonly string[]).includes(x.section as string),
  },
};
