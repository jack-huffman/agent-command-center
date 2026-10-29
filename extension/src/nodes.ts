/**
 * What the commands act on: a task, an agent session, a worktree or an environment, with its project.
 * The Command Center page turns its rows back into these (extension.ts), so every command has one shape.
 */
import type { Environment } from '../../packages/core/src/config.ts';
import type { Project, WorktreeInfo } from './hub.ts';
import type { AgentSession, TaskGroup, TaskRow } from './logic/shared.ts';
import type { SayRan } from './logic/ran.ts';

export type TaskNode =
  | { kind: 'project'; project: Project }
  | { kind: 'group'; project: Project; group: TaskGroup; tasks: TaskRow[] }
  // part: the part of its page a link names (T-134), such as its plan, which its page opens on.
  // say: from a page's button, how far the action has got, for the button's working state (T-147).
  | { kind: 'task'; project: Project; task: TaskRow; part?: string; say?: SayRan };

export type AgentNode =
  | { kind: 'place'; label: string; root: string | null; sessions: AgentSession[] }
  | { kind: 'agent'; session: AgentSession; project: Project | undefined };

export type WorktreeNode = { kind: 'project'; project: Project } | { kind: 'worktree'; project: Project; worktree: WorktreeInfo };

export type EnvNode = { kind: 'project'; project: Project } | { kind: 'env'; project: Project; env: Environment };
