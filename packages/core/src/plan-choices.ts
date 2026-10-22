/**
 * A person's choices in a plan, and their approval of it (T-97): acc plan choose and acc plan approve, and
 * the Command Center's buttons through them. Only a person does either; the CLI refuses an agent.
 */

import { type Analysis, readAnalysis, writeAnalysis } from './analyze.ts';
import { AccError } from './exec.ts';
import { mutate } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { approvalOf, approveRefusal, lapse, planVersion } from './plan.ts';

/** The longest own option a person may write, as an answer's. */
export const CHOICE_TEXT_MAX = 4000;

function planOf(paths: RepoPaths, id: string): Analysis {
  const a = readAnalysis(paths, id);
  if (!a) throw new AccError('no-analysis', `${id} has no plan yet: acc analyze ${id}.`);
  return a;
}

/**
 * A person's choice for one of the plan's design choices: one of its options, by id or name, or their own
 * option in words. A choice made on an approved plan changes it, so it needs approving again.
 */
export function choosePlan(paths: RepoPaths, id: string, decision: string, pick: { option?: string; text?: string }, by: string, now: () => Date): Analysis {
  const a = planOf(paths, id);
  const decisions = a.decisions ?? [];
  const wanted = decision.toLowerCase();
  const d = decisions.find((x) => x.id === wanted || x.id === `d${wanted}`);
  if (!d) throw new AccError('usage', `${id}'s plan has no choice ${decision}. It has: ${decisions.map((x) => x.id).join(', ') || 'none'}.`);
  if (pick.option !== undefined && pick.text !== undefined) throw new AccError('usage', 'Give an option or your own words with --text, not both.');
  const at = now().toISOString();
  if (pick.text !== undefined) {
    const text = pick.text.trim();
    if (!text) throw new AccError('usage', 'Give your own option in words.');
    if (text.length > CHOICE_TEXT_MAX) throw new AccError('usage', `Your own option is longer than ${CHOICE_TEXT_MAX} characters.`);
    d.choice = { option: null, text, by, at };
  } else {
    const named = (pick.option ?? '').trim().toLowerCase();
    const option = d.options.find((o) => o.id === named || o.name.toLowerCase() === named);
    if (!option) throw new AccError('usage', `${d.id} has no option ${pick.option ?? '(none given)'}. It has: ${d.options.map((o) => `${o.id} (${o.name})`).join(', ')}.`);
    d.choice = { option: option.id, by, at };
  }
  lapse(a);
  writeAnalysis(paths, a);
  mutate(paths, now, (_l, emit) => {
    emit({ type: 'task.updated', task: id, actor: 'human', by, data: { chose: { decision: d.id, option: d.choice!.option, version: planVersion(a) } } });
  });
  return a;
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
