/**
 * A plan starts with a conversation (T-111): before the planning agent investigates, the person says what they
 * want to do and what they're thinking, and the agent says briefly what it understood, and asks at most three
 * questions, each with its answers to pick (T-113, talk-questions.ts). It answers read-only, from the ticket, in a new session that the plan and Talk it
 * through then resume, so the agent remembers what the person said first. The turns are kept in the plan's
 * conversation (plan-talk.ts) as the plan's version 0: said before there was a plan.
 */

import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { agentArgs } from './agents.ts';
import { type Analysis, analystDir, analystEnv, analystFlags, analyzing, readAnalysis } from './analyze.ts';
import { holdAwake } from './awake.ts';
import type { Config } from './config.ts';
import { AccError, type RunResult } from './exec.ts';
import { readLedger, type Task } from './ledger.ts';
import { sessionName } from './names.ts';
import type { RepoPaths } from './paths.ts';
import { addTurn, type PlanTalk, readTalk, TALK_MAX, type TalkDeps, talking, talkingPath, type TalkTurn, writeTalk } from './plan-talk.ts';
import { type PlanTicket, ticketLines, ticketWithout } from './plan-ticket.ts';
import { NO_STEPS } from './steps.ts';
import { askedLine, parseQuestions, QUESTIONS_MAX, QUESTIONS_SCHEMA, REPLY_RULES, type TalkAsk, turnQuestions } from './talk-questions.ts';

/** The plan's version the opening conversation is kept at: there is no plan yet. */
export const OPENING_VERSION = 0;

/** What the conversation asks first, on the page and in acc. */
export const OPENING_ASK = 'What do you want to do here, and what are you thinking?';

/** The most questions the planning agent asks before it plans. */
export const OPENING_QUESTIONS_MAX = QUESTIONS_MAX;

/** A turn said before there was a plan. */
export const isOpening = (t: Pick<TalkTurn, 'version'>): boolean => t.version === OPENING_VERSION;

/** The opening conversation's turns: what the person said, and the agent's answers, before the plan. */
export const openingTurns = (t: PlanTalk): TalkTurn[] => t.turns.filter(isOpening);

/** What the planning agent answers with first: Claude Code checks it against this (`--json-schema`). */
export const OPENING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['understood', 'questions'],
  properties: {
    understood: { type: 'string', description: 'What you understood the person wants, from the ticket and their words, in plain words. At most about 80 words, and no questions' },
    questions: QUESTIONS_SCHEMA,
  },
} as const;

/** What the planning agent is told on each message before the plan. */
export const OPENING_SYSTEM = [
  'You will plan this ticket. Before you investigate, the person who decides says what they want to do and what they are thinking.',
  'Show what you understood from the ticket and their words, and ask your questions.',
  REPLY_RULES,
  'Do not investigate in depth yet: read the ticket, and look at the code or the org only to understand their words. The plan comes next, in this same session.',
  'You can\'t change anything: no edits, no writes, no deploys.',
  'Be concrete and brief: names, files, numbers. No filler.',
].join('\n');

/**
 * The message to the planning agent before the plan: the first one holds the ticket (T-110: its comments too),
 * since the session starts with it; a later one is the person's words, as the session already holds the ticket.
 */
export function openingPrompt(task: Pick<Task, 'id' | 'title'>, text: string, ticket: PlanTicket | null): string {
  return [
    ...(ticket ? [`# ${task.id}: ${task.title}`, '', ...ticketLines(ticket), `# ${OPENING_ASK}`, ''] : ['# The person says', '']),
    text.trim(),
    '',
    'Answer them: what you understood, briefly, and your questions, if any.',
  ].join('\n');
}

/** The answer from Claude Code's JSON result: what it understood, and at most three questions, each with its answers. */
export function parseOpeningReply(stdout: string): { understood: string; questions: TalkAsk[]; sessionId: string | null; costUsd: number | null } {
  let r: Record<string, any>;
  try {
    r = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    throw new AccError('talk', `The planning agent gave no reply Claude Code could read: ${stdout.trim().slice(0, 200) || '(nothing)'}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s || typeof s.understood !== 'string' || !s.understood.trim()) throw new AccError('talk', `The planning agent didn't reply (${r.subtype ?? 'no result'}): ${String(r.result ?? '').slice(0, 300)}`);
  return {
    understood: s.understood.trim(), questions: parseQuestions(s.questions),
    sessionId: typeof r.session_id === 'string' ? r.session_id : null, costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null,
  };
}

/** The session the opening conversation runs in: the agent's last answer's, or null before its first. */
export const openingSession = (t: PlanTalk): string | null => [...openingTurns(t)].reverse().find((x) => x.who === 'agent' && x.sessionId)?.sessionId ?? null;

/**
 * The planning session a new plan resumes (T-111): with an opening conversation, the newest of the agent's
 * sessions, from its last answer or the plan before; without one, null, and the plan starts its own as before.
 */
export function planningSession(t: PlanTalk, previous: Pick<Analysis, 'sessionId' | 'at'> | null): string | null {
  if (!openingSession(t)) return null;
  const replies = t.turns.filter((x) => x.who === 'agent' && x.sessionId).map((x) => ({ at: x.at, id: x.sessionId! }));
  const all = previous ? [...replies, { at: previous.at, id: previous.sessionId }] : replies;
  return all.reduce((a, b) => (b.at >= a.at ? b : a)).id;
}

/** The section of the plan's prompt (T-111): what the person said before the plan, and that the plan names what it took from it. */
export function openingSection(t: PlanTalk): string[] {
  const said = openingTurns(t);
  if (!said.some((x) => x.who === 'you')) return [];
  return [
    '## What the person said before the plan',
    '',
    ...said.flatMap((x) => (x.who === 'you'
      ? [`- The person: ${x.text}`]
      : [`- You (the planning agent): ${x.text}`, ...(x.unsure ?? []).map((u) => `  - Unsure: ${u}`), ...turnQuestions(x).map(askedLine)])),
    '',
    'This is what the person is thinking: ground the plan in it. Where a choice or a recommendation rests on what they said, name it in that choice\'s why or because, starting "You said: " with their words.',
    '',
  ];
}

/** The task to start a plan for, or why not: no task, not waiting to be built, a plan already there, or one being made. */
function taskToOpen(paths: RepoPaths, id: string): Task {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (task.state !== 'todo') throw new AccError('refused', `${id} isn't waiting to be built. Start a plan before it's built.`);
  if (analyzing(paths, id)) throw new AccError('refused', `${id}'s plan is being made. Wait for it to finish.`);
  if (readAnalysis(paths, id)) throw new AccError('refused', `${id} has a plan already. Talk it through instead: acc plan talk ${id}.`);
  return task;
}

/**
 * The person's opening message, and the planning agent's answer (T-111): what it understood, and at most
 * three questions, each with its answers (T-113). The first message starts the planning session with the whole ticket
 * (`ticket`, T-110; without it, the description); each later one resumes it. Read-only, with the same tools
 * and hook as making the plan. The person's message is kept first, so an answer that fails still shows what
 * was said.
 */
export function startPlan(paths: RepoPaths, config: Config, id: string, message: string, deps: TalkDeps & { uuid?: () => string }, by: string, ticket: PlanTicket | null = null): { turn: TalkTurn; reply: TalkTurn } {
  const { run, now } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const { task, text, resume } = steps.step('plan', 'Check the task', () => {
    const task = taskToOpen(paths, id);
    if (talking(paths, id)) throw new AccError('refused', `The planning agent is still answering about ${id}. Wait for its reply.`);
    const text = message.trim();
    if (!text) throw new AccError('usage', 'Say what you want to do, and what you\'re thinking.');
    if (text.length > TALK_MAX) throw new AccError('usage', `Your message is longer than ${TALK_MAX} characters.`);
    return { task, text, resume: openingSession(readTalk(paths, id)) };
  });
  const turn = addTurn(paths, id, { who: 'you', by, at: now().toISOString(), version: OPENING_VERSION, text });
  // A new session starts from a fresh folder, as a plan's does; a later message resumes it from the same one.
  const cwd = analystDir(paths, config, id, !!resume);
  const session = resume ?? (deps.uuid ?? randomUUID)();
  const marker = talkingPath(paths, id);
  writeFileSync(marker, JSON.stringify({ pid: process.pid, startedAt: now().toISOString() }));
  steps.start('talk', 'Ask the planning agent', 'It reads the ticket, and changes nothing');
  const awake = holdAwake(process.pid, deps.awake);
  let out: RunResult;
  try {
    const name = sessionName({ project: config.project, key: id, title: task.title, role: 'analysis' });
    out = run('claude', [
      '-p', ...(resume ? ['--resume', resume] : ['--session-id', session, '--name', name]), '--permission-mode', 'dontAsk', ...agentArgs(config.agents.reviewer),
      '--output-format', 'json', '--json-schema', JSON.stringify(OPENING_SCHEMA), '--append-system-prompt', OPENING_SYSTEM,
      ...analystFlags(paths, config, cwd, deps.accCommand),
    ], { cwd, input: openingPrompt(task, text, resume ? null : (ticket ?? ticketWithout(task))), env: analystEnv(config, deps.env, id), timeoutMs: 20 * 60_000 });
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
  let parsed: ReturnType<typeof parseOpeningReply>;
  try {
    parsed = parseOpeningReply(out.stdout);
  } catch (e) {
    return fail((e as Error).message);
  }
  steps.done('talk', parsed.questions.length ? `It asks ${parsed.questions.length} question${parsed.questions.length === 1 ? '' : 's'}` : 'It replied');
  const reply = steps.step('save', 'Keep the reply', () => addTurn(paths, id, {
    who: 'agent', by: `analyst:${id}`, at: now().toISOString(), version: OPENING_VERSION, text: parsed.understood,
    questions: parsed.questions, sessionId: parsed.sessionId ?? session, costUsd: parsed.costUsd,
  }));
  return { turn, reply };
}
