/**
 * Dispatch's sheet (D-???), as the extension sends it: for ACME-16, analysed and ready, with the project's
 * cloud builders on; the same with a builder on a model that takes no effort, for the behaviour case to
 * pick another model; for ACME-35, Dispatch anyway, with the files it shares; and for ACME-19, in rework,
 * with a model and an effort picked for it before, in a project whose cloud builders are off.
 */
import { dispatchSheet, type DispatchSheet, type SheetInput } from '../../src/model/dispatch-sheet.ts';
import { sampleHub } from './hub.ts';
import { ROOT } from './shared.ts';

export type SheetSample = 'analysed' | 'no-effort' | 'rework' | 'anyway';

/** What the extension makes the sheet from, for each sample. */
export function sampleSheetInput(now: number, which: SheetSample): SheetInput {
  const hub = sampleHub(now);
  const project = hub.projects[0]!;
  const rows = hub.taskRows(ROOT);
  const own = project.agents!.builder;
  const builder = { ...own, model: own.model ?? 'claude-opus-5-5' };
  // ACME-35 waits for ACME-12's and ACME-13's files: Dispatch anyway's sheet lists them (D-093).
  if (which === 'anyway') return { project: ROOT, row: rows.find((r) => r.id === 'ACME-35')!, builder, config: project.config, anyway: true };
  if (which !== 'rework') return { project: ROOT, row: rows.find((r) => r.id === 'ACME-16')!, builder: which === 'no-effort' ? { ...builder, model: 'claude-haiku-4-5-20251001' } : builder, config: project.config };
  const row = rows.find((r) => r.id === 'ACME-19')!;
  return {
    project: ROOT, row: { ...row, run: { ...row.run, model: 'claude-sonnet-5-5', modelPicked: true, effort: 'xhigh', effortPicked: true } },
    builder, config: { ...project.config, agents: { cloud: null } },
  };
}

export const sampleSheet = (now: number, which: SheetSample): DispatchSheet => dispatchSheet(sampleSheetInput(now, which));
