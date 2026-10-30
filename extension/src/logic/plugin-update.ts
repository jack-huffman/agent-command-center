/**
 * Install and reload's plugin step (T-152): whether the Claude Code plugin is updated with the extension, the
 * line that updates it, and what the person is told after the reload. Builders run the plugin's own acc and
 * its hooks, and a private marketplace doesn't update itself (D-081), so the update brings the plugin along.
 * No vscode import, so it's testable. extension/src/self-update.ts runs it.
 */

import { type InstallSystem, shellOf, SYSTEM } from '../../../packages/core/src/onboarding/install-lines.ts';
import { pluginBehind } from '../../../packages/core/src/onboarding/helpers.ts';
import { parsePluginList, pluginUpdate, userPlugin } from '../../../packages/core/src/onboarding/steps.ts';
import type { RunResult } from '../run.ts';
import { COMMANDS } from './setup.ts';
import { shellRun } from './shells.ts';

/** The plugin step, as the progress notification shows it. */
export const PLUGIN_STEP = 'Updating the Claude Code plugin';

/** What the plugin step did: updated, or failed and why. A plugin the step left alone has no outcome. */
export type PluginOutcome = { kind: 'updated' } | { kind: 'failed'; why: string };

/**
 * Whether to update the plugin, from `claude plugin list --json` (r), for the version being installed. Only a
 * plugin installed for every session (user scope) and older than that version is updated. A plugin that isn't
 * there is Setup's to install, and no claude is nothing to update. A list that can't be read is a failure.
 */
export function pluginPlan(r: RunResult, version: string): { kind: 'update' | 'leave' } | { kind: 'failed'; why: string } {
  const read = parsePluginList(r);
  if (!read.ok) return read.missing ? { kind: 'leave' } : { kind: 'failed', why: `couldn't read Claude Code's plugins: ${read.error.replace(/\.$/, '')}` };
  const user = userPlugin(read.list);
  return { kind: user && pluginBehind(user.version, version) ? 'update' : 'leave' };
}

/** The program and arguments that update the plugin: A4's own fix line, for the shell of the system (D-209, T-124). */
export const pluginUpdateRun = (system: InstallSystem = SYSTEM): { cmd: string; args: string[] } => shellRun(pluginUpdate(shellOf(system)), system);

/** What the update line's run did. */
export const pluginRunOutcome = (r: RunResult): PluginOutcome =>
  (r.code === 0 ? { kind: 'updated' } : { kind: 'failed', why: (r.stderr || r.stdout).trim().split('\n')[0]?.trim().replace(/\.$/, '') || `the update exited ${r.code}` });

/** A plugin outcome as the install saves it, read back after the reload: anything else is no outcome. */
export function savedPlugin(saved: unknown): PluginOutcome | undefined {
  const p = saved as Partial<{ kind: unknown; why: unknown }> | null | undefined;
  if (!p || typeof p !== 'object') return undefined;
  if (p.kind === 'updated') return { kind: 'updated' };
  if (p.kind === 'failed' && typeof p.why === 'string' && p.why) return { kind: 'failed', why: p.why };
  return undefined;
}

/** The sentence after "Updated to <version>" that says what the plugin step did. */
export const pluginWords = (o: PluginOutcome): string =>
  (o.kind === 'updated'
    ? 'The Claude Code plugin updated too. Claude Code sessions that are open keep the old plugin until they start again.'
    : `The Claude Code plugin didn't update: ${o.why}.`);

/** The button on a failed plugin step's message: Setup's A4 Do it. */
export const PLUGIN_FIX = { label: 'Update the plugin', command: COMMANDS.fix, step: 'A4.plugin' } as const;
