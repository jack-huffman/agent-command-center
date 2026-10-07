import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentArgs } from './agents.ts';
import { type AwakeDeps, holdAwake } from './awake.ts';
import { sessionName } from './names.ts';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { AccError, type RunResult, type Runner, sfEnv } from './exec.ts';
import { type Actor, mutate, readLedger, type Task } from './ledger.ts';
import { alive } from './lock.ts';
import type { RepoPaths } from './paths.ts';

/**
 * The analysis (D-052): before a task is built, a read-only agent works out what it asks for, what's
 * already there (the code, and on Salesforce the org), and how to build it: the requirements, the
 * questions a person should answer, what it found, the approach and the refactors it needs, the risks
 * and the tests. A person answers the questions; the builder is given all of it.
 */

export interface AnalysisQuestion {
  id: string;
  question: string;
  /** What changes depending on the answer. */
  why: string;
  /** What the analyst would assume if nobody answers. */
  suggested: string;
  answer?: { text: string; by: string; at: string };
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
  /** The orgs it read, by alias. */
  orgs: string[];
  sessionId: string;
  /** What the analyst was called (D-???). Older analyses have none. */
  name?: string;
  at: string;
  durationMs: number;
  costUsd: number | null;
}

const strings = { type: 'array', items: { type: 'string' } } as const;

/** What the analyst must answer with: Claude Code checks it against this (`--json-schema`). */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'requirements', 'questions', 'findings', 'approach', 'split'],
  properties: {
    verdict: { type: 'string', enum: ['ready', 'questions', 'split'], description: 'questions when a person must answer something before it can be built well; split when it is too big for one task' },
    summary: { type: 'string', description: 'Two or three plain sentences: what the task needs, what is already there, and how to build it' },
    requirements: {
      type: 'object', additionalProperties: false, required: ['goal', 'criteria', 'assumptions', 'outOfScope'],
      properties: {
        goal: { type: 'string', description: 'What the person asking wants, in a sentence' },
        criteria: { ...strings, description: 'Acceptance criteria, each one testable' },
        assumptions: { ...strings, description: 'What you assumed that the ticket does not say' },
        outOfScope: { ...strings, description: 'What this task should not do' },
      },
    },
    questions: {
      type: 'array',
      description: 'Only what a person must decide, and nothing you could find out yourself',
      items: {
        type: 'object', additionalProperties: false, required: ['question', 'why', 'suggested'],
        properties: { question: { type: 'string' }, why: { type: 'string', description: 'What changes depending on the answer' }, suggested: { type: 'string', description: 'What you would assume if nobody answers' } },
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
        size: { type: 'string', enum: ['S', 'M', 'L', 'XL'], description: 'S: an hour or two. M: a day. L: a few days. XL: split it' },
      },
    },
    split: { ...strings, description: 'When the verdict is split: the smaller tasks, one line each. Otherwise empty' },
  },
} as const;

export const analysisPath = (paths: RepoPaths, task: string): string => join(paths.analyses, `${task}.json`);
const runningPath = (paths: RepoPaths, task: string): string => join(paths.analyses, `${task}.running.json`);

export function readAnalysis(paths: RepoPaths, task: string): Analysis | null {
  try {
    const a = JSON.parse(readFileSync(analysisPath(paths, task), 'utf8')) as Analysis;
    return a.v === 1 && a.task === task ? a : null;
  } catch {
    return null;
  }
}

function writeAnalysis(paths: RepoPaths, a: Analysis): void {
  mkdirSync(paths.analyses, { recursive: true });
  const file = analysisPath(paths, a.task);
  writeFileSync(`${file}.tmp`, JSON.stringify(a, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
}

/** Questions nobody has answered yet. */
export const openQuestions = (a: Analysis | null): AnalysisQuestion[] => (a?.questions ?? []).filter((q) => !q.answer);

export interface Analyzing {
  sessionId: string;
  /** What the analyst is called (D-???). An analysis started before names has none. */
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
  const open = openQuestions(a);
  if (open.length) return [`${open.length} question${open.length === 1 ? '' : 's'} from ${task.id}'s analysis ${open.length === 1 ? 'is' : 'are'} unanswered: ${open.map((q) => `${q.id}. ${q.question}`).join(' ')} Answer with acc analysis answer ${task.id} <q> "<answer>".`];
  return [];
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
}

export function analysisPrompt(i: AnalysisInput): { system: string; prompt: string } {
  const sf = i.config.profile === 'salesforce';
  const system = [
    `You are the analyst for ${i.task.id}. Before anyone builds it, you work out what it asks for, what is already there, and how it should be built. A builder agent is given your analysis; a person answers your questions first.`,
    `You can read the repo at ${i.root} (Read, Grep, Glob, and git log, show, diff and grep)${sf ? ', and read the Salesforce orgs listed below with the sf CLI' : ''}. You can't change anything: no edits, no writes, no deploys.`,
    'Work like a careful senior consultant on a new ticket:',
    '- Read the ticket. Restate the goal. Turn what it asks for into testable acceptance criteria. Name your assumptions and what is out of scope.',
    `- Investigate before you decide: find the code${sf ? ' and the org configuration' : ''} this touches, what depends on it, and how it behaves today. Every finding names its source.`,
    '- Decide the approach: the steps, the files, any refactor the task needs first and why, the risks, and the tests that prove it.',
    '- Ask only what a person must decide: business rules, priorities, trade-offs. Never ask what you could find out yourself. Give each question your suggested answer.',
    '- If it is too big for one task (more than a few days), say split and list the smaller tasks.',
    ...(sf ? ['', 'For a Salesforce project, also cover:', ...SALESFORCE_FOCUS.map((f) => `- ${f}`), '', ...SALESFORCE_COOKBOOK] : []),
    '',
    'Be concrete and brief: names, files, numbers. No filler.',
  ].join('\n');
  const prompt = [
    `# Analyze ${i.task.id}: ${i.task.title}`,
    '',
    `For the ${i.env.name} environment (branch \`${i.env.branch}\`).${i.checkedOut ? ` The repo is checked out on \`${i.checkedOut}\`: read the environment's files with git show ${i.env.branch}:<path>.` : ''}`,
    i.task.source.url ? `Ticket: ${i.task.source.url}` : `Source: ${i.task.source.kind}`,
    '',
    '## The ticket',
    '',
    i.task.brief.trim() || '_Only the title was given._',
    '',
    ...(sf && i.orgs.length ? ['## The orgs you may read', '', ...i.orgs.map((o) => `- \`${o.alias}\`: ${o.name} (${o.type})`), ''] : []),
    ...(i.previous?.questions.some((q) => q.answer) ? [
      '## What a person already answered',
      '',
      ...i.previous.questions.filter((q) => q.answer).map((q) => `- ${q.question} **${q.answer!.text}**`),
      '',
      'Don\'t ask these again.',
      '',
    ] : []),
    ...(i.rules?.trim() ? ['## The project\'s rules', '', i.rules.trim(), ''] : []),
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
    .map((q: any, n: number) => ({ id: `q${n + 1}`, question: q.question, why: String(q.why ?? ''), suggested: String(q.suggested ?? '') }));
  const analysis = {
    // A ready verdict with questions waiting isn't ready.
    verdict: (s.verdict === 'ready' && questions.length ? 'questions' : s.verdict) as Analysis['verdict'],
    summary: s.summary,
    requirements: { goal: String(req.goal ?? ''), criteria: list(req.criteria), assumptions: list(req.assumptions), outOfScope: list(req.outOfScope) },
    questions,
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
  };
  return { analysis, sessionId: typeof r.session_id === 'string' ? r.session_id : null, costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null };
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
}

const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });

/** A scratch Salesforce project for retrieves, so nothing the analyst fetches lands in the repo. */
function scratchProject(paths: RepoPaths, id: string): string {
  const dir = join(paths.analyses, `${id}.work`);
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

export function analyze(paths: RepoPaths, config: Config, id: string, deps: AnalyzeDeps, opts: { actor?: Actor; by?: string } = {}): Analysis {
  const { run, now } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (task.state === 'done') throw new AccError('refused', `${id} is done. There's nothing left to analyze.`);
  if (task.state === 'running') throw new AccError('refused', `${id} is being built. Analyze before dispatch, or after it's abandoned.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError('analyze', `${id}'s environment "${task.environment}" isn't in the config.`);
  const sf = config.profile === 'salesforce';
  const base = git(run, paths.root, 'rev-parse', '--verify', '--quiet', env.branch).stdout.trim() || git(run, paths.root, 'rev-parse', 'HEAD').stdout.trim();
  const current = git(run, paths.root, 'branch', '--show-current').stdout.trim();
  const orgs = sf ? config.environments.filter((e) => e.org).map((e) => ({ alias: e.org!, name: e.name, type: e.type })) : [];
  const rulesFile = join(paths.root, '.acc', 'rules.md');
  const previous = readAnalysis(paths, id);
  const { system, prompt } = analysisPrompt({ task, config, env, root: paths.root, checkedOut: current && current !== env.branch ? current : null, orgs, rules: existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8') : null, previous });

  const allowed = [...ANALYST_COMMANDS.any, ...(sf ? ANALYST_COMMANDS.salesforce : [])].map((c) => `Bash(${c}:*)`);
  // Belt and braces: the hook refuses anything but those reads, even if a pattern lets more through.
  const settings = deps.accCommand ? { hooks: { PreToolUse: [{ matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: `${deps.accCommand} hook pre-tool-use` }] }] } } : null;
  const cwd = sf ? scratchProject(paths, id) : paths.root;

  const sessionId = (deps.uuid ?? randomUUID)();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: 'analysis' });
  mkdirSync(paths.analyses, { recursive: true });
  const marker = runningPath(paths, id);
  const startedAt = now();
  writeFileSync(marker, JSON.stringify({ sessionId, name, startedAt: startedAt.toISOString(), pid: process.pid } satisfies Analyzing));
  deps.onStart?.(sessionId, name);
  // The analyst is a child of this acc, so the Mac stays awake while acc lives (D-067).
  const awake = holdAwake(process.pid, deps.awake);
  let out: RunResult;
  try {
    out = run('claude', [
      '-p', '--session-id', sessionId, '--name', name, '--permission-mode', 'dontAsk', ...agentArgs(config.agents.reviewer),
      '--output-format', 'json', '--json-schema', JSON.stringify(ANALYSIS_SCHEMA), '--append-system-prompt', system,
      ...(cwd !== paths.root ? ['--add-dir', paths.root] : []),
      ...(settings ? ['--settings', JSON.stringify(settings)] : []),
      '--allowedTools', 'Read', 'Grep', 'Glob', ...allowed,
      '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch',
    ], { cwd, input: prompt, env: { ...(sf ? sfEnv(deps.env) : deps.env), ACC_ROLE: 'analyst', ACC_TASK: id }, timeoutMs: 45 * 60_000 });
  } finally {
    awake?.release();
    rmSync(marker, { force: true });
  }
  if (out.timedOut) throw new AccError('analyze', `The analysis didn't finish within 45 minutes, so acc stopped it.`);
  if (out.code === 127 && !out.stdout) throw new AccError('analyze', `Claude Code didn't start: ${out.stderr.trim().split('\n')[0] ?? 'claude not found'}`);
  const parsed = parseAnalysis(out.stdout);
  const finished = now();
  // Answers to questions it asks again carry over, so nobody answers twice.
  const answered = new Map((previous?.questions ?? []).filter((q) => q.answer).map((q) => [q.question.trim().toLowerCase(), q.answer!]));
  const questions = parsed.analysis.questions.map((q) => (answered.has(q.question.trim().toLowerCase()) ? { ...q, answer: answered.get(q.question.trim().toLowerCase())! } : q));
  const analysis: Analysis = {
    v: 1, task: id, env: env.branch, base, ...parsed.analysis, questions,
    verdict: parsed.analysis.verdict === 'questions' && !questions.some((q) => !q.answer) ? 'ready' : parsed.analysis.verdict,
    orgs: orgs.map((o) => o.alias), sessionId: parsed.sessionId ?? sessionId, name,
    at: finished.toISOString(), durationMs: finished.getTime() - startedAt.getTime(), costUsd: parsed.costUsd,
  };
  writeAnalysis(paths, analysis);
  mutate(paths, now, (_l, emit) => {
    emit({ type: 'task.updated', task: id, actor: opts.actor ?? 'human', by: opts.by ?? `analyst:${id}`, data: { analyzed: { verdict: analysis.verdict, questions: analysis.questions.length } } });
  });
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
  writeAnalysis(paths, a);
  mutate(paths, now, (_l, emit) => {
    emit({ type: 'task.updated', task: id, actor: 'human', by, data: { answered: { question: q.id } } });
  });
  return a;
}

/** The analysis for the builder's instructions: what to build, what was found, and what a person decided. */
export function analysisSection(a: Analysis | null): string[] {
  if (!a) return [];
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`);
  return [
    '## What the analysis found',
    '',
    `An analyst read the ticket${a.orgs.length ? `, the code and the orgs (${a.orgs.join(', ')})` : ' and the code'} before you. Build from this, and check what it says as you go: if something here turns out to be wrong, say so in your final message.`,
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
