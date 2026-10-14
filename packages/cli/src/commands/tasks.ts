// acc's Tasks commands: add, import, intake, status, list, ready, show and set.

import { AccError, autopilotFailure, BUILDER_PLACE_LOOK, builderStopped, cardFailure, claudeProjectsDir, clipSaid, closedPr, cloudWait, type Config, DISPLAY, displayState, type DisplayState, draftUpdate, failedChecks, filesOf, holdWords, inFlight, intakeGithub, intakeOutside, type IntakeResult, isReady, lastSaid, listSessions, moveTask, mutate, NOTE_LABELS, type NoteInput, ordinal, phaseWords, plannedFiles, queuePlaces, readAnalysis, readLedger, receiptHooks, repoPaths, resuming, run, shownNote, type Task, sharesWords, startLook, type StartLook, type State, type TaskInput, trackerForKey, type UpsertResult, upsertTasks, waits, wordingMatch, wordingPlace, wordingWords } from '../../../core/src/index.ts';
import { type Outside, TRACKER_KINDS, type TrackerKind, trackerName } from '../../../core/src/trackers/types.ts';
import { stateLabel, table, tone } from '../format.ts';
import { actorFrom, type CommandArea, followingCards, now, type Opts, out, project, readFileArg, stepWords } from '../shared.ts';

// ---------------------------------------------------------------- tasks

function readInput(file: string | undefined): unknown {
  const text = readFileArg(file ?? 0);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AccError('usage', `The input isn't valid JSON: ${(e as Error).message}`);
  }
}

const upsertLines = (res: UpsertResult): string[] => [
  res.added.length ? `Added ${res.added.join(', ')}` : '',
  res.updated.length ? `Updated ${res.updated.join(', ')}` : '',
  res.unchanged.length ? `Unchanged ${res.unchanged.join(', ')}` : '',
  ...res.errors.map((e) => tone(`✗ ${e}`, 'orange')),
];

function upsert(o: Opts, inputs: TaskInput[], own = false): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const held = own ? ownTickets(config, inputs) : { inputs, refused: [] };
  const res = mutate(paths, now, (ledger, emit) => upsertTasks(ledger, config, held.inputs, actor, by, emit, now));
  res.errors.push(...held.refused);
  out(o, () => upsertLines(res).filter(Boolean).join('\n') || 'Nothing to do.', res);
  return res.errors.length ? 1 : 0;
}

/**
 * The tasks whose Jira, Azure DevOps or monday.com key a tracker in .acc/config.json owns, and why the rest are refused,
 * so another project's or client's tickets never become tasks here (D-072). Without a Jira sign-in acc can't
 * check an epic, so only the project is held here; the board's check removes strays. A repo that names no
 * trackers has no place to hold to, and takes any.
 */
function ownTickets(config: Config, inputs: TaskInput[]): { inputs: TaskInput[]; refused: string[] } {
  if (!config.trackers.length) return { inputs, refused: [] };
  const refused: string[] = [];
  const kept = inputs.filter((i) => {
    const kind = i?.source?.kind;
    const key = i?.source?.key;
    if (!isSignedInKind(kind) || typeof key !== 'string') return true;
    const at = trackerForKey(config.trackers, key);
    if (at !== null && config.trackers[at]!.kind === kind) return true;
    refused.push(`${key.toUpperCase()}: no ${trackerName(kind)} tracker in .acc/config.json owns it, so it isn't one of this repo's tickets.`);
    return false;
  });
  return { inputs: kept, refused };
}

/** What intake changed beyond adding and refreshing: done, removed, and named for a person (D-048, D-072). */
const intakeLines = (res: IntakeResult): string[] => {
  const skipped = res.removed.filter((id) => !res.left.includes(id));
  return [
    res.closed.length ? `Done ${res.closed.join(', ')}: closed on GitHub before work started` : '',
    skipped.length ? `Removed ${skipped.join(', ')}: their issues have a label in skipLabels` : '',
    res.left.length ? `Removed ${res.left.join(', ')}: their tickets left this repo's place before work started` : '',
    ...res.leftAlone.map((l) => tone(`! ${l.note}`, 'orange')),
  ];
};

/** Reads open issues in the repo's place as its own GitHub account (D-007), upserts them, and follows closed, skipped and outside ones (D-048, D-072). Never changes GitHub. */
function cmdIntakeGithub(o: Opts): number {
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const res = followingCards(paths, config, () => intakeGithub(paths, config, { run, now, env: process.env }, { label: o.label as string | undefined, actor, by }));
  out(o, () => [...upsertLines(res), ...intakeLines(res)].filter(Boolean).join('\n') || 'Nothing to do.', res);
  return res.errors.length ? 1 : 0;
}

/** The trackers only the Command Center signs in to (D-066): every one but GitHub. */
type SignedInKind = Exclude<TrackerKind, 'github'>;
const SIGNED_IN_KINDS = TRACKER_KINDS.filter((k): k is SignedInKind => k !== 'github');
const isSignedInKind = (k: unknown): k is SignedInKind => (SIGNED_IN_KINDS as readonly unknown[]).includes(k);

/**
 * Follows Jira, Azure DevOps or monday.com tickets that left the repo's place (D-072). Only the Command
 * Center signs in to those (D-066), so it reads them and hands acc what it found: { "outside": [{ "key", "why" }] }.
 */
function cmdIntakeOutside(o: Opts, kind: SignedInKind): number {
  const file = o.file as string | undefined;
  if (!file) throw new AccError('usage', `acc intake ${kind} --file <report.json>, with { "outside": [{ "key": "ACME-7", "why": "it isn't in epic ACME-3" }] }. The Command Center writes it after a board loads.`);
  const data = readInput(file) as { outside?: unknown };
  const list = data?.outside;
  if (!Array.isArray(list) || !list.every((x) => typeof x?.key === 'string' && typeof x?.why === 'string')) {
    throw new AccError('usage', `${file} must hold { "outside": [{ "key": "<ticket key>", "why": "<why it's outside>" }] }.`);
  }
  const { paths } = project(process.cwd());
  const res = intakeOutside(paths, kind, list as Outside[], now);
  out(o, () => intakeLines(res).filter(Boolean).join('\n') || 'Nothing to do.', res);
  return 0;
}

function cmdList(o: Opts, onlyReady: boolean): number {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const want = o.state as string | undefined;
  const tasks = ledger.tasks.filter((t) => (onlyReady ? isReady(ledger, t) : !want || t.state === want || displayState(ledger, t, undefined, config) === want));
  out(o, () => {
    if (!tasks.length) return onlyReady ? 'Nothing is ready.' : 'No tasks.';
    return table([['Id', 'State', 'Env', 'Title', 'Waiting on'], ...tasks.map((t) => [
      t.id, stateLabel(displayState(ledger, t, undefined, config)), t.environment, t.title,
      t.deps.filter((d) => ledger.tasks.find((x) => x.id === d)?.state !== 'done').join(', '),
    ])]);
  }, tasks.map((t) => ({ ...t, display: displayState(ledger, t, undefined, config), ready: isReady(ledger, t) })));
  return 0;
}

function cmdStatus(o: Opts): number {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  // In the order the line reads: work in flight, then what waits to start.
  const counts: Record<DisplayState, number> = { running: 0, 'needs-you': 0, review: 0, rework: 0, blocked: 0, ready: 0, todo: 0, done: 0 };
  // The ledger alone, without session info, so this never starts claude.
  for (const t of ledger.tasks) counts[displayState(ledger, t, undefined, config)]++;
  out(o, () => {
    const parts = (Object.keys(counts) as DisplayState[])
      .filter((s) => s !== 'done' && counts[s] > 0)
      .map((s) => tone(`${counts[s]} ${DISPLAY[s].label.toLowerCase()}`, DISPLAY[s].tone));
    return parts.length ? parts.join(' · ') : 'Nothing in play.';
  }, { counts });
  return 0;
}

/** What acc show says about a task to do and other tasks' files (D-093): it waits for them, shares them, or its own aren't known. */
function fileLines(paths: ReturnType<typeof repoPaths>, config: Config, ledger: ReturnType<typeof readLedger>, t: ReturnType<typeof readLedger>['tasks'][number]) {
  const analysis = readAnalysis(paths, t.id);
  const planned = plannedFiles(analysis, paths.root);
  // Files that aren't known share nothing, so work in flight isn't looked at for them.
  const look: StartLook = planned ? startLook(paths, config, ledger, run, t.id, { files: planned }) : { shares: [], first: [] };
  const held = t.held;
  const lines: string[] = [];
  if (held?.failed) lines.push(tone(`! Its start failed: ${held.failed.reason} Dispatch it again, or stop it waiting: acc dispatch ${t.id} --stop-waiting`, 'orange'));
  else if (held && waits(look)) lines.push(tone(`${holdWords(look)}. It starts on its own once they're free, or: acc dispatch ${t.id} --anyway`, 'blue'));
  else if (held) lines.push(tone(`It waited for ${filesOf(held.waitsFor)}, and may start now: the Command Center or autopilot starts it, or: acc dispatch --held`, 'blue'));
  else if (!planned) lines.push(tone(`Its files aren't known: ${analysis ? 'its analysis names no files' : 'it has no analysis'}, so it never waits for another task's.`, 'dim'));
  else if (look.shares.length) lines.push(tone(`${sharesWords(look.shares)}.`, 'dim'));
  return { lines, data: { known: !!planned, planned: planned ?? [], ...look } };
}

/** The note its builder left (D-106), or its last run's while a new one runs, or that it left none. */
function noteShown(t: Task): string[] {
  const { note, fromLast, missing } = shownNote(t);
  if (!note) return missing ? [tone(fromLast ? 'Its last run left no note.' : 'Its builder left no note.', 'orange'), ''] : [];
  const parts = (['landed', 'moved', 'open'] as const).flatMap((k) => [`  ${NOTE_LABELS[k]}:`, ...(note[k].length ? note[k].map((l) => `    - ${l}`) : ['    none'])]);
  return [`Builder's note${fromLast ? ', from its last run' : ''} (${note.by}, ${note.ended === 'blocked' ? 'blocked' : 'to review'} ${note.at}):`, ...parts, ''];
}

function cmdShow(o: Opts, id: string): number {
  const { paths, config } = project(process.cwd());
  const ledger = readLedger(paths.ledger);
  const t = ledger.tasks.find((x) => x.id === id.toUpperCase());
  if (!t) throw new AccError('no-task', `No task ${id}.`);
  const failed = autopilotFailure(t);
  const closed = closedPr(t);
  // acc couldn't move its card on the GitHub Project as it entered this state (GH-146).
  const card = cardFailure(t)?.replace(/[.\s]+$/, '');
  // Its pull request's checks failed on GitHub, or autopilot sent it back for them (D-076).
  const checks = failedChecks(t);
  // Its place in the repo's merge queue, and what it waits on (GH-73).
  const place = queuePlaces(ledger, config).find((p) => p.id === t.id);
  // Whether its builder stopped before acc done or acc block (D-067): only a running task asks Claude Code.
  const stopped = t.state === 'running' && builderStopped(t, listSessions(run, paths.root), { resuming: !!resuming(paths, t.id), now: now() });
  const said = stopped && t.run?.sessionId ? lastSaid(claudeProjectsDir(), t.run.sessionId, [t.run.worktree, paths.root]) : null;
  const quote = said ? clipSaid(said, 600) : null;
  // A task to do: what it shares with work in flight, or that its files aren't known (D-093).
  const files = t.state === 'todo' ? fileLines(paths, config, ledger, t) : { lines: [], data: null };
  // A task that started beside others it shares files with, while they're still in flight.
  const flying = new Set(inFlight(ledger).map((x) => x.id));
  const shared = (t.run?.shares ?? []).filter((s) => flying.has(s.task));
  // A cloud builder (GH-69): where it runs, its page on claude.ai, and why it needs you, if it does.
  const cloud = t.run?.where === 'cloud' ? t.run.cloud ?? null : null;
  const waiting = cloudWait(t, config, now());
  // The wording check on its analysis's requirements (T-12): advice for a person, never a hold.
  const wording = readAnalysis(paths, t.id)?.wording ?? [];
  out(o, () => [
    `${t.id}  ${stateLabel(displayState(ledger, t, { stopped, quiet: !!waiting }, config))}  ${t.title}`,
    `Environment: ${t.environment}   Source: ${t.source.kind}${t.source.url ? ` ${t.source.url}` : ''}`,
    t.run?.name ? `Agent: ${t.run.name}${t.run.where ? ` · runs on ${BUILDER_PLACE_LOOK[t.run.where].label}` : ''}` : '',
    cloud ? `Cloud session: ${cloud.url}${t.state === 'running' ? ` (branch last moved ${cloud.lastPushAt}${cloud.finished ? ', finished' : ''})` : ''}` : '',
    waiting ? tone(`! ${waiting.charAt(0).toUpperCase()}${waiting.slice(1)}. Open the session, or: acc collect ${t.id}`, 'orange') : '',
    t.deps.length ? `Depends on: ${t.deps.join(', ')}` : '',
    t.blocker ? `Blocked: ${t.blocker}` : '',
    failed ? tone(`! Autopilot couldn't ${stepWords(failed.step, failed.sha || 'it')}: ${failed.reason}`, 'orange') : '',
    checks ? tone(`! Checks failed on GitHub: ${checks.join(', ')}`, 'orange') : '',
    place ? tone(`In the merge queue: ${place.ahead ? `${ordinal(place.place)} of ${place.of}, behind ${place.ahead}` : place.phase === 'held' ? `first of ${place.of}, waiting: ${phaseWords(place.phase, t.environment, place.why)}` : `first of ${place.of}: ${phaseWords(place.phase, t.environment).toLowerCase()}`}.`, 'blue') : '',
    card ? tone(`! Its card couldn't move on its GitHub Project: ${card}.`, 'orange') : '',
    closed ? tone(`! Pull request #${closed.number} was closed without merging. Reopen it on GitHub and land to update it, or land to open a new one.`, 'orange') : '',
    stopped ? tone(`! Its agent stopped: ${quote ?? 'its turn ended before acc done or acc block.'}${quote && !/[.!?…]$/.test(quote) ? '.' : ''} Resume it with acc resume ${t.id}.`, 'orange') : '',
    ...files.lines,
    ...(wording.length ? [tone(`! ${wordingWords(wording.length)} in its analysis's requirements. They're advice: they never hold a dispatch.`, 'orange'), ...wording.flatMap((f) => [`  ${wordingPlace(f)}: ${f.message}${wordingMatch(f) ? ` [${f.match}]` : ''}`, tone(`    ${f.text}`, 'dim')])] : []),
    shared.length ? tone(`${sharesWords(shared)}.`, 'dim') : '',
    t.brief ? `\n${t.brief}\n` : '',
    ...noteShown(t),
    'History:',
    ...t.history.map((h) => `  ${h.at}  ${h.from ?? '–'} → ${h.to}  by ${h.by}${h.reason ? `: ${h.reason}` : ''}${h.override ? ' (override)' : ''}`),
  ].filter(Boolean).join('\n'), { ...t, stopped: stopped ? { said } : null, files: files.data, cloudWait: waiting, wording });
  return 0;
}

export function cmdSet(o: Opts, id: string, to: string, note: NoteInput | null = null): number {
  const client = typeof o.client === 'string' ? o.client.trim() : undefined;
  if (o.client !== undefined && to !== 'blocked') throw new AccError('usage', '--client goes with blocking: acc block --client "<question>".');
  if (o.client !== undefined && !client) throw new AccError('usage', 'acc block --client "<the question, for the client>"');
  const { paths, config } = project(process.cwd());
  const { actor, by } = actorFrom(o);
  const { task, entry } = followingCards(paths, config, () => moveTask(paths, config, id.toUpperCase(), {
    to: to as State, actor, by, reason: (o.reason as string | undefined) ?? (client ? `Waiting on the client: ${client}` : null), force: o.force === true, note,
  }, receiptHooks(paths, config, run), now));
  // Only the client can answer it: the ticket gets a draft, which a person reads before it's posted (D-066).
  const update = client ? draftUpdate(paths, task, { event: 'blocked', context: { question: client } }, by, now) : null;
  out(o, () => [
    `${task.id}: ${entry.from} → ${stateLabel(displayState(readLedger(paths.ledger), task, undefined, config))}${entry.override ? ' (override recorded)' : ''}`,
    task.run?.note && note ? '  Your note is kept with the run: the reviewer, the next builder and the pull request read it.' : '',
    update ? `  Drafted an update for ${update.key} (${update.id}) with your question. A person reads it before it's posted.` : '',
    client && !update ? `  ${task.id} has no ticket to post a question on: a person passes it on.` : '',
  ].filter(Boolean).join('\n'), { task, entry, ...(client ? { update } : {}) });
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Tasks',
    order: 20,
    lines: `  acc add "<title>" [--brief <text>] [--dep <id>]... [--env <branch>] [--key <T-n>]
  acc import [--file <tasks.json>]      Add or refresh tasks from JSON (stdin by default). A Jira, Azure DevOps or
                                        monday.com key that no tracker in .acc/config.json owns is refused
  acc intake github [--label <l>]       Add or refresh tasks from the open GitHub issues in the repo's place: its
                                        tracker's repo, and its labels if it names some. A task not started yet
                                        leaves the board when its issue closes, has a skipLabels label, or leaves
                                        the place
  acc intake jira|azure|monday|slack --file <report.json>
                                        Follow tickets the Command Center found outside the repo's place, from
                                        { "outside": [{ "key", "why" }] }: a task not started yet leaves the board
  acc status                            One line: how many tasks are in each state
  acc list [--state <state>]
  acc ready
  acc show <id>
  acc set <id> <state> [--reason <text>] [--force] [--as <actor>] [--by <name>]`,
  },
  options: {
    brief: { type: 'string' },
    dep: { type: 'string', multiple: true },
    env: { type: 'string' },
    key: { type: 'string' },
    file: { type: 'string' },
    state: { type: 'string' },
    reason: { type: 'string' },
    force: { type: 'boolean', default: false },
    label: { type: 'string' },
    client: { type: 'string' },
  },
  subcommands: { intake: ['github', ...SIGNED_IN_KINDS] },
  commands: {
    add: (o, rest) => {
      const title = rest.join(' ').trim();
      if (!title) throw new AccError('usage', 'acc add "<title>"');
      return upsert(o, [{ source: { kind: 'manual', key: (o.key as string | undefined) ?? null }, title, brief: o.brief as string | undefined, deps: (o.dep as string[] | undefined) ?? [], environment: o.env as string | undefined }]);
    },
    import: (o) => {
      const data = readInput(o.file as string | undefined);
      if (!Array.isArray(data)) throw new AccError('usage', 'acc import expects a JSON list of tasks.');
      return upsert(o, data as TaskInput[], true);
    },
    intake: (o, rest) => {
      if (rest[0] === 'github') return cmdIntakeGithub(o);
      if (isSignedInKind(rest[0])) return cmdIntakeOutside(o, rest[0]);
      throw new AccError('usage', 'acc intake github [--label <label>], or acc intake jira|azure|monday|slack --file <report.json>. Jira, Azure DevOps and monday.com tickets come in through the Command Center\'s Track in acc; Jira and Azure DevOps ones also through the plugin\'s skill.');
    },
    status: (o) => cmdStatus(o),
    list: (o) => cmdList(o, false),
    ready: (o) => cmdList(o, true),
    show: (o, rest) => {
      if (!rest[0]) throw new AccError('usage', 'acc show <id>');
      return cmdShow(o, rest[0]);
    },
    set: (o, rest) => {
      if (!rest[0] || !rest[1]) throw new AccError('usage', 'acc set <id> <state> [--reason <text>]');
      return cmdSet(o, rest[0], rest[1]);
    },
  },
};
