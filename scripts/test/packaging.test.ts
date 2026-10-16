// Packaging this repo (D-079): one version, the CHANGELOG, the personal-data scan, npm run package's order,
// and npm run release's guards. The packager's words are planted here, never read from this machine.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { run, type Runner, type RunOptions, type RunResult } from '../../packages/core/src/exec.ts';
import { bad, gitIn, makeRepo, ok, tempDir } from '../../packages/core/test/support.ts';
import { type CheckDecision, decideCheck, readReceipt, RECEIPT_FILE, RECEIPT_MAX_AGE_MS, type Receipt, treeState, writeReceipt } from '../check-receipt.ts';
import {
  changelogEntry, changelogProblems, CHANGELOG, checksumText, matcher, NO_TERMS, packageRelease, parseSignIn, personalTerms, PLACEHOLDERS, readVersions, release, ROOT,
  scanFiles, scanLine, scanVsix, setVersion, type Terms, VERSION_PLACES, versionProblems, vsixName, filesIn,
} from '../packaging.ts';

const VERSION = readVersions(ROOT)[0]!.version!;
const REPO = 'jack-huffman/agent-command-center';
const SHA = 'a'.repeat(40);

/** A folder with copies of the repo's own versioned files. */
function root(files: Record<string, string> = {}): string {
  const dir = tempDir('acc-pack-');
  for (const f of new Set(VERSION_PLACES.map((p) => p.file))) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(dir, f));
  }
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

const plant = (dir: string, file: string, from: string, to: string) => writeFileSync(join(dir, file), readFileSync(join(dir, file), 'utf8').replace(from, to));

/** A zip made by macOS's own zip, from these files. */
function zip(out: string, files: Record<string, string>): string {
  const src = tempDir('acc-zip-');
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(src, f)), { recursive: true });
    writeFileSync(join(src, f), text);
  }
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const r = spawnSync('/usr/bin/zip', ['-q', '-r', out, '.'], { cwd: src, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

/** A runner that answers from fixtures (exact, or the longest prefix), says no to the rest, and really unzips. */
function stub(fixtures: Record<string, RunResult | ((args: string[], opts?: RunOptions) => RunResult)>, calls: string[] = []): Runner {
  const keys = Object.keys(fixtures).sort((a, b) => b.length - a.length);
  return (cmd, args, opts) => {
    if (cmd === '/usr/bin/unzip') return run(cmd, args, opts);
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    const key = keys.find((k) => line === k || line.startsWith(`${k} `));
    if (!key) return bad('', 1);
    const f = fixtures[key]!;
    return typeof f === 'function' ? f(args, opts) : f;
  };
}

const PAT: Terms = {
  ...NO_TERMS,
  emails: ['pat.lee@corp.example'],
  logins: ['pat-lee', 'jack-huffman'],
  names: ['patlee', 'pat lee'],
  hosts: ['client.atlassian.net'],
  repos: ['client-co/app'],
  allowed: [`github.com/${REPO}`],
};

const PLANTED = [
  '// a bundle',
  'const x = 1;',
  'const home = "/Users/pat-lee/Documents/x";',
  'const y = 2;',
  'const z = 3;',
  'const w = 4;',
  'const mail = "pat.lee@corp.example";',
  'by pat-lee',
  'const dir = "~/.claude/projects/-Users-patlee-Work";',
  'fetch("https://client.atlassian.net/rest")',
  'const notes = "~/.acc/pat-lee-notes/today";',
  '',
].join('\n');

// ---------------------------------------------------------------- one version

test('everything that ships says the root package.json\'s version, and acc --version does too', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(versionProblems(readVersions(ROOT)), []);
  assert.deepEqual(readVersions(ROOT).map((v) => v.version), VERSION_PLACES.map(() => VERSION));
  const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'packages', 'cli', 'src', 'main.ts'), '--version'], { encoding: 'utf8' });
  assert.equal(r.stdout, `${VERSION}\n`);
});

test('a manifest that says another version is named', () => {
  const dir = root();
  assert.deepEqual(versionProblems(readVersions(dir)), []);
  plant(dir, 'plugin/.claude-plugin/plugin.json', `"version": "${VERSION}"`, '"version": "0.33.9"');
  const problems = versionProblems(readVersions(dir));
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /^plugin\/\.claude-plugin\/plugin\.json says 0\.33\.9, not /);
  plant(dir, '.claude-plugin/marketplace.json', `"version": "${VERSION}"`, '"version": "0.1.0"');
  assert.match(versionProblems(readVersions(dir))[1]!, /marketplace\.json \(the acc plugin\) says 0\.1\.0/);
});

test('set-version changes the version in every place and no other byte', () => {
  const dir = root();
  const before = new Map([...new Set(VERSION_PLACES.map((p) => p.file))].map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
  const changed = setVersion(dir, '9.8.7');
  assert.deepEqual(changed.sort(), [...before.keys()].sort());
  assert.deepEqual(versionProblems(readVersions(dir)), []);
  assert.equal(readVersions(dir)[0]!.version, '9.8.7');
  // Line by line: a dependency in the lockfile that shares the version is a line that mustn't change.
  for (const [f, text] of before) {
    const was = text.split('\n');
    const now = readFileSync(join(dir, f), 'utf8').split('\n');
    assert.equal(now.length, was.length, f);
    const differ = was.map((line, i) => [line, now[i]!] as const).filter(([a, b]) => a !== b);
    assert.equal(differ.length, VERSION_PLACES.filter((p) => p.file === f).length, `${f}: one line for each place`);
    for (const [a, b] of differ) assert.equal(b, a.replace(VERSION, '9.8.7'), `${f}: only its version changed`);
  }
  assert.throws(() => setVersion(dir, '1.2'), /isn't a version/);
  plant(dir, 'extension/package.json', '"version": "9.8.7"', '"versio": "9.8.7"');
  assert.throws(() => setVersion(dir, '1.0.0'), /extension\/package\.json \(found 0\)/);
  assert.equal(readVersions(dir)[0]!.version, '9.8.7', 'nothing was written');
});

// ---------------------------------------------------------------- the CHANGELOG

test('a CHANGELOG entry is found by its version; the shape is newest first, once each, with notes', () => {
  const text = '# Changelog\n\n## 0.35.0\n\n- New things.\n\n## 0.34.0\n\n- Old things.\n- More.\n\n## Earlier versions\n\nSee git log.\n';
  assert.equal(changelogEntry(text, '0.35.0'), '- New things.');
  assert.equal(changelogEntry(text, '0.34.0'), '- Old things.\n- More.');
  assert.equal(changelogEntry(text, '0.36.0'), null);
  assert.equal(changelogEntry('## 0.35.0\n\n## 0.34.0\n\n- x\n', '0.35.0'), null, 'an empty entry is no entry');
  assert.deepEqual(changelogProblems(text), []);
  assert.deepEqual(changelogProblems('## 0.34.0\n\n- a\n\n## 0.35.0\n\n- b\n'), [`${CHANGELOG}:5: 0.35.0 comes after 0.34.0. List the newest first.`]);
  assert.deepEqual(changelogProblems('## 0.35.0\n\n- a\n\n## 0.35.0\n\n- b\n'), [`${CHANGELOG}:5: 0.35.0 is listed twice.`]);
  assert.deepEqual(changelogProblems('## v0.35.0\n\n- a\n'), [`${CHANGELOG}:1: "## v0.35.0" isn't a version. Head each release ## x.y.z.`, `${CHANGELOG} lists no versions. Head each release ## x.y.z.`]);
  assert.deepEqual(changelogProblems('## 0.35.0\n\n## 0.34.0\n\n- a\n'), [`${CHANGELOG}:1: 0.35.0 has no notes.`]);
  assert.deepEqual(changelogProblems('## Earlier versions\n\nx\n\n## 0.35.0\n\n- a\n'), [`${CHANGELOG}:1: "## Earlier versions" must be the last heading.`]);
});

test('the repo\'s CHANGELOG has an entry for its version, in shape', () => {
  const text = readFileSync(join(ROOT, CHANGELOG), 'utf8');
  assert.deepEqual(changelogProblems(text), []);
  assert.ok(changelogEntry(text, VERSION), `${CHANGELOG} has notes for ${VERSION}`);
});

// ---------------------------------------------------------------- no personal data

test('the scan names each planted home path, email, account, name and tracker by file and line', () => {
  const dir = tempDir('acc-scan-');
  writeFileSync(join(dir, 'x.js'), PLANTED);
  const hits = scanFiles(filesIn(dir, 'plugin'), matcher(PAT)).map((h) => `${h.file}:${h.line}: ${h.what}`);
  for (const want of [
    'plugin/x.js:3: a home path (/Users/pat-lee)',
    'plugin/x.js:7: the packager\'s email (pat.lee@corp.example)',
    'plugin/x.js:8: a GitHub account of the packager\'s or the repo\'s (pat-lee)',
    'plugin/x.js:9: a home path, encoded (-Users-patlee)',
    'plugin/x.js:9: a .claude or .acc path with the packager\'s name (~/.claude/projects/-Users-patlee-Work)',
    'plugin/x.js:10: a Jira site (client.atlassian.net)',
    'plugin/x.js:10: a tracker the packager signed in to (client.atlassian.net)',
    'plugin/x.js:11: a .claude or .acc path with the packager\'s name (~/.acc/pat-lee-notes/today)',
  ]) assert.ok(hits.includes(want), `${want}\n in ${hits.join('\n')}`);
  assert.ok(hits.every((h) => !/:(1|2|4|5|6|12): /.test(h)), 'clean lines say nothing');
});

test('the scan opens a .vsix and names the file inside it', () => {
  const vsix = zip(join(tempDir('acc-vsix-out-'), 'a.vsix'), { 'extension/dist/x.js': PLANTED, 'extension/package.json': '{"version":"1.0.0"}\n', '[Content_Types].xml': '<Types/>\n' });
  const r = scanVsix(vsix, matcher(PAT));
  assert.equal(r.files, 3);
  const hits = r.hits.map((h) => `${h.file}:${h.line}: ${h.what}`);
  assert.ok(hits.includes('extension/dist/x.js:3: a home path (/Users/pat-lee)'), hits.join('\n'));
  assert.ok(hits.includes('extension/dist/x.js:7: the packager\'s email (pat.lee@corp.example)'));
});

test('placeholders and the repo\'s own address are never flagged, beside a real hit', () => {
  const m = matcher(PAT);
  const real = ['the packager\'s email (pat.lee@corp.example)'];
  for (const p of [
    'acme.atlassian.net', 'example.atlassian.net', 'jordan-kim', 'jordan', 'jordan@acme.example', 'you@example.com', 'dev.azure.com/acme', 'acme.visualstudio.com',
    `https://github.com/${REPO}`, `https://github.com/${REPO}.git`, `https://github.com/${REPO}/issues`, '/Users/you/x', '/home/jordan/x', '/Users/jordan-kim/x', '~/.claude/projects/-Users-jordan-kim-acme',
    '~/.claude/settings.json', '~/.acc/runtime', 'dev.azure.com/${org}', 'dev.azure.com/<organization>', 'https://x.example/home/page', 'src/home/page', 'JackHuffman.agent-command-center',
  ]) assert.deepEqual(scanLine(`${p} pat.lee@corp.example`, m), real, p);
  assert.deepEqual(scanLine('owner: jack-huffman', m), ['a GitHub account of the packager\'s or the repo\'s (jack-huffman)']);
  // One mention a line, so each is shown caught or let through on its own.
  assert.deepEqual(scanLine('see github.com/jack-huffman', m), ['a GitHub account of the packager\'s or the repo\'s (jack-huffman)']);
  assert.deepEqual(scanLine(`see https://github.com/${REPO}`, m), [], 'only github.com/<the repo> may stay');
  assert.deepEqual(scanLine('github.com/client-co/app', m), ['a repo the packager signed in to a tracker for (client-co/app)']);
  assert.deepEqual(scanLine('https://dev.azure.com/contoso/_git/x and fabrikam.visualstudio.com', m), ['an Azure DevOps organization (dev.azure.com/contoso)', 'an Azure DevOps organization (fabrikam.visualstudio.com)']);
  assert.deepEqual(PLACEHOLDERS, ['acme', 'jordan-kim', 'jordan', 'example', 'you']);
});

test('the packager\'s words come from git, gh, their name and VSCode\'s sign-in names, never a sign-in\'s value', () => {
  const dir = root({ '.acc/config.json': JSON.stringify({ github: { repo: REPO, account: 'jack-huffman' }, commitIdentity: { name: 'jack-huffman', email: 'jh@corp.example' } }) });
  const state = join(dir, 'state.vscdb');
  const db = new DatabaseSync(state);
  db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  const put = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)');
  for (const key of [`acc.cred:github:client-co/app:jira:client.atlassian.net`, `acc.cred:github:${REPO}:jira:other.atlassian.net`, 'acc.cred:git:/tmp/x:azure:clientorg', 'acc.cred:github:acme/service:azure:acme', 'acc.cred:site:jira:shared.atlassian.net', 'acc.cred:site:azure:sharedorg', 'workbench.something']) {
    put.run(`secret://${JSON.stringify({ extensionId: 'jackhuffman.agent-command-center', key })}`, 'SECRET-TOKEN-VALUE');
  }
  db.close();
  const broken = join(dir, 'broken.vscdb');
  writeFileSync(broken, 'not a database');
  const gh = 'github.com\n  ✓ Logged in to github.com account pat-lee (keyring)\n  - Active account: true\n  ✓ Logged in to github.com account pat-work (keyring)\n  - Active account: false\n';
  const home = '/Users/pat-lee';
  const { terms, notes } = personalTerms({
    root: dir, env: {}, home, username: 'patlee', vscodeState: [state, broken, join(dir, 'missing.vscdb')],
    run: stub({
      'git config --get-all user.email': ok('pat.lee@corp.example\n'),
      'git config --global --includes --get-all user.email': ok('Pat.Lee@Corp.Example\nyou@example.com\n'),
      'git config --global --includes --get-all user.name': ok('Pat Lee\n'),
      'git config --global --show-origin --get-regexp ^include(if\\..*)?\\.path$': ok(`file:${home}/.gitconfig\tincludeif.gitdir:~/work/.path ~/.gitconfig-work\nfile:${home}/.gitconfig\tinclude.path .gitconfig-more\n`),
      // A relative include in the system config is beside that file, not in the home folder.
      'git config --system --show-origin --get-regexp ^include(if\\..*)?\\.path$': ok('file:/opt/homebrew/etc/gitconfig\tinclude.path corp.inc\n'),
      [`git config --file ${home}/.gitconfig-work --includes --get-all user.email`]: ok('pat@work.example\n'),
      [`git config --file ${home}/.gitconfig-more --includes --get-all user.email`]: ok('pat@more.example\n'),
      'git config --file /opt/homebrew/etc/corp.inc --includes --get-all user.email': ok('pat@sys.example\n'),
      'gh auth status --hostname github.com': ok(gh),
      'id -F': ok('Pat Lee\n'),
    }),
  });
  assert.deepEqual(terms.emails, ['jh@corp.example', 'pat.lee@corp.example', 'pat@more.example', 'pat@sys.example', 'pat@work.example'], 'every scope and included file, each include beside the file that names it, deduplicated, placeholders dropped');
  assert.deepEqual(terms.logins, ['jack-huffman', 'pat-lee', 'pat-work']);
  assert.deepEqual(terms.names, ['jack-huffman', 'pat lee', 'patlee']);
  assert.deepEqual(terms.hosts, ['client.atlassian.net', 'clientorg.visualstudio.com', 'dev.azure.com/clientorg', 'dev.azure.com/sharedorg', 'other.atlassian.net', 'shared.atlassian.net', 'sharedorg.visualstudio.com'], 'a sign-in for every project on a site too (GH-79)');
  assert.deepEqual(terms.repos, ['client-co/app'], 'the repo\'s own isn\'t a client\'s');
  assert.deepEqual(terms.allowed, [`github.com/${REPO}`]);
  assert.doesNotMatch(JSON.stringify(terms), /SECRET/);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /^Couldn't read VSCode's sign-ins in .*broken\.vscdb .*checked by pattern only\.$/);
  assert.deepEqual(parseSignIn('acc.cred:git:/a/b:jira:x.atlassian.net'), { hosts: ['x.atlassian.net'], repo: null });
  // A sign-in for every project on a site (GH-79) has no repo; one that names nothing else isn't a sign-in.
  assert.deepEqual(parseSignIn('acc.cred:site:jira:x.atlassian.net'), { hosts: ['x.atlassian.net'], repo: null });
  assert.deepEqual(parseSignIn('acc.cred:site:azure:contoso'), { hosts: ['dev.azure.com/contoso', 'contoso.visualstudio.com'], repo: null });
  assert.equal(parseSignIn('acc.cred:jira:x.atlassian.net'), null);
  const noted = (vscodeState: string[]) => personalTerms({ root: dir, env: {}, home, username: 'patlee', vscodeState, run: stub({}) }).notes.join('\n');
  assert.match(noted([join(dir, 'missing.vscdb')]), /weren't found, so tracker sites are checked by pattern only/);
  assert.match(noted([]), /weren't read \(ACC_VSCODE_STATE is empty\)/);
});

// ---------------------------------------------------------------- npm run package

interface Steps { calls: string[]; logs: string[]; shipped: boolean }

function packageWith(dir: string, bundle: string, decide?: () => CheckDecision) {
  const s: Steps = { calls: [], logs: [], shipped: false };
  const r = packageRelease({
    root: dir,
    log: (line) => s.logs.push(line),
    check: () => { s.calls.push('check'); return true; },
    ...(decide ? { decideCheck: decide } : {}),
    vsce: (out) => { s.calls.push('vsce'); zip(out, { 'extension/dist/extension.js': bundle, 'extension/package.json': `{"version":"${VERSION}"}\n` }); return true; },
    shipPlugin: () => { s.shipped = true; },
    terms: () => ({ terms: PAT, notes: [] }),
  });
  return { r, ...s };
}

function packagable(changelog = `## ${VERSION}\n\n- Things.\n`): string {
  return root({
    [CHANGELOG]: changelog, '.acc/config.json': JSON.stringify({ github: { repo: REPO, account: 'jack-huffman' } }),
    'plugin/skills/a/SKILL.md': '# A skill\n', 'dist/acc': '#!/bin/sh\n', 'dist/acc.mjs': '// acc\n',
  });
}

test('npm run package refuses a version with no CHANGELOG entry before it builds anything', () => {
  for (const changelog of ['## 0.0.1\n\n- Old.\n', `## ${VERSION}\n\n## 0.0.1\n\n- Old.\n`]) {
    const p = packageWith(packagable(changelog), '// clean\n');
    assert.deepEqual(p.r, { ok: false, problems: [`${CHANGELOG} has no entry for ${VERSION}. Add "## ${VERSION}" and what changed, newest first.`] });
    assert.deepEqual(p.calls, [], 'nothing built');
  }
  const dir = packagable();
  plant(dir, 'extension/package.json', `"version": "${VERSION}"`, '"version": "0.0.2"');
  const p = packageWith(dir, '// clean\n');
  assert.equal(p.r.ok, false);
  assert.deepEqual(p.calls, []);
});

test('a package with personal data in it is deleted, and plugin/bin is left alone', () => {
  const dir = packagable();
  const vsix = join(dir, 'dist', vsixName(VERSION));
  const p = packageWith(dir, '// a\nconst h = "/Users/pat-lee/x";\n');
  assert.equal(p.r.ok, false);
  if (!p.r.ok) assert.ok(p.r.problems.includes(`${vsixName(VERSION)}: extension/dist/extension.js:2: a home path (/Users/pat-lee)`), p.r.problems.join('\n'));
  assert.equal(existsSync(vsix), false, 'no .vsix left behind');
  assert.equal(p.shipped, false);

  writeFileSync(join(dir, 'dist', 'acc.mjs'), '// acc\nconst m = "pat.lee@corp.example";\n');
  const q = packageWith(dir, '// clean\n');
  assert.equal(q.r.ok, false);
  if (!q.r.ok) assert.ok(q.r.problems.includes('plugin: plugin/bin/acc.mjs:2: the packager\'s email (pat.lee@corp.example)'), q.r.problems.join('\n'));
  assert.equal(q.shipped, false);

  writeFileSync(join(dir, 'dist', 'acc.mjs'), '// acc\n');
  const r = packageWith(dir, '// clean\n');
  assert.deepEqual(r.r, { ok: true, vsix });
  assert.deepEqual(r.calls, ['check', 'vsce']);
  assert.equal(r.shipped, true, 'a clean package refreshes plugin/bin, last');
});

// ---------------------------------------------------------------- the check's receipt (T-56)

const NOW = new Date('2026-10-15T12:00:00Z');

/** A repo with a receipt for its HEAD (from the real writer), and a package run that reads it. */
function receipted(opts: { mutate?: (repo: string) => void; receipt?: boolean; at?: Date; force?: boolean } = {}) {
  const repo = makeRepo({ '.gitignore': 'dist/\n' });
  if (opts.receipt !== false) writeReceipt(repo, treeState(repo), opts.at ?? NOW);
  opts.mutate?.(repo);
  const p = packageWith(packagable(), '// clean\n', () => decideCheck(readReceipt(repo), treeState(repo), NOW, opts.force ?? false));
  return { repo, ...p };
}

test('package skips the check for a receipt of this tree on a clean tree, and says the commit and time', () => {
  const p = receipted();
  assert.equal(p.r.ok, true);
  assert.deepEqual(p.calls, ['vsce'], 'the check did not run');
  const said = p.logs.filter((l) => l.startsWith('Skipping npm run check'));
  assert.equal(said.length, 1);
  assert.ok(said[0]!.includes(gitIn(p.repo, 'rev-parse', 'HEAD').slice(0, 7)), said[0]!);
  assert.ok(said[0]!.includes(NOW.toISOString()), said[0]!);
  assert.deepEqual(JSON.parse(readFileSync(join(p.repo, RECEIPT_FILE), 'utf8')), { tree: gitIn(p.repo, 'rev-parse', 'HEAD^{tree}'), clean: true, at: NOW.toISOString() });
  assert.match(gitIn(p.repo, 'status', '--porcelain', '--ignored'), /!! dist\//, 'git ignores the receipt');
});

test('package runs the check on a dirty tree: an edit, or a file git does not know', () => {
  for (const mutate of [(r: string) => writeFileSync(join(r, 'README.md'), '# changed\n'), (r: string) => writeFileSync(join(r, 'new.txt'), 'x')]) {
    assert.deepEqual(receipted({ mutate }).calls, ['check', 'vsce'], 'the check ran');
  }
});

test('package runs the check when HEAD is another commit than the receipt\'s', () => {
  const p = receipted({ mutate: (r) => { writeFileSync(join(r, 'b.txt'), 'b'); gitIn(r, 'add', '-A'); gitIn(r, 'commit', '-q', '-m', 'next'); } });
  assert.deepEqual(p.calls, ['check', 'vsce']);
});

test('package runs the check when there is no receipt, or one that is not JSON', () => {
  assert.deepEqual(receipted({ receipt: false }).calls, ['check', 'vsce']);
  const junk = receipted({ receipt: false, mutate: (r) => { mkdirSync(join(r, 'dist'), { recursive: true }); writeFileSync(join(r, RECEIPT_FILE), '{nope'); } });
  assert.deepEqual(junk.calls, ['check', 'vsce']);
  assert.equal(readReceipt(junk.repo), null);
});

test('package runs the check for a receipt 24 hours old or from the future, and skips one a minute younger', () => {
  assert.deepEqual(receipted({ at: new Date(NOW.getTime() - RECEIPT_MAX_AGE_MS) }).calls, ['check', 'vsce']);
  assert.deepEqual(receipted({ at: new Date(NOW.getTime() - RECEIPT_MAX_AGE_MS + 60_000) }).calls, ['vsce']);
  assert.deepEqual(receipted({ at: new Date(NOW.getTime() + 60_000) }).calls, ['check', 'vsce']);
});

test('package with --check runs the check even for a receipt that matches', () => {
  const p = receipted({ force: true });
  assert.deepEqual(p.calls, ['check', 'vsce']);
  assert.deepEqual(p.logs.filter((l) => l.startsWith('Skipping')), []);
});

test('a receipt written from a dirty tree says so and never lets package skip; no git state writes none', () => {
  const repo = makeRepo();
  writeFileSync(join(repo, 'README.md'), '# changed\n');
  const r = writeReceipt(repo, treeState(repo), NOW) as Receipt;
  assert.equal(r.clean, false);
  gitIn(repo, 'checkout', '--', 'README.md');
  assert.equal(decideCheck(readReceipt(repo), treeState(repo), NOW, false).run, true);
  assert.equal(writeReceipt(repo, null, NOW), null);
});

// ---------------------------------------------------------------- npm run release

const RELEASE_URL = `https://github.com/${REPO}/releases/tag/v${VERSION}`;

/** A repo ready to release: the versions, an entry, the .vsix, and plugin/bin the same as the .vsix's. */
function releasable(): string {
  const dir = packagable(`## ${VERSION}\n\n- What changed.\n\n## 0.0.1\n\n- Old.\n`);
  const bin = { acc: '#!/bin/sh\nexec node acc.mjs\n', 'acc.mjs': '// the bundle\n' };
  zip(join(dir, 'dist', vsixName(VERSION)), { 'extension/package.json': `{"version":"${VERSION}"}\n`, 'extension/dist/bin/acc': bin.acc, 'extension/dist/bin/acc.mjs': bin['acc.mjs'] });
  mkdirSync(join(dir, 'plugin', 'bin'), { recursive: true });
  for (const [f, text] of Object.entries(bin)) writeFileSync(join(dir, 'plugin', 'bin', f), text);
  return dir;
}

interface Tried { reason: string | null; url: string | null; calls: string[]; created: { args: string[]; env?: NodeJS.ProcessEnv; notes: string; sha256: string | null } | null; asked: boolean }

async function releaseWith(dir: string, o: { tty?: boolean; env?: NodeJS.ProcessEnv; typed?: string; fixtures?: Record<string, RunResult> } = {}): Promise<Tried> {
  const t: Tried = { reason: null, url: null, calls: [], created: null, asked: false };
  const runner = stub({
    'git symbolic-ref --short HEAD': ok('main\n'),
    'git fetch --quiet origin main': ok(),
    'git rev-parse HEAD': ok(`${SHA}\n`),
    'git rev-parse origin/main': ok(`${SHA}\n`),
    'git status --porcelain --untracked-files=no': ok(''),
    'git ls-remote --tags origin': ok(''),
    'gh auth token -u jack-huffman': ok('tok-123\n'),
    'gh release view': bad('release not found'),
    'gh release create': (args, opts) => {
      const notes = args[args.indexOf('--notes-file') + 1]!;
      const sum = args.find((a) => a.endsWith('.sha256'));
      t.created = { args, env: opts?.env, notes: readFileSync(notes, 'utf8'), sha256: sum ? readFileSync(sum, 'utf8') : null };
      return ok(`${RELEASE_URL}\n`);
    },
    ...o.fixtures,
  }, t.calls);
  const r = await release({
    root: dir, run: runner, env: o.env ?? {}, isTTY: o.tty ?? true,
    ask: async () => { t.asked = true; return o.typed ?? VERSION; },
    terms: () => ({ terms: PAT, notes: [] }), log: () => {},
  });
  if (r.ok) t.url = r.url;
  else t.reason = r.reason;
  return t;
}

test('npm run release makes the release as the repo\'s account, with the .vsix and its CHANGELOG entry', async () => {
  const dir = releasable();
  const t = await releaseWith(dir);
  assert.equal(t.reason, null);
  assert.equal(t.url, RELEASE_URL);
  assert.ok(t.asked, 'a person typed the version');
  const notesAt = t.created!.args[t.created!.args.length - 1]!;
  const sumAt = t.created!.args[4]!;
  assert.deepEqual(t.created!.args, ['release', 'create', `v${VERSION}`, join(dir, 'dist', vsixName(VERSION)), sumAt, '-R', REPO, '--target', SHA, '--title', VERSION, '--notes-file', notesAt]);
  assert.equal(t.created!.env?.GH_TOKEN, 'tok-123');
  assert.equal(t.created!.notes, '- What changed.\n');
  assert.equal(existsSync(notesAt), false, 'the notes file is removed');
  assert.equal(basename(sumAt), `${vsixName(VERSION)}.sha256`, 'the checksum is named for the .vsix (T-62)');
  assert.equal(existsSync(sumAt), false, 'and removed with the notes');
  assert.ok(t.calls.includes('gh auth token -u jack-huffman'));
});

test('npm run release honours the clone\'s own account (D-028)', async () => {
  const t = await releaseWith(releasable(), { fixtures: { 'git config --get acc.githubAccount': ok('jh-work\n'), 'gh auth token -u jh-work': ok('tok-work\n') } });
  assert.equal(t.created?.env?.GH_TOKEN, 'tok-work');
});

test('npm run release refuses, saying why, unless a person runs it on a clean, pushed main', async () => {
  const refused = async (why: RegExp, dir: string, o: Parameters<typeof releaseWith>[1] = {}) => {
    const t = await releaseWith(dir, o);
    assert.match(t.reason ?? '(released)', why);
    assert.equal(t.created, null, `${why}: nothing created`);
    return t;
  };
  const noTty = await refused(/npm run release is a person's, run in a terminal/, releasable(), { tty: false });
  assert.deepEqual(noTty.calls, [], 'refused before running anything');
  await refused(/ACC_ROLE is builder/, releasable(), { env: { ACC_ROLE: 'builder' } });
  await refused(/HEAD is task\/x, not main/, releasable(), { fixtures: { 'git symbolic-ref --short HEAD': ok('task/x\n') } });
  await refused(/HEAD \(aaaaaaa\) isn't origin\/main \(bbbbbbb\)/, releasable(), { fixtures: { 'git rev-parse origin/main': ok(`${'b'.repeat(40)}\n`) } });
  await refused(/uncommitted changes/, releasable(), { fixtures: { 'git status --porcelain --untracked-files=no': ok(' M scripts/x.ts\n') } });

  const versions = releasable();
  plant(versions, 'plugin/.claude-plugin/plugin.json', `"version": "${VERSION}"`, '"version": "0.33.9"');
  await refused(/plugin\.json says 0\.33\.9/, versions);

  const noEntry = releasable();
  writeFileSync(join(noEntry, CHANGELOG), '## 0.0.1\n\n- Old.\n');
  await refused(new RegExp(`${CHANGELOG} has no entry for ${VERSION.replaceAll('.', '\\.')}`), noEntry);

  const noVsix = releasable();
  rmSync(join(noVsix, 'dist', vsixName(VERSION)));
  await refused(/There's no dist\/agent-command-center-.*\.vsix\. Run npm run package/, noVsix);
  const oldVsix = releasable();
  zip(join(oldVsix, 'dist', vsixName(VERSION)), { 'extension/package.json': '{"version":"0.0.1"}\n' });
  await refused(/holds version 0\.0\.1, not /, oldVsix);

  const otherAcc = releasable();
  writeFileSync(join(otherAcc, 'plugin', 'bin', 'acc.mjs'), '// another bundle\n');
  await refused(/plugin\/bin\/acc\.mjs isn't the acc\.mjs in the \.vsix/, otherAcc);

  const personal = releasable();
  writeFileSync(join(personal, 'plugin', 'skills', 'a', 'SKILL.md'), '# A skill\n\nSee /Users/pat-lee/notes.\n');
  await refused(/plugin: plugin\/skills\/a\/SKILL\.md:3: a home path \(\/Users\/pat-lee\)/, personal);

  await refused(/is already released: https:/, releasable(), { fixtures: { 'gh release view': ok(`${RELEASE_URL}\n`) } });
  await refused(/tag v.* is already on GitHub/, releasable(), { fixtures: { 'git ls-remote --tags origin': ok(`${SHA}\trefs/tags/v${VERSION}\n`) } });
  await refused(/gh isn't logged in as jack-huffman/, releasable(), { fixtures: { 'gh auth token -u jack-huffman': bad('no account') } });
  const typo = await refused(/You typed "0\.0\.9", not .*Nothing was released/, releasable(), { typed: '0.0.9' });
  assert.ok(typo.asked);
});

test('npm run release uploads the .vsix\'s .sha256 beside it, which matches what shasum -a 256 prints (T-62)', async () => {
  const dir = releasable();
  const vsix = join(dir, 'dist', vsixName(VERSION));
  const t = await releaseWith(dir);
  assert.equal(t.reason, null);
  // shasum -a 256, run in the .vsix's folder, prints the hash, two spaces and the file's name: the extension's update reads that.
  const shasum = spawnSync('shasum', ['-a', '256', vsixName(VERSION)], { cwd: dirname(vsix), encoding: 'utf8' });
  assert.equal(shasum.status, 0, shasum.stderr);
  assert.equal(t.created!.sha256, shasum.stdout);
  assert.equal(checksumText(vsix), shasum.stdout);
  assert.match(t.created!.sha256!, /^[0-9a-f]{64} {2}agent-command-center-\S+\.vsix\n$/);
});

test('a refused release uploads no checksum, the edge case of a release that stops before it creates anything', async () => {
  const t = await releaseWith(releasable(), { typed: 'nope' });
  assert.equal(t.created, null);
  assert.ok(!t.calls.some((c) => c.startsWith('gh release create')));
});
