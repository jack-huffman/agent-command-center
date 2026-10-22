// acc plan's talk (T-98): a person's message to the planning agent, a reply's proposal used, a note on the
// plan, and a Claude Code session opened on it. Only a person does any of them. plan.ts sends them here.

import { AccError, notePlan, openInClaude, proposalWords, readAnalysis, recordInSession, run, TALK_SESSION_VAR, talkPlan, useProposal } from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { accCommand, noAgent, now, type Opts, out, project, steps } from '../shared.ts';

/** Its lines in acc help, under plan's. */
export const TALK_HELP = `  acc plan talk <id> "<message>"        Talk the plan through: the planning agent replies from the code (and the
                                        org), read-only. --about d1, d1.a, s2, r1 or q1 quotes what it's about
  acc plan use <id> <turn> <proposal>   Use a change the planning agent proposed: a choice, an answer or a note,
                                        recorded as yours. --yes when it changes an approved plan
  acc plan note <id> "<text>"           Add a note to the plan, such as a changed step. --yes on an approved plan
  acc plan claude <id>                  How to open the plan in Claude Code, in plan mode, with the ticket, the
                                        plan and the conversation so far`;

/** The words acc plan takes for its talk. */
export const TALK_SUBCOMMANDS = ['talk', 'use', 'note', 'claude'] as const;

/** Marks what a Claude Code session opened on the plan recorded, when this acc runs in one (TALK_SESSION_VAR). */
export function recordedHere(root: string, id: string, line: string): boolean {
  const { paths } = project(root);
  return recordInSession(paths, id, process.env[TALK_SESSION_VAR], line);
}

function cmdTalk(o: Opts, id: string, message: string): number {
  const by = noAgent(o, 'talk a plan through');
  const { paths, config } = project(process.cwd());
  const task = id.toUpperCase();
  const about = typeof o.about === 'string' ? o.about : null;
  const { reply } = talkPlan(paths, config, task, message, about, { run, now, env: process.env, accCommand: accCommand(), steps: steps() }, by);
  const a = readAnalysis(paths, task);
  const n = reply.proposals?.length ?? 0;
  steps().result(true, n ? `The planning agent replied, and proposes ${n} change${n === 1 ? '' : 's'}.` : 'The planning agent replied.');
  out(o, () => [
    reply.text,
    ...(reply.proposals ?? []).map((p) => tone(`  ${reply.id}.${p.id} ${proposalWords(p, a)}${p.why ? `: ${p.why}` : ''}. Use it with acc plan use ${task} ${reply.id} ${p.id}.`, 'blue')),
  ].join('\n'), reply);
  return 0;
}

function cmdUse(o: Opts, id: string, turn: string, proposal: string): number {
  const by = noAgent(o, 'use a proposal in a plan');
  const { paths } = project(process.cwd());
  const task = id.toUpperCase();
  const r = useProposal(paths, task, turn.toLowerCase(), proposal.toLowerCase(), by, now, o.yes === true);
  if (r.changed) recordedHere(process.cwd(), task, r.line);
  out(o, () => tone(r.changed ? `Recorded in ${task}'s plan: ${r.line}.` : `${task}'s plan already says so: ${r.line}. Nothing changed.`, 'blue'), r);
  return 0;
}

function cmdNote(o: Opts, id: string, text: string): number {
  const by = noAgent(o, 'add a note to a plan');
  const { paths } = project(process.cwd());
  const task = id.toUpperCase();
  const { note } = notePlan(paths, task, text, by, now, o.yes === true);
  recordedHere(process.cwd(), task, `Note on the plan: ${note.text}`);
  out(o, () => tone(`Noted on ${task}'s plan v${note.version}.`, 'blue'), note);
  return 0;
}

function cmdClaude(o: Opts, id: string): number {
  const by = noAgent(o, 'open a plan in Claude Code');
  const { paths, config } = project(process.cwd());
  const launch = openInClaude(paths, config, id.toUpperCase(), by, now);
  out(o, () => `Run this in ${launch.cwd}, with ${TALK_SESSION_VAR}=${launch.env[TALK_SESSION_VAR]}:\nclaude ${launch.args.map((a) => JSON.stringify(a)).join(' ')}`, launch);
  return 0;
}

/** acc plan's talk subcommands. Undefined for a word that isn't one. */
export function talkCommand(o: Opts, rest: string[]): number | undefined {
  const [sub, id, ...args] = rest;
  if (sub === 'talk') {
    if (!id || !args.length) throw new AccError('usage', 'acc plan talk <id> "<message>" [--about d1]');
    return cmdTalk(o, id, args.join(' '));
  }
  if (sub === 'use') {
    if (!id || !args[0] || !args[1]) throw new AccError('usage', 'acc plan use <id> <turn> <proposal>');
    return cmdUse(o, id, args[0], args[1]);
  }
  if (sub === 'note') {
    if (!id || !args.length) throw new AccError('usage', 'acc plan note <id> "<text>"');
    return cmdNote(o, id, args.join(' '));
  }
  if (sub === 'claude') {
    if (!id) throw new AccError('usage', 'acc plan claude <id>');
    return cmdClaude(o, id);
  }
  return undefined;
}
