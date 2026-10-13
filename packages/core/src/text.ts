// Small helpers that several core files had each written the same way (T-15). Each one is here once.

import type { RunResult } from './exec.ts';

/** A plain JSON object: not null, not an array. */
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The first line a command said (stderr before stdout), or `exit <code>` when it said nothing. */
export const firstLine = (r: RunResult): string => (r.stderr || r.stdout).trim().split('\n')[0]?.trim() || `exit ${r.code}`;

/** The text trimmed, with a full stop added when it doesn't end in . ! or ?. Empty text stays empty. */
export const sentence = (text: string): string => text.trim().replace(/([^.!?])$/, '$1.');
