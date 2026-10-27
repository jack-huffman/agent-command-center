// acc runs on a Mac and on Windows alike (D-209), and this keeps it so. In acc's own code, outside the two
// helpers and the exceptions named below, it fails on: a program started without the start helper
// (spawn, spawnSync, execFile and the like from node:child_process); an sh started by name, or a shell
// asked for (shell: true), rather than through inShell; a command line that sets a variable inline
// (VAR=value cmd), which only a POSIX shell reads; and the nice command, where os.setPriority does it on
// every system. It counts the files and lines it read, and fails on none.
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

/** acc's own code and the repo's scripts: what runs, and the files it writes for a shell, a hook or Claude Code's settings. */
const SOURCES = ['packages/*/src/**/*.ts', 'extension/src/**/*.ts', 'extension/scripts/**/*.ts', 'scripts/*.ts', 'scripts/*.mjs', 'plugin/hooks/*.json'];

/**
 * What acc ships, where the start rule holds too. The repo's own scripts start node, git and the browser
 * for its checks and releases on the author's Mac and CI; the Windows job runs only scripts/windows-*.ts,
 * which start node, sh and cmd, all .exe files.
 */
const SHIPPED = /^(packages\/[^/]+\/src|extension\/src)\//;

/** The helpers: the one place each of these may happen. */
const HELPERS = ['packages/core/src/start.ts', 'packages/core/src/shell.ts'];

type Rule = 'start' | 'sh' | 'inline' | 'nice';

export interface Hit { file: string; line: number; rule: Rule; text: string }

/** Each exception: a file, the rule it's let off, how many lines it reaches (pinned), and why. */
export const EXCEPTIONS: readonly { file: string; rule: Rule; lines: number; why: string }[] = [
  { file: 'packages/core/src/awake.ts', rule: 'start', lines: 2, why: 'Keep-awake is the Mac\'s only (D-209): caffeinate and ps, which only a Mac has, and both are programs, not shims.' },
  { file: 'extension/src/report-panel.ts', rule: 'start', lines: 1, why: 'It asks sw_vers, a program only a Mac has, and only on a Mac; elsewhere it names the system from Node.' },
  { file: 'packages/core/src/cloud-guard.ts', rule: 'start', lines: 6, why: 'The cloud guard\'s own script, written out for a cloud session, runs on its own with no acc beside it; it starts git, an .exe on Windows too.' },
  { file: 'packages/core/src/cloud-guard.ts', rule: 'nice', lines: 2, why: 'It reads commands an agent types, where nice is a wrapper to see past; acc runs nothing with it.' },
  { file: 'packages/core/src/command-words.ts', rule: 'nice', lines: 2, why: 'It reads commands an agent types, where nice is a wrapper to see past; acc runs nothing with it.' },
  { file: 'packages/core/src/packet.ts', rule: 'nice', lines: 3, why: 'Permission rules for a builder\'s own commands, which a project may run under nice; acc runs nothing with them.' },
];

/** The lines of a file each rule may reach there, by its exceptions. */
const allowed = (file: string, rule: Rule): number => EXCEPTIONS.find((e) => e.file === file && e.rule === rule)?.lines ?? 0;

/** The names a file imports from node:child_process that start a program. */
const STARTERS = /^(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)$/;
function startersOf(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
    for (const part of m[1]!.split(',')) {
      const [name, as] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      if (name && STARTERS.test(name)) names.push((as ?? name).trim());
    }
  }
  return names;
}

/** The lines of one file that break a rule. */
export function hitsIn(file: string, text: string): Hit[] {
  const out: Hit[] = [];
  const starters = SHIPPED.test(file) ? startersOf(text) : [];
  const startCall = starters.length ? new RegExp(`(?<![.\\w])(${starters.join('|')})\\s*\\(`) : null;
  text.split('\n').forEach((line, i) => {
    const hit = (rule: Rule) => out.push({ file, line: i + 1, rule, text: line.trim().slice(0, 160) });
    const comment = /^\s*(\/\/|\*|\/\*)/.test(line);
    if (startCall?.test(line)) hit('start');
    if (/(?<![\w.-])['"`](?:\/bin\/)?sh['"`]\s*,\s*\[|\bcmd:\s*['"`](?:\/bin\/)?sh['"`]|\bshell:\s*true\b|['"`]\/bin\/sh['"`]/.test(line)) hit('sh');
    if (!comment && (/['"`]\s*[A-Z][A-Z0-9_]*=[^\s'"`]*\s+[\w$'"/\\.-]/.test(line) || /"command":\s*"[A-Z][A-Z0-9_]*=/.test(line))) hit('inline');
    if (/['"`(]nice\s+-n\b|['"`]nice['"`]/.test(line)) hit('nice');
  });
  return out;
}

/** Every file the rules read, from the repo's root. */
const sources = (root = ROOT): string[] => [...new Set(SOURCES.flatMap((g) => globSync(g, { cwd: root })))].map((f) => f.replaceAll('\\', '/')).sort();

test('acc starts programs, shells and nice only through its helpers, and sets no variable inline, but for the named exceptions', () => {
  const files = sources();
  let lines = 0;
  const hits: Hit[] = [];
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    lines += text.split('\n').length;
    if (!HELPERS.includes(f)) hits.push(...hitsIn(f, text));
  }
  assert.ok(files.length > 100 && lines > 10_000, `read ${files.length} files, ${lines} lines: too few to have checked acc`);
  console.log(`one-shell: read ${files.length} files, ${lines} lines; ${hits.length} lines are named exceptions`);
  const unexcused = hits.filter((h) => !allowed(h.file, h.rule));
  assert.deepEqual(unexcused.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`), []);
  // Each exception reaches exactly as far as it says: more is a new line it doesn't cover, fewer means it can shrink.
  for (const e of EXCEPTIONS) assert.equal(hits.filter((h) => h.file === e.file && h.rule === e.rule).length, e.lines, `${e.file} [${e.rule}]: ${e.why}`);
});

test('edge case: each form the rules catch is caught, and the helpers\' own forms and a comment are not', () => {
  const shipped = 'packages/core/src/x.ts';
  const rules = (text: string, file = shipped) => hitsIn(file, text).map((h) => h.rule);
  const imports = "import { spawn, execFile as ef, spawnSync } from 'node:child_process';\n";
  assert.deepEqual(rules(`${imports}spawn('claude', []);`), ['start']);
  assert.deepEqual(rules(`${imports}ef('sf', ['--version'], cb);`), ['start'], 'a starter under another name');
  assert.deepEqual(rules(`${imports}const r = spawnSync(cmd, args);`), ['start']);
  assert.deepEqual(rules(`${imports}spawnSync(cmd, args);`, 'scripts/x.ts'), [], 'the repo\'s scripts may start programs');
  assert.deepEqual(rules("import { startSync } from './start.ts';\nstartSync('sf', [], {});"), [], 'through the helper');
  assert.deepEqual(rules("run('sh', ['-c', line]);"), ['sh']);
  assert.deepEqual(rules("return { cmd: 'sh', args: ['-c', c] };"), ['sh']);
  assert.deepEqual(rules('spawn(line, { shell: true });'), ['sh']);
  assert.deepEqual(rules("const sh = '/bin/sh';"), ['sh']);
  assert.deepEqual(rules('const line = `ELECTRON_RUN_AS_NODE=1 ${node} ${script}`;'), ['inline']);
  assert.deepEqual(rules("const c = 'FOO=bar acc hook stop';"), ['inline']);
  assert.deepEqual(rules('{ "type": "command", "command": "ACC_X=1 acc hook stop" }', 'plugin/hooks/hooks.json'), ['inline']);
  assert.deepEqual(rules('// `PATH=/x acc done` sets PATH'), [], 'a comment that names one');
  assert.deepEqual(rules("run('nice', ['-n', '15', 'sf']);"), ['nice']);
  assert.deepEqual(rules("const c = 'nice -n 15 npm test';"), ['nice']);
  assert.deepEqual(rules("run('git', ['status'], { nice: true });"), [], 'nice as acc asks for it');
});
