/**
 * Messages the webview sends. Each area declares its own, and how to check one, in its module's `area`
 * (D-???); everything else is ignored. No vscode import, so it's testable.
 */

import { AREAS, type Message } from './areas.ts';

/** Messages the webview sends: every area's own. */
export type FromWebview = Message;

/** Each message's check, by its type, from the area that sends it. Two areas can't both take one. */
const CHECKS = new Map<string, (x: Record<string, unknown>) => boolean>();
for (const a of AREAS) {
  for (const [type, ok] of Object.entries(a.messages ?? {})) {
    if (CHECKS.has(type)) throw new Error(`Two areas take the message ${type}.`);
    CHECKS.set(type, ok);
  }
}

/** The types of message the page may send, from every area. */
export const MESSAGE_TYPES: readonly string[] = [...CHECKS.keys()];

/** The acc.* commands the page may ask for, from every area. Two areas can't both claim one. */
export const PAGE_COMMANDS: readonly string[] = AREAS.flatMap((a) => a.commands ?? []);
if (new Set(PAGE_COMMANDS).size !== PAGE_COMMANDS.length) throw new Error('Two areas claim the same command.');

export function isFromWebview(m: unknown): m is FromWebview {
  const x = m as Record<string, unknown> | null;
  if (!x || typeof x.type !== 'string') return false;
  const ok = CHECKS.get(x.type);
  return !!ok && ok(x);
}
