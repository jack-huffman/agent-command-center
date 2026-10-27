// acc's trackers command (GH-112): connect a tracker, or change one, in .acc/config.json. The Command
// Center's Connect page asks acc to, so neither it nor Settings writes the file itself (D-064).

import { readFileSync } from 'node:fs';
import { AccError, loadConfig, removeTracker, repoPaths, run, saveTracker } from '../../../core/src/index.ts';
import { placeText, trackerName } from '../../../core/src/trackers/types.ts';
import { type CommandArea, type Opts, out, personOnly } from '../shared.ts';

function cmdSet(o: Opts): number {
  const file = o.file as string | undefined;
  if (!file) throw new AccError('usage', 'acc trackers set --file <tracker.json> [--index <n>]');
  const index = o.index === undefined ? null : Number(o.index);
  if (index !== null && o['new']) throw new AccError('usage', '--new adds a board, so it takes no --index.');
  if (index !== null && !(Number.isInteger(index) && index >= 0 && /^\d+$/.test(String(o.index)))) throw new AccError('usage', '--index is the tracker\'s place in the list, from 0.');
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new AccError('usage', `Couldn't read the tracker from ${file}: ${(e as Error).message}`);
  }
  personOnly(o, 'connect or change a tracker');
  const paths = repoPaths(process.cwd(), run);
  const saved = saveTracker(paths.config, index, record as Record<string, unknown>, !!o['new']);
  for (const w of saved.warnings) process.stderr.write(`warning: ${w}\n`);
  const { config } = loadConfig(paths.config);
  const t = config.trackers[saved.index]!;
  // A GitHub tracker with no repo is the project's own.
  const place = placeText({ ...t, repo: t.repo ?? config.github?.repo ?? null });
  out(o, () => `${index === null ? 'Connected' : 'Changed'} ${trackerName(t.kind)} in .acc/config.json: its tickets come from ${place}. Commit it to share it.`,
    { index: saved.index, added: index === null, tracker: t, place, warnings: saved.warnings });
  return 0;
}

/** Takes a board out of .acc/config.json (T-127). Its tasks stay in the ledger, on My work. */
function cmdRemove(o: Opts): number {
  const usage = 'acc trackers remove --index <n> --kind <kind>';
  const index = Number(o.index);
  if (o.index === undefined || !/^\d+$/.test(String(o.index)) || typeof o.kind !== 'string') throw new AccError('usage', usage);
  personOnly(o, 'remove a tracker');
  const paths = repoPaths(process.cwd(), run);
  const { removed, warnings } = removeTracker(paths.config, index, o.kind);
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  out(o, () => `Removed ${trackerName(removed.kind as Parameters<typeof trackerName>[0])} from .acc/config.json. Its tasks stay on My work. Commit it to share it.`, { index, removed, warnings });
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Setup',
    order: 16,
    lines: `  acc trackers set --file <tracker.json> [--index <n> | --new]
                                        Connect a tracker, or change the one at that place in the list, in
                                        .acc/config.json, as the Command Center's Connect page does. --new adds
                                        another board, even of a project a board has already. You commit it
  acc trackers remove --index <n> --kind <kind>
                                        Take the tracker at that place out of .acc/config.json. Its tasks stay`,
  },
  options: {
    file: { type: 'string' },
    index: { type: 'string' },
    new: { type: 'boolean', default: false },
    kind: { type: 'string' },
  },
  subcommands: { trackers: ['set', 'remove'] },
  commands: {
    trackers: (o, rest) => {
      if (rest[0] === 'set') return cmdSet(o);
      if (rest[0] === 'remove') return cmdRemove(o);
      throw new AccError('usage', 'acc trackers set --file <tracker.json> [--index <n> | --new], or acc trackers remove --index <n> --kind <kind>');
    },
  },
};
