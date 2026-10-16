# Changelog

What changed in each release of Agent Command Center, newest first. The
extension, the plugin and acc share one version. Each release is a GitHub
Release of this repo, with the extension's `.vsix` attached and its entry here
as the notes.

## 0.41.0

- A command palette (D-156): **Search or run a command** in the rail, `/`, or
  Cmd+K finds any section, part of Settings, task, agent or action, ranked as
  you type, and Enter runs it.
- Dispatch asks first (D-168): one sheet over the page for the model, the
  effort and where the builder runs, This Mac or the cloud, with your usual
  choices already picked. **Dispatch with…** and **Dispatch to the cloud** are
  gone. A task page's actions share one size and one place: the next step full
  width, the rest in equal columns.
- The output panel is a designed view, never plain text (D-169). Each run has
  one header line with its state, name and time; its output is rows with an
  icon for a success, a warning, an error or a count of progress; paths open
  the file; like rows fold into one, such as "Deployed 7 files"; and it ends
  with a card that says what happened. acc's deploy, promote, dispatch, land,
  analyze and Setup's fixes report their steps, and the panel lists them, a
  failed step opening to what went wrong (D-171). A review shows as its
  verdict, its unmet criteria and its findings, each opening in place (D-167).
- A review's findings on the task page (D-157), each with its file, line and
  the lines around it; a click opens the file there.
- Fewer notifications (D-162, D-164): more than three changes in one refresh
  are one notification that counts them. After ten minutes away from the
  window, news waits on the Overview under **Since you last looked**, with one
  notification when you come back; what needs you still shows at once.
- History (D-170): a line with the day's name between days, each entry one row
  with its time, and 40 entries at a time as you scroll.
- The Tasks boards work from the keyboard (D-159): arrows between cards, Enter
  opens, Space picks a card up and moves it, with a live line saying each step.
- The extension finds a newer release by itself and offers it (D-166):
  **Install and reload** downloads it as your gh account, checks it against
  its `.sha256` when the release has one, installs it, reloads and opens the
  Command Center. `agentCommandCenter.updates.check` turns the look off. This
  release is the first with a `.sha256` beside its `.vsix`.
- Slack as a ticket source (D-145, D-146, D-148): connect a channel with a
  Slack app's bot token, track a thread by pasting its link, and its update
  drafts post as replies in the thread.
- A calmer Overview (D-150, D-151): Needs you first, and every other list a
  quiet card that opens in full. Settings opens with a link to each part, and
  long explanations fold (D-154). Blue buttons only for what needs you (D-153).
  The Overview's row buttons line up.
- Accessibility (D-147, D-160, D-161): reduce motion is obeyed, a press shows
  at once, text follows your font size, and every drawing is checked with
  axe-core for WCAG 2.1 AA. Every control is named by what it shows, and faded
  text keeps its contrast.
- A loading screen with the acc mark in a turning ring (D-142).
- For anyone building acc: UI changes are verified with a pinned
  chrome-headless-shell, never your own Chrome, and the screenshots gate
  enforces it (D-172; `npm run browser` gets it). The screenshot run draws
  three pages at once (D-163), `npm test` takes about two minutes (D-165), and
  `npm run package` skips a check that already passed on the commit (D-158).

## 0.40.0

- Cloud builders, for a project on GitHub that opts in (GH-69, D-140): `acc
  cloud enable` with a routine from claude.ai/code/routines and its token in
  the keychain, then `acc dispatch <id> --cloud`, or **Dispatch to the cloud**
  on a card, pushes the task branch and fires the routine. `acc sync` follows
  the branch on GitHub and collects it into the worktree when its last commit
  says `Acc-Done`, running the checks on this Mac; a quiet builder needs you,
  with its session's page. Cards and task pages say where each builder runs,
  **This Mac** or **Cloud**, and Settings has the switch with what it still
  needs. A local builder stays the default everywhere, and a project that
  hasn't opted in sees no change. Every sync also flags an environment branch
  that moved by anything but acc's own merges. A committed push guard and a git
  pre-push hook keep a cloud builder to a plain push of its own branch.
- Requirements in Simplified Technical English (D-141): the analyst writes a
  task's goal, criteria, assumptions and out-of-scope in STE Strict, so a
  builder can read each one in one way only. acc checks the wording, and the
  task page and `acc show` list each finding as an orange **Wording** state.
  It's advice: it never holds a dispatch. `acc ste check` checks any text, and
  the plugin carries the ASD-STE100 skill, copied in with its MIT licence.
- The Overview is a landing page: one line for each thing that needs you, with
  the detail a click away in a modal (D-131). Clicking a task on the Tasks
  board opens it over the board, with **Open as tab** and **Close** (D-129).
- The Command Center speaks in processes, not commands or file paths: "Run the
  checks", "the project's settings" (D-132). Setup says what **Do it** does and
  keeps another tool's command behind **Show the command**, and settings keys
  read as words.
- Depth on every page: the task page, Agents, Worktrees and Environments use
  raised panels; buttons, counts and code chips take the blue accent; inline
  code reads as a chip; and a task's analysis and builder's note show `code`
  and **bold** as marks.
- Builders follow more of the repo's own rules, each with a check: a test file
  names an edge case it covers, every export is named by a test, a UI change
  needs screenshots of it, and each rule names its check. Reviews run at medium
  effort, with at most three builders at once.
- Fixed: the test suite left its temporary folders behind (about 350,000 of
  them), which made the onboarding checks hang; a screenshot run that Chrome
  didn't finish now draws again once; and checking a command with the cloud
  guard no longer installs its pre-push hook into the checkout.

## 0.39.0

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
