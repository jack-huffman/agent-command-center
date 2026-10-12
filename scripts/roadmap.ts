/**
 * What docs/ROADMAP.md must hold (GH-171). Each bullet that starts with a bold name is one status line:
 *
 *   - **Name**: done. Checked 2026-10-10. Evidence: D-012, GH-5, 0.36.0.
 *
 * A status line, wrapped over indented lines or not, needs one of four statuses, the date it was checked,
 * and at least one decision, issue or release after "Evidence:". A decision must be in DECISIONS.md, a
 * release in the CHANGELOG with its notes (packaging's `changelogEntry`), and no date may be later than today.
 */

import { changelogEntry } from './packaging.ts';

export const STATUSES = ['done', 'under way', 'waiting on a person', 'not started'] as const;

export interface RoadmapCheck {
  /** How many status lines were read. A check that read none has proved nothing. */
  checked: number;
  /** One sentence for each thing wrong, naming the line. */
  problems: string[];
}

const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const RELEASE = /(?<![\d.-])\d+\.\d+\.\d+(?!\.?\d)/g;

/** The status lines: each bold-named bullet, with the lines indented under it joined on. */
export function statusLines(md: string): string[] {
  const lines: string[] = [];
  let open = false;
  for (const raw of md.split('\n')) {
    if (/^- \*\*/.test(raw)) {
      lines.push(raw.slice(2).trim());
      open = true;
    } else if (open && /^ {2,}\S/.test(raw)) {
      lines[lines.length - 1] += ` ${raw.trim()}`;
    } else {
      open = false;
    }
  }
  return lines;
}

/** The decisions DECISIONS.md has: every "## D-nnn" heading. */
export const decisionsIn = (md: string): Set<string> => new Set([...md.matchAll(/^## (D-\d+)\b/gm)].map((m) => m[1] ?? ''));

/** Whether a year, month and day are a real calendar day. */
function realDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Checks ROADMAP.md against the decisions and releases that exist, and today's date (yyyy-mm-dd). */
export function checkRoadmap(roadmap: string, decisions: string, changelog: string, today: string): RoadmapCheck {
  const haveD = decisionsIn(decisions);
  const problems: string[] = [];
  const lines = statusLines(roadmap);
  const statusAt = new RegExp(`^\\*\\*.+?\\*\\*: (${STATUSES.join('|')})\\.`);
  for (const line of lines) {
    const name = /^\*\*(.+?)\*\*/.exec(line)?.[1] ?? line.slice(0, 40);
    const bad = (what: string) => problems.push(`"${name}" ${what}`);
    if (!statusAt.test(line)) bad(`has no status: it should read "**Name**: ${STATUSES.join(' | ')}."`);
    if (!/\bChecked \d{4}-\d{2}-\d{2}\b/.test(line)) bad('has no "Checked yyyy-mm-dd" date');
    for (const m of line.matchAll(DATE)) {
      if (!realDay(Number(m[1]), Number(m[2]), Number(m[3]))) bad(`has a date that isn't a day: ${m[0]}`);
      else if (m[0] > today) bad(`has a date in the future: ${m[0]} (today is ${today})`);
    }
    const at = line.indexOf('Evidence:');
    const evidence = at < 0 ? '' : line.slice(at);
    if (!/\b(?:D|GH)-\d+\b/.test(evidence) && !evidence.match(RELEASE)) bad('has no D-, GH- or release reference after "Evidence:"');
    for (const d of new Set([...line.matchAll(/\bD-\d+\b/g)].map((m) => m[0]))) if (!haveD.has(d)) bad(`names ${d}, which DECISIONS.md doesn't have`);
    for (const r of new Set(line.match(RELEASE) ?? [])) if (changelogEntry(changelog, r) === null) bad(`names release ${r}, which the CHANGELOG has no notes for`);
  }
  return { checked: lines.length, problems };
}
