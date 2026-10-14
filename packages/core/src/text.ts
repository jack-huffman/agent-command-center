// Small helpers that several core files had each written the same way (T-15). Each one is here once.

import type { RunResult } from './exec.ts';

/** A plain JSON object: not null, not an array. */
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The first line a command said (stderr before stdout), or `exit <code>` when it said nothing. */
export const firstSaid = (r: RunResult): string => (r.stderr || r.stdout).trim().split('\n')[0]?.trim() || `exit ${r.code}`;

/** The text trimmed, with a full stop added when it doesn't end in . ! or ?. Empty text stays empty. */
export const sentence = (text: string): string => text.trim().replace(/([^.!?])$/, '$1.');

/** The text cut to at most `max` characters, ending in … when it was cut. */
export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A count with its noun: "1 file", "2 files". The third argument is the plural form when it isn't the noun and an s. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Slack's three control characters, so a title like <!channel> is text, not a mention. */
export const slackEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
