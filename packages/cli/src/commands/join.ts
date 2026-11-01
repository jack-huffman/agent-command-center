// acc join (T-176): clone a team project from its repo's address, pinned to this person in that clone only.

import { AccError, joinPlan, joinProject, run } from '../../../core/src/index.ts';
import { type CommandArea, noAgent, type Opts, out } from '../shared.ts';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function cmdJoin(o: Opts, url: string | undefined): number {
  // Which account a clone works as, and where it goes, is a person's choice (D-028): never an agent's.
  noAgent(o, 'join a project');
  if (!url) throw new AccError('usage', 'acc join <url> [--dir <path>] [--account <account>]');
  const opts = { address: url, dir: str(o.dir), account: str(o.account), run };
  // --dry-run: what a join would do, writing nothing, for the Command Center to ask about before it clones.
  if (o['dry-run']) {
    const plan = joinPlan(opts);
    out(o, () => [`${plan.address.slug} can be read by ${plan.readers.join(', ')}.`, `  It would go to ${plan.dir}.`].join('\n'), { repo: plan.address.slug, readers: plan.readers, account: plan.account, dir: plan.dir });
    return 0;
  }
  const joined = joinProject(opts);
  out(o, () => [
    `Cloned ${joined.repo} into ${joined.dir}, as ${joined.account}.`,
    `  commits: ${joined.identity.name} <${joined.identity.email}>, in this clone only`,
    `  push:    as ${joined.account}, in this clone only`,
    joined.project ? `  Open the folder, then Setup shows the steps that are yours to do in ${joined.project}.` : '  The repo has no project settings yet: Setup starts it when you open the folder.',
  ].join('\n'), joined);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Setup',
    order: 15,
    lines: `  acc join <url> [--dir <path>] [--account <a>]  Clone a team project, with its account and commit identity set in that clone only
  acc join <url> --dry-run                       Say which accounts can read it and where it would go, writing nothing`,
  },
  options: {
    dir: { type: 'string' },
    account: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  commands: {
    join: (o, rest) => cmdJoin(o, rest[0]),
  },
};
