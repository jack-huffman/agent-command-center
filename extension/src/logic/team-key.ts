// What a task's team was read from (T-162), so a task page reads it again only when that changed: a task many
// merges behind takes seconds of git to read. No vscode import, so it's testable.

import type { Runner } from '../../../packages/core/src/exec.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { IN_FLIGHT_STATES } from '../../../packages/core/src/overlap.ts';

/**
 * Every branch's head, and each task in flight with its state and branch. Null when git can't list the
 * branches, and the team is read afresh.
 */
export function teamKey(run: Runner, root: string, tasks: readonly Pick<Task, 'id' | 'state' | 'run'>[]): string | null {
  const heads = run('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'], { cwd: root });
  if (heads.code !== 0) return null;
  const flying = tasks.filter((t) => IN_FLIGHT_STATES.includes(t.state)).map((t) => `${t.id}:${t.state}:${t.run?.branch ?? ''}`);
  return `${heads.stdout}\n${flying.join(',')}`;
}
