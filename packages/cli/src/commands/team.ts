// Builders as a team (T-103): acc team says what the other tasks in flight change and what merged since a
// task's branch left its environment's branch, as of now; acc refresh takes those merges in early, in the
// task's own worktree, and pushes nothing.

import { AccError, behindWords, readLedger, run, takeIn, teamOf, teamSection } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { actorFrom, type CommandArea, now, type Opts, out, project, taskIdFrom } from '../shared.ts';

/** A builder's own task only: the one its session is for. */
function ownTask(arg: string | undefined): string {
  const id = taskIdFrom(arg).toUpperCase();
  const mine = process.env.ACC_ROLE === 'builder' ? process.env.ACC_TASK?.toUpperCase() : undefined;
  if (mine && id !== mine) throw new AccError('refused', `You're the builder for ${mine}: acc refresh takes merges into your own branch only.`);
  return id;
}

function cmdTeam(o: Opts, rest: string[]): number {
  const id = taskIdFrom(rest[0]).toUpperCase();
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  if (!ledger.tasks.some((t) => t.id === id)) throw new AccError('no-task', `No task ${id}.`);
  const team = teamOf(paths, config, ledger, run, id);
  out(o, () => [
    `${id}'s team, as of now. ${tone(behindWords(team), team.landed.length ? 'orange' : 'blue')}.`,
    '',
    ...teamSection(team, 'builder').slice(4),
  ].join('\n').trimEnd(), { ...team, behind: team.landed.length });
  return 0;
}

function cmdRefresh(o: Opts, rest: string[]): number {
  const id = ownTask(rest[0]);
  const { paths, config } = project(process.cwd());
  const who = actorFrom(o);
  // The one in the worktree resolves a conflict there: its builder. A person's run leaves the worktree as it was.
  const r = takeIn(paths, config, id, { run, now, env: process.env }, { ...who, leave: who.actor === 'builder' });
  const failed = r.tests.some((t) => t.status !== 'pass');
  out(o, () => tone(`${r.sha ? (failed ? '!' : '✓') : '·'} ${r.reason}`, failed ? 'orange' : r.sha ? 'blue' : 'dim'), r);
  return failed ? 1 : 0;
}

export const area: CommandArea = {
  help: {
    section: 'Agents',
    order: 44,
    lines: `  acc team [<id>] [--json]               The other tasks in flight, sharing files first, with what each plans and has
                                        changed, and what merged into its environment since its branch left it
  acc refresh [<id>]                    Take in what merged: fetch the environment's branch and merge origin's copy
                                        into the task's branch in its worktree, then run its test checks. A
                                        conflict stops it with the files listed; for a builder the merge is left to
                                        resolve. Nothing is pushed`,
  },
  commands: {
    team: (o, rest) => cmdTeam(o, rest),
    refresh: (o, rest) => cmdRefresh(o, rest),
  },
};
