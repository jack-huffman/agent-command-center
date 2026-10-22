/**
 * The plan (T-97): an analysis's versions, the choices a person makes in it, its approval, and what holds a
 * build for want of them. A person makes every design choice and approves the latest version; the builder
 * is given the choices and stops to ask before it makes another. Pure: plan-choices.ts reads and writes.
 */

import type { Analysis, AnalysisQuestion, AskOf, PlanApproval, PlanDecision } from './analyze.ts';

/** A plan's version: older analyses, written before versions, are the first. */
export const planVersion = (a: Pick<Analysis, 'version'>): number => a.version ?? 1;

/** Who can answer a question: older questions are for you. */
export const askOf = (q: Pick<AnalysisQuestion, 'askOf'>): AskOf => q.askOf ?? 'you';

/** The questions only the person running the build can answer, and nobody has: they hold an approval. */
export const questionsForYou = (a: Pick<Analysis, 'questions'>): AnalysisQuestion[] => a.questions.filter((q) => !q.answer && askOf(q) === 'you');

/** The design choices nobody has made yet. */
export const unchosen = (a: Pick<Analysis, 'decisions'>): PlanDecision[] => (a.decisions ?? []).filter((d) => !d.choice);

/** What a choice is, in words: its option's name, or the person's own words. Nothing for one not made. */
export function choiceName(d: PlanDecision): string {
  if (!d.choice) return '';
  return d.choice.option ? d.options.find((o) => o.id === d.choice!.option)?.name ?? d.choice.option : d.choice.text ?? '';
}

/** The recommended option's name. */
export const recommendedName = (d: PlanDecision): string => d.options.find((o) => o.id === d.recommended)?.name ?? d.recommended;

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Undoes an approval once the plan changes under it, such as a choice or an answer: the approval it had is
 * kept as lapsed, so the page says it needs approving again. A plan with none is left as it is.
 */
export function lapse(a: Analysis): void {
  if (!a.approval) return;
  a.lapsed = a.approval;
  delete a.approval;
}

/**
 * The analysis just made, as the next version of the one before (T-97): its number, its choices carried
 * over where the choice still exists (the same title, and for an option, one with the same name), what
 * changed since, and the version before kept whole. An approval never carries: a new version is approved
 * again, and says which one was.
 */
export function nextVersion(previous: Analysis | null, fresh: Analysis): Analysis {
  if (!previous) return { ...fresh, version: 1 };
  const decisions = (fresh.decisions ?? []).map((d): PlanDecision => {
    const was = (previous.decisions ?? []).find((p) => same(p.title, d.title));
    if (!was?.choice) return d;
    if (was.choice.option === null) return { ...d, choice: was.choice };
    const option = d.options.find((o) => same(o.name, choiceName(was)));
    return option ? { ...d, choice: { ...was.choice, option: option.id } } : d;
  });
  const { earlier = [], ...kept } = previous;
  const next: Analysis = { ...fresh, version: planVersion(previous) + 1, decisions, earlier: [...earlier, kept] };
  next.changes = planChanges(previous, next);
  const approval = previous.approval ?? previous.lapsed;
  if (approval) next.lapsed = approval;
  return next;
}

/** What changed from one version to the next, a line each: the choices, the questions and the approach. */
export function planChanges(before: Analysis, after: Analysis): string[] {
  const out: string[] = [];
  const was = before.decisions ?? [];
  const now = after.decisions ?? [];
  for (const d of now) {
    const p = was.find((x) => same(x.title, d.title));
    if (!p) { out.push(`New choice: ${d.title}`); continue; }
    const names = (x: PlanDecision) => x.options.map((o) => o.name.toLowerCase()).sort().join('|');
    if (names(p) !== names(d)) out.push(`${d.title}: the options changed`);
    if (!same(recommendedName(p), recommendedName(d))) out.push(`${d.title}: now recommends ${recommendedName(d)}, not ${recommendedName(p)}`);
    if (p.choice && !d.choice) out.push(`${d.title}: ${choiceName(p)} isn't an option any more, so it needs choosing again`);
  }
  for (const p of was) if (!now.some((d) => same(d.title, p.title))) out.push(`No longer a choice: ${p.title}`);
  for (const q of after.questions) if (!before.questions.some((x) => same(x.question, q.question))) out.push(`New question: ${q.question}`);
  for (const q of before.questions) if (!after.questions.some((x) => same(x.question, q.question))) out.push(`No longer asked: ${q.question}`);
  if (before.approach.plan.join('\n') !== after.approach.plan.join('\n')) out.push('The approach changed');
  if (before.approach.size !== after.approach.size) out.push(`Size ${after.approach.size}, not ${before.approach.size}`);
  if (before.verdict !== after.verdict && after.verdict === 'split') out.push('It now says the task is too big for one');
  return out.length ? out : ['Nothing changed in the choices, the questions or the approach'];
}

/** Why the approval doesn't hold, in words, or null: "v3 is new since v2 was approved", or a change since. */
export function lapsedWords(a: Pick<Analysis, 'version' | 'lapsed' | 'approval'>): string | null {
  if (a.approval || !a.lapsed) return null;
  const v = planVersion(a);
  return a.lapsed.version < v ? `v${v} is new since v${a.lapsed.version} was approved` : `v${v} changed since it was approved`;
}

/**
 * Why a plan holds the build, a reason each (T-97): questions for you unanswered, choices not made, and the
 * latest version not approved. A question for the ticket's author holds nothing: its suggestion stands until
 * the author answers.
 */
export function planProblems(a: Analysis, id: string): string[] {
  const out: string[] = [];
  const open = questionsForYou(a);
  if (open.length) out.push(`${open.length} question${open.length === 1 ? '' : 's'} from ${id}'s analysis ${open.length === 1 ? 'is' : 'are'} unanswered: ${open.map((q) => `${q.id}. ${q.question}`).join(' ')} Answer with acc analysis answer ${id} <q> "<answer>".`);
  const choose = unchosen(a);
  if (choose.length) out.push(`${choose.length} choice${choose.length === 1 ? '' : 's'} in ${id}'s plan ${choose.length === 1 ? 'isn\'t' : 'aren\'t'} made: ${choose.map((d) => `${d.id}. ${d.title}.`).join(' ')} Choose with acc plan choose ${id} <choice> <option>.`);
  if (!a.approval) {
    const lapsed = lapsedWords(a);
    out.push(lapsed ? `${id}'s plan ${lapsed}: approve it again with acc plan approve ${id}.` : `${id}'s plan v${planVersion(a)} isn't approved: a person approves it with acc plan approve ${id}.`);
  }
  return out;
}

/** Why a person can't approve the plan yet, or null: questions for them, or choices, still open. A split isn't a plan to build. */
export function approveRefusal(a: Analysis, id: string): string | null {
  if (a.verdict === 'split') return `${id}'s analysis says it's too big for one task. Split it rather than approve it.`;
  const open = questionsForYou(a);
  const choose = unchosen(a);
  if (!open.length && !choose.length) return null;
  const parts = [open.length ? `answer ${open.map((q) => q.id).join(', ')}` : '', choose.length ? `choose ${choose.map((d) => d.id).join(', ')}` : ''].filter(Boolean);
  return `${id}'s plan isn't ready to approve: ${parts.join(', and ')} first.`;
}

/** The line a choice makes in the builder's and the reviewer's instructions. */
function choiceLine(d: PlanDecision): string {
  const option = d.choice?.option ? d.options.find((o) => o.id === d.choice!.option) : null;
  if (!d.choice) return `- ${d.title}: nobody chose. The plan recommends **${recommendedName(d)}**: ${d.because}`;
  const what = option ? `**${option.name}**${option.means ? `: ${option.means}` : ''}` : `**Something else**: ${d.choice.text}`;
  return `- ${d.title}: ${what} (chosen by ${d.choice.by})`;
}

/**
 * The head of the builder's plan (T-97): approved, which version and by whom, or not approved; the rule that
 * the choices are the person's; and each choice made.
 */
export function approvedPlanLines(a: Analysis): string[] {
  const v = planVersion(a);
  const decisions = a.decisions ?? [];
  return [
    a.approval ? '## The approved plan' : '## The plan',
    '',
    a.approval ? `Version ${v}, approved by ${a.approval.by} at ${a.approval.at}.` : `Version ${v}. A person hasn't approved it.`,
    '',
    'The design choices are the person\'s, not yours. If the work needs a different choice from one made here, or meets a design decision this plan doesn\'t cover, stop: run acc block with the question, and never decide it yourself.',
    '',
    ...(decisions.length ? ['**The choices**', '', ...decisions.map(choiceLine), ''] : []),
  ];
}

/** The version whose choices hold: the latest when it's approved, else the newest approved before it, else the latest. */
export function approvedVersion(a: Analysis): Analysis {
  if (a.approval) return a;
  return [...(a.earlier ?? [])].reverse().find((x) => x.approval) ?? a;
}

/**
 * The plan's choices for the reviewer (T-97): the change is checked against each, and a departure is a
 * finding that must be fixed. Nothing when the plan has no choice made.
 */
export function planChoicesSection(a: Analysis | null): string[] {
  if (!a) return [];
  const p = approvedVersion(a);
  const made = (p.decisions ?? []).filter((d) => d.choice);
  if (!made.length) return [];
  return [
    p.approval ? `## The approved plan's choices (v${planVersion(p)})` : `## The plan's choices (v${planVersion(p)}, not approved)`,
    '',
    'A person made these choices before the build. Check the change keeps to each. A departure from one, or a design decision the builder made alone that the plan doesn\'t cover, is a finding with must: true.',
    '',
    ...made.map(choiceLine),
    '',
  ];
}

/** An approval as it's kept: this version, who and when. */
export const approvalOf = (a: Analysis, by: string, at: string): PlanApproval => ({ version: planVersion(a), by, at });
