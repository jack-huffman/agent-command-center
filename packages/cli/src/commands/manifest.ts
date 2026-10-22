// acc manifest (T-101): a Salesforce ticket's package.xml, built by Salesforce's own CLI from what its branch
// changed, checked against the development org, and with --check compared with the org's fresh copies. A
// person retrieves an org copy into the branch, or commits the manifest to it. It never deploys.

import { AccError, buildManifest, draftChangesField, commitManifest, NEVER_DEPLOYED, ORG_DIFFERS, readManifest, retrieveIntoBranch, run, saveManifest, type TicketManifest } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, noAgent, now, type Opts, out, project, steps } from '../shared.ts';

/** A manifest as a person reads it: its components, deletions, what the org said, and what the check found. */
function manifestLines(m: TicketManifest): string[] {
  const count = m.types.reduce((n, t) => n + t.members.length, 0);
  const lines = [`${m.task}'s manifest: ${count} component${count === 1 ? '' : 's'} from ${m.branch} at ${m.sha.slice(0, 7)}, API version ${m.apiVersion}.`, ''];
  for (const t of m.types) lines.push(`  ${t.name}`, ...t.members.map((x) => `    ${x}${m.created.includes(`${t.name}:${x}`) ? tone(' (new)', 'dim') : ''}`));
  if (m.deletions.length) {
    lines.push('', 'Deleted, in destructiveChangesPost.xml:');
    for (const t of m.deletions) lines.push(`  ${t.name}`, ...t.members.map((x) => `    ${x}`));
  }
  if (m.paths.leftOut.length) lines.push('', tone(`Left out: ${m.paths.leftOut.length} changed file${m.paths.leftOut.length === 1 ? '' : 's'} outside the source folders, or environment-specific.`, 'dim'));
  lines.push('');
  if (m.unchecked) lines.push(tone(m.unchecked, 'dim'));
  else if (m.findings.length) lines.push(tone(`! ${m.org} has ${m.findings.length} finding${m.findings.length === 1 ? '' : 's'}:`, 'orange'), ...m.findings.map((f) => `  - ${f.why}`));
  else lines.push(tone(`✓ ${m.org} knows every type and holds every member, but those the ticket creates.`, 'blue'));
  const c = m.check;
  if (c) {
    lines.push('', `Checked against ${c.org}: ${c.same} the same as the branch, ${c.differs.length} that differ.`);
    for (const d of c.differs) lines.push(tone(`  ! ${d.type} ${d.member}: ${ORG_DIFFERS}`, 'orange'), ...d.files.map((f) => tone(`      ${f}`, 'dim')));
    if (c.other.length) lines.push(tone(`  Also changed by the retrieve: ${c.other.join(', ')}`, 'dim'));
    if (!c.changes.available) lines.push(tone(`  Changed in the org: ${c.changes.why}`, 'dim'));
    else if (!c.changes.items.length) lines.push('  Changed in the org, and not in the branch: none.');
    else lines.push(`  Changed in the org, and not in the branch (acc manifest retrieve ${m.task} <Type:Member> adds one):`, ...c.changes.items.map((i) => `    ${i.state} ${i.type}:${i.member}`));
  }
  lines.push('', tone(NEVER_DEPLOYED, 'dim'));
  return lines;
}

function cmdBuild(o: Opts, raw: string): number {
  const { paths, config } = project(process.cwd());
  const id = raw.toUpperCase();
  const file = o.out as string | undefined;
  if (file !== undefined && !file.trim()) throw new AccError('usage', '--out takes the file to write the manifest to.');
  const m = buildManifest(paths, config, id, { run, now, steps: steps() }, { check: o.check === 'org' });
  const saved = file ? saveManifest(m, file) : [];
  // Its package.xml's members are part of its changes field's text (T-105): a draft of it, where its tracker keeps one.
  draftChangesField(paths, run, config, id, 'acc manifest', now);
  out(o, () => [...manifestLines(m), ...(saved.length ? ['', `Wrote ${saved.join(' and ')}.`] : [])].join('\n'), { ...m, saved });
  steps().result(true, m.check ? `${id}'s manifest is built and checked against ${m.check.org}.` : `${id}'s manifest is built.`);
  return 0;
}

function cmdShow(o: Opts, raw: string): number {
  const { paths } = project(process.cwd());
  const id = raw.toUpperCase();
  const m = readManifest(paths, id);
  if (!m) throw new AccError('no-manifest', `${id} has no manifest yet: acc manifest ${id}.`);
  out(o, () => manifestLines(m).join('\n'), m);
  return 0;
}

function cmdRetrieve(o: Opts, raw: string, component: string): number {
  noAgent(o, 'retrieve a component into a ticket\'s branch');
  const { paths, config } = project(process.cwd());
  const c = retrieveIntoBranch(paths, config, raw.toUpperCase(), component, { run, now, steps: steps() });
  out(o, () => `Committed ${c.sha.slice(0, 7)} on ${c.branch}: ${c.message}. ${c.files.join(', ')}`, c);
  return 0;
}

function cmdCommit(o: Opts, raw: string): number {
  noAgent(o, 'commit a manifest to a ticket\'s branch');
  const { paths, config } = project(process.cwd());
  const c = commitManifest(paths, config, raw.toUpperCase(), { run, now, steps: steps() });
  out(o, () => `Committed ${c.sha.slice(0, 7)} on ${c.branch}: ${c.files.join(' and ')}.`, c);
  return 0;
}

const USAGE = 'acc manifest <id> [--check] [--out <file>] | acc manifest show <id> | acc manifest retrieve <id> <Type:Member> | acc manifest commit <id>';

export const area: CommandArea = {
  help: {
    section: 'Environments',
    order: 52,
    lines: `  acc manifest <id> [--check] [--out <file>]
                                        A Salesforce ticket's package.xml, from what its branch changed, by
                                        Salesforce's own CLI; each type and member checked against its org.
                                        --check compares the org's copies with the branch. Deletions go in
                                        destructiveChangesPost.xml. It never deploys
  acc manifest show <id>                The ticket's latest manifest
  acc manifest retrieve <id> <Type:Member>
                                        Retrieve one component from the org into the ticket's branch, and commit it
  acc manifest commit <id>              Commit the manifest to the ticket's branch, at manifest/tickets/<key>/`,
  },
  // --check is a string elsewhere (acc rules), so here it's given its one value before it's parsed.
  options: { check: { type: 'string' }, out: { type: 'string' } },
  argv: { manifest: (argv) => argv.map((x) => (x === '--check' ? '--check=org' : x)) },
  subcommands: { manifest: ['show', 'retrieve', 'commit'] },
  commands: {
    manifest: (o, rest) => {
      if (rest[0] === 'show' || rest[0] === 'commit') {
        if (!rest[1] || rest.length > 2) throw new AccError('usage', USAGE);
        return rest[0] === 'show' ? cmdShow(o, rest[1]) : cmdCommit(o, rest[1]);
      }
      if (rest[0] === 'retrieve') {
        if (!rest[1] || !rest[2] || rest.length > 3) throw new AccError('usage', USAGE);
        return cmdRetrieve(o, rest[1], rest[2]);
      }
      if (!rest[0] || rest.length > 1) throw new AccError('usage', USAGE);
      return cmdBuild(o, rest[0]);
    },
  },
};
