/**
 * The shell a fix line is written for, and how Do it starts it (T-124). A Mac's line is for its sh; Windows's
 * is for PowerShell. Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import { type InstallSystem, type Shell, shellOf, SYSTEM } from '../../../packages/core/src/onboarding/install-lines.ts';
import { powerShellQuote, quoteArg } from '../../../packages/core/src/onboarding/fix-lines.ts';

/** Quotes one word for PowerShell 5.1: the one quoting packages/core/src/onboarding/fix-lines.ts gives the lines core builds. */
export const psq = powerShellQuote;

/** The function that quotes a word for a shell. */
export const quoteFor = quoteArg;

/** The language of a code block on a step's page: bash on a Mac and Linux, powershell on Windows. */
export const fenceFor = (shell: Shell): 'bash' | 'powershell' => (shell === 'powershell' ? 'powershell' : 'bash');

/**
 * A PowerShell line as the runner starts it: -EncodedCommand takes the line as base64 of UTF-16LE, so no shell that
 * launches powershell.exe (cmd, or the runner's own) needs any escaping of it. The page still shows the readable line.
 */
export const encodedPowerShell = (line: string): string =>
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(line, 'utf16le').toString('base64')}`;

/** The line the runner gets for a fix line: the encoded PowerShell on Windows, the line as it is elsewhere. */
export const runnerLine = (line: string, system: InstallSystem = SYSTEM): string => (shellOf(system) === 'powershell' ? encodedPowerShell(line) : line);

/** What Setup's terminal is created with: PowerShell on Windows, whatever the person's default is on a Mac and Linux. */
export const terminalShell = (system: InstallSystem = SYSTEM): { shellPath?: string; shellArgs?: string[] } =>
  (shellOf(system) === 'powershell' ? { shellPath: 'powershell.exe', shellArgs: ['-NoLogo'] } : {});
