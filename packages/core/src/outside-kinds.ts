/**
 * Every kind of change outside git (T-100), one line each: a profile that adds a kind registers it here
 * (D-003). A change of a kind nobody registered still shows, by its kind, with no script.
 */
import type { OutsideKind } from './outside-changes.ts';
import { RECORD_KIND } from './records.ts';

export const OUTSIDE_KINDS: Readonly<Record<string, OutsideKind<any>>> = {
  record: RECORD_KIND,
};

/** The kind a change names, or null for one nobody registered. */
export const outsideKind = (kind: string): OutsideKind<unknown> | null => (Object.hasOwn(OUTSIDE_KINDS, kind) ? OUTSIDE_KINDS[kind]! : null);
