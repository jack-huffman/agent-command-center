import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentArgs } from './agents.ts';
import { STE_STRICT } from './analyze.ts';
import { type AwakeDeps, holdAwake } from './awake.ts';
import type { Config } from './config.ts';
import { AccError, type RunResult, type Runner } from './exec.ts';
import { readLedger, type Task, writeAtomic } from './ledger.ts';
import { alive } from './lock.ts';
import { sessionName } from './names.ts';
import type { RepoPaths } from './paths.ts';
import { type SteFinding, steLint } from './ste.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { toMarkdown } from './trackers/doc.ts';
import type { Ticket } from './trackers/types.ts';
import { draftUpdate, ticketOf, type Update } from './updates.ts';

/**
 * Drafted acceptance criteria (T-81): a read-only agent reads a tracker task's ticket, its comments, its
 * related tickets and the repo, and drafts acceptance criteria, test steps and edge cases, with the open
 * questions for the ticket's author. acc keeps the draft with the task. It never reaches the tracker by
 * itself: a person adds it to the description in the task sheet and saves, or opens it as an update
 * draft and posts it as a comment.
 */

/** The ticket as the drafter reads it: its text, its comments and its related tickets, as Markdown. */
export interface CriteriaTicket {
  key: string;
  title: string;
  url: string | null;
  markdown: string;
  comments: { author: string; created: string; markdown: string }[];
  related: { key: string; title: string; relation: string }[];
  /** false: only the description acc keeps for the task; its comments and related tickets weren't read. */
  full: boolean;
}

export interface CriteriaDraft {
  v: 1;
  task: string;
  /** The ticket it was drafted from. */
  key: string;
  criteria: string[];
  steps: string[];
  edgeCases: string[];
  /** What only the ticket's author can answer. */
  questions: string[];
  /** All of it as Markdown, under CRITERIA_HEADING's sub-headings: what goes in the description or the comment. */
  markdown: string;
  /** The hard findings of the wording check on the markdown that remain after the drafter's one fix. */
  wording: SteFinding[];
  /** What the drafter was given: how many comments and related tickets, and whether it had the whole ticket. */
  read: { comments: number; related: number; full: boolean };
  sessionId: string;
  name: string;
  at: string;
  durationMs: number;
  costUsd: number | null;
}

const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description }) as const;

/** What the drafter must answer with: Claude Code checks it against this (`--json-schema`). */
export const CRITERIA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'steps', 'edgeCases', 'questions'],
  properties: {
    criteria: strings('Acceptance criteria, each one testable, one sentence each'),
    steps: strings('Test steps in order: what a tester does, and what the tester sees'),
    edgeCases: strings('Edge cases the ticket does not cover: empty, failed, slow, cleared and other states'),
    questions: strings('Open questions for the ticket\'s author: only what the ticket, its comments and the code do not answer'),
  },
} as const;

/** The heading the draft goes under in a description or a comment. */
export const CRITERIA_HEADING = 'Drafted acceptance criteria';

/** The sub-headings of the draft, in order. */
export const CRITERIA_PARTS = { criteria: 'Acceptance criteria', steps: 'Test steps', edgeCases: 'Edge cases', questions: 'Open questions for the author' } as const;

/** The most of a ticket the drafter is given: the description, and each of the newest comments. */
export const CRITERIA_TEXT_MAX = 30_000;
export const CRITERIA_COMMENTS_MAX = 40;
const COMMENT_MAX = 4_000;

/** The drafter's time limit. */
export const CRITERIA_TIMEOUT_MS = 20 * 60_000;

/**
 * A task id as a file name under .git/acc/criteria. An id that could leave that folder, such as ../X, is
 * refused before any path is built from it.
 */
function fileId(task: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(task) || task.includes('..')) throw new AccError('usage', `${task} isn't a task id.`);
  return task;
}

export const criteriaDir = (paths: Pick<RepoPaths, 'stateDir'>): string => join(paths.stateDir, 'criteria');
export const criteriaPath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(criteriaDir(paths), `${fileId(task)}.json`);
const runningPath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(criteriaDir(paths), `${fileId(task)}.running.json`);

/** The task's stored draft, or null when it has none, or the file can't be read. */
export function readCriteria(paths: Pick<RepoPaths, 'stateDir'>, task: string): CriteriaDraft | null {
  try {
    const d = JSON.parse(readFileSync(criteriaPath(paths, task), 'utf8')) as CriteriaDraft;
    return d.v === 1 && d.task === task && typeof d.markdown === 'string' ? d : null;
  } catch {
    return null;
  }
}

export interface Drafting {
  sessionId: string;
  name: string;
  startedAt: string;
  pid: number;
}

/** A draft under way for the task, so it shows as drafting. Null once its process has gone. */
export function drafting(paths: Pick<RepoPaths, 'stateDir'>, task: string): Drafting | null {
  try {
    const r = JSON.parse(readFileSync(runningPath(paths, task), 'utf8')) as Drafting;
    return alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}

const clipText = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}\n\n(cut at ${max} characters)` : s);

/** A tracker's ticket as the drafter reads it: the newest comments, each and the description cut to a size. */
export function criteriaTicket(t: Pick<Ticket, 'key' | 'title' | 'url' | 'markdown' | 'comments' | 'related'>): CriteriaTicket {
  return {
    key: t.key, title: t.title, url: t.url, markdown: clipText(t.markdown, CRITERIA_TEXT_MAX),
    comments: t.comments.slice(-CRITERIA_COMMENTS_MAX).map((c) => ({ author: c.author.name, created: c.created, markdown: clipText(toMarkdown(c.body), COMMENT_MAX) })),
    related: t.related.map((r) => ({ key: r.key, title: r.title, relation: r.relation })),
    full: true,
  };
}

/** The ticket as acc keeps it for the task, when no tracker was read: its title and description, and no comments. */
export function taskTicket(task: Pick<Task, 'id' | 'title' | 'brief' | 'source'>): CriteriaTicket {
  return { key: task.source.key ?? task.id, title: task.title, url: task.source.url, markdown: clipText(task.brief, CRITERIA_TEXT_MAX), comments: [], related: [], full: false };
}

/** A ticket from a file (`--ticket`): the JSON the Command Center writes. Anything else says what is wrong. */
export function parseCriteriaTicket(text: string): CriteriaTicket {
  let x: any;
  try {
    x = JSON.parse(text);
  } catch {
    throw new AccError('usage', 'The ticket file isn\'t JSON.');
  }
  const str = (v: unknown): v is string => typeof v === 'string';
  if (!x || !str(x.key) || !str(x.title) || !str(x.markdown) || !Array.isArray(x.comments) || !Array.isArray(x.related)) {
    throw new AccError('usage', 'The ticket file needs a key, a title, a markdown description, comments and related tickets.');
  }
  return {
    key: x.key, title: x.title, url: str(x.url) ? x.url : null, markdown: clipText(x.markdown, CRITERIA_TEXT_MAX),
    comments: x.comments.filter((c: any) => str(c?.markdown)).slice(-CRITERIA_COMMENTS_MAX).map((c: any) => ({ author: str(c.author) ? c.author : 'Someone', created: str(c.created) ? c.created : '', markdown: clipText(c.markdown, COMMENT_MAX) })),
    related: x.related.filter((r: any) => str(r?.key)).map((r: any) => ({ key: r.key, title: str(r.title) ? r.title : '', relation: str(r.relation) ? r.relation : 'related' })),
    full: true,
  };
}

// ---------------------------------------------------------------- what the drafter is told

export interface CriteriaInput {
  task: Pick<Task, 'id' | 'title'>;
  ticket: CriteriaTicket;
  root: string;
  rules: string | null;
}

/** The drafter's standing instructions, and the ticket it drafts from. */
export function criteriaPrompt(i: CriteriaInput): { system: string; prompt: string } {
  const system = [
    `You draft the acceptance criteria for ticket ${i.ticket.key}. A person edits your draft, and then adds it to the ticket or posts it as a comment for the ticket's author.`,
    `You can read the repo at ${i.root} with Read, Grep and Glob. You can't change anything, run commands, or post anything.`,
    'Work like a careful tester who adds detail to a ticket:',
    '- Read the ticket, each comment and each related ticket. A later comment can change what the description asks for.',
    '- Read the code that the ticket touches, so each criterion says what the product does today and what must change.',
    '- Write acceptance criteria that a tester can check, one sentence each.',
    '- Write test steps in order. Each step says what the tester does and what the tester sees.',
    '- Write the edge cases: an empty or failed result, the state before the first result, a choice cleared after it was made, a slow step, and input at its limits.',
    '- Write an open question only for what the ticket, its comments and the code do not answer. Ask the ticket\'s author, in plain words.',
    'The ticket\'s author reads the draft. Use plain words about what the product does. Do not name files, code, tools or agents.',
    '',
    'acc checks the draft with acc ste check, its wording check, and the draft must pass it. Write each item in Simplified Technical English (ASD-STE100), Strict mode:',
    ...STE_STRICT.slice(1),
    '',
    'Be concrete and brief. No filler.',
  ].join('\n');
  const t = i.ticket;
  const prompt = [
    `# Draft acceptance criteria for ${t.key}: ${t.title}`,
    '',
    t.url ? `Ticket: ${t.url}` : `Task: ${i.task.id}`,
    '',
    '## The ticket',
    '',
    t.markdown.trim() || '_The ticket has no description beyond its title._',
    '',
    '## Its comments',
    '',
    ...(!t.full ? ['_The comments were not read. Draft from the description._'] : t.comments.length ? t.comments.flatMap((c) => [`### ${c.author}${c.created ? `, ${c.created}` : ''}`, '', c.markdown.trim() || '_empty_', '']) : ['_No comments._']),
    '',
    '## Related tickets',
    '',
    ...(!t.full ? ['_The related tickets were not read._'] : t.related.length ? t.related.map((r) => `- ${r.relation}: ${r.key}${r.title ? ` ${r.title}` : ''}`) : ['_None._']),
    '',
    ...(i.rules?.trim() ? ['## The project\'s rules', '', i.rules.trim(), ''] : []),
  ].join('\n');
  return { system, prompt };
}

/** What the drafter is told when its draft fails the wording check: each finding, to fix and answer again. */
export function criteriaFixPrompt(findings: SteFinding[]): string {
  return [
    'acc ste check found these problems in your draft. Fix each one, keep what the draft says, and answer again with the whole draft.',
    '',
    ...findings.map((f) => `- Line ${f.line}: ${f.message} [${f.match}]`),
  ].join('\n');
}

type Parts = Pick<CriteriaDraft, 'criteria' | 'steps' | 'edgeCases' | 'questions'>;

/** The draft from Claude Code's JSON result. Anything else is an error that says what came back. */
export function parseCriteria(stdout: string): { draft: Parts; sessionId: string | null; costUsd: number | null } {
  let r: Record<string, any>;
  try {
    r = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    throw new AccError('criteria', `The drafter gave no result Claude Code could read: ${stdout.trim().slice(0, 200) || '(nothing)'}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s) throw new AccError('criteria', `The draft didn't finish (${r.subtype ?? 'no result'}): ${String(r.result ?? '').slice(0, 300)}`);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : []);
  const draft = { criteria: list(s.criteria), steps: list(s.steps), edgeCases: list(s.edgeCases), questions: list(s.questions) };
  if (!draft.criteria.length) throw new AccError('criteria', 'The draft held no acceptance criteria.');
  return { draft, sessionId: typeof r.session_id === 'string' ? r.session_id : null, costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null };
}

/** The draft as Markdown: a sub-heading for each part that has items, criteria and steps numbered. */
export function criteriaMarkdown(d: Parts): string {
  const part = (key: keyof Parts, numbered: boolean) => (d[key].length ? [`### ${CRITERIA_PARTS[key]}`, '', ...d[key].map((x, n) => `${numbered ? `${n + 1}.` : '-'} ${x}`), ''] : []);
  return [...part('criteria', true), ...part('steps', true), ...part('edgeCases', false), ...part('questions', false)].join('\n').trim();
}

/** The draft under its own heading: what goes below a description, or in a comment. */
export const criteriaSection = (markdown: string): string => `## ${CRITERIA_HEADING}\n\n${markdown.trim()}`;

/** A description with the draft below its current text, under its own heading. */
export const withCriteria = (description: string, markdown: string): string => (description.trim() ? `${description.trimEnd()}\n\n${criteriaSection(markdown)}` : criteriaSection(markdown));

/** The hard findings of the wording check, as `acc ste check` reads the draft. */
export const criteriaWording = (markdown: string): SteFinding[] => steLint(markdown).findings.filter((f) => f.level === 'hard');

// ---------------------------------------------------------------- running it

export interface CriteriaDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  uuid?: () => string;
  onStart?: (sessionId: string, name: string) => void;
  /** For tests: how the Mac is kept awake while the drafter runs (D-067). */
  awake?: AwakeDeps;
  steps?: Steps;
}

/** Why a task can't have criteria drafted, or null: it must be there, and come from a tracker. */
export function criteriaRefusal(task: Pick<Task, 'id' | 'source'> | undefined, id: string): string | null {
  if (!task) return `No task ${id}.`;
  if (!ticketOf(task)) return `${id} has no ticket. Its sheet holds its brief, so there is nothing to draft from.`;
  return null;
}

/**
 * Drafts the task's acceptance criteria, test steps and edge cases (T-81), and keeps the draft with the
 * task. The agent reads and changes nothing, with the reviewer's model and effort. A draft that fails the
 * wording check goes back to the drafter once, with the findings; what still fails is kept with the draft.
 * Nothing is written to the tracker, and no update is drafted.
 */
export function draftCriteria(paths: RepoPaths, config: Config, id: string, ticket: CriteriaTicket | null, deps: CriteriaDeps, rules: string | null = null): CriteriaDraft {
  const { run, now } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const task = steps.step('task', 'Check the task', () => {
    const t = readLedger(paths.ledger).tasks.find((x) => x.id === id);
    const why = criteriaRefusal(t, id);
    if (why) throw new AccError(t ? 'refused' : 'no-task', why);
    if (ticket && ticket.key.toUpperCase() !== (t!.source.key ?? '').toUpperCase()) throw new AccError('usage', `The ticket file is for ${ticket.key}, not ${t!.source.key}.`);
    return t!;
  });
  const read = ticket ?? taskTicket(task);
  const { system, prompt } = criteriaPrompt({ task, ticket: read, root: paths.root, rules });
  const sessionId = (deps.uuid ?? randomUUID)();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: 'criteria' });
  mkdirSync(criteriaDir(paths), { recursive: true });
  const marker = runningPath(paths, id);
  const startedAt = now();
  writeFileSync(marker, JSON.stringify({ sessionId, name, startedAt: startedAt.toISOString(), pid: process.pid } satisfies Drafting));
  deps.onStart?.(sessionId, name);
  // Read-only by construction, as the reviewer is: only the read tools, and dontAsk refuses everything else.
  const tools = ['--allowedTools', 'Read', 'Grep', 'Glob', '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch'];
  const ask = (args: string[], input: string): RunResult => {
    const out = run('claude', [
      '-p', ...args, '--permission-mode', 'dontAsk', ...agentArgs(config.agents.reviewer),
      '--output-format', 'json', '--json-schema', JSON.stringify(CRITERIA_SCHEMA), '--append-system-prompt', system, ...tools,
    ], { cwd: paths.root, input, env: { ...deps.env, ACC_ROLE: 'reviewer', ACC_TASK: id }, timeoutMs: CRITERIA_TIMEOUT_MS });
    if (out.timedOut) throw new AccError('criteria', `The draft didn't finish within ${CRITERIA_TIMEOUT_MS / 60_000} minutes, so acc stopped it.`);
    if (out.code === 127 && !out.stdout) throw new AccError('criteria', `Claude Code didn't start: ${out.stderr.trim().split('\n')[0] ?? 'claude not found'}`);
    return out;
  };
  // The drafter is a child of this acc, so the Mac stays awake while acc lives (D-067).
  const awake = holdAwake(process.pid, deps.awake);
  let parsed: ReturnType<typeof parseCriteria>;
  let markdown: string;
  let wording: SteFinding[];
  let cost: number | null;
  try {
    steps.start('draft', `Draft ${id}'s acceptance criteria`, 'The drafter reads, and changes nothing');
    parsed = parseCriteria(ask(['--session-id', sessionId, '--name', name], prompt).stdout);
    markdown = criteriaMarkdown(parsed.draft);
    wording = criteriaWording(markdown);
    cost = parsed.costUsd;
    steps.done('draft');
    if (wording.length) {
      // One fix, in the same session: the drafter sees its draft and what the check found.
      steps.start('wording', 'Fix the wording', `${wording.length} finding${wording.length === 1 ? '' : 's'}`);
      const fixed = parseCriteria(ask(['--resume', parsed.sessionId ?? sessionId], criteriaFixPrompt(wording)).stdout);
      const again = criteriaMarkdown(fixed.draft);
      const left = criteriaWording(again);
      if (left.length <= wording.length) [parsed, markdown, wording] = [{ ...fixed, sessionId: fixed.sessionId ?? parsed.sessionId }, again, left];
      cost = cost === null && fixed.costUsd === null ? null : (cost ?? 0) + (fixed.costUsd ?? 0);
      steps.done('wording', wording.length ? `${wording.length} left` : 'It passes');
    }
  } finally {
    awake?.release();
    rmSync(marker, { force: true });
  }
  const finished = now();
  const draft: CriteriaDraft = {
    v: 1, task: id, key: read.key, ...parsed.draft, markdown, wording,
    read: { comments: read.comments.length, related: read.related.length, full: read.full },
    sessionId: parsed.sessionId ?? sessionId, name, at: finished.toISOString(), durationMs: finished.getTime() - startedAt.getTime(), costUsd: cost,
  };
  steps.step('save', 'Keep the draft with the task', () => writeAtomic(criteriaPath(paths, id), JSON.stringify(draft, null, 2) + '\n'));
  return draft;
}

/**
 * The task's draft as an update draft (T-81), for a person to edit and post as a comment. It only writes
 * the update's file: nothing is posted. An unposted one from an earlier draft is replaced.
 */
export function criteriaUpdate(paths: RepoPaths, id: string, by: string, now: () => Date): Update {
  const task = readLedger(paths.ledger).tasks.find((x) => x.id === id);
  const why = criteriaRefusal(task, id);
  if (why) throw new AccError(task ? 'refused' : 'no-task', why);
  const d = readCriteria(paths, id);
  if (!d) throw new AccError('no-criteria', `${id} has no drafted acceptance criteria yet. Draft them first.`);
  const u = draftUpdate(paths, task!, { event: 'criteria', text: criteriaSection(d.markdown) }, by, now);
  if (!u) throw new AccError('refused', `${id}'s ticket can't take an update.`);
  return u;
}
