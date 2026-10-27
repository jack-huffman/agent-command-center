/**
 * How a fix line that holds more than one command, or an argument that needs quoting, is written for its shell (T-124).
 * Do it runs a Windows line in Windows PowerShell 5.1 (powershell.exe), which has no `&&`, so a line is built per shell,
 * never written for sh and left for PowerShell to choke on.
 */
import type { Shell } from './install-lines.ts';

/** POSIX single quoting: a word of plain characters as it is, anything else in single quotes with ' as '\''. */
const shellQuote = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/**
 * Quotes one native-command argument for Windows PowerShell 5.1. Single quotes, with ' doubled (a curly single quote
 * is one to PowerShell, so it is doubled too). 5.1 also strips each double quote from a native argument and drops an
 * empty '' one, so a " is written \" (the way the C runtime reads it back) and the empty word is '""'.
 */
export const powerShellQuote = (s: string): string => {
  if (s === '') return `'""'`;
  if (/^[\w./-]+$/.test(s)) return s;
  return `'${s.replace(/['‘’‚‛]/g, (q) => q + q).replace(/"/g, '\\"')}'`;
};

/** The function that quotes one argument for a shell. */
export const quoteArg = (shell: Shell): ((s: string) => string) => (shell === 'powershell' ? powerShellQuote : shellQuote);

/**
 * Commands that run one after the other, each only when the one before it worked: `a && b` in sh, and
 * `a; if ($?) { b }` in PowerShell 5.1, which can't parse &&. $? is true after a native command that exits 0.
 */
export const chain = (shell: Shell, ...commands: string[]): string => {
  if (shell !== 'powershell') return commands.join(' && ');
  const [first = '', ...rest] = commands;
  return rest.length ? `${first}; if ($?) { ${chain(shell, ...rest)} }` : first;
};
