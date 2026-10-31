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
 * word that names this file, and `acc deploy --guide` refuses the deployer (personOnly). And no other process
 * of the same user can make one either (T-171): the pick is signed with the person's key (person-key.ts),
 * which only a person's command holds, over the task, the environment and the chat it opens; an unsigned
 * pick, one signed by another key, or one for another task or environment reads as no pick, with why.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileId } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import { takeTypedYes, YES_TTL_MS } from './deploy-guide.ts';
import { AccError } from './exec.ts';
import type { RepoPaths } from './paths.ts';
import { asClause, signedBody, type Signer, type Verifier } from './person-key.ts';
import { confirmsOrg, type KeptCheck, type TaskDeployPlan } from './task-deploy.ts';

/** Where a person said a ticket goes, kept by acc when they opened its deploy guide, signed by their key (T-171). */
export interface DeployPick {
  v: 2;
  task: string;
  /** The environment's branch, as ACC_DEPLOY_TO names it. */
  env: string;
  by: string;
  at: string;
  /** The guide chat it opened, by its session id: the typed yes must come from that chat. */
  session: string;
  sig: string;
  /** When a deploy used it as the yes; a used pick is no yes again. Outside the signature: the guide's deploy sets it, and holds no key. */
  used?: string;
}

/** The fields a pick signs, in order. */
export const PICK_SIGNED = ['v', 'task', 'env', 'by', 'at', 'session'] as const;

export const deployPickPath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(paths.stateDir, 'deploy-picks', `${fileId(task)}.json`);

/** Keeps the person's pick, whole and signed: the one before it, for any environment, is replaced. */
export function keepPick(paths: Pick<RepoPaths, 'stateDir'>, task: string, env: string, by: string, session: string, now: () => Date, signer: Signer): DeployPick {
  const body = { v: 2 as const, task, env, by, at: now().toISOString(), session };
  const pick: DeployPick = { ...body, sig: signer.sign('deploy-pick', body) };
  const file = deployPickPath(paths, task);
  mkdirSync(dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(pick, null, 2) + '\n');
  return pick;
}

/** The pick's file as it is, whatever it holds, or null when there's none or it isn't JSON. */
function pickFile(paths: Pick<RepoPaths, 'stateDir'>, task: string): DeployPick | null {
  try {
    const p = JSON.parse(readFileSync(deployPickPath(paths, task), 'utf8')) as DeployPick;
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}

/**
 * The pick kept for a task, or why it is none: there's no file, it isn't signed by the person's key (any
 * process of the same user can write the file: a builder's tests among them), or it is signed for another
 * task. A pick for another task is one a person signed, so its signature holds; its task doesn't.
 */
export function readPick(paths: Pick<RepoPaths, 'stateDir'>, task: string, verify: Verifier): { pick: DeployPick | null; why: string | null } {
  const p = pickFile(paths, task);
  if (!p || typeof p.env !== 'string' || typeof p.at !== 'string') return { pick: null, why: null };
  const unsigned = verify.verify('deploy-pick', signedBody(p, PICK_SIGNED), p.sig);
  if (unsigned) return { pick: null, why: `The pick kept for ${task} is no pick: ${asClause(unsigned)}. Only a person's own acc deploy --guide makes one.` };
  if (p.task !== task) return { pick: null, why: `The pick kept for ${task} is ${p.task}'s, not its own.` };
  return { pick: p, why: null };
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
export function takeGuidedYes(paths: Pick<RepoPaths, 'stateDir'>, id: string, plan: Pick<TaskDeployPlan, 'confirm' | 'confirmName' | 'to' | 'sandbox'>, kept: Pick<KeptCheck, 'at'> | null, now: () => Date, verify: Verifier, envName: (branch: string) => string = (b) => b): GuidedYes {
  const read = readPick(paths, id, verify);
  const none = `No one picked where ${id} goes. A person opens its deploy guide with acc deploy <environment> --task ${id} --guide, and that pick is where it deploys.`;
  if (!read.pick) throw new AccError('refused', read.why ? `${read.why} ${none}` : none);
  const { pick } = read;
  if (pick.env !== plan.to.branch) throw new AccError('refused', `The person picked ${envName(pick.env)} for ${id}, not ${plan.to.name}. The deploy guide deploys only where the person picked: acc deploy ${pick.env} --task ${id}.`);
  const typedName = (lead: string): GuidedYes => {
    let typed: string;
    try {
      typed = takeTypedYes(paths, id, kept, now, { env: plan.to.branch, name: plan.to.name, session: pick.session, verify });
    } catch (e) {
      throw new AccError('refused', `${lead}${(e as Error).message}`);
    }
    if (!confirmsOrg({ confirm: true, to: plan.to }, typed)) throw new AccError('refused', `${lead}The person typed "${typed}", not ${plan.confirmName}. Ask them to type ${plan.confirmName} in the chat to deploy ${id} to it.`);
    return 'typed';
  };
  const markUsed = (): void => writeAtomic(deployPickPath(paths, id), JSON.stringify({ ...pick, used: now().toISOString() }, null, 2) + '\n');
  // Production and a protected org keep the typed yes: the pick only fixes where (D-235), and once used it
  // fixes nothing more, so an old pick from a closed chat never sends a later deploy there.
  // So does an org Salesforce doesn't say is a sandbox (an instance URL acc can't read as one): it could be
  // production whatever the settings call it, so the pick is never its yes (security review).
  if (plan.confirm || plan.sandbox !== true) {
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
