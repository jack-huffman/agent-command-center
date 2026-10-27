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
