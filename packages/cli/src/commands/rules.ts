// acc's rules commands: copy a team's rules file in, list the copies and compare one with its source (GH-108),
// and the rules suggested by findings that keep coming back, which only a person accepts or dismisses (GH-102).

import {
  AccError, acceptSuggestion, CHECK_ASKS, type CheckAsk, type CopyState, type CopyStatus, dismissSuggestion, type HiddenSuggestion, importedRules, importRules, parseSource,
  reimportCommand, repoPaths, rulesDiff, rulesStatus, run, SUGGESTION_ID, type Suggestion, suggestRules, templateAccount,
} from '../../../core/src/index.ts';
import { table, tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, personOnly, project } from '../shared.ts';

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

// ---------------------------------------------------------------- suggested rules (GH-102)

/** Accepting and dismissing a suggestion is a person's: never a builder's, reviewer's, analyst's or autopilot's. */
function personOnlyRule(o: Opts, what: string): string {
  if (process.env.ACC_ROLE === 'analyst') throw new AccError('refused', `An analyst can't ${what}. A person does that.`);
  return personOnly(o, what);
}

const isHidden = (s: Suggestion | HiddenSuggestion): s is HiddenSuggestion => 'hidden' in s;

/** A suggestion as a person reads it: what it is, its counts, the line, and each finding it came from. */
function suggestionLines(s: Suggestion | HiddenSuggestion): string[] {
  const look = s.kind === 'check' ? tone('Check suggested', 'blue') : tone('Rule suggested', 'blue');
  const counts = `${s.findings} findings across ${s.tasks} tasks${s.must ? ` (${s.must} must)` : ''}`;
  const hidden = isHidden(s) ? `${s.hidden.outcome} by ${s.hidden.by.replace(/^human:/, '')} ${s.hidden.at.slice(0, 10)}: back after ${s.hidden.more} more` : '';
  return [
    `${s.id}  ${look}  ${counts}${hidden ? `  ${tone(hidden, 'dim')}` : ''}`,
    ...(s.kind === 'check' ? [`    ${s.written ? `Already a rule (${s.written}).` : 'Accepted as a rule before.'} It keeps coming back: add a check.`] : []),
    `    ${s.line}`,
    ...s.sources.map((x) => tone(`      ${x.task}  ${x.sha.slice(0, 7)}  ${x.at.slice(0, 10)}  ${x.file ? `${x.file}${x.line ? `:${x.line}` : ''}` : '–'}${x.must ? '  must' : ''}${x.counted ? '' : '  (said again, not counted)'}`, 'dim')),
  ];
}

function cmdSuggested(o: Opts): number {
  const { paths } = project(process.cwd());
  const list = suggestRules(paths, { all: o.all === true });
  out(o, () => (list.length
    ? [...list.flatMap((s) => [...suggestionLines(s), '']), tone('Accept one from the Command Center, or with acc rules accept <id>: it drafts a task a person confirms. acc rules dismiss <id> sets one aside.', 'dim')].join('\n')
    : 'No review finding keeps coming back: a rule is suggested at 3 findings across 2 tasks.'), list);
  return 0;
}

function suggestionId(id: string | undefined, usage: string): string {
  const x = (id ?? '').toLowerCase();
  if (!SUGGESTION_ID.test(x)) throw new AccError('usage', usage);
  return x;
}

function cmdAccept(o: Opts, raw: string | undefined): number {
  const id = suggestionId(raw, 'acc rules accept <id> [--line <text>] [--title <text>] [--check lint|test|gate|any|none] [--note <text>]');
  const by = personOnlyRule(o, 'accept a suggested rule');
  const check = o.check as string | undefined;
  if (check !== undefined && !CHECK_ASKS.includes(check as CheckAsk)) throw new AccError('usage', `--check is ${CHECK_ASKS.join(', ')}, not "${check}".`);
  const { paths, config } = project(process.cwd());
  const r = acceptSuggestion(paths, config, id, {
    ...(typeof o.line === 'string' ? { line: o.line } : {}), ...(typeof o.title === 'string' ? { title: o.title } : {}),
    ...(check ? { check: check as CheckAsk } : {}), ...(typeof o.note === 'string' ? { note: o.note } : {}),
  }, 'human', by, now);
  out(o, () => [
    tone(`✓ Added ${r.task}: ${r.input.title}`, 'blue'),
    `  It's in To do. Its brief holds the rule${r.input.brief?.includes('- [ ] A ') ? ', the check it asks for,' : ''} and the ${r.record.findings.length} findings it came from.`,
    '  acc never writes .acc/rules.md: the task does, and a person merges its pull request.',
  ].join('\n'), { task: r.task, title: r.input.title, brief: r.input.brief, record: r.record });
  return 0;
}

function cmdDismiss(o: Opts, raw: string | undefined): number {
  const id = suggestionId(raw, 'acc rules dismiss <id>');
  const by = personOnlyRule(o, 'dismiss a suggested rule');
  const { paths } = project(process.cwd());
  const r = dismissSuggestion(paths, id, by, now);
  out(o, () => `Dismissed ${id}. It stays hidden until its finding comes back 3 more times.`, r);
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
  acc rules diff [<name>]               How each copy differs from its source now. It changes nothing
  acc rules suggested [--all]           Review findings that keep coming back (3 across 2 tasks), each offered as
                                        a rule for .acc/rules.md, or as a check where it's already a rule. --all
                                        adds the ones a person accepted or dismissed
  acc rules accept <id> [--line <text>] [--title <text>] [--check lint|test|gate|any|none] [--note <text>]
                                        Add the drafted task that adds the rule, or its check. Only a person
  acc rules dismiss <id>                Set a suggestion aside until its finding comes back 3 more times`,
  },
  options: {
    name: { type: 'string' },
    'github-account': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    line: { type: 'string' },
    title: { type: 'string' },
    check: { type: 'string' },
    note: { type: 'string' },
  },
  commands: {
    rules: (o, rest) => {
      if (rest[0] === 'import') return cmdImport(o, rest[1]);
      if (rest[0] === 'list') return cmdList(o);
      if (rest[0] === 'diff') return cmdDiff(o, rest[1]);
      if (rest[0] === 'suggested') return cmdSuggested(o);
      if (rest[0] === 'accept') return cmdAccept(o, rest[1]);
      if (rest[0] === 'dismiss') return cmdDismiss(o, rest[1]);
      throw new AccError('usage', 'acc rules import <source> [--name <name>] [--force] [--dry-run] | list | diff [<name>] | suggested [--all] | accept <id> | dismiss <id>');
    },
  },
};
