/**
 * Join a team project in the Command Center (T-176): Setup in a joined clone, Share how to join in Settings, and
 * the commands the page may ask for. Plain data, no vscode import, so it's testable.
 */

import { JOIN_COMMAND, JOIN_TITLE, OWN_STEPS, TEAM_STEPS_TITLE } from '../../../packages/core/src/join.ts';
import type { CommandSpec } from './report.ts';
import type { SetupRow, SetupSection } from './setup.ts';
import type { Action, ModelArea } from './shared.ts';

/** Share how to join: copies the repo's address and three steps, for a teammate. Off for a project with no GitHub repo. */
export const SHARE_JOIN_COMMAND: CommandSpec<{ repo: string | null }> = {
  id: 'acc.join.share',
  params: 'The project\'s folder. It copies the repo\'s address and three steps, naming no person and holding no secret.',
  enabled: ({ repo }) => (repo ? { ok: true } : { ok: false, why: 'The project\'s settings name no GitHub repo, so there\'s no address to share.' }),
};

/** Setup's Join a team project button, where no project is open or the folder isn't set up. */
export const JOIN_ACTION: Action = { command: JOIN_COMMAND.id, label: `${JOIN_TITLE}…`, icon: 'repo-clone', ref: {} };

/** The project's own steps in a joined clone, done by whoever set it up: shown folded, never in the walk. */
export interface SetupTeam {
  title: string;
  rows: SetupRow[];
}

/** One part of Setup, as setupModel draws it. */
export interface JoinablePart {
  part: 'machine' | 'project';
  jump: string;
  label: string;
  todo: number;
  steps: SetupRow[];
  sections: SetupSection[];
}

/**
 * Setup in a joined clone (T-176): This project becomes "Join <project>" and holds only the steps that are each
 * person's own (OWN_STEPS), the plugin among them, in the order they're done. The project's other steps were done
 * by whoever set it up: they fold under "Set up by your team", and the walk leaves them out.
 */
export function joinedParts(parts: JoinablePart[], project: string, sectionsOf: (rows: SetupRow[]) => SetupSection[]): { parts: JoinablePart[]; team: SetupTeam } {
  const own = (r: SetupRow) => OWN_STEPS.includes(r.id);
  const rows = parts.flatMap((p) => p.steps);
  const mine = OWN_STEPS.map((id) => rows.find((r) => r.id === id)).filter((r): r is SetupRow => !!r);
  const machine = parts.filter((p) => p.part === 'machine').map((p) => {
    const steps = p.steps.filter((s) => !own(s));
    return { ...p, steps, todo: steps.filter((s) => !s.done).length, sections: sectionsOf(steps) };
  }).filter((p) => p.steps.length);
  const projectPart = parts.find((p) => p.part === 'project');
  const join: JoinablePart = {
    part: 'project', jump: projectPart?.jump ?? 'setup:project', label: `Join ${project}`,
    todo: mine.filter((s) => !s.done).length, steps: mine, sections: sectionsOf(mine),
  };
  const team = (projectPart?.steps ?? []).filter((s) => !own(s));
  return { parts: [...machine, join], team: { title: TEAM_STEPS_TITLE, rows: team } };
}

export const area: ModelArea = {
  commands: [JOIN_COMMAND.id, SHARE_JOIN_COMMAND.id],
};
