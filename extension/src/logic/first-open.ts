/**
 * The Command Center's first open in a folder that isn't set up (GH-138): it lands on Setup, once per
 * folder, in place of the walkthrough tabs that used to open on their own. Plain decisions, no vscode
 * import, so they're testable.
 */

import { type DoctorItem, isComplete } from './setup.ts';

/** Where a folder keeps that its Command Center has had its first open (workspace state). */
export const FIRST_OPEN_STATE = 'acc.home.firstOpened';

/** What B0.config's Do it asks first, and what Setup asks in a folder that isn't set up. */
export const KIND_QUESTION = 'What kind of project is this?';

/** Setup's parts, and the question a folder that isn't set up starts from: their headings carry these as data-part. */
export const SETUP_PARTS = { machine: 'setup:machine', project: 'setup:project', kind: 'setup:kind' } as const;

export interface FirstOpenInput {
  /** A section was asked for, such as Connect a tracker's Tasks or a run's output: it goes there. */
  asked: boolean;
  /** The tab is open already: it stays where it is. */
  open: boolean;
  /** This folder has had its first open. */
  shown: boolean;
  /** The folder has a .acc/config.json; null with no folder open. */
  setUp: boolean | null;
  /** Every one of this machine's steps is done. False before they've been checked. */
  machineDone: boolean;
}

/**
 * Setup, at the part to start from, when this is the folder's first open and it isn't set up: the machine
 * part while its checks haven't all passed, else "What kind of project is this?". Null otherwise, and the
 * Command Center opens where it was left, or on the section Settings names (GH-113).
 */
export function firstOpen(i: FirstOpenInput): { section: 'setup'; part: string } | null {
  if (i.asked || i.open || i.shown || i.setUp !== false) return null;
  return { section: 'setup', part: i.machineDone ? SETUP_PARTS.kind : SETUP_PARTS.machine };
}

/** This machine's steps have all passed, or been done by hand. None checked yet isn't done. */
export function machineDone(items: DoctorItem[], confirmed: Set<string>): boolean {
  const machine = items.filter((i) => i.part === 'machine');
  return machine.length > 0 && machine.every((i) => isComplete(i.status, confirmed.has(i.id)));
}
