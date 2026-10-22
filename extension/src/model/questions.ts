/**
 * Agents' questions: permission prompts and AskUserQuestion, answered on the page.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { Answer } from '../../../packages/core/src/questions.ts';
import { OPTIONS_MAX } from '../../../packages/core/src/talk-questions.ts';
import { isUnder } from '../logic/shared.ts';
import { type HubLike, type ModelArea, sessionKey, short } from './shared.ts';

// ---------------------------------------------------------------- agents' questions (D-030)

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionCard {
  id: string;
  /** permission: allow or deny a tool. question: pick from the options it gives (AskUserQuestion). */
  kind: 'permission' | 'question';
  /** Who's asking: the task, else the session's name. */
  who: string;
  task: string | null;
  project: string | null;
  projectName: string | null;
  session: string;
  sessionId: string;
  askedAt: number;
  icon: string;
  /** What it wants, after its name: "wants to run a command". */
  title: string;
  /** The command, path or address it's about, shown as code. */
  code: string | null;
  detail: string | null;
  /** Set when Claude Code offered a rule to stop asking: allowing with it lasts this session. */
  always: string | null;
  /** Every answer Claude Code's own prompt would offer, in its order (D-038). Empty for a question with options. */
  choices: QuestionChoice[];
  questions: { question: string; header: string; multiSelect: boolean; options: QuestionOption[] }[];
}

/** One answer to a permission prompt, as a numbered choice on the card. */
export interface QuestionChoice {
  key: string;
  label: string;
  hint: string | null;
  icon: string;
  /** What's sent. A reason or an edited command, when the choice needs one, comes from the card. */
  answer: { decision: 'allow' | 'deny'; always?: boolean; scope?: 'session' | 'project'; mode?: 'auto' | 'acceptEdits' | 'default'; stop?: boolean };
  /** It needs words first: why not, what to plan instead, or the command as it should run. */
  needs?: 'reason' | 'feedback' | 'command';
  primary?: boolean;
}

/** What "always allow" would allow, in a few words, from the first rule Claude Code offered. */
export function alwaysWhat(suggestions: unknown[]): string | null {
  const s = suggestions[0] as { type?: string; rules?: { toolName?: string; ruleContent?: string }[]; mode?: string; directories?: string[] } | undefined;
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'setMode' && s.mode === 'acceptEdits') return 'all edits';
  if (s.type === 'addDirectories') return `access to ${(s.directories?.[0] ?? 'this folder').split('/').pop()}`;
  if (s.type === 'addRules' && s.rules?.[0]?.toolName) {
    const r = s.rules[0];
    const what = r.ruleContent ? (r.ruleContent.length > 48 ? `${r.ruleContent.slice(0, 48)}…` : r.ruleContent) : r.toolName;
    return `\`${what}\``;
  }
  return 'this';
}

/** The choices for a permission prompt, as Claude Code's own prompt lists them, plus what the page adds. */
export function choicesFor(tool: string, suggestions: unknown[]): QuestionChoice[] {
  if (tool === 'AskUserQuestion') return [];
  const stop: QuestionChoice = { key: 'stop', label: 'No, and stop it', hint: 'Its turn ends here and it waits for you, as Esc does in its own prompt', icon: 'debug-stop', answer: { decision: 'deny', stop: true } };
  if (tool === 'ExitPlanMode') {
    return [
      { key: 'accept-edits', label: 'Yes, and auto-accept edits', hint: 'It starts on the plan, editing without asking each time', icon: 'check-all', answer: { decision: 'allow', mode: 'acceptEdits' }, primary: true },
      { key: 'manual-edits', label: 'Yes, and approve each edit', hint: 'It starts on the plan, and asks before each edit', icon: 'check', answer: { decision: 'allow', mode: 'default' } },
      { key: 'keep-planning', label: 'No, keep planning…', hint: 'Say what to change in the plan', icon: 'edit', answer: { decision: 'deny' }, needs: 'feedback' },
      stop,
    ];
  }
  const what = alwaysWhat(suggestions);
  return [
    { key: 'allow', label: 'Yes', hint: null, icon: 'check', answer: { decision: 'allow' }, primary: true },
    ...(what ? [
      { key: 'always-session', label: `Yes, and always allow ${what} in this session`, hint: 'It won\'t ask again for this until the session ends', icon: 'check-all', answer: { decision: 'allow' as const, always: true, scope: 'session' as const } },
      { key: 'always-project', label: `Yes, and always allow ${what} in this project`, hint: 'Saved to the project\'s Claude Code settings (.claude/settings.local.json), for every session', icon: 'repo', answer: { decision: 'allow' as const, always: true, scope: 'project' as const } },
    ] : []),
    { key: 'auto', label: 'Yes, and switch to auto mode', hint: 'For the rest of this session, Claude Code decides the safe ones itself and asks only about the rest', icon: 'sparkle', answer: { decision: 'allow', mode: 'auto' } },
    ...(tool === 'Bash' ? [{ key: 'edit', label: 'Edit the command, then allow…', hint: 'The agent is told to run your version, and it\'s allowed when it does', icon: 'edit', answer: { decision: 'allow' as const }, needs: 'command' as const }] : []),
    { key: 'deny', label: 'No, and tell it what to do instead…', hint: 'It reads your words and carries on', icon: 'close', answer: { decision: 'deny' }, needs: 'reason' },
    stop,
  ];
}

const text = (v: unknown, max = 4000): string | null => (typeof v === 'string' && v.trim() ? (v.length > max ? `${v.slice(0, max)}…` : v) : null);

/** A permission prompt in words: what the tool would do, and the command, file or address. */
export function describePermission(tool: string, input: Record<string, unknown>, cwd: string): { icon: string; title: string; code: string | null; detail: string | null } {
  const path = (p: unknown) => {
    const s = text(p, 1000);
    return s && s.startsWith(`${cwd}/`) ? s.slice(cwd.length + 1) : s;
  };
  switch (tool) {
    case 'Bash': return { icon: 'terminal', title: 'wants to run a command', code: text(input.command), detail: text(input.description, 300) };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { icon: 'edit', title: 'wants to edit a file', code: path(input.file_path ?? input.notebook_path), detail: null };
    case 'Write': return { icon: 'new-file', title: 'wants to write a file', code: path(input.file_path), detail: null };
    case 'Read': return { icon: 'file', title: 'wants to read a file', code: path(input.file_path), detail: null };
    case 'Grep': case 'Glob': return { icon: 'search', title: 'wants to search files', code: text(input.pattern), detail: text(input.path) ? `in ${path(input.path)}` : null };
    case 'WebFetch': return { icon: 'globe', title: 'wants to open a web page', code: text(input.url), detail: text(input.prompt, 300) };
    case 'WebSearch': return { icon: 'search', title: 'wants to search the web', code: text(input.query), detail: null };
    case 'ExitPlanMode': return { icon: 'list-ordered', title: 'has a plan for you to approve', code: null, detail: text(input.plan) };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
      const json = JSON.stringify(input, null, 2);
      return { icon: mcp ? 'plug' : 'tools', title: mcp ? `wants to use ${mcp[1]!.replace(/_/g, ' ')}: ${mcp[2]!.replace(/_/g, ' ')}` : `wants to use ${tool}`, code: json && json !== '{}' ? text(json, 1500) : null, detail: null };
    }
  }
}

/** The words for "allow, and don't ask again", from the first rule Claude Code offered. */
export function alwaysLabel(suggestions: unknown[]): string | null {
  const s = suggestions[0] as { type?: string; rules?: { toolName?: string; ruleContent?: string }[]; mode?: string; directories?: string[] } | undefined;
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'setMode' && s.mode === 'acceptEdits') return 'Allow all edits this session';
  if (s.type === 'addDirectories') return 'Allow this folder this session';
  if (s.type === 'addRules' && s.rules?.[0]?.toolName) {
    const r = s.rules[0];
    return r.ruleContent ? `Always allow ${r.ruleContent.length > 40 ? `${r.ruleContent.slice(0, 40)}…` : r.ruleContent} this session` : `Always allow ${r.toolName} this session`;
  }
  return 'Allow, and don\'t ask again this session';
}

/** The most options a question that ticks several lists (D-205): a single choice lists at most OPTIONS_MAX, and the person writes their own. */
export const MULTI_OPTIONS_MAX = 8;

export function questionsOf(input: Record<string, unknown>): QuestionCard['questions'] {
  const qs = Array.isArray(input.questions) ? input.questions : [];
  return qs.slice(0, 6).flatMap((q: any) => {
    const question = text(q?.question, 1000);
    if (!question) return [];
    const multiSelect = q.multiSelect === true;
    const options = (Array.isArray(q.options) ? q.options : []).flatMap((o: any) => (text(o?.label, 200) ? [{ label: o.label as string, description: text(o.description, 500) ?? '' }] : [])).slice(0, multiSelect ? MULTI_OPTIONS_MAX : OPTIONS_MAX);
    return [{ question, header: text(q.header, 40) ?? '', multiSelect, options }];
  });
}

/** Each waiting question, with who's asking: the task its agent works on, else the session. */
export function questionCards(hub: HubLike): QuestionCard[] {
  return (hub.questions ?? []).map((q): QuestionCard => {
    const session = hub.agents.find((s) => s.sessionId === q.sessionId);
    const project = hub.projectFor(q.cwd) ?? null;
    const row = project ? hub.taskRows(project.root).find((r) => r.run?.sessionId === q.sessionId || (!!session?.id && r.run?.bgId === session.id) || (!!r.run?.worktree && isUnder(q.cwd, r.run.worktree))) : undefined;
    const ask = q.tool === 'AskUserQuestion';
    const d = ask ? { icon: 'comment-discussion', title: 'has a question for you', code: null, detail: null } : describePermission(q.tool, q.input, q.cwd);
    return {
      id: q.id, kind: ask ? 'question' : 'permission', who: row?.id ?? session?.name ?? 'An agent', task: row?.id ?? null,
      project: project?.root ?? null, projectName: project?.name ?? null, session: session ? sessionKey(session) : q.sessionId, sessionId: q.sessionId, askedAt: q.at,
      ...d, always: ask ? null : alwaysLabel(q.suggestions), choices: choicesFor(q.tool, q.suggestions), questions: ask ? questionsOf(q.input) : [],
    };
  });
}

/** The page's answer as the hook reads it, with only the fields its decision has. */
export function answerOf(m: Extract<Message, { type: 'answer' }>): Answer {
  if (m.decision === 'allow') {
    return {
      decision: 'allow', ...(m.always ? { always: true, scope: m.scope === 'project' ? 'project' : 'session' } : {}), ...(m.mode ? { mode: m.mode } : {}),
      ...(m.command?.trim() ? { command: m.command.trim() } : {}), ...(m.answers ? { answers: m.answers } : {}),
    };
  }
  if (m.decision === 'deny') return { decision: 'deny', ...(m.message?.trim() ? { message: m.message.trim() } : {}), ...(m.stop ? { stop: true } : {}) };
  return { decision: 'terminal' };
}

export type Message =
  /** An answer to an agent's question or permission prompt (D-030). */
  | { type: 'answer'; id: string; decision: 'allow' | 'deny' | 'terminal'; always?: boolean; scope?: 'session' | 'project'; mode?: 'auto' | 'acceptEdits' | 'default'; command?: string; stop?: boolean; message?: string; answers?: Record<string, string> };

export const area: ModelArea = {
  messages: {
    answer: (x) => {
      if (!short(x.id, 64) || !['allow', 'deny', 'terminal'].includes(x.decision as string)) return false;
      if (x.always !== undefined && typeof x.always !== 'boolean') return false;
      if (x.stop !== undefined && typeof x.stop !== 'boolean') return false;
      if (x.scope !== undefined && x.scope !== 'session' && x.scope !== 'project') return false;
      if (x.mode !== undefined && !['auto', 'acceptEdits', 'default'].includes(x.mode as string)) return false;
      if (x.command !== undefined && !(typeof x.command === 'string' && x.command.length <= 20_000)) return false;
      if (x.message !== undefined && !(typeof x.message === 'string' && x.message.length <= 4000)) return false;
      if (x.answers === undefined) return true;
      const a = x.answers as Record<string, unknown>;
      return !!a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length <= 8 && Object.values(a).every((v) => typeof v === 'string' && v.length <= 4000);
    },
  },
};
