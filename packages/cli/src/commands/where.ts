// acc's where command (T-155): where a ticket's work is, read from git and from each org on its path.

import { AccError, run, whereIs, whereWords, type TicketWhere } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, now, type Opts, out, project, steps } from '../shared.ts';

/** The readings as a person reads them: one line each, in blue when deployed and orange when not all of it is. */
export function whereLines(w: TicketWhere): string[] {
  return w.envs.map((e) => {
    const line = `${whereWords(e)} Read ${e.at.slice(0, 16).replace('T', ' ')}.`;
    return e.state === 'deployed' ? tone(`✓ ${line}`, 'blue') : e.state === 'unknown' ? tone(`? ${line}`, 'dim') : tone(`! ${line}`, 'orange');
  });
}

/** acc where <id> [--env <name>]: reads, keeps and says where the ticket's work is. The org is only read. */
function cmdWhere(o: Opts, idArg: string | undefined): number {
  const id = String(idArg ?? '').trim().toUpperCase();
  if (!id) throw new AccError('usage', 'acc where <id> [--env <name>]');
  const { paths, config } = project(process.cwd());
  const w = whereIs(paths, config, id, o.env as string | undefined, { run, now, steps: steps(), onWait: () => { if (!o.json) process.stderr.write(tone('Waiting for another read or deploy of this org to finish…\n', 'dim')); } });
  out(o, () => whereLines(w).join('\n'), w);
  steps().result(true, `Read where ${id} is in ${w.envs.length} environment${w.envs.length === 1 ? '' : 's'}.`);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Environments',
    order: 60,
    lines: `  acc where <id> [--env <name>]         Where a ticket's work is in each environment on its path, read
                                        from its branch and its org; the org is only read`,
  },
  options: {
    env: { type: 'string' },
  },
  commands: {
    where: (o, rest) => cmdWhere(o, rest[0]),
  },
};
