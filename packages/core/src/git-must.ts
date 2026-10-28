/** git in a folder, and the check that stops on its failure with git's last line: promote's and a ticket's deploy's. */
import { AccError, type RunResult, type Runner } from './exec.ts';
import { lastLine } from './gates.ts';

/** Runs git in `cwd`. */
export const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });

/** git's output, or an error saying what failed and git's last line. */
export const must = (r: RunResult, what: string): string => {
  if (r.code !== 0) throw new AccError('git', `${what}: ${lastLine(r.stderr || r.stdout)}`);
  return r.stdout;
};
