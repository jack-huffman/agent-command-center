/**
 * The settings check (GH-107). A setting that does nothing is worse than a missing one, so each key
 * .acc/config.json may hold, and each setting the extension contributes, is checked both ways: code reads it
 * and a person can read what it does, and code reads no key or setting that isn't one.
 *
 * - Each key in CONFIG_KEYS is read by code outside config.ts and the tests, unless UNREAD_KEYS or
 *   VALIDATOR_ONLY lists it, and is described in DESIGN.md §4's Field table.
 * - A key on UNREAD_KEYS has no read anywhere, nor through a variable in the files READ_IN names for its
 *   siblings: once one is read, it comes off the list.
 * - Each setting in extension/package.json's contributes.configuration is read with
 *   getConfiguration('agentCommandCenter').get('<name>') in extension/src, and named in README.md.
 * - Every agentCommandCenter setting extension/src names is contributed, and every key read from a raw
 *   parse of .acc/config.json, at the places RAW_READS names, a skill's among them, is one parseConfig knows.
 *
 * Reads are found in the source text, not by the compiler: TypeScript 7 has no language-service API to ask.
 * scripts/test/settings.test.ts runs it on the repo, and on small repos of its own for each finding.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_ROLES, CONFIG_KEYS, type ConfigPath, UNREAD_KEYS, VALIDATOR_ONLY } from '../packages/core/src/config.ts';
import { escapeRegExp } from '../packages/core/src/text.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where code that reads settings lives, from the repo's root. Tests are in none of them. */
export const SOURCE_DIRS = ['packages/*/src', 'extension/src', 'extension/webview', 'scripts'];

/**
 * What in those files names keys without reading them: this check, whole, and in config.ts its validator, its
 * writers and its key lists, by declaration. config.ts's helpers that act on a key, such as autoMergeOn and
 * defaultEnvironment, are reads.
 */
export const NOT_READS: Record<string, string[] | 'all'> = {
  'scripts/settings.ts': 'all',
  'packages/core/src/config.ts': [
    'CONFIG_KEYS', 'UNREAD_KEYS', 'VALIDATOR_ONLY', 'keyShown', 'unknownKeys', 'parseConfig', 'parseEnvironments', 'findCycle',
    'loadConfig', 'writeConfig', 'withTracker', 'rawPrefix', 'ownPrefix', 'setKeys', 'replaceTracker',
  ],
};

const TRACKER_CLIENTS = ['extension/src/trackers.ts'];
const AGENT_FLAGS = ['packages/core/src/agents.ts'];
const SETUP_STEPS = ['packages/core/src/onboarding/steps.ts'];

/** A file that reads a key through a variable, or the file and the read itself, such as `tracker?.labels`. */
export type ReadPlace = string | { file: string; via: RegExp };

/**
 * Where code reads a key whose last part alone would match unrelated code: an environment's or a tracker's,
 * read through a variable such as env or t, an agent role's, which agentArgs reads, the secret scan's and the
 * template's. The check looks for `.<last part>` in these files only, or, where that file reads the same name
 * off something else, such as an issue's labels, for the read of the config object the entry pins. Every
 * other key is found by its qualified read anywhere, such as `gates.severity` or `autopilot?.autoMerge`. When
 * a read moves, the check fails and names this list, so the pointer moves with it.
 */
export const READ_IN: Partial<Record<ConfigPath, ReadPlace[]>> = {
  'environments[].name': [{ file: 'packages/core/src/packet.ts', via: /(?<![.\w])env\.name\b/ }],
  'environments[].type': ['packages/core/src/onboarding/steps.ts'],
  'tools[].title': ['packages/core/src/onboarding/tool-steps.ts'],
  'tools[].why': ['packages/core/src/onboarding/tool-steps.ts'],
  'tools[].check': ['packages/core/src/onboarding/tool-steps.ts'],
  'tools[].fix': ['packages/core/src/onboarding/tool-steps.ts'],
  'environments[].org': ['packages/core/src/packet.ts'],
  'environments[].default': ['packages/core/src/config.ts'],
  'environments[].protected': ['packages/core/src/ledger.ts'],
  'environments[].promotesTo': ['packages/core/src/promote.ts'],
  'trackers[].kind': TRACKER_CLIENTS,
  'trackers[].site': TRACKER_CLIENTS,
  'trackers[].project': TRACKER_CLIENTS,
  'trackers[].repo': ['packages/core/src/intake.ts'],
  'trackers[].organization': TRACKER_CLIENTS,
  'trackers[].account': TRACKER_CLIENTS,
  'trackers[].workspace': TRACKER_CLIENTS,
  'trackers[].channel': TRACKER_CLIENTS,
  'trackers[].reaction': TRACKER_CLIENTS,
  'trackers[].doneReaction': TRACKER_CLIENTS,
  'trackers[].team': TRACKER_CLIENTS,
  // A board's own name (T-127): read where the extension says which board a tracker is.
  'trackers[].name': [{ file: 'extension/src/trackers.ts', via: /\bname: t\.name\b/ }],
  'trackers[].board': TRACKER_CLIENTS,
  'trackers[].statusColumn': TRACKER_CLIENTS,
  'trackers[].prefix': TRACKER_CLIENTS,
  'trackers[].skipLabels': ['packages/core/src/intake.ts'],
  'trackers[].epics': TRACKER_CLIENTS,
  'trackers[].sprint': TRACKER_CLIENTS,
  'trackers[].labels': [{ file: 'packages/core/src/intake.ts', via: /\btracker\??\.labels\b/ }],
  'trackers[].areaPath': TRACKER_CLIENTS,
  'trackers[].group': TRACKER_CLIENTS,
  'trackers[].edits': ['packages/core/src/closing.ts'],
  'trackers[].statusFor': ['packages/core/src/cards.ts'],
  // A tracker's changes field (T-105) is read whole, then each part through the field a tracker client is given.
  'trackers[].changesField.id': [{ file: 'packages/core/src/trackers/jira.ts', via: /\bfield\.id\b/ }],
  'trackers[].changesField.name': [{ file: 'extension/src/model/changes-field.ts', via: /\bfield\.name\b/ }],
  'trackers[].changesField.format': [{ file: 'packages/core/src/trackers/jira.ts', via: /\bfield\.format\b/ }],
  'agents.builder.model': AGENT_FLAGS,
  'agents.builder.effort': AGENT_FLAGS,
  'agents.builder.fallbackModel': AGENT_FLAGS,
  'agents.reviewer.model': AGENT_FLAGS,
  'agents.reviewer.effort': AGENT_FLAGS,
  'agents.reviewer.fallbackModel': AGENT_FLAGS,
  'secretScan.paths': SETUP_STEPS,
  'secretScan.exclude': SETUP_STEPS,
  'template.name': SETUP_STEPS,
  'template.source': SETUP_STEPS,
  'template.digest': SETUP_STEPS,
};

/** A place that parses .acc/config.json raw, not through parseConfig, and how a read there names its key. */
export interface RawRead {
  file: string;
  /** What it reads the file for. */
  why: string;
  /** A read's pattern, global, and the key paths a match reads. */
  reads: { pattern: RegExp; keys: (m: RegExpMatchArray) => string[] }[];
}

/**
 * Every place that reads .acc/config.json raw (GH-107), in code or in a skill an agent follows. The compiler
 * checks reads of a parsed Config; these it can't, so the check reads them here. Each must still find a read,
 * so a place that moves can't pass empty.
 */
export const RAW_READS: RawRead[] = [
  {
    file: 'packages/core/src/agents.ts',
    why: 'acc agents set --project, autonomy and auto-merge change one key and leave the rest of the file as it was',
    reads: [
      { pattern: /\braw\.(\w+)(\[role\])?/g, keys: (m) => (m[2] ? AGENT_ROLES.map((r) => `${m[1]}.${r}`) : [m[1]!]) },
      { pattern: /\bwas\?\.(\w+)/g, keys: (m) => [`autopilot.${m[1]}`] },
    ],
  },
  {
    // saveTracker, outside NOT_READS' validator and writers (GH-112).
    file: 'packages/core/src/config.ts',
    why: 'acc trackers set, which the Connect page asks, writes one tracker, keeping the rest of the file as it was',
    reads: [{ pattern: /\braw\.(\w+)/g, keys: (m) => [m[1]!] }],
  },
  {
    file: 'scripts/packaging.ts',
    why: 'packaging and releasing read the repo\'s own account and identity, even from a config that doesn\'t parse',
    reads: [{ pattern: /\bfield\(config, '(\w+)', '(\w+)'\)/g, keys: (m) => [`${m[1]}.${m[2]}`] }],
  },
  {
    file: 'plugin/skills/intake/SKILL.md',
    why: 'a session reads the tracker\'s place, its repo and labels or its project and epic, before asking a connector for tickets',
    reads: [{ pattern: /\b(?:tracker's|its|it names) `(\w+)`/g, keys: (m) => [`trackers[].${m[1]}`] }],
  },
];

export type Missing = 'read' | 'design' | 'readme' | 'contributed' | 'known' | 'listed' | 'pointer';

/** One problem: the key or setting, what's missing, where it was looked for, and what to do. */
export interface Finding {
  key: string;
  missing: Missing;
  where: string;
  fix: string;
}

/** A finding as a sentence: the key, what's missing where, then the fix. */
export const say = (f: Finding): string => `${f.key} ${f.where}. ${f.fix}`;

export interface SettingsInputs {
  root: string;
  keys: readonly string[];
  unread: Partial<Record<string, string>>;
  validatorOnly: Partial<Record<string, string>>;
  readIn: Partial<Record<string, ReadPlace[]>>;
  rawReads: RawRead[];
  notReads: Record<string, string[] | 'all'>;
}

export interface SettingsResult {
  findings: Finding[];
  /** How many of each the check looked at, so a test can fail when it checked nothing. */
  counted: { keys: number; reads: number; rows: number; settings: number; settingReads: number; rawReads: number };
}

const DESIGN = 'docs/DESIGN.md';
const README = 'README.md';
const PACKAGE = 'extension/package.json';
const SECTION = 'agentCommandCenter';

/** A source file's lines with comments taken out: what a comment names isn't read. */
const codeLines = (text: string): string[] =>
  text.split('\n').map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l.replace(/\s\/\/\s.*$/, '')));
/** The same, with quoted strings emptied too: a message that names `gates.severity` doesn't read it. */
const unquoted = (lines: string[]): string[] => lines.map((l) => l.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''"));

interface Source { file: string; code: string[]; bare: string[] }

/**
 * Empties each declaration of these names, from its first line to the `;` or `}` that ends it, counting
 * brackets in the text without its strings. Returns the names it found none of.
 */
function blank(s: Source, names: string[]): string[] {
  const left: string[] = [];
  for (const name of names) {
    const start = new RegExp(`^(export )?(async )?(function|const|let) ${escapeRegExp(name)}\\b`);
    const starts = s.bare.flatMap((l, i) => (start.test(l) ? [i] : []));
    if (!starts.length) left.push(name);
    for (const from of starts) {
      let depth = 0;
      for (let j = from; j < s.bare.length; j++) {
        for (const ch of s.bare[j]!) depth += '{[('.includes(ch) ? 1 : '}])'.includes(ch) ? -1 : 0;
        const ends = depth <= 0 && /[;}]$/.test(s.bare[j]!.trimEnd());
        s.code[j] = '';
        s.bare[j] = '';
        if (ends) break;
      }
    }
  }
  return left;
}

/** Every source file under SOURCE_DIRS, but tests, with NOT_READS taken out, and the declarations NOT_READS names that aren't there. */
export function sources(root: string, notReads: Record<string, string[] | 'all'> = NOT_READS): { files: Source[]; stale: string[] } {
  const files: Source[] = [];
  const stale: string[] = [];
  const walk = (rel: string) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs).sort()) {
      const r = `${rel}/${name}`;
      if (name === 'test' || name === 'node_modules') continue;
      if (statSync(join(root, r)).isDirectory()) walk(r);
      else if (/\.(ts|mjs|js)$/.test(name) && notReads[r] !== 'all') {
        const code = codeLines(readFileSync(join(root, r), 'utf8'));
        const s = { file: r, code, bare: unquoted(code) };
        const not = notReads[r];
        if (Array.isArray(not)) stale.push(...blank(s, not).map((n) => `${n} in ${r}`));
        files.push(s);
      }
    }
  };
  for (const dir of SOURCE_DIRS) {
    if (!dir.includes('*')) { walk(dir); continue; }
    const [base, rest] = dir.split('/*/');
    if (existsSync(join(root, base!))) for (const p of readdirSync(join(root, base!)).sort()) walk(`${base}/${p}/${rest}`);
  }
  for (const [file, not] of Object.entries(notReads)) if (Array.isArray(not) && !files.some((s) => s.file === file)) stale.push(file);
  return { files, stale };
}

/** The first line matching a pattern, quoted strings left out, as file:line. */
function firstHit(files: Source[], pattern: RegExp): string | null {
  for (const s of files) {
    const i = s.bare.findIndex((l) => pattern.test(l));
    if (i >= 0) return `${s.file}:${i + 1}`;
  }
  return null;
}

const leafOf = (key: string): string => key.slice(key.lastIndexOf('.') + 1);
const parentOf = (key: string): string => (key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : '');
/** Whether code names the key only through a variable of its own, such as a tracker t or a role's profile p. */
const throughVariable = (key: string): boolean => parentOf(key).includes('[]');
/** `<parent>.leaf`, `<parent>?.leaf` or `<parent>!.leaf`; a top-level key's parent is the config. */
const qualified = (key: string): RegExp => {
  const parent = parentOf(key) ? leafOf(parentOf(key)) : 'config';
  return new RegExp(`\\b${escapeRegExp(parent)}[?!]?\\.${escapeRegExp(leafOf(key))}\\b`);
};
/** `.leaf` on anything: a read through a variable, such as t.team. */
const anyRead = (key: string): RegExp => new RegExp(`[\\w$)\\]][?!]?\\.${escapeRegExp(leafOf(key))}\\b`);

const fileOf = (p: ReadPlace): string => (typeof p === 'string' ? p : p.file);
/** What a place's read looks like: `.leaf`, or the read it pins, tested a line at a time, so never global. */
const readAt = (key: string, p: ReadPlace): RegExp => (typeof p === 'string' ? anyRead(key) : new RegExp(p.via.source, p.via.flags.replace(/[gy]/g, '')));
/** What was looked for where, for a finding: `.team` in a.ts, nor /\btracker\??\.labels\b/ in b.ts. */
const lookedFor = (key: string, places: ReadPlace[]): string => {
  const plain = places.filter((p): p is string => typeof p === 'string');
  const pinned = places.flatMap((p) => (typeof p === 'string' ? [] : [`${p.via} in ${p.file}`]));
  return [...(plain.length ? [`\`.${leafOf(key)}\` in ${plain.join(', ')}`] : []), ...pinned].join(', nor ');
};

/** Where a key is read, as file:line, or null. */
function readOf(key: string, files: Source[], readIn: ReadPlace[] | undefined): string | null {
  if (readIn) {
    for (const p of readIn) {
      const hit = firstHit(files.filter((s) => s.file === fileOf(p)), readAt(key, p));
      if (hit) return hit;
    }
    return null;
  }
  if (throughVariable(key)) return null;
  return firstHit(files, qualified(key));
}

/** DESIGN.md §4's Field table: each row's first-cell paths and the whole row's text. */
export function designRows(text: string): { paths: string[]; row: string }[] {
  const start = text.search(/^## 4\. /m);
  if (start < 0) return [];
  const rest = text.slice(start + 1);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const lines = section.split('\n');
  const head = lines.findIndex((l) => /^\|\s*Field\s*\|\s*Meaning\s*\|/.test(l));
  if (head < 0) return [];
  const rows: { paths: string[]; row: string }[] = [];
  for (const l of lines.slice(head + 2)) {
    if (!l.startsWith('|')) break;
    const first = l.split('|')[1] ?? '';
    rows.push({ paths: [...first.matchAll(/`([^`]+)`/g)].map((m) => m[1]!), row: l });
  }
  return rows;
}

/** Whether DESIGN §4 describes a key: its own row, or its nearest described parent's row naming it in backticks. */
function describedIn(key: string, rows: { paths: string[]; row: string }[]): { ok: boolean; parent: string | null } {
  const plain = (k: string) => k.replace(/\[\]/g, '');
  if (rows.some((r) => r.paths.includes(key) || r.paths.includes(plain(key)))) return { ok: true, parent: null };
  for (let p = parentOf(key); p; p = parentOf(p)) {
    const row = rows.find((r) => r.paths.includes(p) || r.paths.includes(plain(p)));
    if (!row) continue;
    const named = [...row.row.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    const path = plain(key);
    return { ok: named.some((n) => n === path || path.endsWith(`.${n}`)), parent: plain(p) };
  }
  return { ok: false, parent: null };
}

/** Whether parseConfig knows a key path, or it's a level that holds some, such as `agents` or `trackers`. */
const known = (key: string, keys: readonly string[]): boolean =>
  keys.some((k) => k === key || k.startsWith(`${key}.`) || k.startsWith(`${key}[].`));

/** The check, on a repo at `root`. Every list defaults to the real one. */
export function checkSettings(over: Partial<SettingsInputs> = {}): SettingsResult {
  const i: SettingsInputs = { root: ROOT, keys: CONFIG_KEYS, unread: UNREAD_KEYS, validatorOnly: VALIDATOR_ONLY, readIn: READ_IN, rawReads: RAW_READS, notReads: NOT_READS, ...over };
  const findings: Finding[] = [];
  const { files, stale } = sources(i.root, i.notReads);
  for (const s of stale) findings.push({ key: s, missing: 'pointer', where: 'is on NOT_READS, but isn\'t there', fix: 'Take it off NOT_READS in scripts/settings.ts, or name the declaration as it\'s called now.' });
  const counted = { keys: i.keys.length, reads: 0, rows: 0, settings: 0, settingReads: 0, rawReads: 0 };
  const listFix = 'list it in UNREAD_KEYS (packages/core/src/config.ts) with the ticket or decision that will read it';

  // Each key is read, but those listed as not; a listed one isn't.
  for (const key of i.keys) {
    const pointer = i.readIn[key];
    if (i.unread[key] !== undefined || i.validatorOnly[key] !== undefined) {
      if (pointer) findings.push({ key, missing: 'listed', where: `is listed as not read, but READ_IN points at ${pointer.map(fileOf).join(', ')}`, fix: 'Take it off READ_IN in scripts/settings.ts, or off the list.' });
      if (i.unread[key] === undefined) continue;
      // Read through a variable, such as a role's p?.fallbackModel, it's read where its siblings are.
      const near = i.keys.filter((k) => k !== key && parentOf(k) === parentOf(key)).flatMap((k) => (i.readIn[k] ?? []).map(fileOf));
      const hit = firstHit(files, throughVariable(key) ? anyRead(key) : qualified(key)) ?? firstHit(files.filter((s) => near.includes(s.file)), anyRead(key));
      if (hit) findings.push({ key, missing: 'listed', where: `is read in ${hit}; take it off the unread list`, fix: 'Take it out of UNREAD_KEYS in packages/core/src/config.ts: something reads it now.' });
      continue;
    }
    counted.reads++;
    const missingFiles = (pointer ?? []).map(fileOf).filter((f) => !existsSync(join(i.root, f)));
    if (readOf(key, files, pointer)) continue;
    const looked = pointer ? `has no read: no ${lookedFor(key, pointer)}${missingFiles.length ? ` (${missingFiles.join(', ')} isn't there)` : ''}`
      : throughVariable(key) ? 'has no read found: it\'s read through a variable, and READ_IN in scripts/settings.ts names no file that reads it'
        : `has no read: no \`${parentOf(key) ? leafOf(parentOf(key)) : 'config'}.${leafOf(key)}\` in ${SOURCE_DIRS.join(', ')}, outside the tests and config.ts's validator`;
    findings.push({ key, missing: 'read', where: looked, fix: `Read it, take it out of Config and CONFIG_KEYS, or ${listFix}. If its read moved, point READ_IN in scripts/settings.ts at the file that reads it now.` });
  }

  // Each key is described in DESIGN §4.
  const designPath = join(i.root, DESIGN);
  const rows = existsSync(designPath) ? designRows(readFileSync(designPath, 'utf8')) : [];
  counted.rows = rows.length;
  for (const key of i.keys) {
    const d = describedIn(key, rows);
    if (d.ok) continue;
    const fix = d.parent ? `Name \`${leafOf(key)}\` in backticks in its \`${d.parent}\` row, or add a row | \`${key}\` | what it does |.` : `Add a row | \`${key}\` | what it does | to the Field table.`;
    findings.push({ key, missing: 'design', where: `isn't described in ${DESIGN} §4`, fix });
  }

  // Each contributed setting is read in extension/src and named in the README; each one read is contributed.
  const pkgPath = join(i.root, PACKAGE);
  const props = existsSync(pkgPath) ? Object.keys((JSON.parse(readFileSync(pkgPath, 'utf8')) as { contributes?: { configuration?: { properties?: Record<string, unknown> } } }).contributes?.configuration?.properties ?? {}) : [];
  const contributed = props.filter((p) => p.startsWith(`${SECTION}.`)).map((p) => p.slice(SECTION.length + 1));
  counted.settings = contributed.length;
  const ext = files.filter((s) => s.file.startsWith('extension/src/'));
  const getRead = new RegExp(`getConfiguration\\(\\s*'${SECTION}'\\s*\\)\\s*\\.get(?:<[^>]*>)?\\(\\s*'([^']+)'`, 'g');
  const named = new RegExp(`'${SECTION}\\.([^']+)'`, 'g');
  const readme = existsSync(join(i.root, README)) ? readFileSync(join(i.root, README), 'utf8') : '';
  // Read with get, and named anywhere, as affectsConfiguration names one: each by where it's first seen.
  const got = new Set<string>();
  const reads = new Map<string, string>();
  for (const s of ext) s.code.forEach((l, n) => {
    for (const m of l.matchAll(getRead)) got.add(m[1]!);
    for (const m of [...l.matchAll(getRead), ...l.matchAll(named)]) if (!reads.has(m[1]!)) reads.set(m[1]!, `${s.file}:${n + 1}`);
  });
  counted.settingReads = got.size;
  for (const name of contributed) {
    const key = `${SECTION}.${name}`;
    if (!got.has(name)) {
      findings.push({ key, missing: 'read', where: `is contributed in ${PACKAGE}, but nothing in extension/src reads it with getConfiguration('${SECTION}').get('${name}')`, fix: `Read it, or take it out of contributes.configuration in ${PACKAGE}: VSCode's Settings can't hide one that does nothing.` });
    }
    if (!new RegExp(`\\b${escapeRegExp(key)}\\b`).test(readme)) {
      findings.push({ key, missing: 'readme', where: `isn't described in ${README}`, fix: `Say what \`${key}\` does in ${README}'s Settings part.` });
    }
  }
  for (const [name, at] of reads) {
    if (contributed.includes(name)) continue;
    findings.push({ key: `${SECTION}.${name}`, missing: 'contributed', where: `is read in ${at}, but ${PACKAGE} doesn't contribute it`, fix: `Add it to contributes.configuration in ${PACKAGE}, with a description, or stop reading it.` });
  }

  // Every key read raw is one parseConfig knows. A skill isn't source, so it's read from disk, whole: its
  // prose is what an agent follows.
  for (const r of i.rawReads) {
    const abs = join(i.root, r.file);
    const lines = files.find((f) => f.file === r.file)?.code ?? (existsSync(abs) ? readFileSync(abs, 'utf8').split('\n') : undefined);
    let found = 0;
    lines?.forEach((l, n) => {
      for (const { pattern, keys } of r.reads) {
        for (const m of l.matchAll(pattern)) {
          for (const key of keys(m)) {
            found++;
            if (!known(key, i.keys)) findings.push({ key, missing: 'known', where: `is read raw in ${r.file}:${n + 1}, but parseConfig doesn't know it`, fix: 'Add it to Config and CONFIG_KEYS in packages/core/src/config.ts, or stop reading it.' });
          }
        }
      }
    });
    counted.rawReads += found;
    if (!found) findings.push({ key: r.file, missing: 'pointer', where: `is on RAW_READS, but no read of .acc/config.json is found there${lines ? '' : ' (it isn\'t there)'}`, fix: 'Point RAW_READS in scripts/settings.ts at where the config is read raw now, or take the place off.' });
  }
  return { findings, counted };
}
