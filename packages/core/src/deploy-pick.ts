/**
 * The person's pick of where a ticket deploys (T-156). Every deploy past the development org is the deploy
 * guide's, and the person picks the environment: `acc deploy <env> --task <id> --guide`, a person's command,
 * keeps the pick (the task, the environment, who, when) before the guide's chat opens. The guide's deploy to
 * that environment reads it (takeGuidedYes): for an org that is neither protected nor production, a fresh pick
 * is the yes, used once, so the person types no name; for production or a protected org, by the settings or by
 * what Salesforce says, the pick only fixes where, and the yes is still the name the person types (D-235). A
 * deploy to any other environment is refused: the guide deploys where the person picked. The pick expires as
 * the typed yes does (YES_TTL_MS); expired or used, the person types the environment's name instead.
 *
 * The guide can't write or change a pick: its settings deny every edit and `acc hook`, its guard refuses any
 * word that names this file, and `acc deploy --guide` refuses the deployer (personOnly).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileId } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import { takeTypedYes, YES_TTL_MS } from './deploy-guide.ts';
import { AccError } from './exec.ts';
import type { RepoPaths } from './paths.ts';
import { confirmsOrg, type KeptCheck, type TaskDeployPlan } from './task-deploy.ts';

/** Where a person said a ticket goes, kept by acc when they opened its deploy guide. */
export interface DeployPick {
  v: 1;
  task: string;
  /** The environment's branch, as ACC_DEPLOY_TO names it. */
  env: string;
  by: string;
  at: string;
  /** When a deploy used it as the yes; a used pick is no yes again. */
  used?: string;
}

export const deployPickPath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(paths.stateDir, 'deploy-picks', `${fileId(task)}.json`);

/** Keeps the person's pick, whole: the one before it, for any environment, is replaced. */
export function keepPick(paths: Pick<RepoPaths, 'stateDir'>, task: string, env: string, by: string, now: () => Date): DeployPick {
  const pick: DeployPick = { v: 1, task, env, by, at: now().toISOString() };
  const file = deployPickPath(paths, task);
  mkdirSync(dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(pick, null, 2) + '\n');
  return pick;
}

/** The pick kept for a task, or null when there's none or it isn't acc's. */
export function readPick(paths: Pick<RepoPaths, 'stateDir'>, task: string): DeployPick | null {
  try {
    const p = JSON.parse(readFileSync(deployPickPath(paths, task), 'utf8')) as DeployPick;
    return p && p.v === 1 && p.task === task && typeof p.env === 'string' && typeof p.at === 'string' ? p : null;
  } catch {
    return null;
  }
}

/** Why a pick is no yes now, or null: a deploy used it already, or it is older than a typed yes may be. */
export function pickStale(pick: Pick<DeployPick, 'at' | 'used'>, now: () => Date): string | null {
  if (pick.used) return 'The person\'s pick was used by a deploy already.';
  if (!(now().getTime() - Date.parse(pick.at) <= YES_TTL_MS)) return `The person's pick is more than ${YES_TTL_MS / 60_000} minutes old.`;
  return null;
}

/** How the guide's deploy got its yes: the person's pick, or the name they typed. */
export type GuidedYes = 'pick' | 'typed';

/**
 * The deploy guide's yes for a deploy of `plan` (T-156). Refused, with what to do, when no one picked where the
 * ticket goes or the person picked another environment. For production or a protected org the yes is the name
 * the person typed in the chat, newer than the check and used once (D-235). For any other org a fresh, unused
 * pick is the yes, and is marked used; a stale one falls back to the typed name.
 */
export function takeGuidedYes(paths: Pick<RepoPaths, 'stateDir'>, id: string, plan: Pick<TaskDeployPlan, 'confirm' | 'confirmName' | 'to'>, kept: Pick<KeptCheck, 'at'> | null, now: () => Date, envName: (branch: string) => string = (b) => b): GuidedYes {
  const pick = readPick(paths, id);
  if (!pick) throw new AccError('refused', `No one picked where ${id} goes. A person opens its deploy guide with acc deploy <environment> --task ${id} --guide, and that pick is where it deploys.`);
  if (pick.env !== plan.to.branch) throw new AccError('refused', `The person picked ${envName(pick.env)} for ${id}, not ${plan.to.name}. The deploy guide deploys only where the person picked: acc deploy ${pick.env} --task ${id}.`);
  const typedName = (lead: string): GuidedYes => {
    let typed: string;
    try {
      typed = takeTypedYes(paths, id, kept, now);
    } catch (e) {
      throw new AccError('refused', `${lead}${(e as Error).message}`);
    }
    if (!confirmsOrg({ confirm: true, to: plan.to }, typed)) throw new AccError('refused', `${lead}The person typed "${typed}", not ${plan.confirmName}. Ask them to type ${plan.confirmName} in the chat to deploy ${id} to it.`);
    return 'typed';
  };
  const markUsed = (): void => writeAtomic(deployPickPath(paths, id), JSON.stringify({ ...pick, used: now().toISOString() }, null, 2) + '\n');
  // Production and a protected org keep the typed yes: the pick only fixes where (D-235), and once used it
  // fixes nothing more, so an old pick from a closed chat never sends a later deploy there.
  if (plan.confirm) {
    if (pick.used) throw new AccError('refused', `The person's pick of ${plan.to.name} for ${id} was used by a deploy already. A person opens its deploy guide again to pick it.`);
    const yes = typedName('');
    markUsed();
    return yes;
  }
  const stale = pickStale(pick, now);
  if (stale) return typedName(`${stale} `);
  markUsed();
  return 'pick';
}
