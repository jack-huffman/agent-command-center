/**
 * Commands acc runs for you (D-030): their output, and what they ask.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import { hasPlaceholder } from './setup.ts';

// ---------------------------------------------------------------- runs: commands acc runs for you (D-030)

/** Colour codes and other terminal controls, which a log shown as text doesn't want. */
const CONTROL = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/**
 * Adds a chunk of output to a log of lines, as a terminal would show it: a carriage return redraws the
 * current line (progress bars), colour codes are dropped, and only the last `keep` lines are kept.
 * The last element is the line still being written.
 */
export function appendOutput(lines: string[], chunk: string, keep = 2000): string[] {
  const out = lines.length ? [...lines] : [''];
  for (const part of chunk.replace(CONTROL, '').replace(/\r\n/g, '\n').split(/(\n|\r)/)) {
    if (part === '\n') out.push('');
    else if (part === '\r') out[out.length - 1] = '';
    else if (part) out[out.length - 1] += part;
  }
  return out.length > keep ? out.slice(out.length - keep) : out;
}

export interface RunPrompt {
  /** yesno: answer with Yes or No. secret: a password, which a pipe can't take. text: anything else. */
  kind: 'yesno' | 'secret' | 'text';
  text: string;
}

/**
 * Whether a command that has gone quiet is waiting for an answer, from its last, unfinished line:
 * "Continue? [Y/n]", "Password:", "Enter a name:". Null when it's just busy.
 */
export function promptOf(partial: string): RunPrompt | null {
  const line = partial.trim();
  if (!line || line.length > 300) return null;
  if (/password|passphrase|passcode/i.test(line) && /[:?]\s*$/.test(line)) return { kind: 'secret', text: line };
  if (/(\(|\[)\s*y(es)?\s*\/\s*n(o)?\s*(\)|\])|\by\/n\b|yes\/no/i.test(line)) return { kind: 'yesno', text: line };
  if (/(press (enter|return|any key))/i.test(line)) return { kind: 'text', text: line };
  if (/[?:>]\s*$/.test(line) && !/^(https?:\/\/|\w:\\)/.test(line)) return { kind: 'text', text: line };
  return null;
}

/** Commands that need a real terminal: they read the keyboard directly, or talk to you in their own screen. */
export const needsTerminal = (command: string): boolean => /^\s*(claude(\s*$|\s+(?!update\b)[^-])|claude\s*#|sudo\b|ssh\b|vi\b|vim\b|nano\b|gh auth login\b|.*\|\s*less\b)/.test(command) || hasPlaceholder(command);
