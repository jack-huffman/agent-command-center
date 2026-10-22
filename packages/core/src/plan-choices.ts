/**
 * A person's choices in a plan, and their approval of it (T-97): acc plan choose and acc plan approve, and
 * the Command Center's buttons through them. Only a person does either; the CLI refuses an agent.
 */

import { type Analysis, type PlanChoice, type PlanDecision, readAnalysis, writeAnalysis } from './analyze.ts';
import { AccError } from './exec.ts';
import { mutate } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { approvalOf, approveRefusal, lapse, planVersion } from './plan.ts';

/** The longest own option a person may write, as an answer's. */
export const CHOICE_TEXT_MAX = 4000;

/**
 * What a person is asked before they change a choice on an approved plan (T-97): the page's dialog says it,
 * with Change it and Keep the approval, and acc says it when it refuses a change without --yes.
 */
export const CHANGE_APPROVED = 'This plan is approved. Changing this choice undoes the approval, and the plan must be approved again before it\'s built.';

/** A choice as acc recorded it, and whether it changed the plan: picking what's already chosen changes nothing. */
export interface Chosen {
  plan: Analysis;
  decision: PlanDecision;
  changed: boolean;
}

/** Whether a pick is the choice already made: the same option, or the same own words. */
export const sameChoice = (was: PlanChoice | undefined, pick: Pick<PlanChoice, 'option' | 'text'>): boolean =>
  !!was && was.option === pick.option && (pick.option !== null || was.text === pick.text);

function planOf(paths: RepoPaths, id: string): Analysis {
  const a = readAnalysis(paths, id);
  if (!a) throw new AccError('no-analysis', `${id} has no plan yet: acc analyze ${id}.`);
  return a;
}

/**
 * A person's choice for one of the plan's design choices: one of its options, by id or name, or their own
 * option in words. Picking what's already chosen changes nothing, and an approval holds. Any other choice on
 * an approved plan undoes the approval, so it's refused unless the person said yes to that (`yes`).
 */
export function choosePlan(paths: RepoPaths, id: string, decision: string, pick: { option?: string; text?: string }, by: string, now: () => Date, yes = false): Chosen {
  const a = planOf(paths, id);
  const decisions = a.decisions ?? [];
  const wanted = decision.toLowerCase();
  const d = decisions.find((x) => x.id === wanted || x.id === `d${wanted}`);
  if (!d) throw new AccError('usage', `${id}'s plan has no choice ${decision}. It has: ${decisions.map((x) => x.id).join(', ') || 'none'}.`);
  if (pick.option !== undefined && pick.text !== undefined) throw new AccError('usage', 'Give an option or your own words with --text, not both.');
  let picked: Pick<PlanChoice, 'option' | 'text'>;
  if (pick.text !== undefined) {
    const text = pick.text.trim();
    if (!text) throw new AccError('usage', 'Give your own option in words.');
    if (text.length > CHOICE_TEXT_MAX) throw new AccError('usage', `Your own option is longer than ${CHOICE_TEXT_MAX} characters.`);
    picked = { option: null, text };
  } else {
    const named = (pick.option ?? '').trim().toLowerCase();
    const option = d.options.find((o) => o.id === named || o.name.toLowerCase() === named);
    if (!option) throw new AccError('usage', `${d.id} has no option ${pick.option ?? '(none given)'}. It has: ${d.options.map((o) => `${o.id} (${o.name})`).join(', ')}.`);
    picked = { option: option.id };
  }
  if (sameChoice(d.choice, picked)) return { plan: a, decision: d, changed: false };
  // A change on an approved plan: the person is asked first, on the page or with --yes.
  if (a.approval && !yes) throw new AccError('refused', `${CHANGE_APPROVED} To change it anyway, run it again with --yes.`);
  d.choice = { ...picked, by, at: now().toISOString() };
  lapse(a);
  writeAnalysis(paths, a);
  mutate(paths, now, (_l, emit) => {
    emit({ type: 'task.updated', task: id, actor: 'human', by, data: { chose: { decision: d.id, option: d.choice!.option, version: planVersion(a) } } });
  });
  return { plan: a, decision: d, changed: true };
}

/**
 * A person's approval of the plan's latest version: who, when and which version. It's refused while a
 * question for them or a choice is still open. Approving the version already approved changes nothing.
 */
export function approvePlan(paths: RepoPaths, id: string, by: string, now: () => Date): Analysis {
  const a = planOf(paths, id);
  const refused = approveRefusal(a, id);
  if (refused) throw new AccError('refused', refused);
  if (a.approval) return a;
  a.approval = approvalOf(a, by, now().toISOString());
  delete a.lapsed;
  writeAnalysis(paths, a);
  mutate(paths, now, (_l, emit) => {
    emit({ type: 'task.updated', task: id, actor: 'human', by, data: { approved: { version: a.approval!.version } } });
  });
  return a;
}
