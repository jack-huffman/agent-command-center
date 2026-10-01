import { DISPLAY, type DisplayState } from '../../core/src/index.ts';
import type { CheckStatus } from '../../core/src/index.ts';

const useColor = (): boolean => !process.env.NO_COLOR && !!process.stdout.isTTY;

/** Orange means look at this, blue means moving. Text always carries the meaning on its own. */
const TONES = { orange: '\x1b[38;5;208m', blue: '\x1b[38;5;33m', neutral: '', dim: '\x1b[2m' } as const;
export function tone(text: string, t: keyof typeof TONES): string {
  if (!useColor() || !TONES[t]) return text;
  return `${TONES[t]}${text}\x1b[0m`;
}

export function stateLabel(s: DisplayState): string {
  const d = DISPLAY[s];
  return tone(`${d.glyph} ${d.label}`, d.tone);
}

const CHECK: Record<CheckStatus, { glyph: string; label: string; tone: keyof typeof TONES }> = {
  pass: { glyph: '✓', label: 'pass', tone: 'blue' },
  fail: { glyph: '✗', label: 'fail', tone: 'orange' },
  unknown: { glyph: '?', label: 'check by hand', tone: 'orange' },
  skip: { glyph: '–', label: 'skip', tone: 'dim' },
};

const LABEL_WIDTH = Math.max(...Object.values(CHECK).map((c) => c.label.length)) + 2;

/** Padded before colouring, so columns line up with or without colour. */
export function checkLabel(s: CheckStatus): string {
  const c = CHECK[s];
  return tone(`${c.glyph} ${c.label}`.padEnd(LABEL_WIDTH), c.tone);
}

export function table(rows: string[][]): string {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => strip(r[i] ?? '').length))) ?? [];
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c + ' '.repeat((widths[i] ?? 0) - strip(c).length))).join('  ')).join('\n');
}
