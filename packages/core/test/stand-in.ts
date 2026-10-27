// A stand-in program for a test (D-T-123): an sh script, made executable, that a Mac and Linux start by name.
// Windows can't start a script with no extension, so there it also gets a .cmd of the same name beside it,
// which runs the script with the sh acc runs command lines with (Git for Windows' sh), as npm's shims run
// their programs. acc's start helper finds the .cmd by PATHEXT and runs it through cmd.exe, as it does sf's.
import { chmodSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { shellPath } from '../src/shell.ts';

/** Writes a stand-in program at this path: the script as given (it starts #!/bin/sh), and on Windows its .cmd. */
export function standIn(path: string, script: string, platform: NodeJS.Platform = process.platform, sh: () => string = shellPath): void {
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  if (platform === 'win32') writeFileSync(`${path}.cmd`, standInCmd(basename(path), sh()));
}

/** The .cmd that runs a stand-in script by Git's sh, with every word it was given. */
export const standInCmd = (name: string, sh: string): string => `@"${sh}" "%~dp0${name}" %*\r\n`;

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
