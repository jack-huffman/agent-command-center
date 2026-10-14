// acc ste check: the wording check (T-12), the structural rules of Simplified Technical English on a file
// or on stdin. The copied skill's linter step names it (plugin/skills/ste100/SKILL.md).

import { AccError, type SteFinding, steLine, steLint } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { type CommandArea, type Opts, out, readFileArg } from '../shared.ts';

/** Each finding as the Python linter printed it, then a count; exit 1 on any hard finding. */
function cmdCheck(o: Opts, files: string[]): number {
  const checked = files.length ? files.map((f) => ({ file: f, ...steLint(readFileArg(f), f) })) : [{ file: '<stdin>', ...steLint(readFileArg(0)) }];
  const findings: SteFinding[] = checked.flatMap((c) => c.findings);
  const words = checked.reduce((n, c) => n + c.words, 0);
  const hard = findings.filter((f) => f.level === 'hard').length;
  out(o, () => [
    ...findings.map((f) => tone(steLine(f), f.level === 'hard' ? 'orange' : 'dim')),
    ...(findings.length ? [''] : []),
    `${findings.length} finding${findings.length === 1 ? '' : 's'} (${hard} hard, ${findings.length - hard} advisory) in ${words} word${words === 1 ? '' : 's'}.`,
    tone('Hedges (may, might, could) are never flagged: confidence is content.', 'dim'),
  ].join('\n'), { findings, count: findings.length, hard, words });
  return hard ? 1 : 0;
}

export const area: CommandArea = {
  help: {
    section: 'Checks',
    order: 71,
    lines: `  acc ste check [<file>...]             Check the wording of each file, or of stdin, against the structural rules
                                        of Simplified Technical English. Exit 1 on a hard finding; passive voice
                                        and compound tenses are advice only`,
  },
  subcommands: { ste: ['check'] },
  commands: {
    ste: (o, rest) => {
      if (rest[0] === 'check') return cmdCheck(o, rest.slice(1));
      throw new AccError('usage', 'acc ste check [<file>...]');
    },
  },
};
