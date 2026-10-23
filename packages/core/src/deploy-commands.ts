/**
 * The commands that deploy to an org by hand, in every form Salesforce's CLIs take (D-T-115): the builder's
 * hook refuses them, the builder's settings deny them, and a command gate (`gates.commands`) may not run
 * one, since the gate runner can't see inside a shell command. Only the salesforce profile's own deploy
 * gate deploys, and no command gate may take its name.
 */
import { commandsOf } from './command-words.ts';

/** Whether a command word is sf or sfdx: by its name, or its path. */
const isSalesforceCli = (cmd: string | undefined): cmd is string => !!cmd && ['sf', 'sfdx'].includes(cmd.split('/').pop() ?? '');

/** A flag that makes the deploy check-only, so it saves nothing: sf's --dry-run, sfdx's --checkonly (-c). */
const CHECK_ONLY = ['--dry-run', '--checkonly', '-c'];

/**
 * The form of a hand deploy a command is, or null: `sf project deploy start|quick|resume`, the same with
 * colons (`sf project:deploy:start`), sf's older `deploy metadata`, and sfdx's `force:source:deploy`,
 * `force:mdapi:deploy` and `force:source:push`. A check-only one (--dry-run, --checkonly) isn't a deploy.
 */
export function deploysByHand(words: string[]): string | null {
  const [cmd, ...rest] = words;
  if (!isSalesforceCli(cmd)) return null;
  const cli = cmd.split('/').pop()!;
  // The subcommand as one word, however it was written: "project deploy start" and "project:deploy:start" alike.
  const parts: string[] = [];
  for (const w of rest) {
    if (w.startsWith('-')) break;
    parts.push(...w.split(':'));
  }
  const sub = parts.join(' ');
  const checkOnly = rest.some((w) => CHECK_ONLY.includes(w));
  const form = (s: string) => `${cli} ${s}`;
  if (/^project deploy (start|quick|resume)\b/.test(sub)) return checkOnly && sub.startsWith('project deploy start') ? null : form(sub.split(' ').slice(0, 3).join(' '));
  if (/^deploy metadata\b/.test(sub)) return checkOnly && !/^deploy metadata (quick|resume)/.test(sub) ? null : form(sub.split(' ').slice(0, 3).join(' '));
  if (/^force (source|mdapi) deploy\b/.test(sub)) return checkOnly ? null : form(parts.slice(0, 3).join(':'));
  if (/^force source push\b/.test(sub)) return form('force:source:push');
  return null;
}

/** The first command on a line that deploys by hand, as its form, or null: a line is read as the builder's hook reads it. */
export function handDeployIn(line: string): string | null {
  for (const w of commandsOf(line)) {
    const form = deploysByHand(w);
    if (form) return form;
  }
  return null;
}

/** What the builder's settings deny on a Salesforce project (D-012): each form of a hand deploy, and deleting an org. */
export const HAND_DEPLOY_DENIES = [
  'Bash(sf project deploy start*)', 'Bash(sf project deploy quick*)', 'Bash(sf project deploy resume*)', 'Bash(sf project:deploy:*)',
  'Bash(sf deploy metadata*)', 'Bash(sf deploy:metadata*)',
  'Bash(sfdx project deploy start*)', 'Bash(sfdx project deploy quick*)', 'Bash(sfdx project deploy resume*)', 'Bash(sfdx project:deploy:*)',
  'Bash(sfdx force:source:deploy*)', 'Bash(sfdx force:mdapi:deploy*)', 'Bash(sfdx force:source:push*)',
];

/** The built-in gate that deploys, which no command gate may be named for. Named here, not in deploy-gate.ts, so the config can check without loading the gate. */
export const DEPLOY_GATE = 'deploy';

/**
 * Why a command gate can't be this one, or null (D-T-115): it's named for the built-in deploy gate on a
 * Salesforce project, which would replace it with a command the runner can't inspect, or its command
 * deploys by hand, which a check never does.
 */
export function commandGateProblem(name: string, command: string, profile: string): string | null {
  if (name === DEPLOY_GATE && profile === 'salesforce') {
    return `"gates.commands.${name}": ${name} is built into the salesforce profile and can't be replaced by a command: only acc's own deploy gate deploys, and only to the task's build org (D-T-115). Give the command a name of its own.`;
  }
  const form = handDeployIn(command);
  if (form) return `"gates.commands.${name}": its command runs a real deploy (${form}). A check never deploys; only the salesforce profile's deploy gate does, through acc gate run deploy (D-T-115). A check-only deploy is sf project deploy start --dry-run.`;
  return null;
}
