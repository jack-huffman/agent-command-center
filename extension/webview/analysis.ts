// A task's analysis: its questions, answered on the page or sent to the client.

import type { TicketAnalysis, TicketModel } from '../src/model/task-page.ts';
import { actionButton, button, type Child, el, foldable, icon, keptInput, md, status, when } from './dom.ts';
import { api, memory, remember, state } from './state.ts';
import { answerKey, askKey, pending, sendAnswer, sendUpdate } from './updates.ts';
import { planActions, planDecisions, planEarlier, planHead, planShapes } from './plan.ts';
import { reviewButton } from './review-plan.ts';
import { conversationLine, discussButton } from './talk.ts';
import { planTicketLine } from './plan-behind.ts';

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
  answer.disabled = !draft.trim();
  const input = keptInput(key, draft, 'Or type your own answer', (v) => { remember((x) => { x.drafts[key] = v; }); answer.disabled = !v.trim(); }, () => send(input.value));
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
 * A list the analysis made, folded under its name and its count; or, given a body, that body under its name
 * alone, as The whole plan is (T-109). Opened or closed, it stays so as the page redraws.
 */
function analysisFold(key: string, title: string, items: Child[], ordered = false, body?: { cls: string; children: HTMLElement[] }): HTMLElement | null {
  if (!items.length && !body?.children.length) return null;
  const d = el('details', body ? body.cls : 'an-fold') as HTMLDetailsElement;
  d.open = memory().opened.includes(key);
  d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, key])] : x.opened.filter((y) => y !== key); }));
  d.append(el('summary', '', el('span', 'tool-chev', icon('chevron-right')), el('span', '', title), body ? null : el('span', 'count', String(items.length))),
    body ? el('div', `${body.cls}-body`, ...body.children) : el(ordered ? 'ol' : 'ul', 'an-list', ...items.map((x) => el('li', '', x))));
  return d;
}

/** "Area: detail", with where it came from muted after it. */
const pair = (head: string, rest: string, source = ''): HTMLElement => el('span', '', head ? el('strong', '', `${head}: `) : null, md(rest), source ? el('span', 'muted mono an-source', ` ${source}`) : null);

/**
 * A task's Analysis section, gist first like the rest of the page: the verdict in words, the summary, the
 * plan's version and approval, what's left to review and Review plan (T-109); then the whole plan, folded and
 * closed: what changed, each choice and question in full, the wording, earlier versions and the rest.
 */
export function renderAnalysis(m: TicketModel, a: TicketAnalysis): HTMLElement {
  const key = `an:${m.project}#${m.key}`;
  const sec = el('section', `analysis tone-edge-${a.look.tone}`,
    el('div', 'an-head', el('h2', '', 'Plan'), status(a.look), a.wording ? status(a.wording.look) : null, a.size ? el('span', 'chip an-size', `Size ${a.size}`) : null, el('span', 'spacer'), a.at ? when(a.at) : null));
  sec.setAttribute('aria-label', `Analysis: ${a.look.label}`);
  if (a.note) sec.append(el('p', 'muted an-note', a.note));
  if (a.summary) sec.append(foldable(`${key}:summary`, el('p', 'an-summary', md(a.summary)), null, 4));
  if (a.split.length) sec.append(el('div', 'an-split', el('div', 'strong', 'Split it into'), el('ol', 'an-list', ...a.split.map((x) => el('li', '', md(x))))));
  // The plan in short (T-109): its version and approval, and what's left to review, in words.
  const p = a.planState;
  if (p) {
    sec.append(el('div', 'plan-short', status(p.look), p.approval ? el('span', 'muted small', `by ${p.approval.by} `, when(p.approval.at)) : null,
      a.review ? el('span', 'plan-left', icon(a.review.left.endsWith('to review') ? 'list-selection' : 'pass'), a.review.left) : null));
    // What it read of the ticket, and comments since (T-110).
    const read = planTicketLine(a, !!m.talk?.newPlan);
    if (read) sec.append(read);
  }
  // Review plan leads, then Build it and Talk it through, each off with why (T-97).
  if (p) sec.append(...planActions(m, a.task, p, a.review ? reviewButton(m, a.task, a.review) : null).filter((x): x is HTMLElement => !!x));
  // Its conversation with the planning agent (T-111): one line and Open conversation; the turns are in its panel.
  const talked = m.talk ? conversationLine(m.project, m.talk) : null;
  if (talked) sec.append(talked);
  // With a conversation, Make a new plan is the conversation panel's alone (T-116); without one it stays here.
  const actions = m.talk?.newPlan ? a.actions.filter((x) => x.command !== m.talk!.newPlan!.command) : a.actions;
  if (actions.length) sec.append(el('div', 'actions an-actions', ...actions.map(actionButton)));
  // The whole plan, folded and closed until opened.
  const whole = analysisFold(`${key}:whole`, 'The whole plan', [], false, { cls: 'an-whole', children: wholePlan(m, a, key) });
  if (whole) sec.append(whole);
  return sec;
}

/** Everything the short section leaves out: what changed, the choices and questions in full, the wording, the earlier versions and the rest of the analysis. */
function wholePlan(m: TicketModel, a: TicketAnalysis, key: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  // Its plan (T-97): what changed in this version, and the person's notes; then each design choice to make.
  if (a.planState) out.push(planHead(a.planState));
  const shapes = a.planState ? planShapes(m, a.task, a.planState) : null;
  if (shapes) out.push(shapes);
  const decisions = a.planState ? planDecisions(m, a.task, a.planState) : null;
  if (decisions) out.push(decisions);
  // Discuss (T-98): a question, a step or a risk talked through with the planning agent, quoted.
  const discuss = (ref: string, text: string, what: string) => (m.talk?.send ? discussButton(m.project, a.task, ref, text, what) : null);
  if (a.open.length) {
    out.push(el('div', 'an-questions', ...a.open.map((q) => {
      const box = analysisQuestion(m.project, a.task, q, a.canAsk);
      const d = discuss(q.id, q.question, `the question ${q.question}`);
      if (d) box.querySelector('.aq-q')?.append(d);
      return box;
    })));
  }
  // The wording check's findings (T-12): advice on how the requirements read. They never hold a dispatch.
  if (a.wording) {
    out.push(el('div', 'an-wording', el('div', 'strong', 'How the requirements read'),
      el('ul', 'an-list', ...a.wording.findings.map((f) => el('li', '', el('strong', '', `${f.place}: `), f.message, f.match ? ' ' : null, f.match ? el('span', 'chip an-match', f.match) : null, el('div', 'muted an-line', md(f.text)))))));
  }
  // The earlier versions, a click away (T-97).
  const earlier = a.planState ? planEarlier(m, a.task, a.planState) : null;
  if (earlier) out.push(earlier);
  const folds = [
    analysisFold(`${key}:decided`, 'Decided', a.decided.map((d) => el('span', '', md(d.question), ' ', el('strong', '', md(d.answer)), d.assumed ? el('span', 'muted', ' (assumed: nobody answered)') : null))),
    analysisFold(`${key}:criteria`, 'Acceptance criteria', a.criteria.map(md)),
    analysisFold(`${key}:assumptions`, 'Assumptions', a.assumptions.map(md)),
    analysisFold(`${key}:out`, 'Out of scope', a.outOfScope.map(md)),
    analysisFold(`${key}:findings`, 'What\'s there now', a.findings.map((f) => pair(f.area, f.detail, f.source))),
    analysisFold(`${key}:plan`, 'The approach', a.plan.map(md).map((x, i) => el('span', 'an-discussable', x, discuss(`s${i + 1}`, a.plan[i]!, `step ${i + 1}: ${a.plan[i]!}`))), true),
    analysisFold(`${key}:refactors`, 'Refactors first', a.refactors.map((r) => pair(r.what, r.why))),
    analysisFold(`${key}:risks`, 'Risks', a.risks.map(md).map((x, i) => el('span', 'an-discussable', x, discuss(`r${i + 1}`, a.risks[i]!, `the risk ${a.risks[i]!}`)))),
    analysisFold(`${key}:tests`, 'Tests', a.tests.map(md)),
  ].filter((x): x is HTMLElement => !!x);
  if (folds.length) out.push(el('div', 'an-folds', ...folds));
  return out;
}
