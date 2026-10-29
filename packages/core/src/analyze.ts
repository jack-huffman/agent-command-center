import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentArgs } from './agents.ts';
import { recordPlanTime } from './plan-times.ts';
import { type AwakeDeps, holdAwake } from './awake.ts';
import { sessionName } from './names.ts';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { AccError, type RunResult, type Runner, sfEnv } from './exec.ts';
import { type Actor, mutate, readLedger, type Task } from './ledger.ts';
import { alive } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { parsePlannedRecords, type PlannedRecordChange, RECORD_CHANGES_SCHEMA, RECORD_PLAN_PROMPT } from './records.ts';
import { rulesText } from './rules.ts';
import { NOTE_FIX_TRIES } from './note-wording.ts';
import { planFixPrompt, planWording, planWordingWords } from './plan-wording.ts';
import { requirementWording, type WordingFinding } from './ste.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { plural } from './text.ts';
import { approvedPlanLines, choiceName, lapse, nextVersion, planProblems } from './plan.ts';
import { openingSection, planningSession } from './plan-opening.ts';
import { readTalk, talkSection, versionTurn } from './plan-talk.ts';
import { parseShapes, parseShapeSplit, SHAPE_PROMPT, SHAPE_SCHEMA, type SharedShape, type ShapeSplit } from './shape-first.ts';
import { shapeTeamLines } from './shape-split.ts';
import { PLAN_TICKET_PROMPT, type PlanRead, planRead, type PlanTicket, readWords, ticketLines, ticketWithout, writePlanTicket } from './plan-ticket.ts';

/**
 * The analysis (D-052): before a task is built, a read-only agent works out what it asks for, what's
 * already there (the code, and on Salesforce the org), and how to build it: the requirements, the
 * questions a person should answer, what it found, the approach and the refactors it needs, the risks
 * and the tests. A person answers the questions; the builder is given all of it.
 *
 * The plan (T-97): each design choice comes with two or three options, and a person chooses one. Each new
 * analysis is a version, kept. Where a plan is required, nothing is built until a person approves the
 * latest version (plan.ts).
 */

/** Who can answer a question (T-97): you, the person who runs the Command Center, or the ticket's author, such as a client. */
export type AskOf = 'you' | 'author';

export interface AnalysisQuestion {
  id: string;
  question: string;
  /** What changes depending on the answer. */
  why: string;
  /** What the analyst would assume if nobody answers. */
  suggested: string;
  /** Who can answer it (T-97). Older analyses have none: you. */
  askOf?: AskOf;
  answer?: { text: string; by: string; at: string };
}

/** One way to settle a design choice (T-97), as the analyst describes it. */
export interface PlanOption {
  /** a, b or c. */
  id: string;
  name: string;
  /** What it means in this project. */
  means: string;
  pros: string[];
  cons: string[];
  effort: 'S' | 'M' | 'L';
  risks: string[];
  /** The files or metadata it touches. */
  touches: string[];
}

/** What a person chose (T-97): one of the options, or their own words, who chose and when. */
export interface PlanChoice {
  /** The option's id, or null for the person's own option in `text`. */
  option: string | null;
  text?: string;
  by: string;
  at: string;
}

/** A design choice the work can't avoid (T-97), its options, and the one the analyst recommends and why. */
export interface PlanDecision {
  /** d1, d2… */
  id: string;
  title: string;
  /** What changes with the choice. */
  why: string;
  options: PlanOption[];
  /** The id of the option the analyst recommends. */
  recommended: string;
  because: string;
  choice?: PlanChoice;
}

/** A person's approval of one version of a plan (T-97). */
export interface PlanApproval {
  version: number;
  by: string;
  at: string;
}

/** A person's note on the plan (T-98): a changed step, or something else the builder must know. */
export interface PlanNote {
  text: string;
  by: string;
  at: string;
  /** The version it was written on. */
  version: number;
}

export interface AnalysisFinding {
  /** What it's about: an object, a flow, a class, a module. */
  area: string;
  detail: string;
  /** Where it was seen: a file, or the org and the query. */
  source: string;
}

export interface Approach {
  plan: string[];
  files: { path: string; change: 'create' | 'update' | 'delete'; why: string }[];
  refactors: { what: string; why: string }[];
  risks: string[];
  tests: string[];
  size: 'S' | 'M' | 'L' | 'XL';
}

/** What each size means, as the analyst is told and a person is shown beside the model to dispatch with (D-086). */
export const SIZE_MEANING: Record<Approach['size'], string> = { S: 'an hour or two', M: 'a day', L: 'a few days', XL: 'split it' };

export interface Analysis {
  v: 1;
  task: string;
  env: string;
  /** The environment branch's commit it read. */
  base: string;
  /** ready: build it. questions: a person answers first. split: too big for one task. */
  verdict: 'ready' | 'questions' | 'split';
  summary: string;
  requirements: { goal: string; criteria: string[]; assumptions: string[]; outOfScope: string[] };
  questions: AnalysisQuestion[];
  findings: AnalysisFinding[];
  approach: Approach;
  /** When the verdict is split: the smaller tasks it suggests. */
  split: string[];
  /** The records the work must create, change or delete (T-100), on Salesforce. Older analyses have none. */
  recordChanges?: PlannedRecordChange[];
  /**
   * The hard findings of the wording check on each requirement line (T-12). acc records no plan with one
   * since T-151, and a plan recorded before with one can't be approved. Analyses written before T-12 have none.
   */
  wording?: WordingFinding[];
  /** The shapes this work changes that other tasks would build on (T-104). Older plans have none. */
  sharedShapes?: SharedShape[];
  /** Where a shape is shared: a small first task for the shape and the rest, suggested to a person (T-104). */
  shapeSplit?: ShapeSplit;
  /** What it read of the ticket (T-110): its comments, the newest, and what it left out. Older plans have none. */
  ticket?: PlanRead;
  /** The orgs it read, by alias. */
  orgs: string[];
  sessionId: string;
  /** What the analyst was called (D-087). Older analyses have none. */
  name?: string;
  at: string;
  durationMs: number;
  costUsd: number | null;
  /** Its version (T-97): 1 for the task's first analysis. Older analyses have none: 1. */
  version?: number;
  /** The design choices to make (T-97). Older analyses have none. */
  decisions?: PlanDecision[];
  /** What changed since the version before (T-97). The first has none. */
  changes?: string[];
  /** A person approved this version (T-97). */
  approval?: PlanApproval;
  /** The last approval that no longer holds (T-97): a newer version came, or a choice or an answer changed after it. */
  lapsed?: PlanApproval;
  /** A person's notes on the plan (T-98), kept from version to version. Older plans have none. */
  notes?: PlanNote[];
  /** The versions before this one, oldest first, each as it was when the next replaced it (T-97). */
  earlier?: Analysis[];
}

const strings = { type: 'array', items: { type: 'string' } } as const;

/** What the analyst must answer with: Claude Code checks it against this (`--json-schema`). */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'requirements', 'questions', 'decisions', 'findings', 'approach', 'split'],
  properties: {
    verdict: { type: 'string', enum: ['ready', 'questions', 'split'], description: 'questions when a person must answer something before it can be built well; split when it is too big for one task' },
    summary: { type: 'string', description: 'Two or three plain sentences: what the task needs, what is already there, and how to build it' },
    requirements: {
      type: 'object', additionalProperties: false, required: ['goal', 'criteria', 'assumptions', 'outOfScope'],
      properties: {
        goal: { type: 'string', description: 'What the person asking wants, in a sentence. Write it in STE Strict mode' },
        criteria: { ...strings, description: 'Acceptance criteria, each one testable. Write each in STE Strict mode' },
        assumptions: { ...strings, description: 'What you assumed that the ticket does not say. Write each in STE Strict mode' },
        outOfScope: { ...strings, description: 'What this task should not do. Write each in STE Strict mode' },
      },
    },
    questions: {
      type: 'array',
      description: 'Only what a person must decide, and nothing you could find out yourself',
      items: {
        type: 'object', additionalProperties: false, required: ['question', 'why', 'suggested', 'askOf'],
        properties: {
          question: { type: 'string' }, why: { type: 'string', description: 'What changes depending on the answer' }, suggested: { type: 'string', description: 'What you would assume if nobody answers' },
          askOf: { type: 'string', enum: ['you', 'author'], description: 'you: the person who runs the build can answer it. author: only the ticket\'s author, such as a client, can answer it' },
        },
      },
    },
    decisions: {
      type: 'array',
      description: 'Each design choice a reviewer would want a person to make, with two or three options: the three that matter most, never a long list. A small task may have none',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'why', 'options', 'recommended', 'because'],
        properties: {
          title: { type: 'string', description: 'The choice, in a few words, such as "Where the stage history is kept"' },
          why: { type: 'string', description: 'What changes with the choice' },
          options: {
            type: 'array', minItems: 2, maxItems: 3,
            items: {
              type: 'object', additionalProperties: false, required: ['name', 'means', 'pros', 'cons', 'effort', 'risks', 'touches'],
              properties: {
                name: { type: 'string', description: 'A short name, different from the other options\' names' },
                means: { type: 'string', description: 'What it means in this project' },
                pros: strings,
                cons: { ...strings, description: 'Honest cons, the recommended option\'s too' },
                effort: { type: 'string', enum: ['S', 'M', 'L'] },
                risks: strings,
                touches: { ...strings, description: 'The files or metadata it touches' },
              },
            },
          },
          recommended: { type: 'string', description: 'The name of the option you recommend, exactly as you named it' },
          because: { type: 'string', description: 'Why you recommend it' },
        },
      },
    },
    findings: {
      type: 'array',
      description: 'What is already there that this task touches or depends on',
      items: { type: 'object', additionalProperties: false, required: ['area', 'detail', 'source'], properties: { area: { type: 'string' }, detail: { type: 'string' }, source: { type: 'string', description: 'A file path, or the org alias and the query or command' } } },
    },
    approach: {
      type: 'object', additionalProperties: false, required: ['plan', 'files', 'refactors', 'risks', 'tests', 'size'],
      properties: {
        plan: { ...strings, description: 'The steps to build it, in order' },
        files: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['path', 'change', 'why'], properties: { path: { type: 'string' }, change: { type: 'string', enum: ['create', 'update', 'delete'] }, why: { type: 'string' } } },
        },
        refactors: {
          type: 'array', description: 'Changes to what is there that the task needs first, and why',
          items: { type: 'object', additionalProperties: false, required: ['what', 'why'], properties: { what: { type: 'string' }, why: { type: 'string' } } },
        },
        risks: strings,
        tests: { ...strings, description: 'How to prove it works: the tests to write or run' },
        size: { type: 'string', enum: ['S', 'M', 'L', 'XL'], description: Object.entries(SIZE_MEANING).map(([s, m]) => `${s}: ${m}`).join('. ') },
      },
    },
    split: { ...strings, description: 'When the verdict is split: the smaller tasks, one line each. Otherwise empty' },
    recordChanges: RECORD_CHANGES_SCHEMA,
    ...SHAPE_SCHEMA,
  },
} as const;

/** The longest task id a file is named for, as the Command Center's messages take it. */
export const TASK_ID_MAX = 100;

/**
 * A task id as a file name under .git/acc/analyses, .git/acc/criteria (T-81) or .git/acc/verifications
 * (T-84). An id that could leave that folder, such as ../../X, or one too long for a file name, is refused
 * before any path is built from it (GH-106).
 */
export function fileId(task: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(task) || task.includes('..') || task.length > TASK_ID_MAX) {
    throw new AccError('usage', `${task.length > TASK_ID_MAX ? `${task.slice(0, 40)}…` : task} isn't a task id.`);
  }
  return task;
}

export const analysisPath = (paths: RepoPaths, task: string): string => join(paths.analyses, `${fileId(task)}.json`);
const runningPath = (paths: RepoPaths, task: string): string => join(paths.analyses, `${fileId(task)}.running.json`);

export function readAnalysis(paths: RepoPaths, task: string): Analysis | null {
  try {
    const a = JSON.parse(readFileSync(analysisPath(paths, task), 'utf8')) as Analysis;
    return a.v === 1 && a.task === task ? a : null;
  } catch {
    return null;
  }
}

/** Writes a task's analysis whole: a temp file beside it, renamed into place. */
export function writeAnalysis(paths: RepoPaths, a: Analysis): void {
  mkdirSync(paths.analyses, { recursive: true });
  const file = analysisPath(paths, a.task);
  writeFileSync(`${file}.tmp`, JSON.stringify(a, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
}

/** Questions nobody has answered yet. */
export const openQuestions = (a: Analysis | null): AnalysisQuestion[] => (a?.questions ?? []).filter((q) => !q.answer);

export interface Analyzing {
  sessionId: string;
  /** What the analyst is called (D-087). An analysis started before names has none. */
  name?: string;
  startedAt: string;
  pid: number;
}

/** An analysis under way for the task, so its session can be watched. Null once its process has gone. */
export function analyzing(paths: RepoPaths, task: string): Analyzing | null {
  try {
    const r = JSON.parse(readFileSync(runningPath(paths, task), 'utf8')) as Analyzing;
    return alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}

/** Whether the project wants an analysis before a task is built: Salesforce does by default (D-052). */
export const analysisRequired = (config: Config): boolean => config.analysis?.required ?? config.profile === 'salesforce';

/**
 * Why a task can't be dispatched for want of its analysis, or nothing. Only a first dispatch is held:
 * a rework already had its analysis.
 */
export function analysisProblems(paths: RepoPaths, config: Config, task: Task): string[] {
  if (task.state !== 'todo' || !analysisRequired(config)) return [];
  const a = readAnalysis(paths, task.id);
  if (!a) return [`${task.id} hasn't been analyzed. This project wants an analysis before a build: acc analyze ${task.id}.`];
  if (a.verdict === 'split') return [`${task.id}'s analysis says it's too big for one task. Split it into: ${a.split.join('; ')}. Or a person dispatches it anyway with --without-analysis.`];
  // Questions for you, choices to make, and an approval of the latest version (T-97).
  return planProblems(a, task.id);
}

// ---------------------------------------------------------------- what the analyst is told

/**
 * Read-only ways into an org, borrowed from the house skills' posture (D-002: ideas, not dependencies):
 * know which org, prove sandbox or production, read freely, never write.
 */
const SALESFORCE_COOKBOOK = [
  'Reading the org. Every command takes --target-org <alias> and --json. You can only read: nothing you run changes an org.',
  '- Which org, for sure: `sf org display --target-org <alias> --json`, and `sf data query --target-org <alias> --query "SELECT IsSandbox, Name, OrganizationType FROM Organization"`. Say which org each finding came from.',
  '- An object\'s fields and picklists: `sf sobject describe --sobject <Object> --target-org <alias> --json`.',
  '- Automation on an object, which runs in this order on save: validation rules, before-save flows, before triggers, after triggers, after-save flows. With --use-tooling-api:',
  '  - `SELECT ValidationName, Active, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = \'<Object>\'`',
  '  - `SELECT Name, Status, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate FROM ApexTrigger WHERE TableEnumOrId = \'<Object>\'`',
  '  - `SELECT Name, TableEnumOrId FROM WorkflowRule WHERE TableEnumOrId = \'<Object>\'`',
  '  - and without the tooling API: `SELECT ApiName, Label, ProcessType, TriggerType, RecordTriggerType, TriggerObjectOrEventLabel, IsActive FROM FlowDefinitionView WHERE TriggerObjectOrEventLabel = \'<Object label>\'`',
  '- What uses a component (tooling API): `SELECT MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentName = \'<Name>\'`.',
  '- Code and its tests: `SELECT Name, LastModifiedDate, LastModifiedBy.Name FROM ApexClass WHERE Name LIKE \'%<word>%\'`, and coverage with `SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate` (tooling API).',
  '- Volumes and limits: `sf limits recordcounts display --sobject <Object> --target-org <alias>` and `sf limits api display --target-org <alias>`.',
  '- A component\'s source as the org has it: `sf project retrieve start --metadata <Type>:<Name> --target-org <alias>` from your working folder, which is a scratch project. It never touches the repo.',
  '- Records: you may read a few to learn their shape (LIMIT 5, only the fields you need). Don\'t copy names, emails or other personal details into your analysis: describe patterns instead.',
  'Compare the org with the repo: the repo\'s branch is meant to match its org. Say where they differ for what this task touches.',
];

const SALESFORCE_FOCUS = [
  'What automation already runs on the objects this touches, in order, and whether the change should join it (an existing flow or trigger handler) instead of adding one more.',
  'Bulk safety and limits at the volumes you found: SOQL and DML out of loops, 200 records a transaction.',
  'Sharing and field access, permission sets and profiles that would need the new fields or classes.',
  'Tests: which test classes cover what changes, and what new tests prove it.',
  'Environment-specific files (D-016) and anything that would differ between orgs.',
];

/**
 * How the analyst writes the requirements (T-12): ASD-STE100 Simplified Technical English, Strict mode, so a
 * builder can read each one in one way only. The rules are here in full, so the analyst needs no skill
 * installed. acc checks the structural ones on each line it reads back (planWording, plan-wording.ts), and
 * sends a plan that fails back to the analyst with each finding (T-151).
 */
export const STE_STRICT = [
  'Write the goal, each acceptance criterion, each assumption, each out-of-scope item and each question in Simplified Technical English (ASD-STE100), Strict mode. A builder agent reads them, a client may read a question, and each must have one meaning only. acc checks the wording of each line before it records the plan, and sends you each finding and its fix:',
  '- Use the active voice. Name who or what does the action: "acc writes the file", not "the file is written".',
  '- Use one instruction or one statement in each sentence. Use no more than 20 words in an instruction and no more than 25 in a description.',
  '- Do not use a semicolon. Write two sentences.',
  '- Use simple tenses: the simple present, past or future. Do not use the present perfect ("has failed") or other compound tenses. Keep a hedge as it is ("may have failed" stays).',
  '- Do not use phrasal verbs ("set up", "spin up", "carry out"). Use one plain verb (start, make, do).',
  '- Use the verb for an action, not a noun made from it: "analyze the log", not "perform an analysis of the log".',
  '- Use one word for one thing, and use it every time. Do not change between "check", "verify" and "confirm" for the same action.',
  '- Do not use marketing adjectives (seamless, robust, powerful, cutting-edge). Give the measurement instead.',
  '- Use no more than 3 nouns together as one name. Do not leave out the subject, the verb or the article to make a sentence shorter.',
  '- Do not end an item on "and" or "or".',
];

export interface AnalysisInput {
  task: Task;
  config: Config;
  env: Environment;
  root: string;
  /** The branch the main checkout is on, when it isn't the environment's. */
  checkedOut: string | null;
  orgs: { alias: string; name: string; type: string }[];
  rules: string | null;
  previous: Analysis | null;
  /** What the person and the planning agent said about the plan, and the person's notes (T-98): plan-talk.ts's talkSection. */
  talk?: string[];
  /** The tasks in flight and ready, for the shared shapes it looks for (T-104): shape-split.ts's shapeTeamLines. */
  team?: string[];
  /** The whole ticket (T-110). Not given: the description only. */
  ticket?: PlanTicket;
  /** What the person said before the plan (T-111): plan-opening.ts's openingSection. */
  opening?: string[];
}

export function analysisPrompt(i: AnalysisInput): { system: string; prompt: string } {
  const sf = i.config.profile === 'salesforce';
  const system = [
    `You are the analyst for ${i.task.id}. Before anyone builds it, you work out what it asks for, what is already there, and how it should be built. A builder agent is given your analysis; a person answers your questions first.`,
    `You can read the repo at ${i.root} (Read, Grep, Glob, and git log, show, diff and grep)${sf ? ', and read the Salesforce orgs listed below with the sf CLI' : ''}. You can't change anything: no edits, no writes, no deploys.`,
    'Work like a careful senior consultant on a new ticket:',
    '- Read the ticket. Restate the goal. Turn what it asks for into testable acceptance criteria. Name your assumptions and what is out of scope.',
    PLAN_TICKET_PROMPT,
    `- Investigate before you decide: find the code${sf ? ' and the org configuration' : ''} this touches, what depends on it, and how it behaves today. Every finding names its source.`,
    '- Decide the approach: the steps, the files, any refactor the task needs first and why, the risks, and the tests that prove it.',
    '- Ask only what a person must decide: business rules, priorities, trade-offs. Never ask what you could find out yourself. Give each question your suggested answer.',
    '- Say who can answer each question: you (the person who runs the build) for priorities and how to build it, or author (who wrote the ticket, such as a client) for a business rule only they know.',
    '- Name every design choice a reviewer would want a person to make, as a decision with two or three options (the three that matter most, never a long list: the person can always write their own): for example, a custom object or field history tracking, a record-triggered flow or Apex, where existing data comes from. Never hide a choice inside the approach: the approach follows the option you recommend. Give honest cons for each option, the one you recommend too. A small task may have no decisions.',
    '- If it is too big for one task (more than a few days), say split and list the smaller tasks.',
    SHAPE_PROMPT,
    ...(sf ? ['', 'For a Salesforce project, also cover:', ...SALESFORCE_FOCUS.map((f) => `- ${f}`), '', ...SALESFORCE_COOKBOOK] : []),
    ...(sf ? ['', RECORD_PLAN_PROMPT] : []),
    '',
    ...STE_STRICT,
    '',
    'Be concrete and brief: names, files, numbers. No filler.',
  ].join('\n');
  const prompt = [
    `# Analyze ${i.task.id}: ${i.task.title}`,
    '',
    `For the ${i.env.name} environment (branch \`${i.env.branch}\`).${i.checkedOut ? ` The repo is checked out on \`${i.checkedOut}\`: read the environment's files with git show ${i.env.branch}:<path>.` : ''}`,
    i.task.source.url ? `Ticket: ${i.task.source.url}` : `Source: ${i.task.source.kind}`,
    '',
    // The description, every comment oldest first, related tickets, attachments' names and the changes field (T-110).
    ...ticketLines(i.ticket ?? ticketWithout(i.task)),
    // What the person said before the plan, which grounds it (T-111).
    ...(i.opening ?? []),
    ...(sf && i.orgs.length ? ['## The orgs you may read', '', ...i.orgs.map((o) => `- \`${o.alias}\`: ${o.name} (${o.type})`), ''] : []),
    ...(i.previous?.questions.some((q) => q.answer) ? [
      '## What a person already answered',
      '',
      ...i.previous.questions.filter((q) => q.answer).map((q) => `- ${q.question} **${q.answer!.text}**`),
      '',
      'Don\'t ask these again.',
      '',
    ] : []),
    // A new version keeps a choice where its title and option's name stay the same (T-97).
    ...(i.previous?.decisions?.some((d) => d.choice) ? [
      '## What a person already chose',
      '',
      ...i.previous.decisions.filter((d) => d.choice).map((d) => `- ${d.title}: **${choiceName(d)}**`),
      '',
      'Where a choice still applies, keep it as a decision with the same title, and keep the chosen option with the same name.',
      '',
    ] : []),
    // The tasks that would build on a shared shape (T-104).
    ...(i.team ?? []),
    // A new version made from the conversation (T-98) reflects what was agreed in it.
    ...(i.talk ?? []),
    ...(i.rules?.trim() ? ['## Rules', '', i.rules.trim(), ''] : []),
  ].join('\n');
  return { system, prompt };
}

/** The analysis from Claude Code's JSON result. Anything else is an error that says what came back. */
export function parseAnalysis(stdout: string): { analysis: Omit<Analysis, 'v' | 'task' | 'env' | 'base' | 'orgs' | 'sessionId' | 'at' | 'durationMs' | 'costUsd'>; sessionId: string | null; costUsd: number | null } {
  let r: Record<string, any>;
  try {
    r = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    throw new AccError('analyze', `The analyst gave no result Claude Code could read: ${stdout.trim().slice(0, 200) || '(nothing)'}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s || !['ready', 'questions', 'split'].includes(s.verdict) || typeof s.summary !== 'string') {
    throw new AccError('analyze', `The analysis didn't finish (${r.subtype ?? 'no result'}): ${String(r.result ?? '').slice(0, 300)}`);
  }
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
  const req = s.requirements ?? {};
  const ap = s.approach ?? {};
  const questions: AnalysisQuestion[] = (Array.isArray(s.questions) ? s.questions : []).filter((q: any) => typeof q?.question === 'string' && q.question.trim())
    .map((q: any, n: number) => ({ id: `q${n + 1}`, question: q.question, why: String(q.why ?? ''), suggested: String(q.suggested ?? ''), askOf: (q.askOf === 'author' ? 'author' : 'you') as AskOf }));
  const analysis = {
    // A ready verdict with questions waiting isn't ready.
    verdict: (s.verdict === 'ready' && questions.length ? 'questions' : s.verdict) as Analysis['verdict'],
    summary: s.summary,
    requirements: { goal: String(req.goal ?? ''), criteria: list(req.criteria), assumptions: list(req.assumptions), outOfScope: list(req.outOfScope) },
    questions,
    decisions: parseDecisions(s.decisions),
    findings: (Array.isArray(s.findings) ? s.findings : []).filter((f: any) => typeof f?.detail === 'string').map((f: any) => ({ area: String(f.area ?? ''), detail: f.detail, source: String(f.source ?? '') })),
    approach: {
      plan: list(ap.plan),
      files: (Array.isArray(ap.files) ? ap.files : []).filter((f: any) => typeof f?.path === 'string' && ['create', 'update', 'delete'].includes(f.change)).map((f: any) => ({ path: f.path, change: f.change, why: String(f.why ?? '') })),
      refactors: (Array.isArray(ap.refactors) ? ap.refactors : []).filter((x: any) => typeof x?.what === 'string').map((x: any) => ({ what: x.what, why: String(x.why ?? '') })),
      risks: list(ap.risks),
      tests: list(ap.tests),
      size: (['S', 'M', 'L', 'XL'].includes(ap.size) ? ap.size : 'M') as Approach['size'],
    },
    split: list(s.split),
    recordChanges: parsePlannedRecords(s.recordChanges),
    ...shapes(s),
  };
  // The wording check on each requirement line as acc reads it (T-12), recorded with its line.
  return { analysis: { ...analysis, wording: requirementWording(analysis.requirements) }, sessionId: typeof r.session_id === 'string' ? r.session_id : null, costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null };
}

/** The shared shapes and the split suggested for them (T-104): none for a task that shares no shape. */
function shapes(s: Record<string, any>): Pick<Analysis, 'sharedShapes' | 'shapeSplit'> {
  const sharedShapes = parseShapes(s.sharedShapes);
  const shapeSplit = parseShapeSplit(s.shapeSplit, sharedShapes);
  return { sharedShapes, ...(shapeSplit ? { shapeSplit } : {}) };
}

/**
 * The design choices from the analyst's answer (T-97), each with ids. A choice with fewer than two options or
 * more than three, or a recommendation that names none of its options, is refused: a person can't choose
 * from it as it is.
 */
export function parseDecisions(v: unknown): PlanDecision[] {
  const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string' && !!y.trim()) : []);
  return (Array.isArray(v) ? v : []).filter((d: any) => typeof d?.title === 'string' && d.title.trim()).map((d: any, n: number) => {
    const options: PlanOption[] = (Array.isArray(d.options) ? d.options : []).filter((o: any) => typeof o?.name === 'string' && o.name.trim()).map((o: any, i: number) => ({
      id: String.fromCharCode(97 + i), name: o.name.trim(), means: String(o.means ?? ''), pros: list(o.pros), cons: list(o.cons),
      effort: (['S', 'M', 'L'].includes(o.effort) ? o.effort : 'M') as PlanOption['effort'], risks: list(o.risks), touches: list(o.touches),
    }));
    if (options.length < 2 || options.length > 3) throw new AccError('analyze', `The analysis gave the choice "${d.title}" ${options.length} option${options.length === 1 ? '' : 's'}. A choice has two or three.`);
    const named = String(d.recommended ?? '').trim().toLowerCase();
    const recommended = options.find((o) => o.name.toLowerCase() === named);
    if (!recommended) throw new AccError('analyze', `The analysis recommends "${String(d.recommended ?? '')}" for the choice "${d.title}", which isn't one of its options: ${options.map((o) => o.name).join(', ')}.`);
    return { id: `d${n + 1}`, title: d.title.trim(), why: String(d.why ?? ''), options, recommended: recommended.id, because: String(d.because ?? '') };
  });
}

// ---------------------------------------------------------------- running it

/** The commands the analyst may run: reads only. Claude Code refuses the rest (dontAsk), and so does its hook. */
export const ANALYST_COMMANDS = {
  any: ['git log', 'git show', 'git diff', 'git grep', 'git ls-files'],
  salesforce: [
    'sf org display', 'sf org list metadata', 'sf org list metadata-types', 'sf data query', 'sf sobject describe', 'sf sobject list',
    'sf limits api display', 'sf limits recordcounts display', 'sf project retrieve start', 'sf apex list log', 'sf apex get log',
  ],
} as const;

export interface AnalyzeDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** How to run acc from a hook, so the analyst's commands are checked too. */
  accCommand?: string;
  uuid?: () => string;
  onStart?: (sessionId: string, name: string) => void;
  /** For tests: how the Mac is kept awake while the analyst runs (D-067). */
  awake?: AwakeDeps;
  /** Where its steps are reported (T-65). */
  steps?: Steps;
}

const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });

/**
 * A scratch Salesforce project for retrieves, so nothing the analyst fetches lands in the repo. Made fresh for
 * each plan; `keep` leaves one already there, as a talk resumes the plan's session in it (T-98).
 */
function scratchProject(paths: RepoPaths, id: string, keep = false): string {
  const dir = join(paths.analyses, `${fileId(id)}.work`);
  if (keep && existsSync(join(dir, 'sfdx-project.json'))) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'force-app'), { recursive: true });
  const project = join(paths.root, 'sfdx-project.json');
  if (existsSync(project)) {
    try {
      const p = JSON.parse(readFileSync(project, 'utf8'));
      writeFileSync(join(dir, 'sfdx-project.json'), JSON.stringify({ ...p, packageDirectories: [{ path: 'force-app', default: true }] }, null, 2));
    } catch {
      copyFileSync(project, join(dir, 'sfdx-project.json'));
    }
  } else {
    writeFileSync(join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }, null, 2));
  }
  return dir;
}

/**
 * Where the planning agent works: the repo, or on Salesforce its scratch project. Claude Code keeps a session
 * under the folder it ran in, so a talk resumes the plan's session from the same one (`keep`, T-98).
 */
export const analystDir = (paths: RepoPaths, config: Config, id: string, keep = false): string => (config.profile === 'salesforce' ? scratchProject(paths, id, keep) : paths.root);

/**
 * The flags that keep the planning agent read-only (D-052): the reads it may run, the tools it's refused, and
 * acc's hook on every command. A talk about the plan runs with the same (T-98).
 */
export function analystFlags(paths: RepoPaths, config: Config, cwd: string, accCommand?: string): string[] {
  const allowed = [...ANALYST_COMMANDS.any, ...(config.profile === 'salesforce' ? ANALYST_COMMANDS.salesforce : [])].map((c) => `Bash(${c}:*)`);
  // Belt and braces: the hook refuses anything but those reads, even if a pattern lets more through.
  const settings = accCommand ? { hooks: { PreToolUse: [{ matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: `${accCommand} hook pre-tool-use` }] }] } } : null;
  return [
    ...(cwd !== paths.root ? ['--add-dir', paths.root] : []),
    ...(settings ? ['--settings', JSON.stringify(settings)] : []),
    '--allowedTools', 'Read', 'Grep', 'Glob', ...allowed,
    '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch',
  ];
}

/** The planning agent's environment: on Salesforce, sf's own, and its role, which acc's hook reads. */
export const analystEnv = (config: Config, env: NodeJS.ProcessEnv, id: string): NodeJS.ProcessEnv =>
  ({ ...(config.profile === 'salesforce' ? sfEnv(env) : env), ACC_ROLE: 'analyst', ACC_TASK: id });

/**
 * Makes a plan. `opts.ticket` is the whole ticket, as the Command Center read it (T-110), or a function that reads
 * it from the task, as `acc analyze --ticket` parses its file; without it, the plan reads the description only.
 */
export function analyze(paths: RepoPaths, config: Config, id: string, deps: AnalyzeDeps, opts: { actor?: Actor; by?: string; ticket?: (task: Task) => PlanTicket; skipOpening?: boolean } = {}): Analysis {
  const { run, now } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const { task, env } = steps.step('task', 'Check the task', () => {
    const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
    if (!task) throw new AccError('no-task', `No task ${id}.`);
    if (task.state === 'done') throw new AccError('refused', `${id} is done. There's nothing left to analyze.`);
    if (task.state === 'running') throw new AccError('refused', `${id} is being built. Analyze before dispatch, or after it's abandoned.`);
    const env = environmentByBranch(config, task.environment);
    if (!env) throw new AccError('analyze', `${id}'s environment "${task.environment}" isn't in the config.`);
    return { task, env };
  });
  const sf = config.profile === 'salesforce';
  steps.start('gather', 'Gather what the analyst reads');
  const base = git(run, paths.root, 'rev-parse', '--verify', '--quiet', env.branch).stdout.trim() || git(run, paths.root, 'rev-parse', 'HEAD').stdout.trim();
  const current = git(run, paths.root, 'branch', '--show-current').stdout.trim();
  const orgs = sf ? config.environments.filter((e) => e.org).map((e) => ({ alias: e.org!, name: e.name, type: e.type })) : [];
  const previous = readAnalysis(paths, id);
  const ticket = opts.ticket ? opts.ticket(task) : ticketWithout(task);
  // With an opening conversation (T-111), the plan resumes its session and holds what was said; Skip to the plan doesn't.
  const talked = readTalk(paths, id);
  const resume = opts.skipOpening ? null : planningSession(talked, previous);
  const opening = opts.skipOpening ? [] : openingSection(talked);
  const { system, prompt } = analysisPrompt({ task, config, env, root: paths.root, checkedOut: current && current !== env.branch ? current : null, orgs, rules: rulesText(paths.root, config.profile), previous, talk: talkSection(paths, id, previous), team: shapeTeamLines(paths, config, readLedger(paths.ledger), run, id), ticket, opening });

  // Claude Code keeps a session under the folder it ran in, so a resumed one runs from the same folder.
  const cwd = analystDir(paths, config, id, !!resume);
  const read = ticket.full ? `the ticket and ${ticket.comments.length} comment${ticket.comments.length === 1 ? '' : 's'}` : 'the description';
  steps.done('gather', orgs.length ? `${read}, the code and ${orgs.length} org(s)` : `${read} and the code`);

  const sessionId = resume ?? (deps.uuid ?? randomUUID)();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: 'analysis' });
  mkdirSync(paths.analyses, { recursive: true });
  const marker = runningPath(paths, id);
  const startedAt = now();
  writeFileSync(marker, JSON.stringify({ sessionId, name, startedAt: startedAt.toISOString(), pid: process.pid } satisfies Analyzing));
  deps.onStart?.(sessionId, name);
  steps.start('analyze', `Analyze ${id}`, 'The analyst reads, and changes nothing');
  // The analyst is a child of this acc, so the Mac stays awake while acc lives (D-067).
  const awake = holdAwake(process.pid, deps.awake);
  const ask = (args: string[], input: string): RunResult => {
    const out = run('claude', [
      '-p', ...args, '--permission-mode', 'dontAsk', ...agentArgs(config.agents.reviewer),
      '--output-format', 'json', '--json-schema', JSON.stringify(ANALYSIS_SCHEMA), '--append-system-prompt', system,
      ...analystFlags(paths, config, cwd, deps.accCommand),
    ], { cwd, input, env: analystEnv(config, deps.env, id), timeoutMs: 45 * 60_000 });
    if (out.timedOut) throw new AccError('analyze', `The analysis didn't finish within 45 minutes, so acc stopped it.`);
    if (out.code === 127 && !out.stdout) throw new AccError('analyze', `Claude Code didn't start: ${out.stderr.trim().split('\n')[0] ?? 'claude not found'}`);
    return out;
  };
  let parsed: ReturnType<typeof parseAnalysis>;
  try {
    const out = ask(resume ? ['--resume', resume] : ['--session-id', sessionId, '--name', name], prompt);
    steps.done('analyze');
    parsed = steps.step('read', 'Read the analysis', () => parseAnalysis(out.stdout));
    // Its requirements and questions pass the wording check (T-151): the planning agent writes them again, in the
    // same session, with each finding's fix. A plan that still fails after NOTE_FIX_TRIES is refused, and none is kept.
    for (let tries = 0, wording = planWording(parsed.analysis); wording.length; tries++, wording = planWording(parsed.analysis)) {
      if (tries === NOTE_FIX_TRIES) throw new AccError('analyze', planWordingWords(wording, tries));
      steps.start('wording', 'Fix the wording', plural(wording.length, 'finding'));
      const fixed = parseAnalysis(ask(['--resume', parsed.sessionId ?? resume ?? sessionId], planFixPrompt(wording)).stdout);
      const cost = parsed.costUsd === null && fixed.costUsd === null ? null : (parsed.costUsd ?? 0) + (fixed.costUsd ?? 0);
      parsed = { analysis: fixed.analysis, sessionId: fixed.sessionId ?? parsed.sessionId, costUsd: cost };
      const left = planWording(parsed.analysis).length;
      steps.done('wording', left ? `${plural(left, 'finding')} left` : 'It passes');
    }
  } finally {
    awake?.release();
    rmSync(marker, { force: true });
  }
  steps.start('save', 'Save the analysis');
  const finished = now();
  // Answers to questions it asks again carry over, so nobody answers twice.
  const answered = new Map((previous?.questions ?? []).filter((q) => q.answer).map((q) => [q.question.trim().toLowerCase(), q.answer!]));
  const questions = parsed.analysis.questions.map((q) => (answered.has(q.question.trim().toLowerCase()) ? { ...q, answer: answered.get(q.question.trim().toLowerCase())! } : q));
  // A new version (T-97): the one before is kept, its choices carry over where they still exist, and an approval lapses.
  const analysis: Analysis = nextVersion(previous, {
    v: 1, task: id, env: env.branch, base, ...parsed.analysis, questions,
    verdict: parsed.analysis.verdict === 'questions' && !questions.some((q) => !q.answer) ? 'ready' : parsed.analysis.verdict,
    ticket: planRead(ticket), orgs: orgs.map((o) => o.alias), sessionId: parsed.sessionId ?? sessionId, name,
    at: finished.toISOString(), durationMs: finished.getTime() - startedAt.getTime(), costUsd: parsed.costUsd,
  });
  writeAnalysis(paths, analysis);
  // How long it took, so the Command Center can say how long plans usually take here (T-131).
  recordPlanTime(paths, { task: id, ms: analysis.durationMs, at: analysis.at });
  // The ticket it read, beside it, so Open in Claude Code reads the same comments (T-110, D-195).
  writePlanTicket(paths, id, ticket);
  // A version made after a talk about the plan says so in the conversation, with what changed (T-98); one that
  // skipped the opening conversation wasn't made from it (T-111).
  if (!opts.skipOpening) versionTurn(paths, analysis, name);
  mutate(paths, now, (_l, emit) => {
    emit({ type: 'task.updated', task: id, actor: opts.actor ?? 'human', by: opts.by ?? `analyst:${id}`, data: { analyzed: { verdict: analysis.verdict, questions: analysis.questions.length, version: analysis.version, decisions: analysis.decisions?.length ?? 0 } } });
  });
  steps.done('save');
  return analysis;
}

/** A person's answer to one of the analysis's questions. When the last is answered, it's ready. */
export function answerAnalysis(paths: RepoPaths, id: string, question: string, text: string, by: string, now: () => Date): Analysis {
  const a = readAnalysis(paths, id);
  if (!a) throw new AccError('no-analysis', `${id} hasn't been analyzed yet: acc analyze ${id}.`);
  const q = a.questions.find((x) => x.id === question.toLowerCase() || x.id === `q${question}`);
  if (!q) throw new AccError('usage', `${id}'s analysis has no question ${question}. It has: ${a.questions.map((x) => x.id).join(', ') || 'none'}.`);
  if (!text.trim()) throw new AccError('usage', 'Give an answer.');
  q.answer = { text: text.trim(), by, at: now().toISOString() };
  if (a.verdict === 'questions' && !openQuestions(a).length) a.verdict = 'ready';
  // An answer changes an approved plan, so it's approved again (T-97).
  lapse(a);
  writeAnalysis(paths, a);
  mutate(paths, now, (_l, emit) => {
    emit({ type: 'task.updated', task: id, actor: 'human', by, data: { answered: { question: q.id } } });
  });
  return a;
}

/**
 * The plan for the builder's instructions: the version, the choices a person made, what to build, what was
 * found, and what a person decided. The choices are the person's: a builder that needs another stops and
 * asks (T-97).
 */
export function analysisSection(a: Analysis | null): string[] {
  if (!a) return [];
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`);
  return [
    ...approvedPlanLines(a),
    `An analyst read the ticket${a.orgs.length ? `, the code and the orgs (${a.orgs.join(', ')})` : ' and the code'} before you. Build from this, and check what it says as you go: if something here turns out to be wrong, say so in your final message.`,
    ...(readWords(a.ticket) ? ['', readWords(a.ticket)!] : []),
    '',
    a.summary,
    '',
    ...(a.requirements.criteria.length ? ['**Acceptance criteria**', '', ...bullets(a.requirements.criteria), ''] : []),
    ...(a.questions.length ? ['**Decided by a person**', '', ...a.questions.map((q) => `- ${q.question} ${q.answer ? `**${q.answer.text}**` : `Nobody answered; assume: ${q.suggested}`}`), ''] : []),
    ...(a.requirements.assumptions.length ? ['**Assumptions**', '', ...bullets(a.requirements.assumptions), ''] : []),
    ...(a.requirements.outOfScope.length ? ['**Out of scope**', '', ...bullets(a.requirements.outOfScope), ''] : []),
    ...(a.findings.length ? ['**What is there now**', '', ...a.findings.map((f) => `- ${f.area}: ${f.detail}${f.source ? ` (${f.source})` : ''}`), ''] : []),
    ...(a.approach.plan.length ? ['**The approach**', '', ...a.approach.plan.map((s, i) => `${i + 1}. ${s}`), ''] : []),
    ...(a.approach.refactors.length ? ['**Refactors first**', '', ...a.approach.refactors.map((r) => `- ${r.what}: ${r.why}`), ''] : []),
    ...(a.approach.files.length ? ['**Files**', '', ...a.approach.files.map((f) => `- ${f.change} \`${f.path}\`: ${f.why}`), ''] : []),
    ...(a.approach.risks.length ? ['**Risks**', '', ...bullets(a.approach.risks), ''] : []),
    ...(a.approach.tests.length ? ['**Tests**', '', ...bullets(a.approach.tests), ''] : []),
  ];
}
