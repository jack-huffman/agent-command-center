// The one way acc starts a program (D-T-123): as named on a Mac or Linux; on Windows looked up with PATH and
// PATHEXT, a .cmd shim such as sf's run through cmd.exe with every word escaped. The escaping is a
// command-injection boundary, so it's tried with hostile words: each must reach the program as it was, and
// none may run a command of its own.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/exec.ts';
import { cmdWord, startChild, startFile, startFor, startOf, windowsProgram } from '../src/start.ts';
import { tempDir } from './support.ts';

/** Words a ticket or a path could hold that cmd would otherwise read as its own. */
const HOSTILE = ['a&b', 'x | echo pwned > pwned.txt', '& echo pwned> pwned.txt', '%PATH%', '"quoted" word', 'back\\', 'back\\"slash', '^caret', '!bang!', '> out.txt', 'semi;colon', '(paren)', 'space here', '', 'it\'s', '`tick`', '*?[]'];

const win = (files: string[], env: NodeJS.ProcessEnv = { Path: 'C:\\Tools;C:\\Program Files\\nodejs', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' }) => ({
  platform: 'win32' as const, env, exists: (p: string) => files.includes(p),
});

test('a Mac and Linux start a program as named, with its words as they are', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    assert.deepEqual(startOf('sf', ['org', 'list', 'a&b'], { platform, env: {}, exists: () => assert.fail('nothing looked up') }), { file: 'sf', args: ['org', 'list', 'a&b'], verbatim: false }, platform);
  }
  if (process.platform !== 'win32') assert.deepEqual(startFor('sf', HOSTILE), { file: 'sf', args: HOSTILE, verbatim: false }, 'this machine, as before');
});

test('Windows finds a program on PATH with PATHEXT, as cmd does, whatever case the variables have', () => {
  assert.equal(windowsProgram('sf', win(['C:\\Program Files\\nodejs\\sf.cmd'])), 'C:\\Program Files\\nodejs\\sf.cmd');
  assert.equal(windowsProgram('git', win(['C:\\Tools\\git.exe', 'C:\\Program Files\\nodejs\\git.cmd'])), 'C:\\Tools\\git.exe', 'the first folder on PATH wins');
  assert.equal(windowsProgram('node', win(['C:\\Tools\\node.cmd', 'C:\\Tools\\node.exe'])), 'C:\\Tools\\node.exe', 'PATHEXT\'s order: .EXE before .CMD');
  assert.equal(windowsProgram('C:\\x\\acc', win(['C:\\x\\acc.cmd'])), 'C:\\x\\acc.cmd', 'a path, with its extension found');
  assert.equal(windowsProgram('C:\\x\\tool.exe', win(['C:\\x\\tool.exe'])), 'C:\\x\\tool.exe', 'a path with its own extension');
  assert.equal(windowsProgram('sf', win(['D:\\sf\\sf.cmd'], { PATH: 'D:\\sf', pathext: '.CMD' })), 'D:\\sf\\sf.cmd', 'PATH and pathext in other cases');
});

test('edge case: a program that isn\'t there is started as named, so it fails as a missing one does', () => {
  assert.deepEqual(startOf('sf', ['--version'], win([])), { file: 'sf', args: ['--version'], verbatim: false });
  assert.equal(run('acc-no-such-program', ['a&b']).code, 127);
});

test('Windows starts an .exe as the file PATH has, and a .cmd shim through cmd.exe, without AutoRun', () => {
  assert.deepEqual(startOf('git', ['status'], win(['C:\\Tools\\git.exe'])), { file: 'C:\\Tools\\git.exe', args: ['status'], verbatim: false });
  const s = startOf('sf', ['org', 'list'], win(['C:\\Program Files\\nodejs\\sf.cmd']));
  assert.ok(!('problem' in s));
  assert.deepEqual([s.file, s.args.slice(0, 3), s.verbatim], ['C:\\Windows\\system32\\cmd.exe', ['/d', '/s', '/c'], true]);
  assert.equal(s.args[3], '"C:\\Program^ Files\\nodejs\\sf.cmd ^^^"org^^^" ^^^"list^^^""', 'the path with carets, each word quoted and caret-escaped twice');
  assert.deepEqual(startOf('x', [], win(['C:\\Tools\\x.bat'], { Path: 'C:\\Tools' })), { file: 'cmd.exe', args: ['/d', '/s', '/c', '"C:\\Tools\\x.bat"'], verbatim: true }, 'cmd.exe by name when ComSpec isn\'t set');
});

test('edge case: every hostile word is quoted and every special character of cmd\'s escaped, so none is read as cmd\'s own', () => {
  assert.equal(cmdWord('a&b'), '^^^"a^^^&b^^^"');
  assert.equal(cmdWord('%PATH%'), '^^^"^^^%PATH^^^%^^^"');
  assert.equal(cmdWord('"quoted" word'), '^^^"\\^^^"quoted\\^^^"^^^ word^^^"', 'a quote escaped for the program, then for cmd');
  assert.equal(cmdWord('back\\'), '^^^"back\\\\^^^"', 'a backslash before the closing quote doubled');
  assert.equal(cmdWord(''), '^^^"^^^"', 'an empty word stays a word');
  for (const w of HOSTILE) {
    // Take away cmd's carets, twice, and what's left is the word quoted as Windows programs read words.
    const once = cmdWord(w).replace(/\^(.)/g, '$1').replace(/\^(.)/g, '$1');
    assert.equal(once, `"${w.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`, w);
    // No special character of cmd's is left bare.
    assert.doesNotMatch(cmdWord(w).replace(/\^\^\^./g, ''), /[&|<>%!"^()]/, w);
  }
});

test('edge case: a word with a line break isn\'t handed to a .cmd, which would end its command line there', () => {
  for (const w of ['line one\nline two', 'a\r\n& echo pwned']) {
    const s = startOf('sf', ['data', w], win(['C:\\Program Files\\nodejs\\sf.cmd']));
    assert.ok('problem' in s && /sf\.cmd is a Windows command script, and cmd can't be handed a line break/.test(s.problem), JSON.stringify(s));
  }
  assert.ok(!('problem' in startOf('claude', ['-p', 'two\nlines'], win(['C:\\Tools\\claude.exe']))), 'an .exe takes it as any word');
});

test('startChild and startFile start a program with its words as they are, and say why one can\'t start', async () => {
  const words = ['a&b', '%PATH%', 'space here'];
  const child = startChild(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...words], { stdio: ['ignore', 'pipe', 'ignore'] });
  assert.ok(!('problem' in child));
  let out = '';
  child.stdout!.on('data', (b: Buffer) => { out += b.toString('utf8'); });
  assert.equal(await new Promise((resolve) => child.on('close', resolve)), 0);
  assert.deepEqual(JSON.parse(out), words);
  const filed = await new Promise<[number | string | null, string]>((resolve) => {
    startFile(process.execPath, ['-e', 'console.log(process.argv[1])', '--', 'a&b'], {}, (err, stdout) => resolve([err?.code ?? null, stdout]));
  });
  assert.deepEqual(filed, [null, 'a&b\n']);
  // Edge case: a program that isn't there fails as one does, in the callback, not thrown.
  const missing = await new Promise<number | string | null | undefined>((resolve) => { startFile('acc-no-such-program', [], {}, (err) => resolve(err?.code)); });
  assert.equal(missing, 'ENOENT');
});

test('a real .cmd shim gets every hostile word as it was, and runs none as a command (Windows; elsewhere, a stand-in)', () => {
  const dir = tempDir('acc-start-');
  let shim: string;
  if (process.platform === 'win32') {
    // As npm's shims do: the program, then every word through %*.
    writeFileSync(join(dir, 'echo-words.cmd'), `@echo off\r\n"${process.execPath}" -e "console.log(JSON.stringify(process.argv.slice(1)))" -- %*\r\n`);
    shim = join(dir, 'echo-words');
  } else {
    writeFileSync(join(dir, 'echo-words.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))\n');
    shim = process.execPath;
  }
  const r = run(shim, process.platform === 'win32' ? HOSTILE : [join(dir, 'echo-words.mjs'), ...HOSTILE], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), HOSTILE);
  assert.equal(existsSync(join(dir, 'pwned.txt')), false, 'no word ran a command');
  assert.deepEqual(readdirSync(dir).sort(), process.platform === 'win32' ? ['echo-words.cmd'] : ['echo-words.mjs'], 'nothing was written');
});
