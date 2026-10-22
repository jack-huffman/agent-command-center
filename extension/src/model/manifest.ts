/**
 * Manifest for this ticket, on a Salesforce task's page (T-101): the ticket's package.xml as Salesforce's own
 * CLI built it, what the development org said of each type and member, and after Check against the org, each
 * component whose org copy differs, with its difference and Use the org's copy, and each change in the org the
 * branch lacks, with Add to this ticket. Deletions are listed apart, and never deployed. View, Copy, Save as a
 * file and Add to the ticket's branch act on the kept manifest. It's off, with why, outside a Salesforce
 * project, for a task with no branch, and while one runs. Plain data and the messages' checks: no vscode import.
 */

import type { Task } from '../../../packages/core/src/ledger.ts';
import { componentsOf, type ManifestFinding, manifestRefusal, NEVER_DEPLOYED, ORG_DIFFERS, PACKAGE_FILE, type TicketManifest, ticketManifestDir } from '../../../packages/core/src/manifest.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { KEY, type Look, type ModelArea, short } from './shared.ts';

/** What tells a page how one of the section's buttons went. */
export const MANIFEST_DONE = 'manifest-done';

/** How the section shows: not built, working, built with no org to check, built and clean, built with findings, with org copies that differ, or off. */
export const MANIFEST_LOOK: Record<'none' | 'running' | 'built' | 'ready' | 'findings' | 'differs' | 'off', Look> = {
  none: { label: 'Not built yet', icon: 'circle-large-outline', tone: 'neutral' },
  built: { label: 'Built, not checked', icon: 'file-code', tone: 'neutral' },
  running: { label: 'Working', icon: 'sync~spin', tone: 'blue' },
  ready: { label: 'Matches the org', icon: 'pass', tone: 'blue' },
  findings: { label: 'Look at the findings', icon: 'warning', tone: 'orange' },
  differs: { label: 'The org differs', icon: 'diff', tone: 'orange' },
  off: { label: 'Off', icon: 'circle-slash', tone: 'neutral' },
};

/** How one row shows: a component the ticket creates, one the org lacks or doesn't know, one it couldn't check, an org copy that differs, an org change, or a deletion. */
export const MANIFEST_ROW_LOOK: Record<'new' | 'missing' | 'unknown-type' | 'unchecked' | 'differs' | 'change' | 'deleted', Look> = {
  new: { label: 'New', icon: 'add', tone: 'blue' },
  missing: { label: 'Not in the org', icon: 'warning', tone: 'orange' },
  'unknown-type': { label: 'Unknown type', icon: 'question', tone: 'orange' },
  unchecked: { label: 'Not checked', icon: 'circle-slash', tone: 'orange' },
  differs: { label: 'Differs', icon: 'diff', tone: 'orange' },
  change: { label: 'Changed in the org', icon: 'cloud-download', tone: 'blue' },
  deleted: { label: 'Deleted', icon: 'trash', tone: 'neutral' },
};

/** A button of the section: its label, and why it's off, or null when it's on. */
export interface ManifestButton {
  label: string;
  disabled: string | null;
}

export interface ManifestRow {
  /** `Type:Member`, as a button sends it. */
  component: string;
  type: string;
  member: string;
  look: Look | null;
}

/** The task page's Manifest for this ticket section. */
export interface TicketManifestSection {
  task: string;
  look: Look;
  /** What it says before a manifest, while one is built, or why it's off. */
  note: string | null;
  /** The branch and commit it was built at, its API version, and when. Null before the first. */
  built: { branch: string; sha: string; apiVersion: string; at: string; components: number } | null;
  /** The components, by type, each marked when the ticket creates it. */
  types: { name: string; members: ManifestRow[] }[];
  deletions: ManifestRow[];
  /** What it says of deletions: kept apart, and never deployed. Null with none. */
  deletionsNote: string | null;
  /** Changed files left out: outside the source folders, or environment-specific. */
  leftOut: string | null;
  findings: (ManifestRow & { why: string })[];
  /** Why the org wasn't asked, when it wasn't. */
  unchecked: string | null;
  check: {
    at: string;
    org: string;
    same: string;
    differs: (ManifestRow & { says: string; files: string[]; use: ManifestButton })[];
    /** The org's changes the branch lacks, or why that check isn't available. */
    changes: { items: (ManifestRow & { state: string; add: ManifestButton })[]; why: string | null };
  } | null;
  /** Where Add to the ticket's branch puts it. */
  file: string;
  build: ManifestButton;
  orgCheck: ManifestButton;
  /** View, Copy, Save as a file and Add to the ticket's branch: null before the first build. */
  view: ManifestButton | null;
  copy: ManifestButton | null;
  save: ManifestButton | null;
  commit: ManifestButton | null;
}

export interface ManifestIn {
  task: Pick<Task, 'id' | 'run' | 'state' | 'source'>;
  profile: string;
  /** The development org's alias, or null when the task's environment has none. */
  org: string | null;
  manifest: TicketManifest | null;
  /** What's running: a build, a check, a retrieve or a commit. Null with none. */
  running: string | null;
}

const rowOf = (type: string, member: string, look: Look | null): ManifestRow => ({ component: `${type}:${member}`, type, member, look });

const findingRow = (f: ManifestFinding): ManifestRow & { why: string } => ({ ...rowOf(f.type, f.member ?? '', MANIFEST_ROW_LOOK[f.kind]), component: f.member ? `${f.type}:${f.member}` : f.type, why: f.why });

/**
 * The section for a task's page: off with why outside a Salesforce project or for a task with no branch;
 * otherwise the kept manifest and its check, or how to build one. While one runs, its buttons are off; a
 * change to the branch is off too while its builder works there.
 */
export function ticketManifest(i: ManifestIn): TicketManifestSection {
  const id = i.task.id;
  const key = i.task.source.key ?? id;
  const why = manifestRefusal({ profile: i.profile }, i.task, id);
  const m = why ? null : i.manifest;
  const busy = i.running ? `It's ${i.running} now` : null;
  const builder = i.task.state === 'running' ? 'Its builder is working in its branch now' : null;
  const noOrg = i.org ? null : 'Its environment has no org to check against';
  const button = (label: string, off: string | null = null): ManifestButton => ({ label, disabled: why ?? busy ?? off });
  const deleted = (m?.deletions ?? []).flatMap((d) => d.members.map((x) => rowOf(d.name, x, MANIFEST_ROW_LOOK.deleted)));
  const c = m?.check ?? null;
  return {
    task: id,
    look: why ? MANIFEST_LOOK.off : i.running ? MANIFEST_LOOK.running : !m ? MANIFEST_LOOK.none
      : m.check?.differs.length ? MANIFEST_LOOK.differs : m.findings.length ? MANIFEST_LOOK.findings : m.unchecked ? MANIFEST_LOOK.built : MANIFEST_LOOK.ready,
    note: why ?? (i.running ? 'Salesforce\'s CLI reads the branch, and the org is only read. Nothing changes in the branch.'
      : m ? null : 'Salesforce\'s own CLI lists the components this ticket\'s branch changes, and each is checked against its org. It never deploys.'),
    built: m ? { branch: m.branch, sha: m.sha.slice(0, 7), apiVersion: m.apiVersion, at: m.at, components: componentsOf(m.types).length } : null,
    types: (m?.types ?? []).map((t) => ({ name: t.name, members: t.members.map((x) => rowOf(t.name, x, m!.created.includes(`${t.name}:${x}`) ? MANIFEST_ROW_LOOK.new : null)) })),
    deletions: deleted,
    deletionsNote: deleted.length ? NEVER_DEPLOYED : null,
    leftOut: m?.paths.leftOut.length ? `${plural(m.paths.leftOut.length, 'changed file')} left out: outside the source folders, or environment-specific.` : null,
    findings: (m?.findings ?? []).map(findingRow),
    unchecked: m?.unchecked ?? null,
    check: c ? {
      at: c.at, org: c.org,
      same: `${plural(c.same, 'component')} the same in ${c.org} as in the branch.`,
      differs: c.differs.map((d) => ({ ...rowOf(d.type, d.member, MANIFEST_ROW_LOOK.differs), says: ORG_DIFFERS, files: d.files, use: button('Use the org\'s copy', builder) })),
      changes: c.changes.available
        ? { items: c.changes.items.map((x) => ({ ...rowOf(x.type, x.member, MANIFEST_ROW_LOOK.change), state: x.state, add: button('Add to this ticket', builder) })), why: null }
        : { items: [], why: c.changes.why },
    } : null,
    file: `${ticketManifestDir(key)}/${PACKAGE_FILE}`,
    build: button(m ? 'Build again' : 'Build the manifest'),
    orgCheck: button(c ? 'Check again' : 'Check against the org', noOrg),
    view: m ? button('View') : null,
    copy: m ? button('Copy') : null,
    save: m ? button('Save as a file') : null,
    commit: m ? button('Add to the ticket\'s branch', builder) : null,
  };
}

/** What the page asks of a kept manifest's text: open it, copy it, or save it as a file. */
export const MANIFEST_FILE_ASKS = ['view', 'copy', 'save'] as const;
export type ManifestFileAsk = (typeof MANIFEST_FILE_ASKS)[number];

/** Each message the section sends. */
export const MANIFEST_ACTIONS = ['manifest-build', 'manifest-retrieve', 'manifest-commit', 'manifest-file', 'manifest-diff'] as const;

export type Message =
  /** Build the manifest, or with check, Check against the org (T-101). */
  | { type: 'manifest-build'; project: string; task: string; check?: boolean }
  /** Use the org's copy, or Add to this ticket: one component from the org into the ticket's branch (T-101). */
  | { type: 'manifest-retrieve'; project: string; task: string; component: string }
  /** Add to the ticket's branch: the manifest, committed at manifest/tickets/<key>/ (T-101). */
  | { type: 'manifest-commit'; project: string; task: string }
  /** View, Copy or Save as a file (T-101). */
  | { type: 'manifest-file'; project: string; task: string; how: ManifestFileAsk }
  /** See the difference: one org copy's difference from the branch, opened beside the page (T-101). */
  | { type: 'manifest-diff'; project: string; task: string; component: string };

const forTask = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);
/** A `Type:Member` a button sends: a type, a colon, a member, on one line. */
const component = (v: unknown): boolean => short(v, 1000) && /^[A-Za-z][\w]*:[^\n\r]+$/.test(v as string);

export const area: ModelArea = {
  messages: {
    'manifest-build': (x) => forTask(x) && (x.check === undefined || typeof x.check === 'boolean'),
    'manifest-retrieve': (x) => forTask(x) && component(x.component),
    'manifest-commit': forTask,
    'manifest-file': (x) => forTask(x) && (MANIFEST_FILE_ASKS as readonly unknown[]).includes(x.how),
    'manifest-diff': (x) => forTask(x) && component(x.component),
  },
};
