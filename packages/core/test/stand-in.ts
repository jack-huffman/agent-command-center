// A stand-in program for a test (D-209): an sh script, made executable, that a Mac and Linux start by name.
// Windows can't start a script with no extension, so there it also gets the .cmd npm writes for a program,
// as npm installs claude there, which runs a node script beside it that runs the stand-in by the sh acc runs
// command lines with (Git for Windows' sh). acc's start helper finds the .cmd by PATHEXT and runs it as it
// runs npm's claude: through cmd.exe, or by node when a word holds a line break, which cmd can't be handed
// (start.ts, npmShimScript), as dispatch's and the drafter's prompts do.
import { chmodSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { shellPath } from '../src/shell.ts';

/** The node script beside a stand-in on Windows, which its .cmd runs. */
export const standInRunnerName = (name: string): string => `${name}.stand-in.cjs`;

/** Writes a stand-in program at this path: the script as given (it starts #!/bin/sh), and on Windows its .cmd and runner. */
export function standIn(path: string, script: string, platform: NodeJS.Platform = process.platform, sh: () => string = shellPath): void {
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  if (platform !== 'win32') return;
  const runner = standInRunnerName(basename(path));
  writeFileSync(join(dirname(path), runner), standInRunner(basename(path), sh()));
  writeFileSync(`${path}.cmd`, npmShim(runner));
}

/**
 * The node script that runs a stand-in's sh script by this sh, with every word, its input and its exit. On
 * Windows each word is quoted as Git's sh (an MSYS program) reads its command line, the sh's own path too:
 * unquoted, it would expand a word with * or braces as a pattern, and read one that starts with @ as a file
 * of words. In quotes it reads \\ as \ and \" as ", but a word that starts with a drive (C:) as it is.
 */
export const standInRunner = (name: string, sh: string): string => [
  "const { spawnSync } = require('node:child_process');",
  "const { join } = require('node:path');",
  `const sh = ${JSON.stringify(sh)};`,
  `const words = [join(__dirname, ${JSON.stringify(name)}), ...process.argv.slice(2)];`,
  String.raw`const q = (w) => '"' + (/^[A-Za-z]:/.test(w) ? w : w.replace(/[\\"]/g, '\\$&')) + '"';`,
  "const win = process.platform === 'win32';",
  "const r = spawnSync(sh, win ? words.map(q) : words, { stdio: 'inherit', ...(win ? { argv0: q(sh), windowsVerbatimArguments: true } : {}) });",
  "if (r.error) { process.stderr.write(r.error.message + '\\n'); process.exit(127); }",
  'process.exit(r.status ?? 1);',
  '',
].join('\n');

/**
 * Writes a stand-in program that is a node script (it starts #!/usr/bin/env node). On Windows its .cmd is
 * the shim npm writes for a package's program, as npm installs claude there, so acc runs it as it runs
 * npm's claude: through cmd, or by node when a word holds a line break (start.ts, npmShimScript).
 */
export function nodeStandIn(path: string, script: string, platform: NodeJS.Platform = process.platform): void {
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  if (platform === 'win32') writeFileSync(`${path}.cmd`, npmShim(basename(path)));
}

/** npm's .cmd shim (cmd-shim) for a node script beside it: node.exe there, else node on PATH. */
export const npmShim = (script: string): string => [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*`, '',
].join('\r\n');
