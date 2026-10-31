/**
 * Talking a plan through (T-98), and discussing the whole ticket (T-169): a person's messages to the planning
 * agent, its replies, and the changes it proposes, kept with the task in the state folder beside its plan: one
 * conversation per ticket. Each message gives the agent everything acc knows about the ticket (ticket-context.ts)
 * and resumes the plan's own session, read-only, with the same tools and hook as making the plan. A proposal
 * changes nothing until the person uses it. A note records to the plan as the person, and so does a Claude Code
 * session opened on it.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { roleArgs } from './agents.ts';
import { type Analysis, analystDir, analystEnv, analystFlags, analyzing, answerAnalysis, fileId, type PlanNote, readAnalysis, writeAnalysis } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import { type AwakeDeps, holdAwake } from './awake.ts';
import type { Config } from './config.ts';
import { AccError, run, type RunResult, type Runner } from './exec.ts';
import { mutate, readLedger, type Task } from './ledger.ts';
import { alive } from './lock.ts';
import { sessionName } from './names.ts';
import type { RepoPaths } from './paths.ts';
import { choosePlan } from './plan-choices.ts';
import { askOf, choiceName, lapse, planVersion, recommendedName } from './plan.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { askedLine, parseQuestions, QUESTIONS_SCHEMA, REPLY_RULES, type TalkAsk, turnQuestions } from './talk-questions.ts';
import { readTicketPack } from './ticket-context.ts';

/** Who said it: the person, the planning agent, a Claude Code session the person opened, or a new version of the plan. */
export type TalkWho = 'you' | 'agent' | 'claude-code' | 'plan';

/** What a message is about (T-98): a choice, one of its options, a step of the approach, a risk or a question, quoted. */
export interface TalkQuote {
  /** d1, d1.a, s2, r1 or q1. */
  ref: string;
  kind: 'choice' | 'option' | 'step' | 'risk' | 'question';
  text: string;
}

/**
 * A change the planning agent suggests: one of a choice's options, a new option in words, an answer to a
 * question, or a note such as a changed step. The person uses it, or not.
 */
export interface TalkProposal {
  /** p1, p2… within its reply. */
  id: string;
  kind: 'choose' | 'own' | 'answer' | 'note';
  /** For choose and own: the choice's id. */
  decision?: string;
  /** For choose: the option's name. */
  option?: string;
  /** For answer: the question's id. */
  question?: string;
  /** For own, answer and note: the words it records. */
  text: string;
  why: string;
  /** The person used it: who and when. */
  used?: { by: string; at: string };
}

export interface TalkTurn {
  /** t1, t2… */
  id: string;
  who: TalkWho;
  by: string;
  at: string;
  /** The plan's version when it was said. */
  version: number;
  text: string;
  about?: TalkQuote;
  proposals?: TalkProposal[];
  /** The agent's session, or the Claude Code session the person opened. */
  sessionId?: string;
  /** For a Claude Code session: what it recorded to the plan, a line each. */
  recorded?: string[];
  /** For the person's message: why no reply came. */
  failed?: string;
  /** For the agent's answer before the plan, kept before T-113: what it's unsure of, a line each. */
  unsure?: string[];
  /** For the agent's answer before the plan, kept before T-113: its questions as words. */
  asks?: string[];
  /** For the agent's answer (T-113): its questions, at most three, each with its answers to pick. */
  questions?: TalkAsk[];
  costUsd?: number | null;
}

/** A task's conversation about its plan. */
export interface PlanTalk {
  v: 1;
  task: string;
  turns: TalkTurn[];
}

/** The longest message a person sends, as an answer's. */
export const TALK_MAX = 4000;

/** The variable a Claude Code session opened on a plan carries, `<task>:<session>`, so what it records is shown with it. */
export const TALK_SESSION_VAR = 'ACC_PLAN_TALK';

/** What acc says before it adds a note to an approved plan: the page and acc plan note say the same. */
export const NOTE_APPROVED = 'This plan is approved. A note changes it, so the plan must be approved again before it\'s built.';

/** What acc says before an answer from the conversation changes an approved plan. */
export const ANSWER_APPROVED = 'This plan is approved. An answer changes it, so the plan must be approved again before it\'s built.';

export const talkPath = (paths: RepoPaths, task: string): string => join(paths.analyses, `${fileId(task)}.talk.json`);
/** The marker a reply under way leaves, with its process: a talk's, or before the plan an opening's (T-111). */
export const talkingPath = (paths: RepoPaths, task: string): string => join(paths.analyses, `${fileId(task)}.talking.json`);
/** The brief a Claude Code session reads first: the ticket, the plan and the conversation. */
export const briefPath = (paths: RepoPaths, task: string): string => join(paths.analyses, `${fileId(task)}.brief.md`);

/** The task's conversation about its plan, or an empty one. */
export function readTalk(paths: RepoPaths, task: string): PlanTalk {
  try {
    const t = JSON.parse(readFileSync(talkPath(paths, task), 'utf8')) as PlanTalk;
    if (t.v === 1 && t.task === task && Array.isArray(t.turns)) return t;
  } catch {
    // none yet
  }
  return { v: 1, task, turns: [] };
}

/** Writes the conversation whole, as a plan is written. */
export function writeTalk(paths: RepoPaths, t: PlanTalk): void {
  mkdirSync(paths.analyses, { recursive: true });
  writeAtomic(talkPath(paths, t.task), JSON.stringify(t, null, 2) + '\n');
}

/** Adds a turn, numbered after the last, and keeps it. */
export function addTurn(paths: RepoPaths, task: string, turn: Omit<TalkTurn, 'id'>): TalkTurn {
  const t = readTalk(paths, task);
  const kept: TalkTurn = { id: `t${t.turns.length + 1}`, ...turn };
  t.turns.push(kept);
  writeTalk(paths, t);
  return kept;
}

/** A reply under way, as its marker keeps it: the session it answers in (T-131), which an older acc didn't write. */
export interface Talking { pid: number; startedAt: string; sessionId?: string }

/** A talk under way for the task: its process, and its session. Null once that has gone. */
export function talking(paths: RepoPaths, task: string): Talking | null {
  try {
    const r = JSON.parse(readFileSync(talkingPath(paths, task), 'utf8')) as Talking;
    return alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}

/**
 * What a reference names in the plan, quoted: a choice (d1), one of its options (d1.a), a step of the
 * approach (s2), a risk (r1) or a question (q1). Null for one the plan doesn't have.
 */
export function quoteOf(a: Analysis, ref: string): TalkQuote | null {
  const r = ref.trim().toLowerCase();
  const option = /^(d\d+)\.([a-z])$/.exec(r);
  if (option) {
    const d = a.decisions?.find((x) => x.id === option[1]);
    const o = d?.options.find((x) => x.id === option[2]);
    return d && o ? { ref: r, kind: 'option', text: `${d.title}: ${o.name}${o.means ? `. ${o.means}` : ''}` } : null;
  }
  const d = /^d\d+$/.test(r) ? a.decisions?.find((x) => x.id === r) : undefined;
  if (d) return { ref: r, kind: 'choice', text: d.title };
  const n = Number(r.slice(1)) - 1;
  if (/^s\d+$/.test(r) && a.approach.plan[n]) return { ref: r, kind: 'step', text: a.approach.plan[n]! };
  if (/^r\d+$/.test(r) && a.approach.risks[n]) return { ref: r, kind: 'risk', text: a.approach.risks[n]! };
  const q = /^q\d+$/.test(r) ? a.questions.find((x) => x.id === r) : undefined;
  return q ? { ref: r, kind: 'question', text: q.question } : null;
}

/** What the planning agent must answer with: Claude Code checks it against this (`--json-schema`). */
export const TALK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'proposals', 'questions'],
  properties: {
    reply: { type: 'string', description: 'Your answer to the person, in plain words. Say what you read in the code or the org to answer it. At most about 80 words, and no questions' },
    proposals: {
      type: 'array',
      description: 'Each change to the plan you suggest, which the person can use with one click. Empty when you suggest none',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'decision', 'option', 'question', 'text', 'why'],
        properties: {
          kind: { type: 'string', enum: ['choose', 'own', 'answer', 'note'], description: 'choose: one of a choice\'s options. own: a new option for a choice, in words. answer: an answer to one of the plan\'s questions. note: a changed step, or something else the builder must know' },
          decision: { type: 'string', description: 'For choose and own: the choice\'s id, such as d1. Otherwise empty' },
          option: { type: 'string', description: 'For choose: the option\'s name, exactly as the plan names it. Otherwise empty' },
          question: { type: 'string', description: 'For answer: the question\'s id, such as q1. Otherwise empty' },
          text: { type: 'string', description: 'For own, answer and note: the words to record. For choose: empty' },
          why: { type: 'string', description: 'Why, in one sentence' },
        },
      },
    },
    questions: QUESTIONS_SCHEMA,
  },
} as const;

/** What the planning agent is told on each message, beside its own session's history: about the whole ticket (T-169). */
export const TALK_SYSTEM = [
  'You are this ticket\'s planning agent. The person who decides discusses the ticket with you: what it asks, its plan, what the work changed, where it is deployed, its checks, its review, and why it is blocked. They ask why, push back on an option, or suggest another.',
  'Each message starts with everything acc knows about the ticket now. Answer from it, from the code, and on Salesforce from the org: read again what you need, and say what you read. Never guess.',
  'You can\'t change anything: no edits, no writes, no deploys, and never the plan itself. While the ticket waits to be built, give a change you suggest to the plan as a proposal: the person uses it or not. Once it is being built, the plan is settled: propose nothing. Never say a change is made.',
  'Agree when they are right, and say so plainly when they are not, with the reason.',
  REPLY_RULES,
  'Be concrete and brief: names, files, numbers. No filler.',
].join('\n');

/** The plan as it stands now, for a message: a person may have chosen, answered or noted since the agent last saw it. */
function standing(a: Analysis): string[] {
  const decisions = a.decisions ?? [];
  return [
    `## The plan now (v${planVersion(a)})`,
    '',
    ...decisions.map((d) => `- ${d.id}. ${d.title}: options ${d.options.map((o) => `${o.id}) ${o.name}`).join(', ')}; recommends ${recommendedName(d)}; ${d.choice ? `chosen: **${choiceName(d)}**` : 'not chosen yet'}`),
    ...a.questions.map((q) => `- ${q.id}. ${q.question} ${q.answer ? `Answered: **${q.answer.text}**` : `Not answered${askOf(q) === 'author' ? ' (for the ticket\'s author)' : ''}`}`),
    ...a.approach.plan.map((s, i) => `- Step s${i + 1}: ${s}`),
    ...a.approach.risks.map((r, i) => `- Risk r${i + 1}: ${r}`),
    ...(a.notes ?? []).map((n) => `- The person's note: ${n.text}`),
    '',
  ];
}

/**
 * The message to the planning agent (T-169): everything acc knows about the ticket (`pack`, ticket-context.ts),
 * what it's about, the person's words, and while the plan can change (`open`), the plan as it stands now with its
 * ids. With no plan, or past the build, it asks for no proposal.
 */
export function talkPrompt(a: Analysis | null, text: string, about: TalkQuote | null, pack = '', open = true): string {
  return [
    ...(pack ? [pack, ''] : []),
    '# The person says',
    '',
    ...(about ? [`About ${about.kind} ${about.ref}: "${about.text}"`, ''] : []),
    text.trim(),
    '',
    ...(a && open
      ? [...standing(a), 'Answer them. Give each change you suggest to the plan as a proposal, using the ids above, and each question as a question item.']
      : ['Answer them, and give each question as a question item. The plan is settled, or there is none yet: propose nothing.']),
  ].join('\n');
}

/**
 * The reply from Claude Code's JSON result, each proposal checked against the plan: one that names a choice,
 * an option or a question the plan doesn't have, or carries no words where it needs them, is left out. With no
 * plan to change (null: none, or past the build, T-169), every proposal is left out.
 */
export function parseTalkReply(stdout: string, a: Analysis | null): { reply: string; proposals: TalkProposal[]; questions: TalkAsk[]; sessionId: string | null; costUsd: number | null } {
  let r: Record<string, any>;
  try {
    r = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    throw new AccError('talk', `The planning agent gave no reply Claude Code could read: ${stdout.trim().slice(0, 200) || '(nothing)'}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s || typeof s.reply !== 'string' || !s.reply.trim()) throw new AccError('talk', `The planning agent didn't reply (${r.subtype ?? 'no result'}): ${String(r.result ?? '').slice(0, 300)}`);
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const proposals: TalkProposal[] = [];
  for (const p of a && Array.isArray(s.proposals) ? s.proposals : []) {
    const kind = str(p?.kind);
    const text = str(p?.text);
    const why = str(p?.why);
    const d = a!.decisions?.find((x) => x.id === str(p?.decision).toLowerCase());
    const next = { id: `p${proposals.length + 1}`, why };
    if (kind === 'choose') {
      const o = d?.options.find((x) => x.name.toLowerCase() === str(p.option).toLowerCase() || x.id === str(p.option).toLowerCase());
      if (d && o) proposals.push({ ...next, kind, decision: d.id, option: o.name, text: '' });
    } else if (kind === 'own') {
      if (d && text) proposals.push({ ...next, kind, decision: d.id, text });
    } else if (kind === 'answer') {
      const q = a!.questions.find((x) => x.id === str(p.question).toLowerCase());
      if (q && text) proposals.push({ ...next, kind, question: q.id, text });
    } else if (kind === 'note' && text) {
      proposals.push({ ...next, kind, text });
    }
  }
  return { reply: s.reply.trim(), proposals, questions: parseQuestions(s.questions), sessionId: typeof r.session_id === 'string' ? r.session_id : null, costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null };
}

/** The session a message resumes: the agent's last reply on this version, else the plan's own. */
export function talkSession(a: Analysis, t: PlanTalk): string {
  const v = planVersion(a);
  return [...t.turns].reverse().find((x) => x.who === 'agent' && x.version === v && x.sessionId)?.sessionId ?? a.sessionId;
}

export interface TalkDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** How to run acc from a hook, so the agent's commands are checked as when it made the plan. */
  accCommand?: string;
  awake?: AwakeDeps;
  steps?: Steps;
}

/**
 * The ticket to discuss (T-169), its plan, and whether the plan can still change; or why not: no task, or its plan
 * being made. A task waiting to be built with no plan starts one with a conversation instead (acc plan start).
 */
function ticketToTalk(paths: RepoPaths, id: string): { task: Task; a: Analysis | null; open: boolean } {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (analyzing(paths, id)) throw new AccError('refused', `${id}'s plan is being made. Wait for it to finish.`);
  const a = readAnalysis(paths, id);
  if (!a && task.state === 'todo') throw new AccError('no-analysis', `${id} has no plan yet: start one with acc plan start ${id}, or acc analyze ${id}.`);
  return { task, a, open: task.state === 'todo' && !!a };
}

/** The session a message about a ticket with no plan resumes (T-169): the agent's last reply's, or null before its first. */
export const lastSession = (t: PlanTalk): string | null => [...t.turns].reverse().find((x) => x.who === 'agent' && x.sessionId)?.sessionId ?? null;

/**
 * A person's message about the ticket, and the planning agent's reply (T-98, T-169). Each message gives the agent
 * everything acc knows about the ticket now (ticket-context.ts). It resumes the plan's session read-only, with the
 * same tools, hook and model as making the plan; a ticket built with no plan starts a session of its own, and
 * later messages resume it. While the ticket waits to be built, the reply may propose changes to the plan, which
 * change nothing until the person uses one; past the build it proposes none. The person's message is kept first,
 * so a reply that fails still shows what was asked.
 */
export function talkPlan(paths: RepoPaths, config: Config, id: string, message: string, ref: string | null, deps: TalkDeps & { uuid?: () => string }, by: string): { turn: TalkTurn; reply: TalkTurn } {
  const { run, now } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const { task, a, open, about, text } = steps.step('plan', 'Check the ticket', () => {
    const { task, a, open } = ticketToTalk(paths, id);
    if (talking(paths, id)) throw new AccError('refused', `The planning agent is still answering about ${id}. Wait for its reply.`);
    const text = message.trim();
    if (!text) throw new AccError('usage', 'Say something to the planning agent.');
    if (text.length > TALK_MAX) throw new AccError('usage', `Your message is longer than ${TALK_MAX} characters.`);
    const about = ref && a ? quoteOf(a, ref) : null;
    if (ref && !about) throw new AccError('usage', `${id}'s plan has no ${ref}. Name a choice (d1), an option (d1.a), a step (s1), a risk (r1) or a question (q1).`);
    return { task, a, open, about, text };
  });
  const v = a ? planVersion(a) : 0;
  const pack = steps.step('pack', 'Read what acc knows about the ticket', () => readTicketPack(paths, config, id, run) ?? '');
  const turn = addTurn(paths, id, { who: 'you', by, at: now().toISOString(), version: v, text, ...(about ? { about } : {}) });
  const resume = a ? talkSession(a, readTalk(paths, id)) : lastSession(readTalk(paths, id));
  const session = resume ?? (deps.uuid ?? randomUUID)();
  const cwd = analystDir(paths, config, id, !!resume);
  const marker = talkingPath(paths, id);
  writeFileSync(marker, JSON.stringify({ pid: process.pid, startedAt: now().toISOString(), sessionId: session } satisfies Talking));
  steps.start('talk', 'Ask the planning agent', 'It reads again, and changes nothing');
  const awake = holdAwake(process.pid, deps.awake);
  let out: RunResult;
  try {
    out = run('claude', [
      '-p', ...(resume ? ['--resume', resume] : ['--session-id', session, '--name', sessionName({ project: config.project, key: id, title: task.title, role: 'analysis' })]),
      '--permission-mode', 'dontAsk', ...roleArgs(config, 'planner'),
      '--output-format', 'json', '--json-schema', JSON.stringify(TALK_SCHEMA), '--append-system-prompt', TALK_SYSTEM,
      ...analystFlags(paths, config, cwd, deps.accCommand),
    ], { cwd, input: talkPrompt(a, text, about, pack, open), env: analystEnv(config, deps.env, id), timeoutMs: 20 * 60_000 });
  } finally {
    awake?.release();
    rmSync(marker, { force: true });
  }
  const fail = (why: string): never => {
    const t = readTalk(paths, id);
    const mine = t.turns.find((x) => x.id === turn.id);
    if (mine) { mine.failed = why; writeTalk(paths, t); }
    throw new AccError('talk', why);
  };
  if (out.timedOut) fail('The planning agent didn\'t reply within 20 minutes, so acc stopped it.');
  if (out.code === 127 && !out.stdout) fail(`Claude Code didn't start: ${out.stderr.trim().split('\n')[0] ?? 'claude not found'}`);
  let parsed: ReturnType<typeof parseTalkReply>;
  try {
    parsed = parseTalkReply(out.stdout, open ? a : null);
  } catch (e) {
    return fail((e as Error).message);
  }
  const asked = parsed.questions.length;
  const said = [
    parsed.proposals.length ? `proposes ${parsed.proposals.length} change${parsed.proposals.length === 1 ? '' : 's'}` : '',
    asked ? `asks ${asked} question${asked === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  steps.done('talk', said.length ? `It ${said.join(' and ')}` : 'It replied');
  const reply = steps.step('save', 'Keep the reply', () => addTurn(paths, id, {
    who: 'agent', by: a?.name ?? `analyst:${id}`, at: now().toISOString(), version: v, text: parsed.reply, proposals: parsed.proposals, questions: parsed.questions,
    sessionId: parsed.sessionId ?? session, costUsd: parsed.costUsd,
  }));
  return { turn, reply };
}

/** A person's note on the plan (T-98): it changes the plan, so an approved plan asks first (`yes`). */
export function notePlan(paths: RepoPaths, id: string, text: string, by: string, now: () => Date, yes = false): { plan: Analysis; note: PlanNote } {
  const a = readAnalysis(paths, id);
  if (!a) throw new AccError('no-analysis', `${id} has no plan yet: acc analyze ${id}.`);
  const words = text.trim();
  if (!words) throw new AccError('usage', 'Give the note in words.');
  if (words.length > TALK_MAX) throw new AccError('usage', `The note is longer than ${TALK_MAX} characters.`);
  if (a.approval && !yes) throw new AccError('refused', `${NOTE_APPROVED} To add it anyway, run it again with --yes.`);
  const note: PlanNote = { text: words, by, at: now().toISOString(), version: planVersion(a) };
  a.notes = [...(a.notes ?? []), note];
  lapse(a);
  writeAnalysis(paths, a);
  mutate(paths, now, (_l, emit) => {
    emit({ type: 'task.updated', task: id, actor: 'human', by, data: { noted: { version: note.version } } });
  });
  return { plan: a, note };
}

/** What using a proposal did, as a line: what the plan now says. */
export interface Used {
  proposal: TalkProposal;
  plan: Analysis;
  /** False when it was already used, or it's what the plan already says. */
  changed: boolean;
  line: string;
}

/** A proposal in words, as the page and acc show it. */
export function proposalWords(p: TalkProposal, a: Analysis | null): string {
  const d = a?.decisions?.find((x) => x.id === p.decision);
  const title = d?.title ?? p.decision ?? '';
  if (p.kind === 'choose') return `Choose ${p.option} for ${title}`;
  if (p.kind === 'own') return `For ${title}, something else: ${p.text}`;
  if (p.kind === 'answer') return `Answer ${a?.questions.find((q) => q.id === p.question)?.question ?? p.question}: ${p.text}`;
  return `Note on the plan: ${p.text}`;
}

/** Why Use this refuses a proposal made on an older version of the plan: the page and acc say the same. */
export const proposalStale = (from: number, now: number): string =>
  `This was proposed on v${from}, and the plan is now v${now}. Ask the planning agent again about v${now}.`;

/**
 * "Use this" (T-98): a reply's proposal recorded in the plan as the person's own choice, answer or note,
 * through the same functions acc plan choose, acc analysis answer and acc plan note use, so their rules hold:
 * a change on an approved plan needs the person's yes. Using one already used changes nothing; one made on an
 * older version of the plan is refused.
 */
export function useProposal(paths: RepoPaths, id: string, turnId: string, proposalId: string, by: string, now: () => Date, yes = false): Used {
  const t = readTalk(paths, id);
  const turn = t.turns.find((x) => x.id === turnId && x.who === 'agent');
  const p = turn?.proposals?.find((x) => x.id === proposalId);
  if (!turn || !p) throw new AccError('usage', `${id}'s conversation has no proposal ${turnId}.${proposalId}.`);
  const before = readAnalysis(paths, id);
  if (p.used) return { proposal: p, plan: before!, changed: false, line: proposalWords(p, before) };
  if (readLedger(paths.ledger).tasks.find((x) => x.id === id)?.state !== 'todo') throw new AccError('refused', `${id} isn't waiting to be built, so its plan is settled.`);
  // A proposal on an older version may name a choice the new one numbers differently, so it never records.
  if (before && turn.version !== planVersion(before)) throw new AccError('refused', proposalStale(turn.version, planVersion(before)));
  let plan: Analysis;
  let changed = true;
  if (p.kind === 'choose' || p.kind === 'own') {
    const r = choosePlan(paths, id, p.decision!, p.kind === 'choose' ? { option: p.option! } : { text: p.text }, by, now, yes);
    ({ plan, changed } = r);
  } else if (p.kind === 'answer') {
    if (before?.approval && !yes) throw new AccError('refused', `${ANSWER_APPROVED} To answer anyway, run it again with --yes.`);
    plan = answerAnalysis(paths, id, p.question!, p.text, by, now);
  } else {
    plan = notePlan(paths, id, p.text, by, now, yes).plan;
  }
  // The plan is kept first: the conversation only says it was used once it is.
  const after = readTalk(paths, id);
  const kept = after.turns.find((x) => x.id === turnId)?.proposals?.find((x) => x.id === proposalId);
  if (kept) { kept.used = { by, at: now().toISOString() }; writeTalk(paths, after); }
  return { proposal: kept ?? p, plan, changed, line: proposalWords(p, plan) };
}

/**
 * What a Claude Code session opened on the plan recorded (T-98): a line on its turn, so the page shows it
 * with the session. `session` is TALK_SESSION_VAR's value; one for another task, or none, records nothing.
 */
export function recordInSession(paths: RepoPaths, id: string, session: string | undefined, line: string): boolean {
  const [task, sid] = (session ?? '').split(':');
  if (!sid || task !== id) return false;
  const t = readTalk(paths, id);
  const turn = t.turns.find((x) => x.who === 'claude-code' && x.sessionId === sid);
  if (!turn) return false;
  turn.recorded = [...(turn.recorded ?? []), line];
  writeTalk(paths, t);
  return true;
}

/** The conversation as lines, for a new version's analyst and Claude Code's brief: who said what, and what was used. */
export function talkLines(t: PlanTalk, a: Analysis | null): string[] {
  const who: Record<TalkWho, string> = { you: 'The person', agent: 'You (the planning agent)', 'claude-code': 'In Claude Code', plan: 'The plan' };
  return t.turns.flatMap((x) => [
    `- ${who[x.who]} (${x.version ? `v${x.version}` : 'before the plan'})${x.about ? `, about ${x.about.kind} ${x.about.ref} "${x.about.text}"` : ''}: ${x.text}`,
    ...(x.proposals ?? []).map((p) => `  - Proposed: ${proposalWords(p, a)}${p.used ? ' (the person used it)' : ' (not used)'}`),
    ...(x.recorded ?? []).map((r) => `  - Recorded: ${r}`),
    ...(x.who === 'agent' ? turnQuestions(x).map(askedLine) : []),
  ]);
}

/** The section of a new version's prompt (T-98): the conversation, the notes, and that the version reflects what was agreed. */
export function talkSection(paths: RepoPaths, id: string, previous: Analysis | null): string[] {
  const t = readTalk(paths, id);
  // What was said before the plan has its own section (T-111): plan-opening.ts's openingSection.
  const said = t.turns.filter((x) => x.who !== 'plan' && x.version !== 0);
  const notes = previous?.notes ?? [];
  if (!said.length && !notes.length) return [];
  return [
    ...(said.length ? ['## What the person and the planning agent said about the plan', '', ...talkLines({ ...t, turns: said }, previous), ''] : []),
    ...(notes.length ? ['## The person\'s notes on the plan', '', ...notes.map((n) => `- ${n.text}`), ''] : []),
    'Make this version reflect what was agreed: a proposal the person used is their decision. Keep each choice\'s title when it still applies.',
    '',
  ];
}

/** After a new version (T-98): the conversation says so, and what changed, so the person sees what their talk did. */
export function versionTurn(paths: RepoPaths, a: Analysis, by: string): void {
  if (!readTalk(paths, a.task).turns.length) return;
  addTurn(paths, a.task, { who: 'plan', by, at: a.at, version: planVersion(a), text: `Made v${planVersion(a)} from this conversation.`, recorded: a.changes ?? [] });
}

/**
 * The brief a Claude Code session reads (T-169): everything acc knows about the ticket, as each message of its
 * conversation gives the agent (ticket-context.ts), the conversation so far, and while the ticket waits to be
 * built, how to record to the plan. Past the build, or with no plan, it records nothing.
 */
export function claudeBrief(paths: RepoPaths, config: Pick<Config, 'profile'>, id: string, runner: Runner = run): string {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  const pack = readTicketPack(paths, config, id, runner);
  if (!task || !pack) return '';
  const a = readAnalysis(paths, id);
  const t = readTalk(paths, id);
  const head = [pack, '', ...(t.turns.length ? ['## The conversation so far', '', ...talkLines(t, a), ''] : [])];
  if (!a || task.state !== 'todo') {
    return [...head, '## What you can do', '', 'You are in plan mode: you read, and change no file. The plan is settled, or there is none yet, so record nothing: answer the person from the code and from what acc knows above.', ''].join('\n');
  }
  return [
    ...head,
    '## Recording to the plan',
    '',
    'You are in plan mode: you read, and change no file. When the person agrees to something, record it to the plan, as them, with one of these:',
    '',
    `- A choice: \`acc plan choose ${id} <choice> <option>\`, such as \`acc plan choose ${id} d1 b\`, or their own option: \`acc plan choose ${id} <choice> --text "…"\``,
    `- An answer: \`acc analysis answer ${id} <question> "…"\``,
    `- A note, such as a changed step: \`acc plan note ${id} "…"\``,
    '',
    'None of these is allowed in advance: Claude Code asks the person before each one runs, so they see it first.',
    '',
    `${a.approval ? 'The plan is approved: a change undoes that, so acc asks for --yes. Say so to the person first.' : 'Record only what the person agreed to.'}`,
    '',
  ].join('\n');
}

/** How the Command Center opens a Claude Code session on the plan: where, its arguments, and the variable its records carry. */
export interface ClaudeLaunch {
  cwd: string;
  sessionId: string;
  name: string;
  args: string[];
  env: Record<string, string>;
  brief: string;
}

/**
 * Open in Claude Code (T-98, T-169): an interactive session in the main checkout, in plan mode, that reads the
 * brief first, with everything acc knows about the ticket. At any state but while its plan is made; a ticket
 * waiting to be built with no plan starts one with a conversation instead. While the ticket waits to be built,
 * it may record a choice, an answer or a note through acc. Only Read, Grep and Glob are allowed in
 * advance: acc plan choose, acc plan note and acc analysis answer are not, so Claude Code asks the person
 * before each one runs, and the brief says so. The conversation gets a turn for the session, which shows what
 * it recorded.
 */
export function openInClaude(paths: RepoPaths, config: Config, id: string, by: string, now: () => Date, uuid: () => string = randomUUID, runner: Runner = run): ClaudeLaunch {
  const { task, a, open } = ticketToTalk(paths, id);
  const brief = briefPath(paths, id);
  mkdirSync(paths.analyses, { recursive: true });
  writeAtomic(brief, claudeBrief(paths, config, id, runner));
  const sessionId = uuid();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: 'plan' });
  addTurn(paths, id, { who: 'claude-code', by, at: now().toISOString(), version: a ? planVersion(a) : 0, text: 'Opened the ticket in Claude Code.', sessionId, recorded: [] });
  const from = `answer from the code${config.profile === 'salesforce' ? ' and the org' : ''}`;
  const prompt = `Read ${brief} first. It holds everything acc knows about ${id}: its ticket, its plan, what it changed, its checks, its review and what was said about it. Then discuss the ticket with me: ${from}, ${open ? 'and record to the plan only what I agree to, as the brief says' : 'and change nothing'}.`;
  return {
    cwd: paths.root, sessionId, name, brief,
    // The prompt comes first: --allowedTools takes every argument after it up to the next flag, so a prompt after it
    // would be read as one more allowed tool, and the session would open with no first message.
    args: [prompt, '--permission-mode', 'plan', '--session-id', sessionId, '--name', name, '--allowedTools', 'Read', 'Grep', 'Glob'],
    env: { [TALK_SESSION_VAR]: `${id}:${sessionId}` },
  };
}
