/**
 * Coverage for each Apex class and trigger a ticket changes (T-159), read from the org after the deploy gate's
 * test run: the Tooling API's ApexCodeCoverageAggregate, which Salesforce clears for a class when it's deployed
 * again, so what it holds then is what the tests found since. A changed class or trigger under the floor fails
 * the gate. The floor is Salesforce's own for Production, 75%, and the project's settings may raise it, never
 * lower it. 100% is the goal: a class at or over the floor and under 100% passes, and its figure is said.
 * Test classes don't count, and nor does an interface or an enum, which has no line to cover.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Config, COVERAGE_FLOOR } from './config.ts';
import type { RunResult } from './exec.ts';
import { parseDeployJson } from './gates.ts';
import { plural } from './text.ts';

/** The floor a changed class or trigger must reach in the org: the project's own, or Salesforce's. */
export const coverageFloor = (config: Pick<Config, 'gates'>): number => config.gates.apexCoverage ?? COVERAGE_FLOOR;

/** A changed Apex class or trigger the floor applies to: its name, its kind and its path. */
export interface ChangedApex {
  name: string;
  kind: 'class' | 'trigger';
  path: string;
}

/** One class's or trigger's coverage in the org, as the receipt and the task keep it. */
export interface ClassCoverage {
  name: string;
  /** Lines covered and not covered. Both 0: no line to cover. */
  covered: number;
  uncovered: number;
  /** The lines not covered, by number, when the org said which. */
  lines: number[];
  /** No test ran a line of it: the org had no coverage for it. */
  unran?: true;
}

const SOURCE = /\.(cls|trigger)$/;
/** An Apex name the org knows: a letter, then letters, digits and underscores. Nothing else goes in a query. */
const APEX_NAME = /^[A-Za-z]\w*$/;
/** An @isTest annotation before the top-level declaration: a test class. */
const TEST_CLASS = /^[^{]*@isTest\b/i;
/** A top-level interface or enum: there's no line in it to cover. */
const NO_LINES = /^[^{]*\b(interface|enum)\s+\w+\s*(extends\b[^{]*)?\{/i;

/** Strips comments, so an @isTest or an interface named in one doesn't count. */
const uncommented = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/**
 * The Apex classes and triggers the floor applies to, from the source a ticket changes: never a test class (one
 * the builder named for the run, or one whose source says @isTest), an interface or an enum. A file the
 * worktree can't read counts, so a changed class never slips out unchecked.
 */
export function changedApex(root: string, source: string[], tests: { name: string }[]): ChangedApex[] {
  const named = new Set(tests.map((t) => t.name.toLowerCase()));
  const out: ChangedApex[] = [];
  for (const path of source) {
    const m = SOURCE.exec(path);
    if (!m) continue;
    const name = basename(path).replace(SOURCE, '');
    if (!APEX_NAME.test(name) || named.has(name.toLowerCase())) continue;
    let text = '';
    try {
      text = uncommented(readFileSync(join(root, path), 'utf8'));
    } catch {
      // Unreadable: it counts.
    }
    if (TEST_CLASS.test(text) || (m[1] === 'cls' && NO_LINES.test(text))) continue;
    out.push({ name, kind: m[1] === 'trigger' ? 'trigger' : 'class', path });
  }
  return out;
}

/** How the org is asked for each class's coverage: the Tooling API's ApexCodeCoverageAggregate, by name. */
export function coverageQueryArgs(org: string, names: string[]): string[] {
  const list = names.filter((n) => APEX_NAME.test(n)).map((n) => `'${n}'`).join(', ');
  return ['data', 'query', '--use-tooling-api', '--target-org', org, '--json', '--query',
    `SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered, Coverage FROM ApexCodeCoverageAggregate WHERE ApexClassOrTrigger.Name IN (${list})`];
}

interface AggregateJson {
  status?: number;
  result?: { records?: { ApexClassOrTrigger?: { Name?: string }; NumLinesCovered?: number; NumLinesUncovered?: number; Coverage?: { uncoveredLines?: number[] } | null }[] };
}

/**
 * Each wanted class's coverage, read from `sf data query --json`, or null when sf gave no records. A class
 * the org has no row for is one no test ran: nothing covered, its lines unknown.
 */
export function readCoverage(r: RunResult, wanted: string[]): ClassCoverage[] | null {
  let j: AggregateJson;
  try {
    j = parseDeployJson<AggregateJson>(r);
  } catch {
    return null;
  }
  const records = j.result?.records;
  if (j.status !== 0 || !Array.isArray(records)) return null;
  const byName = new Map(records.map((x) => [(x.ApexClassOrTrigger?.Name ?? '').toLowerCase(), x]));
  return wanted.map((name) => {
    const row = byName.get(name.toLowerCase());
    if (!row) return { name, covered: 0, uncovered: 0, lines: [], unran: true };
    const lines = Array.isArray(row.Coverage?.uncoveredLines) ? [...row.Coverage.uncoveredLines].sort((a, b) => a - b) : [];
    return { name, covered: row.NumLinesCovered ?? 0, uncovered: row.NumLinesUncovered ?? lines.length, lines };
  });
}

/** Its coverage as a whole percent, rounded down so 74.9% never reads as the floor; 100 with no line to cover. */
export function percent(c: ClassCoverage): number {
  if (c.unran) return 0;
  const total = c.covered + c.uncovered;
  return total === 0 ? 100 : Math.floor((c.covered * 100) / total);
}

/** Whether it reaches the floor, on the exact share: 74.9% doesn't reach 75. No line to cover reaches any floor. */
export function reaches(c: ClassCoverage, floor: number): boolean {
  if (c.unran) return false;
  const total = c.covered + c.uncovered;
  return total === 0 || c.covered * 100 >= floor * total;
}

/** Its figure as the ticket says it: "OrderService 88%, 4 lines not covered", "Foo 100%", "Bar 0%, no test ran it". */
export function coverageWords(c: ClassCoverage): string {
  if (c.unran) return `${c.name} 0%, no test ran it`;
  return `${c.name} ${percent(c)}%${c.uncovered ? `, ${plural(c.uncovered, 'line')} not covered` : ''}`;
}

/** The lines not covered, as the failure lists them: up to 20, then how many more. */
export function linesWords(c: ClassCoverage): string {
  if (!c.lines.length) return '';
  const shown = c.lines.slice(0, 20).join(', ');
  return c.lines.length > 20 ? `lines ${shown} and ${c.lines.length - 20} more` : `${c.lines.length === 1 ? 'line' : 'lines'} ${shown}`;
}

/** Those under the floor, each with its figure and the lines not covered: "OrderService 60%, 4 lines not covered (lines 12, 13, 20, 41)". */
export function underFloor(classes: ClassCoverage[], floor: number): string[] {
  return classes.filter((c) => !reaches(c, floor)).map((c) => {
    const lines = linesWords(c);
    return lines ? `${coverageWords(c)} (${lines})` : coverageWords(c);
  });
}
