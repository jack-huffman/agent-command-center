/**
 * What a group check sent back to a builder (T-165), as its packet says it: the tasks it was checked with,
 * the check that failed, the failing tests and the files the failure names that this task's change reaches,
 * and the log's own lines. It's kept in the merge queue's report (checks.ts), so the rework's dispatch reads
 * it as it reads the queue's.
 */
import type { QueueReport } from './checks.ts';

/** What a group check found of one task's change. */
export interface GroupFound {
  /** The tasks it was checked with when the check failed. */
  with: string[];
  /** Whether it failed alone, checked with no other task; else its files matched the failure. */
  alone: boolean;
  /** The failing test files. */
  tests: string[];
  /** The files and pages the failure names that its change reaches. */
  files: string[];
  /** The log's lines that name them. */
  lines: string[];
}

const short = (sha: string): string => sha.slice(0, 7);
const code = (xs: string[]): string => xs.map((f) => `\`${f}\``).join(', ');
const fence = (s: string): string => '`'.repeat(Math.max(3, ...[...s.matchAll(/`+/g)].map((m) => m[0].length + 1)));

/** The packet's section for a group check's send-back. */
export function groupSection(r: QueueReport, g: GroupFound): string[] {
  const base = `\`${r.base}\``;
  const yours = r.pr ? `Your change is pull request #${r.pr.number}. ` : '';
  const how = g.alone
    ? `It failed with your change alone merged into ${base}`
    : `It failed with ${g.with.join(', ')} merged in too, and the failure names files your change reaches`;
  const lines = [
    '## What the group check found',
    '',
    `This is a rework. ${yours}Its review passed, and it was checked together with other tasks before they merge into ${base}. The full check failed: ${r.checks.map((c) => c.gate).join(', ') || 'see the log'}. ${how}.`,
    '',
    ...(g.tests.length ? [`The failing tests: ${code(g.tests)}.`, ''] : []),
    ...(g.files.length ? [`What the failure names that your change reaches: ${code(g.files)}.`, ''] : []),
    `Merge ${base} in first, with \`git merge origin/${r.base}\`. Reproduce the failure here, such as with \`acc gate run ${r.checks[0]?.gate ?? 'check'}\`, and fix it, keeping the rest of the change as it is. Then commit, run \`acc gate run\`, then \`acc done\`. If the failure isn't caused by this change, run \`acc block "<what you found>"\` and stop. Your branch was at ${short(r.sha)}.`,
    '',
  ];
  if (g.lines.length) {
    const text = g.lines.join('\n');
    const f = fence(text);
    lines.push('The lines from its log:', '', `${f}text`, text, f, '');
  }
  for (const c of r.checks) if (c.file) lines.push(`${c.gate}'s whole log: \`${c.file}\``, '');
  return lines;
}
