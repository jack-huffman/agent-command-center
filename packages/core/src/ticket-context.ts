/**
 * Everything acc knows about a ticket, as one context pack (T-169): the ticket's text and comments, the plan and
 * its criteria, the metadata changed as the Changes tab lists it, where the work is deployed, the checks and their
 * results, the review's findings, why it is blocked, the builder's notes and the ticket's history. Each turn of
 * the ticket's conversation gives it to the agent, and Open in Claude Code gives it to the session it opens. It is
 * built only from what acc holds: the ledger, the plan, the ticket the plan read, the receipts and the review.
 * Each part is cut to its set size, with a line that says what was cut.
 */

import { type Analysis, readAnalysis } from './analyze.ts';
import { changesDraft } from './changes-field.ts';
import type { Config, Profile } from './config.ts';
import { latestDeploys, testsWords } from './deploy-gate.ts';
import type { Runner } from './exec.ts';
import { changedPathsOf } from './field-drafts.ts';
import { noteMarkdown, readLedger, type RunNote, type Task } from './ledger.ts';
import { outsideOf } from './outside-changes.ts';
import type { RepoPaths } from './paths.ts';
import { choiceName, planVersion, recommendedName } from './plan.ts';
import { type PlanTicket, readPlanTicket, ticketLines, ticketWithout } from './plan-ticket.ts';
import { type Receipt, receiptsAt } from './receipts.ts';
import { checkLine, latestVerdict, type Verdict } from './review.ts';
import { plural } from './text.ts';

/** The parts of the pack, in the order the agent reads them. */
export const PACK_PARTS = ['ticket', 'plan', 'changed', 'deployed', 'checks', 'review', 'blocked', 'notes', 'history'] as const;
export type PackPart = (typeof PACK_PARTS)[number];

/** Each part's heading, as the agent reads it. */
export const PACK_HEADS: Record<PackPart, string> = {
  ticket: 'The ticket and its comments',
  plan: 'The plan and its criteria',
  changed: 'What the work changed',
  deployed: 'Where the work is deployed',
  checks: 'The checks and their results',
  review: 'The review\'s findings',
  blocked: 'Why it is blocked',
  notes: 'The builder\'s notes',
  history: 'The ticket\'s history',
};

/**
 * The most characters each part keeps. The ticket's text and comments get more, since they say what is asked; the
 * history keeps its newest entries, and every other part its start.
 */
export const PACK_LIMITS: Record<PackPart, number> = {
  ticket: 16_000, plan: 8_000, changed: 4_000, deployed: 3_000, checks: 3_000, review: 4_000, blocked: 2_000, notes: 4_000, history: 3_000,
};

/** What a part is built from: the data acc holds about the ticket. */
export interface PackIn {
  task: Task;
  /** The ticket the plan read, its comments too (T-110); with no plan, the description alone (`ticketWithout`). */
  ticket: PlanTicket;
  analysis: Analysis | null;
  profile: Profile;
  /** What the work changed, as the Changes tab lists it: its branch's paths while in flight, else what acc kept. */
  changed: string[];
  /** The checks on its latest commit, as acc recorded them. */
  checks: Receipt[];
  /** Its latest review, or null before one. */
  review: Verdict | null;
}

/**
 * A part's lines cut to `max` characters, with a line that says what was cut. `keep: 'end'` keeps the newest
 * lines (the history); else the first. A part within its size comes back as it was.
 */
export function cutPart(lines: string[], max: number, what: string, keep: 'start' | 'end' = 'start'): string[] {
  const all = lines.join('\n');
  if (all.length <= max) return lines;
  const kept: string[] = [];
  let size = 0;
  const order = keep === 'end' ? [...lines].reverse() : lines;
  for (const l of order) {
    if (size + l.length + 1 > max) break;
    kept.push(l);
    size += l.length + 1;
  }
  const left = lines.length - kept.length;
  const line = `_Cut: ${what} ran to ${all.length} characters, more than the ${max} this pack keeps, so its ${keep === 'end' ? 'oldest' : 'last'} ${plural(left, 'line')} ${left === 1 ? 'is' : 'are'} left out._`;
  return keep === 'end' ? [line, ...kept.reverse()] : [...kept, line];
}

/** The ticket's text, comments, related tickets and changes field, as the plan reads them (T-110), each heading a level down, under the part's. */
const ticketPart = (i: PackIn): string[] => ticketLines(i.ticket).map((l) => l.replace(/^(#+) /, '#$1 '));

/** The plan: its version and approval, summary, goal and criteria, each choice and question with what was decided, its steps, risks and notes. */
function planPart(a: Analysis | null): string[] {
  if (!a) return ['There is no plan yet.'];
  const r = a.requirements;
  const list = (head: string, xs: string[]) => (xs.length ? [`**${head}**`, '', ...xs.map((x) => `- ${x}`), ''] : []);
  return [
    `Version ${planVersion(a)}, ${a.approval ? `approved by ${a.approval.by}` : 'not approved'}.`,
    '',
    a.summary,
    '',
    ...(r.goal ? [`**Goal:** ${r.goal}`, ''] : []),
    ...list('Acceptance criteria', r.criteria),
    ...list('Assumptions', r.assumptions),
    ...list('Out of scope', r.outOfScope),
    ...(a.decisions ?? []).flatMap((d) => [
      `**Choice ${d.id}. ${d.title}**`,
      '',
      ...(d.why ? [d.why, ''] : []),
      ...d.options.map((o) => `- ${o.id}) **${o.name}** (effort ${o.effort})${o.id === d.recommended ? ' [recommended]' : ''}: ${[o.means, o.cons.length ? `Cons: ${o.cons.join('; ')}.` : ''].filter(Boolean).join(' ')}`),
      '',
      `Recommends ${recommendedName(d)}${d.because ? `: ${d.because}` : '.'}`,
      d.choice ? `Chosen: **${choiceName(d)}**, by ${d.choice.by}.` : 'Not chosen yet.',
      '',
    ]),
    ...list('Questions', a.questions.map((q) => `${q.id}. ${q.question} ${q.answer ? `Answered: ${q.answer.text}` : 'Not answered.'}`)),
    ...list('Steps', a.approach.plan.map((s, n) => `s${n + 1}. ${s}`)),
    ...list('Risks', a.approach.risks.map((s, n) => `r${n + 1}. ${s}`)),
    ...list('Notes on the plan', (a.notes ?? []).map((n) => n.text)),
  ];
}

/** What the work changed, grouped by type as the Changes tab lists it, with its changes outside git; nothing before there is work. */
function changedPart(i: PackIn): string[] {
  const text = changesDraft({ profile: i.profile, paths: i.changed, outside: outsideOf(i.task).changes, at: new Date(0) });
  if (!text) return ['Nothing changed yet.'];
  // The draft's last line is the day it was drafted, which says nothing here.
  return text.split('\n').slice(0, -1);
}

/** Each org it was deployed to, its latest deploy there: the commit, when, what went and what the tests found. */
function deployedPart(t: Task): string[] {
  const all = latestDeploys(t.deploys);
  if (!all.length) return ['acc has no record of a deploy.'];
  return all.map((d) => `- ${d.org} (${d.env}), ${d.at}${d.by ? `, by ${d.by}` : ''}: commit ${d.sha.slice(0, 8)}, ${plural(d.components.length, 'component')}, ${d.verified} listed in the org; ${testsWords(d.tests)}.${d.components.length ? ` Components: ${d.components.join(', ')}.` : ''}`);
}

/** Each check on its latest commit, with its result, as the reviewer reads it. */
const checksPart = (rs: Receipt[]): string[] =>
  rs.length ? [...rs].sort((a, b) => a.gate.localeCompare(b.gate)).map(checkLine) : ['No checks were run on its latest commit.'];

/** The latest review: its verdict, summary, each criterion met or not, and each finding with where it is. */
function reviewPart(v: Verdict | null): string[] {
  if (!v) return ['It has not been reviewed.'];
  return [
    `${v.verdict === 'pass' ? 'Passed' : 'Changes asked'} on commit ${v.sha.slice(0, 8)}, ${v.at}. ${v.summary}`,
    '',
    ...v.criteria.map((c) => `- Criterion ${c.met ? 'met' : 'not met'}: ${c.text}${c.evidence ? ` (${c.evidence})` : ''}`),
    ...v.findings.map((f) => `- ${f.must ? 'Must fix' : 'Worth a look'}${f.file ? ` in ${f.file}${f.line ? `:${f.line}` : ''}` : ''}: ${f.message}`),
    ...(v.findings.length ? [] : ['- No findings.']),
  ];
}

/** Why it is blocked and what it asks, in the words it was blocked with; else that it isn't. */
function blockedPart(t: Task): string[] {
  if (t.state !== 'blocked') return [`It is not blocked. Its state is ${t.state}.`];
  return [t.blocker ?? 'It is blocked, and no reason was given.'];
}

/** A builder's note, a part a line, with who gave it and how its run ended. */
const noteLines = (n: RunNote, head: string): string[] => [`**${head}**, by ${n.by} at ${n.at}, as its run ${n.ended === 'blocked' ? 'was blocked' : 'went to review'}:`, '', ...noteMarkdown(n), ''];

/** What a person wrote for its builder, and the builder's notes: this run's, and the run before. */
function notesPart(t: Task): string[] {
  const out = [
    ...(t.notes?.trim() ? ['**What a person wrote for its builder**', '', t.notes.trim(), ''] : []),
    ...(t.run?.note ? noteLines(t.run.note, 'Its builder\'s note') : []),
    ...(t.run?.before ? noteLines(t.run.before, 'The run before left this note') : []),
  ];
  return out.length ? out : ['Its builder has left no note.'];
}

/** Each move, oldest first: when, from and to, by whom, and why. */
const historyPart = (t: Task): string[] =>
  t.history.length ? t.history.map((h) => `- ${h.at}: ${h.from ?? 'added'} to ${h.to}, by ${h.by}${h.reason ? `: ${h.reason}` : ''}`) : ['No history yet.'];

/** Each part's lines, before it is cut. */
export function packParts(i: PackIn): Record<PackPart, string[]> {
  return {
    ticket: ticketPart(i), plan: planPart(i.analysis), changed: changedPart(i), deployed: deployedPart(i.task), checks: checksPart(i.checks),
    review: reviewPart(i.review), blocked: blockedPart(i.task), notes: notesPart(i.task), history: historyPart(i.task),
  };
}

/** The pack: a head, then each part under its heading, cut to its size. */
export function ticketPack(i: PackIn): string {
  const parts = packParts(i);
  const t = i.task;
  return [
    `# Everything acc knows about ${t.id}: ${t.title}`,
    '',
    `Its state is ${t.state}.${t.source.url ? ` Its ticket: ${t.source.url}.` : ''}${t.pr ? ` Its pull request: ${t.pr.url} (${t.pr.state}).` : ''}`,
    '',
    ...PACK_PARTS.flatMap((p) => [`## ${PACK_HEADS[p]}`, '', ...cutPart(parts[p], PACK_LIMITS[p], PACK_HEADS[p].toLowerCase(), p === 'history' ? 'end' : 'start'), '']),
  ].join('\n');
}

/** The commit its checks and review are read on: its pull request's, else its branch's head, else its latest review's. */
function headOf(run: Runner, root: string, t: Task, review: Verdict | null): string | null {
  if (t.pr?.sha) return t.pr.sha;
  const branch = t.run?.branch ? run('git', ['rev-parse', '--verify', '--quiet', `${t.run.branch}^{commit}`], { cwd: root }) : null;
  if (branch?.code === 0 && branch.stdout.trim()) return branch.stdout.trim();
  return review?.sha ?? null;
}

/** The pack for a task, read from what acc holds now; null for a task acc doesn't keep. */
export function readTicketPack(paths: RepoPaths, config: Pick<Config, 'profile'>, id: string, run: Runner): string | null {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) return null;
  const review = latestVerdict(paths, id);
  const head = headOf(run, paths.root, task, review);
  return ticketPack({
    task, ticket: readPlanTicket(paths, id) ?? ticketWithout(task), analysis: readAnalysis(paths, id), profile: config.profile,
    changed: changedPathsOf(paths, run, task), checks: head ? Object.values(receiptsAt(paths, head)) : [], review,
  });
}
