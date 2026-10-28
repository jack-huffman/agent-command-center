/**
 * A component a ticket deletes (T-138), kept as a change outside git once the ticket's deploy goes: acc
 * never deletes a component in an org (D-190), so each one becomes a step a person makes by hand in each
 * org the ticket reaches, and marks done or skips, as a record change's step is (T-100).
 */
import type { OutsideKind } from './outside-changes.ts';

/** A deleted component: "Apex Class: OldRouting", and the source file it was. */
export interface DeletedComponent {
  component: string;
  path: string;
}

export const DELETION_KIND: OutsideKind<DeletedComponent> = {
  kind: 'deletion',
  profile: 'salesforce',
  label: 'Deletions',
  problems: (d) => (d.component.trim() ? [] : ['Name the component it deletes.']),
  words: (d) => `Delete ${d.component} by hand`,
  key: (d) => d.component,
  script: (d, org) => [`# In ${org ?? 'the org'}'s Setup, delete ${d.component}. Its source was ${d.path}.`],
};
