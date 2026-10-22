/**
 * Each tracker's words in one normal form (T-90), so the Command Center draws every tracker's tickets alike:
 * a person's name that reads as a name, and a type's kind. Each client maps its own priorities.
 */
import type { TypeKind } from './types.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** An address's local part and domain split by a space, as some Azure DevOps display names are: "jordan acme.example". */
const SPLIT_EMAIL = /^([^\s@]+) ([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})$/i;

/** Whether a string is an email address. */
export const isEmail = (s: string | null | undefined): s is string => !!s && EMAIL.test(s.trim());

const localPart = (email: string): string => email.trim().split('@')[0]!;

/**
 * A person's name as a person reads it, from a tracker's display name and its unique name (T-90). A display
 * name that is an email, or an email's local part and domain split by a space, gives way to the unique name's
 * local part: "jordan acme.example" with jordan@acme.example is "jordan". No display name: the unique name,
 * or its local part when it's an email. Null when there's neither.
 */
export function personName(display: string | null | undefined, unique: string | null | undefined): string | null {
  const d = (display ?? '').trim();
  const u = (unique ?? '').trim();
  const fromUnique = u ? (isEmail(u) ? localPart(u) : u) : null;
  if (!d) return fromUnique;
  if (isEmail(d)) return isEmail(u) ? localPart(u) : localPart(d);
  const split = SPLIT_EMAIL.exec(d);
  if (split && (!isEmail(u) || `${split[1]}@${split[2]}`.toLowerCase() === u.toLowerCase())) return isEmail(u) ? localPart(u) : split[1]!;
  return d;
}

/**
 * Each tracker's type names, by their kind (T-90), lower case: Azure DevOps' process templates (Agile, Scrum,
 * CMMI, Basic), Jira's standard issue types, and GitHub's issue types.
 */
export const TYPE_KIND: Record<string, TypeKind> = {
  bug: 'bug', defect: 'bug',
  'user story': 'story', story: 'story', 'product backlog item': 'story', requirement: 'story',
  task: 'task',
  'sub-task': 'subtask', subtask: 'subtask',
  feature: 'feature', 'new feature': 'feature', improvement: 'feature', enhancement: 'feature',
  epic: 'epic',
  'test case': 'test', test: 'test',
  issue: 'issue', impediment: 'issue',
};

/**
 * A type's kind (T-90): from the table, else a sub-task when the tracker says it is one, else 'other'. Null
 * when there's no type.
 */
export function typeKindOf(name: string | null | undefined, subtask = false): TypeKind | null {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return null;
  return TYPE_KIND[n] ?? (subtask ? 'subtask' : 'other');
}

/** A tracker's colour as six hex digits without the # (T-95): "#CC293D" is "CC293D". Null for anything else, or none. */
export function hexOf(c: unknown): string | null {
  const h = typeof c === 'string' ? c.trim().replace(/^#/, '') : '';
  return /^[0-9a-f]{6}$/i.test(h) ? h : null;
}
