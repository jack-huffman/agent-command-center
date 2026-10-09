// acc's tidy-up commands (GH-104): acc drafts a tidy-up after a burst of merges, and only a person adds or skips it.

import { AccError, addTidy, draftTidy, readLedger, run, skipTidy, type TidyDraft, tidyEvery, tidyScope, type TidyScope, tidyStatus } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, project } from '../shared.ts';
import { personOnlyUpdate } from './updates.ts';

/** The count, and the draft once anything has merged since the last tidy-up. It changes nothing but origin's refs. */
function current() {
  const { paths, config } = project(process.cwd());
  const status = tidyStatus(paths, config, readLedger(paths.ledger));
  const scope: TidyScope | null = status.count ? tidyScope(run, paths.root, config, status.tasks) : null;
  const draft: TidyDraft | null = scope ? draftTidy(status, scope) : null;
  return { paths, config, status, scope, draft };
}

function cmdTidy(o: Opts): number {
  const { status, scope, draft } = current();
  const last = status.last ? `The last tidy-up was ${status.last.outcome} by ${status.last.by.replace(/^human:/, '')} ${status.last.at}.` : 'No tidy-up is on record yet, so only the newest merges count.';
  const human = () => [
    !status.every ? 'Tidy-ups are off: tidy.every is 0 in .acc/config.json.'
      : `${status.count} task${status.count === 1 ? '' : 's'} merged since the last tidy-up; one is offered every ${status.every}. ${status.open ? `${status.open}, a tidy-up, isn't done yet.` : status.due ? tone('A tidy-up is due.', 'blue') : 'Not due yet.'}`,
    tone(last, 'dim'),
    ...(draft && scope ? [
      '',
      `${draft.title}: ${draft.files.length} file${draft.files.length === 1 ? '' : 's'} on ${scope.tip}, covering ${draft.covered.join(', ')}.`,
      ...draft.files.map((f) => `  ${f}`),
      ...draft.unknown.map((u) => tone(`  ! ${u.task}'s files aren't known: ${u.why}.`, 'orange')),
      ...(scope.fetched ? [] : [tone(`  ! ${scope.tip} wasn't fetched just now, so it may be behind.`, 'orange')]),
      '',
      tone('acc tidy add adds it as a task; acc tidy skip sets it aside. Either starts the count again.', 'dim'),
    ] : []),
  ].join('\n');
  out(o, human, { every: status.every, count: status.count, due: status.due, open: status.open, last: status.last, tasks: status.tasks, scope, draft });
  return 0;
}

function cmdAdd(o: Opts): number {
  const by = personOnlyUpdate(o, 'add a tidy-up');
  const { paths, config, status, draft } = current();
  if (status.open) throw new AccError('refused', `${status.open} is a tidy-up that isn't done yet. Finish it, or remove it, before adding another.`);
  if (!draft) throw new AccError('refused', 'Nothing has merged since the last tidy-up, so there\'s nothing to tidy.');
  const r = addTidy(paths, config, draft, { by, now });
  out(o, () => tone(`✓ Added ${r.task}: ${draft.title}, over ${draft.files.length} file${draft.files.length === 1 ? '' : 's'}. Dispatch it when you're ready.`, 'blue'), { ...r, draft });
  return 0;
}

function cmdSkip(o: Opts): number {
  const by = personOnlyUpdate(o, 'skip a tidy-up');
  const { paths, config } = project(process.cwd());
  const r = skipTidy(paths, config, { by, now });
  out(o, () => `Skipped the tidy-up of ${r.covered.length} merge${r.covered.length === 1 ? '' : 's'}. The next is offered once ${tidyEvery(config)} more tasks merge.`, r);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Tasks',
    order: 21,
    lines: `  acc tidy                              How many tasks merged since the last tidy-up, and the tidy-up acc
                                        would draft: the files they changed, to find duplicated helpers and
                                        comments that contradict the code. It changes nothing
  acc tidy add                          Add that tidy-up as a task, labelled tidy-up. A person's choice
  acc tidy skip                         Set it aside. Either starts the count again`,
  },
  subcommands: { tidy: ['add', 'skip'] },
  commands: {
    tidy: (o, rest) => {
      if (!rest.length) return cmdTidy(o);
      if (rest[0] === 'add' && rest.length === 1) return cmdAdd(o);
      if (rest[0] === 'skip' && rest.length === 1) return cmdSkip(o);
      throw new AccError('usage', 'acc tidy [add | skip]');
    },
  },
};
