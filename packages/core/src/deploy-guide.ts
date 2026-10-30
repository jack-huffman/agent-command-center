/**
 * A deploy an agent guides (T-154). The person asked that a deploy to production be handled by an agent, as it
 * often needs steps outside the deploy itself: deletions, record changes, settings made by hand. Deploy with an
 * agent opens a Claude Code chat in the project's main checkout as the deploy guide (ACC_ROLE=deployer, with the
 * task and where it goes). The acc:deploy skill has it gather every step into one runbook, which the person
 * approves, then work through it with them.
 *
 * The deploy itself waits for the person's yes, typed in the chat: the plugin's UserPromptSubmit hook keeps each
 * short message the person sends (keepTypedYes), and acc deploy, run by the guide, takes the latest one
 * (takeTypedYes). It must be newer than the check it deploys, at most YES_TTL_MS old, and is used once. A hook
 * never fires on the agent's own words, so the agent can't give the yes itself.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileId } from './analyze.ts';
import type { Config } from './config.ts';
import { AccError } from './exec.ts';
import { readLedger } from './ledger.ts';
import { sessionName } from './names.ts';
import type { RepoPaths } from './paths.ts';
import type { ClaudeLaunch } from './plan-talk.ts';
import { type KeptCheck, TASK_DEPLOY_COMMAND, type TaskCommand, taskDeployEnabled, taskDeployRoute } from './task-deploy.ts';

/** The role a deploy guide's session runs as. */
export const DEPLOYER = 'deployer';
/** Where a deploy guide's session takes its task: the environment's branch. */
export const DEPLOY_TO_VAR = 'ACC_DEPLOY_TO';
/** How long a typed yes stands: a person who walked away is asked again. */
export const YES_TTL_MS = 15 * 60_000;
/** The longest message kept as a yes: one line, as an org's name or "yes" is. A longer one clears it. */
export const YES_MAX = 200;

/** The person's latest short message in a deploy guide's chat. */
export interface TypedYes {
  v: 1;
  task: string;
  typed: string;
  at: string;
  session: string | null;
}

export const typedYesPath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(paths.stateDir, 'deploy-yes', `${fileId(task)}.json`);

/** The deploy guide's task, when this process is one: its ACC_ROLE and ACC_TASK. */
export const deployerTask = (env: NodeJS.ProcessEnv): string | null => (env.ACC_ROLE === DEPLOYER && env.ACC_TASK ? env.ACC_TASK : null);

/**
 * Keeps the person's message as the latest thing they typed in the guide's chat. A message of more than one
 * line, or longer than YES_MAX, is no yes, and clears the one kept: the yes is always the latest message.
 */
export function keepTypedYes(paths: Pick<RepoPaths, 'stateDir'>, task: string, prompt: string, session: string | null, now: () => Date): void {
  const file = typedYesPath(paths, task);
  const typed = prompt.trim();
  if (!typed || typed.length > YES_MAX || /[\r\n]/.test(typed)) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const yes: TypedYes = { v: 1, task, typed, at: now().toISOString(), session };
  writeFileSync(file, JSON.stringify(yes));
}

/** What the guide tells the person when there's no yes to use. */
export const ASK_AGAIN = 'Ask the person to type it in the chat, then run the deploy again.';

/**
 * The person's typed yes for a task's deploy, used up as it's read, whatever it says: what it must say is the
 * deploy's to judge. Refused when there's none, it's older than YES_TTL_MS, or it came before the latest check,
 * which the person may not have seen.
 */
export function takeTypedYes(paths: Pick<RepoPaths, 'stateDir'>, task: string, kept: Pick<KeptCheck, 'at'> | null, now: () => Date): string {
  const file = typedYesPath(paths, task);
  let yes: TypedYes | null = null;
  try {
    yes = JSON.parse(readFileSync(file, 'utf8')) as TypedYes;
  } catch {
    yes = null;
  }
  rmSync(file, { force: true });
  if (!yes || yes.v !== 1 || yes.task !== task || typeof yes.typed !== 'string') throw new AccError('refused', `The person hasn't typed a yes for ${task} in this chat. ${ASK_AGAIN}`);
  const at = Date.parse(yes.at);
  if (!(now().getTime() - at <= YES_TTL_MS)) throw new AccError('refused', `The person's yes is more than ${YES_TTL_MS / 60_000} minutes old. ${ASK_AGAIN}`);
  if (kept && at < Date.parse(kept.at)) throw new AccError('refused', `The person typed it before the latest check. Show them the check's result, then ${ASK_AGAIN.charAt(0).toLowerCase()}${ASK_AGAIN.slice(1)}`);
  return yes.typed;
}

/** Deploy with an agent: the CLI's and the extension's. On when the ticket can be deployed, with the same why. */
export const TASK_DEPLOY_GUIDE_COMMAND: TaskCommand<Parameters<typeof TASK_DEPLOY_COMMAND.enabled>[0]> = {
  id: 'acc.task.deployGuide',
  params: 'The task\'s id, and the environment to deploy it to (its next step when left out). It opens a Claude Code chat as the deploy guide; the person types the yes there.',
  enabled: (x) => TASK_DEPLOY_COMMAND.enabled(x),
};

/** The first message of a deploy guide's chat. */
export function deployGuidePrompt(id: string, from: string, to: string): string {
  return `Guide the deploy of ${id} from ${from} to ${to}, as the acc:deploy skill says. Start by reading the ticket and checking the deploy, then show me the runbook.`;
}

/**
 * How to open a deploy guide's chat for a task: in the project's main checkout, as a deployer, for where the
 * ticket goes next (or `to`). Refused where the ticket can't be deployed, with why.
 */
export function deployGuideLaunch(paths: RepoPaths, config: Config, id: string, to: string | undefined, uuid: () => string = randomUUID): ClaudeLaunch {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('not-found', `No task ${id}.`);
  const can = taskDeployEnabled(config, task);
  if (!can.ok) throw new AccError('refused', `${id} can't be deployed: ${can.why}`);
  const route = taskDeployRoute(config, task, to);
  const sessionId = uuid();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: 'deploy' });
  return {
    cwd: paths.root, sessionId, name, brief: '',
    args: [deployGuidePrompt(id, route.from.name, route.to.name), '--session-id', sessionId, '--name', name],
    env: { ACC_ROLE: DEPLOYER, ACC_TASK: id, [DEPLOY_TO_VAR]: route.to.branch },
  };
}
