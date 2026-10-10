# Changelog

What changed in each release of Agent Command Center, newest first. The
extension, the plugin and acc share one version. Each release is a GitHub
Release of this repo, with the extension's `.vsix` attached and its entry here
as the notes.

## 0.39.0

- Cloud builders, for a project on GitHub that opts in (GH-69, D-???): `acc
  cloud enable` with a routine from claude.ai/code/routines and its token in
  the keychain, then `acc dispatch <id> --cloud`, or **Dispatch to the cloud**
  on a card, pushes the task branch and fires the routine. `acc sync` follows
  the branch on GitHub and collects it into the worktree when its last commit
  says `Acc-Done`, running the checks on this Mac; a quiet builder needs you,
  with its session's page. Cards and task pages say where each builder runs,
  **This Mac** or **Cloud**, and Settings has the switch with what it still
  needs. A local builder stays the default everywhere, and a project that
  hasn't opted in sees no change. Every sync also flags an environment branch
  that moved by anything but acc's own merges.
- Depth in light and dark: the board's columns sit in wells set into the page,
  and cards and panels are raised on it, with a firmer edge and a soft shadow.
  A tracker column named Blocked, Stuck, On hold or Waiting is orange with a
  blocked icon, not blue and under way.
- The Tasks tab's header says each thing once, on one line under the board's
  name. Its switch names a tracker's board by its kind, **GitHub board** or
  **Jira board**, and says on hover what each board shows.
- Pick a task's builder effort as you pick its model: `acc dispatch <id>
  --effort <level>`, or the effort step in **Re-dispatch with…**. It's kept on
  a re-dispatch and a resume, `--effort default` drops it, and a level the
  model doesn't take is refused before anything starts. Reviewers in this repo
  run at high effort.
- Claude Haiku 5.5 replaces Haiku 4.5 in the model choices.
- Two leaks fixed: a first open still waiting when the window closed opened a
  page whose polls outlived it, and the questions listener could start after
  the extension stopped.

## 0.38.0

- A Settings page, last in the rail: Appearance (Match VSCode, Light or Dark,
  for the Command Center only), How agents run, Limits and checks, Trackers and
  sign-ins, Notices in Slack, GitHub accounts, the Command Center's own
  preferences, and About. About shows the versions of acc, the extension and
  the plugin, and says when a newer release is out.
- Raise or lower how many builders run at once: each project's cap and this
  machine's total across every repo, with what a change means for usage.
- The Agents page is grouped by repo, then by task, and says nothing twice.
  **Stop finished** stops only sessions still running, and says what failed in
  one line.
- Start a project from a Jira epic, an Azure DevOps area path or GitHub labels.
- A GitHub repo's board takes its columns from its GitHub Project, and acc moves
  a task's card as the task goes: In Progress, Testing, Blocked, Done. The
  Tasks tab's header says each thing once.
- Nothing opens on its own when a folder opens. The first time the Command
  Center opens in a folder that isn't set up, it lands on Setup.
- New checks a project can rely on: a test check counts what ran, and one that
  ran none or skipped more needs a person; a ratchet holds a number to a floor
  that only goes up (this repo's test count is one); and a built-in stray-files
  check stops logs, temp files, new root files and data exports from landing.
- A builder ends with a note that the reviewer, the next builder and the pull
  request read. A review finding that keeps coming back is offered as a rule,
  then as a check. After a run of merges, a tidy-up task is offered.
- Projects share rules by copying them in, with where they came from.
- Every acc and extension command survives missing, empty and wrong arguments.

## 0.37.0

- Team templates: start a project from a team's settings with `acc init
  --from <template>`, or **From a team template** in Setup. A template is a
  JSON file kept at a path, in a GitHub file or in any git repo. It's checked
  key by key before anything is written, and Setup says when the team's
  template has changed since. `acc template show` previews one.
- One tracker sign-in for every project on the same Jira site, Azure DevOps
  organization or monday.com account. The Connect page asks whether a sign-in
  is for every project there or this one only, and a project that keeps its
  own sign-in never loses it to the shared one.
- In progress on the Overview: every job under way, grouped by task, with its
  state, what it's doing, its model and its branch so far. A machine line on
  top shows the heavy-check slots in use, the builders running and the load.
- Two tasks that change the same files take turns: a dispatch that would
  overlap work in flight waits while another Ready task can go first, says
  what it waits for, and starts on its own once it's free. **Dispatch anyway**
  overrides.
- A merge queue where auto-merge is on: pull requests that pass join in turn,
  and the one at the head has its base merged in and the full check run once,
  then merges. Builders run lighter checks, the tests near what they changed,
  and the full one runs in the queue.
- A finished task's leftover agent session reads as Finished, not Needs you,
  and **Stop finished sessions** stops them in one go.
- The Agents tab shows each session's folder in context (`Acme Service ›
  worktree ACME-12`), with a toggle for the full path. How agents run is
  behind a **Settings** button.
- A rework a person sends back tells its builder why, in the builder's
  instructions.

## 0.36.0

- Builders, reviewers and analysts run on Claude Opus 5.5 unless the clone or
  the project names another model. **Dispatch with…**, on a card's ⋯ menu and
  the task page, picks a model for one task, with the analysis's size beside
  the choices (`acc dispatch --model` does the same). A rework and a resume
  keep the pick. Cards, the task page and the Agents tab show each agent's
  model.
- Every agent acc starts is named for its project, ticket and role, such as
  `Acme Service · ACME-12 Case escalation rules · builder`, in Claude Code's
  session list, the Command Center, notices and terminals alike. A task's
  second builder is `builder 2`.
- Auto-merge, off unless a repo turns it on: with autonomy at review, autopilot
  merges a pull request once its review and GitHub's checks passed, it's up to
  date with its base, GitHub says it can merge, and nothing waits on you. One a
  pass, never into a protected environment, never in a Salesforce project, and
  never a pull request that changes `.acc/`. Turn it on with **Auto-merge** in
  How agents run, or `acc agents auto-merge on`.
- Where a GitHub tracker says `"edits": true`, `acc sync` closes a task's issue
  when its pull request merges, with one comment saying so. `acc sync
  --close-done` does the same for tasks done before (`--plan` lists them
  first). Jira and Azure DevOps tickets are never changed.
- monday.com connects on the Connect page: an account, a personal API token, a
  board, and if wanted one group on it. Its status labels are the Tasks tab's
  columns.
- Setup forgets a step that no longer applies. Opening a folder with no
  project, then giving it a generic config, used to leave Node 20 or later
  (and the Salesforce CLI and Code Analyzer) listed under This machine, counted
  as to do, until the window reloaded. Now each full check replaces the rows
  it lists. When a check can't run, Setup keeps the rows it had rather than
  going blank, and doesn't save the empty result for the next start.
- The acc plugin step fails when the plugin in Claude Code is older than the
  extension, and its **Do it** updates the marketplace and the plugin. A newer
  plugin passes.
- The README says how to put VSCode's `code` command on PATH before installing
  the `.vsix` with it.
- `docs/FIRST-RUN.md` is the checklist for a first run on a fresh machine, to
  be filled in step by step.

## 0.35.0

- One version for everything: acc, the extension, the plugin and its
  marketplace entry all say 0.35.0. `acc --version` said 0.1.0 before.
- This changelog, and a package that won't build without an entry for its
  version.
- A package is checked for the packager's personal data before it's made: home
  folders, their git email, their GitHub accounts, their name in a `.claude` or
  `.acc` path, and the trackers they've signed in to. Anything found stops the
  package and is listed by file and line.
- The plugin's author and the marketplace's owner are now Agent Command Center,
  linking to this repo, rather than a person's GitHub account.
- Releases are on GitHub, made by a person with `npm run release`. Agents can't
  make one.
- More builders at once: a machine sets how many heavy checks (builds, tests,
  validations) run together with `acc machine heavy-slots`, two here, and this
  repo runs up to five builders, on Opus 5.5.
- Setup has a real step for the acc plugin in Claude Code: it checks the plugin
  is installed for every session and installs it from this repo. The README has
  an Install and first run section for someone new, and ONBOARDING.md matches
  the walkthrough.
- Setup no longer re-runs its checks each time a builder saves a file in its
  worktree, and saving a project's settings from the Command Center works again.

## 0.34.0

- A promotion drafts ticket updates for the tasks it carries, as a merge and a
  deploy do. A task two promotions took on arrives with the first to merge.
- A pull request whose GitHub checks fail goes back to its builder, once a
  commit, with the failing checks' report. Autopilot asks GitHub about checks
  once a commit, when they've settled.
- acc runs with no Node installed. A small launcher runs it with Node 20 or
  later when there is one, else with VSCode's own runtime. The plugin's hooks
  never break a session for want of Node.
- Notices can go to Slack: what needs you, finished reviews, pull requests
  autopilot opened, and draft updates waiting. They're off until you turn them
  on, sent once each, and in fixed words.
- Connecting a tracker says to sign in before its lists fill, and tracking a
  ticket from its card hands it to acc as before, now with a test.

## Earlier versions

Versions before 0.34.0 weren't released. See `git log` for what they changed.
