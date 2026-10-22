// What makes parallel work merge on its own (T-102): the floors file's git merge driver, and the decisions a
// branch adds, numbered at its merge, with the index made from them.

import {
  AccError, decisionsIndexFor, DECISIONS_INDEX, defaultEnvironment, mergedOnto, mergeFloorsFiles, numberDecisions, numberedWords, repoPaths, run, writeDecisionsIndex,
} from '../../../core/src/index.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tone } from '../format.ts';
import { type CommandArea, noAgent, type Opts, out, project } from '../shared.ts';

/** git's merge driver: exit 0 with the merged floors written over ours, 1 with a conflict a person resolves. */
function cmdFloorsMerge(files: string[]): number {
  if (files.length !== 3) throw new AccError('usage', 'acc floors merge <common> <ours> <theirs>: git runs it, with %O %A %B.');
  const [common, ours, theirs] = files as [string, string, string];
  const merged = mergeFloorsFiles(run, common, ours, theirs);
  if (!merged) process.stderr.write('The floors conflict where one side relaxed, dropped or changed a floor: a person decides.\n');
  return merged ? 0 : 1;
}

function cmdNumber(o: Opts): number {
  noAgent(o, 'number decisions; the merge does that');
  const { paths, config } = project(process.cwd());
  // On the environment's branch at a person's merge commit, the merge's first parent: a number another pull
  // request took since this one was numbered is numbered again (T-102).
  const env = defaultEnvironment(config).branch;
  const base = typeof o.base === 'string' ? o.base : mergedOnto(run, paths.root, env) ?? env;
  const who = config.commitIdentity ? ['-c', `user.name=${config.commitIdentity.name}`, '-c', `user.email=${config.commitIdentity.email}`] : [];
  const r = numberDecisions(run, paths.root, base, (...args) => run('git', [...who, ...args], { cwd: paths.root }));
  out(o, () => (r ? tone(`✓ Numbered against ${base}: ${numberedWords(r.numbered)}, as ${r.sha.slice(0, 7)}.`, 'blue') : `This branch adds no decision for its merge into ${base} to number.`), { base, sha: r?.sha ?? null, numbered: r?.numbered ?? [] });
  return 0;
}

/** Writes the index, or with `check` only says whether it's stale, exiting 1 when it is. */
function cmdIndex(o: Opts, check: boolean): number {
  const { root } = repoPaths(process.cwd(), run);
  const want = decisionsIndexFor(root);
  if (want === null) throw new AccError('refused', 'This repo keeps no docs/decisions/ folder, so there is no index to make.');
  const file = join(root, DECISIONS_INDEX);
  const stale = !existsSync(file) || readFileSync(file, 'utf8') !== want;
  if (check) {
    out(o, () => (stale ? tone(`${DECISIONS_INDEX} is stale: acc decisions index writes it again.`, 'orange') : `${DECISIONS_INDEX} is as docs/decisions/ makes it.`), { file: DECISIONS_INDEX, stale });
    return stale ? 1 : 0;
  }
  const wrote = writeDecisionsIndex(root);
  out(o, () => (wrote ? `Wrote ${DECISIONS_INDEX} from docs/decisions/.` : `${DECISIONS_INDEX} was already as docs/decisions/ makes it.`), { file: DECISIONS_INDEX, wrote });
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Tasks',
    order: 22,
    lines: `  acc floors merge <common> <ours> <theirs>
                                        git's merge driver for .acc/floors.json (Setup installs it): keeps the
                                        better of each floor. A floor one side relaxed stays a conflict
  acc decisions number [--base <branch>]
                                        Give each decision this branch adds (docs/decisions/new-<task>-<slug>.md)
                                        the next free number, and write it over D-<task> in the branch's own
                                        lines. Land and the merge queue do it. On main at a merge you made, it
                                        numbers against main before the merge, so a number taken since is numbered again
  acc decisions index                   Write docs/DECISIONS.md from docs/decisions/
  acc decisions check                   Whether docs/DECISIONS.md is stale: exit 1 when it is`,
  },
  options: {
    base: { type: 'string' },
  },
  subcommands: { floors: ['merge'], decisions: ['number', 'index', 'check'] },
  commands: {
    floors: (_o, rest) => {
      if (rest[0] === 'merge') return cmdFloorsMerge(rest.slice(1));
      throw new AccError('usage', 'acc floors merge <common> <ours> <theirs>');
    },
    decisions: (o, rest) => {
      if (rest[0] === 'number' && rest.length === 1) return cmdNumber(o);
      if (rest[0] === 'index' && rest.length === 1) return cmdIndex(o, false);
      if (rest[0] === 'check' && rest.length === 1) return cmdIndex(o, true);
      throw new AccError('usage', 'acc decisions number [--base <branch>] | index | check');
    },
  },
};
