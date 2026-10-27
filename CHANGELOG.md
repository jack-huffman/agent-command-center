# Changelog

What changed in each release of Agent Command Center, newest first. The
extension, the plugin and acc share one version. Each release is a GitHub
Release of this repo, with the extension's `.vsix` attached and its entry here
as the notes.

## 0.48.0

- The Command Center works on Windows as it does on a Mac (D-209), with no WSL.
  Git for Windows is required: acc runs its shell commands with the shell it
  ships, so a project's checks run as written. Tools installed as `.cmd` files,
  such as the Salesforce CLI, npm and VSCode's `code`, are found and run
  there, and every word passed to one is escaped. acc resolves by name through
  a new `acc.cmd` beside its launcher. A Windows check runs on every push.
  Cloud builders keep their token in the macOS keychain, so on Windows they
  say they aren't available yet, with that reason.
- Setup tells you what to install for your own system: Homebrew lines on a
  Mac, `winget` lines and Claude Code's PowerShell installer on Windows, and
  each maker's line on Linux. On Windows it says to restart VSCode after an
  install. On a Mac, Setup checks that Homebrew is installed first, and offers
  its installer.
- On Windows, Do it runs each fix in PowerShell, whatever your default
  terminal is, quoted for PowerShell; on a Mac it runs as before. The run's
  log still shows the readable command.
- You can set up a Salesforce project, and use the Command Center on it,
  without access to Production (D-208). Joining a project, Setup passes with
  Production not logged in here, and says someone with access looks after it;
  Production's Open org and Deploy… are off with that reason. Starting one,
  "I don't have access to Production" finds the environments from the
  sandboxes you're logged in to on your company's Salesforce domain, and
  someone with access can record Production later.

## 0.47.0

- Report a problem (D-207): from the Command Palette, Settings' About or a
  failed Setup step, the Command Center drafts a GitHub issue for its author,
  with what happened in your words and the versions, Setup's results and the
  last error attached. Paths, email addresses, web and host names, IP
  addresses, ticket keys, orgs, usernames and anything shaped like a token are
  replaced before you see it; the page shows the whole issue as it will be
  posted, and nothing is sent until you click Post to GitHub. Where your
  GitHub account can't reach the repo, it says so and offers Copy the issue
  text. The repo has a matching issue template.
- With a conversation, Make a new plan is in the conversation panel alone; the
  plan section keeps it when there's no conversation.
- The install steps in the README, ONBOARDING.md and FIRST-RUN.md match this
  release, and the first-run checklist lists what to prepare before helping
  someone new install it, and where a first run usually stops.
- No client's name is in the repo, and a check keeps it so without naming one.
- A disabled button looks disabled on every page, dimmed with a not-allowed
  cursor, and says why it's off when you point at it.

## 0.46.0

- Talking a plan through asks one question at a time (D-204): the planning
  agent's questions show as a card under its reply, "Question 2 of 3", with a
  few options, its suggestion first and marked, and your own words. Keys pick
  and Enter goes on; Back and Skip work; nothing is sent until you've been
  through them all, and then your answers go back as one message. Long
  replies fold behind Show more, earlier messages fold away, and a proposal is
  one line with Why and Use this.
- A single choice offers at most three options and your own words, wherever
  you're asked to pick one (D-205): a plan's choices and questions, the
  conversation's questions and Review plan. Answer in my own words is always
  there. A question where you tick several still lists more.
- A Salesforce builder deploys its work to the build org before it's done
  (D-206): after it validates, it deploys its change to its environment's
  sandbox, checks each component is there, and runs the named Apex tests in
  the org; the ticket's Changes say Deployed to <org> with what the tests
  found, and Done waits for it. A protected org or production is never
  deployed to by a builder (Salesforce is asked which org it is), nor are
  deletions or environment-specific files. Deploys to one org take turns, and
  a task whose files overlap another in progress waits.

## 0.45.0

- Plain words for someone new (D-188): the app is the Command Center
  throughout, never "acc". **Add to my work** brings a ticket in (nothing
  changes on the tracker), **Make a plan** and **Build it** are the two big
  steps, and **Open pull request** sends reviewed work on. Each main button
  says what it does and doesn't, and the Tasks tab explains the five steps the
  first time.
- Plans you decide (D-192): a plan lays out each real design choice as two or
  three options, with pros, cons, effort, risks and the files each touches,
  and names its recommendation. Choose one or write your own. Questions say
  whether they're for you or the ticket's author, and an author's can be asked
  on the ticket. Plans keep their versions and say what changed. Where a plan
  is required, nothing is built until you approve it, and a builder that needs
  a different choice stops and asks.
- Talk it through (D-195): discuss a plan with its planning agent on the
  ticket page. **Discuss** quotes any choice, option, step or risk; the agent
  answers from the code and the org and changes nothing. It can propose a
  change, which you take with **Use this**. **Make a new plan** folds in what
  you agreed. **Open in Claude Code** opens a read-only planning session that
  asks you before it records anything.
- What a ticket changed (D-189, D-190): a ticket shows **Planned changes**,
  then **Changes**, and keeps them after it merges, with Salesforce metadata
  named by type. Record changes are part of the ticket too: planned, recorded
  when made (a builder can't finish without recording one), added by hand,
  and turned into reviewed steps with a script when the work is promoted.
  Nothing writes records in another org by itself.
- A tracker's changes field (D-196): name a field such as "Deployment Notes"
  in a tracker's settings, and when a ticket's changes change, its new text is
  drafted for you to save to the ticket, keeping every line written there by
  hand. The ticket page shows what the field says and where it differs.
- A Salesforce ticket's package.xml (D-191), built by Salesforce's own tool,
  checked against the org, compared with the org's latest copies, with the
  org's changes the branch lacks listed for you to add. Deletions go in their
  own file, and nothing is deployed.
- Choose a board by seeing it (D-193, D-194): the Connect page shows boards,
  teams, epics, sprints and GitHub Projects as cards with ticket counts, and
  a live preview of the board before **Use this board** keeps it. Tick several
  Jira epics.
- Tickets use their tracker's own label and type colours where it gives them
  (D-187): Azure DevOps tag colours from the board's card rules, and work item
  and GitHub issue type colours. States keep the Command Center's own look.
- Each comment on a ticket is its own card, and a fresh window shows each
  tracker's last board at once while it refreshes, with a quiet skeleton the
  first time.
- Review plan (D-200): a plan's section on the ticket page is short (what it
  does, what's left to review, **Review plan**), and Review plan steps through
  its choices and questions one at a time, like Claude Code's prompts: radio
  options with the recommended one first, details only on request, your own
  words, Back, Skip, and a summary that approves.
- A plan starts with a conversation (D-202): Make a plan first asks what you
  want to do and what you're thinking; the planning agent says what it
  understood and asks a few questions before it drafts. The conversation lives
  in its own panel beside the ticket, never on the ticket page.
- A plan reads the whole ticket (D-201): every comment, oldest first, related
  tickets and the changes field. A later comment wins over the description,
  the plan names the comments it relied on, and the ticket page says when new
  comments arrive.
- Builders work as a team (D-198): each one knows what the others are changing,
  is told when one lands with work it shares, and can take it in early. A plan
  can suggest a small first task for a shape others build on (D-199).
- Parallel work merges on its own (D-197): raised floors keep the higher
  number, the screenshot pages are one list, and decisions are a file each,
  numbered at merge.
- A GitHub check runs the full check and the screenshots on every pull request
  and on main (D-203). Autopilot merges a pull request only once that check
  has passed; none reported never counts as passed. Screenshot floors keep a
  1% margin, so small differences between runs never fail.

## 0.44.0

- Tickets look considered on every tracker (D-185, D-187). One soft state
  chip, with an icon and a label, wherever a ticket's state shows. Labels and
  avatars take stable tints, with no red or green in acc's own palette. The
  ticket page leads with the title, then state, type and priority, then an
  aligned Details list that leaves out what a tracker doesn't have. Related
  items show their type and state. Board cards show type, priority and
  people, and as many whole labels as fit, with the rest in +N. Cards respond
  when pressed, and stay still when reduced motion is on.
- Azure DevOps tickets carry what Azure DevOps has: names that read as names
  (not an address split by a space), priority as a word with an icon, an
  icon for each work item type, child and parent items with their state, and
  your name after **Commenting as**. Every tracker's priority, type and related
  items now come in one form, and GitHub's **Closed as not planned** keeps its
  own look.
- A builder that never started needs you instead of showing as running
  (D-186). A dispatch waits for its builder to start. If it doesn't, the task
  says why and offers **Dispatch again**, which never stops a builder acc can
  still see. When Claude Code's background sessions stop answering, or
  `claude` isn't found, acc says so.

## 0.43.0

- Draft a ticket's acceptance criteria (D-179): a ticket's page and the task
  sheet have **Draft acceptance criteria**. A read-only agent reads the
  ticket, its comments, related tickets and the repo, and drafts acceptance
  criteria, test steps, edge cases and open questions for the ticket's
  author, in plain words. Add it below the description, or open it as an
  update to post as a comment. Nothing reaches the tracker until you save or
  post. `acc draft criteria` does the same from the command line.
- A builder sent back after a passed review gets that review's findings
  (D-180), each with its file and line, after your reason, so a rework knows
  what to fix.
- Every place that writes the project's settings writes the file whole, and a
  check over all of acc's code holds it to that.
- Verify a developer's pull request (D-182, D-183): a tracked ticket's page has
  **Verify the developer's work**. acc finds the ticket's open pull request on
  GitHub, or lets you choose one, and checks out its head with no branch. It
  runs the project's checks there, and a read-only agent reviews the change
  against the ticket and its drafted criteria. A check that can't run says why,
  and is never counted as passed. You get a QA comment to edit and post. Nothing
  is posted, pushed or committed, and the task's state doesn't move.
  `acc verify` does the same from the command line.
- A Slack board (D-181): name a reaction, such as `ticket`, on the Connect
  page, and the Tasks tab shows the channel's messages marked with it from the
  last 30 days. An optional done reaction puts a message in Done. Track a
  message from its card, and filter the board by who wrote it. A missing Slack
  scope is named, with where to add it.
- Reviews in the cloud (D-184): a project that runs builders in the cloud can
  run their reviews there too, so a cloud task gets reviewed while the Mac
  sleeps. Turn it on in Settings, or with `acc review --cloud`. A cloud reviewer
  can change only its verdict file and push only its own verdict branch.
- The cloud guard is stricter for every cloud session: a git option or address
  that runs a program is refused, however it is shortened or quoted, and so is
  `--no-verify` hidden inside an option.
- A sprint line that arrives just after the Command Center loses focus is no
  longer dropped from **Since you last looked**.

## 0.42.0

- Follow a sprint (D-178): a Jira tracker's place can be the board's active
  sprint, or one sprint, alone or with an epic. Connect lists the board's open
  and future sprints, and the board names the sprint and its dates. When the
  active sprint changes, **Since you last looked** says so once, with how many
  tickets carried over and how many went back to the backlog; a task already
  started is never dropped.
- A person filter on every board (D-176): Everyone, Mine, Unassigned, or one
  person, with a count such as "Mine · 7 of 42". Each board keeps its choice,
  and the arrow keys move only between the cards that show.
- Write a task in a full sheet, and edit it later (D-175): **Add task** opens a
  sheet with a title, a description of several lines, dependencies,
  environment, labels and **Notes for the builder**. **Edit** on the task page,
  the task modal, a card's menu and the palette opens it filled in, and
  `acc edit` does the same. Edits show in History and in the task's activity.
  A task is not edited while a builder runs, or once it is done.
- Change a ticket from acc, where the project allows edits (D-177): the sheet
  writes a Jira or GitHub ticket's title and description, and changes its
  status, assignee and labels. Save reads the ticket again first, and stops
  with both versions if someone changed it meanwhile. A Jira description that
  holds content Markdown can't keep, such as mentions or attachments, is never
  written back: the sheet names it and saves the other fields.
- A Salesforce project can say it doesn't use source tracking (D-174): Setup's
  source-tracking steps skip and say why, and Settings' **Limits and checks**
  turns it on or off.
- The update refuses a release with no checksum file (D-173), and says so.
- The project's settings are always written whole (T-75).

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
