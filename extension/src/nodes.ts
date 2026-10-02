/**
 * What the commands act on: a task, an agent session, a worktree or an environment, with its project.
 * The Command Center page turns its rows back into these (extension.ts), so every command has one shape.
 */
import type { Environment } from '../../packages/core/src/config.ts';
import type { Project, WorktreeInfo } from './hub.ts';
import type { AgentSession, TaskGroup, TaskRow } from './logic.ts';

export type TaskNode =
  | { kind: 'project'; project: Project }
  | { kind: 'group'; project: Project; group: TaskGroup; tasks: TaskRow[] }
  | { kind: 'task'; project: Project; task: TaskRow };

export type AgentNode =
  | { kind: 'place'; label: string; root: string | null; sessions: AgentSession[] }
  | { kind: 'agent'; session: AgentSession; project: Project | undefined };

export type WorktreeNode = { kind: 'project'; project: Project } | { kind: 'worktree'; project: Project; worktree: WorktreeInfo };

export type EnvNode = { kind: 'project'; project: Project } | { kind: 'env'; project: Project; env: Environment };
