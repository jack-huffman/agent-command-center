import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { Hub } from './hub.ts';
import type { Answer } from '../../packages/core/src/questions.ts';
import { agentArgs, withCloneAgents } from '../../packages/core/src/agents.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { resumeCommand } from '../../packages/core/src/resume.ts';
import { recordRuntime } from '../../packages/core/src/runtime.ts';
import { AgentPages } from './activity.ts';
import { AutopilotHost } from './autopilot.ts';
import { type AgentSession, isWebviewMenuContext, shq } from './logic/shared.ts';
import { analysisAnswerArgs, followsPullRequests } from './logic/tasks.ts';
import { CLAUDE_EXTENSION, claudeSessionUri, isSessionId } from './logic/agents.ts';
import { POLL_INTERVALS, POLL_KEYS, type PollKey } from './logic/polls.ts';
import type { NavItem } from './model/home.ts';
import { needsYouCount } from './model/overview.ts';
import { type Ref, sessionKey, VIEW_KINDS, type ViewKind } from './model/shared.ts';
import { Notices } from './notices.ts';
import { Panels } from './panels.ts';
import { accShellCommand, Questions, sessionSettings } from './questions.ts';
import { Runs } from './runs.ts';
import { accRunner, runFile } from './run.ts';
import { claudeProjectsDir, savedFolder } from './transcript.ts';
import { Setup } from './setup.ts';
import { Sidebar } from './sidebar.ts';
import { RepoIdentity } from './identity.ts';
import { TicketPanels, type UpdateActions } from './ticket.ts';
import { exec, Trackers } from './trackers.ts';
import { ConnectSession } from './connect.ts';
import { Slack, slackCard, SLACK_STATE } from './slack.ts';
import { trackerName } from '../../packages/core/src/trackers/types.ts';
import { AREAS } from './areas.ts';
import type { Parts } from './area.ts';


export function activate(context: vscode.ExtensionContext): void {
  const setup = new Setup(context);
  // Recorded before anything can start acc's launcher, which runs acc on this runtime wherever node 20 or
  // later isn't on PATH (D-077).
  try {
    if (recordRuntime(process.execPath)) setup.log.info(`Recorded ${process.execPath} as the runtime acc uses when node isn't on PATH.`);
  } catch (e) {
    setup.log.warn(`Couldn't record VSCode's runtime for acc, so acc needs node on PATH outside this window: ${(e as Error).message}`);
  }
  const hub = new Hub();
  // The extension runs the bundle itself, on its own runtime (D-012). Terminals and builders get the
  // launcher beside it, `acc`, on PATH.
  const accScript = context.asAbsolutePath(join('dist', 'bin', 'acc.mjs'));
  // acc follows tickets that left a board's place (D-072).
  const trackers = new Trackers(context.secrets, hub, setup.log, accRunner(accScript));
  context.subscriptions.push(setup, hub, trackers);

  // Every VSCode terminal gets the acc command (D-012), with no separate install.
  context.environmentVariableCollection.description = 'Adds the acc command from Agent Command Center.';
  context.environmentVariableCollection.prepend('PATH', dirname(accScript) + delimiter);

  const reg = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // acc's notices in Slack (GH-58): one webhook for this machine, in VSCode's secret storage, off until a
  // person turns it on on the Environments section's card. Every window offers what it sees; one sends it.
  const slack = new Slack({
    secrets: context.secrets,
    state: { get: () => context.globalState.get(SLACK_STATE), set: (s) => context.globalState.update(SLACK_STATE, s) },
    log: (line, warn) => (warn ? setup.log.warn(line) : setup.log.info(line)),
    paused: (reason) => void vscode.window.showWarningMessage(`acc's notices to Slack are paused: ${reason}. Send a test from Environments once it's fixed, or paste a new webhook.`, 'Open Environments')
      .then((pick) => pick && panels.show('environments')),
    changed: () => changed(),
  });
  slack.prune();

  // Commands acc runs for you show their output in the page (D-030). Only a command that needs a
  // keyboard of its own still opens a terminal.
  const terminals = new Map<string, vscode.Terminal>();
  const inTerminal = (command: string, cwd: string) => {
    let t = terminals.get(cwd);
    if (!t || t.exitStatus) { t = vscode.window.createTerminal({ name: 'acc', cwd, iconPath: new vscode.ThemeIcon('terminal') }); terminals.set(cwd, t); }
    t.show();
    t.sendText(command, true);
  };
  const runs = new Runs(setup.log, inTerminal, dirname(accScript), context.workspaceState);
  setup.useRuns(runs);
  context.subscriptions.push(runs);
  const identity = new RepoIdentity(hub, accRunner(accScript), () => setup.githubSignIn(null), () => {
    for (const id of ['A2.gh-login', 'B2.account', 'B2.credentials']) void setup.recheck(id);
  });
  context.subscriptions.push(identity);

  // Poll quickly while the page is on screen, and slowly, for the status bar and notices, while it isn't
  // (D-044). VSCode stays light: the author's machine stutters under load.
  let pageVisible = false;
  const inPlay = () => hub.projects.some((p) => hub.taskRows(p.root).some((t) => t.state === 'running' || !!t.reviewing || !!t.analyzing));
  // How often each is looked at is logic/polls.ts's, which the Settings section says too (GH-109).
  const POLLS: Record<PollKey, () => Promise<void>> = {
    tasks: () => hub.loadTasks(),
    // In progress (D-092): slots, job markers and builders' latest steps. Stats and small reads; a builder's
    // transcript only when it changed, and only while the page is on screen.
    jobs: () => hub.loadJobs(pageVisible),
    agents: () => (pageVisible || inPlay() ? hub.loadAgents() : Promise.resolve()),
    worktrees: () => hub.loadWorktrees(),
    // Tracker boards are network calls, so they refresh slowly, and at once after any move.
    boards: () => trackers.loadBoards(),
    // Open pull requests (D-033): merged → done, closed → blocked, failing checks or conflicts → needs you.
    // An open promotion too: its merge drafts each ticket's "now in" update (D-075).
    // And an issue acc hasn't closed yet, so a failed close is tried again (D-082).
    prs: async () => {
      for (const p of hub.projects) {
        if (!hub.taskRows(p.root).some(followsPullRequests)) continue;
        const r = await accRunner(accScript)(['sync', '--json'], p.root);
        if (r.code !== 0) setup.log.warn(`acc sync in ${p.name}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
      }
      await hub.loadTasks();
    },
  };
  const pagePolls = (visible: boolean) => {
    pageVisible = visible;
    for (const key of POLL_KEYS) {
      const ms = visible ? POLL_INTERVALS[key].everyMs : POLL_INTERVALS[key].hiddenMs;
      hub.poll(key, ms ?? 0, POLLS[key], !!ms);
    }
  };

  // ------------------------------------------------------------ the same views as editor tabs
  /** Turns a tab's Ref back into the sidebar's node, so every command works the same from either place. */
  const nodeFor = (ref: Ref): unknown => {
    const project = ref.project ? hub.project(ref.project) : undefined;
    if (ref.step) return ref.step;
    if (ref.task) {
      const task = project && hub.taskRows(project.root).find((t) => t.id === ref.task);
      return task ? { kind: 'task', project, task } : undefined;
    }
    if (ref.session) {
      const session = hub.agents.find((a) => (a.sessionId ?? a.id ?? `${a.pid ?? ''}:${a.startedAt}`) === ref.session);
      return session ? { kind: 'agent', session, project: hub.projectFor(session.cwd) } : undefined;
    }
    if (ref.worktree) {
      const worktree = project?.worktrees.find((w) => w.path === ref.worktree);
      return worktree ? { kind: 'worktree', project, worktree } : undefined;
    }
    if (ref.env) {
      const env = project?.config.environments.find((e) => e.branch === ref.env);
      return env ? { kind: 'env', project, env } : undefined;
    }
    return undefined;
  };
  const resolve = (command: string, ref: Ref): unknown => {
    const arg = nodeFor(ref);
    return arg === undefined ? undefined : vscode.commands.executeCommand(command, arg);
  };
  // Commands run from a tab's native context menu get the row's data-vscode-context; turn it into the node.
  const regNode = (id: string, fn: (...args: any[]) => unknown) => reg(id, (a: unknown, ...rest: unknown[]) => fn(isWebviewMenuContext(a) ? nodeFor(a.accRef as Ref) : a, ...rest));
  /**
   * A person's answer to one of a task's analysis's questions, from either page (D-052). acc records it
   * (D-012): the page never writes the analysis itself. What acc refuses, it says why.
   */
  const answerAnalysis = async (root: string, task: string, question: string, text: string): Promise<{ ok: boolean; error?: string }> => {
    const p = hub.project(root);
    if (!p) return { ok: false, error: 'That project isn\'t open here.' };
    const r = await accRunner(accScript)(analysisAnswerArgs(task, question, text), p.root);
    await hub.loadTasks(true);
    if (r.code === 0) return { ok: true };
    let error = (r.stderr || r.stdout).trim().split('\n')[0] || `acc exited ${r.code}`;
    try { error = (JSON.parse(r.stdout) as { message?: string }).message ?? error; } catch { /* plain text */ }
    void vscode.window.showWarningMessage(`Couldn't answer ${task}'s question: ${error}`);
    return { ok: false, error };
  };
  /** What acc said when it refused, in its own words. */
  const accSays = (r: { code: number; stdout: string; stderr: string }): string => {
    let error = (r.stderr || r.stdout).trim().split('\n')[0] || `acc exited ${r.code}`;
    try { error = (JSON.parse(r.stdout) as { message?: string }).message ?? error; } catch { /* plain text */ }
    return error;
  };
  /**
   * A ticket's updates, posted as you, set aside, or drafted from an analysis's question, all through acc
   * (D-066). GitHub posts through acc as the repo's account (D-028). Jira and Azure DevOps post through this
   * repo's sign-in (D-027): acc claims the draft first, so a second window's Post can't send it again, and
   * records it once it's gone, or puts it back with why.
   */
  const updates: UpdateActions = {
    post: async (root, id, text, again) => {
      const p = hub.project(root);
      if (!p) return { ok: false, error: 'That project isn\'t open here.' };
      const u = hub.updates(root).find((x) => x.id === id);
      if (!u) return { ok: false, error: `${id} isn't there any more: a newer draft replaced it, or it was posted.` };
      const acc = accRunner(accScript);
      const dir = mkdtempSync(join(tmpdir(), 'acc-update-'));
      const file = join(dir, 'text.md');
      writeFileSync(file, text);
      const fail = (error: string) => {
        void vscode.window.showWarningMessage(`Couldn't post ${id} on ${u.key}: ${error}`);
        return { ok: false, error };
      };
      try {
        const againArgs = again ? ['--again'] : [];
        if (u.tracker === 'github') {
          const r = await acc(['update', 'post', id, `--text-file=${file}`, ...againArgs, '--json'], p.root);
          return r.code === 0 ? { ok: true } : fail(accSays(r));
        }
        const name = trackerName(u.tracker);
        // Through the tracker that owns the key, not the first of its kind: a repo can have two Jira sites.
        const index = trackers.trackerFor(p, u.key);
        if (index === null || trackers.trackers(p)[index]?.kind !== u.tracker) return fail(`this repo has no ${name} tracker for ${u.key} to post through.`);
        if (!(await trackers.signedInAs(p, index))) return fail(`sign in to ${name} first.`);
        // Held to the project or monday.com board, not its narrower place (D-072): a ticket moved to another isn't posted on.
        let client: Awaited<ReturnType<typeof trackers.client>>;
        try {
          client = await trackers.client(p, index);
        } catch (e) {
          return fail((e as Error).message);
        }
        const away = (await client.outside([u.key], { project: true }))[0];
        if (away) return fail(`${u.key} isn't in this repo's ${name} ${u.tracker === 'monday' ? 'board' : 'project'} any more: ${away.why}. Discard the draft if it no longer applies.`);
        const claimed = await acc(['update', 'posting', id, ...againArgs, '--json'], p.root);
        if (claimed.code !== 0) return fail(accSays(claimed));
        try {
          await client.comment(u.key, text);
        } catch (e) {
          const why = (e as Error).message;
          await acc(['update', 'release', id, `--reason=${why}`, '--json'], p.root);
          return fail(why);
        }
        const recorded = await acc(['update', 'posted', id, `--text-file=${file}`, '--json'], p.root);
        if (recorded.code !== 0) return fail(`it posted, but acc couldn't record it: ${accSays(recorded)}`);
        return { ok: true };
      } finally {
        rmSync(dir, { recursive: true, force: true });
        await hub.loadTasks(true);
      }
    },
    discard: async (root, id) => {
      const p = hub.project(root);
      if (!p) return { ok: false, error: 'That project isn\'t open here.' };
      const r = await accRunner(accScript)(['update', 'discard', id, '--json'], p.root);
      await hub.loadTasks(true);
      return r.code === 0 ? { ok: true } : { ok: false, error: accSays(r) };
    },
    ask: async (root, task, question) => {
      const p = hub.project(root);
      if (!p) return { ok: false, error: 'That project isn\'t open here.' };
      const r = await accRunner(accScript)(['update', 'ask', task, question, '--json'], p.root);
      await hub.loadTasks(true);
      return r.code === 0 ? { ok: true } : { ok: false, error: accSays(r) };
    },
  };
  const tickets = new TicketPanels(context, hub, trackers, resolve, accRunner(accScript), answerAnalysis, updates);

  // Agents' questions and activity (D-030). Answering "in the terminal" hands the question back to
  // Claude Code's own prompt, and attaches to it.
  let questions: Questions | null = null;
  const answer = (id: string, a: Answer) => {
    const q = hub.questions.find((x) => x.id === id);
    if (!questions?.answer(id, a) || a.decision !== 'terminal' || !q) return;
    const s = hub.agents.find((x) => x.sessionId === q.sessionId);
    if (s) setTimeout(() => void resolve('acc.agent.attach', { session: sessionKey(s) }), 400);
  };
  // A message to an agent from its page (D-060): its own session, resumed in its own folder with the rules
  // it was dispatched with, so a builder stays a builder. One conversation runs in one place at a time.
  const reply = async (s: AgentSession, text: string, done: () => void): Promise<string | null> => {
    const sessionId = s.sessionId;
    if (!isSessionId(sessionId)) return 'it has no conversation to carry on.';
    const projects = hub.projects;
    const folder = savedFolder(claudeProjectsDir(process.env), sessionId, [s.cwd, ...projects.flatMap((p) => p.worktrees.map((w) => w.path))]);
    if (!folder) return 'its conversation isn\'t saved anywhere this machine can find.';
    const project = hub.projectFor(folder);
    const task = project ? hub.ledger(project.root)?.tasks.find((t) => t.run?.sessionId === sessionId || (!!s.id && t.run?.bgId === s.id)) : undefined;
    if (s.kind === 'background' && s.id && s.pid) {
      const stopped = await runFile('claude', ['stop', s.id], folder, process.env, undefined, 30_000);
      if (stopped.code !== 0) return `its background session wouldn't stop: ${(stopped.stderr || stopped.stdout).trim().split('\n')[0]}`;
    }
    // The Mac stays awake while it answers (D-067): caffeinate runs it, and ends with it.
    const awake = process.platform === 'darwin' ? 'caffeinate -i ' : '';
    let command: string;
    if (task && project) {
      // A builder's is acc resume's own command (D-067): its rules, and this clone's model and effort (D-036).
      const c = resumeCommand(task, withCloneAgents(project.config, project.root, runSync), { sessionId, message: text, accBinDir: dirname(accScript), basePath: process.env.PATH ?? '', accCommand: accShellCommand(accScript) });
      command = `${Object.entries(c.env).map(([k, v]) => `${k}=${shq(v)}`).join(' ')} ${awake}claude ${c.args.map(shq).join(' ')}`;
    } else {
      const mode = project?.config.agents.permissionMode ?? 'default';
      const extra = project ? agentArgs(project.config.agents.builder) : [];
      command = `${awake}claude -p ${shq(text)} --resume ${sessionId} --permission-mode ${shq(mode)} ${extra.map(shq).join(' ')} --settings ${shq(sessionSettings(accScript))}`.replace(/  +/g, ' ');
    }
    runs.start(command, { cwd: folder, label: `Message to ${task?.id ?? s.name ?? sessionId.slice(0, 8)}`, onExit: () => done() });
    return null;
  };
  const pages = new AgentPages(context, hub, resolve, answer, reply);
  context.subscriptions.push(pages);
  const sidebar = new Sidebar(hub, accRunner(accScript), setup.log, (root, key) => tickets.show(root, undefined, key), {
    run: (command, cwd, label, onExit, ok) => void runs.start(command, { cwd, label, onExit, ok }),
    watch: (key, ended, active) => pages.open(key, ended, active),
    sessionSettings: sessionSettings(accScript),
    accCommand: accShellCommand(accScript),
    openLater: async (folder, sessionId) => { await context.globalState.update(OPEN_LATER, { folder, sessionId, at: Date.now() }); },
  });
  // The Connect page (GH-51): one view in the Command Center connects a repo's tracker, changes its place
  // or board, or signs it in again, in place of prompts at the top of VSCode.
  const connect = new ConnectSession({
    projects: () => hub.projects,
    trackers: (root) => { const p = hub.project(root); return p ? trackers.trackers(p) : []; },
    title: (t) => trackers.title(t),
    storedSignIn: (root, kind, host) => trackers.storedSignIn(root, kind, host),
    ownSignIn: (root, kind, host) => trackers.ownSignIn(root, kind, host),
    storeSignIn: (root, kind, host, cred, shared) => trackers.storeSignIn(root, kind, host, cred, shared),
    gitEmail: (root) => trackers.gitEmail(root),
    ghToken: (root, account) => trackers.ghToken(root, account),
    microsoft: (host, spec) => trackers.microsoft(host, spec),
    write: (root, index, record) => trackers.write(root, index, record),
    // A sign-in for every project on a site lets their boards load too (GH-79).
    signedIn: async (root, kind, host) => { await trackers.reload(root, { kind, host }); tickets.refresh(); await setup.recheck('B14.tickets'); },
    saved: async (root, name) => {
      await hub.loadProjects();
      await trackers.reload(root);
      tickets.refresh();
      panels.show('tasks');
      void vscode.window.showInformationMessage(`${name} for ${hub.project(root)?.name ?? 'the project'} is saved in .acc/config.json, and its tickets are on the Tasks tab. Commit the file on each environment's branch, so every checkout shows the same board.`);
      await setup.recheck('B14.tickets');
    },
    changed: () => changed(),
    log: (line) => setup.log.warn(line),
    exec,
  });
  const panels = new Panels(context, hub, setup, resolve, (visible) => pagePolls(visible), {
    connect: { model: () => connect.model(), close: () => connect.close() },
    boards: (root) => trackers.boardStates(root),
    identity: (root) => identity.card(root),
    edited: (root, id, replaces) => tickets.edited(root, id, replaces),
    runs: () => runs.views(),
    autopilot: (root) => autopilotRef?.stateFor(root) ?? null,
    slack: {
      card: () => slackCard(slack.state(), slack.busy),
    },
  });
  context.subscriptions.push(panels, tickets);
  // All of acc in one status bar item (D-065): it asks each part where it is.
  let autopilotRef: AutopilotHost | undefined;
  const statusParts = () => {
    const live = runs.live();
    const look = setup.look();
    return {
      asking: live.find((r) => r.asking)?.label ?? null,
      running: live.filter((r) => !r.asking).map((r) => r.label),
      checking: look.checking,
      setup: look.total ? { done: look.done, total: look.total, todo: look.todo } : null,
      autopilot: (autopilotRef?.looks() ?? []).map(({ project, state }) => ({ project, state })),
      account: identity.account(),
    };
  };
  const notices = new Notices(hub, resolve, () => panels.visible() && ['overview', 'tasks'].includes(panels.current()), statusParts, slack);
  context.subscriptions.push(notices);
  questions = new Questions(hub, setup.log,
    (card) => { if (!pages.open(card.session)) panels.show('overview'); },
    (card) => (panels.visible() && panels.current() === 'overview') || pages.showing(card.sessionId), slack);
  context.subscriptions.push(questions);

  runs.onDidChange(({ structural }) => { if (structural) changed(); else { panels.postRuns(); notices.draw(); } });
  // The running item shows a command that isn't autopilot first, and so does this.
  const firstRun = () => { const v = runs.views(); return (v.find((r) => r.endedAt === null && !r.background) ?? v.find((r) => !r.background) ?? v[0])?.id; };
  const showRun = (id?: string) => { panels.show(); setTimeout(() => panels.postRuns(id ?? firstRun()), 300); };
  reg('acc.runs.show', () => showRun());
  runs.onDidEvent(({ kind, run }) => {
    if (panels.visible()) { if (kind !== 'end') panels.postRuns(run.id); return; }
    // Off screen, a run speaks up only when it needs you or went wrong. Autopilot's says why it stopped itself.
    if (kind === 'ask') void vscode.window.showWarningMessage(`${run.label} is asking: ${run.prompt?.text ?? 'for an answer'}`, 'Answer').then((p) => p && showRun(run.id));
    if (kind === 'end' && !run.background && !(run.ok ?? run.code === 0) && !run.stopped) void vscode.window.showWarningMessage(`${run.label} failed (exit ${run.code ?? '?'}).`, 'Show output').then((p) => p && showRun(run.id));
  });
  // Autopilot, while it's switched on here (D-064). It ends with the window, as every run does.
  const autopilot = new AutopilotHost(hub, runs, accShellCommand(accScript), (id) => showRun(id));
  autopilotRef = autopilot;
  // The Overview's merge queue says whether autopilot runs, so it's drawn again when that changes, and only then (GH-73).
  let running = '';
  context.subscriptions.push(autopilot.onDidChange(() => {
    notices.draw();
    const now = hub.projects.filter((p) => autopilot.stateFor(p.root)).map((p) => p.root).join('\n');
    if (now !== running) {
      running = now;
      panels.post();
    }
  }));
  context.subscriptions.push(autopilot);
  // ------------------------------------------------------------ the launcher (D-029)
  // The activity bar icon opens the page. Its one view lists the sections, for anyone who keeps the sidebar.
  const launcher = new HomeLauncher(() => panels.model().nav);
  const launcherView = vscode.window.createTreeView('acc.home', { treeDataProvider: launcher });
  context.subscriptions.push(launcherView, launcher);
  context.subscriptions.push(launcherView.onDidChangeVisibility((e) => {
    if (!e.visible) return;
    panels.show();
    if (vscode.workspace.getConfiguration('agentCommandCenter').get<boolean>('openFromActivityBar', true)) void vscode.commands.executeCommand('workbench.action.closeSidebar');
  }));
  /** Everything the page shows changed: redraw it, and the launcher's counts and badge. */
  const changed = () => {
    panels.post();
    launcher.refresh();
    const n = needsYouCount(panels.model().overview);
    launcherView.badge = n ? { value: n, tooltip: `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you` } : undefined;
    notices.update(n);
  };
  trackers.onDidChange(changed);
  // A ticket's page says Tracking… whichever button started it, its own or its card's (D-074).
  trackers.onDidTrack((root) => tickets.refresh(root));
  identity.onDidChange(changed);
  // An edit on a task's page changes what the Overview shows for its update, and whether it offers Post.
  tickets.onDidEdit(changed);
  reg('acc.open.home', (section?: unknown) => panels.show(typeof section === 'string' ? (section as ViewKind) : undefined));
  for (const kind of VIEW_KINDS) reg(`acc.open.${kind}`, () => panels.show(kind));


  // Each area registers its commands, and takes the page's messages that are its own (D-099).
  const parts: Parts = {
    vscode, hub, setup, runs, panels, tickets, pages, trackers, identity, connect, slack, autopilot, sidebar, accScript,
    reg, subscribe: (d) => context.subscriptions.push(d), regNode, resolve, accSays, answer, answerAnalysis, updates, showRun,
    receive: (type, fn) => panels.take(type, fn),
  };
  for (const a of AREAS) a.register?.(parts);

  hub.onDidChange((part) => {
    if (part === 'projects') { void trackers.loadBoards(); void setup.recheck('B14.tickets'); void identity.refresh(); }
    if (part === 'projects' || part === 'worktrees') autopilot.reconcile();
    if (part === 'projects' || part === 'worktrees') questions?.rootsChanged();
    if (part === 'tasks' || part === 'agents') tickets.refresh();
    if (part === 'agents') pages.refresh();
    changed();
  });
  setup.onDidChange(changed);

  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution((e) => setup.onShellEnd(e)),
    vscode.window.onDidCloseTerminal((t) => setup.onTerminalClosed(t)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { setup.refreshSoon('folders changed', 200); void hub.loadProjects(); }),
    vscode.window.onDidChangeActiveTextEditor(() => { setup.renderStatusIfFolderChanged(); identity.render(); }),
    // Coming back to VSCode is when an account may have changed elsewhere, such as gh in a terminal.
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) void identity.refresh(); }),
  );
  // Each folder's own .acc/config.json: a builder's worktree inside it has one too, which isn't this project's.
  const reload = () => void hub.loadProjects();
  const watchConfig = (folder: vscode.WorkspaceFolder) => {
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.acc/config.json'));
    w.onDidChange(reload);
    w.onDidCreate(reload);
    w.onDidDelete(reload);
    context.subscriptions.push(w);
  };
  for (const f of vscode.workspace.workspaceFolders ?? []) watchConfig(f);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((e) => e.added.forEach(watchConfig)));
  setup.watch();

  void hub.loadProjects().then(() => { questions?.start(); return hub.loadAgents(); }).then(() => {
    notices.arm();
    pagePolls(panels.visible());
  });
  void openPendingConversation(context);
  void setup.refresh('startup', { reuseMachine: true }).then(() => setup.maybeOpenWalkthroughs());
}

const OPEN_LATER = 'acc.openInClaude.pending';

/**
 * A conversation another window asked this one to open (D-040): this window's folder is the session's
 * own, so Claude Code finds it here. Asked for within the last two minutes, or not at all.
 */
async function openPendingConversation(context: vscode.ExtensionContext): Promise<void> {
  const p = context.globalState.get<{ folder: string; sessionId: string; at: number }>(OPEN_LATER);
  if (!p || Date.now() - p.at > 120_000 || !isSessionId(p.sessionId)) return;
  if (!(vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.fsPath === p.folder)) return;
  await context.globalState.update(OPEN_LATER, undefined);
  try {
    await vscode.extensions.getExtension(CLAUDE_EXTENSION)?.activate();
  } catch {
    // it activates on its own when the link arrives
  }
  await vscode.env.openExternal(vscode.Uri.parse(claudeSessionUri(vscode.env.uriScheme, p.sessionId)));
}

/** The sidebar's one view: the page's sections, each opening it there, with what needs you beside it. */
class HomeLauncher implements vscode.TreeDataProvider<NavItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly nav: () => NavItem[];

  constructor(nav: () => NavItem[]) {
    this.nav = nav;
  }

  dispose(): void {
    this.emitter.dispose();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getChildren(): NavItem[] {
    return this.nav();
  }

  getTreeItem(n: NavItem): vscode.TreeItem {
    const item = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(n.icon, n.attention ? new vscode.ThemeColor('charts.orange') : undefined);
    item.description = n.attention ? `${n.count ?? ''} · ${n.hint}`.replace(/^ · /, '') : n.hint;
    item.tooltip = `${n.label}: ${n.hint}`;
    item.command = { command: 'acc.open.home', title: `Open ${n.label}`, arguments: [n.section] };
    return item;
  }
}

export function deactivate(): void {}
