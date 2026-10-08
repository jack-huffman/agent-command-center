// acc's shared rules commands (GH-108): copy a rules file in, list the copies, and compare one with its source.

import { AccError, type CopyState, type CopyStatus, importedRules, importRules, parseSource, reimportCommand, repoPaths, rulesDiff, rulesStatus, run, templateAccount } from '../../../core/src/index.ts';
import { table, tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, personOnly } from '../shared.ts';

const STATE: Record<CopyState, { words: string; look: 'blue' | 'orange' | 'dim' }> = {
  unchanged: { words: '✓ unchanged at its source', look: 'blue' },
  changed: { words: '↻ changed at its source', look: 'orange' },
  unreachable: { words: '? its source couldn\'t be read', look: 'orange' },
  'not-here': { words: '– its source isn\'t on this machine', look: 'dim' },
  unchecked: { words: '? not checked in time', look: 'orange' },
  'bad-header': { words: '? its header can\'t be read', look: 'orange' },
  local: { words: '– kept here, with no source', look: 'dim' },
};

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : null);
const when = (c: { commit: string | null; copied: string | null }) => [short(c.commit) ? `commit ${short(c.commit)}` : '', c.copied ? `copied ${c.copied}` : ''].filter(Boolean).join(', ');

/**
 * The GitHub account gh reads a rules file as: --github-account, else the one this repo pushes as, else
 * gh's active one, as acc template show reads a template. Only a GitHub source needs one.
 */
function accountFor(o: Opts, root: string, sources: (string | null)[]): string | null {
  const github = sources.some((s) => {
    try {
      return !!s && parseSource(s, root, undefined, 'rules').kind === 'github';
    } catch {
      return false;
    }
  });
  return github ? templateAccount(run, root, o['github-account'] as string | undefined) : null;
}

function cmdImport(o: Opts, source: string | undefined): number {
  if (!source) throw new AccError('usage', 'acc rules import <path | GitHub file URL | git-url#path> [--name <name>] [--force] [--dry-run]');
  const dryRun = o['dry-run'] === true;
  if (!dryRun) personOnly(o, 'copy rules into the repo');
  const { root } = repoPaths(process.cwd(), run);
  const r = importRules(run, root, source, {
    name: o.name as string | undefined, force: o.force === true, dryRun, account: accountFor(o, root, [source]), base: process.cwd(), now,
  });
  const lines = r.text.replace(/\n$/, '').split('\n');
  const at = r.header.commit ? `at commit ${short(r.header.commit)}` : `on ${r.header.copied}`;
  const replaced = r.replaces
    ? `${r.written ? 'It replaced' : 'It would replace'} the copy${r.replaces.source ? ` from ${r.replaces.source}` : ''}${r.replaces.copied ? `, copied on ${r.replaces.copied}` : ''}${r.replaces.edited ? ', and the edits made to it here' : ''}.`
    : null;
  out(o, () => [
    r.written ? `Copied ${source.trim()} into ${r.file}, ${at}.` : `Would copy ${source.trim()} into ${r.file}, ${at}: ${lines.length} lines. Nothing was written.`,
    ...(replaced ? [replaced] : []),
    ...(r.replaces && !r.written && !o.force ? [tone(`${r.file} is already here: add --force to replace it, or --name to keep both.`, 'orange')] : []),
    ...(r.written ? [`Review it, then commit it. Builders and reviewers read it once it's on an environment's branch, and acc never updates it on its own: Setup says when ${r.header.source} changes.`] : []),
  ].join('\n'), {
    written: r.written, name: r.name, file: r.file, source: r.header.source, commit: r.header.commit, copied: r.header.copied, sha256: r.header.sha256,
    bytes: Buffer.byteLength(r.text), lines: lines.length, exists: !!r.replaces, replaces: r.replaces, preview: lines.slice(0, 15),
  });
  return 0;
}

/** The sources the copies' headers name: only a GitHub one needs an account. */
const sourcesIn = (root: string): (string | null)[] => importedRules(root).map((c) => c.header?.source ?? null);

function statusOf(o: Opts, root: string): CopyStatus[] {
  return rulesStatus(run, root, { account: accountFor(o, root, sourcesIn(root)), base: root });
}

function cmdList(o: Opts): number {
  const { root } = repoPaths(process.cwd(), run);
  const all = statusOf(o, root);
  out(o, () => {
    if (!all.length) return 'No rules are copied in. acc rules import <source> copies one into .acc/rules/.';
    const rows = [['Copy', 'Source', 'When', 'Now'], ...all.map((c) => [
      c.file, c.source ?? '–', when(c) || '–', tone(`${STATE[c.state].words}${c.edited ? ', edited here' : ''}`, STATE[c.state].look),
    ])];
    const changed = all.filter((c) => c.state === 'changed');
    return [
      table(rows),
      ...all.filter((c) => c.reason && c.state !== 'not-here').map((c) => `note: ${c.file}: ${c.reason}`),
      ...(changed.length ? ['', `See what changed: acc rules diff${changed.length === 1 ? ` ${changed[0]!.name}` : ''}`] : []),
    ].join('\n');
  }, all.map(({ body: _body, now: _now, ...c }) => c));
  return 0;
}

function cmdDiff(o: Opts, name: string | undefined): number {
  const { root } = repoPaths(process.cwd(), run);
  const diffs = rulesDiff(run, root, name, { account: accountFor(o, root, sourcesIn(root)), base: root });
  out(o, () => {
    if (!diffs.length) return 'No rules are copied in. acc rules import <source> copies one into .acc/rules/.';
    return diffs.map((d) => {
      const head = `${d.file}${d.source ? `, from ${d.source}` : ''}: ${STATE[d.state].words.replace(/^\S+ /, '')}${d.edited ? ', and edited here' : ''}.`;
      return [
        tone(head, STATE[d.state].look),
        ...(d.reason && d.state !== 'unchanged' ? [`  ${d.reason}`] : []),
        ...(d.diff ? [d.diff] : []),
        ...(d.diff && d.edited ? ['This copy was edited in this repo: copying it in again replaces those edits.'] : []),
        ...(d.diff ? [`To copy it in again, replacing this copy: ${reimportCommand(d)}`] : []),
      ].join('\n');
    }).join('\n\n');
  }, diffs);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Setup',
    order: 15,
    lines: `  acc rules import <source> [--name <name>] [--force] [--dry-run] [--github-account <a>]
                                        Copy a team's rules file into .acc/rules/, with where it came from:
                                        a path, a GitHub file URL, or <git-url>#<path>. You review and commit it
  acc rules list                        Each copy, where it came from, and whether its source has changed
  acc rules diff [<name>]               How each copy differs from its source now. It changes nothing`,
  },
  options: {
    name: { type: 'string' },
    'github-account': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
  commands: {
    rules: (o, rest) => {
      if (rest[0] === 'import') return cmdImport(o, rest[1]);
      if (rest[0] === 'list') return cmdList(o);
      if (rest[0] === 'diff') return cmdDiff(o, rest[1]);
      throw new AccError('usage', 'acc rules import <source> [--name <name>] [--force] [--dry-run] | list | diff [<name>]');
    },
  },
};
