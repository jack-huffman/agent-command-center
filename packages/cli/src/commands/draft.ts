// acc draft criteria (T-81): a read-only agent drafts a tracker task's acceptance criteria, test steps and
// edge cases, kept with the task. acc draft update makes the draft an update draft. Nothing is posted.

import { AccError, type CriteriaDraft, criteriaUpdate, draftCriteria, parseCriteriaTicket, readCriteria, rulesText, run } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, noAgent, now, type Opts, out, project, readFileArg, steps } from '../shared.ts';

/** A draft as a person reads it: its Markdown, then what it was drafted from, and any wording finding. */
function draftLines(d: CriteriaDraft): string[] {
  const read = d.read.full ? `the ticket, ${d.read.comments} comment${d.read.comments === 1 ? '' : 's'} and ${d.read.related} related ticket${d.read.related === 1 ? '' : 's'}` : 'the task\'s description only: its comments were not read';
  return [
    d.markdown,
    '',
    ...(d.wording.length ? [tone(`! Wording: ${d.wording.length} finding${d.wording.length === 1 ? '' : 's'}`, 'orange'), ...d.wording.map((f) => `  - Line ${f.line}: ${f.message} [${f.match}]`), ''] : []),
    tone(`Drafted from ${read}. Session ${d.sessionId}.`, 'dim'),
    tone(`Nothing is on ${d.key} yet. Add it to the description in the task sheet, or make it an update to post with acc draft update ${d.task}.`, 'dim'),
  ];
}

function cmdCriteria(o: Opts, raw: string): number {
  noAgent(o, 'draft a ticket\'s acceptance criteria');
  const { paths, config } = project(process.cwd());
  const id = raw.toUpperCase();
  const file = o.ticket as string | undefined;
  const ticket = file ? parseCriteriaTicket(readFileArg(file === '-' ? 0 : file)) : null;
  const say = (line: string) => { if (!o.json) process.stderr.write(line + '\n'); };
  const d = draftCriteria(paths, config, id, ticket, {
    run, now, env: process.env, steps: steps(),
    onStart: (session, name) => say(tone(`Drafting ${id}'s acceptance criteria. The drafter reads and changes nothing. Session ${session}, named ${name}.`, 'dim')),
  }, rulesText(paths.root, config.profile));
  out(o, () => draftLines(d).join('\n'), d);
  steps().result(true, d.wording.length ? `${id}'s draft is kept, with ${d.wording.length} wording finding${d.wording.length === 1 ? '' : 's'}.` : `${id}'s draft is kept.`);
  return 0;
}

function cmdShow(o: Opts, raw: string): number {
  const { paths } = project(process.cwd());
  const id = raw.toUpperCase();
  const d = readCriteria(paths, id);
  if (!d) throw new AccError('no-criteria', `${id} has no drafted acceptance criteria yet: acc draft criteria ${id}.`);
  out(o, () => draftLines(d).join('\n'), d);
  return 0;
}

function cmdUpdate(o: Opts, raw: string): number {
  const by = noAgent(o, 'make a draft an update');
  const { paths } = project(process.cwd());
  const u = criteriaUpdate(paths, raw.toUpperCase(), by, now);
  out(o, () => `Drafted ${u.id} for ${u.key}. Read and edit it before you post it: nothing is posted yet.`, u);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Ticket updates (acc drafts them; only a person posts)',
    order: 62,
    lines: `  acc draft criteria <id> [--ticket <file>]
                                        A read-only agent drafts the ticket's acceptance criteria, test steps and
                                        edge cases, with open questions for its author, and keeps the draft with
                                        the task. --ticket gives the ticket, its comments and related tickets as
                                        JSON; without it, the agent reads the task's description only
  acc draft show <id>                   The task's drafted acceptance criteria
  acc draft update <id>                 The draft as an update to edit and post as a comment. Nothing is posted`,
  },
  options: { ticket: { type: 'string' } },
  subcommands: { draft: ['criteria', 'show', 'update'] },
  commands: {
    draft: (o, rest) => {
      const usage = 'acc draft criteria <id> [--ticket <file>] | acc draft show <id> | acc draft update <id>';
      if (!rest[1]) throw new AccError('usage', usage);
      if (rest[0] === 'criteria') return cmdCriteria(o, rest[1]);
      if (rest[0] === 'show') return cmdShow(o, rest[1]);
      if (rest[0] === 'update') return cmdUpdate(o, rest[1]);
      throw new AccError('usage', usage);
    },
  },
};
