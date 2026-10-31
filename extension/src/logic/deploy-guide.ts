/**
 * Deploy with an agent (T-154): acc's launch for the deploy guide's chat, read from its --json, and the line a
 * terminal runs to open it. Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */
import type { ClaudeLaunch } from '../../../packages/core/src/plan-talk.ts';
import { shq } from './shared.ts';

/** acc deploy --guide --json's launch, or why it isn't one: acc's own first line when it refused. */
export function guideLaunch(code: number, stdout: string, stderr: string): { ok: true; launch: ClaudeLaunch } | { ok: false; error: string } {
  const said = (stderr || stdout).trim().split('\n')[0]?.replace(/^✗\s*/, '');
  if (code !== 0) return { ok: false, error: said || `it stopped with code ${code}` };
  try {
    const launch = JSON.parse(stdout) as ClaudeLaunch;
    if (!Array.isArray(launch.args) || typeof launch.cwd !== 'string' || !launch.env || launch.env.ACC_ROLE !== 'deployer') throw new Error('no launch');
    return { ok: true, launch };
  } catch {
    return { ok: false, error: 'no way to open it came back.' };
  }
}

/** What the terminal runs: claude with the launch's arguments, each quoted for the shell. */
export const guideLine = (l: Pick<ClaudeLaunch, 'args'>): string => ['claude', ...l.args].map(shq).join(' ');

/** acc's arguments that open the deploy guide's chat (T-156, T-158): always --guide, so a pick never deploys directly. */
export const guideArgs = (id: string, to?: string): string[] => ['deploy', ...(to ? [to] : []), '--task', id, '--guide', '--json'];
