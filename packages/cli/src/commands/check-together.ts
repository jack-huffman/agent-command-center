// Checking a group of finished tasks together (T-165): one full check for the group, a merge for each when it
// passes, and a failure sent back to the task whose files caused it.

import { checkTogether, normalizeId, run } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, noAgent, now, type Opts, out, project, steps } from '../shared.ts';

function cmdCheckTogether(o: Opts, rest: string[]): number {
  const by = noAgent(o, 'check a group of tasks together');
  const { paths, config } = project(process.cwd());
  const ids = rest.map((r) => normalizeId(r, 'manual'));
  const s = steps();
  let open = '';
  const onStep = (words: string) => {
    if (open) s.done(open);
    open = `group-${Date.now()}`;
    s.start(open, words);
  };
  const r = checkTogether(paths, config, ids, { run, now, env: process.env, onStep }, { actor: 'human', by }, typeof o.env === 'string' ? o.env : undefined);
  if (open) s.done(open);
  const lines = [
    tone(`${r.merged.length ? '✓' : '!'} ${r.summary}`, r.merged.length ? 'blue' : 'orange'),
    ...r.leftOut.map((x) => `  ${x.id}: left out, it conflicts${x.with ? ` with ${x.with}` : ''} in ${x.files.join(', ')}`),
    ...r.sentBack.map((x) => `  ${x.id}: ${x.words}`),
    ...(r.together.length ? [`  ${r.together.join(', ')}: each passes alone, but they fail together. A person decides.`] : []),
    ...r.needsYou.map((x) => `  ${x.id}: ${x.why}`),
  ];
  out(o, () => lines.join('\n'), r);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Tasks',
    order: 23,
    lines: `  acc check-together [<id>…] [--env <branch>]
                                        Check tasks in review together: merge each into a scratch branch of the
                                        environment's, run the full check once, and merge them all when it
                                        passes. A failure goes back to the task whose files it names; with no
                                        one match, the group is split to find it`,
  },
  options: {
    env: { type: 'string' },
  },
  commands: {
    'check-together': cmdCheckTogether,
  },
};
