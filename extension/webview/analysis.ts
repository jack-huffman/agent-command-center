// A task's analysis: its questions, answered on the page or sent to the client.

import type { TicketAnalysis, TicketModel } from '../src/model/task-page.ts';
import { actionButton, button, type Child, el, foldable, icon, keptInput, md, status, when } from './dom.ts';
import { memory, remember } from './state.ts';
import { answerKey, askKey, pending, sendAnswer, sendUpdate } from './updates.ts';
import { choiceWaits, planActions, planChanges, planDecisions, planEarlier, planShapes } from './plan.ts';
import { reviewButton } from './review-plan.ts';
import { conversationLine, discussButton } from './talk.ts';
import { planTicketLine } from './plan-behind.ts';
import { planProgressBlock } from './plan-progress.ts';

// ---------------------------------------------------------------- a task's analysis (D-052)

type AnalysisAsk = TicketAnalysis['open'][number];

/**
 * One of an analysis's questions, answered where it's shown: its suggestion in one click, or your own
 * words. acc records the answer (D-012); the page only asks it to.
 */
export function analysisQuestion(project: string, task: string, q: AnalysisAsk, canAsk = false): HTMLElement {
  const key = answerKey(project, task, q.id);
  const send = (text: string) => sendAnswer(project, task, q.id, text);
  // A question only the ticket's author can answer says so, with an icon and words (T-97).
  const author = q.askOf === 'author';
  const box = el('div', 'aq', el('div', 'aq-q', el('span', 'aq-id', q.id), el('span', 'strong', md(q.question))), author ? el('div', 'aq-who small', icon('person'), 'For the ticket\'s author') : null, q.why ? el('div', 'muted small aq-why', md(q.why)) : null, clientLine(project, task, q, canAsk && author));
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', q.question);
  if (pending.what(key)) {
    box.classList.add('sent');
    box.append(el('div', 'q-sending muted', icon('sync~spin'), 'Sending your answer…'));
    return box;
  }
  const error = pending.error(key);
  if (error) box.append(el('div', 'aq-error', icon('warning'), el('span', '', `Your answer wasn't recorded: ${error}`)));
  if (q.suggested.trim() && q.suggested.length <= 4000) {
    const use = el('button', 'aq-suggest', icon('lightbulb'), el('span', 'aq-suggest-text', el('span', 'muted', 'Use the suggestion: '), md(q.suggested))) as HTMLButtonElement;
    use.type = 'button';
    use.title = 'Answer with what the analyst would assume';
    use.addEventListener('click', () => send(q.suggested));
    box.append(use);
  }
  const draft = memory().drafts[key] ?? '';
  const answer = button('Answer', 'send', () => send(input.value), 'primary');
  const ready = (v: string) => { answer.disabled = !v.trim(); answer.title = answer.disabled ? 'Type an answer first' : ''; };
  ready(draft);
  const input = keptInput(key, draft, 'Or type your own answer', (v) => { remember((x) => { x.drafts[key] = v; }); ready(v); }, () => send(input.value));
  input.maxLength = 4000;
  box.append(el('div', 'aq-own', input, answer));
  return box;
}

/**
 * Whether a question went to the client: drafted, or posted, or a button to draft it (D-066). Its answer
 * box stays either way, for when the client replies.
 */
function clientLine(project: string, task: string, q: AnalysisAsk, canAsk: boolean): HTMLElement | null {
  if (q.client === 'posted') return el('div', 'aq-client muted', icon('comment'), 'Sent to the client');
  if (q.client === 'drafted') return el('div', 'aq-client muted', icon('comment-draft'), 'Drafted for the client: post it from the task\'s Activity');
  if (!canAsk) return null;
  const key = askKey(project, task, q.id);
  const error = pending.error(key);
  if (pending.what(key)) return el('div', 'aq-client muted', icon('sync~spin'), 'Drafting it for the client…');
  const ask = button('Ask on the ticket', 'comment-draft', () => sendUpdate(key, 'ask', { type: 'update-ask', project, task, question: q.id }), 'ghost small');
  ask.title = 'Draft this question as a comment for the ticket. You edit and post it before it goes.';
  return el('div', 'aq-client', ask, error ? el('span', 'aq-error', icon('warning'), el('span', '', error)) : null);
}

/**
 * One of the plan's sections (T-136), folded on its own under its name and its count. One that waits on the
 * person starts open until they close it; the rest start closed until opened. Opened or closed, it stays so as
 * the page redraws; an open one is remembered open, so the last choice made doesn't fold it away under the person.
 * None when there's nothing in it.
 */
function planSection(key: string, id: string, name: string, count: number, waits: boolean, body: (HTMLElement | null)[], aside: HTMLElement | null = null): HTMLElement | null {
  const parts = body.filter((x): x is HTMLElement => !!x);
  if (!parts.length) return null;
  const k = `${key}:sec:${id}`;
  const shut = `${k}:shut`;
  const opened = memory().opened;
  const d = el('details', 'an-sec') as HTMLDetailsElement;
  d.dataset.part = id;
  d.open = opened.includes(k) || (waits && !opened.includes(shut));
  d.addEventListener('toggle', () => remember((x) => {
    const rest = x.opened.filter((y) => y !== k && y !== shut);
    x.opened = d.open ? [...rest, k] : waits ? [...rest, shut] : rest;
  }));
  d.append(el('summary', '', el('span', 'tool-chev', icon('chevron-right')), el('span', 'an-sec-name', name), el('span', 'count', String(count)), aside),
    el('div', 'an-sec-body', ...parts));
  return d;
}

/** A part of a section under its name and its count. None when it's empty. */
function part(name: string, items: Child[], cls = ''): HTMLElement | null {
  if (!items.length) return null;
  return el('div', `an-part${cls ? ` ${cls}` : ''}`, el('div', 'an-part-name', name, el('span', 'count', String(items.length))), el('ul', 'an-list', ...items.map((x) => el('li', '', x))));
}

/** "Area: detail", with where it came from muted after it. */
const pair = (head: string, rest: string, source = ''): HTMLElement => el('span', '', head ? el('strong', '', `${head}: `) : null, md(rest), source ? el('span', 'muted mono an-source', ` ${source}`) : null);

/** Whether a question waits on the person (T-136): one for them, or one for the ticket's author not yet sent to the client. */
export const questionWaits = (a: Pick<TicketAnalysis, 'open' | 'canAsk'>): boolean => a.open.some((q) => q.askOf !== 'author' || (a.canAsk && !q.client));

/**
 * The plan's one quiet top line (T-136), which is its heading too, so its section folds by it (T-132): the plan's
 * version and approval, said once; what's left to review, or the analysis's state once nothing is; its size; and
 * when it was made. With no plan, the analysis's state heads it.
 */
function topLine(a: TicketAnalysis): HTMLElement {
  const p = a.planState;
  const left = a.review && (a.review.steps.some((s) => !s.done) || !p?.approval) ? a.review : null;
  return el('div', 'an-head an-top', el('h2', '', status(p ? p.look : a.look)),
    p?.approval ? el('span', 'muted small an-by', `by ${p.approval.by} `, when(p.approval.at)) : null,
    left ? el('span', 'plan-left', icon(left.left.endsWith('to review') ? 'list-selection' : 'pass'), left.left) : p && a.look.label !== p.look.label ? status(a.look) : null,
    a.size ? el('span', 'chip an-size', `Size ${a.size}`) : null, el('span', 'spacer'), a.at ? when(a.at) : null);
}

/**
 * A task's plan in its Plan tab (T-136): one quiet top line; what it read of the ticket; the summary; what changed;
 * one row of actions; then its named sections, each folded on its own with its count: Choices, Questions, The
 * approach, Acceptance criteria, Risks and tests, and More. Choices and Questions open while something in them
 * waits on the person.
 */
export function renderAnalysis(m: TicketModel, a: TicketAnalysis): HTMLElement {
  const key = `an:${m.project}#${m.key}`;
  const sec = el('section', `analysis plan-tab tone-edge-${a.look.tone}`, topLine(a));
  sec.setAttribute('aria-label', `Analysis: ${a.look.label}`);
  if (a.note) sec.append(el('p', 'muted an-note', a.note));
  // What the planning agent is doing while a plan is made or a reply comes (T-131).
  const progress = m.talk ? planProgressBlock(m.project, a.task, m.talk.progress) : null;
  if (progress) sec.append(progress);
  const p = a.planState;
  // What it read of the ticket, and comments since (T-110).
  const read = p ? planTicketLine(a, !!m.talk?.newPlan) : null;
  if (read) sec.append(read);
  if (a.summary) sec.append(foldable(`${key}:summary`, el('p', 'an-summary', md(a.summary)), null, 4));
  if (a.split.length) sec.append(el('div', 'an-split', el('div', 'strong', 'Split it into'), el('ol', 'an-list', ...a.split.map((x) => el('li', '', md(x))))));
  // What changed in this version, and the person's notes on it (T-97, T-98).
  const changes = p ? planChanges(p) : null;
  if (changes) sec.append(changes);
  // One row (T-136): Review plan or Build it first, then Talk it through, the conversation's line with Open
  // conversation (T-111), and Make a new plan, which with a conversation is the conversation panel's alone (T-116).
  const talked = m.talk ? conversationLine(m.project, m.talk) : null;
  const actions = m.talk?.newPlan ? a.actions.filter((x) => x.command !== m.talk!.newPlan!.command) : a.actions;
  const more = [talked, ...actions.map(actionButton)].filter((x): x is HTMLElement => !!x);
  if (p) sec.append(...planActions(m, a.task, p, a.review ? reviewButton(m, a.task, a.review) : null, more).filter((x): x is HTMLElement => !!x));
  else if (more.length) sec.append(el('div', 'actions an-actions', ...more));
  sec.append(...planSections(m, a, key));
  return sec;
}

/** The plan's named sections (T-136), each with its count. */
function planSections(m: TicketModel, a: TicketAnalysis, key: string): HTMLElement[] {
  const p = a.planState;
  // Discuss (T-98): a question, a step or a risk talked through with the planning agent, quoted.
  const discuss = (ref: string, text: string, what: string) => (m.talk?.send ? discussButton(m.project, a.task, ref, text, what) : null);
  const questions = a.open.length ? el('div', 'an-questions', ...a.open.map((q) => {
    const box = analysisQuestion(m.project, a.task, q, a.canAsk);
    const d = discuss(q.id, q.question, `the question ${q.question}`);
    if (d) box.querySelector('.aq-q')?.append(d);
    return box;
  })) : null;
  const steps = a.plan.map(md).map((x, i) => el('li', '', el('span', 'an-discussable', x, discuss(`s${i + 1}`, a.plan[i]!, `step ${i + 1}: ${a.plan[i]!}`))));
  const risks = a.risks.map(md).map((x, i) => el('span', 'an-discussable', x, discuss(`r${i + 1}`, a.risks[i]!, `the risk ${a.risks[i]!}`)));
  // The wording check's findings (T-12): advice on how the requirements read. They never hold a dispatch.
  const wording: Child[] = [];
  if (a.wording) {
    wording.push(...a.wording.findings.map((f) => el('span', '', el('strong', '', `${f.place}: `), f.message, f.match ? ' ' : null, f.match ? el('span', 'chip an-match', f.match) : null, el('div', 'muted an-line', md(f.text)))));
  }
  const more = a.assumptions.length + a.outOfScope.length + a.findings.length + wording.length + (p?.earlier.length ?? 0) + a.refactors.length + a.decided.length;
  return [
    planSection(key, 'choices', 'Choices', p?.decisions.length ?? 0, !!p && p.decisions.some((d) => choiceWaits(m, a.task, p, d)), [p ? planDecisions(m, a.task, p) : null]),
    planSection(key, 'questions', 'Questions', a.open.length, questionWaits(a), [questions]),
    planSection(key, 'approach', 'The approach', a.plan.length, false, [p ? planShapes(m, a.task, p) : null, steps.length ? el('ol', 'an-list', ...steps) : null]),
    planSection(key, 'criteria', 'Acceptance criteria', a.criteria.length, false, [a.criteria.length ? el('ul', 'an-list', ...a.criteria.map((x) => el('li', '', md(x)))) : null]),
    planSection(key, 'risks', 'Risks and tests', a.risks.length + a.tests.length, false, [part('Risks', risks), part('Tests', a.tests.map(md))]),
    planSection(key, 'more', 'More', more, false, [
      part('Assumptions', a.assumptions.map(md)),
      part('Out of scope', a.outOfScope.map(md)),
      part('What\'s there now', a.findings.map((f) => pair(f.area, f.detail, f.source))),
      part('How the requirements read', wording, 'an-wording'),
      p ? planEarlier(p) : null,
      part('Refactors first', a.refactors.map((r) => pair(r.what, r.why))),
      part('Decided', a.decided.map((d) => el('span', '', md(d.question), ' ', el('strong', '', md(d.answer)), d.assumed ? el('span', 'muted', ' (assumed: nobody answered)') : null))),
    ], a.wording ? status(a.wording.look) : null),
  ].filter((x): x is HTMLElement => !!x);
}

