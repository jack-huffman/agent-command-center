/**
 * Shared shapes and the shape-first split (T-104). When one task changes a shape other tasks build on, such as
 * a schema, a type, a module others import, a settings key or a file format, those tasks either wait for the
 * whole feature or start on guesses. The plan names each shared shape and, where one is shared, suggests a
 * small first task for just the shape (its tests, nothing drawn) and the rest, which depends on it. A person
 * may ignore the suggestion. "Split into these tasks" (acc plan split) makes the two tasks, and only a person
 * does it. The rest starts once the first merges, and its packet names the shape's decision and files.
 */

import { decisionId, parseDecisionName } from './decisions.ts';

/** What a shared shape is. The analyst picks one. */
export const SHAPE_KINDS = ['schema', 'type', 'module', 'setting', 'file format'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** A shape this task's work changes and other tasks would build on. */
export interface SharedShape {
  name: string;
  kind: ShapeKind;
  /** Why others build on it. */
  why: string;
  /** The files that hold it, as the plan names them. */
  files: string[];
  /** The tasks in flight or ready that would use it, by id. */
  users: string[];
}

/** One of the two tasks a shape-first split makes. */
export interface SplitTask {
  title: string;
  brief: string;
}

/** The suggestion: a first task for the shape and the rest, with why. `made` is set once a person split it. */
export interface ShapeSplit {
  why: string;
  first: SplitTask;
  rest: SplitTask;
  made?: { first: string; rest: string; by: string; at: string };
}

/** What the rest of a split carries: the task that makes the shape, the shapes, and the files that hold them. */
export interface ShapeFrom {
  task: string;
  shapes: string[];
  files: string[];
}

const strings = { type: 'array', items: { type: 'string' } } as const;
const splitTask = { type: 'object', required: ['title', 'brief'], properties: { title: { type: 'string' }, brief: { type: 'string', description: 'What the task does, with its acceptance criteria' } } } as const;

/** The parts of the analyst's answer for shared shapes: Claude Code checks them against this (`--json-schema`). */
export const SHAPE_SCHEMA = {
  sharedShapes: {
    type: 'array',
    description: 'Each shape this work changes that other tasks would build on. Empty when there is none',
    items: {
      type: 'object',
      required: ['name', 'kind', 'why', 'files', 'users'],
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: [...SHAPE_KINDS] },
        why: { type: 'string', description: 'Which tasks build on it, and how' },
        files: { ...strings, description: 'The files that hold the shape' },
        users: { ...strings, description: 'The ids of the tasks in flight or ready that would use it' },
      },
    },
  },
  shapeSplit: {
    type: 'object',
    description: 'Where a shape is shared: a small first task for just the shape, and the rest. Leave every field empty when no shape is shared',
    required: ['why', 'first', 'rest'],
    properties: { why: { type: 'string' }, first: splitTask, rest: splitTask },
  },
} as const;

/** What the analyst is told about shared shapes, in its instructions. */
export const SHAPE_PROMPT = [
  'Shared shapes: look for any shape this work changes that other tasks would build on, such as a schema, a type, a module others import, a settings key or a file format. Use the tasks in flight and ready (listed in the prompt) to see who would use it.',
  '- Name each one in sharedShapes, with the files that hold it and the tasks that would use it.',
  '- Where a shape is shared, suggest a split in shapeSplit: a small first task for just the shape, with its tests and nothing drawn, and a second task for the rest. The second task depends on the first. Say why in one sentence.',
  '- Where no shape is shared, leave sharedShapes empty and every field of shapeSplit empty. Never invent a shared shape.',
].join('\n');

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : []);

/** The shared shapes from the analyst's answer: each needs a name; an unknown kind is read as a module. */
export function parseShapes(v: unknown): SharedShape[] {
  return (Array.isArray(v) ? v : []).filter((s: any) => text(s?.name)).map((s: any) => ({
    name: text(s.name), kind: (SHAPE_KINDS as readonly string[]).includes(s.kind) ? s.kind as ShapeKind : 'module', why: text(s.why), files: list(s.files), users: list(s.users),
  }));
}

/**
 * The suggested split, or undefined. A task with no shared shape suggests none, whatever the analyst wrote, and
 * a suggestion needs a title for each of its two tasks.
 */
export function parseShapeSplit(v: any, shapes: SharedShape[]): ShapeSplit | undefined {
  if (!shapes.length || !text(v?.first?.title) || !text(v?.rest?.title)) return undefined;
  const task = (t: any): SplitTask => ({ title: text(t.title), brief: text(t.brief) });
  return { why: text(v.why), first: task(v.first), rest: task(v.rest) };
}

/** A decision a task's files hold, by its id: D-198 once numbered, D-199 before. */
export function decisionIn(files: string[]): { id: string; file: string } | null {
  for (const file of files) {
    const m = /^docs\/decisions\/([^/]+)$/.exec(file);
    const name = m ? parseDecisionName(m[1]!) : null;
    if (name) return { id: name.number != null ? decisionId(name.number) : `D-${name.task}`, file };
  }
  return null;
}

