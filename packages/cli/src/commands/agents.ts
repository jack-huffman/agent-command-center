// acc's Agents commands for builders and how they run: dispatch, done, block, resume, cleanup, agents
// and machine.

import { AccError, AGENT_ROLES, type AgentRole, autoMergeOn, autopilotDoes, cleanup, clipSaid, type Config, dispatch, filesOf, heavySlots, loadConfig, machineFile, noteGiven, noteInput, type NoteInput, type ProfileChange, profileView, resume, run, setAutoMerge, setAutonomy, setHeavySlots, setProfile, sharesWords, startedWords, startHeld, type StartHeldResult, stopWaiting, taskList } from '../../../core/src/index.ts';
import { stateLabel, tone } from '../format.ts';
import { accBinDir, accCommand, actorFrom, type CommandArea, now, type Opts, out, personOnly, project, taskIdFrom } from '../shared.ts';
import { cmdSet } from './tasks.ts';

/** Builders' and reviewers' model and effort (D-036). */
/** This machine's settings, for every repo on it (D-080): how many heavy checks run at once. */
function cmdMachine(o: Opts, sub: string | undefined, value: string | undefined): number {
  if (sub !== 'heavy-slots') throw new AccError('usage', 'acc machine heavy-slots [<n>]');
  if (value === undefined) {
    const n = heavySlots();
    out(o, () => `${n} heavy check${n === 1 ? '' : 's'} at once on this machine${process.env.ACC_HEAVY_SLOTS ? ' (from ACC_HEAVY_SLOTS)' : ''}.`, { heavySlots: n });
    return 0;
  }
  personOnly(o, 'change how many heavy checks this machine runs');
  const n = setHeavySlots(Number(value));
  out(o, () => `This machine now runs ${n} heavy check${n === 1 ? '' : 's'} at once, for every repo on it. Set in ${machineFile()}.`, { heavySlots: n });
  return 0;
}

function cmdAgents(o: Opts, sub: string | undefined, roleArg: string | undefined): number {
  const { paths } = project(process.cwd());
  // Shown from the project's own config, so where each value comes from is clear.
  const { config: projectConfig } = loadConfig(paths.config);
  const views = () => Object.fromEntries(AGENT_ROLES.map((r) => [r, profileView(projectConfig, run, paths.root, r)]));
  if (sub === 'autonomy') return cmdAutonomy(o, paths.config, roleArg);
  if (sub === 'auto-merge') return cmdAutoMerge(o, paths.config, roleArg);
  if (!sub || sub === 'show') {
    const v = views();
    const from = { clone: ' (this clone)', project: ' (project)', acc: ' (acc\'s default)', default: '' };
    out(o, () => AGENT_ROLES.map((r) => {
      const p = v[r]!;
      return `${r.padEnd(9)} model ${p.model}${from[p.from.model]}, effort ${p.effort ?? 'default'}${from[p.from.effort]}${p.fallbackModel ? `, falls back to ${p.fallbackModel}${from[p.from.fallbackModel]}` : ''}`;
    }).join('\n'), v);
    return 0;
  }
  if (sub !== 'set' || !roleArg || !(AGENT_ROLES as readonly string[]).includes(roleArg)) throw new AccError('usage', 'acc agents set <builder|reviewer> [--model <m>] [--effort <e>] [--fallback-model <m>] [--clear <field>] [--project] | acc agents autonomy [manual|review] | acc agents auto-merge [on|off]');
  personOnly(o, 'change what agents run with');
  const change: ProfileChange = {};
  if (o.model !== undefined) change.model = o.model as string;
  if (o.effort !== undefined) change.effort = o.effort as never;
  if (o['fallback-model'] !== undefined) change.fallbackModel = o['fallback-model'] as string;
  for (const f of (o.clear as string[] | undefined) ?? []) {
    const key = f === 'model' ? 'model' : f === 'effort' ? 'effort' : f === 'fallback-model' ? 'fallbackModel' : null;
    if (!key) throw new AccError('usage', '--clear takes model, effort or fallback-model.');
    change[key] = null;
  }
  if (!Object.keys(change).length) throw new AccError('usage', 'Say what to change: --model, --effort, --fallback-model or --clear.');
  setProfile(run, paths.root, paths.config, roleArg as AgentRole, change, o.project ? 'project' : 'clone');
  const after = profileView(loadConfig(paths.config).config, run, paths.root, roleArg as AgentRole);
  out(o, () => `${roleArg}: model ${after.model}${after.from.model === 'acc' ? ' (acc\'s default)' : ''}, effort ${after.effort ?? 'default'}${after.fallbackModel ? `, falls back to ${after.fallbackModel}` : ''}. ${o.project ? 'Set in .acc/config.json: commit it to share it.' : 'Set for this clone only.'} The next ${roleArg} uses it.`, after);
  return 0;
}

/** What an autonomy level means, in words; review's says whether autopilot merges pull requests (GH-67). */
const autonomyWords = (config: Config): string => ({
  manual: 'nothing happens on its own.',
  review: `autopilot ${autopilotDoes(autoMergeOn(config))}`,
  dispatch: 'as review, and it also starts Ready tasks. Not built yet: autopilot refuses.',
  full: 'read as dispatch. Not built yet: autopilot refuses.',
} as Record<string, string>)[config.autonomy] ?? '';

/** What autopilot may do on its own (D-055): shown, or set in .acc/config.json by a person. */
function cmdAutonomy(o: Opts, configFile: string, value: string | undefined): number {
  if (value === undefined) {
    const { config } = loadConfig(configFile);
    out(o, () => `autonomy ${config.autonomy} (project): ${autonomyWords(config)}`.trim(), { autonomy: config.autonomy });
    return 0;
  }
  const role = process.env.ACC_ROLE;
  if (role === 'builder' || role === 'reviewer' || role === 'analyst') throw new AccError('refused', `${role === 'analyst' ? 'An' : 'A'} ${role} can't change what autopilot may do. A person does that.`);
  personOnly(o, 'change what autopilot may do');
  setAutonomy(configFile, value);
  const { config } = loadConfig(configFile);
  out(o, () => `autonomy ${config.autonomy}: ${autonomyWords(config)} Set in .acc/config.json: commit it to share it.`, { autonomy: config.autonomy });
  return 0;
}

/** Whether autopilot merges, and into which environments, in words (GH-67). */
function autoMergeLines(config: Config): string {
  if (!autoMergeOn(config)) {
    return config.profile === 'salesforce'
      ? 'auto-merge off (project): a Salesforce project never auto-merges. A person merges every pull request.'
      : 'auto-merge off (project): autopilot never merges a pull request. A person merges each one.';
  }
  const covered = config.environments.filter((e) => !e.protected).map((e) => e.branch);
  const kept = config.environments.filter((e) => e.protected).map((e) => e.branch);
  return [
    `auto-merge on (project): a pull request into ${covered.join(', ') || 'no environment'} whose review and checks passed, with nothing waiting on a person and nothing changed under .acc/, joins the repo's merge queue, and they merge in turn: at its turn its base is merged in, the full check runs once, and it merges once GitHub says it can.`,
    config.gates.builder?.length ? `Builders run ${config.gates.builder.join(', ')}; the full check (${config.gates.required.join(', ') || 'none'}) runs in the queue.` : '',
    kept.length ? `Never into ${kept.join(', ')}: protected, so a person merges.` : '',
    config.autonomy === 'review' ? 'It merges while autopilot is on.' : `autonomy is "${config.autonomy}", so autopilot doesn't run and nothing merges on its own.`,
  ].filter(Boolean).join(' ');
}

/** Whether autopilot merges a reviewed, green pull request (GH-67): shown, or set in .acc/config.json by a person. */
function cmdAutoMerge(o: Opts, configFile: string, value: string | undefined): number {
  const data = (config: Config) => ({ autoMerge: autoMergeOn(config), environments: config.environments.filter((e) => autoMergeOn(config) && !e.protected).map((e) => e.branch), autonomy: config.autonomy });
  if (value === undefined) {
    const { config } = loadConfig(configFile);
    out(o, () => autoMergeLines(config), data(config));
    return 0;
  }
  if (value !== 'on' && value !== 'off') throw new AccError('usage', 'acc agents auto-merge [on|off]');
  const role = process.env.ACC_ROLE;
  if (role === 'builder' || role === 'reviewer' || role === 'analyst') throw new AccError('refused', `${role === 'analyst' ? 'An' : 'A'} ${role} can't change whether autopilot merges. A person does that.`);
  personOnly(o, 'change whether autopilot merges');
  setAutoMerge(configFile, value === 'on');
  const { config } = loadConfig(configFile);
  out(o, () => `${autoMergeLines(config)} Set in .acc/config.json: commit it to share it.`, data(config));
  return 0;
}

function cmdDispatch(o: Opts, id: string | undefined): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const deps = { run, now, accBinDir: accBinDir(), accCommand: accCommand(), env: process.env };
  // The tasks that wait for others' files, started once they may (D-093): the Command Center runs this.
  if (o.held) {
    if (id) throw new AccError('usage', 'acc dispatch --held starts every waiting task that may go: give it no id.');
    const r = startHeld(paths, config, deps, { actor, by });
    out(o, () => heldLines(r).join('\n'), r);
    return 0;
  }
  if (!id) throw new AccError('usage', 'acc dispatch <id> [--foreground] [--without-analysis] [--anyway] [--model <m>], acc dispatch --held, or acc dispatch <id> --stop-waiting');
  if (o['stop-waiting']) {
    const t = stopWaiting(paths, now, id.toUpperCase(), actor, by);
    out(o, () => `${t.id} stopped waiting. It stays to do, and nothing starts it on its own.`, t);
    return 0;
  }
  if (o.foreground && !o.json) process.stdout.write(`Starting ${id.toUpperCase()} in this terminal. Leave the session when it's done.\n`);
  const model = typeof o.model === 'string' ? o.model : undefined;
  const r = dispatch(paths, config, id.toUpperCase(), deps, { actor, by, foreground: o.foreground === true, withoutAnalysis: o['without-analysis'] === true, anyway: o.anyway === true, model });
  if (r.held) {
    // Held, not refused: the dispatch is kept, and the task starts on its own (D-093).
    const blockers = r.waitsFor.map((w) => w.task);
    out(o, () => [
      tone(`${r.task.id} waits for ${filesOf(r.waitsFor)}.`, 'blue'),
      `  ${taskList(r.first)} ${r.first.length === 1 ? 'shares' : 'share'} no files with work in flight, so ${r.first.length === 1 ? 'it goes' : 'they go'} first.`,
      `  ${r.task.id} starts on its own once ${taskList(blockers)} ${blockers.length === 1 ? 'merges' : 'merge'}, or once nothing else is ready to start: the Command Center or autopilot starts it.`,
      `  Start it now: acc dispatch ${r.task.id} --anyway`,
    ].join('\n'), r);
    return 0;
  }
  out(o, () => [
    `${r.task.id} → ${stateLabel('running')}`,
    `  worktree: ${r.worktree}${r.reused ? ' (reused)' : ''}`,
    `  branch:   ${r.branch}`,
    `  name:     ${r.name}`,
    `  model:    ${r.task.run?.model ?? ''}${r.task.run?.modelPicked ? ' (picked for this task)' : ''}`,
    `  agent:    ${r.bgId ? `background session ${r.bgId}. Watch it with: claude attach ${r.bgId}` : o.foreground ? 'ran in this terminal' : 'started; it will appear in claude agents shortly'}`,
    `  packet:   ${r.packetPath}`,
    r.shares.length ? tone(`  ${sharesWords(r.shares)}. The second pull request to merge may conflict there.`, 'dim') : '',
  ].filter(Boolean).join('\n'), r);
  return 0;
}

/** What acc dispatch --held did: each start, each failure in orange, and what still waits (D-093). */
function heldLines(r: StartHeldResult): string[] {
  const lines = [
    ...r.started.map((s) => tone(`✓ ${s.task}  ${startedWords(s)}.${s.bgId ? ` Watch it with: claude attach ${s.bgId}` : ''}`, 'blue')),
    ...r.failed.flatMap((f) => [tone(`! ${f.task}  Couldn't start it: ${f.reason}`, 'orange'), tone(`    It isn't tried again until a person dispatches it, or stops it waiting: acc dispatch ${f.task} --stop-waiting`, 'dim')]),
    ...r.waiting.map((w) => tone(`… ${w.task}  Waiting: ${w.reason}`, 'dim')),
  ];
  return lines.length ? lines : ['No task waits for another\'s files.'];
}

function cmdCleanup(o: Opts, id: string): number {
  const { paths, config } = project(process.cwd());
  const r = cleanup(paths, config, id.toUpperCase(), run, now);
  out(o, () => (r.removed ? `Removed ${r.worktree}.` : `Kept ${r.worktree ?? 'the worktree'}:\n- ${r.reasons.join('\n- ')}`), r);
  return r.removed ? 0 : 1;
}

/**
 * Carries on a running task whose builder stopped before acc done or acc block (D-067): its own session,
 * in its worktree, with the rules it was dispatched with. A person's, or autopilot's, never an agent's.
 */
function cmdResume(o: Opts, id: string): number {
  const role = process.env.ACC_ROLE;
  if (role === 'builder' || role === 'reviewer' || role === 'analyst') throw new AccError('refused', `${role === 'analyst' ? 'An' : 'A'} ${role} can't resume a builder. A person does that, or autopilot.`);
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const r = resume(paths, config, id.toUpperCase(), { run, now, env: process.env, accBinDir: accBinDir(), accCommand: accCommand() }, {
    actor, by, message: o.message as string | undefined,
  });
  out(o, () => [
    tone(`${r.task.id} resumed: its builder carries on in ${r.folder}.`, 'blue'),
    r.stopped ? `  Stopped its idle background session ${r.stopped} first, so the conversation runs in one place.` : '',
    r.said ? `  It last said: ${clipSaid(r.said, 600)}` : '',
    `  Its output: ${r.log}`,
    tone(`  It finishes with acc done, or blocks. Session ${r.sessionId}, pid ${r.pid}.`, 'dim'),
  ].filter(Boolean).join('\n'), r);
  return 0;
}

/** The note acc done or acc block was given (D-???), or null when it was given none. */
function noteFrom(o: Opts): NoteInput | null {
  const n = noteInput({ landed: o.landed as string[] | undefined, moved: o.moved as string[] | undefined, open: o.open as string[] | undefined });
  return noteGiven(n) ? n : null;
}

export const area: CommandArea = {
  help: {
    section: 'Agents',
    order: 30,
    lines: `  acc dispatch <id> [--foreground] [--without-analysis] [--anyway] [--model <m>]
                                        Worktree, setup, instructions, and a background builder session. A task
                                        whose analysis shares files with work in flight waits while another
                                        Ready task shares none; --anyway starts it now. --model picks the
                                        builder's model for this task: a re-dispatch and a resume keep it.
                                        Without one, the builder's model (acc agents)
  acc dispatch --held                   Start the tasks that wait for others' files and may go now
  acc dispatch <id> --stop-waiting      It stops waiting, and stays to do
  acc done [<id>] --landed "<line>"... --moved "<line>"... --open "<line>"...
                                        A builder's finish line: moves its task to review, with a note for
                                        whoever comes next: what landed, which numbers moved (tests, checks,
                                        ratchets), and what's still open. A builder must give all three. A
                                        flag again adds a line; --moved none or --open none says there was
                                        nothing
  acc block [<id>] "<reason>" [--landed …] [--moved …] [--open …]
                                        A builder's way out when stuck, with a note if it has one
  acc block [<id>] --client "<question>"
                                        Stuck on something only the client can answer: blocks, and drafts an
                                        update for the ticket that a person reviews before posting
  acc resume <id> [--message "<text>"]  Carry on a running task whose builder stopped before acc done or acc
                                        block, as when the Mac slept: its own session, in its worktree, with the
                                        rules it was dispatched with. It's told it was cut off, or --message
  acc cleanup <id>                      Remove a finished task's worktree, only if nothing would be lost
  acc agents                            The model and effort builders and reviewers run with, and where each is
                                        set. A model nobody set is acc's default, claude-opus-5-5
  acc agents set <builder|reviewer> [--model <m>] [--effort <low|medium|high|xhigh|max>] [--fallback-model <m>]
                [--clear <model|effort|fallback-model>]... [--project]
                                        Change them for this clone, or with --project in .acc/config.json
  acc agents autonomy [manual|review]   What autopilot may do on its own, or change it in .acc/config.json
  acc agents auto-merge [on|off]        Whether autopilot merges a reviewed pull request whose checks passed, into
                                        an environment that isn't protected, or change it in .acc/config.json
  acc machine heavy-slots [<n>]         How many heavy checks (builds, tests, validations) this machine runs at once,
                                        for every repo on it; with <n>, set it (1 to 8) in ~/.acc/machine.json`,
  },
  options: {
    foreground: { type: 'boolean', default: false },
    'without-analysis': { type: 'boolean', default: false },
    anyway: { type: 'boolean', default: false },
    held: { type: 'boolean', default: false },
    'stop-waiting': { type: 'boolean', default: false },
    model: { type: 'string' },
    effort: { type: 'string' },
    'fallback-model': { type: 'string' },
    clear: { type: 'string', multiple: true },
    project: { type: 'string' },
    client: { type: 'string' },
    reason: { type: 'string' },
    message: { type: 'string' },
    // A builder's handoff note (D-???), a line each time a flag is given.
    landed: { type: 'string', multiple: true },
    moved: { type: 'string', multiple: true },
    open: { type: 'string', multiple: true },
  },
  // --project names the project for acc init, and is a plain switch for acc agents set: give the switch a
  // value, so the Command Center's "for the project" works (D-036).
  argv: { agents: (argv) => argv.map((x) => (x === '--project' ? '--project=yes' : x)) },
  commands: {
    agents: (o, rest) => cmdAgents(o, rest[0], rest[1]),
    machine: (o, rest) => cmdMachine(o, rest[0], rest[1]),
    dispatch: (o, rest) => cmdDispatch(o, rest[0]),
    done: (o, rest) => cmdSet(o, taskIdFrom(rest[0]), 'review', noteFrom(o)),
    block: (o, rest) => {
      const [first, ...more] = rest;
      // An id with words after it, or with --client, whose question is the reason: acc block ACME-7 --client "…".
      const looksLikeId = !!first && /^[A-Z][A-Z0-9_]*-\d+$/i.test(first) && (more.length > 0 || typeof o.client === 'string');
      const id = taskIdFrom(looksLikeId ? first : undefined);
      const client = typeof o.client === 'string' ? o.client.trim() : '';
      // A question for the client is the reason too, so the board says what it waits on.
      const reason = (o.reason as string | undefined) ?? ((looksLikeId ? more : rest).join(' ').trim() || (client ? `Waiting on the client: ${client}` : ''));
      if (!reason) throw new AccError('usage', 'acc block "<what you need>", or acc block --client "<question>" when only the client can answer');
      return cmdSet({ ...o, reason }, id, 'blocked', noteFrom(o));
    },
    resume: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc resume <id> [--message "<text>"]');
      return cmdResume(o, rest[0]);
    },
    cleanup: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc cleanup <id>');
      return cmdCleanup(o, rest[0]);
    },
  },
};
