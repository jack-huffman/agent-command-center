/**
 * Check this machine (T-133): Setup's machine steps for one profile, as starting a project runs them before its
 * settings are written. What's still to do is listed first, each with its fix: a tool not installed, or one
 * installed but not on VSCode's PATH. The person fixes them, or goes on anyway and comes back to Setup.
 */
import type { Profile } from '../config.ts';
import { runSteps } from './steps.ts';
import type { CheckContext, StepResult } from './types.ts';

export interface MachineCheck {
  /** Every machine step that ran for the profile, in Setup's order. */
  results: StepResult[];
  /** The ones still to do: failed, so a project started now would meet them. */
  todo: StepResult[];
}

/** Runs the machine steps for a profile, whatever profile the folder's config names. */
export function checkMachine(ctx: CheckContext, profile: Profile): MachineCheck {
  const results = runSteps({ ...ctx, profile }, 'machine');
  return { results, todo: results.filter((r) => r.result.status === 'fail') };
}

/** How a step still to do reads in the list: installed but not on PATH, or to do. */
export const machineState = (r: StepResult): 'not-on-path' | 'to-do' => (r.result.place ? 'not-on-path' : 'to-do');

/** The list, as acc init prints it before it writes anything: each step, what's wrong, and its fix. */
export function machineLines(todo: StepResult[]): string[] {
  return todo.flatMap(({ step, result }) => {
    const fix = result.byHand ?? result.fix ?? step.fix?.command ?? step.fix?.text;
    return [
      `  ${machineState({ step, result }) === 'not-on-path' ? 'not on PATH' : 'to do'}  ${step.id.padEnd(18)} ${step.title}`,
      `      ${result.detail}`,
      ...(fix ? [`      fix: ${fix}`] : []),
      ...(result.ask ? [`      asks first: ${result.ask}`] : []),
    ];
  });
}
