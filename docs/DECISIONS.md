# Decisions

Newest last. Each entry records what was decided and why, so later changes can
see what they are overturning.

## D-001 Build a thin layer over Claude Code, don't adopt an orchestrator (2026-10-01)

Claude Code already runs agents in isolated worktrees, keeps a registry of live
sessions, and exposes hooks. What is missing is one view in VSCode and intake
from issue trackers. Standalone tools either live outside VSCode, don't write
back to trackers, or bring a heavy stack.

A review on 1 October 2026 (kept locally, D-098) looked at Gas City, Emdash,
Conductor, Superset, Vibe Kanban, the terminal session monitors and the small
VSCode extensions:
- Gas City was worth borrowing ideas from, not adopting. It needs tmux, a Dolt
  SQL server and a supervisor, runs Claude with permission checks skipped by
  default, and has no Jira or VSCode support.
- None of the others had all three of: a capable view inside VSCode, progress
  written back to the ticket, and Salesforce awareness.

## D-002 No dependency on other skills (2026-10-01)

Everything the project needs ships inside its own plugin. It must work on a
machine with no other skills installed. Ideas from other skill sets are welcome,
but they are rewritten here, not called.

## D-003 Project-agnostic core with a Salesforce profile (2026-10-01)

Salesforce is the first and most important target, but it is one profile. The
ledger, dispatch, review and extension know nothing about Salesforce. The
`salesforce` profile adds deploy validation, static analysis and org-aware
checks.

## D-004 TypeScript for the CLI and the extension (2026-10-01)

One language lets the CLI and the extension share the ledger types and
validation. Node is already installed, and the stack matches the author's
earlier VSCode extension (TypeScript plus esbuild).

## D-005 GitHub Issues and Jira first; monday.com and Slack later (2026-10-01)

GitHub works through `gh` and Jira through the Atlassian connector today.
monday.com and Slack are deferred.

## D-006 Trackers are read, and only commented on (2026-10-01)

The tool reads tickets and posts the pull request link as a comment. It never
closes or transitions a ticket unless asked, because client trackers often
belong to the client.

## D-007 Each repo declares its own GitHub account (2026-10-01)

This tool's own source lives under a personal account, while client work lives
in private repos under a work account. One machine handles both accounts at
once, so each managed repo's config names the GitHub account it uses.

- The tool sets that repo's local commit identity.
- It gives the repo a local credential helper that returns that account's token
  (`gh auth token -u <account>`).
- It passes `GH_TOKEN` on every `gh` call it makes for the repo.
- It never runs `gh auth switch`, because that changes the account for every
  session on the machine.

Background: `gh auth git-credential` ignores the requested username and returns
the active account's token. Without the helper, a repo would quietly push as
whichever account is active.

## D-008 The ledger lives in the git common directory, not in the repo (2026-10-01)

Task state goes in `<git-common-dir>/acc/`. The main checkout and every worktree
resolve to that same directory, and files there never show in a diff, never
conflict on merge, and are never pushed. The tracker stays the shared record for
teammates, and `acc sync` can rebuild the ledger from tracker, branches and
pull requests. The cost: one machine's view, not a shared one. That's fine
for v1.

## D-009 Builders run as Claude Code background sessions (2026-10-01)

`claude --bg` gives a supervisor that outlives terminals, plus native status
(`claude agents --json`), attach, logs and stop. Building any of that ourselves
would be worse. It's a research preview, so `acc dispatch --foreground` stays
as a fallback.

## D-010 The orchestrator loop is code, not an agent (2026-10-01)

Choosing what to dispatch, review or land follows rules that a function can
apply the same way every time. Agents do the building and reviewing. An
orchestrator agent is used only for judgment calls: breaking down a ticket,
triaging a blocked task, writing rework guidance.

## D-011 In Salesforce projects, agents validate and never deploy (2026-10-01)

Parallel branches deploying to one shared sandbox would overwrite each other.
Builders run `sf project deploy validate`, which leaves the org unchanged.
Deploys happen after merge, from the target branch, one at a time. A protected
(production) target also needs a person to confirm.

## D-012 One CLI is the only writer, and it ships inside the plugin (2026-10-01)

Skills, hooks, the extension and agents all change state through `acc`. Rules
then live in one place. The plugin's `bin/` puts `acc` on every agent's PATH
with no separate install. The extension calls the same bundled file.

## D-013 The tool creates its own worktrees, outside the repo (2026-10-01)

A task branches from its target (`sandbox`, `main` and so on), which
`claude --worktree` can't do. A sibling folder keeps duplicate source trees out
of VSCode search and Salesforce tooling. Claude Code's cleanup sweep doesn't
touch worktrees it didn't create, so cleanup belongs to `acc`, which refuses to
delete uncommitted or unmerged work.

## D-014 Autonomy starts at manual, and nothing ever auto-merges (2026-10-01)

The loop suggests and a person clicks until it has earned trust. Then
`dispatch`, `review` or `full` can be turned on per repo. Merging, and deploying
to a protected target, are always a person's call.

Confirmed by the user on 2026-10-01.

## D-015 Each branch is named after its environment (2026-10-01)

The branch for an environment is its name in lower case: a sandbox's name, or
`production`. The user asked for this so the branches say what they are. It
also gives the tool a rule it can check, because Salesforce puts a sandbox's
name in its URL (`<domain>--<name>.sandbox.my.salesforce.com`). `acc doctor`
refuses to dispatch when an environment's org and branch don't match.
Environments list `promotesTo`, so the tool knows the promotion path too.

## D-016 Environment-specific files are never edited by a task, deployed or promoted (2026-10-01)

Some metadata differs by design in every org: email service addresses,
Email-to-Case routing, SSO and org settings. Copying one environment's version
into another breaks things. Each repo lists these files (`environmentSpecific`).
Builders can't edit them, deploys and promotions leave them out, and drift
checks ignore them.

A second list (`knownDrift`) covers files that differ for less important
reasons, such as features a sandbox lacks or ordering noise. Drift checks ignore
these too, but they can still be changed and promoted.

## D-017 One list of onboarding steps drives the CLI, the walkthrough and the docs (2026-10-01)

The user wants every setup step remembered and available as a GUI walkthrough.
Steps are data in `core`: id, why, the profiles they apply to, a check, and a
fix. `acc doctor` and `acc onboard` run them in a terminal. The VSCode
walkthrough shows them as steps that tick themselves when their check passes.
ONBOARDING.md is the manual version for now and will be generated from the list
later. With one source, the three can't disagree.

The walkthrough moves up to M2. It's the first GUI, and it needs only the
onboarding checks from M1.

## D-018 Every org is listed, and each project sets its own promotion path (2026-10-01)

Clients run different pipelines: Dev → Full Copy → Production for a strict
release process, and Sandbox → Production for a small org. So the path isn't
fixed. `acc init` finds every org (Production's `SandboxInfo`, plus the
logged-in aliases on the same My Domain) and records each one's type. Each
environment's `promotesTo` lists where it may promote to, with the usual step
first. A person may pick any listed destination. When that skips an environment
on the usual path, `acc` says so in the warning and in the pull request.

## D-019 The GUI is a VSCode extension, and a thin one (2026-10-01)

The user asked whether this should be a VSCode extension. It should, because
they work in VSCode, and walkthroughs, terminals, notifications and panels are
all native there. It can also put `acc` on every terminal's PATH. A local web
dashboard, a standalone app or a plugin-only setup would each move the work
somewhere else or have no GUI.

The extension holds no logic of its own. It runs `acc … --json` in the
background, so everything stays tested in one place. It follows the
conventions of the author's SFDMU extension (publisher `JackHuffman`, esbuild,
theme icons and colours, modal confirms), without that extension's weak spots.

## D-020 The sidebar comes before dispatch (2026-10-01)

After M2, a fully set-up project showed almost nothing in VSCode: the
walkthrough had no steps left, and the panels were planned for M7. The user
needs to work with repos, agents, tickets and worktrees from a GUI now. So an
Activity Bar container with five views (Tasks, Agents, Worktrees, Environments,
Setup) shipped right after M2, built on everything that already works:

- `acc` for tasks, plus a new `acc intake github`
- `claude agents --json` for agents
- git for worktrees and branches

Each later milestone adds to these views, instead of introducing the GUI at M7.
M7 keeps the board webview, notifications and the richer agent controls.

## D-021 Every sidebar view also opens as an editor tab (2026-10-01)

The user wanted the sidebar's sections as full editor tabs. Each view's title
bar has an **Open as tab** button. Its tab is a webview:

- **Tasks** becomes the board planned for M7: one column per status.
- **Agents** and **Worktrees** become tables.
- **Environments** shows cards and the promotion paths drawn out.
- **Setup** shows a checklist with progress.

Tabs reuse the sidebar's data (the hub) and commands, so the two always agree.

Because tabs show ticket text, they follow strict rules that the author's SFDMU
extension doesn't:

- a nonce-only content security policy
- every value set as text, with no HTML string ever parsed (a test enforces it)
- only allow-listed `acc.*` commands accepted from the page
- VSCode's own icon font and theme colours

## D-022 Task worktrees live in .claude/worktrees/, and agents enter them from the trusted main checkout (2026-10-01)

This supersedes D-013's location; the rest of D-013 stands. Tasks still branch
from their environment's branch, and `acc` alone cleans worktrees up.

**Why.** The first real dispatch failed: Claude Code won't start `claude --bg`
in a folder you haven't trusted. Reading the installed CLI's trust check showed
it climbs parent folders only up to the git root. Each worktree has its own
`.git`, so it's its own root, and trusting a parent doesn't cover it. Writing
trust into Claude Code's state file would race with running sessions, which
rewrite it, so we don't do that.

**What changes:**

- Worktrees go in the repo's `.claude/worktrees/<id>`. That folder is already
  git-ignored there, and VSCode search skips it.
- The background agent starts in the main checkout, which you trust once
  (step B12).
- The agent's first instruction is to call EnterWorktree on its worktree. That
  needs no approval inside `.claude/worktrees/`.
- Once it's in, Claude Code itself blocks edits and git commands aimed at the
  main checkout. That's stronger isolation than instructions alone.

Dispatch checks trust before touching anything. A linked `node_modules` is
added to the repo's shared exclude, so worktrees start clean.

## D-023 Row actions in tabs open VSCode's own context menu (2026-10-01)

Each row in the Agents and Worktrees tabs has one caret button instead of a row
of buttons. The caret, or a right-click anywhere on the row, opens VSCode's
native context menu.

**Why.** Four buttons per row crowded the table. A native menu looks like every
other VSCode menu, follows the theme, and works from the keyboard. It needs no
menu code of our own in the webview.

**How it works:**

- The row carries `data-vscode-context` with its section, its flags (such as
  `agentBackground`) and its `accRef`.
- `package.json` lists the items under `webview/context`, with when-clauses on
  those keys. Only items that apply are shown.
- Commands run from that menu receive the row context. `extension.ts` turns its
  `accRef` into the same node the sidebar passes, so one handler serves both.
- The caret dispatches a `contextmenu` event at its own position, which VSCode
  handles like a right-click.

**Table layout rules,** learned from the first two attempts:

- A grouped list is one table with a heading row per group, so the columns line
  up from group to group.
- Cells stay table cells. A test fails any rule that would make a cell flex.
- The actions column sticks to the right edge. A narrow tab drops the minor
  columns, then scrolls the table under the actions column instead of hiding it.

Board cards still carry their buttons inline. They can adopt this too.

## D-024 Gates: how they run, what a receipt proves, and how validate stays check-only (2026-10-01)

M4 builds the gates from DESIGN section 9. Some details weren't settled there.

**Validate uses `sf project deploy start --dry-run`.** `sf project deploy
validate` doesn't accept `NoTestRun`, which the design calls for when no Apex
changed. A dry run is the same check-only deploy, and nothing is saved. To stop a
real deploy slipping in, the gate runner refuses any `deploy start` that lacks
`--dry-run`. Builders' own permissions still deny `sf project deploy start`;
only acc runs it.

**What a receipt proves.** It's the result of one gate on one commit, stored at
`<git-common-dir>/acc/receipts/<sha>/<gate>.json` with its log beside it.

- A gate that doesn't apply, such as `lint` when no LWC changed, records `skip`.
  A skip satisfies `acc done`.
- A run with uncommitted changes still runs, but records nothing, because the
  receipt would claim a commit it didn't check.
- `error` means the gate couldn't run (a missing tool, an org that's not logged
  in). It's kept apart from `fail`, which means the change is wrong.

**Heavy gates take a machine-wide slot.** The slots are mkdir locks in
`~/.acc/heavy/` (`ACC_HEAVY_DIR`). There's one by default (`ACC_HEAVY_SLOTS`). A
slot whose owner process has gone is taken over. Every gate runs under
`nice -n 15`. Heavy by default: `static`, `lwc-tests` and `validate` in the
Salesforce profile, and `build`, `test` and `check` in the generic one. Set
`gates.heavy` to change it.

**Changed files** are `git diff --name-status --no-renames` from the merge base
with `origin/<branch>`, or the local branch if there's no remote. With no
renames, a rename counts as a deletion, and deletions go to a person (v1).
Environment-specific files are left out of every gate. If a branch touched one,
`validate` fails (D-016).

**Drift** retrieves the baseline manifest into a detached, throwaway worktree in
the git common dir. It prints nothing when the org matches its branch, ignoring
`knownDrift` and `environmentSpecific`. Otherwise it lists three things, and
exits 1:

- what changed in the org
- what exists only in the org
- what the branch has and the org lacks

A retrieve doesn't delete local files, so the third list comes from the
retrieve's "cannot be found" entries. Each one is matched back to its files in
the branch by Salesforce's naming, so all three lists are file paths and
`knownDrift` covers them alike. The first drift run, on a Developer sandbox,
found the third list: about 120 components for features the sandbox lacks, and
about 15 Production changes made after the sandbox was created. Components the
retrieve couldn't fetch for other reasons are shown as notes on the manifest,
not as drift.

## D-025 The Salesforce format gate checks Apex and LWC code, never metadata XML (2026-10-01)

`format` runs `prettier --check` only on changed Apex (`.cls`, `.trigger`) and
LWC JavaScript, HTML and CSS, including LWC tests. It skips metadata XML, an
LWC bundle's `.js-meta.xml`, JSON, Markdown, Aura and Visualforce.

**Why.** The first version checked every type the SFDX template's prettier
script lists, including XML. Salesforce writes metadata XML in its own layout,
and every retrieve rewrites it that way. Prettier's layout differs, so
formatting it only produces whole-file diffs, then drift on the next retrieve.
On the pilot, 3,527 of 3,535 source files failed prettier, nearly all of them
XML. Apex and LWC code is written by people and kept as written, so formatting
it sticks. A project can still replace the gate with its own command under
`gates.commands.format`.

## D-026 The extension reads and writes trackers directly, and draws each tracker's own board (2026-10-02)

The Tasks tab shows each tracker's real board, with the columns its source
defines. Every ticket opens as a page you can work from: read it, comment,
change status, assignee and labels.

**How each tracker is reached:**

- **Jira Cloud** uses its REST API with your email and an API token. The token
  is kept in VSCode's secret storage, for one repo (D-027). The extension can't
  use Claude's Atlassian connector, and a live board can't wait on a model.
- **GitHub** goes through `gh`, as the repo's own account (D-007).
- **The adapters live in core,** with no VSCode dependency, so the CLI can use
  them later.

**What a board is.** A Jira board's columns, mapped to their statuses, or a
GitHub Project's Status options; with no Project, Open and Closed. Dragging a
card runs the transition whose target the column holds. acc's own state shows
as a badge on the card, not as a column.

**Writes happen only on a person's click** on the board or a ticket page. acc
still never changes a ticket on its own. This refines "trackers get a comment
and nothing else" in the README.

**Rich text** from GitHub markdown or Jira ADF becomes one document model. The
webview draws it with DOM calls, so nothing in a ticket can become markup.
Remote images aren't loaded: people show as initials, and attachments as links.

**Per repo.** Trackers are listed in each repo's `.acc/config.json`, with a
site, project and board for Jira, or a repo and Project number for GitHub. One
machine can serve several clients' Jira sites and GitHub repos at once. Azure
DevOps followed in D-027. Not yet covered: Jira Server and Data Center, and
GitHub Enterprise hosts.

## D-027 Tracker sign-ins belong to one repo, and Azure DevOps joins the trackers (2026-10-02)

A consultant works for several clients from one machine. One client's Jira or
Azure DevOps login must never serve another client's repo, even when they share
a site.

**Sign-ins are kept per repo** in VSCode's secret storage, under
`acc.cred:<repo>:<kind>:<site or organization>`.

- The repo is its GitHub repo name when the config has one, so every clone and
  worktree of it shares the sign-in. Otherwise it's the repo's git directory.
- Two repos on the same Jira site each sign in once.
- GitHub was already per repo, through the account the config names (D-007).
- This replaces D-026's one Jira token per site.

**Azure DevOps** reads Azure Boards over its REST API (7.1).

- **Columns** are the team's Kanban columns. Each one maps every work item type
  to a state. Two columns can share a state, so a card is placed by its board
  column field, and a move sets that field and the column's state together.
- **Work items** are the board's types in the team's area paths, leaving out
  Removed, and showing finished ones only from the last 30 days.
- **Rich text.** Descriptions, acceptance criteria and repro steps are HTML, or
  markdown where the org has switched. A tolerant HTML reader turns them into the
  same document model as GitHub and Jira, keeping structure and dropping all
  markup. Comments go out as escaped HTML.
- **Keys** are `AB-123`, after Azure Boards' own `AB#123`, and `prefix` can
  change it.

**Signing in to Azure DevOps**, offered in this order:

1. **Microsoft account.** The extension asks VSCode's built-in Microsoft sign-in
   for Azure DevOps' own scope, in the tenant that owns the organization. The
   tenant is read from the org's `x-vss-resourcetenant` header. The repo
   remembers which account it uses, so another repo can use another account.
   MFA works, and there's no token to renew.
2. **Personal access token**, with Work Items: Read & write, for orgs whose
   tenant blocks VSCode's sign-in.

**"Add a tracker…"** sets a repo up from VSCode: pick the kind, sign in, then
pick the project, team and board from what the tracker lists. It writes to that
repo's `.acc/config.json` only.

## D-028 A clone chooses its own GitHub account, and the UI always shows who you're working as (2026-10-02)

`.acc/config.json` names the account a project works as (D-007), and it's
committed. When someone switches accounts, writing that file would change the
account for everyone else who clones the repo. A client repo is often shared
by several consultants.

**The choice lives in the clone's own git config, as `acc.githubAccount`.**

- It's never committed, and every worktree of the clone shares it.
- acc reads it wherever it uses the account: gh calls, the doctor checks,
  boards and dispatch. When it's unset, the project's account applies.
- `acc github use <account>` switches, and `acc github use --default` goes back.
  `acc github status` shows the account, where it comes from, gh's scopes, who
  git push uses, and who commits are signed as.

**git push follows the choice.** The credential helper acc sets now reads
`acc.githubAccount` each time git asks, falling back to the project's account.
Switching means setting one value; the helper isn't rewritten. An older,
pinned helper is replaced the first time a clone switches. Switching only
offers accounts gh is already logged in to. "Add a GitHub account…" signs one in
through VSCode's GitHub sign-in first, then puts gh's active account back.

**You always see who you're working as.**

- **Status bar:** the repo's account, beside the branch. It changes to a warning
  icon and words when gh isn't signed in as the account, or when git would push
  as another one. Its tooltip gives the details, with Switch account and Sign
  in.
- **Environments tab:** an identity card with the account, where it's set, gh's
  scopes (including the Projects scope a GitHub Project's board needs), who git
  push uses, and who commits are signed as.
- **Boards and the comment box:** they say who they act as, for every tracker:
  the GitHub account, the Jira email, or the Microsoft account.

Commit identity isn't switched along with the account. It's shown beside it,
and B2.identity checks it.

## D-029 One Command Center page replaces the sidebar views (2026-10-02)

Five narrow, stacked trees in the sidebar made people hunt, and each tab opened
on its own. Now there's one full page. This supersedes D-020's sidebar and
D-021's separate tabs.

- **The activity bar icon is a launcher.** Clicking it opens the page and closes
  the sidebar. Its one view lists the sections with their counts, for anyone who
  sets `agentCommandCenter.openFromActivityBar` to false. Its badge counts what
  needs a person.
- **A rail holds the sections:** Overview, Tasks, Agents, Worktrees,
  Environments and Setup. Each shows a count, outlined in orange when it's
  something for you. Arrow keys move between them. Below 820 px the rail becomes
  a tab strip along the top.
- **Overview comes first.**
  - **Needs you** lists agents waiting on a prompt (with Attach), blocked tasks,
    missing tracker sign-ins and setup still to do. It counts only those, so the
    rail and the inbox agree.
  - Work waiting for review follows as its own group.
  - Stat tiles open their sections. **Ready for an agent** has Dispatch, and
    **Recent activity** shows the latest moves across tasks.
  - An agent already shown through its task isn't listed twice.
- **One model.** The page gets every section's data in one message, and moves
  between sections without a round trip. It reopens where it was left.
  `acc.open.<section>` opens it at that section.
- **Ticket pages stay separate tabs.** A ticket is a document, and several can
  be open side by side.

## D-030 Agents ask, and commands answer, in the Command Center (2026-10-02)

Working with agents meant finding the right terminal: attaching to see what a
builder was doing, attaching again to answer its permission prompt, and reading
setup's fixes scroll past in a terminal tab. Now the page does all three, and a
terminal opens only for a command that needs a keyboard of its own.

- **Questions come to the page.** Sessions acc starts get a PermissionRequest
  hook in their `--settings`: builders through `acc dispatch`, and free-form
  agents started from the page. The hook is `acc hook permission`.
  - Each permission prompt, and each AskUserQuestion, goes into
    `~/.acc/questions/` as a file only you can read. The hook waits there for an
    answer.
  - The page shows it as a card. A prompt gets Allow, "don't ask again this
    session" (when Claude Code offers a rule) and Deny with an optional reason.
    A question gets its options, or a typed answer, or Let it decide.
  - A notification carries the same choices when the page isn't on screen. It
    offers Allow only when the whole command fits in it.
  - Tested against a real background session: two commands and a question were
    answered from the queue, and the agent carried on with the answer.
- **The hook never strands an agent.** Each open window writes a listener file
  for its folders every 15 s.
  - With no window listening for an agent's folder, the hook prints nothing at
    once, and Claude Code asks in its own prompt as before. The same happens
    when the last window closes, when the hour-long hook timeout is near, or
    when you choose "In the terminal".
  - It never exits 2, which would block the tool.
  - Claude Code shows its own prompt while the hook waits. If you answer there
    instead, the session is seen working again, and the window ends the hook,
    which withdraws the card.
- **Each agent has an activity page.** Watch (now the main action on a running
  task) opens a tab with the session's timeline:
  - the task instructions, folded
  - what the agent said, as formatted text
  - each tool as one sentence, with its command and an expandable result
  - Claude Code's own recap, and the waiting question to answer in place
  - It reads the transcript as it grows, once a second while the tab is on
    screen. An ended session's page still reads.
  - The transcript format is Claude Code's own and unstable, so it's read
    loosely: unknown records are skipped, and the page says so when nothing
    could be read. Attach stays for a real conversation.
- **Commands run in an output panel.** Setup's Do it, sf org login, acc init and
  doctor, Open org and Compare run as child processes, and their output streams
  into a panel at the bottom of the page.
  - The step shows that it's running, and checks itself afterwards. The status
    bar shows a running command.
  - When a command goes quiet on a question (`[y/N]`, `Password:`, `Name:`), the
    panel asks it for you: Yes and No, or a box. A password goes only to the
    command, and is never shown or saved.
  - Stop, Run in a terminal (it starts again there) and Dismiss are on the
    panel's toolbar.
  - Fill-in-the-blanks commands, `claude`, `sudo`, `ssh`, editors and
    `gh auth login` still open a terminal.
- **Why files and a hook, not an API.** Claude Code has no documented way for
  another program to answer a running background session. The hook is
  documented, works in background sessions given through `--settings`, and can
  answer AskUserQuestion through `updatedInput.answers`, which we confirmed
  first. Files in one machine-wide folder work across repos, worktrees and
  windows, like the heavy-check slots (D-024). The first answer wins: a
  hard-linked answer file can't be written twice.

Also fixed: the row menus still named the old per-section webviews, so they
were empty on the D-029 page. They now name `acc.home`, and a test ties them to
the page's view type. The screenshot script's narrowest width is now 500 px,
because Chrome lays out no narrower and cropped 480 px shots.

## D-031 A person can waive a check on one commit, with a reason (2026-10-02)

T-1 stopped at Blocked: its formatting commit passed `format`, but `static` and
`validate` failed on problems that predate it. acc had no way to say "set this
aside" except forcing the move, which records the override but not which checks
were waived, or why.

- **A waiver is the gate's receipt.** `acc gate waive <gate>... --reason "<why>"`
  writes a `skip` receipt for the commit: the task's latest commit with
  `--task`, else this checkout's. The receipt keeps `waived: { by, reason, at,
  was }`.
  - A skip already satisfies a required gate (D-024), so `acc done` and the move
    rules need nothing new.
  - The ticket page shows the check as **waived**, with its reason.
- **It holds for that commit only.** `acc gate run` doesn't rerun a waived gate
  on the same commit. A new commit starts with no checks, waived or not.
- **Only a person can waive.** The CLI refuses when `ACC_ROLE=builder`, whatever
  `--as` says. Builder settings deny `acc gate waive`. A gate that passes has
  nothing to waive, and a waiver needs a reason.
- **Blocked → review, by a person, once every required check is satisfied.** A
  builder that blocks on failing checks has finished its work. Once a person
  has settled the checks, the task goes to review by the rules, with no
  override.
- **In the page:** a failing or errored check on a ticket page has
  **Waive…**, which asks for the reason. Move then offers In review.

Used first on T-1: `static` and `validate` waived, because it tests the process
and won't be promoted. It then moved from Blocked to In review.

## D-032 A read-only reviewer agent judges each commit before it lands (2026-10-02)

`acc review <id>` runs a fresh `claude -p` in the task's worktree. It gets:
- the builder's instructions
- the diff against the environment's branch
- the checks on the commit, waivers included
- the project's rules

It returns a verdict to a JSON schema: pass or changes, a summary, each
acceptance criterion met or not with evidence, and findings marked must or
not.

- **Read-only by construction.** Only Read, Grep and Glob are allowed, and the
  `dontAsk` mode refuses everything else. That's simpler and stricter than
  `plan` mode, which expects to end by proposing a plan.
- **The verdict belongs to one commit,** like a receipt. `acc land` needs a pass
  on the branch's latest commit. A rework run's instructions list what must be
  fixed and the criteria not met, and nothing else.
- **It's watchable.** acc gives the session its id and records it while the
  review runs, so **Watch the review** opens its activity page.
- **It runs on your own Claude Code sign-in.** On a subscription it's usage,
  not a bill. Claude Code reports a `total_cost_usd` in every result anyway: an
  estimate at API prices, kept with the verdict and never shown as a charge.
- **First real run, on T-1.** It read every formatted file against its
  original, and found that a line break prettier added in an LWC template
  changes the rendered text: the compiler drops the trailing space. T-1 went to
  rework with the fix described. That took four minutes.

## D-033 acc land opens the pull request; acc sync follows it (2026-10-02)

- **`acc land <id>`** needs the task in review, its checks settled, and a passing
  review on the branch's latest commit.
  - It pushes with the clone's credential helper, so as the repo's account
    (D-028). It opens the pull request with `gh` as that account.
  - The description holds the review's summary, the acceptance criteria ticked
    off, every check (waivers named, with their reasons), and the non-blocking
    findings.
  - A GitHub issue gets a comment with the link. A Jira or Azure DevOps ticket
    gets one from the extension, signed in as you.
  - Landing again after rework updates the same pull request. It never merges.
  - The page asks first, because landing is the first thing that leaves the
    machine.
- **`acc sync`** reads each open pull request:
  - merged → done
  - closed without merging → blocked, with the reason
  - failing checks, or a person asking for changes → needs you, with the reason
    on the Overview
  - It writes to the ledger only when something changed.
- **On the page,** a task in review shows one next step: Watch the review,
  Review, Land, or its pull request.

## D-034 Promotion builds its branch from the destination; deploys follow what was last deployed (2026-10-02)

- **A promotion's pull request starts from the destination branch and copies in
  what the source changed** since the branches last shared history, rather than
  merging the source branch. A straight merge would carry environment-specific
  files (which differ in every org by design), and could undo a fix made
  straight in the destination.
  - Files the destination already has as the source does are skipped, so a
    second promotion brings only what's new.
  - Deletions are named, and need a person's go-ahead.
  - Skipped environments on the usual path are named in the title, the
    description and the confirmation (D-018).
- **Its check is its own check-only deploy to the destination's org.** The task
  gate `validate` refuses protected orgs, because tasks never target them. A
  promotion into production is exactly what should be checked against
  production. It runs the org's local tests when Apex changes, and saves
  nothing. A failing check opens no pull request.
- **`acc deploy` is the one command that changes an org.**
  - It deploys what changed on the branch since the last deploy it recorded
    (a first deploy names its starting commit), from a throwaway checkout of
    the branch on GitHub.
  - It never deploys environment-specific files or deletions, and runs one at
    a time under the heavy slot.
  - It records where it got to only when the deploy succeeds.
- **Only a person promotes or deploys.** The CLI refuses builders and reviewers,
  and builder settings deny both. On the page, Promote… shows the plan before
  anything happens. Deploy… asks for confirmation, and a protected org needs
  its name typed.

Also: the Kanban lanes are a fixed width, however many a board has. The board
scrolls sideways, each lane scrolls under a pinned heading, and a fade marks
the edge that has more lanes past it.

## D-035 The last project setup steps get a Do it of their own (2026-10-02)

B5, B6, B9 and B10 were terminal recipes in ONBOARDING.md. Each is now an
`acc setup` command that the walkthrough's **Do it** runs in the output panel
(D-030).

- **`acc setup baseline` (B5)** runs `sf project generate manifest` on every
  environment branch, in throwaway worktrees, and writes the union to
  `manifest/baseline-package.xml`: sorted, at the newest API version.
- **`acc setup branches` (B6)** makes each missing branch.
  - Production's comes first, from this checkout, retrieved from its org.
  - Each sandbox's starts from production's with its source cleared, so what
    exists only in Production shows as a difference. It's then retrieved from
    its own org.
  - The orgs are only read. A branch whose retrieve fails is removed again, so
    the next try starts clean. Nothing is pushed without `--push`.
- **`acc setup lists` (B9)** drafts both lists from how each sandbox's branch
  differs from production's.
  - Org configuration goes to environment-specific: email services, named and
    external credentials, SSO, remote sites, and the email, security and
    domain settings.
  - App logos go to known drift, and so does any file whose two versions have
    the same lines in another order: Salesforce's ordering noise, measured
    rather than guessed by file type. On Avalign that's 3 object files, where
    "every object file" would have been 52.
  - It names the differences neither list explains, and never overwrites a
    list you have.
- **`acc setup readme` (B10)** writes the environments table, the promotion
  flow and the environment-specific rule between `<!-- acc:environments -->`
  markers. Running it again replaces just that part.

None of them commits to an existing branch. A person reads the drafts and
commits them on each environment's branch.

## D-036 Builders and reviewers each have a model and effort, set per clone or per project (2026-10-02)

Agents ran on whatever Claude Code defaulted to, which is its heaviest model at
high effort. That's right for some work and wasteful for a quick review. Each
kind of agent now has a profile: a model (an alias such as `opus`, `sonnet` or
`fable`, or a full name), an effort from `low` to `max` (how hard it thinks),
and a fallback model for when the first is overloaded.

- **Two places to set it, like the GitHub account (D-028).** This clone's
  choice lives in git config (`acc.builder.model`, `acc.reviewer.effort`, …),
  and nobody else sees it. The project's default lives in `.acc/config.json`
  under `agents.builder` and `agents.reviewer`, for a team to share. A clone's
  choice wins, part by part. Anything unset is Claude Code's own default.
- **They're Claude Code's own flags.** `--model`, `--effort` and
  `--fallback-model`, on the builder's background session, the reviewer's
  `claude -p`, and free-form agents started from the page, which run like
  builders.
- **On the page:** the Agents section opens with **How agents run**. Each
  profile shows every part and where it's set, and **Change…** walks through
  model, effort or fallback, then asks whether it's for this clone or the
  project. An agent's page shows the model its answers came from, read from
  the transcript.
- **What they bill.** Under the profiles, the setup check `A1.claude-billing`
  (GH-9) says whether agents use your Claude subscription, or would bill per
  token through an API key.
- **`acc agents` and `acc agents set`** do the same from a terminal. A project
  change edits only that part of `.acc/config.json`.

Also: builders may now run their tests and builds under `nice -n 15` without a
prompt, as this repo's own rules ask. The first real run of GH-9 stopped on
exactly that.

## D-037 What you answered stays on the page (2026-10-02)

Once a question was answered, its card vanished, and nothing on the page said
what had been asked or decided.

- **The hook keeps a record.** It's the one place that knows how each question
  ended, so it appends it to `~/.acc/questions/history.jsonl` (only you can
  read it; trimmed past 2 MB). The record holds:
  - what was asked, and when
  - the outcome: allowed, allowed for the session, said no (with your reason),
    answered (with the answers), let it decide, handed to its terminal, or
    stopped
  - when no window was listening, so it asked in its own terminal
- **Each agent's page shows its decisions in place.** A "You" entry sits after
  the step before you decided, with what it asked, the command, and what you
  said.
- **The Overview's History** replaces Recent activity. It's a scrolling box,
  newest first, holding your answers, task moves, and the commands acc ran.
  Each line says what happened in words; open one for the full command, your
  words or the command's output. Filters: All, Your answers, Tasks, Commands.
- **Finished commands are kept** in the workspace with the end of their output,
  so the output panel and History still have them after a reload.

## D-038 A prompt on the page offers every answer Claude Code's own prompt does (2026-10-02)

Allow and Deny weren't the whole of Claude Code's prompt: it also offers "always
allow, from this project", "switch to auto mode", "Tab to amend", and Esc to
stop. Each one is now a numbered choice on the card, in Claude Code's order.
Press its number or click it, and hover for what it means.

| Choice | What the hook sends |
|---|---|
| Yes | allow |
| Yes, and always allow … in this session | allow, with the suggested rules for the session |
| Yes, and always allow … in this project | allow, with the rules saved to `.claude/settings.local.json` |
| Yes, and switch to auto mode | allow, with `setMode: auto` for the session |
| Edit the command, then allow… | deny, telling the agent to run your version, which is then approved once |
| No, and tell it what to do instead… | deny, with your words |
| No, and stop it | deny with `interrupt`: its turn ends, as Esc does |
| A plan: Yes, and auto-accept edits / approve each edit / keep planning… | allow with `setMode: acceptEdits` or `default`, or deny with your feedback |

- **Each was tried against a real session first.** The edited command ran
  instead of the original. Auto mode took over and asked nothing more. The
  stop ended the turn with "Request interrupted by user for tool use".
- **An edit isn't slipped in silently.** Allowing with `updatedInput` runs
  your version, but the agent never hears of it, and the test agent was
  puzzled by the result. So an edit is a "no, run exactly this instead". Your
  version is approved for that session's next run of exactly that command,
  within ten minutes.
- **The notification** offers Allow (when the whole command fits) and **All
  choices…**, which opens the full list in VSCode's own picker.
- **Never** a switch to `bypassPermissions`: the hook refuses it.

## D-039 Pages say the gist first, and a lone board fills the page (2026-10-02)

T-1's page put the whole of its instructions, every history move's paragraph,
and the full block reason (twice) on screen at once.

- **Summary first, details on demand.** A blocked task opens with one line:
  why it's blocked. The description shows its first lines. History shows the
  last three moves in plain words ("Its agent blocked it", "jordan moved it to
  In review"), and each opens to its reason; Show all brings back the rest. The
  side panel no longer repeats the block reason.
- **Prompt choices are one line each**, with what each means on hover.
- **A page with one board gives it the rest of the height,** with full-height
  lanes, so anywhere on the board scrolls sideways. A mouse wheel goes
  sideways too, over a heading, a gap, or a lane too short to scroll.

## D-040 Agents open in Claude Code for VSCode, not a terminal (2026-10-02)

Attaching to an agent opened `claude attach` in a terminal. Claude Code for
VSCode shows the same conversation far better, and with everything Claude Code
can do. Its documented link, `vscode://anthropic.claude-code/open?session=<id>`,
resumes a session's conversation, history and all, in a tab. It finds sessions
in the project's worktrees too.

- **Open in Claude Code** is the main way into an agent: on question cards, an
  agent's page, its row menu, task cards and the Overview. It replaces Attach
  where both would be. Attach in a terminal stays on agent pages and row menus,
  and is the fallback when Claude Code for VSCode isn't installed (acc offers
  to install it).
- **One conversation, one place.** Claude Code warns that using a session in
  two places at once mixes up its messages. So:
  - A background session that's still working or waiting is **taken over**:
    after you confirm, acc stops it in the background, waits until Claude
    Code no longer lists it as running, then opens the tab, where you drive.
  - An interactive one, open in a terminal or another tab, asks before
    opening a second view.
  - An ended session simply opens.
- **What doesn't carry over:** a builder taken over loses its builder settings
  (allow list, task identity and question hook), because the tab runs with
  your own. Its task stays Running until it's finished with
  `acc done <id>` or moved from the page.
- The link takes the full session id. The short background id is never sent.

## D-041 Cards move by drag and drop; a worktree's conversation opens in its own window; agent pages fit the window (2026-10-02)

- **Drag a task's card to another lane** of the agent board to move it.
  - A card carries the lanes acc's move rules let a person take it to. While
    you drag, those lanes stay bright and the rest dim.
  - Dropping asks for a reason when the rule wants one. Dropping in Running
    dispatches the task, after a confirmation.
  - acc still decides: a refused move snaps back, with the reason.
  - Going back to to-do shows one lane, the one it will land in: Ready when
    nothing it waits on is unfinished, otherwise To do.
  - Cards no longer carry a Move button. Move stays on the ticket page and in
    menus.
- **Open in Claude Code opened a blank conversation for builders.** Claude Code
  opens a conversation only if it belongs to the window's own folder, and a
  builder's belongs to its worktree. So when the session's folder isn't the
  window's, acc opens that folder in a new window, remembers the session for
  two minutes, and the new window opens the conversation as it starts. That's
  also where a builder is best driven: in its own checkout.
- **An agent's page fits the window.** The heading stays, and the timeline
  scrolls in its own box, following the newest step.
  - Runs of tool steps between the agent's messages fold to one line ("8 steps:
    ran 5 commands, read 2 files, edited 1"). The latest run, and any step that
    failed or is running, stays open.
  - Only the last 25 blocks show, with Show earlier for the rest.
  - The recap shows two lines, without Claude Code's "(disable recaps in
    /config)".

## D-042 The plugin: hooks as `acc hook <event>`, validated strictly, with a release-only bundle (2026-10-02)

- **The hooks are acc commands,** `acc hook session-start | pre-tool-use | stop`,
  like the permission hook. The rules live in core (`hooks.ts`) beside
  everything else they enforce.
  - Each hook finds `.acc/config.json` by walking up from the session's
    folder, before running anything, so a repo that hasn't opted in costs
    nothing.
  - A builder is known by its environment, or by its folder being a running
    task's worktree, so the guards also hold for a session started some
    other way.
  - On anything unexpected a hook prints nothing and exits 0. It never exits
    2, which would block the tool.
- **The Bash guard is stricter than the first design.** Builders never push,
  not even their own branch: `acc land` does that after review. It also stops
  switching branches, `git worktree`, `reset --hard`, and every acc command
  that's a person's. Commands are split the way the shell would, through
  quotes, `&&`, `;`, pipes, subshells and wrappers such as `nice` or
  `FOO=1`. So `git add -A && git push` is caught, and `echo 'git push'` isn't.
- **Fixtures.** Each rule has a fixture in
  `packages/core/test/fixtures/hooks/`: the event, the hook's input, and the
  outcome expected. The test runs each through the real `acc hook` command,
  against a repo with a task running in a real worktree. That's 26 cases, with
  allowed commands beside denied ones.
- **Checked live:** a `claude -p` session loaded with `--plugin-dir plugin`, as
  a builder, had `git push` refused by the hook, even though its own
  `--allowedTools` allowed it. When it then stopped short, the Stop hook sent
  it back to the finish line.
- **The permission hook isn't in the plugin.** Globally, it would send your
  own interactive sessions' prompts to the page while you're looking at the
  tab. Dispatch adds it to builders.
- **`plugin/bin/acc` is refreshed only for a release** (`npm run package`).
  Every check rebuilt it before, so any branch that ran its checks conflicted
  with `main` over a generated file: pull request #10 did. The day-to-day
  build now writes `dist/acc`, which git ignores.
- `claude plugin validate --strict` passes for the plugin, its skills and its
  agent, and for the marketplace (`npm run validate-plugin`). The profiles and
  templates folders in the first design weren't needed: profiles and the
  packet live in core.

## D-043 The question history keeps its newest 1,000 records (2026-10-02)

D-037's history was only cut back past 2 MB, by dropping the older half. With
short records that's thousands of them, and the extension reads the whole file
each time it changes. Issue #11.

- **The newest 1,000 records are kept,** and no more than 2 MB of them, so a few
  very large ones (a `Write` with a whole file in it) can't make the file huge.
  The newest record always stays, even one past 2 MB on its own.
- **An append doesn't read the history.** It writes the record, `stat`s the
  file, and reads `history.trimmed`, a few bytes next to it that hold the size
  the last trim left. The history is read, to be trimmed, only once it has
  grown 64 KB past that size. So between trims it holds up to 64 KB more than
  1,000 records, which is a hundred or two at a few hundred bytes each. The page
  shows the newest 500, so nobody sees the difference. Trimming on every append
  past 1,000 would read and rewrite the whole file every time.
- **Growth is measured from the last trim, not from fixed 64 KB marks.** Marks
  looked stateless, but when the newest 1,000 records add up to just under a
  mark, every append after a trim crosses it again and trims again. A missing
  `history.trimmed`, one that doesn't read, or one larger than the file (the
  file was deleted or replaced) counts as 0, so it can't stop the trimming.
- **The trim is a rewrite,** to a temp file in the same folder and then a
  rename, so a reader never sees half a file. Lines that don't read, from a
  crash or a half-written append, are dropped and don't count. The readers
  skip them, as before.

## D-044 The swarm at a glance: a status bar summary, and notices when a task changes (2026-10-02)

M7 asks for three agents watched from VSCode. The page shows everything, but
only while it's open, so:

- **One status bar item** says what needs you, what's running and what's in
  review, for example "1 needs you, 2 running, 1 in review", each count with
  its icon (bell, sync, eye) as well as its words. It turns the warning colour
  when something needs you, and it hides when nothing is in play. Clicking it
  opens the Overview.
- **A notice when a task changes** in a way a person would want to hear about:
  - a builder finished (Review)
  - a review passed (Land) or asked for changes (Re-dispatch)
  - a task was blocked
  - an agent waits on its own prompt (Open in Claude Code)
  - a pull request's checks failed or a reviewer asked for changes (Open pull
    request)
  - a pull request merged

  Each offers its next step and Show. They compare the board before and after
  each reload, so each change is said once. A task seen for the first time
  says nothing, and nothing is said until tasks, agents and worktrees have
  loaded once, so opening VSCode doesn't replay the board. They stay quiet
  while the Overview or Tasks board is on screen. A question an agent asks
  already has its own notice (D-030). `agentCommandCenter.notifications`
  turns them off.
- **Polls slow down, rather than stop, while the page is hidden.** The ledger
  is read every 15 seconds, which costs one stat. `claude agents` runs every 30
  seconds, only while a task is running or being reviewed. Open pull requests
  sync every 5 minutes. Worktrees and tracker boards still wait for the page.
- **Two commands M7 listed:** **Intake: new work for agents…** puts writing a
  task, importing GitHub issues and tracking a Jira ticket in one list.
  **Instructions** on a dispatched task's card and page opens the packet acc
  wrote for its builder.
- **A check runs without a builder's identity.** The first three-at-once run
  found it: GH-13's builder saw two CLI tests fail only inside a builder,
  because the `acc` they start inherited its `ACC_TASK`. Check commands now
  run without `ACC_ROLE` and `ACC_TASK`, and the CLI tests clear both. The
  same run deadlocked GH-12's check: a test ran `acc gate run` with no slot
  folder of its own, and waited for the machine's heavy slot, which its own
  check held. Heavy work a heavy check starts is part of that check, so it now
  gets a slot folder of its own, under the check's scratch folder. Both fixes
  are in the `acc` that builders run, so branches made before them pass too.
  GH-12's builder fixed the tests themselves on its own branch, so that fix
  arrives with its pull request.
- **Parallel builders can pick the same decision number.** GH-11's branch
  records a D-043 of its own, made at the same time as this one, so this one
  is D-044. Whoever merges second keeps both entries.

Note (D-162, 2026-10-15): a burst of more than three notices in one reload,
across every project, now shows as one notification that counts them. Each
change is still worked out once, and Slack still gets each one.

## D-045 A task branch's decision is numbered when it merges (2026-10-03)

In the M7 run, GH-11's branch recorded a D-043 at the same time as main did
(#18). Builders work in parallel from the same main, so each one's "next
number" is the same number.

- On a task branch, a new entry is headed `## D-??? <title> (<date>)`, and the
  code and commits refer to it as D-???. Whoever merges replaces each D-???
  with the next free number. CLAUDE.md tells builders so.
- Work committed straight to main is numbered at once, as before.
- Not chosen: `acc land` renumbering the entries, which would add a commit
  after the review; and leaving it to whoever merges second, which means a
  renumber and a hunt for references every time.
- The two entries both appending to the end of the file still conflict when
  both merge. Keeping both is the whole resolution.

## D-046 Open in Claude Code finds a conversation's folder from the file it's saved in (2026-10-03)

The author reported that **Open in Claude Code** kept bringing up this
window's own chat, not the builder that needed them.

- **Cause:** a background builder starts in the main checkout and moves into
  its worktree, and saves its conversation under the worktree. Once stopped or
  blocked, `claude agents` reports the main checkout again. So the button took
  the conversation to belong to this window, and asked Claude Code to open it
  here. Claude Code didn't find it under this folder, and showed the window's
  current chat instead. GH-11 and GH-13 were both like this.
- **Fix:** the folder is found from the conversation file. The candidates are
  the session's reported folder, its task's worktree, every worktree, and the
  window's folders. The first one whose Claude Code project holds
  `<session>.jsonl` wins. A worktree opens in a new window and the conversation
  opens there, as D-041 intended. A session that has only just started may
  have saved nothing yet, so it uses its reported folder. Otherwise the button
  says it couldn't find the conversation and offers Watch, rather than open
  the wrong chat.
- **The same day, 0.19.1 said it couldn't find GH-13's conversation.** The
  author was clicking from the Agents list in another repo's window: the list
  shows every session on the machine. The candidates were that window's own
  folders and worktrees, so they never included this repo's worktrees. VSCode
  keeps each extension's log under its own logs folder, which is where the
  window and the clicks showed up.
- **So the file is found, not guessed.** First it's looked for under the likely
  folders, then anywhere in Claude Code's projects. Its folder is the `cwd` the
  conversation recorded whose name matches the folder it's saved in. That
  works from any window. A stand-in for VSCode, loading the built extension
  against the real repo from the other repo's folder, showed 0.19.1's message
  and then the fix opening GH-13's worktree in a new window.

## D-047 Setup reads in the order things are set up, a section for each thing, with done steps muted (2026-10-03)

The author found the Setup page "too large and disorganized". Steps showed in
the order their checks finished, so B14 (tickets), re-checked first as
projects load, came before the repo itself. Every step was a full tile with
its id, and done steps looked the same as ones still to do.

- **Order:** the step list's order, the order you'd set up a new project in.
  The checks' order no longer matters. A step this build doesn't know goes at
  the end of its group.
- **Sections:** each group of steps is named for what it sets up:
  - This machine: Tools, Accounts.
  - This project: The repo, Orgs, GitHub account, Client data and secrets,
    Salesforce project, Environment branches, Source tracking, Environment
    differences, Safe defaults, Background agents, Tickets, Drift.

  Neighbouring groups with the same name share a section: B4 and B5, and B12
  and B13. The names live beside the steps in core (`GROUP_TITLES`), so there
  is still one source (D-017).
- **Done steps look done:** one muted line with the icon, "Done", the title
  and the detail, and Check again on hover or focus. A section with nothing to
  do folds to one line ("All 3 done"), and one with steps to do opens. Opening
  or closing one by hand is remembered.
- **Steps to do stay whole, but shorter:** the status, the title, what's wrong
  in a sentence, the command to copy if there is one, and the buttons. The
  step's id is gone from the tile, and why the step matters is the title's
  tooltip.
- "Pass" reads "Done" and "Fail" reads "To do", since this is a checklist.

## D-048 Closed issues leave the board, and milestones aren't tasks (2026-10-03)

`acc intake github` read only open issues, so a task whose issue was closed
stayed Ready forever: GH-3 to GH-6 here. Milestone issues came in as tasks too,
so the Ready lane offered to dispatch a whole milestone to one builder.

- **A closed issue's task moves to done, if it never started.** Never started
  means `todo` with no `run`. A new rule allows `todo → done` for the `sync`
  actor only, and intake makes the move as `sync`, with the reason "Issue #N
  was closed on GitHub." A person still has `--force --reason`.
- **A task that started is left as it is, and named.** Someone closed the
  issue while work was under way, or after it. Whether that work lands or is
  dropped is a person's call, so the output says "#N was closed on GitHub;
  GH-N is still <state>" and changes nothing.
- **`skipLabels` on a GitHub tracker** lists labels whose issues aren't tasks.
  It's empty by default, and this repo sets `["milestone"]`. Labels match
  without regard to case, as GitHub's do. An issue with one isn't imported. A
  task already made from one leaves the ledger if it never started, with a new
  `task.removed` event, so `events.jsonl` keeps its whole history. One that
  started is named, like a closed one. A closed milestone is still a
  milestone: it's removed rather than counted as done.
- **Intake asks about each unfinished task whose issue wasn't listed**, one
  `gh issue view` each. That covers issues closed long ago, which a list of
  recently closed issues would miss, and issues `--label` left out. Done tasks
  are never asked about, so the usual run makes few calls. An issue GitHub
  can't show, because it was deleted or moved, leaves its task alone.
- **Finished tasks are never named.** A done task from a milestone issue would
  otherwise be named on every run.
- **Left for later:** a reopened issue doesn't bring its done task back, and a
  task that depends on a removed one still waits on it. Both need a person.
- `--json` adds `closed`, `removed` and `leftAlone`. The command's logic moved
  from the CLI into core (`intakeGithub`), beside `sync`, so it's tested with a
  fake `gh`.

## D-049 A pull request that conflicts with its base says so, and in which files (2026-10-03)

Parallel builders branch from the same base, so their pull requests collide. In
the M7 run, 2 of 4 open pull requests conflicted with main: #16 in
`docs/DECISIONS.md`, #10 in `plugin/bin/acc`. Nothing in acc said so: you found
out on GitHub.

- **acc works it out itself.** `acc sync` fetches each open pull request's base
  and branch into origin's remote-tracking refs, then asks
  `git merge-tree --write-tree --name-only` which files it can't merge. It keeps
  them as `pr.conflicts`, empty when the pull request merges cleanly.
  - Nothing local changes: no branch, no checkout, no working tree.
  - GitHub's `mergeable` says only that it conflicts, not where, and it's often
    still unknown just after a push.
  - When the fetch fails or git can't tell, what it last said stands. The fetch
    never stops to ask for a password.
  - The base and branch are the pull request's own, from GitHub, falling back to
    the task's environment and branch.
- **A task in review whose pull request conflicts needs you,** as failing checks
  do (D-033).
- **`acc land` checks too,** once it has opened or updated the pull request, and
  names the files.
- **In the extension:**
  - Cards on both boards say "Conflicts with dev: …", with a warning icon and
    the words, in orange. A card names the first three files by folder and name
    (`bin/acc`). The ticket page names every file in full.
  - The Overview says why the task needs you.
  - A new notice: "Pull request #N (GH-x) conflicts with dev in …", with Open
    pull request (D-044). It's said when a pull request starts to conflict, not
    again as its files change.
- Not chosen: resolving the conflict for you. That changes the branch after its
  review. It's rework, for a builder or a person.

## D-050 The question history loses no record to a torn line or a trim (2026-10-05)

Two ways D-043's history could lose a record, from GH-11's second review.
Issue #17. Neither was new, but D-043 trims every 64 KB of growth, not every
1 MB, so the second came up more often.

- **An append after a torn last line starts a line of its own.** A crash
  mid-write leaves a last line with no newline, and the next record joined it,
  so neither read. An append now reads the file's last byte, and only that, and
  writes a newline first when it isn't one. The newline and the record go in one
  write. The torn line stays a line that doesn't read, which the readers skip and
  the next trim drops (D-043).
- **An append and its trim hold a lock,** `history.lock` next to the history,
  with `withLock`, as the ledger's writes do. Without it, a trim that read the
  file before another hook's append renamed its copy over it, and the record
  was gone. Both take milliseconds, so the lock is short: a lock held past 5
  seconds is broken, and a waiter gives up after 10, so it always outlasts one
  left by a crash.
- The readers don't take the lock. A trim still renames a whole file into
  place, so they never see half of one.
- Not chosen: the trim re-reading after its rename and keeping what arrived
  meanwhile. An append that opened the old file just before the rename could
  still write to it just after the re-read, so it narrows the window without
  closing it.

## D-051 A gh that outlives its timeout is stopped, and a land carries on without its comment (2026-10-05)

On 2026-10-03, `acc land GH-12` posted its issue comment at 15:07:45, but
`gh issue comment` didn't exit until 15:13. Its 120-second timeout didn't stop
it, and the three lands queued behind it waited. The comment also said "updated
after rework", though GH-12 never went to rework: its branch had only merged
main.

- **Every gh acc runs gets `GH_NO_UPDATE_NOTIFIER=1` and `GH_PROMPT_DISABLED=1`.**
  gh's update notifier runs after the command's work, and a prompt waits for an
  answer nobody can give. acc's runner adds both to any `gh`, so a new call
  can't forget them. So do the extension's two runners and the GitHub board's
  client.
- **At its timeout, gh gets SIGKILL.** At a timeout, node signals the process,
  then waits for it to exit. A process that catches SIGTERM outlives its
  timeout: a stand-in that ignores SIGTERM ran 8 seconds against a 1-second
  timeout. gh has nothing to tidy up.
  - Other commands keep SIGTERM, because git removes its lock files on it.
  - A child still holding gh's output can't hold acc up: node closes its end of
    the pipes at the timeout.
  - gh 2.101 stops on SIGTERM mid-request, so what held GH-12's gh isn't
    certain. This covers both ways it could have happened.
- **A run stopped at its timeout says so:** `timedOut`, and "gh didn't finish
  within 2 minutes, so acc stopped it." Its code stays 127, as before, so checks
  and the reviewer read a timeout as they did.
- **A comment that isn't confirmed doesn't stop a land.** The pull request is
  recorded. `acc land` says, in orange after a `!`, that the comment on the
  task's issue isn't confirmed and why, and `--json` has it as
  `commentUnconfirmed`. The comment may have posted, as GH-12's did, so look at
  the issue before posting it again. The extension's message says the same.
- **An update says "after rework" only when it was.** A land records when it
  happened, as `pr.landedAt`. The next land says "updated after rework" when the
  task went to rework since then, and "updated" otherwise. A pull request landed
  before this has no `landedAt`, so its next update says "updated".
- Not chosen:
  - SIGKILL for every command. It would leave git's lock files behind.
  - Finding the last land in `events.jsonl`. That needs no new field, but every
    land would read the whole log.

## D-052 Every task can be analyzed before it's built; Salesforce tasks must be (2026-10-05)

The author asked for this: "before we build, we need to analyze the ticket
to understand requirements, and we need to investigate the Salesforce org to
understand what is there, how things play out, what refactors may be
needed". Until now a builder got only the ticket's text.

- **`acc analyze <id>`** runs a read-only analyst agent, like the reviewer
  (D-032) but before the build. Its answer has a fixed shape (`--json-schema`):
  - requirements: the goal, testable criteria, assumptions, out of scope
  - questions only a person can answer, each with why it matters and a
    suggested answer
  - findings, each with its source
  - the approach: steps, files, refactors needed first, risks, tests, a size
  - a verdict: ready, questions, or split, with the smaller tasks it suggests

  The analysis is kept in the state folder (`analyses/<id>.json`), never in
  git.
- **Answers:** `acc analysis answer <id> <q> "<text>"`, by a person only. When
  the last question is answered, the task is ready. Analyzing again carries
  the answers over to the questions it asks again.
- **The builder is given it:** the packet gets a "What the analysis found"
  section, after the ticket. It holds the criteria, what was decided, the
  findings, the approach, the refactors, the files, the risks and the tests.
- **The gate:** `analysis.required` in `.acc/config.json`. It defaults to true
  for Salesforce and false otherwise, as the author chose. A first dispatch
  of a task that needs one is refused until there is an analysis that isn't
  "split", with every question answered. A person can dispatch with
  `--without-analysis`. A rework doesn't need a new one.
- **Read-only, three ways:**
  - Claude Code's `dontAsk` refuses any tool not allowed.
  - The allowed tools are Read, Grep, Glob, read-only git, and read-only `sf`:
    org display, data query (the Tooling API included), sobject describe,
    org list metadata, limits, project retrieve start, and apex logs.
  - The analyst's PreToolUse hook checks every command word by word, through
    chains, and refuses anything else, as well as any edit.

  On Salesforce it runs in a scratch project under the state folder, so a
  retrieve can't touch the repo, and it reads the repo with `--add-dir`.
- **What it may read:** every org the project lists, and a few sample records,
  production included, as the author chose. It's told to read only the fields
  it needs, and not to copy personal details into the analysis. The
  analysis isn't committed.
- **Our own skill (D-002).** The plugin's `analyze` skill and the analyst's
  instructions borrow from the installed house skills. They took the
  org-safety posture of working-with-salesforce-orgs, the read-only
  inventory of diagnosing-org-health, and Tooling API recipes for automation
  order and dependencies. They depend on none of them, so an analysis comes
  out the same on any machine.
- The analyst runs with the reviewer's model and effort for now. A role of its
  own would mean touching every place that lists the roles.

## D-053 The extension waits for a land as long as its parts can take (2026-10-05)

The review of D-051 found three loose ends. The extension stopped `acc land`
after 180 seconds, though its issue comment alone may take 2 minutes. A
reviewer stopped at its timeout said "Claude Code didn't start: claude didn't
finish within 45 minutes". And the extension showed an unconfirmed comment as
information, while the CLI shows it in orange after a `!`.

- **The land budget comes from land's own timeouts.** land names them:
  `PUSH_TIMEOUT_MS` (5 minutes), `FETCH_TIMEOUT_MS` (2 minutes) and
  `GH_TIMEOUT_MS` (2 minutes, for each gh call). `LAND_TIMEOUT_MS` is the push,
  the fetch and four gh calls (auth token, pr list, pr create or edit, issue
  comment), plus a minute for local git and the ledger lock: 16 minutes. The
  extension runs `acc land` with it, so raising one of land's timeouts raises
  the extension's too. Every other acc command keeps 180 seconds.
- **A reviewer stopped at its timeout says so,** as the analyst already did:
  "The review didn't finish within 45 minutes, so acc stopped it." Only a
  `claude` that never ran says "Claude Code didn't start".
- **A comment that isn't confirmed, or failed, is a warning.** After a land,
  the Command Center shows it with VSCode's warning icon, matching the CLI's
  orange `!`. That covers a GitHub comment gh didn't confirm, and a Jira or
  Azure DevOps comment the extension couldn't post. Its words and the "Open
  pull request" button stay the same.
- Not chosen:
  - One long timeout for every acc command. A hung `acc add` or `acc sync`
    would leave the extension waiting 16 minutes before it said anything.
  - A cancellable land. Cancelling midway could leave a pushed branch and an
    open pull request with nothing in the ledger.

## D-054 The Command Center shows each task's analysis, and you answer its questions there (2026-10-05)

D-052 put the analysis on the command line only. The Command Center now shows
it the way it shows reviews (D-032) and agents' questions (D-030).

- **The hub reads it, never writes it.** Each row gets its task's analysis
  (verdict, time, the questions nobody answered, a split's smaller tasks),
  whether one is running, and whether the project requires one. They're read
  from `analyses/` beside the ledger with core's `readAnalysis` and
  `analyzing`, and each file is read again only when it changes. The hub
  watches the folder too, since starting or ending an analysis doesn't
  touch the ledger.
- **Needs you:** a task to do whose analysis has open questions, or says it's
  too big for one task, shows as Needs you. The hub decides that, not core's
  `displayState`, so `acc status` doesn't show it. A task that's too big is
  Needs you whether or not the project requires an analysis, as the author
  chose. It says "Needs you: 2 questions from its analysis" or "Needs you: too
  big for one task", each with an icon, in orange.
- **Cards.** The next step comes first:
  - Watch the analysis, while one runs.
  - Answer, while it has open questions. This opens the task's page.
  - See the split, when it's too big for one task.
  - Analyze, for a task to do with no analysis. It's the main action where
    the project requires one.
  - Dispatch, once the analysis is ready, or where none is required. Where
    one is required and it isn't ready, Dispatch is hidden and dragging to
    Running is refused, as the author chose. The override stays on the command
    line (`--without-analysis`). Where none is required, Dispatch stays as a
    second button behind Answer, and the builder assumes the suggested
    answers. Nothing is dispatched while an analysis runs.

  The tracker boards' cards and the Overview's Ready list take the same next
  step, so a task held for its analysis stays in sight.
- **The ticket page** puts its Analysis section above the description, gist
  first. It shows the verdict with an icon and a label, the summary, and each
  open question, with its suggestion as one click and a box for your own
  answer. Then Analyze again, and the rest folded: what was decided, the
  criteria, assumptions, what's there now, the approach, refactors, risks,
  tests and files. Once a task is being built, nothing is left to answer, and
  the page shows what its builder assumed. At narrow widths, an analysis
  waiting on you comes before the side panel.
- **The Overview's Needs you** lists one item for each task waiting on its
  analysis, with its questions to answer in place. The rail, the launcher's
  badge and the status bar count each task once.
- **Answers go through acc (D-012).** The page sends `analysis-answer`, which
  is checked like every other message. The extension runs `acc analysis answer
  <id> <q> --json -- <text>`. The `--` keeps an answer that starts with `-` as
  words. What acc refuses, it says why, and the page lets you edit the answer
  and send it again.
- **Notices (D-044):** when a task's analysis comes back, the notice is "GH-29's
  analysis is ready", "has 2 questions for you", or "says it's too big for one
  task". An answer keeps the analysis's time, so it says nothing.
- **A run judges its exit code.** `acc analyze` exits 1 when the analysis has
  questions. The run checks whether a new analysis was written, so an analysis
  with questions doesn't also say "failed (exit 1)".

## D-055 acc autopilot reviews, lands and reworks once, up to an open pull request (2026-10-05)

Until now a person, or the session driving acc, chained every step: review when
a builder finished, land when the review passed, re-dispatch a rework. The
author chose for autopilot to go up to an open pull request and stop there.
`autonomy` (D-014) was in the config, but nothing read it.

- **What the levels mean now.** This replaces DESIGN.md's old order, where
  dispatch came first and full opened pull requests. D-014 still holds: manual
  first, and nothing merges on its own.
  - `manual` (the default): nothing happens on its own. `acc autopilot` says
    so and changes nothing.
  - `review`: autopilot reviews, lands, and re-dispatches a rework once.
  - `dispatch`: as review, and it also starts Ready tasks up to `agents.max`.
    Only the meaning is recorded. The author chose review, so dispatch refuses
    with "not built yet".
  - `full`: read as dispatch, with a warning.
- **`acc autopilot [--once | --every <seconds>]`** does one pass, or one every
  so many seconds, at least 30. The gap is counted from the end of a pass,
  since a pass can hold a 45-minute review. Each pass reads the ledger again
  before each task, and takes one step for it:
  - in review, with no verdict on its latest commit and no review running:
    review
  - in review, passed on its latest commit, with no open pull request or one
    behind that commit: land
  - in rework, never re-dispatched by autopilot: dispatch. This is counted from
    the task's history for its whole life. Every later rework is a person's,
    even after a person re-dispatched it in between.

  A task reviewed in one pass lands in the next. The config is read again
  before each pass, so setting `autonomy` back to `manual` stops it.
- **It acts as the orchestrator.** Lands and dispatches are `orchestrator`, by
  `orchestrator:autopilot`. A review stays the reviewer's move, by
  `reviewer:<id> for orchestrator:autopilot`, since only a reviewer or a person
  may send work to rework. It never merges, waives, deploys, promotes, or starts
  a task that's to do. Builders, reviewers and analysts can't run it: the CLI
  refuses them, `guardBash` refuses it, and the builder's settings deny it.
- **A pull request records the commit it landed** (`pr.sha`), so autopilot can
  tell when one is behind its branch. One landed before this is compared with
  the branch's `origin` ref instead. Otherwise the first pass would land, and
  comment on, every open pull request again.
- **One autopilot a repo.** It holds `autopilot.lock` beside the ledger for as
  long as it runs. A second is refused at once, naming the first one's pid. The
  lock never goes stale with age, because one pass can hold a 45-minute review.
  Only a dead owner frees it, as after Ctrl-C. Autopilot never takes the
  heavy-check slot, so builders' heavy checks run as before.
- **A failed step is kept on the task** (`autopilot.failed`: the step, the
  commit, the state, the reason and when), written as the orchestrator. The
  task shows as needs you in `acc list`, `acc status`, `acc show` and the
  Command Center, with the reason.
  - Autopilot doesn't try that step again on that commit. A new commit lets it.
  - A review, a land or any move clears it, so doing the step by hand does too.
  - A full agent cap, or a ledger busy for the moment, waits for the next pass
    and isn't recorded.
- **Jira and Azure DevOps comments** can't be posted unattended: land hands
  them to the extension, which posts as you. As the author chose, autopilot
  lands anyway. It prints `! Post this on <KEY>` in orange with the text, lists
  it under `pendingComments` in `--json`, and leaves the task as it is.
- **The Command Center**, kept small as the author chose. A task's row carries
  the failure. Its card says "Needs you: autopilot couldn't land: <reason>" with
  the bell, in orange, and so does its tracker card. The Overview lists it as
  "Needs you: autopilot couldn't land", with the reason beside it and the step
  to take by hand. The reason goes beside the label there because the label's
  column is narrow. This replaces the catch-all, which said the task's agent
  was waiting in its terminal. Hosting autopilot in the extension, with a
  switch for it, came later (D-064).
- Not chosen:
  - A lock that goes stale with age. A second autopilot would break a live
    one's lock during a long review, and both would act on the same tasks.
  - Keeping failures in a file beside the ledger. The hub already watches the
    ledger, and `displayState` stays free of file reads.
  - Running `acc sync` in each pass. The Command Center already syncs every 2
    minutes.

## D-056 A sandbox deploy can skip the tests, when a person says so (2026-10-05)

T-1 was the first Avalign change to go all the way, merged into aleysian as
Aleysian/Avalign#1. `acc deploy` always ran local tests when Apex changed, so
the deploy would fail on the four `CaseResponseTimeTriggerHandlerTest`
methods. They fail on the org's holiday data, in Production too, whatever T-1
does. The author chose to let a sandbox deploy go without them.

- `acc deploy <env> --no-tests` deploys with NoTestRun. Salesforce allows that
  on a sandbox and never on production. acc refuses it for production and for
  any protected environment.
- It's a person's flag: autopilot and builders never deploy (D-011, D-055).
- A check-only validate is still how a change proves itself first (D-024).
  T-1's validate compiled the same 17 files in the Aleysian sandbox and ran
  the four test classes there.

## D-057 A task's activity reads as one feed (2026-10-05)

The author asked for the task page's Activity to "look more like a feed". It
was a list of comments, then a separate history of one-line moves, each with
its reason behind a disclosure triangle.

- **One feed, newest first:** the tracker's comments and acc's moves, in
  time order, under a heading for each day ("Today", "Yesterday", "3 Oct").
  The comment box sits above it. Six entries show first, then Show all.
- **Each entry** is an icon on a rail, then who did it in bold, what they
  did, and the state it reached as the board's own status, with its icon and
  label. Tone is blue or orange, never red against green.
- **A move's reason** shows under it as a quote. A long one stops cleanly
  after two lines: the clip is on the text inside the quote, so no half line
  shows in its padding. The last line fades into an ellipsis, with Show all
  under it, as everywhere else on the page (`foldable`). A short reason shows
  whole, with no button. (The first version had you click the text itself,
  with nothing saying there was more, and let part of a third line show.) A
  comment shows as a card.
- The Overview's History keeps its own feed (D-037). The ticket page's
  classes start with `act-`, because the two had collided over `.feed`.

## D-058 Autopilot merges the base into a pull request that conflicts with it (2026-10-05)

When main moves on, open pull requests start conflicting with it, and acc says
so (D-049). The author then resolved them by hand, most often in
`docs/DECISIONS.md`, where both sides had added an entry at the end. Under
`autonomy: review`, autopilot now does that part, and stops at anything more.

- **When.** A task in review whose open pull request is at its latest commit,
  whose review passed, and which conflicts with its base (`pr.conflicts`, kept
  by `acc sync` and `acc land`). Its step is `refresh`. A pull request that's
  only behind its base is left alone. Autopilot still doesn't sync (D-055), so
  before merging it fetches and asks git again. A conflict that's gone is
  marked gone, and nothing is merged.
- **Where.** In the task's worktree, never the main checkout. It merges
  origin's copy of the task environment's branch, which is what `acc land`
  opens the pull request into, as the repo's `commitIdentity`. The repo's hooks
  run. rerere is off, so an answer git remembered from another merge never
  stands in.
- **What it resolves.** Only files listed in `autopilot.appendOnly` in
  `.acc/config.json`, and only when both sides just added to the end: the
  merge base's copy is the start of both. It keeps both, the base's additions
  first, then the branch's. The list is empty by default, and this repo lists
  `docs/DECISIONS.md`. An entry is a path or a folder inside the repo.
  - It reads the three copies from git's index, not from conflict markers, so
    a user's `merge.conflictStyle` changes nothing.
  - A listed file edited anywhere but its end, added on both sides, deleted,
    renamed, a link or binary is a real conflict.
- **Anything else stops it.** Any other conflict aborts the merge: the branch
  is at the same commit, the worktree is clean, and nothing is pushed. The task
  needs you, with "autopilot couldn't update from its base" and every file it
  couldn't resolve. It refuses without merging when the worktree has
  uncommitted changes or is gone, or when origin's copy of the branch has
  commits the local one lacks, as after GitHub's "Update branch".
- **Checks, then a review, then the land.** After a clean or resolved merge,
  it runs the required checks on the merge commit, in the worktree, and records
  them. The next pass reviews the merge afresh, and the pass after lands it,
  which pushes it and updates the same pull request. `acc land` already
  refuses a commit without settled checks and a passing review, so nothing
  that hasn't passed is pushed. A refresh takes three passes, one step a task
  each.
- **A check that fails rolls the branch back,** as the author chose. It goes
  back to the commit before the merge (`git reset --hard`), which is safe
  because a refresh never starts in a worktree with changes. The failure is
  recorded as `refresh` on that commit, naming the checks that failed and
  their logs. As with every step (D-055), it isn't tried again on that commit.
  A new commit on the branch lets it, and the base moving again doesn't, as
  the author chose: a person handles a real conflict anyway.
- **Autopilot now takes the heavy-check slot** for a refresh's checks, as a
  builder's checks do. This amends D-055, where it never took it. A slot still
  taken after its 3 hours undoes the merge and waits for the next pass, and
  isn't recorded as a failure.
- **A waiver doesn't carry over.** It holds for its own commit (D-031), so a
  task that needed one fails its refresh until a person looks.
- **On Salesforce,** the merge is validated with the Apex tests the branch's
  last `validate` named. Without them, validate fails whenever Apex changed.
- **In words.** `acc autopilot` says "Couldn't update `<commit>` from its base"
  and `acc show` says the same. The Command Center says "Needs you: autopilot
  couldn't update from its base", with the bell, in orange, and its Overview
  offers the pull request.
- This reverses D-049's "Not chosen: resolving the conflict for you. That
  changes the branch after its review." The merge gets its own checks and its
  own review before it's pushed. D-014 still holds: nothing merges a pull
  request on its own.
- Not chosen:
  - Keeping the merge commit when its checks fail, for a builder to fix. The
    branch would end on a commit nobody asked for, whose checks fail, and the
    next pass would try to review it.
  - Rebasing or force-pushing a task branch. A pull request's history stays as
    people saw it.
  - Resolving any other conflict, with an agent or with rules of thumb. That's
    rework, for a builder or a person.
  - An `acc refresh <id>` command or a Command Center button. Left for later.

## D-059 Only a task to do asks for answers, every answer gets a reply, and the Overview names conflicting files short (2026-10-05)

Follow-ups from GH-29's review (D-054, D-049).

- **An analysis after the build is news.** `acc analyze` takes a task in
  review, rework or blocked, but only a task to do has questions to answer on
  its page (D-054). Analyzed again in any other state, the notice says
  "GH-29's analysis is back", adds "Its 2 questions can be answered with acc
  analysis answer" when there are some, and offers only Show. It isn't a
  warning and never offers Answer or Dispatch. A task to do keeps its three
  notices. The author chose this over letting the page take answers after the
  build, which would be its own ticket.
- **Every answer sent from a page gets a reply.** The page shows "Sending your
  answer…" until it hears back, so the extension always answers: done, or why
  not. A project that isn't open, an answer for another task, or acc's refusal
  each comes back with its reason. The page shows the reason under the
  question, in orange with a warning icon, keeps the draft, and lets you send
  it again.
- **The Overview names conflicting files by folder and name,** as the cards do
  (D-049): `layouts/Lead-Lead Layout.layout-meta.xml`, the first three, then
  "and N more". Hovering the row's words lists every file in full, and the
  task's page still names every file in full.

## D-060 You write to an agent from its page (2026-10-05)

The author asked for an agent's chat to open "as a tab too", in the same
window. **Open in Claude Code** opens it in its worktree's own window (D-046).

- **Why not a Claude Code tab here:** the extension's open link takes only
  `session` and `prompt`, and every tab works in the window's first folder
  (Claude Code for VSCode 2.1.289). A builder's conversation is its
  worktree's. Resuming it under this window's folder would carry the builder
  on in the main checkout, outside its worktree. Adding the worktree to this
  window's folders restarts the extensions, and Claude Code still looks only
  in the first folder.
- **So the agent's own page takes messages.** That page is already a tab here
  (D-030). A box under its timeline sends to the session's own conversation:
  - `claude -p <message> --resume <session>`, in the folder the conversation
    is saved under (D-046)
  - with the rules it was dispatched with: the builder's settings, so its
    allow and deny lists and its hooks, `ACC_ROLE`, `ACC_TASK`, its permission
    mode, and its model and effort

  It shows in the output panel, and its answer streams into the timeline
  above. Questions it asks still come to the page (D-030).
- **One place at a time.** You can't write while it works, waits on a
  question, or is open in a terminal or a Claude Code tab: the box says why.
  An idle background agent is stopped first (`claude stop`), so the
  conversation never runs in two places.
- **Open in Claude Code** stays, for Claude Code's own view.

## D-061 Boards keep their place when their tab comes back, and scroll while you drag (2026-10-05)

Two things the author found on the Tasks board:

- **It jumped back to the left after a task's tab was open.** VSCode doesn't
  keep a hidden tab's page (`retainContextWhenHidden` is off, to stay
  light), so switching back rebuilt it. Scroll positions survived the page's
  own redraws, but not a rebuild. Now each page saves where it's scrolled:
  - its own position, and each board's sideways position and lanes
  - a moment after it stops moving, in the tab's saved state, which VSCode
    keeps for a hidden tab
  - per page and section

  A rebuilt page comes back there. The screenshot harness takes
  `ACC_SHOT_STATE` to start a page from a saved state, which is how this was
  checked.
- **A card couldn't reach a lane off screen.** Dragging a card near a board's
  left or right edge now scrolls the board that way, faster the closer it
  is. It stops when the card leaves the edge or the board, or the drag ends.
  This works on both boards: the tracker's and acc's.

## D-062 A card has one next step; the rest wait behind ⋯ (2026-10-05)

The author found the agent board's buttons "all thrown together". A finished
T-1 showed five equal buttons: Worktree, Instructions, Pull request #1,
Clean up and Details.

- **The footer:** where it lives (its worktree) and its pull request, as a
  link, on the left. Its one next step, as the only button, on the right:
  Dispatch, Answer, See the split, Watch, Watch the analysis, Land, its pull
  request, Re-dispatch, or Clean up for a done task. A card with no next step
  has no button.
- **Behind ⋯** in the card's corner: everything else, such as Instructions,
  Worktree, Open in Claude Code, Ticket, Block and Unblock. Abandon comes
  last, after a line, in orange. The menu has each item's icon and label,
  closes on a pick, a click elsewhere or Escape, takes the arrow keys, and
  stays open while the board redraws.
- **Gone from the card:** Details, because clicking the card opens the task,
  and Move, because dragging does that (D-041).
- The task page keeps showing every action (D-039).

Note (D-168, 2026-10-16): the next step is no longer on the footer's right. It is a full-width button on a
row of its own under the footer's line, the task page's size; the worktree and pull request stay above it.
The menu behind ⋯ keeps its items in the task's one order: Block before the rest.

## D-063 Autopilot never replaces a closed pull request (2026-10-05)

Follow-ups from GH-33's review (D-055). The review asked whether autopilot
should open a new pull request for a task whose pull request someone closed.
The author's answer: no, a person decides.

- **A closed pull request waits at the land step.** `acc sync` blocks a task
  whose pull request was closed without merging. When a person moves it back
  to review, autopilot no longer lands it as a new pull request: its review
  passed, its pull request is closed, and it waits. This amends D-055's land
  rule, which treated a closed pull request the same as none. Autopilot still
  reviews a new commit on the task, because a review only writes to the state
  folder and doesn't touch GitHub.
- **The task needs you, naming the pull request.** A task in review whose
  pull request is closed shows as needs you at every autonomy level, manual
  included, because the ledger alone decides it (`closedPr`, which
  `displayState`, autopilot and `acc show` share). `acc show` says "! Pull
  request #N was closed without merging. Reopen it on GitHub and land to
  update it, or land to open a new one." In the Command Center, its card,
  tracker card and task page say "Needs you: pull request #N was closed
  without merging", with the closed pull request icon, in orange. The
  Overview lists it as "Pull request closed" and offers Land (or Review), the
  pull request and Open. It no longer says the task's agent is waiting in its
  terminal.
- **A person lands it, or moves it.** `acc land`, or Land in the Command
  Center, updates a pull request someone reopened on GitHub, or opens a new
  one. Either way the task stops needing you. Moving the task anywhere else
  clears it too. acc never reopens a pull request itself.
- **A stale ledger can't open a second one either.** Autopilot doesn't sync
  (D-055), so the ledger can still say open after the pull request was closed
  or merged on GitHub. When autopilot lands a task whose ledger names a pull
  request, and GitHub lists none open for its branch, `acc land` refuses:
  "Pull request #N isn't open on GitHub. Autopilot won't open another: a
  person decides." It also refuses when gh can't list them. Autopilot records
  it like any failed step, so the task needs you. `acc land` now looks for
  the open pull request before it pushes. A refused land pushes nothing, so
  it can't recreate a merged pull request's deleted branch. A person's land
  still opens a new one.
- **Autopilot runs on a repo where no task was ever added.** It creates the
  state folder before it takes `autopilot.lock` there, as `mutate` does
  before taking the ledger's lock. Until now it crashed with ENOENT.
- Not chosen:
  - Teaching `acc sync` to follow closed pull requests, so one reopened on
    GitHub stops needing you by itself. Until a person lands it, the ledger
    keeps saying closed. The author left this for a follow-up.
  - Making `withLock` create its lock's parent folder for every caller. Its
    other callers already create it.

## D-064 The Command Center runs autopilot and shows what it did (2026-10-05)

`acc autopilot --every` (D-055) ran only in a terminal someone kept open. Now
the extension runs it, and shows what it did, wherever it ran.

- **A switch in the status bar.** Each repo whose autonomy isn't manual has an
  item (projects that share a ledger are one repo). It says "Autopilot: on"
  with a rocket, or "Autopilot: off" with a pause icon, and names its project
  when there's more than one. A click turns it on or off for this window until
  VSCode closes.
  - As the author chose, it's off when VSCode opens. The autonomy setting is
    the project's consent; the click is this person's, on this machine, today
    (D-014). Nothing about the switch is saved.
  - With autonomy dispatch or full, or no `github` section, it says off with a
    no-entry icon, and its tooltip and a click give acc's own words for why.
- **On, it's one of the window's runs** (D-030): `acc autopilot --every 60`,
  run from the main checkout and labelled "Autopilot · <project>". It's a
  background run. It stays out of the status bar's running item, and the output
  panel shows another command first, with autopilot in its picker. Turning it
  off, or closing the window, ends its process group, as Stop does.
- **It stops when its window goes.** The extension passes its own pid as
  `ACC_AUTOPILOT_PARENT`. Once that process is gone, autopilot stops before its
  next step, or within a second while it waits between passes. A step under way
  finishes first. So an extension host that crashes leaves no autopilot landing
  work with no window open.
- **Still one autopilot a repo.** When another window or a terminal holds
  `autopilot.lock`, the switch says "Autopilot: on elsewhere" with that pid in
  its tooltip, and a click says where it runs. A run that loses the race for the
  lock is dismissed, not shown as failed.
- **What it did comes from the ledger's events,** not from its output, so every
  window shows it, whichever window or terminal ran it. The hub reads the last
  256 KB of `events.jsonl` once, then only what was added since. It keeps
  autopilot's newest 300 steps: reviews, lands, re-dispatches, refreshes
  (D-058) and failures.
  - **History** lists each step once, with its icon and words, such as
    "Autopilot landed it: pull request #40", under the Tasks filter. Autopilot's
    own moves (review → rework, rework → running) are told by their step and
    aren't listed twice.
  - **A notice** (D-044) for each step after the first full load, such as
    "Autopilot landed GH-31: pull request #40" with Open pull request. What it
    couldn't do is a warning, "Autopilot couldn't land GH-31: <reason>", with
    the step to take by hand. They follow `agentCommandCenter.notifications`
    and stay quiet while the Overview or Tasks is on screen.
  - D-044's "The review passed X" and "The review asked for changes on X" stay
    quiet for a task whose latest autopilot step is that review. Autopilot
    lands or re-dispatches it next, and their Land or Re-dispatch button would
    race it.
- **Jira and Azure DevOps comments** still wait for a person, as the author
  chose. A land's notice for such a task says "Its comment on <KEY> waits for
  you in Autopilot's output", with Show output. Posting it from the extension
  is a follow-up.
- **Autonomy is set from the Agents section.** "How agents run" has an Autonomy
  row with its value and where it's set (the project). Change… offers manual
  and review, and runs `acc agents autonomy <value>`. That new command changes
  only that value in `.acc/config.json`, for the person to commit. It refuses
  dispatch and full, which aren't built, and refuses builders, reviewers and
  analysts. `guardBash` and the builder's settings deny it too.
- **Accepted:** turning autopilot off, or closing VSCode, during a step ends
  that step. A review's work is lost, and the next pass reviews again. A land
  stopped between its push and its ledger write is redone by the next land,
  which finds the pull request, though the issue's comment may be posted twice,
  as D-053 accepted.
- Not chosen:
  - Reading autopilot's `--json` output for History and notices. It's there
    only when this window runs autopilot, and it's gone after a reload.
  - Saving the switch in settings or workspace state. Every window would then
    start autopilot on its own when it opens, which the author ruled out.
  - Letting the step under way finish before Off takes effect. Off ends the
    process, as Stop ends any run.

## D-065 All of acc is one status bar item (2026-10-05)

The author found VSCode's status bar "so cluttered". Four of its items were
acc's: the repo's GitHub account, the task summary (D-044), setup's progress,
and "Checking setup" while it re-checked. Autopilot's switch (D-064) would
have made five.

- **One item.** It says what needs you first ("3 need you", in the warning
  colour). If nothing does, what's running and in review. If none of that,
  setup left to do. A command acc runs for you that waits on an answer
  takes its place. A spinner shows while acc is busy: a command running for
  you, or setup being checked. A robot shows while autopilot is on in this
  window. It hides when there's nothing to say.
- **Its tooltip** has the rest: what needs you, what's running, what's in
  review, each repo's autopilot, setup's done of total, and the GitHub
  account.
- **A click** opens a short menu: the Command Center, autopilot on or off for
  each repo that can run it, what's running, Setup, and the GitHub account.
- **The GitHub account** keeps an item of its own only when it's the wrong
  one: a warning worth its own place. Setup, runs and autopilot make no
  items, and setup's re-check no longer shows VSCode's window progress.

## D-066 Ticket updates are drafts a person posts; ticket fields are read-only unless a tracker opts in (2026-10-05)

The author: "we should not be using this tool to change info on tickets, but
typically we can post updates … We should review status updates manually
before posting them." Until now `acc land` commented on a GitHub issue at
once, and the Command Center posted Jira and Azure DevOps comments as you
straight after a land (D-033). Its comment said "An agent built it and another
reviewed it", which is no way to talk to a client. The task page could also
change a ticket's status, assignee and labels (D-026).

- **acc posts nothing on a ticket.** It writes a draft update instead, one file
  per event in `updates/` in the state folder (`<task>.<n>.json`): the task,
  the tracker and key, the event, the text, and whether it was posted (with
  the text that went, who and when), discarded, or is still a draft. `acc
  land`, autopilot, `acc sync` and `acc deploy` only write files, so an
  unattended sync every two minutes posts nothing.
- **Drafts for these moments,** short and plain for the client, with no word of
  agents, worktrees, acc, builders, reviewers or rework (a test checks every
  template):
  - a pull request opened, or updated, for review: the link, and one sentence
    the review now writes for the client (`client` in the verdict), or the
    task's title when an older verdict has none
  - merged into an environment (`acc sync`, naming it), and deployed to its
    org (`acc deploy`). acc sync now keeps each pull request's merge commit
    (`pr.mergeSha`); a deploy drafts for each task whose merge commit is in
    what it deployed, and nothing when it fails or deploys nothing. A task
    squash-merged before acc kept merge commits is missed. Promotions draft
    nothing yet: that's a later ticket.
  - a builder stuck on something only the client can answer: `acc block
    --client "<question>"`, as the author chose. Its instructions say when: a
    business rule, missing access, or a choice that's the client's. A plain
    block stays internal.
  - one of the analysis's questions a person chooses to send: Send to the
    client on the question, which runs `acc update ask`. The question then says
    "Drafted for the client" or "Sent to the client", and keeps its answer box.
- **The same news again replaces an unposted draft,** as the author chose: a
  pull request updated three times is one draft, with the latest link. One
  that still says "ready for review" keeps saying so. Merged and deployed are
  told apart by environment, and questions by question. A task with no tracker
  key gets no drafts.
- **Review, then post.** Needs you lists each draft as "Update ready for
  <KEY>", in orange with its icon, counted in the rail and the badge. It shows
  the text (two lines, then Show all), with Post, Edit and Discard; editing
  happens only on the task's page, as the author chose. There, each draft sits
  at the top of the Activity feed (D-057), in a box to edit, saying who it
  posts as, with Post and Discard. The edit stays in the tab's memory until
  it's posted; acc keeps only the text that went.
  - A GitHub issue posts through `acc update post`, with gh as the repo's
    account (D-007, D-028). Jira and Azure DevOps post through the repo's own
    sign-in (D-027): the extension has acc claim the draft (`acc update
    posting`), posts, then records it (`acc update posted`), or puts it back
    with why (`acc update release`). The claim, under the drafts' lock, stops a
    second window's Post. A claim unconfirmed for five minutes may have posted
    (D-051's lesson): it says so, and offers Post again and Discard.
  - With no sign-in for its tracker, Post waits and the row offers the
    sign-in, rather than failing after the claim.
  - A posted update shows in the feed as the tracker's own comment, once the
    page reloads the ticket.
  - On the command line: `acc updates [--all] [--task <id>]` lists them, and
    `acc update discard <id>` sets one aside. `acc update post <id>
    [--text-file <f>]` posts only on GitHub, and refuses a Jira or Azure DevOps
    draft, saying to post it from the Command Center. Builders, reviewers,
    analysts and autopilot can't run any of them: the CLI refuses, `guardBash`
    refuses, and the builder's settings deny `acc update*`.
- **Ticket fields are read-only** on the task page unless the tracker says
  `"edits": true` in `.acc/config.json`, which must be true or false. This
  repo's own GitHub tracker does. The extension refuses those actions when a
  page sends them anyway. Comments stay. Dragging a card between a tracker
  board's columns still moves the ticket, with or without `"edits"`, as the
  author chose: it's a person's deliberate move on the board.
- This replaces D-033's posting as you after a land, and D-006's link comment.
  It amends D-026 (the page's field edits), D-051 and D-053 (no issue comment
  to confirm, so `LAND_TIMEOUT_MS` counts three gh calls), D-055 (autopilot's
  `pendingComments` are `updates`), and D-064 (a land's notice offers Review
  the update, not autopilot's output).
- Not chosen:
  - Every block drafting an update. Both real builder blocks in this repo were
    technical, and a client shouldn't see those.
  - Making board drags read-only too. A drag is already a person's own click.
  - Editing a draft in Needs you. The task page has the room, and the ticket.
  - Posting Jira and Azure DevOps drafts from the CLI. acc has no sign-in for
    them; the extension does.

## D-067 Builders keep the Mac awake; a stopped builder needs you and can be resumed (2026-10-06)

On 2026-10-05 GH-41's builder stopped mid-task when the Mac went to sleep. Its
turn ended with "API Error: Your computer went to sleep mid-response", the
ledger said Running for 90 minutes, and nothing told anyone. It was resumed by
hand, in its worktree, under `caffeinate -i`.

- **What Claude Code shows** (2.1.291, checked with a throwaway session):
  - A `--bg` session is listed with its `pid` as soon as it's found.
  - A turn that finished keeps its process: `pid`, `status: idle`,
    `state: done`. `claude stop` takes it off the list, and so does Claude Code
    once the job is done.
  - A session waiting on a person is `blocked`. Once its process has gone it
    stays listed as `blocked`, with no `pid`. GH-41 after the sleep was exactly
    that (its job said "API unavailable — retry").
  - `claude -p --resume <session>` keeps the session id, and while it runs it's
    listed as an `interactive` session with its own `pid` and that session id.
    It's gone when it exits.
- **So a builder counts as stopped** (`builderStopped`, shared by the Command
  Center, autopilot and `acc show`) when its task is running, `claude agents`
  answered, no resume of it runs, its run started or was resumed two minutes
  ago or more, and no session of it is at work: none has a process that isn't
  idle at the end of its turn (done, failed or stopped). A `blocked` session
  with a process is waiting in its own prompt, as before. A `blocked` one
  without a process is stopped: the analysis had counted every `blocked` as
  waiting, which would have missed GH-41. A conversation open in a terminal or
  a Claude Code tab, or a message to it running, is someone carrying it on.
- **It needs you,** with the last thing the agent said: the newest text in its
  transcript, Claude Code's own API errors included, read from the file's last
  256 KB. The card, the tracker's card and the task page say "Needs you: its
  agent stopped: <what it said>" with `debug-disconnect`, in orange: clipped on
  a card, in full on the page. The Overview lists "Its agent stopped", a notice
  says so once, and the status bar and badge count it. Its card's one next step
  is **Resume**, as the author chose (D-062); Watch and Open in Claude Code wait
  behind ⋯. The old background session's own state ("Needs you") is no longer
  shown beside it.
- **Resume** (`acc resume <id> [--message <text>]`) carries the session on in
  the folder its conversation is saved under (D-046), with the builder's
  settings, role and task, permission mode, and this clone's model and effort
  (D-036). It refuses unless the task is running with a session and its
  worktree, and nothing is carrying it on; an idle background session is
  stopped first (D-060). The claude runs detached, logged to
  `logs/<id>.resume.log`, with a marker in `resumes/<id>.json`. The marker is
  claimed before anything is looked at, holding acc's own process until the
  resumed claude's replaces it, so a person's Resume and autopilot's can't both
  start the conversation; a claim whose process has gone is taken over. The run records
  each resume (`run.resumes`), the Stop hook's reminder is cleared so the
  resumed turn is reminded too, and the event carries what it last said. The
  ready message names the task, quotes what it said, and asks it to check
  `git status` and `git log --oneline -3` (naming its latest commit), then
  finish or block. It covers a builder that simply ended its turn asking
  something too. Builders, reviewers and analysts can't run it: the CLI,
  `guardBash` and the builder's settings refuse it.
- **Autopilot resumes a stopped builder once a run,** as the author chose: a
  person's resume in between doesn't give it another go, and a new dispatch
  (such as its rework) does. A second stop waits for a person. A resume that
  fails is kept on the task, which needs you, until a resume works, by hand or
  by autopilot (D-055); one whose agent came back
  meanwhile waits for the next pass. A pass asks `claude agents` once, only when
  a task is running.
- **Keeping awake:** on macOS acc holds `caffeinate -i -w <pid>`: the
  background session's process after a dispatch, acc's own around a
  `--foreground` dispatch, a review and an analysis, and the resumed claude.
  Only `-i`: the display still sleeps, and closing the lid still sleeps the
  Mac; detection and Resume cover that. A task's caffeinate is written down in
  `awake/<id>.pid` and ended when the task leaves running (done, block, set,
  Abandon, or acc sync blocking it for a closed pull request) or autopilot finds its builder stopped, since a finished turn's
  process lingers. A pid that isn't a caffeinate any more is never killed.
  Other platforms start nothing.
- **D-060's reply** runs Resume's own command, so a clone's builder model and
  effort are no longer dropped, under `caffeinate -i`. It writes no marker:
  while it runs, Claude Code lists it with the conversation's id.
- Not chosen:
  - `caffeinate -i claude …`: a timeout would kill caffeinate and leave claude
    running. `-w` watches the process instead.
  - Reading Claude Code's own job files for why a session stopped
    (`~/.claude/jobs/<id>/state.json`). They aren't a documented format.
  - Keeping Linux or Windows awake, stopping the display or the lid sleeping,
    resuming reviewers or analysts, and asking `claude agents` in `acc list`
    and `acc status`, which stay fast and ledger-only.
- Accepted: `acc show` on a running task asks `claude agents` (up to 20
  seconds). A stopped builder's idle process keeps the Mac awake until the task
  leaves running or autopilot sees it, since the Command Center only reads.

## D-068 The agent board starts at To do; a tracker's board keeps its own columns, in its order (2026-10-06)

The author: "by default, the To Do column should be furthest left, but if we're
importing from a ticketing system, we should use their swim lanes in the order
they are listed."

- **The agent board's lanes run left to right as a task goes:** To do, Ready,
  Running, Needs you, In review, Rework, Blocked, Done (`BOARD_LANES`). Needs you
  sits after Running, where most tasks come to it from. Until now the board used
  the lists' attention order, with Needs you first and To do second to last.
- **A tracker's board is as the tracker has it:** a Jira board's columns from
  its configuration, a GitHub Project's Status options, an Azure board's
  columns, each in the order the tracker lists them. That was already so, and
  stays so: the Command Center never sorts them. A GitHub Project's "No status"
  column comes first when a card has none, as GitHub shows it.
- **Lists keep the attention order** (`TASK_GROUPS`: Needs you first), since a
  list is read top to bottom for what to look at next. A card's Move menu lists
  lanes in board order.
- Not chosen: the agent board taking a tracker's columns. Its lanes are acc's
  own states, and the tracker's board is one click away, in its own order.

## D-069 A heavy-check slot that times out during a refresh needs you (2026-10-06)

GH-34's review (GH-40) found that a refresh whose checks couldn't get the
heavy-check slot in 3 hours waited for the next pass, as D-058 chose, under a
fixed "so the merge was undone". That hid refresh's own message, which says
whether putting the branch back worked and, when it didn't, where to look.

- **It's recorded like any failed step,** as the author chose. This amends
  D-058's "isn't recorded as a failure". The failure is `refresh` on the commit
  before the merge, with refresh's own reason: "Merged main in, but its checks
  couldn't run: Every heavy-check slot in `<dir>` stayed taken for N minutes. If
  no check is running, delete that folder.", then whether the branch is as it
  was. The task needs you. A check that holds a slot for 3 hours is stuck, and a
  person clears it.
- **It isn't tried again on that commit** (D-055), and there's no
  `acc refresh`. Once the slot is clear, a person merges the base by hand or
  lands, or a new commit on the branch lets autopilot try again.
- Autopilot now waits for the next pass only when the ledger is busy, the agent
  cap filled meanwhile, or a stopped builder's agent came back (D-067).
- **One description of `autonomy: review`.** Core keeps the phrase for what it
  does (`AUTOPILOT_REVIEW_DOES`), and acc's refusal, `acc agents autonomy`,
  `acc autopilot` under manual, the status bar's tooltip and the Agents tab use
  it, so it names the refresh everywhere. Each copy had gone stale. Where one
  says it never merges, it says "never merges a pull request", since it merges
  the base into a branch.
- **Prior tests are the profile's** (D-003). A refresh asks gates.ts for the
  tests its commit's checks named (`priorTests`), next to the validate gate
  whose receipt it reads. On Salesforce that's the Apex tests the last
  `validate` named; other profiles name none. refresh.ts names no Salesforce
  gate.
- Not chosen: recording it only when putting the branch back failed, and
  otherwise waiting, with the real reason. A slot that's still taken after 3
  hours is taken next pass too.

## D-070 An edit on the task page is what the Overview shows, and a replaced draft keeps its edit (2026-10-06)

GH-41's review (D-066) left three points open. The first could post text the
person didn't mean to send. An edit typed on a task's page lived only in that
tab's memory, so Post in Needs you sent the draft as acc wrote it. A newer
draft of the same news got a new id, and the page dropped the edit typed for
the old one without a word.

- **The task page tells the extension about its unsent edit** (`update-edit`):
  the first keystroke that makes the box differ from acc's text (after trim)
  goes at once, then the typing after a 400 ms pause. Typing back to acc's
  text, Use the newer draft, a post or a discard sends null. After every
  redraw the page sends what it holds, so a tab brought back from hidden
  says it again. The extension keeps it in memory for that page only, and
  only for that page's own task.
- **Needs you shows the edit.** Its row says "Edited on the task page" with
  the edit icon, in orange, and shows the edited text: the text the task
  page's Post would send. Edit (open the task page) leads, Discard stays, and
  there's no Post. It still counts as needing you. A row drawn before the edit
  arrived still has Post, so the extension refuses an Overview Post whose text
  isn't the edit: "it was edited on the task page, so post it from there."
  The guard is in the Overview's handler only. Putting it in the shared post
  would refuse the task page's own Post while its last keystrokes are still
  on their way.
- **A draft names the drafts it replaced:** `replaces`, newest first, up to
  20 ids, written by `draftUpdate`. Older drafts without it carry nothing
  over, and there's no migration.
- **A replaced draft's edit moves to the newer draft.** It's moved before
  the page drops edits for drafts that have gone, and it's read through
  `replaces` even when it hasn't been moved yet, so a page hidden through
  .1 → .2 → .3 still finds it. The page says "A newer draft replaced this one;
  your edit is kept". The page records the text each edit was typed against.
  If the newer draft's wording differs from that text, the page shows both:
  the edit in the box, and the newer wording read-only beneath it, with Use
  the newer draft. While the page is hidden, the extension follows `replaces`
  too, so Needs you still says the newer draft was edited.
- **One keyed helper** (`extension/webview/pending.ts`) now keeps what the
  page waits on acc for: an answer, a post, a discard, a question sent to
  the client. It replaces two parallel pairs of maps. Messages and behaviour
  are unchanged: an answer stays "Sending…" until its question goes, and a
  refused answer shows its error only if it was still sending. The carry-over
  logic lives beside it, where node's tests can import it.
- This amends D-066: an edit still stays in the tab's memory, but the
  extension now knows of it, and a replaced draft no longer loses it.
- Limits, as the author chose: **this window only.** The edit lives in this
  window's extension. A second VS Code window's Needs you can still post
  acc's text. Closing the task page, or reloading VS Code, still drops the
  edit, and Needs you goes back to acc's text with Post.
- Not chosen:
  - Saving the edit into acc's update file (an `acc update edit`). That would
    stop Post in every window, but it would also write a person's half-typed
    text to disk.
  - Editing in Needs you. D-066 rejected that, and this doesn't change it.

## D-071 Later news replaces an unposted draft it overtakes (2026-10-06)

Once a pull request merged, its task had two drafts waiting: "ready for review",
which was no longer true, and "merged". A client shouldn't be told both.

- **Later news replaces an earlier draft of the same task that nobody posted:**
  merged stands in for the pull request's draft, and deployed for the pull
  request's and for the merge into the same environment. A deploy to QA leaves a
  merge into Dev, which is other news. Questions and client blocks are never
  overtaken.
- The new draft names the drafts it stands in for (`replaces`, D-070), so an
  edit typed for one of them is kept, and the task page offers the newer text
  beside it.
- Posted news is never taken back, and a draft being posted isn't replaced.
- This amends D-066's "the same news again replaces an unposted draft".

## D-072 Each repo's tickets come only from its own place in its tracker (2026-10-06)

A Jira board's cards came from the board's own filter, which can span several
projects, and a ticket page opened any key. So a repo could show, and track,
another project's or another client's tickets (GH-50). This is the first of
three tasks: the Connect page (GH-51) and Track on each card (GH-52) come next.

- **Each tracker names its place in `.acc/config.json`.** Always its project or
  repo, and, when set, something narrower: a Jira `epic` (one, by key), GitHub
  `labels` (an issue with any one of them counts, whatever its case) or an
  Azure DevOps `areaPath` (that area and everything under it). Not chosen: Jira
  components, labels, raw JQL or several epics. A key on the wrong kind of
  tracker is a warning and ignored, as `skipLabels` is.
- **An epic's place is its child tickets and their sub-tasks**, not the epic
  itself (a person decided). The board asks for `project = "P" AND parent = E`,
  then for the sub-tasks with `parent in (<those keys>)`, rather than JQL's
  `parentEpic`, which would also bring the epic and is harder to check on every
  site.
- **Every read is held to the place.** The board's cards: a Jira board's JQL,
  and any card from another project the board still returns is dropped; one
  `gh issue list --label` per label, since gh wants all the labels it's given;
  the Azure WIQL adds `[System.AreaPath] UNDER`. A single ticket: one outside the
  place throws `TrackerError` of kind `outside`, which names the place, so its
  page says so instead of failing, and it can't be tracked. A moved Jira issue
  comes back under its new key, so the key and project that come back are
  compared, not the key asked for. Azure work item ids are the organization's,
  so the project is checked even with no area path. `acc intake github` reads
  the GitHub tracker's `repo` (the project's own by default), not always the
  project's.
- **The board says where its tickets come from**, on a line under its name:
  "Tickets from Jira · ACME · epic ACME-3 Premium Support". The epic's name is
  read from Jira as the board loads, not stored.
- **A ticket that leaves the place** (it moved, or the place was narrowed)
  follows D-048: its task leaves the ledger if work never started, with a
  `task.removed` event that keeps the reason; one that started stays on the
  agent board and is named. One helper does this for skipped labels and for
  the place. GitHub's is found by `acc intake github`. Only the Command Center
  signs in to Jira and Azure DevOps (D-066), so after a board loads it asks
  about the repo's unfinished tasks it doesn't show (`outside()`), and hands
  the ones outside to the new `acc intake jira|azure --file`. The started ones
  get an orange notice on the tracker's board, with an icon and words. A failed
  read never counts as outside, and a removed task comes back only when someone
  tracks it again.
- **`acc import` refuses a Jira or Azure key no tracker owns.** It can't check an
  epic or area path without a sign-in, so the intake skill queries only the
  place, and the board's check removes strays. A repo that names no trackers
  takes any key, as before.
- **Posting a draft is held to the project or repo only**, not the narrower
  place (a person decided): a started task's ticket may leave its epic and
  still hear how it went. A draft for a ticket now in another project or repo
  is refused with the reason, and can be discarded.
- **Add a tracker ends with the place**, each picked from a list with the whole
  project, repo or team first: the project's open epics, a tick list of the
  repo's labels (none ticked is the whole repo), or the team's area paths and
  the ones under them. Re-adding one as the whole project clears its place.

## D-073 A tracker is connected on one page in the Command Center, drawn from its description (2026-10-06)

Connecting a tracker went through prompts at the top of VSCode: an input box
for the site, another for the email and token, then a quick pick for each of
the project, board and place (D-027, D-072). The author wanted it GUI driven
and easier, and chose one page in the Command Center (GH-51).

- **The Connect page is a view inside the Command Center tab**, not a rail
  item and not a tab of its own (a person decided). It opens over the section
  it came from, with Back to it: from Connect Jira on the Tasks tab, Add a
  tracker on the Overview, Setup's B14 Do it, New work, and the Add a tracker
  command. With no project named and several open, it starts with a project to
  choose. Leaving it, or closing the tab, drops what was on it.
- **Every Sign in to Jira or Azure DevOps opens it at that tracker's sign-in**
  (a person decided): the board's error, the ticket page, Needs you, B14 and
  the Sign in to a tracker command. The input-box sign-ins are gone. Sign out
  stays a command.
- **An existing tracker can change only its place, board, team and sign-in**
  (a person decided). Its site, organization or repo, and its project, show as
  fixed text: another project is another tracker. Each board's Change opens it.
  Save replaces it where it is in the list, keeping keys the page doesn't
  manage (skipLabels, edits, prefix), and an epic that's done since stays
  chosen though Jira no longer lists it.
- **Each tracker's part of the page comes from a description** beside its
  client in core (`trackers/connect.ts`): its host field and how to read a
  pasted link, its ways to sign in, how to check a sign-in, its lists in order
  with what each depends on and its "whole project" choice, and how it's
  written to and read from `.acc/config.json`. The page has no tracker of its
  own, so monday.com later is a client and a description, not another page.
  Signing in is one of three kinds a description names: fields typed on the
  page (Jira's email and API token, an Azure DevOps personal access token),
  VSCode's Microsoft sign-in, or gh as the project's account (D-007). The
  extension carries out the last two.
- **The page reaches no tracker itself**: its CSP stays `default-src 'none'`,
  and every check and list runs in the extension, which sends back only words.
  A token travels from the page once, with Test connection, and goes to
  VSCode's secret storage under the repo's own key (D-027). It's never in the
  page's model, the tab's saved state, the log or `.acc/config.json`. It's kept
  once the test succeeds, because the lists need it, as before.
- **Errors sit beside what they're about**: a site or organization that can't
  be reached beside it, a refused token beside the token, a list that can't be
  read beside that list, which still offers the whole project. Every state has
  an icon and words: blue for signed in, loading and saving, orange for what's
  wrong.
- **Jira's email comes from the repo's `git config user.email`**, and the board
  id is written whenever a board is picked, not only when there are several.
  A late answer for a choice since changed is dropped.
- **A board list that can't be read doesn't hold Save** for Jira, which shows
  the project's first board without one. Once signed in, the token typed is
  forgotten by the page.
- **Setup's Sign in, with several Jira or Azure DevOps trackers,** still asks
  which one with a quick pick, then opens the page at it.
- Not chosen: a page per tracker; a separate editor tab, like a ticket's;
  changing an existing tracker's project on the page; a GitHub Project picker
  (an existing `board` is kept as it is).
- This replaces D-027's "Add a tracker… sets a repo up from VSCode" prompts
  and D-072's "Add a tracker ends with the place" quick picks. What they write
  is unchanged.

## D-074 Track a ticket from its card on the tracker's board (2026-10-06)

A ticket on a tracker's board became an acc task only from its own page, one
at a time, and that page's Track in acc gave no sign it was working: a double
click imported it twice (GH-52). This is the third of D-072's tasks, after
GH-50 held the board to the repo's place.

- **Every card acc doesn't keep has Track**, with the `add` icon and the short
  label "Track", so it fits a 500 px column. It's the secondary style, not the
  primary one, so a column of new tickets doesn't read as a wall of next steps.
  **A done column's cards have none** (a person decided): there's nothing left
  to build. A ticket's page still offers Track in acc for any ticket.
- **One way for both buttons.** The card and the page both call
  `Trackers.track`. It reads the ticket again, because a card carries no
  description, and that read checks the place at the moment of the click: a
  ticket that has left it is refused with the place named, and `acc import`
  never runs (D-072). Otherwise `acc import --json` gets its title, description
  and label names. Nothing changes the ticket (D-066). A refusal is acc's own
  words, read from its `--json` output, not the first line of its plain text.
- **The card is the reply.** A click says Tracking… at once, with a spinning
  icon, and the button stops taking clicks. On success acc's tasks reload
  before that clears, so the card goes straight to acc's state and its one next
  step: Dispatch, or Analyze where the project wants an analysis (D-062). On a
  refusal the card shows an orange warning icon and "Couldn't track it:" with
  the reason, and offers Track again. The board shows no notification; the
  page keeps its own messages.
- **The extension holds it, not the page.** One `Pending` per window (D-059),
  keyed by repo and ticket, so "Tracking…" and the reason outlast a tab rebuild
  (D-061), and a second click, or the page's button, starts nothing. The page's
  button says Tracking… whichever button started it. A second VSCode window
  could still import the same key; `acc import` then only refreshes the task's
  text, never its state.
- **A reason stays until the next try, or until the card leaves every board.**
  A refusal doesn't reload the board, or the reason would go with the card; the
  next scheduled load takes both away. A track still on its way is never
  forgotten.

## D-075 A promotion drafts ticket updates, as a merge and a deploy do (2026-10-06)

D-066 left promotions out: "Promotions draft nothing yet". A promotion left one
line in `promotions.jsonl` that nothing read, and a deploy to UAT drafted
nothing for work promoted there, because it found only tasks merged straight
into the deployed branch (GH-56).

- **A promoted change gets three drafts,** each for a person to post (D-066):
  - `acc promote` opens the pull request: "The change is ready to go to UAT:
    <link>", by the person who ran it.
  - `acc sync` sees it merge: "The change is now in UAT."
  - `acc deploy uat` then says "The change is now deployed to UAT.", as it
    does after a merge.

  The client hears the environment's name, as for a merge. A test checks the
  wording, and that promote, sync and deploy post nothing. A task with no
  tracker key is recorded but gets no draft.
- **Where a change arrived is one rule** (`arrivedAt`), which promote and
  deploy both use. A promotion copies files rather than merging, so a task's
  merge commit on Dev is never in UAT's history: each branch has its own
  arrival commit. On the task's own branch it's its pull request's merge
  commit (`pr.mergeSha`, D-066). On another branch it's the merge commit of the
  first promotion that took the change there. Each task keeps its promotions in
  the ledger (`Task.promotions`: from, to, the pull request, open, merged or
  closed, and the merge commit). `promotions.jsonl` stays a log, and now lists
  the tasks too.
- **What a promotion carries:** a task whose change had reached the source
  branch by the commit promoted, hasn't reached the destination, and whose own
  merge touched a file the promotion brings or deletes. A task merged into
  another environment, merged after that commit, already promoted, or that
  changed only environment-specific files gets nothing. When a task's merge
  commit can't be read, only the file test is skipped.
  - Accepted: a task promoted by hand, or by acc before this, is carried again
    when a later change touches the same file.
  - Promotions opened before this recorded no tasks, so they draft nothing when
    they merge. Their tasks aren't back-filled.
- **A promotion that stops** (nothing to promote, a failed check, or gh failing
  before the pull request exists) records and drafts nothing. Once the pull
  request is open, a failure to record its tasks or draft their updates is
  said, and the pull request stands.
- **acc sync follows open promotion pull requests,** even when no task's own
  pull request is open, and reads each once however many tasks it carries.
  Merged, it records the merge commit on each carried task and drafts "now in".
  A task that had already reached that environment by an earlier promotion gets
  no second one. The Command Center's poll runs while any promotion is open
  (`followsPullRequests`).
- **Closed without merging,** as a person decided: acc sync records it closed
  on each task, so the next promotion carries them again. It discards that
  promotion's unposted drafts (kept and marked, by acc sync) and says so. A
  draft that's posted or being posted is left alone.
- **Overtaking (D-071) has two more stages:** a pull request; then its merge
  into its environment, or a promotion opened; then the promotion's merge; then
  a deploy. So "ready to go to UAT" stands in for an unposted pull request
  draft, "now in UAT" for "ready to go to UAT", and "deployed to UAT" for both.
  A merge into Dev is other news and waits beside them. Two promotions into UAT
  before anyone posts are one draft, with the latest link.
- Needs you and the task page call them "Promotion #9 to UAT is ready" and
  "Promoted to UAT", in the same orange row with its icon.
- This amends D-066's "Promotions draft nothing yet" and D-071's stages.
- Not chosen:
  - Rewriting the "ready to go" draft in place when the promotion merges. A
    new draft that overtakes it keeps an edit through `replaces` (D-070).
  - Following a promotion pull request's checks and conflicts in acc sync.

## D-076 Autopilot sends a pull request whose GitHub checks fail back to its builder, once a commit (2026-10-06)

A pull request whose checks failed on GitHub showed its task as needs you
(D-033), and a person read the failure and sent it back. Autopilot already
sends a review's changes back once (D-055). Failing checks now go the same way
(GH-57). DESIGN.md §19 had left "automatic rework when CI fails" out of v1.

- **When.** Under autonomy review, a task in review whose review passed on its
  latest commit, whose open pull request autopilot landed at that commit
  (`pr.sha`), with no conflict with its base (a refresh comes first, D-058).
  GitHub's head of the pull request must be that commit too. If it isn't, a
  land or a person comes first, and autopilot waits.
- **What counts** (a person decided). The base branch's required checks when it
  has any; otherwise every check on the commit, as acc sync's `ci` counts them.
  A failure is gh's `fail` bucket. A check still queued or running isn't one
  yet: autopilot waits ("Checks are still running on GitHub") and records
  nothing, then sends back every failure together once all have finished. A
  cancelled or skipped check isn't a failure.
- **What has no log** (a person decided). A failed check that isn't a GitHub
  Actions job, such as a commit status or another app's check, has no log on
  GitHub, so it doesn't send the task back. If it's the only failure, the task
  needs you as today, naming it. An Actions job whose log autopilot can't fetch
  (a gh error, an expired log) is still sent back, and the builder reads
  "Couldn't fetch its log: <gh's first line>" beside its link. No log text is
  made up.
- **What it reads.** gh as the repo's account (D-007, D-028), each call with a
  timeout (D-051): `gh pr view --json headRefOid`, `gh pr checks --json`, and
  `gh run view --job <id> --log-failed` (then `--log`) for each failed job, at
  most 5. It changes nothing on GitHub: no re-run, comment or edit. It asks
  only for a task that could be sent back, and not when acc sync last saw its
  checks passing, so a quiet board makes no calls. Just before the move it
  asks GitHub for the head again, so a push in between stops it.
- **The send-back.** Autopilot writes what it read to
  `<state>/checks/<task>-<sha>.json`: each failed check's name, workflow, link
  and the last 100 lines (10 KB at most) of its log, with colour codes and
  timestamps stripped. It moves the task review → rework as the orchestrator,
  by `orchestrator:autopilot`, with "Checks failed on GitHub on <sha>:
  <names>", and keeps `autopilot.sentBack` (the commit, the names, when). The
  next pass re-dispatches it. The builder's packet has "What GitHub's checks
  said": each check with its link and the end of its log, and says to reproduce
  and fix it, run acc gate run, then acc done, or acc block when the failure
  isn't caused by this change. Builders still get no gh: the logs travel in the
  packet.
- **This amends D-055: the orchestrator may move review → rework**, with a
  reason (a person decided). D-055 and DESIGN.md §5 had only a reviewer or a
  person send work back. A move to rework by exactly `orchestrator:autopilot`
  is a checks send-back; a reviewer's move made for autopilot is still the
  review's.
- **Once a commit, at most 3 a task, apart from D-055's one** (a person
  decided). A send-back is re-dispatched whatever else happened. D-055's one
  re-dispatch of a review's rework now counts only re-dispatches that followed
  a review or a person, so a checks send-back doesn't use it up, nor the other
  way round. Checks failing again on a commit autopilot already sent back are
  recorded as a failed `checks` step ("Checks failed on GitHub again: <names>.
  Autopilot already sent <sha> back once: a person decides."), and the task
  needs you. So does a fourth send-back. A new commit, a person's or a
  builder's, gives it another go.
- **Needs you, read again.** While a fix is reviewed, the pull request is still
  at the commit autopilot sent back, and acc sync still says its checks fail.
  That no longer shows the task as needs you; the second failure does, through
  the recorded failure. At autonomy manual nothing is ever sent back, so a
  failing pull request needs you exactly as before.
- **This amends D-033: acc sync keeps the failing checks' names** (`pr.failing`)
  beside `ci`, so every autonomy level can name them. The task's card, its
  tracker card and its page say "Checks failed on GitHub: <names>" in orange
  with an icon, in review while they fail, and in rework after autopilot's
  send-back, where the names are the ones it sent back for. `acc show` prints
  the same line. Autopilot's notice says "Autopilot sent <ID> back to its
  builder: checks failed on GitHub: <names>.", History says the same, and the
  re-dispatch after it says it was for the failing checks. The move's event
  carries the names, and the re-dispatch's carries its cause, so neither is
  read back from words.
- Not chosen:
  - Running acc sync inside autopilot (D-055's Not chosen holds). Autopilot
    reads only what it needs, for the tasks it could act on.
  - Giving builders gh or a way to read GitHub.
  - Re-running checks, or anything else that writes to GitHub. A flaky check
    costs a builder run and a review per round; the cap of 3 bounds it.
  - Sharing D-055's one re-dispatch. A checks failure after a review's rework
    would then always need a person.

## D-077 acc runs without a Node install, behind a small launcher (2026-10-06)

`acc` started through `#!/usr/bin/env node`, so with no node on PATH it failed
everywhere but the extension's own calls: terminals, Setup's **Do it**,
builders' `acc done` and the plugin's hooks (GH-59). The author chose to fix it
everywhere. This is the first of four packaging tasks, before GH-60, GH-61 and
GH-62.

- **Two files, side by side, wherever acc ships:** `acc`, a POSIX sh launcher
  (`packages/cli/bin/acc`, 0755), and `acc.mjs`, the bundle (0644, no
  shebang). The build puts both in `dist/` and `extension/dist/bin/`, and a
  release in `plugin/bin/`. `acc.mjs` sits beside the launcher, so acc's own
  folder (`accBinDir`) still holds `acc` for builders' PATH and the packet.
- **The launcher's order:** `$ACC_NODE` when set; else node on PATH when
  `node --version` is 20 or later; else the program named in `~/.acc/runtime`
  (`$ACC_RUNTIME_FILE` overrides it, for tests). `ELECTRON_RUN_AS_NODE=1` is set
  for the first and last, never for node. An `ACC_NODE` acc can't run is an
  error that names it, not a quiet fall back: it's an explicit choice.
- **Hooks never break a session.** With no runtime, `acc hook …` reads its
  input and exits 0 without a word, as acc's own hooks do on anything
  unexpected (D-042). Anything else prints one line naming the fix: open
  VSCode with Agent Command Center once, `brew install node`, or set
  `ACC_NODE`. So does a launcher whose `acc.mjs` is missing.
- **The extension records its runtime.** First thing on activation it writes
  `process.execPath` and a newline to `~/.acc/runtime`, whole or not at all,
  and only when the path changed. A failed write is logged, and activation
  carries on. This is the runtime builders' permission hook already used
  (D-030).
- **Amends D-012:** the extension runs `dist/bin/acc.mjs` with its own runtime;
  everything else, its terminals and Runs included, runs the launcher beside it.
- **Amends D-042:** a release copies the launcher and `acc.mjs` together, and a
  test fails if `plugin/bin/acc` is the launcher without `acc.mjs`. This branch
  leaves `plugin/bin/` alone, so the plugin's hooks still need node until the
  next `npm run package`.
- **A1.node is the Salesforce profile's**, since `sf` and its plugins need
  Node anyway. A generic project doesn't ask for it. With no project open the
  machine part still lists it, like A1.sf (a person decided; GH-62 can revisit
  it after a real fresh run). A1.claude's fix for a missing Claude Code is now
  `brew install --cask claude-code`, like the other tools', not npm.
- **Setup's machine results are kept with their folder's profile** and reused
  only in a folder with the same one. Otherwise a generic folder showed A1.node
  from a check made in a Salesforce folder within the last 12 hours.
- **macOS only**, on Apple Silicon or Intel. The bundle is plain JavaScript with
  no native modules, so it runs on both.
- Not chosen: bundling a Node binary into the extension or the plugin (tens of
  megabytes per architecture, for a runtime VSCode already has); a compiled
  single binary (the same size, and a build per architecture); and checking the
  recorded runtime's version (VSCode 1.95 or later has Node 20.18, and
  `ACC_NODE` is an explicit override, so neither is version-checked).
- Costs: each run starts a shell, and `node --version` when node is on PATH:
  about 50 ms more than running the bundle directly, on the author's Mac, on
  every hook. A stale `~/.acc/runtime`, say after VSCode moved, ends in the error
  until VSCode next starts. Processes acc starts on VSCode's runtime inherit
  `ELECTRON_RUN_AS_NODE`, as they already did from the extension.

## D-078 acc's notices go to Slack, once each, in fixed words (2026-10-06)

The Command Center tells a person what needs them, but only inside VSCode
(D-044, D-064). Away from it, nothing reached them (GH-58). D-005 had left
Slack for later; this is Slack for notices, not as a tracker.

- **One incoming webhook for this machine**, for every project open here. It's
  pasted on a **Notices in Slack** card under **This machine** in the
  Environments section (a person decided), and kept in VSCode's secret storage
  under `acc.slack.webhook`. It's never in a repo, `.acc/config.json`, the
  page's model or saved state, globalState or the log: the card shows only its
  last four characters. Only a `https://hooks.slack.com/services/…` address is
  taken, so a notice can't go anywhere else. The switch, the kinds, the turn-on
  time and the last result sit in `globalState`, which isn't synced. The
  commands **Send notices to Slack…** (opens the card), **Send a test message
  to Slack** and **Stop sending notices to Slack** reach it from the Command
  Palette. There's no status bar item for it.
- **Off until a person turns it on.** Connect keeps the webhook, turns sending
  on and sends a test, whose result shows on the card. **Turn off** stops every
  message; **Remove** deletes the secret. Nothing that happened before it was
  turned on is sent: a moment carries when it happened (a question's ask, a
  draft's creation, the ledger's move), and one from before is dropped.
- **Four kinds, each with a tick,** all ticked the first time (a person
  decided):
  - **Needs you:** every urgent notice the Command Center shows: blocked, an
    agent waiting in its own prompt, a stopped builder, checks failed, a
    reviewer asked for changes, a conflict with its base, an analysis with
    questions or saying the task is too big, "Autopilot couldn't …", and a
    task's agent asking a question or for permission (D-030).
  - **Review finished:** a review that passed or asked for changes, a person's
    or autopilot's. A review asking for changes is this kind even when it waits
    for you.
  - **Pull request opened:** autopilot's land that opened one. A person's own
    land isn't sent: they were there.
  - **Draft update waiting:** a new draft update for a ticket (D-066).

  Not sent: ready for review, merged, an analysis ready or back, autopilot
  re-dispatching, resuming or merging its base, a pull request updated. A
  question no task asks isn't sent, since the message names a task.
- **Slack ignores the toast's quiet rules** (a person decided): it sends while
  the Overview or Tasks is on screen, and when `agentCommandCenter.notifications`
  is off. So each window works out what changed at every reload, whether or not
  a toast shows (`News`), and toasts only when it may.
- **Fixed words, never the toast's text.** Each message is the kind, the repo's
  name, the task's id and title, a fixed phrase for what happened (a pull
  request's number at most), and one link: the task's pull request, else its
  ticket, else none. It never has a review's summary, an agent's last words,
  autopilot's reason, a question's text, a command, conflicting files, a draft's
  text or a ticket's description. The title and repo name are escaped (`&`,
  `<`, `>`), so a title like `<!channel>` mentions nobody, and a link Slack would
  read as markup isn't sent. Every message sets `unfurl_links` and
  `unfurl_media` to false. A GitHub or Jira app installed in the Slack
  workspace may still preview a link; a person who minds can untick kinds or
  use a DM.
- **Once each, from every window and across restarts.** A moment's key is built
  from ledger data, never from when a window noticed it, so every window builds
  the same one: a question's id; autopilot's event sequence; a draft's id; and
  for a task notice its kind with the move's time (blocked, a review's result),
  the review's own time (passed), the run's start (a stopped or waiting builder:
  once a run), the pull request's number and the run's start (checks, a
  reviewer, a conflict), or the analysis's time. A window claims a key by
  writing its sha256 to `~/.acc/slack/sent` with an exclusive create
  (`ACC_SLACK_DIR` in tests) before it sends; a window that finds the claim
  there sends nothing. Claims older than 30 days are pruned when VSCode starts.
  A draft that replaces one already told isn't told again (D-071), and the
  draft of a pull request autopilot opened is told by that pull request's
  message, which says its update waits.
- **Never a loop, never a flood.** One POST per message, never retried, each a
  second after the last, with a 10 s timeout. A 4xx other than 429 shows
  Slack's word for it (`channel_is_archived`) on the card, in orange with a
  warning icon, pauses sending until a test goes through or the webhook is
  replaced, and shows one VSCode warning; the Environments item in the rail
  turns orange too. Turned off while paused, the card says off and the rail
  isn't orange; turned on again, it's still paused until a test goes through.
  A 429, a 5xx, a timeout or a network error loses that one message and says
  why on the card. A burst is cut short after the one on its way and twenty
  waiting, with one message saying how many more there were.
  Errors are scrubbed of the webhook before they're shown or logged.
- **Accepted:** a message claimed and then refused, or lost to a crash between
  the claim and the POST, isn't sent again. Paused, a moment isn't claimed, so
  once it's fixed, what comes next still goes. A builder waiting in its own
  prompt twice in one run is one message, and so are checks that fail, pass and
  fail again in one run: the ledger keeps no time for a check's result. A pull
  request autopilot opened is one message: its draft update isn't told again,
  even with Pull request opened unticked.
- **A message only ever goes to the webhook pasted:** a redirect isn't followed.
- **Only the extension sends.** The CLI and autopilot never post to Slack, so
  `packages/core` is unchanged (D-003). A machine with no VSCode open sends
  nothing.
- Not chosen: keeping the webhook in settings.json, where it would sync and be
  readable by other extensions; retrying a failed message; sending from the CLI
  or autopilot; a webhook per repo or project; Slack's OAuth apps, bot tokens,
  buttons or replies; and the toast's own text, which can carry what a client
  wouldn't want in Slack.

## D-079 One version, a CHANGELOG, no personal data in a package, and releases a person makes (2026-10-06)

acc said 0.1.0 while the extension, the plugin and the marketplace said
0.33.0, each bumped by hand, and nothing stopped a package carrying its
packager's own data (GH-60). This is the second of four packaging tasks, after
D-077 and before GH-61 and GH-62.

- **One version, the root package.json's.** acc reads it for `--version` and
  `acc help`; its bundle gets that one field, not the whole file. The
  extension's package.json, plugin.json, the marketplace's `acc` entry and
  package-lock.json keep literal copies, because vsce and Claude Code read
  those files as they're committed. `npm run set-version -- <x.y.z>` is the one
  way to change it: it rewrites only the version strings, and writes nothing if
  one can't be found. A test fails, naming the file, when one disagrees, and
  another when `acc --version`, from source or built, prints anything else.
  This task sets 0.35.0 (a person decided).
- **CHANGELOG.md**, at the root: `## x.y.z` headings, newest first, each once,
  each with notes in plain words, and `## Earlier versions` last. It starts at
  0.34.0, already released from main; earlier versions weren't released and
  aren't backfilled (a person decided). A test checks its shape.
- **`npm run package`** checks that the versions agree and that the CHANGELOG
  has an entry for this one, before building anything. Then `npm run check`,
  then vsce, then a scan of the `.vsix` and the plugin. **Amends D-042:**
  plugin/bin is written last, only after a clean scan. A failed scan deletes
  its `.vsix` and leaves plugin/bin as it was, so nothing personal is one
  commit from shipping. `npm run build -- --release` is gone.
- **The scan** reads every file in the `.vsix` (opened with macOS's
  `/usr/bin/unzip`), and the plugin as a release commits it: plugin/ with bin/
  as the build made it, and the marketplace. A file with a NUL byte, a font or
  an image, is read byte for byte, so a path in its metadata still shows. Each
  find is a line, `<package>: <file>:<line>: <what>`. It looks for:
  - a home path: `/Users/<name>`, `/home/<name>`, or `-Users-<name>-` as
    `~/.claude/projects` writes it;
  - the packager's git emails, from every scope and every file the system and
    global configs include, whatever its `includeIf` condition, from
    `GIT_AUTHOR_EMAIL` and the like, and from `.acc/config.json`'s
    commitIdentity;
  - a GitHub account: every one gh is signed in to, the repo's own and the
    clone's (D-028), as whole words;
  - a `.claude/` or `.acc/` path holding the packager's username or real name
    (their login name, `id -F`, git's user.name). acc's own generic paths,
    such as `~/.acc/runtime`, don't;
  - any real-looking Jira site (`<site>.atlassian.net`) or Azure DevOps
    organization (`dev.azure.com/<org>`, `<org>.visualstudio.com`);
  - the sites, organizations and client repos the packager has signed in to
    trackers for.
- **The packager's words come from their machine** each time, and are never
  written into the repo.
- **Sign-ins are read by name only** (a person decided). They live only in
  VSCode's secret storage, as `acc.cred:<repo>:<kind>:<host>` (D-027). The
  scan opens VSCode's `state.vscdb` read-only with `node:sqlite` and selects
  only the keys holding `acc.cred:`, never a value. An Azure DevOps host is a
  bare organization, so it's matched only as `dev.azure.com/<org>` or
  `<org>.visualstudio.com`. If the file can't be read, the scan says so and
  goes on by pattern. `ACC_VSCODE_STATE` names another file, or none when
  empty.
- **What may stay:** the test fixtures' placeholders, acme, jordan-kim, jordan,
  example and you, as whole names; and `github.com/jack-huffman/agent-command-center`,
  the repo's own address (a person decided). So plugin.json's author and the
  marketplace's owner are now Agent Command Center, linking to the repo, not a
  person's account. The publisher, `JackHuffman`, stays: changing it changes
  the extension's id, and loses every sign-in stored under it.
- **`npm run release`** makes the GitHub Release `v<x.y.z>` of HEAD on
  `.acc/config.json`'s github.repo, as its account or the clone's (D-007,
  D-028), with the `.vsix` attached and the CHANGELOG entry as its notes. Its
  title is the bare version, and it isn't a prerelease. It refuses, saying
  why, when there's no terminal; `ACC_ROLE` is set; HEAD isn't main, or isn't
  origin/main after a fetch; there are uncommitted changes; the versions
  disagree; the CHANGELOG has no entry; the `.vsix` is missing or holds another
  version; plugin/bin's `acc` or `acc.mjs` isn't the `.vsix`'s; the scan, run
  again, finds anything; gh isn't signed in as the account; or the release or
  its tag already exists. Last, the person types the version. The upload gets
  10 minutes, not gh's usual 2 (D-051).
- **A release, in order:** `npm run set-version -- <x.y.z>` and a CHANGELOG
  entry, on a branch like any change; once merged, on main, `npm run package`,
  commit plugin/bin and push; then `npm run release`.
- **Builders can't release.** The Bash guard denies `npm run release`,
  `node scripts/release.mjs` and `gh release create|upload|edit|delete`, through
  `nice` and the other wrappers. Builders' settings deny the same, since they
  allow `npm run *`. `gh release view` stays allowed. Fixtures:
  `gh-release-create.json`, `npm-run-release.json`, `gh-release-view.json`.
- **This repo's packaging lives in scripts/**, not core: releasing this repo
  isn't acc's product behaviour (D-003). Its tests are in scripts/test, part of
  `npm test`.
- **Accepted:** the marketplace install clones the whole repo, with its history
  and its commits' emails, so the scan doesn't make that install free of
  personal data. The repo is private and invitation-only. A packager whose own
  username is a placeholder isn't caught by the home path rule. A builder that
  runs `npm run package` on a branch still rewrites plugin/bin. macOS only, as
  D-077.
- Not chosen: setting the manifests' versions at build time (vsce and Claude
  Code read them as committed); a zip library (macOS has unzip); flagging every
  email address (it's the packager's own that matter); and releasing from CI.

## D-080 A machine sets how many heavy checks run at once; this repo runs five builders on Opus 5.5 (2026-10-06)

The author asked why builders were capped at three, and wanted full swarming.
The cap was `agents.max`'s default from `acc init`. The real limits were the one
heavy-check slot on the machine (D-024), merge conflicts, the serial merge, the
person's attention, and Claude usage. The author chose, as a first step, five
builders and two heavy-check slots, with conflict-aware dispatch, a merge queue
and model choice as tasks of their own.

- **Heavy-check slots are this machine's setting,** shared by every repo and
  worktree on it: `ACC_HEAVY_SLOTS` if set, else `heavySlots` in
  `~/.acc/machine.json`, else one, and never more than eight.
  `acc machine heavy-slots [<n>]` shows or sets it. Builders, reviewers and
  analysts can't change it: the CLI, `guardBash` and the builder's settings
  refuse `acc machine`. This machine is set to two. If two checks at once make
  it stutter, set it back to one.
- **This repo runs five builders at once** (`agents.max`), and builds and
  reviews with Opus 5.5 (`agents.builder.model`, `agents.reviewer.model`).
- **`acc agents set … --project` is a switch,** as its help says and the
  Command Center sends it. It had been read as needing a value, since
  `acc init --project <name>` names the project, so saving for the project from
  the Command Center failed.
- Not chosen: raising the cap with one slot, where builders would mostly wait
  for checks.

## D-081 The acc plugin is a walkthrough step, installed for every session from the repo's address; the docs are written for someone new (2026-10-06)

A4.plugin was a placeholder the walkthrough hid, and the README and
ONBOARDING.md assumed the author's machine (GH-61). This is the third of four
packaging tasks, after D-077 and D-079 and before GH-62.

- **The check asks Claude Code.** `claude plugin list --json` lists each
  installed plugin with its `id`, `version`, `scope` and `enabled` (Claude
  Code 2.1.292, run here). A4 passes when `acc@agent-command-center` is
  installed at user scope and enabled, and names its version. Only when it
  isn't installed there does it also read `claude plugin marketplace list
  --json`, whose entries have a `name`. Not chosen: reading
  `~/.claude/plugins/*.json` and `enabledPlugins`, which are Claude Code's
  undocumented internals.
- **Each state gets its own fix.** No marketplace: `claude plugin marketplace
  add https://github.com/jack-huffman/agent-command-center && claude plugin
  install acc@agent-command-center --scope user`, which is also the step's own
  command. The marketplace but no plugin: the install alone. Installed but
  disabled: `claude plugin enable acc@agent-command-center --scope user`.
  Installed for one project only (project or local scope): the user-scope
  install. Re-adding a marketplace that's there already exits 0, but the fix
  still says only what's missing. Not chosen: `claude plugin install
  --marketplace <source>`, one command that hides which part was missing.
- **No Claude Code, or output it can't read.** claude not installed (exit 127)
  fails and says to do A1.claude first, with no fix of its own. A list that
  doesn't run, isn't JSON, or isn't a list of objects is `unknown`, with the
  reason, never a crash.
- **User scope** (a person decided): one machine step, and every Claude Code
  session has the hooks, which do nothing in a repo without `.acc/config.json`
  (D-042). Not chosen: project scope, or committing `extraKnownMarketplaces`
  into client repos.
- **The repo is written as its full URL**, `https://github.com/jack-huffman/agent-command-center`,
  in the step, its page and the docs: D-079's scan allows only
  `github.com/<repo>`, and would stop `npm run package` at a bare
  `owner/repo`. Claude Code takes the URL as a git source and clones its
  `.git`. `PLUGIN` in the step list holds the marketplace's name, the plugin's
  name and the address; a test holds them to `.claude-plugin/marketplace.json`
  and `plugin.json`'s `repository`.
- **Credentials are the person's own** (a person decided). The marketplace is
  this private repo, and Claude Code clones it with the person's git
  credentials. **Do it** runs in a terminal, as any `claude <subcommand>` does,
  so a git prompt shows, and the step checks itself when the command ends.
  The README's Getting access says to accept the invitation with the account
  you'll use, check `git ls-remote`, and run `gh auth setup-git` if that
  fails, saying that it changes the global git config for every repo without a
  helper of its own. A private marketplace doesn't update itself without
  `GITHUB_TOKEN`, so the plugin is updated by hand after each release.
- **No version match yet.** A4 passes whatever version is installed, and names
  it. Whether a plugin older than the extension should fail is GH-62's to
  decide (a person decided).
- **`planned` is gone.** A4 was the only planned step, so the field, and its
  filters in the walkthrough, the Setup page, the screenshot fixtures and
  `acc doctor --json`'s `planned` key, went with it. A4 shows after A2 in the
  machine walkthrough, under The acc plugin on the Setup page, and in
  `acc doctor` and `acc onboard`.
- **ONBOARDING.md stays hand-written, held to the step list.** It writes every
  step as **title** (`id`), and a test takes those pairs in order and compares
  them with the steps', naming what's missing, extra or retitled. Another
  checks that every guide link a step or the README gives is one of its
  headings. Generating it from the steps (D-017) stays for later.
- **The author's own material** (a person decided): B4 says what the skeleton
  needs, with no copy from another project; the per-org folders' notes are one
  optional section, Coming from per-org folders; moving a Claude conversation
  between folders is gone; and Part C is Problems you may hit, without dated
  anecdotes. The pilot and milestone text, and Part D's commands that don't
  exist, are gone.
- **The README has Install and first run**: what you need, getting access,
  installing the `.vsix` from a release, the first run, and what acc changes on
  the machine. The plugin's by-hand install is the first run's second step;
  the developer's `npm run package && npm run install-extension` moved under
  Development. The extension's own README, which ships in the `.vsix`, names
  the walkthroughs by their titles and no longer asks for Node (D-077).
- **The docs pass the scan.** A test runs D-079's scan over the README,
  ONBOARDING.md, the extension's README, its package.json and every step page,
  with this repo's account, commit email and name as the words, and finds
  nothing.

## D-082 acc sync closes a task's GitHub issue when its work merges, where the tracker says edits (2026-10-06)

When a task's pull request merged, acc sync moved it to done (D-033), but its
GitHub issue stayed open, because acc changed no ticket by itself (D-066).
About twenty finished issues stood open on this repo for that reason (GH-68). A
tracker that says `"edits": true` has opted in to acc changing its tickets, and
this repo's own GitHub tracker does.

- **GitHub Issues only, and only where the tracker says `"edits": true`.** When
  acc sync moves a task from review to done because its pull request merged,
  and the task came from a GitHub issue under the GitHub tracker that owns GH-
  keys (the first) and that tracker says `"edits": true`, acc closes the issue
  as completed. It closes it as the repo's account (D-007), or the clone's
  (D-028), the account sync reads pull requests with. One comment goes with
  it: "Done: pull request #42 merged into main.", naming `owner/repo#42` when
  the issue lives in another repo. A tracker without `"edits"` or with it
  false, a client's tracker, and a repo with no GitHub tracker are never
  touched: the task is done and gets its merged draft, as before.
- **Jira and Azure DevOps are never changed by this,** even with `"edits"`. A
  ticket's status there belongs to the client's workflow, with its own states
  and transitions. Their tasks keep the merged draft.
- **Once only.** The close is marked on the task's pull request (`pr.issue`):
  pending as the task moves to done, then closed, or left with why. acc looks
  at the issue first and leaves as it is one already closed, one that moved to
  another repo, and one GitHub can't find. Once settled, acc never touches it
  again, so an issue a person reopens stays open. A new pull request after
  rework starts with no mark.
- **A close that fails is named in sync's output** ("couldn't close issue #9
  (HTTP 502): the next sync tries again"), stays pending with why, and each acc
  sync tries again, even with no pull request left open. The Command Center's
  poll keeps running acc sync while a close is pending (`followsPullRequests`).
  A retry leaves an open issue GitHub marks as reopened (`stateReason`
  REOPENED), from any reopen, not only one since the merge: that's what acc
  can tell, and it errs toward leaving an issue open. A pending close is only
  settled while its task is done: one a person sent back to rework keeps its
  issue open. One a timed-out close
  may have closed (D-051) is recorded as already closed. A failure that repeats
  word for word leaves the ledger alone. A pending close whose tracker no longer
  says `"edits"` is left. Each gh call gets a minute, as sync's others do.
- **The close's comment stands in for the merged draft,** as a person decided.
  Where acc closes the issue, sync drafts no "merged" update. A close that took,
  or found the issue already closed, discards the task's unposted pull request
  and merged drafts, kept and marked, by acc sync, and says so. Promotion,
  deploy, blocked and question drafts are unchanged.
- **`acc sync --close-done` is a one-off tidy** for tasks done before this. It
  runs the normal sync, then takes each done task with a merged pull request
  and no close marked, under the same rule. It closes the open ones with the
  comment, and leaves those already closed, reopened (`stateReason` REOPENED) or
  moved, recording them as left. It lists every one with its outcome, and a
  second run does nothing. `--plan` only looks: it lists what the tidy would
  close or leave, without syncing, closing or writing, and says that a sync may
  also close the issues of tasks merged since it last ran.
- **Accepted:** two syncs at the same moment (two windows' polls, or a person's
  sync during one) can both close an issue and post the comment twice. gh's
  check that it's already closed narrows that to near-simultaneous runs, and
  it's this repo's own issues only. A done task with no pull request,
  such as one intake moved to done because its issue closed, isn't listed.
  `--json` carries each outcome, as it does for sync's changes.
- **Only a person runs the tidy.** Builders, reviewers, analysts and autopilot
  can't: the CLI refuses, `guardBash` refuses `acc sync --close-done`, and the
  builder's settings deny `acc sync --close-done*`. A plain `acc sync` stays
  anyone's.
- **This is the first time acc writes to a ticket unattended.** The Command
  Center runs acc sync every two minutes, so on a GitHub tracker with `"edits"`,
  issues close with no person at the keyboard. That's what `"edits"` opts in to
  now. On this repo the first sync after this closes #60, whose pull request
  merged while its task was in review. Run `acc sync --close-done --plan` and
  read the list before the tidy.
- Accepted:
  - On a GitHub tracker with several environments, the issue closes at the
    merge into the task's own environment, before any promotion, since D-033
    counts merged as done. Promotion and deploy drafts then comment on a closed
    issue.
  - `gh issue close --comment` comments, then closes. If the close fails after
    the comment went, the retry comments again. Looking first limits that to
    this one case.
- This amends D-066, for GitHub trackers with `"edits"`: "acc posts nothing on
  a ticket", an unattended sync posting nothing, and the merged draft. It
  amends D-033: sync's merge to done now closes the issue there too. The
  `"edits"` comment and error in the config, and the task page's read-only
  message, say what `"edits"` now covers.
- Not chosen:
  - "Closes #N" in the pull request's description. GitHub closes only on a
    merge into the default branch, ignores `"edits"`, and can't close once
    only; `acc land` writes only "refs #N" on purpose.
  - Moving Jira and Azure DevOps tickets to a done status, even with
    `"edits"`.
  - Closing issues for promotions, deploys, or pull requests closed without
    merging.
  - Showing a failed close in Needs you, Slack or the task page. It shows in
    sync's output.

## D-083 Autopilot merges a reviewed, green pull request where a repo turns it on (2026-10-06)

acc never merged: a person merged every pull request on GitHub (D-014, D-033,
D-055). The author asked whether reviewed, tested pull requests could merge on
their own, and chose an opt-in, off by default and meant for client repos
(GH-67).

- **Off unless a repo turns it on.** `"autopilot": { "autoMerge": true }` in
  `.acc/config.json`, next to `appendOnly`. Left out or false, nothing changes:
  autopilot reads nothing more from GitHub and makes the same steps as before.
  It acts only under `autonomy: review`, and only while autopilot is switched
  on (D-064): the config is the project's consent, the click is the person's.
  - One switch a repo covers every environment that isn't protected. A
    protected one never auto-merges (D-018), even one marked protected after
    its task was built, and nor does a pull request whose base on GitHub isn't
    its task's environment.
  - A Salesforce project can't turn it on: the config fails to load, naming the
    rule, and `acc agents auto-merge on` refuses.
  - `acc agents auto-merge [on|off]` shows it or changes only that key, the rest
    of the file byte for byte, for a person to commit. Builders, reviewers and
    analysts can't run it; `guardBash` and the builder's settings deny it. The
    Command Center's Agents section has an Auto-merge row whose Change… runs it,
    and the status bar's menu says Auto-merge on or off for each repo.
- **What merges.** A task in review whose open pull request autopilot landed at
  the branch's latest commit, when all of these hold:
  - its review passed on that commit, and the required checks are settled there
  - GitHub's required checks passed, or every check when the base requires none
    (D-076). A check still running waits. A failed or cancelled one holds the
    merge: a failure with a log goes back to its builder as before (D-076), and
    one without a log, or a cancelled one, is recorded and needs you.
  - no checks at all count as passed only when the base requires none and none
    are reported 2 minutes or more after its last land (`pr.landedAt`), so a slow
    CI has time to register (a person decided). Before that, autopilot waits.
    gh says "no checks reported" before it looks for required ones, so on a
    commit with none it can't say which the base requires: GitHub's word on
    merging does. BLOCKED with no checks reported waits for the checks the base
    requires, and records nothing, until 15 minutes after the land. After that
    it's more likely a rule no check meets, such as a required approving review
    on a repo with no CI: recorded, and it needs you, so it never waits unseen.
  - GitHub says it's mergeable (`mergeable` MERGEABLE, `mergeStateStatus` CLEAN,
    UNSTABLE or HAS_HOOKS). Still working it out: it waits. BLOCKED with checks
    reported, such as a required approving review, DIRTY or a draft: recorded,
    and it needs you.
  - no person asked for changes (`reviewDecision`): it waits for them, and acc
    sync shows the task as needs you as before.
  - nothing waits on a person: no step autopilot couldn't take, no agent asking
    in its worktree, no conflict. A draft update for the ticket doesn't hold it
    (a person decided).
  - it changes nothing under `.acc/`. One that does, such as a change to
    `.acc/config.json`, is recorded as "it changes .acc/, which a person
    merges", and needs you (a person decided).
- **A base that moved is merged in first.** With auto-merge on, a pull request
  that's only behind its base gets the `refresh` step too (D-058), not just one
  that conflicts. Autopilot fetches the base and the branch for a pull request
  it would merge, and asks git whether the branch has all of the base. The merge
  commit then takes its checks, a review, a land and GitHub's checks, like any
  commit, before its own merge. This amends D-058: with auto-merge off, a
  refresh is still for conflicts only.
- **How it merges.** `gh pr merge <n> -R <repo> --<method> --match-head-commit
  <sha>` as the repo's account (D-007, D-028), with a timeout (D-051). The method
  is the repo's: the first of merge, squash and rebase that GitHub allows it, as
  `gh repo view` says, since gh needs one named when it runs unattended. It never
  deletes the branch, uses `--admin` or `--auto`, or approves anything: branch
  protection holds as for anyone.
  - It reads everything again just before: the ledger, the branch's head, the
    verdict, the receipts, `gh pr view` and the checks. A head that moved on
    GitHub, a base that moved, or checks that started again only wait for the
    next pass, and record nothing.
  - One merge a pass. Every merge leaves the others behind their base, so each
    takes its refresh, review and land before its own.
  - A merge that fails is recorded as `merge` on that commit, like any step
    (D-055), and the task needs you: "autopilot couldn't merge it: <reason>". It
    isn't tried again on that commit. A gh that failed or ran out of time is
    followed by a fresh look at the pull request: merged is a merge, and a head
    that moved only waits.
- **acc sync moves it to done.** Autopilot still never syncs (D-055). It keeps
  `autopilot.merged` (the commit, the pull request, the method, when) and emits
  `task.updated` with `merged`, and later passes skip the task. The next `acc
  sync`, every 2 minutes in the Command Center, sees it merged, moves it review →
  done and drafts its `merged` update (D-066).
- **In words.** History says "Autopilot merged pull request #N", with its link,
  and the notice "Autopilot merged pull request #N (<ID>)". A failure says
  "Autopilot couldn't merge <ID>: <reason>". Slack sends the failure as Needs you
  and doesn't send a merge (D-078). With auto-merge on, everything that said
  autopilot never merges says when it does: `acc help`, `acc agents autonomy`,
  the autopilot switch's tooltip, the Agents rows, the land confirmation, the
  pull request's footer, README, DESIGN and the land skill.
- **This repo turns it on**, with `autonomy: review` in the same commit (a
  person decided). It has no GitHub checks, so its pull requests merge 2 minutes
  after they're landed, once reviewed, when autopilot is switched on.
- This amends D-014 ("nothing ever auto-merges"), D-033 (land "never merges"),
  D-055 (autopilot "never merges") and D-058 ("D-014 still holds"): a repo can
  now let autopilot merge into an environment that isn't protected. Deploying,
  promoting, and anything protected stay a person's.
- Not chosen:
  - GitHub's native auto-merge (`--auto`) or a merge queue. acc's own conditions,
    such as nothing waiting on a person, wouldn't hold once GitHub took over.
  - Merging promotion pull requests, which `acc promote` opens into a further
    environment.
  - Deleting the branch or worktree after a merge: `acc cleanup` does (D-013).
  - Counting an unposted draft update as waiting on a person.

## D-084 A builder's conversation still opens in its worktree's window: Claude Code can't open it here (2026-10-06)

The author asked whether Open in Claude Code could open a builder in a new tab
in this window, not a new window (D-041). The author chose to keep the new
window, after this look at Claude Code for VSCode 2.1.291:

- **Its link finds only the window's own conversations.** `/open?session=<id>`
  takes a session and a prompt, no folder. The tab opens a session only from
  its session list, which reads the window folder's conversations alone
  (`includeWorktrees` is off). A builder's is saved under its worktree, so the
  tab would show a blank conversation, as D-041 found.
- **Linking the file into the window's folder isn't safe.** Claude Code refuses
  a symbolic link (`O_NOFOLLOW`, `lstat`) and, in places that write to it, a
  hard link (`nlink > 1`), so it could stop saving a running builder's
  conversation. And its list takes a conversation's folder from the last
  `relocated` record in the file's last 64 KB, else from the first entry. A
  builder's first entries name the main checkout, so a long run could resume
  there instead of in its worktree.
- Not chosen: a terminal tab in this window (`claude attach`, or `--resume` in
  the worktree), which works today but shows Claude Code's terminal view, not
  its panel.
- Look again when Claude Code's link can open a conversation saved under
  another worktree of the window's repo.

## D-085 A monday.com board is a tracker, connected on the Connect page (2026-10-06)

D-005 left monday.com for later, and D-073 made a new tracker a client and a
description. The author asked for it now (GH-70). It's built the way Azure
DevOps was, with three choices a person made.

- **A board is the tracker, as a Jira project is; a group on it is the place
  (D-072).** The config names `account` (as in acme.monday.com) and `board`
  (its id, a number below 2^53), and may name `group`. The board is what an
  existing tracker shows fixed, by its name, and what a draft is checked
  against before it posts. Two boards on one account are two trackers:
  `withTracker` tells monday.com trackers apart by account and board, since
  they have no project. Board and group names are read from monday.com when
  the board loads, never stored; before that, the place names them by id.
- **Sign-in is a personal API token, kept for this repo only (D-027).** It sees
  everything its person sees in monday.com, so the sign-in check compares the
  token's account (`me.account.slug`) with the account typed, and refuses one
  from another account, naming it, beside the token. Create a token opens
  `https://<account>.monday.com/apps/manage/tokens`, the Developer Center's My
  access tokens; monday.com's docs give the menu path, not a URL. The Board
  list is the boards the token can see, by workspace then name, leaving out
  sub-item boards, documents, and archived or deleted boards.
- **The board's columns are one status column's labels** (a person decided).
  A Status column list follows the board, depending on it, with the column
  called Status chosen, or else the first status column. It's drawn only when
  the board has more than one, and `statusColumn` is written only when it
  isn't that usual one. Labels go in monday.com's own order; a done label's
  column is done, No status is to do, and the rest are in progress. No status
  comes first, and only when an item has none; a label monday.com has switched
  off gets a column only while an item is on it; an item on its blank label
  has no status. Dragging a card sets the label, whether or not the tracker
  says `"edits"` (D-066), as on the other boards.
- **An item has no description, so its long-text columns are** (a person
  decided), in board order, each under its column's title, as the ticket page's
  body and the builder's brief. With none filled in, the item's oldest update
  is. Updates and their replies are the comments either way. Sub-items are
  related tickets, never cards.
- **`"edits": true` lets the task page change two things** (a person decided):
  Status sets the chosen status column's label, and Assign sets the board's
  first People column, ticking any of the board's subscribers, or is refused in
  words when the board has none. Labels are always refused: monday.com items
  have no labels. Without `"edits"`, all three are refused before monday.com is
  asked anything, as for every tracker.
- **An item's key is `MON-<item id>`**, or the tracker's `prefix`, as Azure's AB
  is. Item ids are the whole account's, so `ticket()` holds every read to the
  board, and to the group when there is one: an item elsewhere is outside,
  naming where it is. `outside()` reads items by id, a hundred at a time; a
  batch it can't read, or an item it can't see, is never outside (D-048), and
  with `project` only the board counts.
- **A second board's keys are its own.** A key finds only the first tracker
  whose prefix it has, so a second board on the account keyed MON too would
  lose its items to the first: that board's place check found them on another
  board, and `acc intake` took the unstarted ones off the ledger, and their
  drafts could never post. So when the Connect page adds a monday.com tracker
  whose prefix another tracker already gives (a monday.com board or a Jira
  project called MON), it writes the first free one, `MON2`, `MON3` and so on,
  as `prefix`. A prefix the config already names is kept. A config written by
  hand with two trackers giving one prefix still gets a warning. So does the
  other order, accepted as unlikely: a Jira project keyed MON added after a
  monday.com board that uses MON. Only adding a monday.com board picks a free
  prefix, so the two share it, and only acc's config warning on the command
  line says so.
- **Updates post as item updates**, as HTML with every word escaped, through
  the Command Center only; `acc update post` refuses them as it does Jira's.
  `acc intake monday --file` follows items that left the place, and
  `acc import` refuses a monday.com key no monday.com tracker owns. Items come
  in through Track (D-074); the intake skill has no query for them.
- **GraphQL at `https://api.monday.com/v2`, pinned to `API-Version: 2026-10`**,
  monday.com's current version since 2026-10-01. Ids, names and text always go
  as variables, never into a query's text. A board asks only for its status
  and People columns, 500 items a page by `items_page` cursors, up to 2,000
  cards, and only its group's items when there is one. A rate or complexity
  limit is said with its wait and not retried: the board reloads in 120 s
  anyway. The status column's labels are read from `columns.settings` in the
  2026-10 shape (`labels` with `id`, `index`, `is_done`, `is_deactivated`);
  the older shape, a map of ids to names, is read too. The stand-in in the
  tests encodes that shape, so one board should be checked against a real
  account before a release.
- **The Connect page gained two things any description can use**, still with
  no tracker named in its drawing: a list drawn only when it has a choice to
  make (`hideSingle`), and an identifying list whose values are ids, loaded for
  an existing tracker to show the name (`idValues`). A "whole" choice can name
  what's chosen above it: "Every group on Client work".
- **The tracker kinds are listed once** (`TRACKER_KINDS`), and the config,
  ledger, updates and Command Center take theirs from it, with `trackerName`
  and `signInLabel` for the words.
- Not chosen: OAuth or a marketplace app; webhooks or live updates; several
  boards or groups per tracker; sub-item boards as boards; creating items;
  posting monday.com updates from the CLI; a brand mark for its icon (it's the
  `table` codicon).
- This takes up what D-005 deferred for monday.com. Slack stays a place for
  acc's notices (D-078), not a ticket source.

## D-086 Opus 5.5 by default, and a model picked per task (2026-10-06)

The author: "We should support picking a model, but let's default to Opus
5.5" (GH-74). A repo or a clone could set the builder's and reviewer's model
(D-036), and without one Claude Code chose. This changes D-036's "anything
unset is Claude Code's own default" for the model.

- **acc's default model is `claude-opus-5-5`,** for builders, reviewers and
  analysts, wherever neither the clone nor the project names one. The clone
  still wins over the project, and both over the default. It's a pinned full
  name, not the alias `opus`, so moving to a newer Opus is an acc release.
  Effort and fallback stay Claude Code's own when unset.
- **Every launch names the model.** `agentArgs` builds `--model` for dispatch,
  resume, review, the analysis, a free-form agent and the reply to any
  session (D-060), so the default lives in that one place. A fallback that is
  the model itself is left out: Claude Code won't start with
  `--fallback-model` the same as `--model`.
- **`acc agents`** says `model claude-opus-5-5 (acc's default)`, and its JSON
  gives the model's source as `acc`, apart from `default`, which is Claude
  Code's, for effort and fallback. How agents run says "acc's default".
- **A model picked for a task.** `acc dispatch <id> --model <m>`, and
  **Dispatch with…** behind the card's ⋯ and on the task page, wherever
  Dispatch or Re-dispatch is offered. A name that isn't a model name is
  refused before any worktree is made. The run keeps it (`run.model`,
  `run.modelPicked`), so a re-dispatch of its rework, by a person or by
  autopilot, `acc resume` and the reply to its builder use it, until another
  is picked. A run nobody picked a model for records what it started with,
  and follows the clone's, the project's or acc's default each time.
- **Builder only** (a person decided). A task's reviewer, and its analyst on
  a re-analysis, keep the reviewer's profile (D-052).
- **One list of models** (a person decided): `claude-opus-5-5`,
  `claude-fable-5-1`, `claude-sonnet-5-5` and `claude-haiku-4-5-20251001`,
  then Another model…, in Dispatch with… and in How agents run's Change….
  Change…'s first entry, which clears the choice, reads acc's default
  (claude-opus-5-5). Dispatch with… puts the model the builder would run with
  anyway first, saying where it's set: picked for this task, this clone, the
  project, or acc's default. Choosing that model, for a task with none picked
  before, dispatches without `--model`, so the task goes on following the
  settings. Any other choice is kept for the task.
- **The analysis's size, beside the choice** (a person decided). Dispatch
  with… says "Its analysis sizes it L: a few days", or "Not analyzed: no size
  to go on". The size picks and reorders nothing, and the analysis has no
  suggested-model field. The size's meanings live in one place, which the
  analyst's schema is built from.
- **Each running agent's model is shown:** under Agent on its card, as Model
  on its task page, and in a Model column on Agents. It's the model the
  agent's transcript last answered with, read from its last 256 KB and kept
  until the file changes, as the last thing it said is (D-067); before its
  first answer, the model acc started it with; else a dash. Agents shows it
  short (`opus-5-5`, the full name on hover), takes Kind's room below 1100 px
  and drops it below 560 px, so the row menu never covers a column. A
  transcript that can't be found is looked for again after 30 seconds, not on
  every poll.
- **Accepted:** a pick outlasts Abandon and a fresh Dispatch, as the branch
  does; the card shows the model, so an old pick is seen. The reply to a
  session that isn't a task's now names acc's default too. This repo's own
  config already names `claude-opus-5-5` (D-080), so it changes nothing here.
- Not chosen: picking a model by the analysis's size; a per-task effort or
  fallback; the aliases (`opus`, `sonnet`) in the lists, which move under you.

Note (D-168, 2026-10-16): Dispatch with… is gone from the card and the task page. Dispatch itself opens a
sheet that asks for the model, from the same list in the same order, then the effort and where it runs;
the model the builder uses is chosen first, saying where it's set. The command `acc.task.dispatchWith`
stays for one release and opens the same sheet. Choosing the defaults still sends no `--model`.

## D-087 Agents are named for their project, ticket and role (2026-10-06)

A builder's Claude Code session was named after its task's id alone (`GH-44`),
and reviewers and analysts had no name. With several builders in several repos
(D-080), that didn't say whose work it was (GH-77).

- **The name is `<project> · <key> <title> · <role>`** (the author chose it):
  `Acme Service · ACME-12 Case escalation rules · builder`. The project is
  `.acc/config.json`'s, the key the task's id, and the role `builder`, `review`
  or `analysis`. `sessionName()` in core's `names.ts` makes it, for dispatch,
  review and analyze alike.
- **Short:** the title, and the project as a guard, are cut at the last space
  that leaves 39 characters or fewer, with trailing punctuation dropped and `…`
  added, so each is at most 40. A single longer word is cut at 39. A title
  that's empty or cleans away leaves the key alone.
- **Safe to show anywhere:** only letters and digits of any language, spaces
  and `- _ . , : ( ) + #` stay. Whitespace, control characters, `/`, `\`, `~`
  and `·` become spaces, so a path falls apart into words and `·` only ever
  separates; everything else (`"'$!;|&<>*?` and backticks among them) is
  dropped. A word that looks like a token is dropped too: one starting `ghp_`,
  `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, `sk-`, `xox`, `AKIA` or `eyJ`,
  or one of 20 characters or more mixing letters and digits. An id that isn't
  one is cut to what an id holds. A false positive only shortens a name.
- **Builder N** (a person decided): the Nth dispatch of a task is `builder N`,
  and the first has no number. acc never runs two builders on one task at once,
  so the second is a rework or a re-dispatch after Abandon. A run recorded
  before names counts as the first. A resume keeps its run's name and number.
  Each review or analysis is a one-off, so it's never numbered.
- **What Claude Code does** (2.1.292, checked with throwaway `-p` sessions,
  and by reading the CLI for `--bg`, which won't start in an untrusted folder
  and can't be started from a builder's worktree):
  - `-p --name` names the session. `claude agents --json` lists it, as
    `interactive`, under exactly that name: 84 characters with `·` and `…`
    came back unchanged.
  - `-p --resume <id>` without `--name` lists the session under a name of its
    own (`probe-5e`); with `--name` it's the name given. So a resume, and
    D-060's reply, pass the run's name.
  - `--bg` makes its own session id: it warns "--bg manages the session id;
    ignoring --session-id". So a builder can't be found by an id acc chose.
- **acc never finds an agent by its name alone.** Dispatch records `name` and
  `n` on the task's run, and `--name` on the review and analysis puts the name
  in their running markers and in the verdict and analysis they write. The new
  background session is found by its name, in the folder it started in (or the
  worktree it may already have entered), started at most 5 s before the launch:
  two clones of a repo name a task's builder alike, and an older session of the
  same name is another run's. After that, `sessionsOf` (core) and `sessionFor`
  (extension), now one rule, find a task's agent by its background or session
  id; when neither was recorded, by a background session named as its run
  recorded; and for a run from before names, by one named the task's id, as
  before. A title changed later doesn't lose it, and a name worked out from the
  new title is never taken. builderStopped, resume and autopilot all use it.
- **The same name everywhere it shows.** `displayName()` gives the name acc
  recorded (the run's, the review's or the analysis's, by session) before
  Claude Code's, so a resumed session listed under another name still reads
  the same. It's used on the Agents tab, the agent page and its tab title, the
  Overview, the Stop prompt, and the terminals Attach and Watch open
  (`claude: <name>`); `acc dispatch` and `acc show` print it. The agent page
  names it once in its breadcrumb, linked to its task, with the task's title
  as the heading. The task page shows the builder's name under Agent, and a
  card's agent line shows it on hover. GH-76's In progress section is to use
  `displayName(session, row)` from extension/src/logic.ts.
- **Notices and Slack name the agent** (a person decided), which amends
  D-078's fixed words: a notice about an agent says its name in place of
  "GH-12's agent" ("… · builder is waiting for you in its own prompt.",
  "… · builder stopped: …"), and Slack's lines about one do too, escaped like
  the rest ("… · builder has a question for you."). A run from before names
  keeps the old words. Other notices name the task, as before.
- **The Agents table wraps a name** rather than clipping it, since the part
  that says what an agent works on comes last; the name takes the room left
  over, and Kind is dropped below 1100px rather than 800px.
- Open in Claude Code's "Its task stays Running" hint finds the task by its
  session, not by a session name that looks like a task id.
- **Accepted:** sessions already running keep their old names; nothing renames
  them. A `--bg` name of 90 characters wasn't tried live, only `-p`'s. Free-form
  agents from "New background agent" keep the name a person types; branches,
  worktree folders, packets and `ACC_ROLE`/`ACC_TASK` are unchanged. Question
  cards still say which task asks.
- Not chosen: finding a builder by a name worked out from its task (a title
  can change); `--bg --session-id` (ignored); numbering reviews; and clipping
  names in the Agents table.

## D-088 The first run is a checklist someone fills in on another machine; a full check replaces Setup's rows; an older plugin fails A4 (2026-10-06)

GH-62, the last of four packaging tasks, after D-077, D-079 and D-081. It
asked for a first run on a fresh machine, written up and fixed, and for Setup
to forget a machine step that no longer applies (GH-59's review).

- **The run is split from this branch** (a person decided). A builder can't
  drive VSCode on a clean machine, and the author's own account shares
  `~/.claude`, `~/.acc` and the keychain with the builders running there, so
  sign-ins would pass that shouldn't. The author installs the release on
  another machine, or a coworker does after a read invitation to the repo.
  This branch gets the run ready: `docs/FIRST-RUN.md`, Setup's fix, A4's
  version check, and 0.36.0 to test. The tester's notes come back as their own
  task, which fills in FIRST-RUN.md, fixes what takes under about an hour
  (about a day in all), files the rest with what was seen, and corrects the
  README's Install and first run.
- **The samples** (a person decided): a new private throwaway repo under the
  tester's own GitHub account, as a generic project, all the way to a
  dispatched task; then a Salesforce Developer Edition org, as far as it goes,
  noting where it stops. Never a client's org.
- **FIRST-RUN.md is a checklist.** One heading per step, `### <id>: <title>`:
  the machine's, a generic project's, then Salesforce's own, in the
  walkthroughs' order, and a test holds them to the step list. Each has
  Showed, Unclear, Failed, Result, and Fixed in / filed as. Before them: the
  machine and release, getting access, and installing; after them, the
  dispatch. The docs scan (D-079) reads it, since a write-up is where a home
  path or an account name slips in most easily.
- **A full check replaces Setup's rows.** Setup merged every result into its
  rows and cleared them only when the folder changed, so a step a check
  stopped listing kept its old row: A1.node, A1.sf and A1.code-analyzer, after
  `acc init --profile generic` in a window that first checked with no
  project. Now each part a full check lists replaces that part's rows. A part
  whose check came back empty, which means acc failed, keeps its rows rather
  than blanking Setup, and a folder that isn't a project has no project rows.
  A Check of one step, a re-check or a fix still changes only its own row.
  The walkthrough's context key for a dropped step stays as it was:
  `acc.profile` already hides the step. Both rules are pure functions in
  `logic.ts` (`afterFullCheck`, `afterStepCheck`), tested without VSCode.
- **An empty machine result isn't saved.** It was, and startup reused it for
  12 hours, showing no machine rows.
- **A1.node stays listed with no project open** (a person decided, for now).
  D-077 left it to GH-62. The checklist asks the tester whether A1.node, A1.sf
  and A1.code-analyzer confused them there; the follow-up can revisit it with
  that answer.
- **A4 fails on a plugin older than acc** (a person decided; D-081 left it to
  GH-62). `acc doctor` passes its own version into the checks
  (`CheckContext.version`), and A4 compares the installed plugin's with it as
  numbers. Older fails, and its fix is `claude plugin marketplace update
  agent-command-center && claude plugin update acc@agent-command-center
  --scope user`, run in a terminal like any `claude` subcommand. Equal or
  newer passes. When there's nothing to compare, because a version isn't
  `x.y.z` or the caller doesn't know acc's, it passes as before. A disabled
  plugin's fix is still to enable it, and the next check asks for the update.
  Not chosen: failing on any difference. A newer plugin does no harm, and
  someone who updated the plugin first shouldn't be told to go back.
- **0.36.0 is set on this branch**, with its CHANGELOG entry. After it merges,
  a person packages it, commits `plugin/bin` and releases it (D-079), and the
  run uses that release.
- **The README changes only where it's certainly wrong.** A fresh VSCode
  doesn't put `code` on PATH, so it says how to add it, or to use Install from
  VSIX. The rest waits for the run, whose checklist asks about what the
  analysis suspected: no step checks for Homebrew, and the git that comes with
  Apple's command-line tools may be older than A1.git's 2.40.

## D-089 How agents run is behind a Settings button on the Agents page (2026-10-07)

The author asked for the Agents page's "How agents run" to show only after
clicking a Settings button. The settings are set once and changed rarely, and
they pushed the sessions, which change all the time, below the fold.

- **Settings**, with a gear, sits in the Agents header beside Start a
  background agent. It opens How agents run above the sessions, and reads
  **Hide settings** while it's open (`aria-expanded` says the same). Closed is
  the default; the tab remembers which way it was left.
- **Per-token billing still shows while it's closed.** It costs money while
  nobody is looking, so its orange line stays above the sessions (D-036).
- **The status bar's Auto-merge item opens it.** It goes to the Agents section
  with How agents run open, since that's where Auto-merge is changed (D-083).
- Not chosen: a separate settings page, which would take you away from the
  sessions for a row or two of choices.

## D-090 Agents show each session's folder in context, with Full path a toggle (2026-10-06)

The Agents tab's Where column was relative only for a session in a project open
in the window. Every session elsewhere showed its whole cwd, the same long text
on every row, clipped at the column's edge. The agent's page and its Needs you
card each worked the folder out again, three ways (GH-83).

- **One helper names a session's folder,** `sessionFolders` in the extension's
  model, for the Agents tab, an agent's page, its Needs you card, and GH-76's
  In progress section when it's built. Each folder has a label and its full
  path, with `~` for the home folder.
- **In a project open in this window,** a session reads as where it is in it:
  `main checkout`, `worktree ACME-12`, `force-app/main`, or `worktree AV-2` for
  a linked worktree outside the project's folder. The Agents tab leaves out the
  project, which its group's heading names. The agent's page leads with the
  project's name from its config: `Acme Service › worktree ACME-14`. The Needs
  you card reads `Acme Service · worktree ACME-11`, as the other cards put their
  project first.
- **Elsewhere,** a session reads as its repo's folder name, then the path inside
  it: `Acme Service`, `Acme Service › force-app/main`. The repo is the nearest
  folder up holding `.git`, a folder or a linked worktree's file. A builder's
  worktree under `.claude/worktrees/` reads as its repo's from the path alone,
  `Acme Service › worktree ACME-12`, though its own `.git` file would make it a
  repo. Outside any repo, a session reads as its folder's own name, or `~`.
- **The walk stops before the home folder and `/`.** A repo at `~` (dotfiles)
  would otherwise be every folder's repo, and every label would start `me ›`.
  The hub looks for `.git` once per folder each time `claude agents` answers,
  so a repo made since shows on the next poll.
- **Two folders of one name each add their parent folders until they differ:**
  `clients/Acme Service` and `personal/Acme Service`. The rule compares the
  folder that names a session, its repo or itself, across every session `claude
  agents` lists. So a worktree of one says which it is, `clients/Acme Service ›
  worktree ACME-40`, and a session reads the same in the table, on its page and
  on its card. Sessions in a project open here are named by their project and
  aren't compared. Two sessions in one folder share one label.
- **Folder or Full path, by a toggle with an icon and a label each,** that
  switches the Agents tab only. It sits just above the Where column's heading,
  on the right, outside the table. In the heading it set the column's least
  width: at 1000 px the row menu then covered Started, and at 500 px the toggle
  scrolled out of view. Folder is the default. The choice is kept in the
  window's workspaceState (`acc.agents.where`), as the section is, so it
  survives closing the Command Center and reloading the window. A stored value
  other than `folder` or `path` is ignored.
- **Full path shows the whole folder, with `~` for home.** Both views wrap a
  label too long for its cell, as the session names do (D-087), rather than
  clip it: beside the names and the Model column, a clipped cell kept only
  `worktree ACM…` at 1000 px, and clipping a path at its start cut its last
  letter. They break between words and after a slash, never inside a name or
  a key (`ACME-12` stays whole), and the cell has no minimum width, so a narrow
  tab never pushes the table under the row menu. Below 660 px the session's
  name stops taking all the room left over, so the columns share it. Hovering a Where cell shows the full path in either view, as do the
  folder on an agent's page and the Needs you card.
- Folder labels are names, not paths, so they're in the UI's font, on the
  Agents tab and the agent's page. Full paths stay in the code font.
- Not chosen:
  - The toggle switching the agent's page and the Needs you card too: a person
    decided they always show the folder in context, with the full path on
    hover.
  - Resolving a linked worktree's `.git` file back to its main repo. A linked
    worktree outside `.claude/worktrees/`, in a repo not open here, reads as its
    own folder.
  - The Worktrees tab's Location column, question and permission cards, and the
    acc CLI's output, which name worktrees and files, not sessions' folders.

## D-091 One tracker sign-in for every project on a site, unless a repo keeps its own (2026-10-07)

D-027 kept every tracker sign-in per repo, so one client's login never serves
another client's repo. So someone working on ten projects on one company Jira
site signed in ten times. The author wants coworkers to use one company tracker
across many projects without friction, and nothing company-specific in acc
(GH-79). This amends D-027, and D-085's monday.com sign-in, which was kept for
one repo only because its token sees everything.

- **A sign-in can be kept for its site**, shared by every repo on this machine
  that uses the same Jira site, Azure DevOps organization or monday.com
  account: `acc.cred:site:<kind>:<host>`, beside D-027's
  `acc.cred:<repo>:<kind>:<host>`. The host is the one the tracker's config
  names, lower case, with no scheme or trailing slash. Jira and Azure DevOps
  never share one, whatever the host. No repo key starts with `site:`, so the
  two never meet. Both stay in VSCode's secret storage on this machine, never
  in a repo, `.acc/config.json`, the page model, the log or the tab's saved
  state. GitHub is unchanged: it signs in through gh as the repo's account
  (D-007, D-028).
- **A repo's own sign-in wins**, then the site's, so a repo that needs another
  account keeps one. A sign-in kept before this is its repo's own, and keeps
  working. None is moved or promoted: one becomes shared only when someone
  signs in again with the tick.
- **The Connect page offers "Use this sign-in for every project on <host>"**
  under a sign-in that's typed or Microsoft's, never gh's. It's ticked the
  first time anyone signs in to a site. After that it starts where this repo's
  sign-in lives now (a person decided): ticked when the repo keeps nothing of
  its own (it has no sign-in yet, or uses the site's), unticked when it has its
  own sign-in or a "this project only" sign-out. Ticked, the sign-in goes under
  the site's key and the repo's own key is taken out, or the repo would go on
  ignoring what was just chosen. Unticked, it goes under the repo's key, and
  the site's stays for every other project. Once a person ticks or unticks it,
  that choice stays while the page is open: typing or changing the site doesn't
  put the default back, so an untick made before the site is typed still keeps
  the sign-in this project's. The tick's label is built from the host, so the
  page still names no tracker.
- **A new tracker on a site that already has a sign-in needs nothing typed.**
  Once its site parses, the page checks the sign-in this repo would use and
  fills the lists. Before, it looked only for an existing tracker's, so a
  second repo typed the token again. Test connection with nothing typed for a
  token looks too. Sign in with Microsoft never does: it always asks VSCode
  for a Microsoft sign-in, so it can't sign in with a token kept for the
  organization instead.
- **The page and the board say which sign-in is in use**: "Signed in as
  jordan@acme.example, for every project on acme.atlassian.net", or "…for this
  project only". On the board it's a line under where its tickets come from,
  with a globe or a repo icon, in place of the "as <who>" chip. GitHub keeps
  the chip.
- **Signing out of a shared sign-in asks**, in a modal: "Every project on
  <host>" or "This project only". Every project deletes the site's key and
  nothing else. This project only leaves it and writes a sign-out under the
  repo's own key, `{"kind": "jira", "signedOut": true}`, with no secret in it,
  where lookup stops. Neither touches another site's sign-in. VSCode's secret
  storage can't list its keys, so repos with their own sign-in on the site keep
  it, which suits D-027: those were chosen on purpose. The message says so.
- **Signing out of a repo's own sign-in doesn't ask** (a person decided),
  since no other repo uses it. When the site has a shared one, the repo falls
  back to it, and the message says "<project> now uses the sign-in for every
  project on <host> (<who>)." Signing out again and choosing This project only
  signs it out fully.
- **A sign-in or sign-out reloads every open project with a tracker on that
  site**, not only the one it started from. A change made in another window
  arrives through the secret storage's change event and does the same; keys
  this window just wrote are skipped, so they don't reload twice. Whether
  VSCode fires that event across windows hasn't been checked in a real
  two-window run. If it doesn't, other windows catch up on their next refresh.
- **The rules are pure functions in `logic.ts`** (`readCreds`, `credInUse`,
  `credWrites`, `signOutWrites`, `signOutPlan`, `siteCredKey`, `credSite`),
  tested against a Map. `signOutPlan` is how sign-out chooses: it asks only
  about a site's sign-in, and Cancel writes nothing. The Connect page's tests
  run them too.
- **The packaging scan reads site keys** (`parseSignIn`), so `npm run package`
  still finds the hosts of shared sign-ins. A site key has no repo.
- **What this costs D-027.** With the tick on by default, keeping two clients'
  logins apart on one site is a choice made per repo, not the default. A
  consultant whose clients share a site, signing in to client B's repo with the
  tick left on, makes that login every project's on the site, and client A's
  repo uses it unless it has its own. The tick's hint and the board's "for
  every project on <host>" line are the cues; untick it, or sign out This
  project only.
- **A shared Microsoft sign-in** keeps one account and the org's tenant. When
  its session ends, every project on the org needs signing in again at once,
  and the error names the scope: "The Microsoft sign-in every project on
  <org> uses (<account>) has ended."
- Not chosen: sharing across machines or an organization, or anything
  company-specific in acc (the CLI still never signs in to these trackers,
  D-066); listing or managing every stored sign-in; moving existing sign-ins;
  a sign-out button on the Connect page (D-073 keeps it a command).

## D-092 In progress on the Overview: every job under way, a group a task; heavy checks wait in line (2026-10-07)

GH-76. The author: "Can we develop an 'In Progress' page that shows each of the
currently running jobs, their statuses and relevant info, grouped per task?"
With five builders and two heavy-check slots (D-080), what was happening was
spread over the Agents tab, the output panel, cards and notices.

- **A section on the Overview, right below Needs you,** as the author suggested,
  with no page of its own. Its heading counts the groups with something under
  way. The rail's Overview badge still counts only what needs you, so a task can
  be in both: a stopped builder is in Needs you with Resume, and here as a row.
  It folds to its heading, kept per tab, as Setup's sections are.
- **What counts as under way:** a task in Running, whatever its builder's state,
  and any job for a task: an analysis, a review, a resume, a check holding or
  waiting for a heavy-check slot, autopilot's step, a land or a refresh.
  Promotions and deploys belong to an environment (D-034, D-075), so, as the
  author chose, each has a group of its own, "Promote dev → qa" or "Deploy dev",
  among the tasks' groups. A promotion's group names the tasks in its source not
  yet in its destination, as far as the ledger says. Groups go busiest first,
  then the longest running.
- **Each row** has an icon and words for its state, how long it has run, and
  what it's doing. A builder shows its session's state (Working, Waiting on you,
  Idle, Stopped, D-067), its latest tool step as its page tells it (D-057), its
  model from its transcript, or its setting until it has answered, and its
  branch's commits and files since its environment's branch, with files not yet
  committed. Orange is only for what waits on a person, blue for what's working,
  neutral for idle, in line or done.
- **Each row's actions:** Watch, Open in Claude Code, Answer, which brings its
  question in Needs you into view, and Stop where acc can stop it. Each says
  what it does on hover, and Stop asks first. As the author chose, Stop pauses a
  builder with `claude stop`: its task stays Running and shows its agent stopped,
  with Resume. It also ends a resume, and a command this window started.
  Autopilot's step offers Turn autopilot off, in the window that runs it (D-064).
  A land, a check, and anything another window or a terminal started have no
  Stop: ending acc leaves its child running, and another window's run isn't this
  one's to end.
- **The machine line:** heavy checks in use and free, and how many wait, with who
  holds each slot and who's in line on hover; builders running out of
  `agents.max` for each repo, where projects sharing a ledger are one repo; and
  the load in words, from the last minute's load average per core: below 0.7
  calm, below 1.5 busy, more very busy. Where it reads 0, as on Windows, it says
  nothing rather than calm.
- **A heavy-check slot says what holds it.** Its owner file carries what it runs,
  its task, its project and its folder, or the environment for a deploy, a
  promotion's validation, a drift check or a baseline retrieve. `acc gate run`
  names its task (`ACC_TASK`, else its branch's task), and a refresh names its
  own. An older acc writes only its pid: the line calls it a check from an older
  acc, and it's in no group.
- **Heavy checks wait first come, first served,** as the author chose. A check
  that has to wait writes itself under `~/.acc/heavy/waiting/`, touches the file
  each poll, and takes a free slot only while fewer live waiters came before it
  than there are free slots. A waiter whose process has gone, or that hasn't
  touched its file for 15 seconds, loses its place. Until now, whichever check
  looked first after a slot freed took it. An older acc doesn't join the line,
  so it can still take a free slot ahead of it.
- **Jobs mark themselves under way:** a land, a refresh, a promotion, a deploy and
  autopilot's step each write `jobs/<key>.json` beside the ledger, with their pid
  and start, and remove it however they end. acc writes; every window reads
  (D-012), whichever window or terminal started the work. Autopilot's step stands
  for the land, refresh or review it runs: one row, not two.
- **Live:** a jobs poll beside the tasks poll, every 3 seconds on screen and 15
  hidden (D-044), of stats and small reads. A builder's transcript tail is read
  only when it has changed, and only on screen; branch counts run in the
  worktrees poll, which runs only on screen, for running tasks only. The page
  redraws when something changed, and every 15 seconds while anything is under
  way, so its times move on.
- **A job that ends** leaves a one-line done row, such as "Review finished:
  passed", which fades over a minute and goes. Its age is the extension's clock:
  the fade starts that far in, so a redraw never restarts it. Nothing ends on the
  first look after VSCode opens. A group with nothing left in it leaves.
- Not chosen: a page of its own; reading Claude Code's own job files (D-067);
  live output for a check, whose log is written when it ends; the reviewer's and
  analyst's models; changing `agents.max` or the heavy-check slots from here.
- The analysis had a refresh running its checks in a temporary worktree. It runs
  them in the task's own worktree, and names its task all the same. Its "merge"
  is autopilot's refresh (D-058) and, where a repo turns it on, autopilot's merge
  of a pull request (GH-67), each shown as autopilot's step.

## D-093 Two tasks that change the same files take turns, where another task can go first (2026-10-06)

The author wants more builders at once (D-080). Two tasks that change the same
files at once end in a merge conflict: four of seven merges on 2026-10-06 needed
a person. Each task's analysis already lists the files it plans to change
(GH-72).

- **What's compared.** Before a first dispatch, acc compares the files the
  task's analysis plans to change (`approach.files`) with every task in flight.
  A task in flight counts what its analysis plans and what its branch has
  changed since it left its environment's branch: commits, and in its worktree
  uncommitted and untracked files. A rename counts as both paths. Paths are
  made repo-relative (an absolute path under the repo, a leading `./`, a glob
  as the folder before its wildcard), and match when they're the same file or
  one is a folder holding the other.
- **In flight** (a person decided): running, in review, rework or blocked with
  a branch, until its change merges, since the conflict comes at the merge.
  Merged means done, its pull request merged, or a pull request was opened and
  its branch is now an ancestor of origin's copy after a fetch. A squash merge
  waits for `acc sync` to mark it done.
- **Prefer, don't block** (a person decided). Matched file by file, nearly
  every pair of this repo's tasks overlaps (the docs, `logic.ts`, `model.ts`,
  `main.ts`), so holding on every shared file would run about one builder at a
  time. A task that shares files waits only while another Ready task shares
  none, which a person can start first. When nothing else is ready, it starts
  anyway, and its run records which files it shares with which task. The merge
  queue (GH-73) takes the rest.
- **Files every task edits never count:** `autopilot.appendOnly` (D-058), and
  a new `dispatch.shared` list in `.acc/config.json`, empty by default so the
  core names no project's files (D-003). This repo lists `docs/DESIGN.md`,
  `README.md` and `CHANGELOG.md`, and `docs/DECISIONS.md` is append-only.
- **A task with no analysis**, or one that names no files, never waits, and
  never counts as one sharing none. Nothing in flight is looked at for it. Its
  Ready card says its files aren't known, in a neutral tone, and which of the
  two it is. Its branch's files still count when others are weighed against
  it. A rework's re-dispatch never waits: its branch already holds its change.
- **A wait is a hold, not a refusal.** `acc dispatch <id>` records `held` on
  the task (who asked, when, what it waits for and what goes first), creates
  nothing, exits 0, and says "GH-73 waits for GH-70's files: …". `--json` gives
  `{ held: true, waitsFor, first }`. It stays in the Ready lane; there's no new
  state. Any move ends a hold, as does `acc dispatch <id> --stop-waiting` or
  Stop waiting behind ⋯.
- **It starts on its own.** `acc dispatch --held` starts each held task that
  may go: one sharing nothing first, oldest hold first, then one whose
  alternatives have gone, weighing the rest again after each start, under
  `agents.max`. Each is claimed in the ledger before its builder launches, so
  two windows and autopilot never start one twice; a claim older than 10
  minutes is stale. The Command Center runs it when its board says a held task
  may go, at any autonomy: the person's Dispatch click was the consent. It asks
  at most every 30 seconds a project. While acc keeps saying the same tasks wait
  and the board sees nothing change, it asks half as often each time, up to
  every 10 minutes, since each ask fetches and the board can't see everything
  acc checks (a branch merged on origin, a protected environment). A start
  that fails is written on the hold, the task needs you (orange, the bell, the
  reason), and nothing tries again until a person acts.
- **Autopilot's `start` step.** This amends D-055's "it never starts a task
  that's to do": autopilot now starts a held task, as the Command Center does,
  and still never starts one nobody dispatched (autonomy dispatch stays
  unbuilt). History and notices say "Autopilot started GH-73: GH-70's files are
  free", or that nothing else was ready, so it shares files with GH-70. A
  failure says "Autopilot couldn't start GH-73: …", with Dispatch anyway.
- **Dispatch anyway** (a person's only, as all of `acc dispatch` is). In the
  Command Center, Dispatch on a task that would wait first asks, naming each
  task and its files in full: "Wait for GH-70" or "Dispatch anyway". A held
  card's one next step is Dispatch anyway, behind a confirmation naming the
  overlap. A dispatch that shares files records them on its move, and
  `acc dispatch <id> --anyway` adds `anyway` only when it overrode a wait.
- **In words, with an icon.** A held card says "Waits for GH-70's files: …,
  while GH-74 is ready to start" with a clock, in blue: three file names in
  all, short, at least one a task, and two of the tasks that go first; the
  task page names every file and task in full, and its State says "Waits for
  GH-70's files". A task sharing files, to do or started beside another, says
  "Shares files with GH-70: …", neutral. The Command Center works this out
  from git on the worktree poll, only while a task is Ready or held, one call
  at a time. acc's answer at dispatch is final.
- Not chosen:
  - Holding on every shared file, as the ticket first said: one builder at a
    time on this repo.
  - Holding only on files outside a list (`dispatch.shared` alone): code files
    such as `logic.ts` would still serialize most tasks.
  - A new display state or lane for held tasks, or counting them toward
    `agents.max`.
  - Predicting conflicts by hunk, or resolving them with an agent; holding
    dispatches for the agent cap; a merge queue (GH-73).
- **From its review:** a Ready task in a protected environment, or one not in
  the config, never goes first: acc wouldn't start it there (envNotProtected),
  so a task waiting on it would wait for nothing. A person's own dispatch of a
  held task claims it first, as a held start does, so the two never both
  launch, and lets the claim go if the launch fails. Dispatch anyway, offered
  after acc holds a dispatch, names the overlap acc reported, not the board's
  guess.
- **The author confirmed the wait as built** (2026-10-07): a person's Dispatch
  of a task that shares files waits while another Ready task shares none, even
  though nothing starts that one on its own yet, because the Dispatch modal
  asks first (Wait for GH-x, or Dispatch anyway) and the CLI takes --anyway.

## D-094 A rework a person sends back tells its builder why (2026-10-07)

GH-80 came back from two reworks with no commits. Its review had passed, and
a person moved it to rework with a list of fixes (`acc set <id> rework
--reason …`). The packet shows a review's findings only when the review asked
for changes, so the builder read a passing review, found nothing to fix, and
finished.

- **The packet quotes the person's reason** under "Why a person sent it back",
  before where the builder works, whenever the task's latest move into rework
  was a person's and gave one. A reviewer's send-back keeps its own section,
  and autopilot's checks send-back its own (D-076).
- Not chosen: copying the reason into the review's verdict, which is the
  reviewer's record, not a person's.

## D-095 A finished task's leftover session reads as Finished, and can be stopped (2026-10-07)

GH-93. The author's Agents tab listed four sessions under "Elsewhere on this
machine" in orange as Needs you, for tasks done long ago. A builder's background
session stays listed after its last turn, and Claude Code says it waits. Nobody
waits on it, but it counted toward Needs you everywhere.

- **Finished** is acc's word for a session whose work is over by the ledger: the
  builder of a task that's done; a builder of an earlier run of its task; a
  reviewer whose verdict is recorded; an analyst whose analysis is the task's
  current one. acc never carries an earlier run on: a re-dispatch starts a new
  background session, and Resume carries on only the current run (D-067). So an
  earlier run's builder is finished while its task runs again.
- **How it reads:** a check and a muted "Finished", on the Agents tab, the agent's
  page and the Overview, with no orange edge. It never needs you: not in the
  Agents tab's count or the rail's badge, the Overview's Needs you or its badge,
  the launcher's or the status bar's. The Agents header counts it apart, "5
  finished". One that's busy, or has a question waiting in the Command Center,
  keeps that look. It isn't Claude Code's own "Done", which says a background
  session ended its turn; Finished says acc knows its work is over, whatever
  Claude Code says about it.
- **Tied by ids only (D-087).** A task's current builder is found as `sessionsOf`
  finds it. Earlier runs are read from events.jsonl: each dispatch's run, and a
  session its builder's SessionStart linked to the run. That file is never
  trimmed, so the first look reads all of it, once a window, and each look after
  reads what was added. A run that recorded no ids, a task no longer in the
  ledger, and an analyst whose analysis was replaced leave a session untied.
- **Untied sessions read as Claude Code says,** as before. So do a task's current
  builder while the task isn't done, and a review or analysis under way. The
  current builder of a task in review or in rework has run acc done and may sit
  waiting at its prompt; the author chose to leave it as it reads for now.
- **Elsewhere on the machine:** a session is tied through its own repo's ledger,
  wherever the repo is. Its folder's repo is a builder's worktree's by its path,
  as its folder reads (D-090), else the nearest folder holding .git (GH-83). A
  linked worktree's .git file is followed to the shared git folder through
  `gitdir:` and `commondir`, with plain file reads, never git, for the ledger
  only: how its folder reads doesn't change (D-090). Each ledger, its events, its
  reviews and its analyses are read again only when one changes, since `claude
  agents` is asked every 5 seconds while the page is on screen.
- **Stop finished sessions (N)** sits on the Agents header while there are any. N
  counts finished background sessions that Claude Code still holds: one with a
  process, or one still listed without one. The author's four had lost their
  process and were still listed, blocked, so a count of processes alone would
  have offered nothing: checked on 2026-10-07, when `claude agents` listed
  GH-11, GH-13, GH-41 and GH-60 as background sessions, blocked, with no pid. One already done, stopped or failed with no process has
  ended, and isn't counted. It asks `claude agents` again, lists each by name and
  folder in one dialog, and asks once. Then it asks `claude agents` again and runs
  `claude stop` for each that is still finished, one at a time, and says which
  stopped and which couldn't. Transcripts and worktrees are kept. It never stops a
  task's current builder while the task isn't done, a review or analysis under
  way, an untied session, an interactive one, or one that's busy or asking.
  Reviewers and analysts run as `claude -p`, listed as interactive: they read
  Finished, and Stop leaves them. A row's own Stop is as it was.
- Not chosen: stopping a builder on acc done, land or merge; tying a session by
  its name; naming a session elsewhere for its task, or linking its page to it;
  a Stop for interactive sessions.

## D-096 A merge queue: passing pull requests are refreshed, checked once and merged in turn (2026-10-06)

With auto-merge (D-083), passing pull requests merged on their own, but each
merge moved main, and the next pull request then conflicted or broke: it took a
refresh, a review and a land of its own before its merge, one merge a pass.
The author wants full swarming (D-080), and chose a merge queue (GH-73).

- **Where.** Only where auto-merge covers a task's environment: auto-merge on,
  autonomy review, an environment that isn't protected, never in a Salesforce
  project. Elsewhere nothing changes: no field is written, and gates, packets,
  refresh (D-058) and the merge behave as before.
- **Joining.** A task joins its repo's queue on the first autopilot pass that
  finds it ready: in review, its review passed on its latest commit, its open
  pull request landed there, GitHub's checks green (or none, after D-083's 2
  minutes), no person asked for changes, no agent in its worktree is waiting for
  a person's answer, and nothing under `.acc/` changed (one that did is
  recorded, as in D-083). Being up to date with its base isn't asked, and
  neither is a conflict: the queue sees to both. A pull request that conflicts
  gets no checks at all, since GitHub runs no `pull_request` workflows until it
  can make the merge, so one that conflicted from its land doesn't wait for
  checks that won't come: it joins at once, and its turn merges the base in and
  pushes a commit they run on. The ledger keeps `autopilot.queued` (when, at
  which commit, the head's phase, and, held, why). One queue a repo, across its
  environments, in the order tasks were ready, ties in ledger order.
- **Keeping its place, and leaving.** Waits that settle by themselves keep a
  task's place: GitHub's checks running, gh not answering, none reported yet.
  Anything that waits on a person makes it leave: a person asking for changes,
  an agent in its worktree asking something, a failed step, a review that didn't
  pass. So does a move, a merge, or a new commit that isn't the queue's own.
  Ready again, it joins at the back.
- **A pull request someone pushed to on GitHub**, such as with Update branch, is
  at a commit acc didn't land. Its checks there say nothing of the landed one,
  and waiting for GitHub to come back to it would hold the queue for good, so
  it doesn't wait: it takes its turn, which fetches its branch first, and a
  commit this clone lacks makes it need you, with nothing merged or pushed. The
  next task is the head on the next pass.
- **A place counts only while auto-merge covers the task.** Switched off, or
  under another autonomy, no autopilot may run to clear `autopilot.queued`, so
  everything that reads the queue asks the config too: such a task is in no
  queue, and a pull request of its that conflicts needs you again, in orange.
- **The head's turn.** Only the head takes one, after every other task in the
  pass, so a long check doesn't hold up that pass's reviews and lands. The rest
  wait behind the task ahead of each, and make no git, gh or check call for the
  queue. At its turn:
  - if origin's base has commits the branch lacks, the base is merged in, in its
    worktree, by D-058's rules (append-only files, rerere off, the repo's commit
    identity). refresh.ts is split into `mergeBaseIn` and `checkCommit`, so a
    conflict and a failed check are told apart; `refresh` is the two together,
    for conflicts only, as D-058 had it: the `behind` option D-083 gave it is
    gone, since the queue brings a pull request up to date.
  - `gates.required`, the full check, runs once on the result, in a heavy-check
    slot (D-080), unless it already passed on that commit. The slot names the
    task, and the check waits in D-092's line like any other; the turn is marked
    under way as autopilot's step, which In progress words as taking its turn in
    the merge queue.
  - a merge commit is pushed to the same pull request, as the orchestrator, and
    the next turn after GitHub's checks pass on it merges it. One that was
    already up to date merges at once, with `gh pr merge --match-head-commit`
    (D-083).
  - one merge a pass, the head's. The next head starts from the base it left.
- **A clean merge carries its review** (a person decided). A merge commit the
  queue made cleanly, or by keeping both sides' additions to an append-only
  file, carries the passing review of the commit it was made on, plus its own
  full check: `autopilot.carried` says so, and it's no new verdict. `reviewedAt`
  is the one place land and the merge accept it, so nothing is pushed or merged
  without a passing review (D-033). The Command Center reads it the same way
  (`reviewCurrent`), so the task's card and page don't show the review as out
  of date once the queue pushes its merge. Autopilot resolves no other conflict, so a
  merge that needed a real resolution never reaches a push: it goes back to the
  builder. The pull request's description says the review was of the commit
  before the merge.
- **Leaving for its builder.** A conflict autopilot can't resolve, or a full
  check that fails, puts the branch back as it was (worktree clean, nothing
  pushed), and the orchestrator moves the task review → rework with "The merge
  queue sent it back: …". What it found is kept at
  `<state>/queue/<task>-<sha>.json`: the conflicting files, or each failed gate
  with the end of its log. The packet's "What the merge queue found" says how to
  merge the base in and resolve them, or what to fix. Builders may run
  `git merge origin/<env>` in their own worktree: the Never line now forbids
  merging a pull request, not the base, and where the queue runs their settings
  allow exactly their own base, `git merge origin/<their environment>`, with or
  without flags such as `--no-edit`. Any other branch, and anywhere else, a
  Salesforce project above all, a builder asks first, as before.
- **One limit for autopilot's send-backs** (a person decided). The queue's and
  GitHub checks' (D-076) share it: once a commit, 3 a task, apart from D-055's
  one re-dispatch of a review's rework. `sentBack.kind` tells them apart; one
  without a kind is checks'. Past it, or where a check that failed was waived on
  the commit before (a waiver holds for its own commit, D-031), the task needs
  you. So does anything else that stops a turn: a dirty or missing worktree,
  origin's branch ahead of the clone's, a heavy-check slot that stayed taken
  (D-069), a push that failed. Each is recorded as `queue`; a failure in the
  merge itself (GitHub BLOCKED or DIRTY, gh refusing) as `merge`, as D-083 did.
  History and notices say which: "sent back to its builder from the merge
  queue: …", or "couldn't take it through the merge queue: …".
- **Builders run lighter checks** (a person decided). `gates.builder` names
  them, where the queue runs the full check: `acc gate run` with no names runs
  them, and `acc done`, `acc review` and `acc land` take them. The full check
  passing on a commit covers them. Left out, or where the queue doesn't run,
  builders run `gates.required`, so a repo keeps the full check for its builders
  by naming none. Command gates get `ACC_CHANGED` and `ACC_NEAR_TESTS`: what the
  branch changed, and the tests near it (the tests it changed, and those in the
  same package named for, or importing, each file it changed), one path a line.
  This repo's builders run `typecheck` and `near-tests`
  (`scripts/near-tests.mjs`, which builds first when a near test reads the
  build); all three gates take a heavy-check slot, so they don't stutter the
  machine together.
- **In words.** The Overview has a Merge queue panel for each project with one:
  each pull request's place, its task, its link, and what it waits on, in blue
  with an icon: the head's phase (Next to merge, Merging main in, Waiting for a
  heavy-check slot, Running the full check, Waiting for GitHub's checks,
  Merging), Behind <id> for the rest, and Autopilot is off when it doesn't
  move. Waiting for GitHub's checks is only for a wait on them: a head held on
  anything else, such as GitHub working out whether it can merge, or gh not
  answering, says that wait in its own words, as much as fits, and all of them
  on hover. Orange stays for needs you, which a task in the queue never is: a
  conflict in the queue no longer shows as needs you. `acc show` says "In the
  merge queue: 2nd of 3, behind GH-12", `acc gate list` marks builder gates, and
  the task page marks each check builder or merge queue.
- This amends D-058: with auto-merge on, a pull request isn't refreshed when it
  conflicts, but at its turn in the queue, and a clean merge isn't reviewed
  again. It amends D-076: its 3 send-backs are shared with the queue's. It
  amends D-024: a commit's checks have two scopes, a builder's and the merge's.
  It amends D-083: a pull request only behind its base isn't refreshed, reviewed
  and landed before its merge, and "one merge a pass" is the queue's head's.
  DESIGN.md §19 no longer leaves out a merge queue.
- A pull request a person merges by hand where builders run lighter checks has
  had only those, unless the queue ran the full one: its description's checks
  say which ran.
- Not chosen:
  - GitHub's native merge queue or `gh pr merge --auto` (D-083's reasons hold).
  - Checking several pull requests together, or speculatively.
  - Letting a person reorder the queue, or a separate queue per base branch.
  - Running the queue as a process of its own, outside autopilot's pass.
  - A new Slack notice kind: Needs you covers a task leaving the queue for a
    person.

## D-097 A team template starts a project; acc ships none, and never re-applies one (2026-10-06)

The author wants coworkers to start projects the same way, with the team's
tracker, profile, environments and checks, without acc knowing whose team it is
(GH-80). `acc init` and Setup discovered settings from the repo and the
machine, and each person typed the rest.

- **A team template is a JSON file the team keeps,** wherever it keeps things,
  and acc fetches it only with gh and git: a GitHub file URL
  (`github.com/<owner>/<repo>/blob/<ref>/<path>`, or
  `raw.githubusercontent.com/…`), `<git-url>#<path>` for any git repo, or a
  path on this machine. docs/TEMPLATES.md shows a sample, ACME's (D-079): acc
  ships no template, not even that one.
- **What a template may say:** `schema` (1), a `name` and `description`, the
  `profile`, `environments` (name, type, default, protected, promotesTo),
  `gates` (required, commands, heavy, severity), one `tracker` (its kind, its
  place: a Jira site, an Azure DevOps organization or a monday.com account, and
  a default project, or a monday.com board; an Azure or monday.com prefix),
  `autonomy` and `agents` (max, and builder and reviewer's model, effort and
  fallbackModel). Values are checked by the config's own rules, D-015 and
  D-018's for environments included.
- **Every other key is refused, by its dotted path** (`gatez`,
  `agents.builder.efort`), not warned about as the config's are: a typo in a
  file a whole team uses would quietly drop a rule. The error says to update
  acc, for a template written for a newer one. Keys that belong to one
  project's config (github, commitIdentity, worktrees, secretScan, an org
  alias, agents.permissionMode, a tracker's edits, epic, labels or area path)
  are refused as that. agents.permissionMode is one of them so that a fetched
  file can't loosen what builders may do. A key that looks like a sign-in
  (token, apiToken, password, pat, email, secret…) is refused as one, at any
  level: sign-ins stay on the Connect page (D-027, D-073).
- **Precedence:** explicit flags, then the template, then discovery, then acc's
  defaults. `--jira-project` replaces the template's project; a `--profile`
  that disagrees with the template's is refused, naming both. A Jira or Azure
  tracker with no project, or a monday.com one with no board, is left out with
  a note pointing at the Connect page. Gate commands the template adds run on
  every coworker's machine, so they're listed before anything is written by
  Setup's confirmation, `acc template show` and `acc init --from … --dry-run`.
  `acc init --from` without `--dry-run` writes first and lists them in its
  output; the config is reviewed before it's committed.
- **A Salesforce template meets the client's real orgs** (a person decided).
  Production's sandbox list decides which environments exist and their types.
  For each sandbox the template names (by lower-case name, D-015), the
  template's promotesTo, default and protected win; a promotesTo naming an
  environment that doesn't exist is dropped, with a note, and when the
  template's default doesn't exist, discovery's default stays. A template
  environment with no sandbox is left out, with a note. A sandbox the template
  doesn't name keeps acc's usual path, with a note. A generic project takes
  the template's environments as they are.
- **A template may start a project at autonomy manual or review** (a person
  decided), the two that `acc agents autonomy` offers. dispatch and full are
  refused in a template. This amends D-014's "starts at manual": a team can
  agree on review for its projects. Nothing auto-merges because of a template:
  `autopilot` isn't a template key, so auto-merge stays a project's own choice
  (D-083).
- **The project records where it came from:** `"template": { "name",
  "source", "digest" }` in .acc/config.json. The digest is sha256 of the
  template's JSON with its keys sorted, so whitespace and key order don't
  change it. A local source is recorded as `~/…` under the home folder, or
  relative to the repo inside it, so no home path is committed.
- **B0.template says when the template changed, and never applies it** (a
  person decided how loudly). It doesn't apply without a record. It passes
  while the digest matches, and when the template changed but this project
  already agrees with it. When it changed and the project disagrees, it's
  Check by hand, naming the keys that differ, with `acc init --from '<src>'
  --dry-run` to preview. A tracker agrees when the project has one of the
  same kind at the same place: its project may differ, as `--jira-project`
  allows. It can't read the template: Check by hand, with the reason; a local
  file that isn't on this machine: Doesn't apply. It waits 20 seconds at most
  in all: a GitHub or git template takes two calls, which share one deadline.
  It reads a GitHub template as the account in the project's `github`.
  Accepted: "I've done this" is kept by step id, so it hides later changes
  too. Re-applying is only ever a person running `acc init --from … --force`.
- **Setup's "What kind of project is this?" offers "From a team template…"**,
  with the last 5 sources used on this machine, newest first, then "Another
  path or URL…". It reads the template with `acc template show --json`, shows
  a bad one's errors and writes nothing, and asks before starting, showing
  the name, description, what it sets and its check commands. A template that
  sets no profile goes on to "Salesforce or Other", and acc init gets the
  answer as `--profile`. A Salesforce one goes on to the Production org pick.
  The list is the extension's machine-wide state (`acc.recentTemplates`),
  sources and names only.
- **A template with no profile leaves an environment's type to the project**
  when it gives none: null in the template, Production's sandbox list in a
  Salesforce project, `none` in another. So `--profile salesforce` notes only
  a type the template gave that Production's list contradicts.
- **Refused sources:** a URL with a sign-in in it (`https://user:token@…`), a
  plain `http://` URL, any other web address (acc doesn't fetch without gh or
  git), a source that starts with `-`, and a file over 64 KB. A committed
  config's source reaches git on every Setup refresh, so git clone also gets
  `--` before the URL. git runs with no prompt (GIT_TERMINAL_PROMPT=0, ssh in
  batch mode), in a temporary folder that's always removed. A
  raw.githubusercontent.com URL may carry `refs/heads/` or `refs/tags/` before
  its ref, as GitHub's Raw button links it.
- **One account reads a GitHub template, for `acc template show` and `acc init
  --from` alike:** `--github-account`, else the account the repo pushes as
  when its origin is on GitHub, else gh's active one, through GH_TOKEN, never
  `gh auth switch` (D-007). A `--github-repo` with no GitHub origin doesn't
  pick it. So Setup's preview and the acc init after it read as the same
  account.
- Not chosen: merging a changed template into a config; inheritance or
  layering; a template gallery or editor; formats other than JSON; templates
  setting analysis, autopilot, worktrees or the secret scan.

## D-098 Research stays local, and the repo depends on no other repo (2026-10-07)

The author's rule: research and supporting notes are for building the tool, not
part of it.

- `docs/research/` is gitignored. The 1 October landscape review is untracked
  and kept on disk, and D-001 now says what it found instead of linking to it.
  Earlier copies stay in git history. That includes the PhotoCraft review,
  which 3af9b78 committed by mistake and 204ce9b untracked.
- Nothing committed links to a local-only note. Issues, packets and docs carry
  their own reasoning.
- The repo depends on no other repo for tools, and other repos shouldn't depend
  on this one's files. Anything taken from elsewhere is copied in, with a note
  of where it came from and when. It's updated only when a person chooses.
  GH-80's team templates already work this way, and GH-108 makes shared rules
  work the same way. This extends D-002 from skills to everything.

## D-099 Each area's code lives in its own module, and registers itself (2026-10-07)

GH-94. Nearly every merge on 2026-10-06 and 10-07 conflicted in the same few
files, each holding every area of the Command Center: of 21 merges, the
extension's model.ts was in 18, logic.ts in 18, the webview's main.ts and the
CLI's main.ts in 14. One merge conflicted in 24 files. Parallel builders
rarely touch the same area, but every area lived in the same file.

- **One module per area.** The CLI's commands are a module per help section
  (`packages/cli/src/commands/`), the extension's view models
  (`extension/src/model/`) and decisions (`extension/src/logic/`) a module per
  area, and the page (`extension/webview/`) a module per section, tab or part.
  Each folder has a small shared module for what several areas use. DESIGN.md
  §2 says where each area's code lives.
- **No list every feature has to edit.** Where something must name every
  area, each area says so in its own file, as `export const area`: the CLI's
  command table, options and help lines; the page's message checks and the
  acc.* commands it may ask for; what an area adds to the Overview, its tiles
  and the rail; the webview's sections, tabs and hooks; the VS Code commands
  each area registers and the page's messages it takes. `scripts/areas.ts`
  writes each folder's index of its area modules, headed "Generated … Don't
  edit it". npm run build runs it first, the indexes are committed because
  typecheck runs before the build, and `scripts/test/areas.test.ts` fails when
  one is stale.
- **What still names every section** is the page's table of contents: the
  sections and their titles (`model/shared.ts`), the section models a
  `HomeModel` holds, each section's Refresh in `panels.ts`, and the union of
  the page's models. A new section edits those, besides its own modules; a new
  feature in a section doesn't.
- **Order is explicit.** acc help's sections go in the order of their first
  group's `order`, and a section's groups by theirs. The Overview's Needs you
  goes area by area in each area's turn, a project at a time, then the items
  that aren't a project's, then by tone, as before; tiles carry their own
  order. File order never decides anything.
- **Moving code changes nothing it does.** `acc help`, its usage errors and
  exit codes are byte for byte the same, from source and from the built acc;
  the page takes the same 34 message types and allows the same 58 commands;
  core's index exports the same names; the D- and GH- references in the code
  are the same 1,331. Tests changed only where they import from, or the file
  they read the source of.
- **Areas import shared modules and each other, never an index**, so an index
  loading its areas never meets itself. There are no import cycles at run
  time. Tests import area modules directly, not a barrel, so GH-73's
  near-tests gate finds them by the file they test.
- **Modules node:test loads stay free of vscode.** The extension's areas that
  are also pure (`slack.ts`, `progress.ts`, `connect.ts`) take VS Code's API
  from the parts activate() hands every area, rather than importing it. The
  page's allowed commands sit with the model's areas, which node:test can load,
  so a test checks each is registered.
- **Core splits by concern, with its exports unchanged.** dispatch: the packet
  and the builder's settings (`packet.ts`), starting held tasks (`held.ts`),
  holding and claiming one (`holding.ts`), and the start and cleanup, which
  share the git helper and the checkout lookup (`dispatch.ts`). autopilot: its
  rules (`autopilot-rules.ts`), its log (`autopilot-log.ts`), and its mode and
  pass (`autopilot.ts`). `isTrusted` stays in dispatch.ts: dispatch checks it
  too, not only onboarding.
- Not done here: GH-73's near-tests gate doesn't find cli.test.ts for a change
  in `packages/cli/src/commands/`, since the tests run main.ts; a follow-up
  counts a folder module as near its entry's tests. Splitting the fixtures,
  styles.css and the big test files by area, and generating core's index.ts
  and package.json's command list, are a second follow-up.

## D-100 A folder's modules are near what loads them, and the files every task touched follow the areas (2026-10-07)

GH-95, which GH-94 (D-099) left. In the 21 merges before GH-94, six more
files conflicted almost as often as the hub files: the screenshots' fixtures in
16, logic.test.ts in 13, package.json's command list and styles.css in 11,
tabs.test.ts in 10, core's index.ts in 8.

- **A file a folder's index gathers is near the tests of that index and of
  what loads it.** An index is a file that imports the changed file and more
  than half the other code in its folder; what loads it is other code in the
  package that imports it by its path. So `packages/cli/src/commands/tasks.ts`
  is near cli.test.ts, which runs main.ts, an extension area near
  activate.test.ts, and a module of core near only its own tests, since
  nothing in core loads core's index. A package starts at its `src`, `lib` or
  `app` folder, else at the nearest folder with a package.json, so the page's
  modules in `extension/webview/` are near `extension/test/`. It's general, not
  this repo's layout: any repo with index files gets it.
- **acc reads each file once, and only for a gate that reads
  `ACC_NEAR_TESTS`**: one whose command names it, or names a file in the
  checkout that does. The typecheck and the full check no longer wait for it.
  A check never inherits `ACC_CHANGED` or `ACC_NEAR_TESTS` from the acc it runs
  under. This repo's `scripts/near-tests.mjs` fails when it isn't given the
  list, rather than pass having run nothing, and has a test of its own.
- **Split by area:** the fixtures into `extension/scripts/fixtures/`, the two
  test files into a file per area with a `support.ts`, styles.css into what
  every area shares and a `<module>.css` beside each module of the page.
  DESIGN.md §2 says where each lives.
- **Generated:** core's index.ts, by `scripts/areas.ts`, `export *` from each
  module by file name, with the four that give only some names in a named list
  (`CORE_INDEX`), which a test pins; package.json's commands, from
  `extension/commands/<module>.json`, named for the module that registers
  them, by `extension/scripts/generate.ts` beside the walkthroughs.
- **The styles' order is their names now**, so moving rules out of one file
  could change which rule wins. Every element's computed style, with its
  ::before and ::after, on all 33 sample pages, dark at 1000, 620 and 500 px
  and light at 1000, matched the original styles.css once two classes two
  areas share, `.history` and `.composer`, went to styles.css. Where a render
  changed with the clock (a fold toggle measured late, In progress's fading
  line, the icon font still loading), a second render matched. A rule two
  areas need belongs in styles.css; a `.css` named for no module of the page
  fails the build.
- **Nothing a person sees changed:** acc help is byte for byte the same; the
  .vsix contributes the same 83 commands, field for field, in a new order; every
  sample model the screenshots draw is the same with the clock held still; the
  tests moved whole.
- Not done here: the screenshot script still lists every page it draws
  (`PAGES`, `sampleModel`), and a test that reads the page's source by
  `pageSource()` is near no single module of the page.

## D-101 Settings is a section, and acc's pages can be Light, Dark or Match VSCode (2026-10-07)

GH-109. The author asked for a Settings page in the Command Center, with a
light and dark toggle. Its analysis split it into six tasks; this is the first,
and GH-110 to GH-114 fill the rest. It amends D-089.

- **Settings is a section of the Command Center,** last in the rail and the
  sidebar launcher, with a gear, opened by `acc.open.settings` and refreshed by
  its header's Refresh. D-089 turned down "a separate settings page" because it
  would take you away from the sessions; a section is one click in the rail, and
  the Agents page keeps its Settings button. Once GH-110 moves How agents run
  into Settings, that button opens Settings' How agents run part. Until then it
  opens How agents run in place, as D-089 says.
- **A part for each task that fills it,** in their order: Appearance (GH-109),
  How agents run (GH-110), Limits and checks (GH-111), Trackers and sign-ins
  (GH-112), Notices in Slack, GitHub accounts and the Command Center's own
  preferences (GH-113), and About (GH-114). Each has a heading another page
  opens Settings at, with `show('settings', 'settings:<part>')`: it scrolls into
  view and takes focus. Until its task lands, a part says where its settings
  live today, with a button there; Limits and checks, set outside the Command
  Center today, says where and has no button. No control does nothing.
- **The theme is Match VSCode (the default), Light or Dark,** for acc's own
  pages only: the Command Center, task pages and agent pages. VSCode keeps its
  own theme, and so do the status bar and the sidebar launcher.
- **It's the setting `agentCommandCenter.theme`, of machine scope.** Settings
  Sync leaves machine settings alone, so it stays on this machine, and
  `onDidChangeConfiguration` tells every window, which globalState can't. A
  later per-machine choice, such as GH-113's refresh pace, is kept the same way.
- **`<html data-theme>` carries it,** always `vscode`, `light` or `dark`, so the
  choice is readable even when it's Match. It's on `<html>`, not `<body>`,
  because VSCode sets its theme's `--vscode-*` variables inline on `<html>`.
  `htmlFor` writes it into each tab's HTML. A tab on screen is told by a
  `theme` message and restyles in place, so nothing typed or scrolled is lost;
  a hidden tab's HTML is written again, at once or as it goes out of sight,
  since VSCode rebuilds a hidden tab from its HTML.
- **Light and Dark are complete palettes in `extension/webview/theme.css`,**
  which the build joins into the page's one stylesheet and the screenshots
  read. Each colour is `!important`, to beat VSCode's inline variables, and
  each palette sets `color-scheme`. They're the colours the screenshots drew
  with, plus the sixteen VSCode's own webview stylesheet reads (links on hover,
  code, quotes, keys, scrollbars, find highlights), copied from VSCode 1.139.0
  with where they came from (D-098). Fonts aren't in them: they stay VSCode's.
  The logo and the board menu's shadow follow the page's theme, not VSCode's.
- **Checked both ways.** A test checks the palettes set exactly the colours
  the pages and VSCode's stylesheet read, that only theme.css writes colours
  (but the masks and one fallback, pinned), and that nothing else keys on
  VSCode's body classes outside `[data-theme="vscode"]`. Each screenshot forces
  its theme under VSCode's other theme, so a leak would show, and
  `npm run screenshot -- --colours` compares every element's computed colours
  across themes in headless Chrome: 2574 elements on five pages, no
  difference. It runs by hand with the screenshots, since it needs Chrome.
- **How often the extension refreshes is one module,** `logic/polls.ts`, which
  extension.ts polls by and Settings says, so GH-113's pace has one source.
- Not done here: high-contrast palettes of acc's own, and the low contrast of
  orange text on white that the Light shots show, which was there before.

## D-102 Every command gate is told the near tests, an index named index is found by its path, and per-area files reach the tests that read them (2026-10-07)

GH-117, from GH-95's review. It amends D-100. The merge queue's full check
still ran every test, but a builder could finish believing its change was
tested when it wasn't.

- **Every command gate is given `ACC_NEAR_TESTS` again**, as before GH-95.
  This replaces D-100's "only for a gate that reads `ACC_NEAR_TESTS`": acc
  couldn't tell that `npm run test:near` or `make near` reads it, and a script
  given an empty list ran nothing and passed. `readsNearTests` is gone. The
  list is worked out once a run, reading each file once, so the typecheck and
  the full check wait for it again, 25 to 60 ms on this repo. A check still
  never inherits either variable from the acc it runs under.
- **A file named index is found by its path, not its name.** It's named for
  its folder, and many folders have one: gates.test.ts quotes
  `packages/cli/src/commands/index.ts` as data, so every change to a module of
  core ran it. Its tests are now those named for it or that load it by its
  path or its folder's. This rewords D-100's "a module of core near only its
  own tests": a module of core is near its own tests and the tests that load
  core's index by its path (lock.test.ts, whose workers import it), and no
  longer near a test that only mentions an index. Across this repo's 248
  tracked .ts, .css and .json files, 30 near lists changed, all modules of
  core, each losing only gates.test.ts.
- **Any other index is still found by its name.** The ticket asked for every
  index by its path. But extension.ts imports more than half of
  `extension/src`, so it's the index of the 18 modules there it imports, and
  its tests load its build, `dist/extension.js`, not its source. By path alone
  those modules would lose activate.test.ts. A test pins that they keep it.
- **A per-area file that a test reads through a script, not an import, is
  near that test.** The rule is a table in this repo, not an acc config key:
  `READS` in `scripts/near-reads.ts` gives each kind of file and the script
  that reads it, and the near-tests gate adds the tests near that script for
  each such file in `ACC_CHANGED`. Each area's stylesheet, styles.css
  included, reaches screenshot.test.ts, which checks every theme defines the
  colours the styles use, through styles.ts. Each commands file and
  extension/package.json reach areas.test.ts through generate.ts. Naming the
  script rather than the test also brings page.test.ts, cards.test.ts and
  setup.test.ts, and a new test that reads the styles needs no edit to the
  table. It stays this repo's, since only its own scripts know what they
  read. DESIGN.md §2 says a new kind of per-area file adds a row.
- Not done here: the plugin's bundled acc (0.37.0, built before GH-95)
  already gives every gate the list, and takes the index rule at the next
  `npm run package`. The screenshot fixtures, and tests that read the page
  through `pageSource()`, still have no near rule (D-100).

## D-103 Every config key and setting is read and described, checked both ways (2026-10-07)

GH-107. A setting that does nothing is worse than a missing one: PhotoCraft
found 60 of its 135 preferences read by nothing. acc's `.acc/config.json`, the
extension's settings and DESIGN §4's table could drift the same way, and had:
§4 described 21 of the 57 keys, and the README neither setting.

- **The keys parseConfig knows are data.** `CONFIG_KEYS` in config.ts lists
  every key by its path: `gates.severity`, `environments[].org`,
  `trackers[].team`, `agents.builder.model`. A list of strings or a map such as
  `gates.commands` is one key. It's typed against `Config`, so tsc refuses a
  path that isn't one, and a key a Config has that's left out.
- **An unknown key warns at every level**, from that list: `gates.foo`,
  `trackers[0].foo`, `agents.builder.foo`. Before, only the top level,
  `autopilot` and `dispatch` warned, and a misspelt nested key was dropped
  without a word. A config that loaded quietly may now print a warning; it's a
  warning, not an error, and what the config does is the same.
- **scripts/test/settings.test.ts checks both ways.** Each key has a read in
  source outside the tests, and is described in §4's Field table: a row of its
  own, or its nearest parent's row naming it in backticks. Each contributed
  `agentCommandCenter.*` setting is read with
  `getConfiguration('agentCommandCenter').get('<name>')` in extension/src and
  named in README.md. Every setting extension/src names is contributed, and
  every key read from a raw parse of .acc/config.json, at the three places
  `RAW_READS` pins, is one parseConfig knows. Each part asserts how many it
  checked, and each finding names the key, what's missing where, and the fix.
- **What counts as a read.** TypeScript 7 has no language service to ask, so
  it's the source text: a qualified read, such as `gates.severity` or
  `autopilot?.autoMerge`, anywhere; for a key read through a variable (an
  environment's, a tracker's, an agent role's, the secret scan's, the
  template's), `.<key>` in the files `READ_IN` names. A pointer that goes stale
  fails, and says to move it. Comments and quoted strings don't count, nor does
  config.ts's validator, its writers or its key lists (`NOT_READS`, pinned by
  declaration); its helpers that act on a key, such as `autoMergeOn` and
  `defaultEnvironment`, do.
- **Two keys only the validator reads, pinned.** `VALIDATOR_ONLY` holds
  `schema`, which must be 1, and the raw `environments[].branch`, which must be
  the lower-cased name; code reads the branch it derives from the name. The
  test pins the list to these two, so it can't grow quietly.
- **A key nothing reads is listed before it's removed.** `UNREAD_KEYS` takes
  it, with the ticket or decision that will read it, and the test fails once
  something reads it, so it comes off. Remove a key only when no decision or
  doc promises it: a removed key makes configs that set it warn. The list is
  empty today.
- **The Command Center hides a listed key.** How agents run tags each part and
  row with its key and shows none that's listed, nor a role with no parts left;
  the Connect page offers no picker whose `trackers[].<key>` is listed, and
  keeps the tracker's value for it. An extension setting is never listed:
  VSCode's Settings can't hide a contributed one, so a setting nothing reads
  comes out of package.json.
- **Gaps fixed:** §4 has a row or a named mention for every key, and its
  `worktrees.root` row and example say `.claude/worktrees/`, per D-022, not a
  sibling folder. The README has a Settings part.
- Not done here: the team template's own keys (template.ts's `ALLOWED` and
  `PROJECT_ONLY`, where `dispatch` and `gates.builder` get the generic "isn't
  a template key" error), writing §4's table from `CONFIG_KEYS`, and the
  plugin's skills, which name tracker keys in prose.

## D-104 How agents run moves to Settings, and Agents keeps per-token billing (2026-10-07)

GH-110, the second of the six tasks GH-109 began. It amends D-089: How agents
run is no longer behind the Agents page's Settings button but a part of the
Settings section, second after Appearance.

- **What moved:** builders' and reviewers' model, effort and fallback (D-036,
  D-086), and each project's autonomy (D-064) and auto-merge (D-083). Each
  keeps its **Change…**, the same `acc.agents.configure`, `acc.agents.autonomy`
  and `acc.agents.autoMerge` as before, which ask acc. This clone's choice goes
  in its git config, a project's in its `.acc/config.json`, for the person to
  commit. The page writes neither. The commands keep their ids and stay in the
  Agents area's `src/agents.ts`, but the Settings area lists them as the
  page's to ask for, since it draws them.
- **Every project setting is under its project's name,** even with one
  project, and each value says where it's set, in words with an icon: this
  clone (a desktop), project default or project (a repo), acc's default or
  Claude Code's default (an empty circle). Autonomy and auto-merge say
  "project": no clone sets them.
- **Each state has an icon and a label:** autonomy review (a rocket) or manual
  (pause), and dispatch or full, which autopilot refuses, in orange with a
  warning; auto-merge on (a merge) or off (a slash). Billing is blue on the
  subscription and orange per token. Colour adds to the words, never stands
  for them.
- **Billing is said once,** as this machine's, for every project, not once per
  project as Agents did. Per token or not checked yet, it has **Open Setup**,
  whose check says why and how to fix it.
- **Agents keeps per-token billing** above its sessions, as it did while How
  agents run was closed (D-089): it costs money while nobody looks. The
  subscription line shows only in Settings. Agents' model has a `billing` of
  its own instead of each project's settings.
- **The Agents page's Settings button and the status bar's Auto-merge open
  Settings at How agents run,** by `settingsKey('agents')`: the button within
  the page (`go(section, part)`), the status bar through `Panels.show`. Agents
  opens nothing in place any more, so the page's memory of an opened
  `agents:settings`, and a Settings link's `open`, are gone.
- **A jump stops below the tab strip.** Under 820 px the rail is a strip stuck
  to the top, and GH-109's jump scrolled the heading under it. `jumpTo` now
  leaves the strip's height above the heading. In headless Chrome, at 500 px
  the heading lands 13 px below the strip, and at 1000 px only the section
  scrolls.
- **With no onboarded project,** the part says so, with **Open Setup**.
- **Checked:** the part's model and page by `settings.test.ts`; Agents' button
  and billing by `agents.test.ts`; each Change… and the status bar's
  Auto-merge in the activation test, through the real acc: a builder's model
  for this clone lands in git config and not the project's, a reviewer's
  effort for the project in `.acc/config.json`, auto-merge turns on, and the
  menu item opens Settings at How agents run showing all three. Screenshots
  `settings-agents` (two projects, every source and state, per-token billing)
  and `agents-billing`, at 1000, 620 and 500 px in Light and Dark; `--colours`
  finds no difference across themes on them and `settings` (1204 elements).
- **Shot tall:** `settings-agents` is shot 3300 px tall so the page doesn't
  scroll. Headless Chrome draws a document a jump scrolled with a blank band
  above the tab strip, which VSCode doesn't.

## D-105 Shared rules are copied in, with where they came from (2026-10-07)

A lesson learned in one project should reach the next project's agents
(GH-108). Each repo had only its own `.acc/rules.md`, and nothing carried a
rule across. PhotoCraft's sibling apps read shared standards by a relative
path (`../craftrules`), which breaks for anyone who clones one app alone; its
release playbook copies files in, and each app keeps its own. D-098 chose the
second: anything taken from elsewhere is copied in, with where it came from.

- **A copy, never a link.** `acc rules import <source>` copies a rules file into
  `.acc/rules/<name>.md`, named after the source's file or `--name`. The source
  is a path, a GitHub file URL or `<git-url>#<path>`, read and refused exactly
  as a team template is (D-097): one module, `source.ts`, now serves both,
  each naming itself in its messages. A person commits the copy. Shared rules
  are the author's own text, not skills, so D-002 holds.
- **The header is the only record.** The copy starts with an HTML comment:
  its source (a path recorded from the repo's root or `~/`, never a home path,
  D-079), the commit it was read at (on GitHub, the last commit to change the
  file at its ref; in git, the clone's HEAD; none for a path), the day it was
  copied, and the sha256 of the text as copied. It's read strictly, and no
  config key repeats it. A file in `.acc/rules/` with no header is rules kept
  here, with no source to compare.
- **Agents read only the repo's files.** The packet, the review and the
  analysis each get one Rules section, in a fixed order: the profile's rules,
  then each copy by file name, then `.acc/rules.md`. A sentence says the later
  one wins, so the repo's own rules win where they conflict. Nothing reads a
  source at dispatch, review or analysis, so a source that moves or goes
  changes nothing: the packet is byte for byte the same.
- **The profile's rules are the reviewer's old Salesforce focus list.** No
  rules text existed per profile; the reviewer's system prompt had four
  Salesforce lines builders never saw. They're `PROFILE_RULES.salesforce` now,
  first in the section every agent gets, and out of the system prompt so
  they're said once. A generic project has none.
- **An update is a person's choice.** Setup's B0.rules step reads each source
  again, sharing 20 seconds, and compares digests, so an edit made in the repo
  never counts as a change at the source. Unchanged: pass, naming copies
  edited here. Changed: check by hand, with `acc rules diff <name>` as the fix,
  which shows the copy against the source now (what copying in again would
  change) and says when that would replace edits made here. Unreadable: check
  by hand, with the reason. A path not on this machine: doesn't apply. A
  header's source is untrusted, as a committed config's is: one acc won't fetch
  never reaches gh or git. To take a change, a person runs
  `acc rules import <source> --name <name> --force`; there's no merging.
- **A team template may name rules** (`"rules": [<source>, …]`), each a URL or
  a path from `/` or `~/`: a relative path would mean a different file on each
  machine. `acc init --from` reads every one before it writes anything, then
  copies each in, keeping a copy already there. B0.template counts `rules` as
  different when the template names a source with no copy.
- **Limits:** each file at most 64 KB, as a template; all the copies together
  at most 128 KB, since every packet, review and analysis carries them. An
  empty file, or one with a NUL, is refused.
- **A person's, not a builder's.** The hook and the builder's deny list refuse
  `acc rules import`; `acc rules list` and `acc rules diff` only read. Copies
  live under `.acc/`, so the merge queue and autopilot leave them to a person.
- **`--name`, not `--as`:** `--as` is every command's actor option.
- **Setup's row always offers Import rules…,** from a step's new `offer` field,
  so the page and the walkthrough both show it. It previews with
  `acc rules import --dry-run --json` before anything is written.
- Not done here: the `.acc/packet.md` override and `templates/packet.md` that
  DESIGN.md §8 names still don't exist.

## D-106 A builder ends with a note that the reviewer, the next builder and the pull request read (2026-10-07)

GH-101. Sessions end abruptly: a crash, a full context, a stopped Mac.
PhotoCraft's answer is a dev log each session appends to, but it's gitignored
and local, so no other machine, contributor or fresh clone can read it. acc
keeps the note where every later reader gets it: on the run, in the ledger.
Before, `acc done` only moved the task to review.

- **Three flags, a line each.** `acc done --landed "…" --moved "…" --open
  "…"`: what landed, which numbers moved (tests, checks, ratchets), what's
  still open. A flag again adds a line, up to 10 a part and 300 characters a
  line. Not a free-text `--note`, nor a note file: a file in the worktree could
  be committed, and lines are what Make a task needs.
- **All three are required of a builder's `acc done`** (a person decided):
  `--moved none` and `--open none` are accepted, so nothing is a statement, not
  an omission; something must have landed. It's a `note` requirement on the
  running → review rule, so the rule stays data, and it applies to a builder
  only: a person's move needs none. Refused, acc gives the exact command.
  `acc block` takes the same flags, optional, since its reason is required.
- **One finish command.** `DONE_COMMAND` in ledger.ts is the text the packet,
  the SessionStart short packet, the Stop hook, a resume's message and the
  refusal all give; before, five places wrote `acc done` by hand. Tests pin
  each to it.
- **The shell.** The packet says one line, double quotes, no backticks or `$`.
  guardBash refuses an `acc done` or `acc block` with a backtick or `$` outside
  single quotes, since the shell would run or expand it before acc saw it.
- **Kept with the run, one step back.** `run.note`, with when, who and whether
  it ended in review or blocked; the move's event carries it, written in the
  same locked mutate as the move. A dispatch replaces the run, so the new run
  keeps the last one's note as `run.before`, or `null` when it left none. Older
  notes stay in events.jsonl. A note is refused on a move that isn't done or a
  block, or on a task with no run, rather than dropped.
- **Readers.** The reviewer gets it with the instruction to check it against
  the diff, not trust it. The PR body has a Builder's note section, as the
  builder's own words, unredacted, as review findings already are; the packet
  says it's posted there. A re-dispatch's packet has the last run's note, or,
  when it left none, says so and to start with `git status`, `git log
  --oneline origin/<branch>..HEAD` and `acc gate list`. A dependent task's
  packet has each direct dependency's note; one with none isn't listed, so
  tasks finished before this add no noise. `acc show` prints it.
- **Make a task** (a person decided): each still-open line on the task page
  drafts an acc task (T-n) through `acc add`, in the source task's environment,
  titled with the line, its brief citing the source task, its builder's run and
  the note's date, and depending on the source task while it isn't done. The
  title and brief are prefilled in input boxes to edit; Esc makes nothing. It
  never writes to a tracker (D-006, D-066).
- Not done here: acc working out the numbers from receipts itself; posting the
  note on the ticket; recording which open lines became tasks, so one can be
  made twice; a CLI command for Make a task; Slack and the status bar; notes
  for runs that finished before this.

## D-107 The Agents page is grouped by repo, then by task, and says nothing twice (2026-10-07)

GH-119, after GH-110 moved How agents run off the page. In a window with
another repo open, every session of this repo sat under "Elsewhere on this
machine"; each row named its project twice, in its name and in Where; Where
repeated the worktree the task's key implies and wrapped over five lines; Kind
took a column; and an empty project took a heading and a row. The author chose
to group the page by repo, then by task.

- **Repos, each a heading with its count:** this window's projects, in the
  window's order, then every other repo on the machine by name, then **Other
  folders** for sessions in no repo. Nothing is lumped into "Elsewhere". A
  session's repo is GH-83's folder rule (`sessionFolders`, D-090), which now
  says each folder's repo, its place in it, and its worktree: a project open
  here by its config's name, else its repo's folder, named as its label names
  it (`clients/Acme Service`). The heading's hover is the repo's folder.
- **"another window"**, with an icon, on a repo another window's Command Center
  shows. Each window already keeps a listener file of the folders it shows, for
  questions (D-030), fresh every 15 s; the hub reads the others' with each
  `claude agents` look. A window that shows the repo, or a folder or worktree
  in it, has it open; one showing a folder above it doesn't. A repo open in a
  window without acc's extension doesn't say so.
- **One line per task, its agents beneath it.** The task's key and title head
  it, opening its page where its project is open here; a task elsewhere has no
  page here, so its line opens nothing. Its title comes from the task row, else
  from its repo's ledger: `SessionTie` now carries the task's `title` and a
  builder run's count `n`. Each agent's line is its role, as D-087 names it
  (builder, builder 2, review, analysis; a count the run didn't record is read
  from the name acc gave it), an icon for interactive or background with its
  word on hover, its state with an icon and a label, its model, how long it has
  run (`27 min`, with when it started on hover), and its menu. Sessions tied to
  no task go under **Other sessions**, by their own names; that line shows only
  beside tasks, since alone the repo's heading says enough.
- **Nothing said twice.** A line names neither its repo nor its task. Where
  shows only when an agent isn't in its task's own worktree: `main checkout`,
  a folder in the repo, or, inside its worktree, just that folder
  (`force-app`). A session tied to no task shows where it is in its repo; one
  named for its folder, as Claude Code names some, shows no Where. Folder or
  Full path still switches it (D-090), and the toggle shows only while some
  line has a Where. An agent's hover has its whole name, its model and its
  whole folder. Kind is no longer a column.
- **Needs you first.** Within a repo, tasks with an agent that needs you come
  first, then the rest by their newest agent, then Other sessions, unless one
  of those needs you; within a task, the same. A line that needs you has
  **Answer** while its question waits in the Command Center, **Watch**, and
  **Open in Claude Code** (Attach for a background session with no session id).
  Answer goes to the Overview and brings its question's card into view, as In
  progress's does (GH-76). Below 1280 px Watch and Open in Claude Code show
  their icons only, and below 660 px Answer too, each named on hover and to a
  screen reader.
- **Finished sessions fold** into one **Finished (N)** line under each repo,
  closed unless opened, remembered per tab like other folds. Its lines name
  their task, key and title, and role, since no task line heads them, and say
  no state: the fold's heading does. **Stop all** stops that repo's finished
  background sessions: `acc.agents.stopFinished` takes the repo's folder and
  filters D-095's plan by the same folder rule, with the same one dialog.
- **A repo with no agents is one quiet line:** "Acme Portal · no agents right
  now". With no sessions at all the page says so once, as before.
- **The header** keeps Settings, **Stop finished (N)** (shorter than "Stop
  finished sessions") and Start a background agent. Its summary counts every
  session, and how many are working, need you, and are finished: "23 sessions:
  4 working, 5 need you, 5 finished."
- **Layout:** one table for the page, so the columns line up down every repo.
  States stay on one line above 660 px and wrap to two below. Below 560 px the
  Model column goes, its model on the agent's hover. A finished line's title
  and a long session name are clamped, never `nowrap`: a `nowrap` title was
  the cell's least width, which widened the table until the sticky row menu
  covered Running. Task titles and Where take two lines at most, with their
  whole text on hover.
- **Checked:** `agents.test.ts` groups a busy machine: this window's projects
  first, the empty one too, a repo another window has open and one it
  doesn't, Other folders, a task's builder and review together, builder 2, an
  untied session, needs you first, a finished one folded with Stop all, Where
  only off a task's own worktree, and the repo the page and Stop all agree on.
  Core's tie test checks the title and count. Screenshots `agents` (two
  projects here, one empty; a repo in another window with a task whose builder
  and reviewer are both listed; an analyst in the main checkout; Other
  folders), `agents-finished` (each repo's Finished open), `agents-path` and
  `agents-billing`, at 1000, 620 and 500 px in Light and Dark; `--colours`
  finds no difference across themes on `agents` and `agents-finished` (1434
  elements).
- Not chosen: Other sessions always last, which would put an untied session
  that needs you below every task; a Where column, mostly empty once a line in
  its own worktree says nothing; telling a repo elsewhere apart from a project
  here of the same name, which D-090's rule doesn't compare.

## D-108 A project starts from an epic, an area path or labels, picked on the Connect page (2026-10-07)

GH-81. The author plans to run each new project from an epic in a shared
Jira: "we plan on building out epics and tickets in there for future
projects." A repo's tracker could be narrowed to an epic (D-072) only once the
repo was set up and its tracker connected after. It builds on GH-79's shared
sign-ins (D-091) and GH-80's team templates (D-097).

- **Setup's "What kind of project is this?" offers "From a Jira epic…",**
  beside Salesforce, Other and From a team template. It asks where the rest of
  the settings come from (one of those three, with GH-80's confirmation of a
  template's check commands), reads `acc init … --dry-run --json` for the
  project's name and GitHub, then opens the Connect page (D-073) for a folder
  with no config yet, over Setup. Nothing is written until **Start the
  project**.
- **The place is required in this flow** (a person decided), and the whole
  project isn't offered: taking a whole project stays Other project, then Add
  a tracker. Jira's place is an epic from the project's open epics, Azure
  DevOps' an area path, GitHub's at least one label, monday.com's a group.
  Each tracker's description in `trackers/connect.ts` names which of its
  lists stands in for an epic, with words the page shows under it ("In Azure
  DevOps, an area path stands in for an epic: …"), so the page still names no
  tracker; a test checks each names one of its lists.
- **acc init writes it once.** `acc init --tracker '<json>'` takes one tracker
  as a description's toConfig gives it, and parseConfig checks it with the
  rest. It replaces a template's tracker and `--jira-*`, with a note: flags
  beat templates (D-097). A template's tracker of the same kind on the same
  host keeps its key prefix unless the one picked names its own, as
  withTracker keeps it on a replace. The page's Save runs it with the rest of the
  choice's arguments; acc's refusal shows beside Save in its own words, and
  the page stays open. One write, rather than acc init and then a patch from
  the extension, so a failed second step can't leave a half-started project.
  Back, Cancel or closing the tab write nothing; only a sign-in tested on the
  page stays, in VSCode's secret storage, as D-073 and D-091 allow.
- **A sign-in kept for the new project alone is under the key it will have.**
  The page's sign-in calls take the project as an object, its GitHub repo and
  its ledger in the git directory its clones share, rather than a root looked
  up among open projects, so the key is D-027's from the dry run. A test
  checks the dry run's key and the written config's are the same.
- **A site every project shares fills in signed in** (GH-79). With no
  template tracker, the page takes the first site another repo on this
  machine uses, the most used first, that has a sign-in kept for it. A
  template's tracker fills in its site or organization and its project.
- **This machine lists the repos acc set up:** `~/.acc/repos.json`
  (`ACC_REPOS_FILE` in tests), their roots and nothing else. acc init adds the
  repo it writes, and the Command Center each project it loads, so repos set up
  before count too. A root listed already stays where it is, so loading the
  projects again writes nothing. Each listed config is read when a place list loads, and
  one that's gone or broken is skipped, never holding the list up.
- **A place another repo here uses is marked "used by <repo>"** (a person
  decided what counts): the same Jira epic on the same site, the same GitHub
  label on the same repo, the same monday.com group on the same board, and an
  Azure area path equal to another's, or over or under it ("overlaps
  <repo>"). Names and keys match whatever their case. A clone or worktree of
  the same repo (D-027's key) never counts. The mark is in the list's words,
  and the one chosen says it under the list with a warning icon and words;
  a label says it in its tick. Picking a marked one asks in a modal: Use it
  too selects it, Cancel keeps the choice before. Add a tracker and Change
  mark them too: it's the same list.
- **Nothing is written to the tracker.** The page only reads: a test records
  every request through the Jira, Azure DevOps and GitHub flows and allows
  only GET and HEAD, Azure's two read POSTs (`_apis/wit/wiql` and
  `workitemsbatch`), and gh's api GETs, lists and views, failing on none
  recorded.
- **The README names the place** (B10): `acc setup readme` writes "Its
  tickets come from Jira epic [ACME-3](…/browse/ACME-3)", an Azure area path
  with its project linked, each GitHub label linked to its issues, or a
  monday.com group with its board linked. The key, never the epic's name, so
  it doesn't go stale and nothing is read from the tracker to write it.
  B10.readme applies once a tracker has a place, even with one environment,
  and fails until the README links it. Repos already narrowed to a place see
  it fail until `acc setup readme` runs again. Setup leaves this to B10's Do
  it rather than editing README.md as the project starts.
- **After Start the project** the projects load, the Tasks tab shows the
  board ("Tickets from Jira · ACME · epic ACME-3 …"), every card not done has
  Track (D-074), and Setup checks again.
- Not chosen: creating or changing anything in a tracker; several epics per
  repo, JQL or components (D-072); a template naming an epic, labels or an
  area path (D-097 keeps those per project); the CLI listing epics or signing
  in (D-066); sharing the repos list or sign-ins across machines; a GitHub
  Project picker.

## D-109 Settings lists every tracker and its sign-in, and acc writes a tracker (2026-10-07)

GH-112, the fourth of the six tasks GH-109 began. A tracker's sign-in, its place
and connecting another were on each tracker's board on Tasks, one project at a
time, and Sign out was only a command. This amends D-073 and D-091.

- **One list across the open projects,** in Settings' Trackers and sign-ins,
  each project under its name, as How agents run does (D-104). Each tracker
  shows its kind and title, where its tickets come from and its board (D-072),
  and who it signs in as, for every project on its site or this project only
  (D-091). It's drawn from what each board already knows (`BoardInput`), so
  Settings reads no tracker and no secret of its own. A project with none
  says so, and one whose trackers haven't been read yet says it's reading.
- **Where each is set:** the place and the board say "project", with a repo
  icon: they're the project's `.acc/config.json`, and no clone sets them. The
  sign-in says "VSCode on this machine", with a key, or for GitHub "gh on this
  machine". It's never in a file.
- **Every state has an icon and words,** blue or orange: signed in for every
  project on the site (a globe) or this project only (a repo); not signed in
  (a plug); signed in but refused, with the tracker's reason (a warning); gh
  as the project's account. The board: its name once read, Reading it (a
  spinner), Shows once it's signed in, or why it couldn't be read. The sign-in's
  line says what's wrong with it, and the board's doesn't say it twice.
- **Sign in again, Sign out and Change place…** on each Jira, Azure DevOps and
  monday.com tracker, each named for whose tracker it is. Sign in again and
  Change place… run `acc.trackers.signIn` and `acc.trackers.add` with the
  tracker, which open the Connect page at it, as the board's buttons do. Sign
  out runs `acc.trackers.signOut`, which the page may now ask for: a site's
  sign-in still asks every project or this one, and a project's own goes with
  no question (D-091). Not signed in, Sign in leads, and Sign out is disabled
  with why. **Connect a tracker…** ends the part, and the Connect page asks
  which project. GitHub has only Change place…: it signs in through gh as the
  project's account (D-007), which GH-113's GitHub accounts part will gather.
- **acc writes a tracker,** not the Command Center. `acc trackers set --file
  <tracker.json> [--index <n>]` adds one, or changes the one at that place,
  keeping keys the record doesn't name and taking out those it names as null,
  as D-073's Save did. Core's `saveTracker` checks the config it would make and
  writes nothing when it wouldn't load. The Connect page's Save hands it the
  record through a file that's removed after, and shows acc's refusal beside
  Save. It's a person's: the hook and the builder's deny list refuse it, as
  they refuse `acc rules import`. So every change Settings starts goes through
  acc or VSCode's secret storage (D-064). The settings check's raw read of the
  config (D-103) moves with it, to `saveTracker`.
- **The Connect page comes back to Settings** when it was opened from there:
  Back goes to the Trackers and sign-ins heading, and so does Save, in place of
  the Tasks tab. Opened anywhere else, it goes where it did.
- Not chosen: a Connect a tracker per project, since the Connect page asks;
  listing every sign-in VSCode keeps, which its secret storage can't (D-091);
  a sign-out button on the Connect page, which D-091 turned down. Sign out is a
  button in Settings, beside each tracker.
- **Checked:** `settings.test.ts` for every sign-in and board state, the
  buttons and their commands, and the page; `connect.test.ts` for Back and
  Save from Settings and acc's refusal; `activate.test.ts` through the built
  extension and acc: `acc trackers set` adds a Jira tracker, Settings lists it,
  a project's own sign-out asks nothing, a site's asks and keeps it for the
  rest, and Sign in again and Change place open the Connect page with Back to
  Settings. `config.test.ts` and `cli.test.ts` for `acc trackers set`, a hook
  fixture and the deny list. Screenshots `settings-trackers` at 1000, 620 and
  500 px in Light and Dark; `--colours` finds no difference across themes on
  its 650 elements.

## D-110 Settings raises or lowers how many builders run at once, with what it means; this machine can cap every repo's together (2026-10-07)

GH-111, the third of GH-109's six tasks. The author asked to raise or lower how
many agents run at once from Settings, with what a change means, and chose
acc commands for each limit and check, so the page never writes a file
(D-064). It amends D-092, which left changing `agents.max` or the heavy-check
slots out of the Command Center: a terminal was the only place to set them.

- **Two caps, side by side,** each with −, its number, + and Change…, how many
  run now and where it's set. **This project's cap** is `agents.max` in
  `.acc/config.json`, shared with everyone on the repo once it's committed,
  set with `acc agents max <n>`; it names its project, and says when it's
  acc's default of three. **This machine's total** counts every repo on the
  machine, since usage limits belong to the Claude account, not a project. It's
  `agents` in `~/.acc/machine.json`, beside the heavy-check slots, set with
  `acc machine agents <n>` (1 to 64) or taken out with `--none`. Unset, there's
  no total. A − or + that can't move says why, and a machine with no total
  has neither: Change… sets one.
- **The machine counts every repo** from a note acc writes, the first time a
  repo dispatches, under `~/.acc/ledgers/`: a file naming its ledger. Its
  builders are its tasks in Running, as each project's cap counts them. A note
  whose ledger has gone is left out, and dropped only by acc's own commands (a
  start, and `acc machine agents`): the Command Center's read writes nothing
  (D-012). With no total, nothing else is read. The total is read and written
  through one path, `machineJson`; where acc's environment has no home (a
  test's made-up one), nothing machine-wide is read, and setting the total is
  refused rather than written under the real home.
- **A start that would pass either cap says which.** "3 builders are running in
  this project, and its cap is 3 (agents.max)", or "6 builders are running on
  this machine, across every repo, and its total is 6 (acc machine agents)".
  A held start (D-093) and autopilot's re-dispatch wait with those words, and
  a held task's card says "as many are running as the project allows", or "as
  this machine's total allows, across every repo". A person's own dispatch is
  refused with them, as it was at the project's cap: D-093 left holding a
  dispatch for the cap out, and this keeps it so.
- **What a change means, in this machine's numbers.** Each agent is a Claude
  Code session on your account, with the builders' model (Opus 5.5 unless
  set); more at once uses the plan's limits that many times faster, and at the
  limit Claude Code pauses them until it resets; on per-token billing each one
  costs as it runs, and recent reviews' and analyses' recorded `costUsd` say
  how much. Builders' checks wait for this machine's heavy-check slots, so
  those past the slots wait in line, and recent builders' times (dispatch to
  acc done, the middle of the last ten) say how long they take. More at once
  means more tasks touching the same files: they take turns (D-093), and
  conflicts at merge get likelier. With no numbers yet, each says so.
- **The heavy-check slots and each project's checks** are rows with Change…:
  `acc machine heavy-slots` (D-080), and `acc gate required [<name>…]` and
  `acc gate builder [<name>…|--none]` (D-096), both picked many at a time from
  the project's own checks. Slots that `ACC_HEAVY_SLOTS` sets stay in view,
  with why they can't change here. No required checks shows in orange. The
  required checks, like the cap, say when they're acc's default because the
  project's file names none.
- **Read only while it's seen.** The Command Center reads the limits only
  while Settings shows, or while a task is held and the project's own cap has
  room, never on another section's render: the author's machine feels
  background load.
- **One key, byte for byte.** Each project command edits only its key in
  `.acc/config.json` (`config-edit.ts`): the value replaced where it stands, or
  a new key put after its object's last, indented as the file is, and every
  edit read back against JSON.parse before it's written, else the file is
  written whole.
- **A person's, at all three layers.** The new commands, and `acc agents set`,
  refuse builders, reviewers and analysts by name in the CLI, and autopilot as
  not a person. The hook's PERSON_ONLY_ACC names `gate waive`, `gate required`
  and `gate builder` beside `agents` and `machine`. The builder's deny list
  gains `acc agents set*`, which it lacked, `acc agents max*`, `acc gate
  required*` and `acc gate builder*`; `acc machine*` was there. A test runs
  every such command through all three.
- **Every state has an icon and words:** blue while builders work, neutral
  when none do or the next start waits in line, orange for per-token billing
  and for no required checks. Light, Dark and Match VSCode drew the same
  colours on every Settings page the colour check reads, Limits and checks'
  other states among them (505 elements there, 4,663 on all eight pages).
- Not chosen: holding a person's dispatch for a cap (D-093's call stands); a
  per-clone cap, since a cap is shared, and the machine's total is the
  person's own; counting Claude Code's sessions for the total, which counts
  finished sessions and not a stopped builder, unlike the project's cap; a lock
  across repos, so two repos dispatching in the same instant can both pass a
  total by one.

## D-111 The settings check matches only real reads: variables, the config's own reads, and the intake skill (2026-10-08)

GH-122, from GH-107's review. It amends D-103. Its check could pass in three
ways it shouldn't, each a gap in how strictly it matched a read, not a key left
unread today.

- **A listed key read through a variable still fails the list.** A key on
  `UNREAD_KEYS` was looked for only by its qualified name, such as
  `builder.fallbackModel`, while agentArgs reads `p?.fallbackModel` for every
  role. The check now also looks for `.<key>` in the files `READ_IN` names for
  the key's siblings, as the read check does: listing
  `agents.builder.fallbackModel` fails, pointing at agents.ts. This errs
  towards failing the list, the safe side.
- **A `READ_IN` entry can pin the config's read.** An entry is a file or
  `{ file, via }`, where `via` is the read itself. `trackers[].labels` is pinned
  to `tracker?.labels` in intake.ts, where an issue's `i.labels` satisfied it
  before, and `environments[].name` to `env.name` in packet.ts. A finding names
  the pattern it looked for. A sibling search uses only the entry's file.
- **The intake skill is on `RAW_READS`.** It tells a session to read the
  tracker's place from `.acc/config.json`, so each tracker key it names in
  backticks, after "tracker's", "its" or "it names" (`repo`, `labels`,
  `skipLabels`, `project`, `epic`, `areaPath`, `board`, `group`, `prefix`),
  must be one parseConfig knows. A place that isn't source is read from disk,
  whole, comments and all. This closes part of D-103's "the plugin's skills".
- Not done here: pinning the other `READ_IN` entries whose `.<key>` also
  matches unrelated reads in the same file, such as `.repo` in intake.ts, which
  `gh.repo` would satisfy; the other skills that name config keys.

## D-112 A test check counts what ran; none run, or more skipped, needs a person (2026-10-07)

GH-100. A check that ran nothing looked the same as one that passed:
PhotoCraft's two worst false greens were a fuzz test nothing ran and GPU tests
that print "skipping" and pass, and a builder that marks a failing test skip
to get green is the same failure. acc kept only an exit code and a summary
line. It extends D-024 (what a receipt proves) and D-031 (waiving).

- **A receipt counts what its tests ran,** where its output holds a summary
  acc can read: run, passed, failed, skipped and todo, from node:test's spec
  or TAP reporter, Jest's `Tests:` line (`No tests found` is none), or Apex's
  `numTestsRun` and `numFailures` in validate's deploy result. `run` is passed
  plus failed (node's cancelled counts as failed); Apex has no skip or todo.
  The skipped tests' names are kept where the runner prints them. Counts live
  in their own `counts` field: `details.tests` already holds the Apex tests a
  builder named, which `priorTests` reads back.
- **Every complete summary counts once.** The analysis proposed the last
  block per runner. A command that runs its tests in parts, such as
  `npm test --workspaces` or `node --test a && node --test b`, prints one
  summary per part, and taking the last would undercount, which is the false
  green this ticket is about. A test's own output can't fake one: node's TAP
  reporter prints it behind `# `, Jest indents it, and a summary in a
  failure's message is indented; a block must be unindented and complete
  (tests, pass, fail, skipped and todo; Jest's `Test Suites:` line just
  before `Tests:`). What's left is a test that prints a complete, unindented
  spec summary of a run of its own, which would be added in: an overcount, not
  a false green.
- **Output acc can't read is never guessed at.** A test check, one
  `gates.tests` names, a gate called `test`, Salesforce's `lwc-tests`, or
  validate when it runs Apex tests, records no counts and a note saying so
  ("not read"). Counts are read from any gate's output, as the person decided;
  only a test check gets the note.
- **A new status, `hold`: "needs a person".** A would-be pass that ran no tests,
  or skipped more than the count it's compared with, is a hold. Like `fail`
  it satisfies nothing, so done, review, land and the merge queue all stop,
  with no change to `satisfies()`'s callers. Unlike `fail` the builder can't
  fix it by fixing the change, so `acc gate run` tells it to add or un-skip
  tests, or `acc block` if the task asks for the skip, and the merge queue
  stops for a person instead of sending the task back. A fail or an error
  keeps its status. `skip` keeps its meaning: the check didn't apply. Orange,
  a person icon and the words "needs a person", never colour alone.
- **What a count is compared with.** The nearest earlier receipt with counts
  for the same gate and the same command, at or before the branch's merge base
  with its environment's branch, walking back up to 500 commits from it. Not
  the tip, which can hold changes the branch doesn't, and never the commit's
  own receipt, so running a held check again doesn't compare it with itself.
  With nothing earlier the check isn't held, and its receipt says there was
  nothing to compare with. Receipts from before this have no counts, so the
  first counted run of each gate is its baseline. A repo that squashes or
  rebases loses the ancestry, and always has nothing to compare with.
- **A person's waiver is a count they accepted.** The waived receipt keeps
  its counts and the command they came from, and a waiver with counts on the
  branch's own commits is the first thing compared with.
- **A person's waiver on the head clears a hold on the queue's merge of that
  head, counts or not.** When a branch is behind, the merge queue checks a
  merge commit it makes again on each pass, and asks a person to waive a hold
  on the head. A builder never runs the full check there, so that waiver
  usually has no counts, and comparing alone found nothing: the queue merged,
  held and stopped again on every pass, for good. Now `checkCommit` tells
  `runGates` the head it merged the base into, and a hold on that merge where a
  person waived the gate on the head is written as their waiver: a skip, by
  them, with their reason, naming the head, keeping the merge's counts and the
  hold it was. It covers a zero-run hold as well as more skipped. Only a hold:
  a fail or an error on the merge still needs a person, since a waiver holds for
  its own commit (D-031) and a fail there is a new finding, not the one they
  accepted. Refresh's merge (D-058) goes through the same `checkCommit`.
- **Which checks are compared.** The person decided: only those whose test set
  doesn't depend on the change, "not one acc gives ACC_NEAR_TESTS, not
  lwc-tests, not validate", so that in this repo `check` is compared in the
  merge queue. Since D-102 every command gate is given ACC_NEAR_TESTS, so that
  test no longer tells them apart. The rule is the one the config already
  holds: a builder's lighter check, one `gates.builder` names that
  `gates.required` doesn't, isn't compared, nor are the built-in `lwc-tests`
  and `validate` (`changeBound` on the gate). It gives the decided outcome:
  `check` is compared, `near-tests` isn't. Those still record counts, and the
  reviewer catches a new skip in the diff.
- **The reviewer is told** that a newly added skip, only or todo in a test is
  a finding that must be fixed unless the task asks for it, and reads each
  check's counts. acc doesn't scan the diff for them itself.
- **Shown everywhere a check is:** the pull request's check table gains a
  Tests column where any check counted ("312 run, 2 skipped"; failed and todo
  only when there are some; "not read"), the ticket page shows it under each
  check, and `acc gate run` and `acc gate list` print it. The ticket page's
  check look moved from the webview's ternaries, where an unknown status fell
  through to another's icon, into the model, where a test covers every status.
- Not done here: an empty ACC_NEAR_TESTS
  list is still a pass with no counts, not a skip; a gate whose output reports
  failed tests but exits 0 still passes; GitHub's own checks (D-076); and the
  release-only plugin bundle (D-042), which takes this at the next
  `npm run package`.

## D-113 Changes that add scratch files, root files, big files or data exports fail a built-in check (2026-10-08)

Agents commit their scratch output. PhotoCraft's main branch got
`fb-test.log` and `fb-clippy.log` from one agent's pull request and a 1,929-line
`test.tmp` from another, and a Salesforce project's root often holds client
data exports. The doctor's B3 steps only look at the root, and only when a
person runs setup. So `stray-files` checks every change (GH-103).

- **What fails.** A change that adds a log, temp file or merge leftover
  (`*.log`, `*.tmp`, `*.orig`, `*.rej`, case-insensitive, or `.DS_Store`, by a
  file's name at any depth); a new file at the repo root (a path with no `/`; a
  new top-level folder isn't one); or a file whose committed blob is over 1 MB
  (1,048,576 bytes, from `git cat-file`, so an LFS pointer passes and a dirty
  tree doesn't matter). In Salesforce, also a data file outside the folders
  `strayFiles.data` lists. A data file is `.csv`, `.xls`, `.xlsx` or `.eml`
  (a person decided `.eml` counts): `DATA_EXT` in stray-files.ts, which the
  doctor's B3.gitignore and B3.data-files now share, so there's one definition
  of client data. Each file is named with the first rule it breaks, in that
  order, with the fix: `git rm --cached <file>` and add it to `.gitignore`,
  or list it under `strayFiles`.
- **Only what the change adds.** Status `A` in the diff from the merge base
  that every gate uses (D-024), minus environment-specific files: `Changes`
  now keeps `added` apart. A file already on the environment's branch never
  counts, however it's changed. A rename's new path is added, so moving a big
  file or moving one to the root fails until it's listed. A change that adds
  nothing records `skip`. A generic repo with no environment branch to compare
  with records `error`, not a pass on nothing: `GateInput.unknownBase` says
  why, where runGates used to swallow it.
- **Allowances** are `strayFiles.allow` (paths or folders, matched as
  `dispatch.shared` is, no globs) and `strayFiles.data`, beside `secretScan`.
  Both are repo paths, never absolute or climbing out; `data` warns outside
  Salesforce. They're project-only: a team template that sets `strayFiles` is
  refused. They're read from the checked commit's own `.acc/config.json` (a
  person decided), so a builder's run and the merge queue's give one answer.
  That means a change can allow its own file. The listing shows in the pull
  request's diff, where the reviewer (D-032) and the person merging see it;
  nothing else guards it.
- **Required by default, everywhere** (a person decided). In both profiles,
  in a builder's scope and the merge queue's, unless `strayFiles.required` is
  `false`, as analysis is on by default (D-052). `gates.required` needn't name
  it: `fullGates(config)` is `gates.required` with stray-files added, and
  `requiredGates` adds it to `gates.builder` too, since it's cheap and the
  builder can fix what it finds. Code reads the required list only through
  those two now. Before, about ten places read `gates.required` directly, and
  an implicit gate would have been enforced by some (`acc done`, the queue)
  and invisible to others (the task page, the packet, refresh). A test in
  config.test.ts pins it: `config.gates.required` is read only in config.ts
  and in template.ts, where B0.template compares the raw list with a
  template's. A per-commit waiver (D-031) covers a one-off.
- **A bare `acc gate run`** in a project that requires nothing but
  stray-files still runs every gate, as before: the fallback asks whether
  anything but stray-files is required.
- **Built in, replaceable.** It's first in `gatesFor` for both profiles, not
  heavy, and runs only git. A `gates.commands` entry named `stray-files`
  replaces it, as for the Salesforce built-ins.
- **On upgrade**, tasks already done or in review have no stray-files
  receipt, so `acc done`, `acc review` and `acc land` refuse them until
  `acc gate run`; the merge queue runs it itself. `writeConfig` writes the
  `strayFiles` defaults into `.acc/config.json` the next time acc saves it, as
  it does `secretScan`'s.
- Not done here: flagging files already tracked; editing `.gitignore` or
  untracking anything (it only reads); globs in allowances; a setting on the
  Settings page.

## D-114 Every project's rules keep parallel work mergeable, and a burst of merges offers a tidy-up (2026-10-08)

GH-104. GH-94 split this repo's hub files so parallel builders rarely touch the
same file; the same lesson belongs in what acc tells every project's builders.
PhotoCraft's agents kept many builders going at once with three rules, and
showed the cost of nobody tidying: 44 local copies of one helper, and comments
that contradict other files ("Check Spelling is not implemented"; it is,
elsewhere).

- **Every project's rules, in every profile** (a person decided). rules.ts's
  `BASE_RULES` come first in the Rules section, under their own heading, then
  the profile's: new behaviour in its own file, registered with one line where
  a list must name every area; if another task's change breaks your build,
  block with the reason and don't edit its files; write a manifest or config
  file whole, temp file then rename. Salesforce keeps them too, since
  package.xml is a manifest; its own rules follow unchanged. Builders,
  reviewers and analysts all get them, as rulesText always did, and the
  SessionStart short packet names them in one line. rulesText never returns
  null now.
- **The reviewer looks for a duplicated helper**, in every profile, and names
  both as file:line in the finding's message, since a finding holds one place.
  It must be fixed when the existing helper is exported (a person decided); a
  near-copy of a local one is must: false. The plugin's reviewer.md says the
  same. It's prompt-only: tests pin the words, not the model.
- **A tidy-up after `tidy.every` merges** (8 by default, 0 for never, whole
  numbers to 100), per repo ledger. "Since the last tidy-up" means since a
  person added or skipped one, kept in `<git-common-dir>/acc/tidy.json` and
  written whole. With none on record, only the newest `every` merged tasks
  count (a person decided), so a busy repo gets an offer at once and older work
  isn't swept in. Tasks labelled `tidy-up` don't count, and an open one holds
  the offer back.
- **Its scope is the files those merges touched** that still exist on the
  default environment's branch, fetched first: each task's merge commit against
  its first parent, else the merge that took its branch in, else its branch
  against where it left. Append-only, environment-specific and `.acc/` files
  are left out. 16 of this repo's 44 merged tasks have no recorded merge
  commit, so a task whose files can't be found is named in the draft with why,
  never dropped.
- **Drafted for a person, never created on its own.** Sync and autopilot add
  nothing; a test runs both over 8 merges. The Overview's blue item (an offer,
  so not counted in the badge) drafts it through `acc tidy --json` and adds it
  only on a person's Add task (`acc tidy add`: a manual T-n, labelled
  `tidy-up`, in To do; no GitHub issue, D-066). Not now (`acc tidy skip`)
  records a skip with who and when, which resets the count (a person decided)
  rather than snoozing. Both refuse builders, reviewers and analysts; builders'
  settings and the PreToolUse hook deny them too.
- The ledger's `writeAtomic` is exported for tidy.json rather than copied.
- Not done here: acc finding duplicates itself (a same-name scan or lint); a
  check that enforces the three rules, such as no non-atomic config writes
  (writeConfig still writes in place); autopilot dispatching the tidy-up;
  team templates setting `tidy`.

## D-115 Every command survives junk arguments (2026-10-08)

GH-106. PhotoCraft's `panic_hunt` runs every command in its registry with junk,
so a new command is covered without anyone remembering it; but it's marked
ignored, and nothing runs it. acc keeps the first half and not the second: two
junk tests read the registries and run in `npm run check`, never skipped.

- **The lists are the registries.** acc's is `entryPointsOf(AREAS)`: each
  command, and each subcommand its group declares in `subcommands` (a person
  decided subcommands count: before, they lived only in `if (sub === …)`). A
  command that compares a word it doesn't declare fails the test. The
  extension's is `contributes.commands`. Each test asserts it called as many as
  the registry holds.
- **The junk.** No arguments, empty strings, wrong types, an unknown id, paths
  outside the repo and `../` ids, every option set to junk, and objects of the
  wrong shape for the extension. A 1 MB string can't be an argument: macOS caps
  arguments and environment at 1 MiB together, and Linux one argument at
  128 KiB. So a person decided acc gets 1 MB on stdin and in files, and 100 KB
  in arguments; the extension's in-process calls get the full 1 MB.
- **What passes.** For acc, exit 0, 1 or 2 within 20 seconds; exit 3 fails (a
  person decided), as it means an error acc didn't expect, such as a raw
  ENOENT. A failure prints one line, with no stack. A person decided main.ts
  cuts a message to 300 characters, in both human and `--json` output. Built,
  that cut `acc done`'s own refusal, about 400 characters, before the exact
  command a builder must run (D-106's test caught it). So main.ts cuts each
  word over 200 characters, which is where echoed junk lands, with an
  ellipsis, and the whole message only past 1,000. For the extension, each
  call settles within 10 seconds without throwing, with no unhandled
  rejection.
- **The sandbox.** Every acc call gets a fresh copy of the repo, so one that
  succeeds can't change another's start. HOME, TMPDIR, CLAUDE_CONFIG_DIR and
  acc's machine files point inside it; fake `gh`, `claude` and `sf` fail at
  once. Home, the template and an OUTSIDE folder, with bait a `../` id would
  reach, are hashed before and after each command. It runs the built acc,
  two calls at once, as spawning the source took a second a call; the
  near-tests gate builds first.
- **Its cost.** At three calls at once, cli.test.ts ran past its 300-second
  limit in `npm run check`. So two run at once, cases that overlapped were
  merged, and the regression tests run in their own file, refusals.test.ts.
- **What it found.** acc: a file it can't read exited 3 with a raw ENOENT or
  EISDIR; a folder named as a template or rules file did too; `acc analysis
  answer ../…` rewrote a JSON file outside the repo; long `--json` output was
  cut at 8 KB on a pipe, as acc exited before it drained; `acc drift` printed a
  progress line before refusing; messages echoed a 100 KB id. The extension:
  30 task and agent commands threw on an object that wasn't a row, and others
  on nothing; the step commands rejected an unknown step; In progress's Stop
  threw on `null`; Jira's import threw on a string. Each is fixed, with one
  test a cause (a person decided), naming every command it covers.
- **No catch-all in `reg()`.** Wrapping every handler in a try/catch would
  hide exactly what this test exists to find, so each handler checks what it
  gets: `nodeArg` drops an object that isn't a row and keeps a string, as some
  commands take a root.
- Not done here: the Command Center page's webview messages as an input
  surface; a real id with junk after it, which needs each command's argument
  shapes; running outside a git repo; kernel-level write sandboxing.

## D-116 A review finding that keeps coming back is offered as a rule, then as a check (2026-10-08)

GH-102. A rule written only in prose decays; a rule a tool checks holds.
acc keeps every reviewer verdict, so it can see the same finding turn up in
task after task and offer the path from finding to rule to check. Before the
change, nothing read the verdicts across tasks.

- **What it reads.** Every verdict in the clone's reviews folder, for any
  environment and any task state, through one `readVerdicts` that skips a
  review under way and any file it can't read. `latestVerdict` uses it too.
  Only reviewer findings count, not the analyst's, GitHub's checks or the merge
  queue's send-backs.
- **How it groups.** By the rule a finding cites, or by close wording where it
  cites none. A cite loses its source tags (`CLAUDE.md:`, `(CLAUDE.md)`,
  `Task:`), its parentheticals, and anything after the first `:` or `;`, so a
  cite joining two rules keeps the first. A cite that starts with a decision id
  groups by the id. What's left is compared by its words: a finding joins the
  group whose first finding shares 0.6 of its words (0.5 for wording), oldest
  first. Wording uses the finding's new optional `kind`, else its first sentence
  without paths, identifiers, code or numbers. No embeddings and no agent call:
  the result is the same every time, and a test pins it.
- **When it offers.** At 3 or more findings across at least 2 tasks, counting a
  finding once per task and file (decided by a person): a later review of the
  same task saying it again on the same file isn't a new finding. Both blocking
  and non-blocking findings count, since only 10 of 282 are must; the card
  says how many were.
- **Rule or check** (decided by a person). A rule already written in
  `.acc/rules.md`, `.acc/rules/`, `CLAUDE.md`, `AGENTS.md`, a decision, or the
  file the cite names, is offered as a check, with no new line: "Already a rule
  (CLAUDE.md). It keeps coming back: add a check". One accepted as a rule that
  comes back 3 more times is offered again as a check.
- **A person decides, and acc only drafts.** Accept opens a draft of the task
  (line, title, Ask for a check too, notes); Confirm runs `acc rules accept`,
  which adds one manual task in To do and records the suggestion as accepted.
  Dismiss records the findings the group had; it's hidden until 3 more join.
  Records match a group by its findings, not its id. Both refuse builders,
  reviewers, analysts and autopilot, and guardBash and the builder's deny list
  block them (`acc rules suggested` only reads, so a builder may list).
  Working out the offers writes nothing, and acc never writes `.acc/rules.md`:
  the task's pull request does, and it changes `.acc/`, which a person merges.
- **Never in the badge** (decided by a person). An offer is neutral, with an
  icon and a label (Rule suggested, Check suggested), after the orange items.
  Nothing waits on it.
- **The kind of a finding** (decided by a person). The verdict schema gains an
  optional `kind`, and the reviewer is shown the kinds earlier reviews named,
  most used first, to reuse. Older verdicts keep working from their first
  sentence; none is rewritten.
- **Per clone.** Reviews, offers and records are in the git common directory
  (D-008), beside reviews and ticket updates: a teammate's clone sees its own.
- **Proved on this repo's own reviews** (2026-10-08): 82 verdicts, 282
  findings, 36 citing a rule, 10 must, in 258 groups. It offers one: "Look at
  UI changes before shipping them", 13 findings in 8 wordings, counted as 12
  across 10 tasks (2 must), as a check, since it's in CLAUDE.md. It doesn't
  offer `D-072` (3 findings, all GH-70), "Keep changes to what the task asks"
  (4 findings, counted as 2: GH-9's and GH-12's reviews repeated it on the
  same file), or the closest wording group (2 findings, GH-52 and GH-58).
- Not chosen: acc writing `.acc/rules.md` or building the check; tracker
  tickets; sharing offers across clones; similarity by embeddings or an agent;
  counting only must findings; listing suggestions under `acc rules list`,
  which GH-108 gave to the copies.

## D-117 The UI rules in CLAUDE.md are tests: an icon and a label, theme colours only, no overlaps (2026-10-07)

GH-105. CLAUDE.md asked for an icon and a label on every state, orange against
blue, and screenshots read before shipping, because the author is colourblind
and "tests can't see a broken layout". Nothing checked any of it.

- **Every state has an icon and a label** (`extension/test/looks.test.ts`). It
  walks 23 tables and functions that map a state to how it shows, through every
  value each takes: 616 states. It fails, naming the table and the state, on an
  empty label, an icon the codicon font the page ships doesn't draw, or a tone
  that isn't orange, blue or neutral. A source scan finds every top-level
  `Record<…, Look>` and function returning a look or a tone in the extension
  and the page (28), and fails on one neither walked nor in `NOT_TABLES` with
  why. Every icon name written in a look, an action or the page's `icon()`
  (432) is checked against codicon.css too.
- **Task states read core's DISPLAY everywhere**, and the test fails on a table
  of task states that differs from it or from DESIGN.md. In progress showed
  rework as a neutral wrench and done as a pass; the task feed showed done in
  blue. Now `displayLook` serves both, and the feed's look comes with each move
  from the model. A check's result is a table (`CHECK_LOOK`) in the model, not
  a ternary in the page. Jira's panels moved to `webview/looks.ts`, which has
  no DOM, since every other page module reaches the VSCode API as it loads.
- **A tracker's columns and the ticket's status pill gained an icon**, by
  status category (`CATEGORY_LOOK`): they had only a name and a coloured edge.
- **No red against green.** Each tone resolves through the page's styles and
  Light's and Dark's palettes to a hue; a table with a red and a green state
  fails. So does any colour the page's styles read that is red or green (774
  read). That found the one red: a delete button's hover read VSCode's error
  colour. It reads `--orange` now, and the palettes no longer set
  errorForeground. Hues come from Light and Dark, so a user's own theme isn't
  proven.
- **Colours come from the theme** (`extension/test/colours.test.ts`). It scans
  every declaration value in the page's stylesheets, but theme.css, and every
  string in its modules, for hex, rgb(), hsl() and named colours, with file and
  line. Two exceptions, each with why: mask alpha, and a tracker label's own
  colour. One that matches nothing fails. --line's last fallback is mixed from
  the foreground instead of a grey of its own.
- **The screenshot run checks geometry** (`extension/scripts/geometry.ts`). One
  Chrome launch writes the PNG and dumps the DOM, where the page wrote what it
  measured once its fonts loaded and two frames drew, so the run takes no more
  launches. A pure judge decides, unit-tested on made-up drawings: no two
  controls overlap, unless one is inside the other or floats in a sticky
  layer; no text is cut off, and an ellipsis passes only with its whole text in
  a title or aria-label; the rail's selected tab is in the rail's view; nothing
  scrolls sideways but a board, a wide table, the rail, code and a doc's table.
  Each check says how many it examined, a drawing with no controls or no text
  fails, and a whole run fails below its floors (examined on 41 pages × 2
  themes × 3 widths: 8760 controls, 27086 texts, 192 selected tabs, 918
  scrollers). It exits 1 naming page, theme, width and element; the shots are
  written either way. A planted negative margin on toolbar buttons fails it.
- **What it found, fixed:** at 620 and 500 px the selected tab of a later
  section (Environments, Setup, Settings) was past the rail strip's edge in 50
  drawings; the rail now scrolls it into view after each draw and again once
  the icon font loads. 34 labels cut with an ellipsis had no title holding
  them: the dock's run and command, Setup's command and detail lines, the
  agent page's tool lines, the Overview's inbox and lists, In progress's
  titles. Each now has one. `GEOMETRY_EXCEPTIONS` is empty.
- **It stays in `npm run screenshot`**, not `npm run check`: Chrome is slow and
  not in every gate's slot. The check runs the looks and colours tests and the
  judge's tests. A webview-only gate is a follow-up. CLAUDE.md says what the
  checks catch, and that the PNGs still need reading: spacing, alignment and a
  page that reads badly are beyond them.
- Not chosen: golden images or pixel diffs; the DevTools protocol; checking the
  sidebar, tree items and status bar, which draw with VSCode's own icons and
  colours; contrast ratios.

## D-118 A number that may only get better: acc raises its floor, and only a person relaxes it (2026-10-07)

GH-99. Agents trade quality for speed when nothing stops them. PhotoCraft holds
its numbers with floors in its test source that may only go up, so a change can
land partial progress but never a regression, and an agent can't pass a check
by deleting cases. A person raises those floors by hand, so they lag (620 while
626 run) and stop guarding the gap. acc can raise them itself.

- **A ratchet is a kind of check.** `gates.ratchets` names its command, whose
  last line is one number, its limit (`floor`, which may only go up, or
  `ceiling`, which may only go down) and a label. Its name is a gate's, and
  can't be another gate's, so it's required, a builder's or heavy like any
  other. No number, or a command that fails, is `error`, never `pass`.
- **The floors are committed,** in `.acc/floors.json`, one entry a ratchet, so
  they travel with branches, a person can read them, and two raises of
  different ratchets merge as text. The receipt keeps the number, the floor,
  the environment's floor where the branch began, and the difference; the pull
  request and the ticket page show `tests 669 → 674 (+5)`.
- **acc raises a floor in the task's worktree, and nowhere else.** Only `acc
  gate run`, on the task's own branch in its own worktree, with nothing
  uncommitted: never an environment's branch, the main checkout, or a refresh's
  or the merge queue's check, whose worktree must stay clean for the next
  merge. The raise satisfies nothing until it's committed, so it can't be left
  behind. The commit that only records it carries its parent's receipts,
  marked `carried`, when every number in it is one the parent measured and acc
  raised: a person decided a second full `acc gate run` wasn't worth it.
- **Only a person relaxes a floor, with a reason, as only a person waives a
  check (D-031).** A floor worse on the branch than where it began fails unless
  acc has a person's record of relaxing it, from the floor the branch began
  at, to that number or a worse one: a floor acc raised again after a person
  relaxed it is still theirs to back, or the commit recording the raise would
  fail its own check. A record only counts from the floor it relaxed: records
  are kept for the clone and never pruned, so one from another task or time,
  matched on its number alone, would let a builder lower today's floor by
  hand down to any number a person once relaxed to. `acc gate relax`
  writes that record, refuses builders and agents, and is denied in builders'
  settings. The file's own `relaxed` note is for people to read; the record in
  acc's state is what counts, since a builder can edit the file.
- **This narrows D-031: a ratchet can't be waived.** A waived ratchet that
  merged would leave its environment's number below its floor and fail every
  task after it. `acc gate waive` refuses one and names `acc gate relax`, and
  the ticket page offers no Waive… beside one.
- **A floors conflict keeps the better of each, unless a side relaxed one.**
  Autopilot resolves it in a refresh and in the merge queue alike (D-058,
  GH-73), and the floors file never makes two tasks wait at dispatch (D-093).
  Where one side relaxed a floor, keeping the better value would quietly undo
  what a person chose, so that conflict is left for a person: narrower than
  "both raised", by design.
- **This repo's one ratchet is the number of tests `npm test` runs,** required
  and a builder's, not heavy. Running the whole suite again in every builder's
  check would undo GH-73's lighter checks, so a person chose a fast counter:
  `scripts/count-tests.mjs` loads every test file with node:test, each test
  marked skipped, so no body runs and node:test still counts it. Its test pins
  it to a full run's own count over a fixture, and it fails rather than count
  none or count around a file that didn't load. Against `npm test`'s own
  summary on this branch it counted the same.
- **The records of who relaxed a floor live in this clone's git directory,** as
  receipts do. On another clone, a relaxed floor reads as no one's until it's
  relaxed there too. acc runs on one machine a repo.
- **A repo turns a ratchet on with an acc that knows them.** An older acc
  ignores `gates.ratchets` and reads `tests` in `gates.required` as a gate with
  no command, so it refuses to run the checks. This repo's own config lists
  one, so the acc that checks and merges this change has to be built from it.
- Not done here: a Relax floor… button on the ticket page (the CLI only, a
  person decided), ratchets in team templates, and the Salesforce profile's
  coverage and Code Analyzer ratchets, which are config a project writes.

## D-119 Stop finished sessions stops only a session whose process still runs (2026-10-08)

D-095 counted a finished background session with no process, still listed as blocked, as one to stop,
on the belief that `claude stop` clears it. It doesn't. Claude Code answers "couldn't confirm <id> was
stopped — the background service may be restarting" in under a second, and the session stays listed.
The author pressed Stop finished on nine such sessions and got all nine back as a wall of reasons.

- **A session counts only while its process runs** (`pid`). One without has nothing to stop: it costs
  nothing, and stays in its repo's Finished fold. When no session in a fold can be stopped, the fold
  has no Stop all, and the header has no Stop finished.
- **A failure is one line.** The notice says how many of how many couldn't be stopped, and the
  Command Center's log has each one's reason.
- Not chosen: `claude rm`, which also lists a session as gone. It deletes the session's worktree, and
  Stop finished promises to keep worktrees.

## D-120 Settings' About shows the versions, says a newer release and an older plugin, and Setup's machine results are kept per version (2026-10-08)

GH-114, the last of GH-109's six tasks. The author asked for a Settings page;
its About part was to show the versions of acc, the extension and the plugin,
and say when a newer release is out.

- **Three versions, read fresh, each with where it's read from.** acc's from
  `acc --version`, run from the bundle the extension runs (the acc on its
  terminals' PATH is the same bundle); the extension's from its own
  `package.json`; the plugin's from `claude plugin list --json`, the user-scope
  install A4 reads. They're read each time Settings is arrived at (the rail,
  `acc.open.settings`, the tab coming back on screen, the page loading on
  Settings) and at Settings' Refresh, never on the polls' redraws, so sitting on
  Settings runs nothing.
- **One comparison for A4 and About** (D-088). `pluginBehind` in core's
  onboarding helpers is the only test of "older": `x.y.z` against `x.y.z`, an
  older plugin only, and nothing for a version it can't read. A4 fails on it
  against acc's version; About says it in orange against the extension's,
  which ships the same acc. `userPlugin` reads the list for both. A test runs
  A4 itself over the same pairs and checks About is orange exactly when A4
  fails. About's **Update the plugin** (or Install, or Turn on) is Setup's own
  fix, `acc.step.fix A4.plugin`, which checks again and runs what the check
  names, in a terminal like any `claude` subcommand.
- **A newer release, as gh's active account.** The repo is private, so
  `gh release view --repo jack-huffman/agent-command-center` runs as whoever
  is signed in to gh, not a project's account; `GH_TOKEN`, `GITHUB_TOKEN` and
  the enterprise tokens are left out of its environment, since they'd win.
  It's looked for once when Settings first shows in a session (a window's
  run of the extension), then when Settings opens, at most every six hours,
  and whenever **Check now** is clicked. A newer release is orange with a link
  to its notes on GitHub (only a github.com page is linked); up to date is
  blue; a look that fails, no release yet, and not looked for yet are
  neutral. A failed look counts as a look, so a machine offline isn't asked
  again on every visit; Check now asks at once.
- **`acc.machineItems` carries the version that checked it.** Startup reused
  the machine's results for 12 hours whatever had changed, so after an
  upgrade A4 could pass a plugin the new acc would fail. Saved results now
  hold the extension's version and are reused only by that version; results
  saved before this, or with no version read, are checked again.
- **Nothing here writes** (D-064). The versions and the release are reads,
  the plugin's update is Setup's fix, and a release installs by hand, as the
  README says. None of About's values is a project's, so none names one.
- **Every state has an icon and words,** orange for what needs you, blue for
  current or under way, neutral for unknown. Light, Dark and Match VSCode drew
  the same colours on every page the colour check reads, About behind among
  them (5,350 elements on nine pages).
- Not chosen: keeping the last release look across sessions, which would skip
  the first-open look the task asked for; installing a newer release from the
  page, since the VSIX comes from a private release and the README's steps
  stand; comparing acc with the extension in orange, since the extension
  always runs its own bundle and a mismatch only means the window needs a
  reload, which About says in words.

Note (GH-147, 2026-10-09): A4 and About read the plugin list one way. Core's
`parsePluginList` (over `parseClaudeList`, which A4's marketplace check uses
too) takes the run's result and runs nothing; it replaced A4's private
`claudeJson` and About's copy of it. A list About can't read now says A4's
words in its neutral row, such as "Couldn't read Claude Code's plugins: claude
plugin list didn't run: …", where it said claude's first line alone; no
screenshot shows that state, and A4 reads as before. About's states are walked
in `looks.test.ts`'s TABLES, and since its rows aren't looks by type, a test
there matches every `LOOK` in `model/about.ts` to a state the walk reaches, so a
new one it doesn't walk fails. Each state is written as its own `LOOK` for that.

## D-121 Slack, each repo's GitHub account and the Command Center's own preferences are in Settings; switching an account is a person's (2026-10-08)

GH-113, the fifth of GH-109's six tasks. It amends D-078, which put Slack's
card on Environments, and D-090, whose Where view only Agents switched.

- **Notices in Slack moved to Settings, whole:** the card, its commands and
  the webhook's handling are D-078's, unchanged. Its badge came with it:
  Settings turns orange in the rail while Slack is paused, and Environments no
  longer does for Slack (a wrong GitHub account still turns it orange). So did
  its toast: **Open Settings** opens the part, and **Send notices to Slack…**,
  or a test with no webhook, opens it too. Environments keeps a line under
  **This machine**, "Notices in Slack moved to Settings.", with **Open Notices
  in Slack**.
- **GitHub accounts lists every open project under its name:** the account its
  repo pushes as, from this clone (git config) or the project
  (`.acc/config.json`), gh's sign-in, and the commit identity, each with an
  icon and words, blue or orange; a problem is said once. It's drawn from the
  identity Environments' card already reads (D-028), so Settings runs nothing
  of its own. **Switch…** is `acc.github.switch` for that project, which asks
  `acc github use`; **Sign in** or **Add Projects access** shows when gh needs
  it. A project with no `"github"` section says so, with Switch… disabled and
  why. Environments keeps its identity card: it's where promotions and pushes
  happen, and the buttons are the same commands.
- **`acc github use` is a person's at all three layers** (the author chose
  this): the CLI refuses builders, reviewers and analysts by name and autopilot
  as not a person (`noAgent`); the hook's `PERSON_ONLY_ACC` names `github use`;
  the builder's deny list has `Bash(acc github use*)`. The ticket said
  `github`: naming the subcommand, as `gate waive` and `rules import` are named,
  keeps `acc github status`, which only reads, a builder's.
- **The Command Center's own preferences, each a command:**
  - **Opens on:** Where I left it (the default) or a named section, per window,
    in its workspaceState (`acc.home.opensOn`). It applies when the Command
    Center opens afresh with no section asked for, as from its activity bar
    icon; a link to a section, or a page already open, is left alone.
    `acc.settings.opensOn`.
  - **Agents' Where:** Folder or Full path (D-090), per window, as before
    (`acc.agents.where`). Agents' toggle and Settings both set it through
    `Panels.setWhere`. `acc.settings.where`.
  - **Refresh pace:** Normal, Relaxed (each on-screen interval ×2) or Slow
    (×4), kept on this machine in `agentCommandCenter.refreshPace`, a setting
    of machine scope like the theme (D-101), so every window takes it at once.
    `pollEvery` in `logic/polls.ts` is the only place it applies: hidden-page
    intervals, agents' questions and autopilot's timers don't poll through it,
    so a slow page never makes acc slower to notice what needs you. The part
    lists each interval at the pace chosen. `acc.settings.pace`.

  Each command takes a choice or asks with a quick pick, and refuses one it
  doesn't know in words, changing nothing. The page asks for each with the
  choice; it writes nothing itself (D-064).
- **Every state has an icon and a label,** in Light, Dark and Match VSCode. The
  colour check found the Slack card's ticks took their text colour from the
  browser's colour scheme, not the palette, which it had never looked at on
  Environments; they inherit the page's now.
- **Checked:** `settings.test.ts` for each part's model, the pace at every
  interval, each command's wiring, the badge, toast and moved line;
  `slack.test.ts` for the badge in Settings and not Environments;
  `activate.test.ts` through the built extension: each preference's command
  with a choice, without one (it asks) and with one it doesn't know, the pace
  in VSCode's settings, the Where view in the window's state from either
  place, the Command Center reopening on the section chosen, and Slack's
  command opening Settings at its part; `cli.test.ts` runs `acc github use`
  as each role through the CLI, the hook and the deny list. Screenshots
  `settings-github`, `settings-page` and `slack-none`, `slack-off` and
  `slack-paused` (now Settings opened at the part), and `environments`, at
  1000, 620 and 500 px in Light and Dark; `--colours` finds no difference
  across themes on 8,300 elements on 12 pages, About's among them.
- Not chosen: moving Environments' identity card to Settings, since promotion
  and push problems are seen there; refusing `acc github status` to builders;
  a refresh pace per window, since the load it eases is the machine's; slowing
  hidden polls, questions or autopilot.
- **Each label in one place (GH-150).** GitHub accounts' "this clone" is
  `settingFrom('clone')`, FROM_WORDS' words, as How agents run says it.
  Environments' moved line opens `settingsKey('slack')`, as Slack's commands
  and toast do. Agents' Folder / Full path toggle draws each view from a copy
  of `WHERE_WORDS` in `webview/agents.ts`, in its order: the page imports no
  values from `src`, which would bundle the extension's code into it, so a
  `settings.test.ts` test pins the copy to `model/settings.ts`'s and fails if
  they name a view differently, as `HOW_AGENTS_RUN` is pinned to
  `settingsKey('agents')`. `activate.test.ts` runs
  `acc.github.signIn('jordan-kim')` with VSCode's sign-in coming back as
  another account, and checks it says it wanted jordan-kim. Nothing on screen
  changes.

## D-122 A relaxed floor counts only for the task a person relaxed it for (2026-10-08)

GH-130, narrowing D-118. A person's relax record backed a floor lowered on any
branch that began at the floor it relaxed from, and the records were never
pruned. So when a person relaxed `tests` from 669 to 640 for T-1, T-9, which
also began at 669, could lower its own floor to 650 by hand and pass its check
and the merge queue's; and once main was back at 669, an old record matched
again.

- **A relax is for one task.** `acc gate relax` takes the task named with
  `--task`, or the one whose worktree it runs in, and refuses a checkout that
  isn't a task's and a task that's done. Its record names the task, and its
  output says the relax is for that task alone.
- **A record backs a floor only on its task's branch.** The gate counts a
  record when the run is for that task (as `acc gate run` and the merge queue
  name it) and the checkout is on that task's branch, so its builder's checks
  and the merge queue's merge of it pass, and no other branch does. Naming the
  task with `--task` from another branch backs nothing, since the branch is
  checked too.
- **A record stops counting once its task is done or leaves the board.** The
  gate reads the ledger for that. A record from before this change names no
  task and backs nothing.
- **acc prunes, on its own commands.** `acc gate run` and `acc gate relax` drop
  the records that can't count, holding the ledger's lock, so a relax written
  at the same moment isn't lost, and write the file whole. The Command Center
  only reads (D-012).
- Not chosen: tying a record to the floor's merge into the environment, which
  needs GitHub; a done task is the same moment as acc sees it, and it's local.

## D-123 The heavy-check slots find machine.json as the total does, and the CLI's tests are a file per command group (2026-10-08)

GH-131, two points GH-111's review (D-110) left.

- **One way to find `~/.acc/machine.json`.** `machineDir` and `machineJson`
  move to core's `machine.ts`, and the heavy-check slots (`heavySlots`,
  `setHeavySlots`) are read and written through `machineJson`, as the
  machine's total is. `machineFile`, which fell back to `os.homedir()`, is
  gone. With no home, the slots read one and a change is refused, through the
  same `machineJsonToWrite` as the total's. `machine.ts` is its own module
  because `semaphore.ts` can't import `limits.ts`: limits imports gates, which
  imports the semaphore. `heavyDir`, the slots' folder, still falls back to
  `os.homedir()`; it isn't machine.json, and is left as it was.
- **The CLI's tests are a file per command group,** named for its module in
  `packages/cli/src/commands/` (D-099): setup (with main.ts's own help), rules,
  trackers, tidy, tasks, updates, pipeline, checks, agents and github, with
  what they share in `support.ts`. cli.test.ts took 160 s alone against
  node:test's 300 s per-file limit; the slowest file now takes 31 s. The 53
  tests moved whole, none dropped. Each file names `../src/main.ts` itself, so
  the near-tests gate finds them all for a change to a command module, as it
  found cli.test.ts, and a module's own file by name.
- Not done: a change to one command module still runs every group's file in
  the near-tests gate, since each runs main.ts, which loads them all. That is
  the same work as before, now in ten processes rather than one.

## D-124 Nothing opens on its own: the Command Center's first open in a folder that isn't set up lands on Setup (2026-10-08)

GH-138. The author: rather than have the Command Center pop up in every new
repo, the setup page should start the first time the person goes to it in a
repo. It amends the M2 walkthrough (D-017), which opened VSCode's Get Started
tab on its own: the machine walkthrough on a machine's first window
(`acc.welcomed`), and the project walkthrough in every Salesforce folder with
no `.acc/config.json` (`acc.projectWalkthroughShown`).

- **Opening a folder opens nothing:** no walkthrough tab, no notification.
  `maybeOpenWalkthroughs` is gone. The extension still starts with VSCode
  (`onStartupFinished`) and runs its checks, so the status bar and the rail's
  badges are as before.
- **The first open lands on Setup.** The first time a person opens the
  Command Center in a folder with no `.acc/config.json`, from the activity bar,
  the status bar menu's **Open the Command Center** or `acc.open.home` with no
  section, it opens on Setup: at **This machine** while the machine's steps
  haven't all passed (a machine not checked yet: see GH-149 below), in place of the machine
  walkthrough; otherwise at **What kind of project is this?**. Every profile
  gets it: a folder that isn't a Salesforce project has no project checks yet,
  so This project shows the question alone. Its **Choose…** is B0.config's
  **Do it**, and the quick pick it opens has the same title, from one
  constant. It's kept in the workspace's workspaceState (`acc.home.firstOpened`),
  so it happens once per workspace: in a multi-root workspace, only the first
  folder that isn't set up gets it. After it, the Command Center opens where it was left or
  on the section D-121's preference names. `logic/first-open.ts` decides,
  `Panels.open` asks it.
- **Sent somewhere, it goes there.** `Panels.show`, which Connect a tracker, a
  run's output, Settings' links and the rest call, never redirects, and
  `acc.open.home` with a section, as the sidebar's list sends, goes to that
  section. Neither counts as the first open. A folder that's set up is never
  sent to Setup.
- **The status bar menu's Open the Command Center** now opens as a person's
  open does (`Panels.open`), so the first open and D-121's opens-on choice
  apply to it too; it used to name the Overview.
- **The walkthroughs open when asked for:** Setup's header has **Machine
  walkthrough** and **Project walkthrough** (it had one, **Walkthrough**); the
  Command Palette and VSCode's Get Started page list them as before.
- **Checked:** `first-open.test.ts` decides each case (asked for, already
  open, a second open, set up, no folder), the machine's readiness and the
  Setup model's question; then, through the built extension in a sandbox with
  no `acc.welcomed`: a Salesforce folder that isn't set up opens no walkthrough,
  no page and no notification; a section asked for goes there and doesn't
  count; the first open lands at the question, once, and the next opens where
  it was left; Setup's two buttons send their commands, and each opens its own
  walkthrough; on a machine with a step to do, a folder of no profile lands at
  This machine; a set-up folder opens on the Overview and keeps no first open.
  Screenshots `setup-first` and `setup-first-machine`, Setup as first shown
  in a folder that isn't set up, at 1000, 620 and 500 px in Light and Dark;
  the geometry run's floors rose with the pages (overlap 9360, tab 258).
- Not chosen: a notification offering Setup, since nothing should appear
  unasked; counting a section asked for as the first open, since the person
  hasn't seen Setup; project checks in every git folder, which would put steps
  to do in the status bar of every repo opened.

## D-125 machine.json has one writer, under a lock, and every CLI test runs acc through cli() (2026-10-09)

GH-148, two points GH-131's review (D-123) left.

- **One writer for `~/.acc/machine.json`.** `setMachineKey` in core's
  `machine.ts` sets one key, or takes it out, keeping the rest of the file;
  `setHeavySlots` and `setMachineAgents` both call it, and with no home it
  refuses through `machineJsonToWrite`, as each did. Each wrote
  `machine.json.tmp` before, so two changes at once shared a temp file. Now the
  temp is named for its process (`machine.json.<pid>.tmp`), and the read, merge
  and write happen holding `machine.json.lock` (core's `withLock`, as the
  ledger's lock is). A temp of its own isn't enough alone: two processes that
  both read before either writes still each write back the other's old value.
  The test runs a slots setter and a total setter in two processes from the
  same moment, 300 changes each, reading its own key back after each; without
  the lock each lost 10 or more, with it none.
- **`cli()` takes spawn options.** `cli()` in `packages/cli/test/support.ts`
  takes them as its fifth argument, such as a timeout, beside the environment
  it adds over the tests' own. The autopilot `--every` test and
  `refusals.test.ts`, which built acc's environment by hand (refusals without
  the tests' own machine.json or repos list), use it. `support.test.ts` checks
  every CLI test file runs main.ts through `cli()` and none spawns node itself,
  but for a named list: `junk.test.ts` runs the built acc in a sandbox whose
  whole environment it makes up, and `launcher.test.ts` runs the launcher
  script. Each is pinned to what it runs.

## D-126 A GitHub Project's card follows its task's state, where the tracker says edits (2026-10-09)

GH-146. The author wants a GitHub repo's board to say where the work is, with
stages beyond Open and Closed (Todo, In Progress, Testing, Blocked, Done) from a
GitHub Project's Status field, without anyone dragging cards. acc already read a
Project's columns and could move a card by hand; now it moves the card itself as
the task changes state. It widens D-082's one change to a ticket, under the same
opt-in (D-066).

- **Only where the GitHub tracker says `"edits": true`,** the one that owns GH-
  keys, with a `github` account, and only for a task from one of its issues.
  Jira, Azure DevOps and monday.com are never moved: their status is the
  client's workflow.
- **The column is matched by name, ignoring case:** todo and ready go to Todo;
  running and rework to In Progress; review to Testing, or In Review where the
  Project has no Testing; blocked to Blocked; done to Done. The tracker's
  `statusFor` names a column per state (`{ "review": "QA" }`), and ready takes
  todo's when it names none. A named column the Project hasn't means no move,
  not the usual one: the person said which. A Project with no matching column,
  or an issue not on it, is left alone.
- **The Project is the board's:** the tracker's `board` number, else the repo's
  first open Project with a Status field, picked by the one `pickProject` the
  Tasks tab uses.
- **One write, the card's Status field,** with GraphQL's
  `updateProjectV2ItemFieldValue`, as the repo's account (D-007), after a read
  of where the card is; one already in its column isn't written.
- **On acc's own moves, after them.** The CLI notes each task's history before
  `acc set`, `done`, `block`, `dispatch`, `review`, `land`, `sync`,
  `intake github` and each autopilot pass, and afterwards follows the tasks
  whose history grew. A new task isn't a move. Reads move nothing: the
  Command Center's board and ticket reads, and `acc list` and `acc show`
  (D-012).
- **Once per state entered,** so a card a person drags on the Tasks tab stays
  where they put it: the drag moves the card as before, and acc doesn't move it
  again until the task changes state. Not chosen: a sync that put every card
  back in its state's column, which would fight each drag.
- **A failure never holds up the task.** The move has already been written;
  the card's outcome is kept on the task afterwards (`card`: the state, the
  column, when, and `failed` with gh's reason), as a `task.updated` event. The
  command that tried says it once on stderr, and `acc show` names it while the
  task stays in that state. It isn't retried: the next state change tries
  afresh. A card left alone writes nothing.
- **Checked:** `packages/core/test/cards.test.ts`, with a stand-in for gh's
  GraphQL: each state's column by name and in capitals, Testing before In
  Review, `statusFor` by name and ready's fallback, no matching column, an
  issue not on the Project and a named column it hasn't each make no write and
  leave the ledger alone, a failed write and a missing gh account leave the
  state moved and keep the failure, no `"edits"` or a task not from an issue
  calls no gh, and a GitHub board and ticket read write nothing;
  `statusFor` is checked, warned about off GitHub and written back.
  `packages/cli/test/cards.test.ts` runs acc with a gh on PATH: set, done,
  rework and block move the card one write each; list, show, status, ready and
  a sync that moves nothing call no gh and write nothing, and a dragged card
  stays put until the next move; a failed write is said once and shown by
  acc show; no `"edits"` asks gh nothing.

- **A first open before the checks finish waits for them (GH-149).** Until
  the window's first full check finishes, Setup has no machine results, most
  often in the first window after an upgrade, when GH-114's per-version cache
  makes the machine checks run again. A first open then waits for that check
  up to `FIRST_OPEN_WAIT_MS` (4 s), and lands where its results say. Still
  unfinished, it lands at **What kind of project is this?**, not **This
  machine**, so the one first open isn't spent on a machine that may well be
  ready; This machine's rows fill in when the check ends, and the status bar
  shows any step to do. A full check that got no machine rows, as when
  `acc doctor` fails and returns nothing, hasn't checked the machine either:
  it counts only when the check returned the machine's rows.
  `Setup.checked()` says whether one has, and `whenChecked()` waits for the
  first full check; `waitsForMachine` decides when to wait. Only a first open
  waits: one sent somewhere, a second open or a set-up folder opens at once.
  A click while it waits is that same first open, so a second click doesn't
  clear the jump to its part; something sent somewhere meanwhile, such as
  Connect a tracker, opens there, and the waiting open then leaves it be.
  `Setup.setUp()`, `isProject()` and `config()` now find `.acc/config.json`
  through one helper, `configFile()`. Checked in `first-open.test.ts`: the
  decision for an unchecked machine; the status bar menu's **Open the Command
  Center** and the launcher view becoming visible each land on Setup on a
  first open (the vscode stand-in now keeps a tree view's visibility
  listeners); and, through the built extension with an older version's ready
  results and a `claude` that answers after the wait, an early open opens no
  tab while it waits, a second click meanwhile shares it, and it lands at the
  question, jump and all, with the checks still running; with a `claude` that
  answers inside the wait, it lands at This machine, since `claude` fails; and
  with every `acc doctor` printing nothing, it lands at the question.

Note (D-126, 2026-10-09): a card acc couldn't move also shows on the Command Center's task page, as an
orange notice with the Project's icon beside "Checks failed on GitHub", in acc show's words, while the
task is still in the state the move was for.

## D-127 The Command Center has depth: wells set into the page, and raised cards and panels on it (2026-10-09)

The author found light mode too flat, and dark mode flat too: the page, the board's columns and its cards
were nearly one colour (light: white, then #f8f8f8 for both columns and cards).

- **Three levels.** Board columns are wells: a soft grey in light, darker than the page in dark (the
  theme's sidebar colour). Cards and panels are raised on the page: its own white in light, a shade lighter
  in dark, with a firmer edge and a soft shadow (the theme's widget shadow). They're mixed from the theme's
  colours, so Match VSCode works with any theme.
- **Light follows the rule for themes (GH-109):** Settings' Light, or Match VSCode while VSCode's theme is
  light (its class on body, only under data-theme="vscode").
- **A column that holds waiting work looks it.** A tracker column named Blocked, Stuck, On hold, Waiting or
  Impeded is orange with a blocked icon, though the tracker counts it as under way.
- **The Tasks tab says each thing once.** The board switch names a tracker's board by its kind (GitHub
  board), never by its title, which can match the app's own name; a place shows only when it narrows the
  board.

## D-128 A task's builder effort is picked like its model, and Haiku 5.5 replaces Haiku 4.5 (2026-10-09)

The author asked that each agent's model and effort follow the task at hand (GH-156), citing Anthropic's
guides on choosing a model and on effort. acc took a model per task (D-086), but effort only per clone or
project (D-036), though the guide calls effort often a better lever than the model, and its advice depends
on the model: Opus 5.5 defaults to medium, with xhigh for long agentic coding; Sonnet 5.5 suits medium for
well-specified agentic work and high for harder or longer; Fable 5.1 starts at high. D-086 had left "a
per-task effort" out; this adds it.

- **`acc dispatch <id> --effort <low|medium|high|xhigh|max>`** picks the builder's effort for this task.
  It's kept as the model is: `run.effort` and `run.effortPicked`, and `held.effort` while a dispatched
  task waits for others' files (D-093), so a re-dispatch, by a person or autopilot, a held start, a resume
  and the reply to its builder (D-060) use it until another is picked. Without one, the clone's or the
  project's effort applies, as before; with none set, `--effort` is left out and the model's own default
  applies. The run records the effort it started or resumed with, when one was named.
- **A pick can be cleared.** `acc dispatch <id> --effort default` drops the task's pick (`held.effort`
  keeps `default` while it waits), so the builder's own applies again. A model picked now that doesn't
  take the task's earlier pick drops it rather than refusing, and says so (`effortDroppedWords`, the
  outcome's `effortDropped`): without that, a person who picked Claude Haiku 4.5 through Another model…
  was refused with "leave effort unset", which nothing let them do.
- **A level the model doesn't take is refused before anything starts,** on every dispatch, re-dispatch,
  held start, resume and reply, not only one that picks a model or an effort: the pair the builder would
  get is checked wherever each is set, so a task's pick meeting a clone's model changed since is refused
  in acc's words, not inside Claude Code. The refusal names the levels the model takes, where the effort
  is set and how to change it (`effortFixWords`: the task's pick, or the builder's own in acc agents),
  and where acc's list came from and when. A resume and a reply check before any session is stopped.
  `acc agents set` refuses a name that isn't a level in the same words (`checkEffortName`).
- **acc's list of each model's levels is copied in,** not fetched (D-098): `MODEL_EFFORTS` in core's
  `efforts.ts`, from https://platform.claude.com/docs/en/build-with-claude/effort, read 2026-10-09
  (`EFFORT_SOURCE`). Not every model that takes `max` takes `xhigh` (Claude Opus 4.6, Sonnet 4.6 and Mythos
  Preview don't), Claude Opus 4.5 takes up to high, and Claude Haiku 4.5 takes none. Opus 5.5's and Haiku
  5.5's default is medium, the rest's high. A name is matched without a date or a context suffix; a model
  the list doesn't name, such as an alias, isn't checked: Claude Code decides. A newer model is an acc
  release, as a newer default model is (D-086).
- **Dispatch with… (Re-dispatch with… on a rework) asks for the effort after the model,** offering only
  the levels that model takes, and skipping the step for one that takes none, which drops a pick and
  says so. The task's pick comes first, when the model takes it, then the builder's own (this clone,
  project default, or Claude Code's default, named by the model's default level), each saying where
  it's set in the model choice's words (`FROM_WORDS`); after a pick, the builder's own says it drops
  it, and does (`--effort default`). The builder's own is left out when the model doesn't take it, since
  acc dispatch would refuse it. Each other level follows with its words (`EFFORT_WORDS`, which How
  agents run's Change… uses too), and the model's default says so. Choosing the effort it runs with
  anyway, on a task with none picked before, adds no `--effort`, so the task goes on following the
  settings.
- **The task page's Model and the Agents line show the effort** beside the model, only when one was
  named and isn't the model's default: `claude-sonnet-5-5 · xhigh effort`, `sonnet-5-5 · xhigh`. A review
  or an analysis runs with the reviewer's profile (D-052), so shows none.
- **Claude Haiku 5.5 (`claude-haiku-5-5`) replaces Claude Haiku 4.5 in the model choices** (Dispatch
  with… and Change…). A clone or project that names `claude-haiku-4-5-20251001` still runs with it, and
  How agents run says it's an older model and which replaced it (`OLDER_MODELS`).
- **Checked:** core's `efforts.test.ts` (the list's source, order and defaults; the refusal; which effort
  a builder gets); `dispatch.test.ts` (`--effort` reaches `claude --bg` over the clone's and the
  project's, a rework and a held start keep it, one nobody picked follows the clone's, a level the
  model doesn't take, or no level at all, is refused before a worktree is made, `--effort default` and a
  model that doesn't take the pick drop it, on a run and on a hold, and a re-dispatch naming neither is
  refused when the clone's model changed under the pick); `resume.test.ts` (a resume keeps a picked
  effort, records the clone's otherwise, and a resume or reply whose pick meets a changed model is
  refused before its session is stopped); the extension's `efforts.test.ts` (the picker's items, their
  words and order, the way back to the builder's own, its arguments, the skipped step's drop, and when a
  page shows an effort) and
  `settings.test.ts` (Haiku 4.5 is an older model). The screenshot fixtures' ACME-12 runs Sonnet 5.5 at
  xhigh, picked for it.
- Not chosen: picking an effort from the analysis's size, as D-086 declined for the model; a per-task
  fallback model; asking the guide at run time; dropping a pick that meets a clone's or project's model
  changed since, which a person didn't ask for, rather than refusing it; checking the pair in acc agents
  set, where no task's model is known.

Note (D-168, 2026-10-16): the effort is no longer a second picker. Dispatch's sheet shows the levels the
chosen model takes as a segmented control, lowest first, the one it runs with chosen and the picker's words
under it; a model that takes none hides it and says so, with the pick it drops. `dispatchEffortItems`,
`dispatchEffortArgs` and `noEffortArgs` are unchanged: the sheet's choice goes through them.

Note (D-127, 2026-10-09): tables are raised panels too, so Agents, Worktrees and the rest match the
Overview and Tasks. A `.grid` table's wrapper takes the raised surface, edge and lift; its column headings
are a band in a well, and Agents' repo headings are the same band, so each repo reads as a section. Sticky
action cells take the table's colour, not the page's. Environments' promotion paths sit in a panel of
their own, their branches in wells.

Note (D-127, 2026-10-09): a task's own page matches. The main column's sections (Description, Related,
the builder's note, Activity) are raised panels like the Details and Agent panels beside them, and an
analysis takes the same lift.

## D-129 A board click opens a task in a modal; the tab is one click away (2026-10-09)

A click on a card opened the task in a new editor tab, so looking at one task meant leaving the board and
closing a tab to come back (GH-158). Now a card's click opens the task over the board. This supersedes
D-029's bullet "Ticket pages stay separate tabs" for a click on the Tasks board only: several tasks still
open side by side as tabs.

- **What opens over the board.** A click on a card, acc's own or a tracker board's (GitHub, Jira, Azure
  DevOps, monday.com), opens the task's page in a modal over the Tasks board, a native `<dialog>` opened
  with `showModal()`. The board stays where it was underneath. Everywhere else still opens a tab: the
  Overview, the sidebar, the Agents page, notifications and the command palette.
- **It's the tab's page.** The modal is drawn by the task page's own renderer from the model its tab gets,
  and the ticket controller (`TicketPanels`) handles what it sends as it does for a tab: one record per
  page, drawn on its own tab or on the Command Center's. The Command Center's page hands the controller
  the messages that are the modal's first (`Panels.over`, `modalTakes`): those only a task's page sends
  (`ticket-action`, `update-edit`), and those for the modal's own task (an answer, an update, a command
  its tab may run). The rest, such as Open in GitHub or a related ticket, stay the page's. The modal
  redraws on the same signal as a tab, and its unsent edits count as a task page's (GH-46) until it
  closes.
- **Open as tab and Close** sit in its top-right corner. Open as tab closes the modal, then sends what a
  card's click sent before: `acc.task.show` from the agent board, the ticket from a tracker's. Close,
  Escape and a click on the backdrop close it. Focus moves into it when it opens and back to its card
  when it closes, found again if the board redrew meanwhile. The page closes it at once, without
  waiting for the browser's close event, which can come after the next open.
- **The board redraws under it without touching it.** A model the extension sends is the board's, and
  leaves the modal, its scroll and what's typed in it as they were; a redraw of the same model is the
  page's own, such as a fold opened in the modal, and draws the modal again with it, where it was
  scrolled. The modal's model is a message of its own (`task-modal`), and the extension draws it again
  when the page is rebuilt after its tab was hidden.
- **It's a raised surface,** with the depth tokens (D-127): `--raised`, `--edge` and `--lift`, over a
  backdrop mixed from the theme (`--backdrop`). Its panels stand a level higher again in dark. At narrow
  widths it fills the panel, less 12 px, and it scrolls inside itself.
- **Checked:** `task-modal.test.ts` (which messages are the modal's; a card's click gives the Command
  Center's tab the task's model and opens no tab; Open as tab opens the tab as a click did, and a
  closed modal isn't drawn again; it redraws on the tab's signal and when the page is rebuilt, and goes
  with the Command Center's tab; Make a task, an answer, each update message, and run and move reach the
  tab's handler and change what it changes); the screenshot run's `tasks-modal` drawing, light and
  dark, at 1000, 620 and 500 px, and in the colour check.
- Not chosen: a second panel beside the board, which would still leave the board; navigating between
  tasks inside the modal, or several modals at once.

Note (D-127, 2026-10-09): the accent lifts what was grey. A button is a raised surface with an edge and a
blue icon, tinted blue under the pointer; a primary one stays solid blue. Counts, code chips, question and
step numbers, mentions and avatars take a soft blue tint (`--accent-soft`, `--accent-edge`, mixed from
VSCode's link colour), not the theme's grey badge. Orange stays for what needs a person.

## D-130 Every test file names an edge case it covers (2026-10-09)

From repeated review findings (an empty result counted as finished, state wider than the active folder, a
choice cleared after it was made), the repo's own rules gain an edge-case rule: every test file has at
least one test whose name says which edge case it covers. `scripts/test/edge-cases.test.ts` checks it
against every file `npm test` runs. Its `OLDER` list names the test files that predate the rule and may
only shrink. A skipped or to-do test doesn't count. The check reads names, which is a weak signal; tying
it to the finding kinds is a follow-up.

## D-131 The Overview is a landing page: one line per item, detail on a click (2026-10-09)

The Overview had become the place where everything happened: it answered questions in full, drafted
updates, listed every suggested rule with each review behind it, and ran each builder's checks line by
line, rows running into each other. After the author accepted a batch of suggested rules it was one wall
of content (GH-160). The author: "The home page should be a landing page, not a place where deep detail
is given. Info should be surfaced, not richly displayed." Now the Overview says what's going on and where
to look, and the detail opens on a click.

This replaces, for the Overview only, what earlier decisions drew inline there: D-052's analysis questions
answered on the Overview (they're answered in the task's page, opened over it), D-066's update text, Post
and Discard on the Overview (they're in the Update drafts detail), GH-102's (D-116's) rule detail under
Needs you (it's in the Suggested rules detail), D-092's job rows under each task in In progress (a task is
one line, its checks one fact), D-037's History feed on the page (its last five, then History in full in
the modal), and D-129's bullet that the Overview opens a task in a tab (it opens it over the page, as the
Tasks board does).

- **One line per item.** Each line on the Overview has its state, as an icon and a label; its task's key and
  its title, cut with an ellipsis, all of it in the line's title; two short facts at most ("12 min",
  "near-tests running"); and one button. Any other action is in its ⋯ menu, VSCode's own, from the line's
  context (`menuButton`, `withMenu`): a task's line holds Watch, Watch the review or the analysis,
  autopilot's Output, Open in Claude Code, its pull request and Stop, each behind a flag (`TASK_MENU`, which
  package.json's `webview/context` lists under `webviewSection == 'task'`); an agent's is its Agents menu;
  the tidy-up's is Not now. Nothing else is drawn on the line: no update text, no rule detail, no list of
  checks, no question's options.
- **A card each.** A line is a raised card with the depth tokens (D-127, `--raised`, `--edge`, `--lift`),
  6 px from the next; no two share a bar or a border. Its left edge says its tone: orange needs you, blue is
  under way. The lists are headed, each with its count: Needs you (or All clear), When you have a moment,
  In progress, Merge queue, Ready for an agent, History. The header's summary and buttons, the tiles and In
  progress's machine line ("Builders: 6 of 6 · Load: busy") stay.
- **Things of a kind collapse into one line.** Every suggested rule and check: "10 suggested rules, from
  repeated review findings", with Review. Every update draft: "2 update drafts waiting to post", in Needs
  you while one waits on a person, with Review. A task's analysis questions: one line for the task, with
  Answer. The heading still counts each thing, as the badge does, though drafts share a line. Questions
  come first in Needs you, then the collapsed lines, so they're seen within the five.
- **Five to a list.** No list shows more than five lines (`CAP`); "Show all N" opens the rest: the list in
  the modal, Ready on Tasks, and History in full, with its filters, in the modal.
- **Detail opens on a click,** in the modal a task's page opens in over the board (D-129), now a shared frame
  (`modal.ts`), sized to what it holds. A question's line shows the question with Answer, which opens it with
  its answers and its box, answered exactly as the card on the page was. Review opens the suggested rules one
  at a time, each with its line, the reviews it came from, Accept… and its draft, and Dismiss, with Previous
  and Next; the update drafts the same, each with its text, who it posts as, and Post, Edit and Discard. A
  task's line, in any list, opens the task's page over the Overview; an answer or a command in History opens
  History at it. Which detail is open is kept in the tab's memory, so a redraw draws it again from the new
  model, and one whose items have all gone closes. Answer on Agents opens its question the same way.
- **In progress, a line per task.** What its first job is doing, for how long, and its checks as one fact
  ("validate running", "2 checks, 1 waiting"), never as rows. A click opens the task; its ⋯ menu's Stop names
  the line's jobs' stops, and asks which when there are several (`pickStop`). A job that ended stays a minute
  as a line that fades.
- **The landing page is a model** (`landing.ts`): `homeModel` works the lines out from what the Overview
  already held, which stays for the details. The page draws them (`webview/landing.ts`, `detail.ts`).
- **Checked:** the screenshot run's new `overview` geometry check: on the Overview no line is taller than
  44 px at any width it draws, no list shows more than five, and neighbouring lines are at least 4 px apart;
  the Overview with no lines fails, so it proves it ran. It failed on the Overview before this change (301
  findings dark at 1000 px alone: lines up to 160 px high, History 24 lines, rows 0 px apart) and passes now.
  A busy Overview fixture, `overview-landing` (ten suggested rules, six tasks building with their checks,
  three questions, two update drafts, twelve things in History), and the same with a question, the update
  drafts and History opened over it, drawn light and dark at 1000, 620 and 500 px; `rules` and
  `rules-accept` open the Suggested rules detail. `landing.test.ts`: rules and drafts collapse with their
  count, the cap and Show all, each detail opens with the actions it had, the checks fact, the task menu
  against package.json and Stop's pick, and nothing is lost: every action the Overview offered on three
  fixtures (219 of them) is still a line's button, its ⋯ menu, or what the detail it opens holds.
- Not chosen: a page of its own for In progress or History, which the ticket left to the modal; dropping
  the In progress fold; an in-page menu in place of VSCode's own, which the rest of the page uses.

## D-132 The Command Center speaks in processes, not commands (2026-10-09)

The Command Center talked to people in its own internals: "run `acc gate run`", a task that "ended before
acc done or acc block", "see `.acc/config.json`" (GH-163). The author: "I don't want to see 'run acc do
xxx', but rather 'finalize deployment' or whatever applicable language." Now it names the process a
person runs, and the file by what it is.

- **One vocabulary.** `extension/src/logic/processes.ts` holds it, and it's the only place the extension
  maps a command to words. `PROCESSES` gives every command and subcommand acc's own registry lists (its
  `entryPointsOf`) a name, a verb first, in the button's words where a button does it: Run the checks,
  Finish the task, Mark it blocked, Open its pull request, Refresh from GitHub, Deploy to <env>, Promote,
  Bring in tickets, Check the setup, Set up this project, Import the team's rules. Where the extension has
  an acc.* command that does it, the row names it. `FILES` names each file a person is told about: the
  project's settings, this machine's settings, the project's rules, the first-run checklist, the
  onboarding guide. The table is TypeScript in `logic/`, not a file in `extension/commands/`, which the
  build reads as package.json's contributions: the models, the page, the notices and the tests all import
  it. It sits beside the command registry by naming, for each process, the registered command that runs
  it. `acc.doctor`'s title is now "Check the setup", its process's name.
- **The extension's own words use it.** Every notice, quick pick, tooltip, empty state, Setup step, error
  and status line that named a command or a path now says the process or the thing: "Changed in the
  project's settings: commit the change to share it", "its turn ended before it finished or blocked", "It
  moves to done at the next refresh from GitHub". Where it asks a person to act it offers the button: a
  Setup step whose fix is acc's shows "Do it: Compare the rules with their source." beside **Do it**, not
  the line it runs; another tool's line, such as `brew install gh`, is still shown to copy. The
  walkthrough's pages say the same. A run in the output panel is labelled by its process.
- **What acc says is translated at the boundary, by one translator.** `inProcessWords` rewrites each acc
  command a message names into its process ("Run acc gate run first." reads "Run the checks first.";
  "acc land does that" reads '"Open its pull request" does that') and each path into its name, with the
  verb agreeing ("the project's settings name the checks"). "acc" as the tool's name, as in "acc drafted
  it", stays. It runs where acc's words reach a person: `accSays` and the other places the extension
  shows a command's refusal, Setup's step details and reasons, the walkthrough, a hook's reason in
  History and on an agent's page, autopilot's refusal and the last line it printed (in its notice and
  the status bar), and a tracker's error on its board or a task's page. Chosen over a
  person-facing form for each of core's messages because those messages are also what the CLI prints in
  a terminal and what agents read, both out of scope here; there are hundreds of them, and a second form
  beside each would drift from the first. One translator keyed off the same table keeps one mapping, and
  a command acc adds is covered as soon as it has a row, which `processes.test.ts` requires. The cost is
  grammar: a process named mid-sentence reads in quotes.
- **What acc recorded is translated where the extension reads it.** acc writes reasons into the ledger
  and its events with its commands in them: a step autopilot couldn't take ("Run acc gate run in its
  worktree, or waive them, then review."), a held task that couldn't start, a builder's block. These
  reach a person through many views (a notice, History, a card, the Overview, a task's page), so
  each kind is put in process words once, where it's read, by `extension/src/logic/relayed.ts`: the
  hub's `autopilotLog` hands out each step through `stepInWords`; `deriveRows` builds each task's row
  through `rowInWords` (why autopilot couldn't take a step, why a held task couldn't start, why the merge
  queue holds it, its review's summary, what its stopped builder last said); a task's page and its
  document put its blocked reason, its moves' reasons and its card's failure through `reasonInWords`;
  and a held dispatch's failure is said that way in its notice. Chosen over translating in each view,
  which is a dozen places, and a new view would have to remember. The screenshot fixtures pass their
  sample rows and steps through the same functions, so the words check reads what the boundary makes:
  ACME-25's review refusal and ACME-12's builder's block name `acc gate run` as acc writes them. A
  reason is translated whoever wrote it, acc, autopilot, a reviewer, a builder or a person, since it's
  the line a person acts on, and the translator rewrites only acc's commands and paths. The record the
  log keeps is left as acc wrote it: `stepInWords` returns a copy, once for each record.
- **What stays literal, by name.** On the page, work data, in regions marked `data-work`
  (`work()` in `dom.ts`): `files` (the files a task conflicts on or shares with another, an analysis's
  files, a finding's place), `branch`
  (branches and worktrees), `transcript` (an agent's transcript on its page, the command it ran or asked
  to run, its note, a review's findings), `output` (check and command output, and the output panel), and `agent-text`
  (a rule's line, the builder's instructions on its page). `WORK_DATA` in `extension/scripts/words.ts`
  says why each stays; `MARKS` in `extension/test/words.test.ts` pins every place the page marks one, by
  file and kind. In the extension's code, `LITERAL` in the same test names the lines that may still hold
  a command or a path: the vocabulary itself, a name looked up by its path, a command line run in a
  terminal or the output panel, a file the code reads or watches, who acc records made a change, and the
  extension's own log. Text for agents (packets, the finish line, rules, review prompts) and the CLI's
  terminal output are core's, and unchanged.
- **Checked.** The screenshot run gains a `words` check: each drawing gathers every string it holds,
  shown or folded away, with each element's title, aria-label, placeholder and alt, and fails on `acc`
  followed by one of acc's commands, `npm run`, a `.acc/` path, a `docs/` page or the packet, outside
  work data. It counts what it read, fails a drawing that gathered none, fails a run in which a kind of
  work data held nothing, and has a floor (`RUN_FLOOR.words`, 76400). It failed on the pages before this
  change, with 177 findings dark at 1000 px alone, and passes now: all 342 drawings read 76564 strings
  with no finding, drawn in seven groups of pages since Chrome hit its 30 s limit on a loaded machine,
  with each check's total over its floor. `processes.test.ts`: every command acc has has
  a name; no name is empty, a command line, a path or another's; the ticket's names; each process's
  command is declared; a sample of core's messages comes through with no command or path left.
  `words.test.ts`: the rules, work data counted and never judged, `MARKS`, a scan of every line of the
  extension's code against `LITERAL`, the walkthrough, and the commands and settings VSCode lists.
  `relayed.test.ts`: core's own refusals (review's, land's, autopilot's, a dispatch held for its
  analysis) and a builder's block come through with no command or path left; a failed autopilot step
  reaches its notice, History, its card and the Overview in process words, and so do a hold, a review's
  summary and a stopped builder's last words; `deriveRows` and the task page translate; a step with no
  reason, an empty one and text naming no command are left as they were, as are a row's files and
  branch; and the hub and the screenshot fixtures read through the boundary. Translators that return
  their input unchanged fail five of them; taking out the boundary's three call sites fails three. The words check found five strings naming `acc gate run` in four
  drawings at 1000 px dark (ACME-25's card on the Tasks page and in its modal, ACME-12's move there and
  on its page, and History) before the boundary, and none after.
- Not chosen: translating the whole model as it's sent to the page, which would rewrite the work data;
  renaming acc's commands; a person-facing form for each of core's messages.

Note (GH-168, 2026-10-10): Setup and the settings speak in processes too. The words check looked only for
`acc <word>`, `npm run`, `.acc/` and `docs/*.md`, so two kinds of literal stayed: another tool's command line,
and config keys. This note supersedes the line above that another tool's command, such as `brew install gh`, is
"still shown to copy".
- **A step says what Do it does, and keeps its command line to show on request.** `toolLineDoes` in
  `processes.ts` names each line the steps give, as acc's own are named: `claude plugin marketplace add … &&
  claude plugin install …` is "Install the acc plugin in Claude Code", `claude plugin enable …` is "Turn on
  the acc plugin in Claude Code", `gh auth login` is "Sign in to GitHub as this repo's account". Setup shows
  "Do it: <that>." beside the button, and the line itself behind a folded "Show the command", marked as
  work data (`output`, one more place in `MARKS`), for someone who runs it by hand. Advice that isn't a
  command ("Remove them, rotate the credential…") is still shown, since there's nothing to fold. A command
  line with no entry in `TOOL_LINES` is shown as before and fails the words check if it's a claude or gh
  command, so a new one gets its words when it's added; the test runs every fixed command a step carries and a line for each way a check works one out.
- **Config keys are words, from one table.** `extension/src/logic/config-words.ts`, beside `processes.ts`,
  names every key acc's schema knows (`CONFIG_KEYS`, 64 of them, 58 dotted): `gates.required` is "its required checks",
  `agents.max` is "its builder limit", `gates.ratchets` is "its floors". It's typed over `CONFIG_KEYS`, so tsc
  refuses a key with no name and a name for a key that's gone. `inProcessWords` calls `inConfigWords` first,
  so every message from acc reaches a person with its keys in words ("differs on its required checks, its
  builder limit"); a key in parentheses that only says where a setting is kept ("its cap is 6
  (agents.max).") is dropped, since the sentence names where. The extension's own text no longer carries a
  key. `agents.cloud`, which the ticket named, wasn't a key this acc read when this was built; GH-69 (D-140)
  merged first, and at this merge its four keys got names: `agents.cloud.routine` is "its cloud routine",
  `agents.cloud.default` "where its builders go by default", `agents.cloud.quietMinutes` "how long a cloud
  builder may be quiet", `agents.cloud.max` "its cloud builder limit". Its `claude auth login` step is
  "Sign in to Claude Code with your claude.ai account", and Settings' lookup of `agents.cloud.routine`
  joins `autopilot.autoMerge` on `LITERAL`'s line for a setting looked up by its key.
- **GitHub commands in acc's messages are said as what they do.** `gh auth login` reads "sign in to
  GitHub"; `gh auth switch -u X` reads "switch GitHub's active account to X"; `gh auth refresh -s project`
  reads "give it access to Projects". A GitHub Project's notice on a board now goes through `inProcessWords`
  like the rest of what acc says; it reached the page as acc wrote it. The core messages stay as they are: the
  CLI and agents read them literally.
- **Checked.** The words check (`words.ts`) also fails on a `claude <subcommand>` line, a `gh
  <subcommand>`, and a dotted config key taken from the schema, each outside work data. It failed on the
  pages before this change, with 174 findings in 342 drawings (Setup's `claude plugin …` line and the
  `gh auth` in a step's tooltip, the template step's `gates.required`, `agents.max` on Settings and the
  Overview, and a Project notice's `gh` commands), and passes now: all 342 drawings read 76670 strings with
  no finding. `config-words.test.ts` pins every key's name, how the words reach acc's text, what each tool
  line is named, the Setup row, and the three rules with their edge cases. The walkthrough's pages
  (`stepMedia`) still show another tool's command in a bash block, which `words.test.ts` has always
  exempted: a page that opens beside the step, for someone following along in a terminal. A fix's text that
  ends "In a terminal: <command>." keeps that command there too, in its own bash block: the GitHub sign-in
  steps' pages had lost it to the `gh auth login` rewrite (found in review, fixed at merge).
- **Two lines joined `LITERAL`** in `words.test.ts`, the list of source lines that may name a command or key
  because no person reads them: `runs.ts`'s `needsTerminal`, which matches the claude lines that need a
  terminal, and `settings.ts`'s `autopilot.autoMerge`, the key the code finds that setting by. The list is
  meant only to shrink; these two are code, not words on a page.

## D-133 The screenshot run retries a drawing Chrome didn't finish, and measures a tab once it has settled (2026-10-10)

While builders ran their checks, the screenshot run failed for reasons that weren't layout (GH-167):
twice "Chrome didn't finish <page> within 30 s: spawnSync nice ETIMEDOUT", and once "the selected tab is
outside the rail's visible part" on Settings → About (dark, 620 px), which passed on two reruns with
nothing changed. Each cost a rerun of every drawing.

- **A drawing that times out is drawn once more, never silently.** `extension/scripts/steady.ts`'s
  `drawRetrying` runs a drawing again only when it timed out (`ETIMEDOUT`); any other error, and a second
  timeout, fail the run as before. Each retry prints a line naming the drawing, and the summary line ends
  with how many were retried and which ("Retried no drawings." when none were), in both the geometry run
  and the colour check.
- **The time allowed is set by an environment variable, with a longer default.** `ACC_SHOT_TIMEOUT`
  gives each drawing's limit in whole seconds; unset or invalid, it's 60, twice the old 30. It doesn't
  scale with the heavy-check slots in use: the run would have to read the machine's slot state, the load
  that slows Chrome isn't only heavy checks, and a fixed limit keeps a run's outcome independent of what
  else happens to be running. A person on a busy machine sets the variable.
- **The tab check measures after the page has settled.** After its fonts load and two frames draw, the
  page now waits until the rail's selected tab (its box and the rail's scroll) has held still for three
  frames in a row (`SETTLE_FRAMES`) before measuring, at most 60 frames (`SETTLE_LIMIT`, about 1 s on
  the run's 16 ms frame timer). A tab still moving then is measured where it is, so a real misplacement
  still fails; so does one that settles outside the rail.
- Evidence: `extension/test/steady.test.ts` adds 7 tests: a drawing that times out once is drawn again,
  passes and is counted and said; one that times out twice fails, drawn twice only; one that passes or
  fails for another reason is never retried; the timeout's default and variable; a tab scrolling into
  view is measured once settled and passes; a tab settled outside the rail fails, and one that never
  settles is measured at the limit; a page with no tab doesn't wait. `geometry.test.ts` pins that the
  page settles before measuring. Settings → About and the Overview, drawn in Chrome at every width and
  theme, measured with no finding and no retry.
- Not chosen: scaling the timeout with the heavy-check slots; retrying more than once, which would hide
  a page that really hangs; changing the rail's own `showSelected`, which is the page's behaviour, not
  the run's.

## D-134 Every export is named by a test (2026-10-10)

From repeated review findings (a criterion with no test, a guard tested for one of the forms it catches, a
step that finishes during a wait, a dialog nothing drives in a browser: 7 findings across 6 tasks), the
repo's own rules gain a test-coverage rule: each acceptance criterion, and each case a guard or branch
handles, gets a test that fails without it, and every function, constant or class a source module exports
is named by a test. `scripts/test/coverage.test.ts` checks the second half against every module in
`packages/*/src`, `extension/src` and `extension/webview`, comparing git's list with the modules on disk.
It walks 1303 exports in 195 modules, an overloaded function once and a local `export { … }` list by the
names it exports. Its `OLDER` list names the 384 exports, in 121 modules, that no test named when the rule
came in, and may only shrink. A comment that starts a line doesn't count as naming one.
- Not chosen: line coverage from `node --test --experimental-test-coverage` as a floor, which would run the
  whole suite under instrumentation in the lighter checks; it stays a possible follow-up. The criteria and
  the cases a guard handles are left to the reviewer: no check reads a task's criteria yet.

## D-135 Usage is spent where it pays: medium by default, up only for cause (2026-10-10)

Once acc could pick each task's model and effort (D-128), usage rose sharply. Large tasks ran on Opus 5.5 at
xhigh, cloud builders ran three times on Fable 5.1, every review ran at high effort (2026-10-09), extra
Fable guardrail reviews ran on top, and five builders ran at once. The author asked to conserve it.

- Reviews run at medium (`agents.reviewer.effort`), Opus 5.5's own default. A change to what agents may
  do gets a high-effort review, picked for that task.
- At most three builders run at once (`agents.max`), unless the author asks for more.
- Builders default to Sonnet 5.5 at medium for small, well-specified tasks, and Opus 5.5 at medium for
  the rest. xhigh is for a second rework, and Fable only for a change to what agents may do.
- Whoever merges fixes a review's small findings at the merge, rather than sending the task back for a
  builder run.
## D-136 The modals' behaviour is checked in a browser, and each case is shown to catch a stub (2026-10-10)

The task modal over the Tasks board (D-129) and the Overview's detail modal (D-131) were checked by hand:
Escape and the backdrop closing them, focus going back to what opened them, a redraw under them leaving
them as they were, a fold redrawing them, Show all, and the suggested rules' Previous and Next (GH-170,
a follow-up from GH-158's review). Now a script checks each, in headless Chrome, beside the screenshots.

- **Where it runs.** `extension/scripts/behaviour.ts`. A full run (every page, both themes and all
  three widths, as `npm run screenshot` with no options draws) runs it after the shots; `npm run screenshot -- --behaviour` runs it alone. Like the
  geometry collector (GH-105), each case is a page of the built webview from the screenshot fixtures
  (the Tasks board, and the busy Overview of GH-160), dumped with `--dump-dom`, and the page writes what
  it found into a JSON script element. The page's VSCode API keeps what the page sends and remembers, as
  VSCode does; the screenshot pages' doesn't keep the tab's memory, which a fold needs.
- **What it checks: 12 cases, 84 checks.** The task modal: Escape closes it, tells the extension once,
  and sends focus back to its card; a backdrop click closes it, a click inside or a press inside released
  on the backdrop doesn't; Close sends focus to its card on a board redrawn under it; a new board model
  leaves it open, at the same `scrollTop`, with the comment box's text, focus, and element; Show all on a
  fold in it draws it again unfolded. The detail modal: Escape closes it, the tab forgets it, and focus
  goes back to Review; the backdrop the same, opened by the line itself, and focus goes back to the line;
  a new model leaves it open on the same rule, scrolled, with the rule draft's text and focus, and focus
  then finds Review on the redrawn page; Show all on Needs you opens all 19 lines where the page shows 5;
  Previous and Next walk the ten rules to each end, off at each end; Accept and Confirm on the second rule
  send the message the inline Confirm sent (D-116), and its reviews' Show all draws it again with all
  five. What each case expects comes from the same fixtures (`behaviourData`): the rules' order and lines,
  the list's count, each Accept's message.
- **It proves it ran.** A case that wrote no report, checked nothing, or stopped on an element it couldn't
  find fails, never skips; a run of no cases fails. Every message a page sent must pass the extension's
  own check (`isFromWebview`).
- **It catches stubs.** Each of 16 mutants builds the page with one change to its source (esbuild, the
  file's text replaced where it's found exactly once), such as an Escape handler that does nothing, a
  backdrop click that does nothing, a drag out of the modal that closes it, focus left where it falls,
  the task modal drawn again with every board model or not with its own fold, the detail scrolled to
  its top, a draft that forgets what's typed, Show all opening only the first five, Next or Previous
  staying put, the first rule shown whatever the pager says, and Confirm leaving out the check. The run
  fails unless every case a mutant names fails on it, and on a mutant whose change no longer matches its
  source exactly once. All 16 are caught. `behaviour.test.ts` checks, with no browser, that each mutant
  fits its source and that every case is named by one, so a change to the page that moves a mutant's text
  fails near it (a row in `READS`, `scripts/near-reads.ts`).
- **Escape and the backdrop as the browser sends them.** A page's script can't press a key, so Escape is
  the cancel event Chrome fires on a modal dialog for it, followed by the browser's own close when nothing
  prevented it; a backdrop click is a mousedown and a click on the dialog outside its box. Hence the
  mutant is an Escape handler that does nothing rather than one taken out: with the cancel listener taken
  out, the task modal still closes through its close listener, as it would for a person, and its Escape
  case passes. The detail case fails on that one too: in the run, no close event reached the detail's
  dialog, so the tab kept it open in its memory.
- **What it found.** The detail modal sent focus to the first element marked as opening it, which is the
  line, when its Review button had opened it. It now remembers which kind of element opened it and goes
  back to that one, found again by its `data-opens` after a redraw (`detail.ts`). A task's description
  doesn't fold in Chrome: the clamp on a document of blocks leaves it its full height, so its Show all
  takes itself away. The fold case uses a step's reason in Activity, which folds; the description is
  left for a task of its own.
- Not chosen: driving Chrome through its DevTools protocol for trusted key presses, which would bring a
  client and a second way to run Chrome for one event; running the cases in the unit tests, which run
  without Chrome.
## D-137 A test run removes the temp folders it makes, and B0.repo reads a crowded folder only in part (2026-10-10)

On 2026-10-10 `packages/core/test/onboarding.test.ts` timed out at 300 s on every run (GH-174). The
system temp directory held 347,799 entries, most of them folders the tests had made and never removed,
and B0.repo's `nearbyRepo()` listed every one of them whenever a test handed it a fresh temp folder.

- **Each test process makes one root and removes it on exit.** `packages/core/test/temp-root.ts` makes
  `acc-run-<pid>-XXXXXX` under the system temp directory when a test file first imports it (through
  `support.ts`), and removes it on `exit`, which a failed test still reaches, and on SIGINT, SIGTERM and
  SIGHUP. After a signal it sends the signal again to end the process, unless the code under test listens
  for it too; that listener then decides, and isn't reached twice. `tempDir()` makes its folders inside it. It also sets `TMPDIR` to the root, so the folders the
  code under test and the programs it starts make with `tmpdir()` land inside it too.
- **Tests make temp folders only through `tempDir()`.** The test files that called
  `mkdtempSync(join(tmpdir(), …))` themselves (`extension/test/activate`, `activity`, `progress`, `slack`;
  `scripts/test/areas`, `settings`) now call `tempDir()`. The scripts the tests run (screenshot,
  packaging) and the source code already remove their own temp folders in a `finally`; they ship, so
  they don't import test support, and under a test they now make them inside the root.
- **`nearbyRepo()` reads at most 200 entries of the parent (`NEARBY_LIMIT`), and none when the parent is
  the system temp directory** (compared through `realpath`, as macOS's `/var` is `/private/var`). It reads
  with `opendirSync`, so a crowded folder is never listed whole. A project's old folder sits among a
  person's folders, not among hundreds, so the limit doesn't hide a real neighbour; nothing in the temp
  directory is a project's repo.
- Evidence: `packages/core/test/temp-root.test.ts` adds 6 tests: the root's place and name; a child test
  file run with `TMPDIR` set to an empty folder leaves it empty when its tests pass, when one fails, and
  when the process is ended by SIGTERM, with or without its own SIGTERM listener; and a source check that fails on `mkdtempSync(join(tmpdir()` in
  any test file but `temp-root.ts`, counting the files it read and failing unless there are more than 50. Turning off the
  removal on exit fails two of them. `onboarding.test.ts` adds 2: a folder with 5,000 sibling folders
  gives 200 to look at and is answered within a second; a repo in the temp directory isn't offered, and a
  missing folder gives none.
- Not chosen: a global setup file passed to `node --test` (`--import`), which every way of running a
  single test file would have to repeat; removing old folders from the temp directory at start, which
  would reach into other runs' and other programs' folders.
## D-138 A builder's screenshots gate checks the UI was shot as it is (2026-10-10)

From repeated review findings (13 across 11 tasks, 2 of them must-fix): CLAUDE.md asks that UI changes
be looked at before they ship, and reviews kept finding shots on disk older than the change (GH-41,
GH-83), shots that stop above the new part at 900 px (GH-41, GH-46, GH-76), a new line or state no shot
draws (GH-32, GH-52), and one theme shot at one width only (GH-95). Nothing can tell whether a person read
a PNG, but a gate can tell whether the PNGs there are to read show the branch as it is.

- **The run notes each shot.** `npm run screenshot` writes `shots.json` beside the PNGs, written whole
  through a temp file, merged with what earlier runs noted, so a run split into groups of pages counts:
  for each shot, the PNG's sha256, the fingerprint of what it drew, its geometry findings, and every
  class on a visible element drawn inside the window, which the page's geometry collector now gathers.
  A shot at another `--height`, or started from `ACC_SHOT_STATE`, isn't noted.
- **The fingerprint is what the pages draw from** (`fingerprint()` in `screenshot.ts`): every file of
  the webview's source, the pages, widths and heights, and each page as it's handed to Chrome in each
  theme, with its sample model and starting state, at a still clock. A change to the page, its model,
  its fixtures or the run's checks changes it.
- **The gate** (`screenshots`, a builder's check, `extension/scripts/looked.ts`). When the branch changes a
  file under `extension/webview/`, `extension/src/` or `extension/scripts/`, every usual shot (each page,
  dark and light, at 1000, 620 and 500 px) must be noted with this commit's fingerprint and no geometry
  findings, and its PNG must still be the one noted. Every CSS class the branch adds to the webview's
  stylesheets must be drawn on screen in one of them, or be named in `UNDRAWN` with why; a name there
  that no stylesheet holds fails its test. It counts the shots and classes it checked, fails on a branch
  that changed nothing, and fails run by hand without `ACC_CHANGED`. A branch that changes none of those
  folders passes, saying how many files it checked. The merge queue's checkout has no screenshots, so
  the full check doesn't run it.
- **Checked.** `extension/test/looked.test.ts`: a branch shot as it is passes with its counts; no files
  changed, no shots, a stale shot, a missing one, one with findings, a PNG gone or changed since, a new
  class drawn nowhere (or only in a stale shot), and no usual shots each fail; `UNDRAWN` excuses by name;
  a branch that changes nothing the pages draw from passes; the class reader skips declarations, comments
  and strings; the fingerprint is the same twice and changes with one byte or a file taken away; notes
  merge and an unreadable record starts empty. This branch changes the screenshot scripts, so its own
  gate held it until a full run: one run took all 342 shots with no geometry findings, noting 572
  classes drawn, and the gate passed, checking 342 shots. With a class added to `styles.css` by hand,
  it failed on all 342 shots being of other code and on the class drawn in none.
- Not checked: that a person read the PNGs, or that they look right (spacing, alignment). A class drawn
  only by the extension's host (a notification, GH-28) can't be shot. A change in `packages/` that
  reaches the page through the model is drawn into the fingerprint but doesn't make the gate ask for
  shots, since the gate asks only for changes under the three folders.
- Not chosen: running the screenshots inside the gate, which takes Chrome tens of minutes; a hand-kept
  list of pages each change must show.
- Note (T-13, 2026-10-13): the stylesheets the gate counts as there before the branch are read through
  the same list as the page's (`styleNames`, which `styleFiles()` uses), at the commit the branch began
  from. Before, any `.css` in the webview's folder counted, so a class held only by a stray stylesheet no
  module is named for, and never part of the page, didn't count as new. `looked.test.ts` pins it.
## D-139 Every rule in the repo's own rules names its check (2026-10-10)

From repeated review findings (a test meant to stop a split from dropping a command read source text with
a regex, a per-area check hard-coded its kinds instead of reading the list it claimed to check, a pinning
test matched one variable name only), the repo's own rules gain: every rule gets a check before anyone
relies on it. `scripts/test/rules.test.ts` reads each rule in `.acc/rules.md`, counts them, fails on none,
and fails a rule that doesn't name its check beside it ("Checked by" a test file) where that file is one
`npm test` runs and declares a test (`test(` or `it(`) named for `.acc/rules.md` whose body names that file's own path (a
mention in a comment, or in another test's body, doesn't count). Its `UNCHECKED` list names the rules that predate
this one and may only shrink: each must still be in the file and still name no check. At merge it held five:
the words rule, the finishing-note rule, and the constant, comment and helper rules (T-8, T-9, T-6) that
merged just before it. The check reads the named test's source: it sees that the test pins itself beside
the rule, not that the test is a strong one; the
findings behind it were weak checks, which stays a reviewer's call.
## D-140 Cloud builders: an option for any project on GitHub, never the default (2026-10-09)

A task's builder can run as a Claude Code cloud session instead of a `claude --bg` session on this Mac
(GH-69). Builders here share the Mac's CPU, stop when it sleeps (D-067), and are capped at `agents.max`.
This supersedes the issue's earlier block (2026-10-06), which asked for `claude --cloud` started from a
terminal and followed by teleport: the author now wants the version acc can start and follow on its own,
through GitHub, with the gaps named. A local builder stays the default everywhere; a project that hasn't
opted in sees no change, and a local dispatch passes exactly the arguments it did before.

- **What Claude Code allows, verified on 2026-10-09.** The docs at code.claude.com/docs/en/routines,
  /claude-code-on-the-web and /cloud-environments were read that day through the fetch tool, and the
  installed CLI (`claude --version`: 2.1.296, at /opt/homebrew/bin) was read through `claude --help` and
  `claude -p --help`, `claude auth status` (signed in, claude.ai, a Team plan) and the strings of its
  binary (`strings` on bin/claude.exe, grepped for the flags and messages below). What held:
  - **Starting.** `claude --cloud "<task>"` creates a cloud session from the current folder's GitHub
    remote and is interactive only; `--cloud <session>` without `-p` answers "Attaching to an existing
    cloud session is not enabled for your account" (in the binary). The hidden `--on-branch <branch>`
    exists, with the error "--on-branch resumes work on a branch in a cloud session; pass --cloud or
    --environment". A script starts a session only by firing a routine's API trigger: `POST
    https://api.anthropic.com/v1/claude_code/routines/<trig_id>/fire` with `Authorization: Bearer
    <token>`, `anthropic-beta: experimental-cc-routine-2026-04-01` and `anthropic-version: 2023-06-01`,
    an optional `text` in the body, and a reply of `{type, claude_code_session_id,
    claude_code_session_url}`. The routine (repo, model, environment, setup script) and its token are
    made by a person at claude.ai/code/routines; the token is shown once; the CLI can't make or revoke
    one. There is no per-fire branch, model, effort or permission mode: a routine runs without a
    permission picker. Limits: 30 fires an hour per routine, 100 per account. The `text` reaches the
    session wrapped in a `routine-fire-payload` block marked untrusted, so the routine's own prompt must
    say to act on it. The binary holds no routine-fire strings: the CLI doesn't fire routines itself.
  - **State.** Nothing lists cloud sessions or their state. `claude agents --json` lists background and
    interactive sessions on this machine only.
  - **Messages.** `claude -p "<msg>" --cloud <session id or URL> --output-format json` queues one message
    and returns `{ok, session_id, url}`; it needs `claude auth login` with a claude.ai account.
    `claude --teleport <session>` pulls a session into a checkout of the same repo.
  - **Work coming back.** The session pushes to GitHub through Anthropic's git proxy, which refuses only
    tag pushes and branch deletions. A routine's session pushes a `claude/…` branch unless its prompt
    names another; GitHub's branch rules apply to the connected GitHub access.
  - **Environment.** Ubuntu 24.04 on x86_64, Node 20, 21 and 22 (22 on PATH) with npm, network access
    None, Trusted (package registries, GitHub, cloud SDKs: no `*.my.salesforce.com`) or Full. The
    repo's `.claude/settings.json` hooks and rules load in a one-repo session, SessionStart hooks
    among them; plugins don't, user settings don't. `CLAUDE_CODE_REMOTE=true` is set in a cloud session
    (docs, and the binary). Permission modes are a session's own; a routine's run has none to pick.
  - **Billing.** Usage counts against the subscription's limits; no separate charge.
  - **Read again on 2026-10-10,** for the rework, through the fetch tool on the same three pages, `claude
    --version` (2.1.296 at /opt/homebrew/bin, a symlink to the package's bin/claude.exe), `claude -p
    --help` and `grep -a` on that binary: the fire endpoint, headers, body, reply, limits (30 an hour per
    routine, shared with Run now; 100 an hour per account for API fires) and the `routine-fire-payload`
    wrapping hold; the routine's model is picked on the routine and used on every run, so a fire can't
    set it; each repository is cloned from its **default branch** and the prompt names another, so the
    session loads the repo's `.claude/settings.json` hooks from the default branch first and from the task
    branch once it checks that out (the hooks docs say edits to hooks in settings files are picked up by
    the file watcher); `.claude/settings.json` hooks and permission rules load in a one-repo session, plugins
    don't; Ubuntu 24.04, Node 20, 21 and 22 with 22 on PATH; the GitHub proxy rejects branch deletions and
    pushes of anything but a branch, doesn't limit which branches a push updates, and **rejects GraphQL,
    so `gh pr` and `gh issue` get a 403 in a cloud session**; GitHub's branch rules apply to the connected
    access, so a rule that access can bypass doesn't block a run's push; `CLAUDE_CODE_REMOTE_SESSION_ID`
    is the documented mark of a cloud session, and the binary tests `CLAUDE_CODE_REMOTE==="true"` too; a
    hook's input carries `session_id`, `transcript_path`, `cwd` and `permission_mode`, exit 2 blocks the
    call with stderr as the message, and `$CLAUDE_PROJECT_DIR` is the project root the session started
    in; `claude -p "<msg>" --cloud <session> --output-format json` answers `{ok, session_id, url}`.
- **Opting in.** `agents.cloud` in `.acc/config.json`: `routine` (the trigger id), `default` (`local`,
  or `cloud`), `quietMinutes` (120) and `max` (3). `acc cloud enable [--routine trig_…]
  [--default-place local|cloud] [--max n] [--quiet-minutes n]` writes it, key by key, and the push
  guard; `acc cloud disable` takes the section out; `acc cloud` says what's on and what's still missing.
  Settings' **How agents run** has the switch per project, a person's choice, with what it needs and
  what's missing, the routine prompt to copy, the token and the default. It's offered only where the
  config has a `github` section; elsewhere the control is disabled with the reason, "Cloud builders need
  the repo on GitHub". Setup's B15 steps check the rest, each with its guide: the Claude GitHub App on
  the repo (or `/web-setup`, which acc can't see, so a person ticks it), the routine, its token, the
  claude.ai sign-in and the committed guard.
- **The token** lives in the macOS keychain (`security`, service `acc-cloud-routine`, account the repo),
  written through `security -i`'s stdin so it never goes on a command line, never in
  `.acc/config.json` or git. `acc cloud token` reads it from stdin; the Command Center hands it to acc
  in its environment (`ACC_CLOUD_TOKEN_NEW`, `--from-env`). `ACC_CLOUD_TOKEN` stands in for tests.
- **Each task chooses.** `acc dispatch <id> --cloud` or `--local`; neither follows
  `agents.cloud.default`, local unless it says cloud. A card's ⋯ offers **Dispatch to the cloud**, disabled
  with the reason where the cloud isn't offered. `--cloud` with `--foreground` is a usage error; `--cloud`
  with any need unmet is refused naming each, before anything is made. Model and effort picks are kept
  on the run for a re-dispatch here, but the routine's own model and effort apply in the cloud: a fire
  can't set them, and the dispatch line says so.
- **Before the fire** acc creates the worktree as for a local builder, so the work has somewhere to land,
  pushes the task branch alone to origin as the repo's account (`git push --set-upstream origin
  <branch>:<branch>` from the main checkout), never an environment branch, and only then fires. A push
  that fails keeps the worktree and says why; nothing is fired. The fire's `text` is the builder's packet
  (D-012) wrapped for a cloud session (`cloudText`): an `Acc-Branch: <branch>` line first, the guard's
  record of the task's branch, then the branch to fetch and check out, that acc isn't installed there,
  the checks to run by their commands, the ones only the Mac can run, the finish line of trailers, and
  the guard's rules. The Mac's worktree path and acc's path, which name the home folder, stay out of a
  cloud packet. Nothing depends on the local ledger or the plugin. Before the push, the dispatch reads
  the commits a cloud session would load its hooks from, `refs/remotes/origin/<default branch>` (origin's
  HEAD, else the environment's branch) and the task branch, with `git show <ref>:<path>`, and refuses
  `--cloud` unless both carry the current guard script and its settings entry, naming the fix; Setup's
  guard step reads HEAD's tree the same way, never the files on disk, since a guard written and not
  committed never reaches the cloud. A cloud dispatch skips this machine's total (GH-111), which counts
  this Mac's builders: the project's own cloud cap is the only limit.
- **Guardrails: two lines, both failing closed** (the rework of 2026-10-10, after a guardrails-only
  review, and the second rework the same day, after a guardrails re-check; the author decided). A cloud
  session runs the repo's committed `.claude/settings.json` hooks and not the plugin's (D-042), so opting
  in writes three files into the repo, to commit (this repo commits them): `.claude/hooks/acc-push-guard.mjs`,
  `.claude/hooks/acc-pre-push` beside it, and in `.claude/settings.json` a PreToolUse hook on
  `Bash|Edit|Write|MultiEdit|NotebookEdit` that runs the guard as `node
  "$CLAUDE_PROJECT_DIR"/.claude/hooks/acc-push-guard.mjs || exit 2`, and a SessionStart hook that runs
  it with `--session-start`. The path is from the project root Claude Code gives the hook, so a `cd` in
  the session can't make it fail to load, and `|| exit 2` denies the call when the guard is missing or
  can't be parsed. The dispatch refuses `--cloud` unless the three are committed as this acc writes
  them on origin's default branch and the task branch, read from the commits with `git show`; Setup's
  guard step reads HEAD's tree the same way. **The first line reads the command before it runs.** In a
  cloud session (`CLAUDE_CODE_REMOTE=true`, or the documented `CLAUDE_CODE_REMOTE_SESSION_ID` set) only
  `git push origin <branch>` and `git push origin HEAD:<branch>` pass, with `-u` or `--set-upstream`
  before origin if wanted and nothing after the branch, where `<branch>` is the task's from **the
  guard's own record**: the `Acc-Branch` line acc puts first in the fire's text, read from the session's
  first user message in the transcript Claude Code names in the hook's input, before the first assistant
  turn, so a tool result or a later message can never set it. It is never the checkout's branch, and
  never any `task/*`. Without a record, no push and no checkout passes. The guard reads the words the
  shell will run, after quotes and escapes are removed (`'g'it`, `g""it` and `g\it` are `git`), reads a
  `$( )` or a backtick as its own command even inside double quotes (only single quotes are literal), and
  skips a heredoc's body, so a commit message that mentions a push stays a message; there is no quick
  pre-check any more, every Bash line goes through it. Everything else that could push is refused: a bare
  `git push`; any push with a flag, a `+`, an empty refspec, a redirect after the branch, another remote
  or another branch; git reached through its global options, a path to git, a wrapper (`timeout`, `env`,
  `nohup`, `xargs`, `eval`, `exec`, `nice` and the like), an assignment before the command of `GIT_*`,
  `HOME`, `PATH`, `XDG_*`, `LD_*`, `DYLD_*`, `EDITOR`, `VISUAL`, `SHELL`, `BASH_ENV` or `ENV` (alone, or
  with `export`, such an assignment is refused outright, since the session's shell keeps it), or a program
  that runs another from its arguments (`find -exec`, `npm exec`, `watch`, `flock`, `script`, `parallel`,
  `make`, `if`, `{ }`: what it would run is guarded as if wrapped); a shell with `-c`, whose inner line is
  guarded the same way, or a bare shell, a script file, or `source`; a program named by a `$` variable; a
  redirect or a `tee`, `cp`, `mv`, `ln` whose target holds a `$`; an interpreter's inline code that
  mentions git or a push; **and, as a backstop, `git` followed by `push` or `send-pack` anywhere else in a
  command's words**, however it got there. A git alias is refused (read with `git config --get
  alias.<sub>`); `git config` and `git -c` keys are an **allow-list** (`user.name`, `user.email`,
  `commit.gpgsign`, `tag.gpgsign`, `safe.directory`, `init.defaultBranch`, `pull.rebase`, `merge.ff`,
  `rerere.enabled`, `fetch.prune`, `advice.*`, `color.*` and a few more that run nothing and send nothing
  elsewhere; `core.editor`, `diff.external`, `filter.*`, `sequence.editor`, `gpg.program`, `core.pager`,
  `core.sshCommand`, `alias.*`, `push.*`, `remote.*`, `url.*`, `credential.*`, `include*` and `http.*` are
  not on it), with the new `git config set|unset` forms read the same way; `git remote
  add|set-url|rename|remove` is refused; **`--no-verify` with any program and `core.hooksPath` set by any
  means** (`git -c`, `git config`, `GIT_CONFIG_*`, `export`) are refused, since each would switch the
  second line off. `gh` is an **allow-list** too: `pr view|list|diff|checks`, `issue view`, `run
  view|list`, `api <path>` with GET and no field, `auth status`, `--version` and `help`; everything else
  is refused, `gh api graphql` among them (it posts, and GitHub's proxy refuses it in the cloud anyway),
  `workflow run`, `pr review|comment|merge|create|close`, `release`, `secret`, `issue close`, `repo
  delete`. `curl` or `wget` writing to github.com and `sf project deploy start|quick|resume` are refused.
  The guard also refuses what could change it or its hooks: from Bash, a line that names anything under
  `.claude/` or `.git/`, the hooks, the record or the transcript, or whose words would land there once
  globs (`.cl*`, `.claud?`) and symlinks (`ln -s .git g`, then `g/hooks/pre-push`) are resolved, unless
  every command in it only reads (`find` isn't a reader: `-delete`, `-exec`); from Edit, Write, MultiEdit
  or NotebookEdit, `.claude/hooks/*`, any `.claude/settings*.json` (the home's too, since a settings file
  could carry `disableAllHooks`), anything under `.git/` and the transcript, resolved the same way; `git
  checkout <ref> -- <paths>` where a path reaches `.claude/` or `.git/` (`.`, `:/`, a glob, a parent)
  and the ref's guard files differ from HEAD's (`git diff --name-only`), `git apply`, `git am` and
  `patch` whose patch names `.claude/` or `.git/` (the headers read, and for `git apply` its own
  `--numstat`), or that would read the patch from a pipe the guard can't see (a dry run, `--check`,
  `--numstat`, `--dry-run`, passes); `git checkout` or `switch` to anything but the recorded branch, a
  new branch, `reset --hard|--merge|--keep`, `restore --source`, `pull`, `worktree`, `update-index`,
  `read-tree`, `checkout-index`, `rm -r` of the checkout or `.git`, and a `merge`, `rebase`,
  `cherry-pick` or `revert` whose ref would change the guard's files. Malformed input, a Bash call with
  no command, or an error of the guard's own blocks the call with exit 2 and the reason on stderr; a
  refusal is a `permissionDecision: deny` with its reason. **The second line checks the push itself.**
  `acc-pre-push` is a `#!/bin/sh` git pre-push hook. The guard installs it into the clone's
  `.git/hooks/pre-push`, executable, when the session starts (the SessionStart hook, committed with the
  guard, which the cloud runs before the builder's first turn; not the routine's setup script, which is a
  person's and not in the repo), and again on every call and before any push passes: a hook changed by
  hand is put back, `core.hooksPath` set anywhere means no push until a person unsets it, and the
  script missing beside the guard means no push. The hook reads the refs git is about to update on
  stdin and refuses any update other than `refs/heads/<branch>`, any deletion, and any update that
  isn't a fast-forward (`git merge-base --is-ancestor`), whatever ran git: a wrapper, an alias, a
  renamed or copied binary, a script in any language, `find -exec`. Its `<branch>` is
  `.git/acc-task-branch`, which the guard writes from its record on every call, so it's in place before
  any push, and which the guard keeps a builder from writing; no record, no push. The test pins that
  `--no-verify` and `core.hooksPath` do skip it, which is why the first line refuses both. Outside a
  cloud session the guard prints nothing and installs nothing: a person on main and a local builder with
  the plugin's guards see nothing from it. The builder never merges or deploys: the packet forbids it,
  the guard refuses it, the GitHub proxy refuses `gh pr` outright, and the checks run under the profile's
  gates. **What this stops, and what it can't.** A plausible thing an agent would type, which the review
  and the re-check listed and which a builder trying to finish its task might well reach for, is now
  refused: every form above, each pinned by a test. A deliberate adversarial escape, by a builder that
  sets out to push past the guard, isn't prevented by a guard that runs on the builder's own machine:
  raw HTTP to GitHub with the session's git credentials, read from the proxy's configuration, or
  obfuscated code that writes `.git/hooks/` through an interpreter, a script the builder writes to a
  file and runs with `node` or `python` without inline code, a binary it builds, or a shell variable
  assembled from pieces. The moved-branch notice below is the backstop for these: every sync of an
  opted-in project flags an environment branch that moved by anything but acc's own merge, and a person
  looks before anything builds on it. **Enforced branch protection on GitHub is the only full
  prevention,** and acc warns rather than refuses where there is none (the author decided): the
  dispatch and Settings read, through `gh api repos/{repo}/branches/{branch}/protection` and
  `rules/branches/{branch}` as the repo's account, whether GitHub enforces protection or a ruleset on
  the default branch and each environment branch. Enforced passes quietly; none, unknown (gh offline or
  not signed in), or unavailable warn that a push the guard didn't catch would be caught by acc's next
  sync, after the fact, rather than prevented. This repo is private on GitHub's free plan, where both
  calls answer 403 "Upgrade to GitHub Pro or make this repository public", so protection can't be set at
  all: refusing would have ruled out the real run here. **What a cloud builder can and can't check:** it
  runs the project's command gates itself, by their commands (`gates.commands`, a ratchet's command);
  acc's built-in checks (`stray-files`) and any gate that needs an org login, Salesforce `validate` and
  `drift`, run only on the Mac, when acc collects the branch. The packet names both lists, and says
  what the hooks refuse under `.claude/` and `.git/`. No org credential or secret ever goes to a cloud
  session.
- **Following, through GitHub,** since Claude Code reports no state: on every `acc sync`, and so on the
  Command Center's poll while a cloud task runs, `git ls-remote` reads each running cloud task's branch
  head. A new head is fetched and written on the run with the time (`run.cloud.head`, `lastPushAt`); the
  fire counts as the first move. Its last commit's trailers decide: `Acc-Blocked: <why>` moves the task to
  blocked as the builder's move, with the reason; `Acc-Done: <id>` marks the run finished and collects
  it. No push for `quietMinutes` shows the task as **Needs you**, in orange with the bell, "no word from
  its cloud builder for N minutes: it may be waiting for an answer on claude.ai", with Watch opening its
  session; a builder's question can't be seen sooner, which is the gap this design accepts.
- **Collect** (`acc collect <id>`, and what sync does on its own at any autonomy, since the finish line is
  the builder's own): origin's branch is fetched and fast-forwarded into the task's worktree; a dirty or
  diverged worktree is refused with nothing changed, and the reason written on the run, so the task
  shows as needing you. The required checks then run on this Mac, in the heavy-check slot, as a refresh
  runs them (D-058): the cloud's own runs don't count, receipts vouch for a commit here. All passing, the
  task moves running → review under the same `gatesPassed` and note rules as `acc done`, with the note
  the trailers gave (a part it left out says so). A check that fails leaves the task running, needing you,
  naming the check, and the next push to the branch collects it again. From review on, the task is a
  local builder's: review, land and the merge queue as before.
- **Caps.** Cloud runs count against `agents.cloud.max` only; `agents.max` and the machine's total (GH-111)
  count this Mac's builders only, since usage limits aren't CPU, so a cloud dispatch is never refused for
  the machine's total, at the first check or the ledger's second. No caffeinate for a cloud run (D-067).
- **The Command Center** shows where each builder runs on its card and page, an icon and a label, **This
  Mac** (`device-desktop`) or **Cloud** (`cloud`), and acc show says it too. For a cloud builder, Watch
  opens the session on claude.ai; **Send a message** queues one with `claude -p "<text>" --cloud
  <session>`; **Collect** runs acc collect; Attach and Open in Claude Code are disabled with the reason;
  Abandon sets the task aside without stopping the session, which it offers to open and archive. A
  `disabled` action is drawn disabled, with its reason, never left to do nothing.
- **Environment branches that move.** Every sync of a project that opted in looks at each environment's
  branch on origin, after the pull requests, so a merge sync has just recorded explains the move it
  made, and keeps where each stood (`<git-common-dir>/acc/branches.json`). A project that hasn't opted
  in looks at none: its syncs run exactly as before. **A move is acc's only by its merge's commit** (the
  rework): `git log --first-parent prev..head` lists what came in, so a merge counts once, as its merge
  commit, and never as the branch's own commits, which name no pull request; a commit passes when its
  sha is one sync recorded as a merge's (`mergeCommit.oid`, a task's `pr.mergeSha` or a promotion's), or
  it's a merge commit whose second parent is a head acc landed (`pr.sha`) or autopilot merged
  (`autopilot.merged.sha`), or it's a rebase's copy of the branch's commits, which `git cherry <branch>
  head prev` finds by their patches against the task branch the Mac's clone still has. GitHub's squash
  subject, "Title (#N)" with N a pull request the ledger knows, is kept only as a fallback for a squash
  whose merge sync hasn't recorded: a pull request with a `mergeSha` is known by that sha alone, so a
  pushed commit naming its number is flagged (the second rework); a merge commit's subject never
  explains it, and a pushed commit that merely mentions a number ("Hotfix, see #12") is flagged. A head
  the old one doesn't lead to is a rewrite, flagged as such. A second move nobody explains, while an
  earlier one waits, keeps the earliest `from` and adds the new commits, newest first, as one item; a
  rewrite on top of a waiting move keeps its commits and says it moved again in a way git couldn't
  list. Every move still waiting is in `acc sync`'s output each run, with its compare page,
  and on the Overview as an orange item needing you, with Compare on GitHub and Seen, until `acc sync
  --branches-seen` clears it; the Command Center syncs an opted-in project on its pull-request poll even
  with nothing else to follow, so a move is seen.
- **Not chosen:** installing the pre-push hook from the routine's setup script (a person's, and not in
  the repo: the SessionStart hook is committed with the guard, and the guard puts the hook back before
  any push anyway); a quick pre-check on the raw line (it let a quoted `'g'it` through unchecked, so it's
  gone: every Bash line is read); allowing a redirect after the branch in the one plain push (harmless,
  but not plain: the refusal says exactly what to type); refusing every `git commit` that mentions a
  push in its message (a heredoc's body is skipped instead); a deny-list of git config keys (each new
  key that runs code would have had to be found first: an allow-list of what a builder needs);
  `claude --cloud` from a terminal (interactive only, so autopilot can't re-dispatch and
  nothing captures the session id); `--on-branch`, hidden and tied to `--cloud`; teleport as the way
  back (a person's, not acc's); counting cloud builders against `agents.max`; refusing `--cloud` on an
  unprotected environment branch (a warning instead, by the author's decision: this repo can't have
  protection on its plan, and the guard and the moved-branch notice cover it); a guard that reads the
  task's branch from the checkout (a builder can switch it) or from a file committed on the task branch
  (two cloud tasks from one base would conflict on it); a guard that allows a push through a wrapper or
  a shell's `-c` that pins the branch (not plain, so not on the allow-list; a shell's `-c` line is
  guarded, a wrapper's push isn't allowed); explaining a branch move by its subject alone (a hand-pushed
  commit can say anything); cloud reviewers or analysts; sharing the ledger (D-008, DESIGN §19).
- **Checked:** `cloud.test.ts` (off by default and the reasons; `agents.cloud` parsing and round trip; the
  token from the environment and the keychain, written through stdin; the fire's headers, body, cleanup
  and refusals; the finish marker; the fire's text; a cloud dispatch's push before fire, its run, no
  caffeinate, the caps, and its refusals; following a branch on a bare origin from fired through pushed,
  quiet, blocked, a failed collect and a collect, with the note; collect's refusals; the moved-branch
  notice: a real `git merge --no-ff` of a task branch, a squash, a rebase by cherry-pick, a hand-pushed
  "Hotfix, see #12" flagged, a force push flagged as a rewrite, the moves carried by every sync until
  cleared, and no look at origin for a project not opted in; a cloud dispatch skipping the machine's
  total; `--cloud` refused with nothing pushed until the guard is committed on origin's default branch
  and the task branch; what GitHub enforces, read from fixtures of each answer, and the dispatch's
  warning), `cloud-guard.test.ts` (the committed script run as Claude Code runs it, with a transcript
  carrying the record: the two allowed pushes pass, and a refusal is pinned for every form named above,
  through the guard's own function for the long list and through the hook for the quoted names, the
  launchers, the substitution in quotes, the patch, the hooks-path assignment and a few of each other
  kind; a real `git push` through the installed pre-push hook against a local bare origin, installed by
  `--session-start` as the cloud runs it: the task branch lands, and main, `HEAD:main`, another task
  branch, a delete, a force push, a push from a renamed copy of git and one from inside `find -exec` are
  refused with origin unmoved, no record refuses even the task branch, `--no-verify` and
  `core.hooksPath` are shown to skip the hook, a hook changed by hand is put back, and `core.hooksPath`
  set or the script missing means no push; the record read from the first message only; junk input, no
  command, an error of its own, and a guard that's missing or can't be parsed, run through the settings'
  own `|| exit 2` command, exit 2; a tool it doesn't guard and a session outside the cloud pass, and a
  clone on a Mac gets no pre-push hook; the editing tools refused for the hooks, any `.claude`
  settings file, anything under `.git/` and the transcript, through a symlink too, and allowed for
  another file under `.claude/`; the guard's command splitter and hooks.ts's `commandsOf` kept the same
  on shared cases with substitutions in quotes and heredocs; install, replacing older entries;
  `guardCommitted` reading commits, not disk, the pre-push hook among them; this repo's HEAD carrying
  all three files), `config.test.ts` (every key), `branches.test.ts` and `cloud-cards.test.ts` in
  the extension (the Overview's moved-branch item, orange and counted, with its buttons; Dispatch to
  the cloud disabled with each reason or enabled; a running cloud task's Watch, Send a message, Collect
  and Open in Claude Code disabled with why, and Abandon's label), `looks.test.ts` (the place, the
  Settings switch, what GitHub enforces per branch, and a moved branch, every state with an icon and a
  label, no red against green), the screenshot run with two cloud builders on the board, a moved branch
  on the Overview and the protection rows in Settings, and `acc gate run`.
- **The real run.** Not done in this change, nor in its rework of 2026-10-10: firing needs a routine and
  its API token, which only a person can make at claude.ai/code/routines, and this repo had none either
  time (`acc cloud` on 2026-10-10: not opted in, no routine, no token). What's ready for it: this repo's
  guard is committed on this branch and reaches main with it, which the dispatch requires, since the
  cloud clones main first; `acc cloud enable --routine trig_…` and `acc cloud token` take the rest, and
  `acc dispatch <id> --cloud` on the next small task is the run. The dispatch will warn that GitHub
  enforces no protection here, and go on. Write up here what worked, what didn't, the time and the
  usage, and name any step above the run proves wrong: in particular whether the fire's text lands in
  the transcript's first user message as the guard reads it (if not, the guard allows no push, fails
  closed, and the session's page shows its refusal), and whether the file watcher loads the task
  branch's hooks after the checkout, and whether the SessionStart hook ran in the cloud and installed
  `.git/hooks/pre-push` before the builder's first command (the builder can `ls .git/hooks`, which the
  guard allows; the session's page shows the hook's output).
- Note (at merge, 2026-10-12): three gaps both reviews named were closed at the merge rather than by
  another builder run (D-135). The command splitter, the guard's and hooks.ts's alike, keeps the command
  around a `$( )` or backtick pair whole, with `$(...)` (`SUBSTITUTED`) where the substitution stood, and
  reads the substitution as its own command first: `git push origin "<branch>$(echo :main)"` was read as a
  plain push of the task branch, and passed the first line (the Fable check's S1); it's now a push of
  `<branch>$(...)`, refused. `--no-verify` is refused with any program, not only git, since npm, a script
  runner or a wrapper could pass it on. `alias`, `hash -p`, `git clone` and `git init` are refused: the
  first two change the program a later name runs, and a new repo has none of the guard's hooks.
  `cloud-guard.test.ts` pins each, and its S1 case fails on the guard as the branch left it.
- Note (T-13, 2026-10-13): what the guard allows and refuses is unchanged; where the pre-push hook is
  installed moved. The script's `guard()` function reads a command and returns a reason or null, and
  writes no file: before, it installed the pre-push hook when it allowed a push, so a test that called it
  on a real checkout wrote `.git/hooks/pre-push` into this clone on 2026-10-12. A push it allows now sets
  `ctx.pushes`, and the hook's entry point installs the pre-push hook and writes the record before it lets
  that push run, refusing it when the install fails, as it does at session start and on every call. A
  test calls `guard()` on two allowed pushes in a temporary repo and fails if any file under it, `.git`
  included, is written, changed or removed. The coverage check (D-134) no longer reads the guard script's
  own `export` lines, inside its template literal, as the module's, and every GH-69 export is named by a
  test (`packages/core/test/cloud-names.test.ts`) or, used only in its own module, no longer exported.
- **Note (2026-10-21, T-86).** A task's review can run in the cloud too, where the project opts in
  (D-184): the fire's text carries an `Acc-Role` line beside `Acc-Branch`, which the guard now requires,
  and a reviewer's `Acc-Verdict` line. Analysts stay on the Mac.

## D-141 Requirements are written in Simplified Technical English, and acc checks their wording (2026-10-13)

A builder reads the analysis's requirements with no one to ask what they mean (T-12). The analyst now
writes the goal, each acceptance criterion, each assumption and each out-of-scope item in ASD-STE100
Simplified Technical English, Strict mode, so each reads one way only. The method is the MIT-licensed
skill at https://github.com/danyuchn/asd-ste100-skill.

- **The copy.** `plugin/skills/ste100/` holds the skill at commit
  `32511c6992ecb5f1971e46a2943f2e6adceedafe`, taken from GitHub's archive of that commit (the builder's
  session refuses git outside its worktree, so it couldn't clone). `LICENSE` is unchanged.
  `SOURCE.md` names the URL, the commit, the date, each file's hash and each change: two edits to
  `SKILL.md` so its linter step names `acc ste check`, and `README.md` left out. `docs/THIRD-PARTY.md`
  has its row, and `scripts/test/third-party.test.ts` fails on a folder under `plugin/skills/` with a
  `LICENSE` file and no full row.
- **The port.** `packages/core/src/ste.ts` ports every structural rule of the skill's
  `scripts/ste-lint.py`: semicolon, phrasal verb, marketing adjective, nominalization, long sentence,
  synonym rotation and dangling conjunction (hard), and passive voice and present perfect (advisory), with
  its protection of hedges ("may have failed" is never a present perfect). Python's `\b` and `\w` are
  Unicode-aware and its columns count code points, so the port's patterns and columns do the same. The
  Python's hard level, `advisory-free`, is `hard` here. Its `--baseline` and `--disable` options aren't
  ported.
- **The oracle.** The Python stays unchanged at `packages/core/test/fixtures/ste100/ste-lint.py`, never in
  the plugin, and `SOURCE.md` pins its hash. `packages/core/test/ste.test.ts` ports each assertion of its
  `selftest()`, then runs it and the port on the same texts (12 samples, and every Markdown file of the
  plugin and the docs, `.acc/rules.md`, the README and CLAUDE.md) and compares every finding: rule and
  line first, then column, level, match and message. It fails with a message when `python3` isn't there,
  on no texts, and on fewer than 100 findings from the oracle. It runs the oracle's own `--selftest` too.
- **The command.** `acc ste check [<file>...]` reads the files, or stdin, prints each finding as the Python
  printed it, and exits 1 on a hard finding. `--json` gives the findings.
- **The analyst.** Its prompt holds the STE Strict rules in full (`STE_STRICT` in `analyze.ts`), so it
  needs no skill installed; the schema's descriptions of the four requirement parts say the same.
- **The record.** `parseAnalysis` runs the port on each requirement line as acc reads the analysis, and
  records each hard finding in the analysis's `wording`, with the part, its place and the line it came
  from. Each line is checked on its own, so a synonym in one criterion never counts against another. A
  criterion, assumption or out-of-scope item is checked as a list item, so one that ends on "and" is
  caught; the goal is a sentence. Advisory findings aren't recorded. Analyses written before this have
  no `wording`, and none is rewritten.
- **Where it shows.** The task page's Analysis section shows an orange "Wording: 2 findings" state with the
  whole-word icon beside the verdict, and lists each finding: where it came from ("Criterion 2"), the
  rule's words, the words it caught and the line. `acc show <id>` and `acc analysis <id>` list them too.
  No finding shows no state.
- **Advice, not a hold.** A wording finding never stops a dispatch: `analysisProblems` doesn't read it, and
  the verdict's state stays as it was.
- **The rule.** `.acc/rules.md` gains: write each requirement that an agent reads in STE Strict mode,
  checked by `packages/core/test/ste.test.ts`.

Out of scope: the official STE dictionary, whose licence doesn't let us copy it; the builder's
instructions, review findings, builder notes and the existing rules text; and rewriting older analyses.

## D-142 A tab that is opening shows a loading screen at its center (2026-10-13)

A Command Center tab showed "Loading…" in its top-left corner until its first model arrived. It now shows
a loading screen at the tab's center (T-16).

- **One function.** `loadingScreen` in `extension/src/logic/loading.ts`, with no vscode import, makes the
  screen's HTML: the acc mark (the dark and light marks, as the rail draws them) in a 76 px ring, and one
  line in the description colour, "Opening the Command Center", "Opening the task" or "Opening the agent".
  `htmlFor` puts it in `#app`, and the page script draws the first model over it. The screen has
  `role="status"` and `aria-live="polite"`, and the line names it.
- **Motion.** A short arc in the accent turns once in 1.1 s, eased. The screen fades in after 150 ms, so a
  fast load shows no flash. Under `prefers-reduced-motion: reduce`, nothing turns or fades. The classes are
  `opening-*`: `.loading` was already the Tasks board's "Loading" chip.
- **Still pages.** The screenshot run has a `loading` page, in `STILL`: it is drawn with no model sent, so
  the screen stays. A still page has no rail and no controls, so `judge` takes `controls` and the run
  passes false for it; the tab floor counts home pages that aren't still. Headless Chrome's virtual time
  doesn't move animations, so a still page ends its fade itself before it is measured. The colour check
  draws it too.
- **Scroll on the first model.** The page script counts a page that holds only the loading screen as
  fresh, so a rebuilt tab goes back to its saved scroll position on its first model. Before, the
  "Loading…" paragraph made it not fresh, and the saved position was ignored. Found at review; only a
  match on the source line pins it.

## D-143 The screenshot run loads a page's fonts before it sends the model (2026-10-14)

On a busy machine the screenshots gate failed on "the selected tab is out of view", on different pages
each run (three Settings shots at 620 px, then Setup at 500 px light), and passed on an idle machine with
the same commit (T-21). D-133's settle didn't help, because the tab had stopped moving in the wrong place.

- **Cause.** The icon font loads only once a glyph needs it, so it starts loading when the first model
  draws the rail. The rail scrolls its selected tab into view on its next frame and when
  `document.fonts.ready` resolves, and that resolves at once, before the font has started to load. When the
  font comes after the rail's next frame, the rail has scrolled for the fallback font's narrower tabs; the
  font then widens every tab, nothing scrolls again, and the tab ends past the strip's edge. On an idle
  machine the font comes first. Held back 200 or 330 ms in the page, the font gave the finding on
  Settings → About at 620 px every time; at once, or after 600 ms, it didn't.
- **The page loads its fonts first.** `FONTS_FIRST` in `extension/scripts/steady.ts` loads every font
  the page's stylesheets name, then calls the page's ready handler, which sends the model. The rail so
  draws with the icon font in place, and the order no longer hangs on how long the font takes. The
  geometry carries how many fonts loaded first (`accFontsFirst`), and the run fails a drawing that loaded
  none (`fontsUnwaited`). A font that fails to load leaves the model unsent, so the page measures nothing
  and the run fails on that.
- **Not a longer wait.** Waiting longer before measuring can't help: once the rail has scrolled for the
  narrow tabs, it stays there.
- Evidence: `extension/test/fonts-first.test.ts` adds 6 tests. A stand-in rail and a font 0 to 30 frames
  late measure one box, in view; the old order fails for some delays and passes for others; a tab really
  outside the strip still fails. In Chrome, with the font's load held back 200, 330 and 1000 ms, Settings →
  About at 620 px measured the tab in view.

Out of scope: the rail itself, which in VSCode can still scroll before its font arrives.

## D-144 Every builder runs the repo-wide rule tests (2026-10-14)

T-24 passed every builder check (typecheck, near-tests, the tests count, screenshots), and its merge then broke
two tests on main: `scripts/test/edge-cases.test.ts` found a test file with no test named for an edge case,
and `scripts/test/near-tests.test.ts` found that a new page module changed which tests are near the page's
modules. Both are repo-wide rule tests, which ran only in `npm run check`, in the merge queue.

- **A `repo-rules` check.** `gates.commands["repo-rules"]` runs `node --no-warnings --test
  "scripts/test/*.test.ts"`, which takes about 15 seconds. It sits in `gates.builder` after `near-tests`, and
  in `gates.heavy` and `gates.tests` as `near-tests` does.
- **Pinned.** `scripts/test/repo-rules-gate.test.ts` adds 3 tests. They fail when `repo-rules` is not in
  `gates.builder` after `near-tests`, when its command does not run the files in `scripts/test/`, or when it
  is missing from `gates.heavy` or `gates.tests`.

Out of scope: `npm run check`, the merge queue, and which tests near-tests chooses.

## D-145 Slack is a tracker kind: a channel's threads are its tickets (2026-10-14)

T-23 asked how a Slack thread can be a task. The person took the recommended answer to each of its five
questions (2026-10-14):

1. **How acc reads Slack.** Through a Slack app with a bot token, which the Command Center keeps in VSCode's
   secret storage. The Claude Code Slack connector can come later, in the intake skill. D-078's incoming
   webhook only writes, so it stays a separate secret for notices.
2. **What a Slack task is.** A thread that a person tracks by pasting its link. A board of messages with a
   chosen reaction is a later task. A message shortcut is not a way in.
3. **Who a reply posts as.** The Slack app (bot token, `chat:write`), not the person.
4. **Which drafts go to a thread.** Only merged, deployed and the client's questions (blocked, question).
5. **What the brief holds.** The root message and its replies as they are when the thread is tracked. A
   person is named by their Slack name, never their email.

T-27 builds the core part: the kind, its settings and a client. The design:

- **The kind.** `slack` is in `TRACKER_KINDS`, named "Slack". A team template can't name one: a Slack
  tracker's channel is each project's own, so `parseTemplate` refuses it. The extension makes no client for
  a Slack tracker yet: its board says that signing in to a Slack app isn't built, and it offers no sign-in.
- **Its settings.** A Slack tracker names its `workspace` (the domain before `.slack.com`) and its `channel`
  (a channel's id, such as `C0123ABCD`). The config refuses one without either, and the error names the
  missing key; it refuses a channel's name in place of its id. Either key on a tracker of another kind is
  warned about and ignored. Its keys start `SL` unless it names a `prefix`.
- **A key.** The prefix, a hyphen, and the thread's first message's timestamp without its dot:
  `SL-1696512345123456`. `slackKey` makes one; `slackThread` reads a key back to its timestamp, and also
  reads a thread's link (`https://acme.slack.com/archives/C0123ABCD/p1696512345123456`, or a reply's link,
  whose `thread_ts` names its thread). A key names no channel: it is the tracker's own. Only a link can name
  another, so only a link can be outside.
- **`SlackClient`** (`packages/core/src/trackers/slack.ts`) uses `fetch` and the Web API with the bot token:
  `auth.test`, `conversations.replies`, `users.info`, `chat.getPermalink` and `chat.postMessage`. Every call
  waits for `auth.test`, made once, and a token for another workspace fails there with an error that names
  that workspace, before anything is read.
- **A ticket.** The title is the first line of the root message, clipped to 150 characters. The body holds
  the root message and each reply in time order, each under its writer's Slack name (display name, else
  full name, else handle) and its time. Mentions become `@name`, links their label and address, and any
  email address in a name or a message becomes "[email hidden]". A thread whose root message was deleted,
  or that Slack doesn't give back (too old for the workspace's plan, or in a channel the app isn't in), is
  `not-found`.
- **Outside.** A link into another channel is outside, naming that channel, but only when acc can read the
  thread there. An error, a deleted root message or an empty answer is never outside (D-048).
- **A reply.** `comment` posts the text in the thread as the app, through `slackEscape`, which moved from
  the extension to `packages/core/src/text.ts` so the notices and the client share it. A reply so can't
  mention `@channel` or a person.
- **No fields.** A thread has no statuses, people to assign or labels: `transitions`, `labels` and
  `assignable` give empty lists, and `transition`, `assign` and `setLabels` throw a `refused` error that
  says so. `board()` throws a `refused` error that says to track a thread by its link.
- **Trouble.** An HTTP 429 gives an error that says when to try again, from `Retry-After`. A refused token
  is `auth`, a missing scope `scope` and names it.
- Evidence: `packages/core/test/slack.test.ts` adds 16 tests, with Slack's answers as fixtures, including an
  empty reply list, a deleted root message, a thread from another channel and a 429.
  `packages/core/test/template.test.ts` adds 1 for the refused template. `slackEscape` is tested in the
  reply test there and in `extension/test/slack.test.ts`.

Out of scope: the Connect page, the secret storage, Track, which drafts go to a thread, and a board of
Slack messages.

## D-146 A Slack channel connects from the Connect page, with its app's bot token (2026-10-14)

T-27 (D-145) made Slack a tracker kind, but the Connect page didn't offer it and the extension wouldn't
make its client. T-29 adds `SLACK` to the Connect page's descriptions (`packages/core/src/trackers/connect.ts`).

- **Where.** The host is the workspace: `acme`, or any link from `acme.slack.com`. Other text is refused with
  that example.
- **Sign-in.** One method: the bot token of a Slack app, in a secret field that refuses a token that doesn't
  start `xoxb-` (a user token would post as the person, not the app). Its button opens Slack's page for apps.
  The hint says the token stays in VSCode on this machine, and that a person must invite the app to the
  channel. The extension keeps it as it keeps the others' tokens, `acc.cred:<repo>:slack:<workspace>` or the
  workspace's shared key: `trackerHost` gives a Slack tracker's workspace.
- **Who.** `verify` is `slackApp`: `auth.test` checks the workspace (`slackAuth`, which `SlackClient` now uses
  too), and a token for another workspace fails, naming it. The name is the app's, from `bots.info`, so the
  page says who a reply posts as. When `bots.info` can't be read, it is the bot user's name from `auth.test`.
- **Channel.** One picker, from `conversations.list` (public and private, archived left out). It lists only
  the channels the app is in, since the app reads no other, sorted by name and shown as `#name`, with
  "public" or "private". The channel is Slack's place (what stands in for an epic) and names the tracker, as
  a monday.com board does: it has no "whole" to choose.
- **A second channel.** `withTracker` tells Slack trackers apart by workspace and channel, and `ownPrefix`
  gives a second channel's tracker `SL2` (then `SL3`), as a second monday.com board gets `MON2`.
- **The extension** makes a `SlackClient` from the kept token, and a Slack board with no token offers Sign in
  to Slack. Its board is still the client's refusal (track a thread by its link), until Track is built.
- Evidence: `packages/core/test/slack.test.ts` adds 3 tests, `packages/core/test/connect.test.ts` 2 and
  `extension/test/connect.test.ts` 2, and the activation test checks the sign-in button and the client's
  refusal. The screenshot run adds `connect-slack` and `connect-slack-channel`, and `ticket-nofields` is a
  Slack thread now.

Out of scope: Track on a thread's link, which update drafts go to a thread, and a board of Slack messages.

## D-147 The page obeys reduce motion, answers a press at once, leads only with what needs you, and follows the font size (2026-10-14)

An audit of the Command Center against Apple's design guidance found four things. T-33 makes each one a rule,
and `extension/test/feel.test.ts` and `extension/test/landing.test.ts` check them.

- **Reduce motion.** Under `prefers-reduced-motion: reduce`, a codicon spinner (`codicon-modifier-spin`)
  stands still: the word beside each one gives the state. codicon.css turns it with two classes, so the rule
  is `!important`. A finished job's Overview line (`.lp-row.lp-fading`) fades with `lp-fade-still`, which
  changes opacity only: it keeps its height, so the lines under it don't move. The test reads the page's
  styles and codicon.css, counts each selector that runs an animation, and fails on one that no
  reduced-motion rule stops or changes, by its selector.
- **A press shows at once.** Each kind of button the page draws (the first class of each `el('button', …)`)
  has an `:active` rule with `transition: none`. A compact button shrinks to `scale(0.97)`; a row as wide as
  its list (`.nav-item`, `.more-item`, `.q-choice`, `.q-option`, `.aq-suggest`, `.tile`) darkens with
  `--pressed`, mixed from the theme's foreground, instead, as a wide row that shrinks seems to jump. Hover
  keeps its 120 ms fade. The test fails on a kind of button with no `:active` style.
- **Primary only for what needs you.** On the Overview, only the lines in Needs you have the primary
  button. Every other list, Ready's Dispatch lines among them, uses the outlined one. `group()` in
  `src/model/landing.ts` sets each line's `primary` from its list, so the page model says which.
- **Text follows the font size.** No `font-size` in the page's styles is in px, but an icon's: a codicon is
  drawn on a 16 px grid, and a whole px keeps it sharp. `PX_FONTS` in the test names the exceptions, each
  with why, and pins how far each reaches (15 icon rules, and an agent's kind). The avatars and the board's
  facts line are now in em, at the size they had at VSCode's 13 px; an avatar in a card's top line sets its
  own size to stay there. `h1` and `.ticket-title` have `letter-spacing: -0.01em`; body text has none.

Out of scope: an animation for the task modal, translucent surfaces, springs and drag physics, which don't
suit a VSCode panel.

## D-148 A Slack thread is tracked by pasting its link on the Tasks tab (2026-10-14)

A Slack tracker has no board (D-145): `SlackClient.board` refuses. T-31 puts a box for a thread's link in
the board's place, so a person makes a task from a thread (T-23, question 2).

- **No refusal.** The extension makes a Slack tracker's client, so a missing token still offers Sign in to
  Slack, but it doesn't ask it for a board, so the client's refusal is never shown. The Tasks tab shows the
  box, which says the channel and workspace the thread must be in and how to copy a thread's link. A Slack
  tracker that can't be read shows its error and no box.
- **The link is read first** (`extension/src/logic/slack-link.ts`): `slackThread` reads it and `slackKey`
  makes the key, before `Trackers.track` upper-cases what it's given, so a link's case never changes what it
  names. A link to a reply names the thread it's in. Text that isn't a thread's link (a channel's link, a
  key, anything else) is refused with an example link in the tracker's own channel. A link from another
  workspace, or to a thread in another channel, is refused, naming that workspace or channel. None of these
  reach Slack.
- **Track** is the same Track as a card's (D-074): it reads the thread with `SlackClient.ticket` and gives
  its title and brief, with each writer's Slack name, to `acc import`. Import upserts by key, so a second
  Track of one thread changes its task's text and never makes a second task. A thread that can't be read is
  refused with Slack's reason and never reaches acc, so it never changes or removes a task (D-048).
- **The box's state** is the extension's, per tracker: the link last sent, Tracking…, why it didn't go
  (orange, a warning icon), or the key it tracked (blue, a check). The link stays in the box so a refused one
  can be fixed. Track is off, with its reason, until there's a link.
- **The task page** is unchanged: a Slack task's key finds its tracker, the page reads the thread, and
  Refresh reads it again.
- Evidence: `extension/test/slack-link.test.ts` adds 11 tests, against a stand-in Slack and a real ledger,
  and the activation test checks the box and a refused link in place of the client's refusal. The
  screenshot run adds `tasks-slack` and `tasks-slack-refused`.

Out of scope: a board of Slack messages with a reaction, and the Claude Code Slack connector.

## D-149 A suggested rule leaves the page from acc's reply that it was accepted or dismissed (2026-10-14)

A person confirmed the suggested rule "edge case" under When you have a moment. acc added T-34 and wrote down
the accept, but the person saw the suggestion stay. T-35 looked for why, and the page now acts on acc's
reply, not only on the next model.

- **Why it seemed to stay.** A stale model was not reproduced. The built extension, against the vscode
  stand-in, with a copy of this repo's reviews and suggestion records and a refresh between each step of
  acc's run, sent a home model without the suggestion before acc's reply every time. The models sent while
  acc ran still held it, as acc adds the task before it writes the accept down. What the page drew next
  looked the same: the detail kept its place and drew the next suggestion there, "test coverage", under the
  same title ("A rule you accepted keeps coming back"), the same question and the same Accept and Dismiss.
  Only its quoted line and the count changed. And the page never acted on the reply itself: it ended the
  wait and drew whatever model it held, so a model that still held the suggestion showed it again.
- **The fix** (`extension/webview/pending.ts`, `extension/webview/rules.ts`): from acc's reply that it
  accepted or dismissed a suggestion, the page takes it off: from what waits on you, from the detail, and
  from the suggested rules' line, which counts the rest and the reviews they came from, or goes when none
  are left. Its list counts one fewer. The detail shows the next one, or closes. It stays off while a model
  still holds it, and the page forgets it once a model arrives without it, so one that comes back later
  shows again. Drawing the same model again isn't a new model.
- **A second accept** that acc refuses shows acc's reason on the card, in the Command Center's words: "The
  task wasn't added: No rule is suggested as … now. "See the suggested rules" lists them."
- Evidence: `extension/test/settled.test.ts` (5 tests) holds the page's Overview to the one the extension
  builds without those suggestions, under and over the list's cap. `extension/test/rule-accept.test.ts`
  (1 test) accepts a suggestion through a real suggestions folder in the built extension, and checks the
  next home model and a refused second accept. The behaviour run adds a case and two mutants.

Out of scope: how acc suggests, accepts or dismisses a rule.

## D-150 A calm Overview: Needs you first, every other list a quiet card that opens in full (2026-10-14)

The person found the Overview still much too dense: a header with four buttons, six stat tiles, and six lists
of up to five lines each (GH-160, D-131). They chose Needs you first, then a few quiet summary cards. T-36
follows the apple-design guidance: the common path first, the rest one level deeper, the most important thing
the most obvious.

This replaces, for the Overview only, these parts of D-131 (GH-160): "Five to a list" (Needs you shows three;
no other list shows lines on the page), "The header's summary and buttons, the tiles and In progress's
machine line stay" (the header has one button and a menu, the tiles are gone, the machine line is in In
progress's detail), Ready's Show all going to Tasks and History's last five on the page (both are cards that
open over the page), and In progress's fold (D-092), which has nothing left to fold.

- **The header** has the title, one line ("20 things need you", or "All clear: nothing needs you right
  now"), Add task, and a ⋯ menu with Start an agent, Add a tracker and Refresh, each with its icon. Each sends
  what its button did (`HEADER_MENU` in `webview/overview.ts`, through `moreMenu`). The line no longer names
  the project and its trackers; the rail names the project.
- **Needs you** shows its first three lines (`CAP` is 3), then Show all N. Its buttons stay primary (D-147).
  On the Overview a line keeps its state, its task, its title and its button; its facts go into its title.
  With nothing in it, one calm line says so, with no heading.
- **A card for each other list** that holds a line, in this order: In progress, Ready for an agent, When you
  have a moment, History, and the merge queue. A card has the list's name, its count and one muted line:
  "3 waiting on you", "ACME-16 next", "GH-41 next to merge", or the first line's title. It is a button,
  named "In progress, 6: 3 waiting on you"; a click or Enter opens the list in full in the detail Show all
  uses, History with its filters. A detail opened from that list, such as the suggested rules, sends focus
  back to the card when it closes. The model carries the cards (`overview.cards`), built by `overviewCards`
  in `webview/pending.ts`, where `hideSettled` builds them again when a suggested rule leaves (D-149).
- **The model:** each list has `shows` (3 or 0), `all` (every line, always) and `opens`. History holds
  every item, not its last five. The stat tiles are still in the model, as tests read their counts, but the
  page doesn't draw them.
- **Spacing:** 32 px between Needs you and the cards, 5 px between lines, lines 32 px high.
- **Checked:** the screenshot run's Overview check now fails on more than three lines in Needs you, and on
  cards out of their grid: another width, another height in one row, out of the first row's columns, or out
  of line with their row (`judgeCards`). It also measures the lines and buttons of a list a detail shows over
  the page. It counts cards with lines and fails on none. The run adds five pages: `overview-needs`,
  `overview-progress`, `overview-ready` and `overview-moment`, each list open in full, and `overview-clear`,
  the busy Overview with nothing that needs you. The behaviour run adds
  two cases (each card opens its list in full, In progress with its machine line, focus back; the header's
  one button and its menu's three messages) and four mutants. `landing.test.ts` adds four tests, among them
  one that walks the busy Overview and finds each list's lines on the page or in what its card opens.
- **Floors lowered:** the page draws fewer lines and buttons, so the run's floors for overview (1200 to 800),
  buttons (1000 to 450) and overlap (13700 to 13600) were lowered to under what it now examines (834, 462,
  13678). The tab floor rose to 348 for the five new pages. The person approved the lowered floors on 2026-10-14, when merging: the drop is the redesign's point.
- **Looked at, at merge:** overview-landing at 1000 px light and 500 px dark. Needs you comes first with three
  lines and Show all 19; four cards follow (In progress 6, Ready 6, When you have a moment 13, History 12),
  two to a row at 1000 px and stacked at 500 px, where each Answer button shows its icon alone.

Out of scope: what each list holds, the detail itself, and the other tabs.

## D-151 The Overview's model drops the stat tiles, keeps its cards in the host, and its card words agree with the header (2026-10-14)

T-36 (D-150) left four points. This entry adds to D-150, which stays as a dated record.

- **No stat tiles.** `OverviewModel.stats`, `StatTile`, the `stats` hook of `HomeArea` and each area's `stats`
  function (tasks, agents, worktrees, setup) are gone. D-150 says the tiles stay in the model; they do not now.
  The three assertions that only read a tile's value are removed: in `overview.test.ts` the Setup tile's `1/2`
  and the Waiting for review tile's `1`, and in `activity.test.ts` the Agents working tile's `4`.
- **The host builds its cards.** `overviewCards`, `cardLine` and `CARD_ORDER` moved from `webview/pending.ts` to
  `src/model/landing.ts`, so `home.ts` imports nothing from the page. The page cannot import values from the
  host (D-121), so `hideSettled` builds no card from scratch: it changes only the When you have a moment card,
  to the list's count and first line, or drops it with its last line. `settled.test.ts` already holds the result
  equal to the host's `overviewCards` over the same lists, in each case.
- **In progress names its states.** The card said "N waiting on you" for the lines that stopped or ask
  something, while the header can say all is clear. It now counts those lines by their own state, such as "2
  stopped" or "1 asking, 1 failed"; a line whose state is "Waiting on you" is counted as "asking". With none
  of them, it says what is first, as before. A test takes a sample where the header says all is clear, and
  finds no card that says something waits on the person.
- **A pinned count.** The behaviour test pins the line count of the When you have a moment card (4), as it does
  the other cards, and no longer reads it from the cards.

## D-152 A tidy-up counts a task merged in git, not only one merged by a pull request (2026-10-15)

`acc tidy` and the Overview's "Tidy-up due" counted a task as merged only when its pull request merged
(GH-104). A person who merges a task's branch in git and then sets the task done got no count, so no tidy-up
was offered: on 2026-10-14 about twenty such merges went uncounted (T-38).

- **What counts:** a done task whose pull request merged, or whose branch is in its environment's branch
  (`branchInEnvironment` in `packages/core/src/tidy.ts`). Its work is its branch, the local one or origin's copy,
  or, once both are gone, a commit its reviews read: acc cleanup deletes a branch that never left the machine,
  and a reviewed commit is in the environment only once it merged. A task with none of these, an unmerged one,
  or one not done doesn't count. `MergedTask.pr` is null for a task merged in git.
- **What a tidy-up reads:** for such a task, `tidyScope` takes the files of the merge commit that first brought
  in its reviewed commit. On 2026-10-15 that found 20 tasks and 97 files that the old count left out.
- **Where git is asked:** `tidyStatus` (the CLI) and the hub's `tidy` (the Overview), through
  `rememberInEnvironment`, which asks once for each branch and environment until the ledger is read again. An
  answer can be stale until then, such as for a branch merged after its task was set done.
- Evidence: `packages/core/test/tidy.test.ts` counts a task merged in git once, as one merged by a pull request,
  leaves out unmerged, branchless and not-done tasks, counts one whose local branch was deleted through
  origin's copy and one with neither branch through its reviewed commit, and scopes that one by its merge.

## D-153 Every tab keeps blue for what needs you; a card that asks offers Answer; Agents names its stops alike (2026-10-15)

A second audit against Apple's design guidance (2026-10-14) found that D-147's rule, primary only for what
needs you, held on the Overview alone. T-39 applies it to every tab.

- **Outlined:** Open org on each environment card, Switch account on the GitHub card, Add task on Tasks,
  Start a background agent on Agents, Settings' Slack Turn on and a ticket's Track in acc. None of them
  waits on the person. A board card's next step (Dispatch, Land, Review, Resume) keeps the model's primary,
  as before.
- **Checked:** `PRIMARY` in `extension/test/feel.test.ts` names each place the page may draw a primary
  button, with why: an Answer or a Needs you step, a fix for a sign-in that failed, the button that sends what
  the person typed beside it, an empty tab's Onboard, and the Overview's header (D-150, out of scope). The
  test reads every line of the page's source that draws one (a `primary` class, or a primary passed or read
  from the model), and fails on a line no entry names or two do, and on an entry that names no line. At this
  change it finds 31 lines, named by 30 entries.
- **A card that asks offers Answer.** A task whose agent waits on a question in the Command Center carries
  that question's id (`TaskRow.question`). Its card's one next step is Answer, which opens the question in
  Needs you, on the Overview, as the Agents tab's Answer does (`nextStep` in `webview/boards.ts`); Watch goes
  behind ⋯. Without the id, Watch stays the next step. On a tracker's card the next step keeps to the right
  of its line, even when its state wraps it to a line of its own.
- **Agents:** the fold's Stop all is now Stop finished, the header's name for the same command. The header
  holds Stop finished, Start a background agent, Refresh, then Settings last (`refreshButton` in `dom.ts`).
- **The Running column showed only at 500 px.** The row's actions stick to the table's right edge
  (`styles.css`). At 620 and 1000 px the State and Model cells never wrapped, so the table was wider than its
  frame, and the sticky actions covered Running. At 500 px the Model column goes, and the table fit. The
  State cell now wraps at every width (at least 8em to 660 px, 10em above), and the Model cell breaks between
  the model and its effort. The screenshot run's overlap check doesn't see a cell covered by a sticky one.
  - 2026-10-15: the run now has a check for that, `covered` (T-46): a sticky cell covering another cell's text
    fails, with the covered text named.

Out of scope: the Overview, which D-150 made.

## D-154 Settings opens with a link to each part, and a long explanation folds away (2026-10-15)

A second audit against the person's `apple-design` skill (2026-10-14) found Settings one long page whose
only guide was a 30-word subtitle, and whose rows each carried a paragraph that pushed the next row down.

- **The guide:** a row of links under the title replaces the subtitle, one for each part, its title and
  icon (`settingsGuide`, in the Settings model as `guide`). A link scrolls to the part's heading and focuses
  it, through the same `jumpTo` a deep link from another page uses. On a narrow tab the row wraps.
- **What this means:** a row keeps its name, its value, where the value comes from and its Change…. Its
  explanation, when it is more than one sentence or longer than 90 characters (`foldsMeaning`), goes into a
  "What this means" disclosure, closed at first; the tab remembers each one opened, in `opened`, as the
  agent page's steps are. The model names the ones that fold (`folded`), and `whatThisMeans` in
  `webview/dom.ts` draws each. One short sentence stays in view. The explanations
  it weighs are the theme's, each project's autonomy, auto-merge and cloud builders, Billing, each
  preference, and each version in About. A Limits row's where it's set and why it can't change stay in
  view: the first is the value's source, the second a disabled control's reason.
- **No new page file:** the fold rule lives in the model and the disclosure in `dom.ts`, because
  `extension/webview` takes no new file while `areas.ts` gathers 17 of its 34 modules: one more and the
  near-tests rule no longer counts `areas.ts` as the folder's index, so `screenshot.test.ts` stops being
  near every page module.
- **Height:** the sample Settings page, measured in headless Chrome with every fold closed, is now 4,100 px
  tall at 1000 px, 4,833 px at 620 px and 5,376 px at 500 px. The audit's 7,600 to 10,000 px are the
  heights of the screenshot PNGs, drawn at twice the size; the page was not measured the same way before.
- **Checked:** the behaviour run adds a Settings case (a link for each part, in order; a link focuses its
  heading; a closed fold for each long explanation, from the model; one opened stays open through a
  redraw) and three mutants. `settings-guide.test.ts` adds nine tests on the guide and the fold rule.

Out of scope: what a setting does and where acc keeps it.

## D-155 A project names its folders' indexes, so a count of modules doesn't decide its near tests (2026-10-15)

The tests near a change find a folder's index by a guess (GH-95): code in the folder that imports the
changed file and more than half the rest. `extension/webview/areas.ts` gathers 17 of the folder's 34
modules, so one more page module drops it below half, every page module loses `screenshot.test.ts` from
its near tests, and `scripts/test/near-tests.test.ts` fails. T-24 hit this, and T-35 and T-40 (D-154)
changed their design to avoid it.

- **The setting:** `gates.nearIndexes` in the project's settings is a list of paths from the repo's root.
  A named index gathers every code file in its folder, whatever it imports, and a folder with one isn't
  guessed at. A folder without one keeps the guess. A named path that isn't code in the checkout (a typo,
  or a file since deleted) names nothing, so its folder is guessed at. The parser refuses anything but a
  list of non-empty strings, naming the key. acc passes the list to `nearTests` once a run, as
  `ACC_NEAR_TESTS` is worked out. No path of this repo is in the code.
- **This repo** names `extension/webview/areas.ts`, the file the guess picks today, so the near tests of
  every page module stay as they were, and a new one is near `screenshot.test.ts` through `main.ts`,
  which loads `areas.ts`. `main.ts` itself, now gathered too, also gains `areas.ts`'s tests.
- **Not changed:** `scripts/near-reads.ts` asks `nearTests` for the tests near a reader in `scripts/` or
  `extension/scripts/`, whose folders name no index, so it doesn't read the setting.
- **Checked:** five tests. `gates.test.ts` adds three: a folder whose index imports two of five modules has
  no index without the setting and the named one with it; a named index reaches only its folder, and one
  that isn't code names nothing; and the setting reaches the list a gate is told. `config.test.ts` adds one
  on the parser. `near-tests.test.ts` adds one that puts more new modules in `extension/webview` than it
  had, and with this repo's setting finds `screenshot.test.ts` near every page module; without the setting,
  a new one loses it.

Out of scope: how a test is found near a file by its name or its import.

## D-156 A command palette searches the page's sections, Settings, tasks, agents and actions, and Enter runs the choice (2026-10-15)

T-52. Every action is a command with an id, and a reason when it's off; the palette is the one place
that reaches all of them.

- **What it holds:** `paletteItems` in `extension/src/model/palette.ts` makes the items from the page's
  model, and `homeModel` sends them as `palette`. Each section; each part of Settings, which goes to its
  heading by `settingsKey`; each task row, by its title, with its key as its hint, which opens it over
  the page as a card's click does; each agent, which opens its page; and the actions: the header's Add
  task, Start an agent, Add a tracker and Refresh, each card's next step when it is Dispatch, Resume,
  Answer or Watch (`paletteStep`), and Agents' Stop finished. An action sends the same message, with
  the same argument, as its button. Off, an item carries its reason as its hint (no project: the
  header's three; no finished session: Stop finished), and doesn't run.
- **The search is the page's:** `extension/webview/fuzzy.ts` holds the match and the results, with no
  DOM, so `palette.test.ts` loads it. Each typed character, in order, anywhere in an item's words, case
  ignored, spaces in the query left out. A character scores 1, 6 more at the start of a word (after a
  space or a sign, or a capital after a small letter), and 8 more right after the last one; the best
  way through the words wins, and a tie goes to the match nearer the front. At most 12 results show,
  grouped by kind, the group with the best match first; a line under them counts the rest, or says
  nothing matches. With nothing typed: the last 8 items run, kept in the tab's memory as drafts are,
  then the sections.
- **Words, not commands:** an item's words start with its title, then its hint when that is a key or
  Settings, then more words to find it by. A disabled item's reason is never in its words.
- **How it opens:** the rail's **Search or run a command** under the brand (its icon alone in the
  narrow strip), `/` outside a text box or another modal, and `acc.palette`, which the manifest binds
  to Cmd+K on a Mac and Ctrl+K elsewhere when `activeWebviewPanelId == 'acc.home'`. The command posts
  `{ type: 'palette' }` to the page; with the page closed, it opens it and posts once the page is ready
  (`Panels.tell`). Cmd+K also starts VS Code's own two-key shortcuts; the terminal's Clear binds it the
  same way, a single key with a `when`, and the key wasn't tried in a VS Code window on this branch.
- **The sheet:** the page's modal (`makeModal`), 560 px at most, 48 px from the top, the box in its bar
  above the results. It opens with the modal's fade and scale from its top edge, and under reduced
  motion only fades (task-modal.css). The box is a combobox naming the choice with
  `aria-activedescendant`; the list a listbox of options in labelled groups; the line under them is the
  live region. Up, Down, Home and End move the choice, Enter runs it, Escape and a click outside close
  it. Tab and Shift+Tab stay in the box, and a key typed elsewhere in it goes to the box. Focus goes
  back to what opened it, the rail's button found again if the page redrew under it.
- **Checked:** `palette.test.ts` adds 16 tests: the items on the busy Overview (each section, part,
  task, agent and action, counted), no tasks, two tasks with one title, a disabled action, the next
  steps, the ranking rules, an expected order for a small set, groups, a key alone, the limit, recents,
  bold parts, the manifest's key and the rail's button. `activate.test.ts` checks the command posts the
  message to an open page, and to a closed one only once it's ready. The behaviour run adds 7 palette
  cases and 9 mutants, and the Escape mutant now names the palette's case too. The screenshot run adds
  `palette` ("acme" typed) and `palette-empty` (recents, then sections), and the colour check draws
  `palette`.

Out of scope: a search inside transcripts, history or ticket bodies.

## D-157 The task page shows its review's findings, each with its file, line and the lines around it (2026-10-15)

A person read a reviewer's findings in a terminal. T-53 puts them on the task page.

- **Where it shows:** a Review block under the Agent panel, for a task in review or rework, or one whose
  latest verdict is on its latest commit (`ticketReview` in `extension/src/model/task-page.ts`). On a
  narrow page it follows the Agent panel. The verdict shows as a state with an icon and a word: Passed in
  blue, Changes asked in orange (`REVIEW_LOOK`). Then the summary, who reviewed it and when, and a count,
  "3 findings, 1 must fix", or "No findings". A verdict on an older commit says so in a muted line.
- **Each finding,** must-fix ones first, each part in the reviewer's order: Must fix in orange or Worth a
  look in blue, its message, its kind in a muted word, and its file and line as a link.
- **The lines around it:** the extension reads them, not the page (`reviewExcerpts` in
  `extension/src/logic/review-excerpts.ts`), with `git diff <base>...<sha> -- <file>` in the task's
  checkout, once a file. `<base>` is the merge base of the reviewed commit and the environment's branch,
  or origin's copy of it. A line in a hunk shows at most 7 lines of the change: a plus in blue and a minus
  in orange, from the theme, each named "added" or "removed" for a screen reader. A line no hunk holds
  shows at most 5 lines of the file at the sha, under a muted line that says the code is unchanged. A
  removed file shows its removed lines. A page keeps what it read for a verdict, so a redraw doesn't ask
  git again.
- **A click on the file and line** sends `review-file`. The extension opens the file at that line in the
  task's checkout (`showTextDocument` with a selection). It refuses a path outside the checkout: up with
  "..", an absolute path elsewhere, or a link that leads out (`fileInCheckout`), and never reads one. When
  the checkout is gone, the block says so once, shows no lines, and each link is off, with why in its
  title; so is the link of a file the change removed. In the modal, the Tasks board's page passes the
  message to the task page's controller.
- **Open the review** opens the reviewer's session page through `openReview` in `extension/src/rules.ts`,
  which a suggested rule's finding used alone before.
- **No full diff viewer** and no syntax colours: a line longer than 240 characters is cut with "…".
- **Checked:** `task-review.test.ts` (10 tests: the block, must-fix first, a pass with no findings, a
  finding with no file or line, an older commit, a task not in review, a gone checkout, an outside or
  removed file, the message's check). `review-excerpts.test.ts` (11 tests, in a real repository: a line in
  a hunk, one outside any, a removed file, a file not in the change, a path outside the checkout, a missing
  checkout, no merge base; it counts the findings it read and fails under 15). `rules.test.ts` adds one on
  `openReview`, `behaviour.test.ts` one on the case's oracle. The behaviour run adds a case on
  `ticket-review` and two mutants: one that lists the findings in reverse, one whose link sends nothing.
  The screenshot run adds `ticket-review`: ACME-19 in rework, with three findings and two excerpts.

Out of scope: how acc reviews a task.
## D-158 The merge cycle runs each check once (2026-10-15)

On 2026-10-15 each install ran `npm run check` again through `npm run package` (D-079), and each run took
about 8 minutes, though the same check had passed on the same commit a minute before. The three `tsc` runs
of `npm run typecheck` also started from nothing each time.

- **D-079's step stays.** Package still needs a passed check of the tree it packages. This change does not
  repeat that step. It only lets a check that already passed count.
- **The receipt:** when `npm run check` passes, its last step writes `dist/check-receipt.json`. It holds
  `HEAD^{tree}`, `clean` (whether the working tree had no change and no untracked file) and the time. `dist/`
  is ignored by git. The code is `scripts/check-receipt.ts`.
- **Package** skips the check when the receipt names HEAD's tree, the working tree is clean now, and the
  receipt is under 24 hours old. It then prints the commit and the time of the receipt. Any other case runs
  the check as before: no receipt (or one that isn't JSON), another commit, a dirty tree, an old receipt.
  `npm run package -- --check` runs the check always.
- **Typecheck:** each of the three `tsconfig.json` files sets `incremental: true`, with its build info file
  in `dist/tsbuildinfo/`. The stray-files check counts only added files, and `dist/` is ignored, so it is
  not changed. Times on this machine, from an empty `dist/tsbuildinfo/`: the first `npm run typecheck`
  took 1.8 s, and the second, right after it, 1.0 s.
- **Checked:** seven tests in `scripts/test/packaging.test.ts`: a matching receipt (the check does not
  run, the note names the commit and time, git ignores the file), a dirty tree (an edit, and an untracked
  file), another commit, no receipt or one that isn't JSON, a receipt 24 hours old and one a minute
  younger, `--check`, and a receipt written from a dirty tree. Each says whether the check ran.

Out of scope: the merge queue, and acc's own gate receipts.
## D-159 The Tasks boards work from the keyboard: arrows between cards, Enter opens, Space picks a card up and moves it (2026-10-15)

T-54. A card moved only by a drag, and the keyboard couldn't go from card to card.

- **Both boards:** the tracker's board, which the Tasks tab opens on, and the agent board. A tracker's card
  may land in any other column, as a drag drops it in any; an agent board's card in the lanes its model
  gives (`card.drops`). Each board passes its columns, its cards and its move to `boardKeys` in
  `extension/webview/board-nav.ts`, so a drop and Enter on a held card call the same function and send
  the same message: `move` on a tracker's board, `move-task` on the agent board.
- **One card in the tab order:** the last card focused on that board, kept by the page while the tab is
  open, else the first. The card itself takes focus on a tracker's board; on the agent board, its title,
  which already opened the card and is what the task modal gives focus back to. A card with its title
  focused shows the focus on the whole card.
- **Keys:** Down and Up go to the next and previous card in the column, Home and End to its first and
  last. Right and Left go to the card at the same place in the next and previous column that has cards,
  or its last card; an empty column is passed over. At an edge, focus stays. Enter opens the card, as a
  click does. A key with Alt, Ctrl or Cmd is left alone, so `/` and Cmd+K still open the palette.
- **Space picks a card up:** the card says **Moving** with an icon, the board dims the columns it can't
  go to (but its own), and marks the ones it can with `can-drop`, as a drag does. Left and Right choose
  among those, marked `drop-target`. Enter moves the card there at once, as a drop shows it, and sends
  the move; Enter with none chosen puts it down. Escape, Tab, or focus on another card puts it down and
  sends nothing. A card with no column to land in holds nothing, and the line says it can't move from
  its column because no other column takes it from there.
- **The live line:** above each board, a status line with an icon (orange only for a card that can't
  move) says each step: "Moving ACME-16. Left and Right choose a column. Enter drops it. Escape
  cancels.", the column chosen, "Moved ACME-16 to In Progress", or "Put ACME-16 down. It stays in To
  Do.". Empty, it takes no room but stays in the page, so a screen reader hears it fill. A redraw keeps
  what it last said.
- **A redraw keeps the place:** the card focused as the page redraws is found again by its id and
  focused, in whatever column the new model puts it. A held card stays held across a redraw while it is
  on the board and may still land in the chosen column.
- **Motion:** the held card lifts 2 px with a 120 ms ease; under reduced motion it doesn't move.
- **Where the pure part lives:** the task named `extension/src/logic/board-keys.ts`. The page imports no
  values from outside `extension/webview` (`webview-imports.test.ts`), so it is
  `extension/webview/board-keys.ts`, with no DOM, as `fuzzy.ts` is for the palette: `nextCard` and
  `nextLane`, the looks of each step (`MOVE_LOOK`) and the line's words (`MOVE_WORDS`).
- **The screenshot run's start state** may hold a card (`holding`), as it may open a card's menu, so
  the page `tasks-moving` shows ACME-16 held with In Progress chosen.
- **Checked:** `board-keys.test.ts` adds 13 tests: each key, the end of a column, an empty column
  between two, the edge columns, one card on the board, a card with no lanes, keys the functions don't
  take, the looks and the words, and that both boards call `boardKeys` under a `liveLine`, with the
  same move a drop sends, and that a mutant catches each behaviour case. The looks test walks `MOVE_LOOK`. The behaviour run adds 5 cases (one
  card in the tab order and the arrows; Space, Right and Enter against a drop's message; Escape; a card
  no column takes, on the agent board; focus after a redraw, in the new column) and 6 mutants. Its click
  now focuses an element with any `tabindex`, as a browser does. The screenshot run adds `tasks-moving`.

Out of scope: a change to the mouse drag, and keys on the Overview's cards or other tabs.
## D-160 The screenshot run checks every drawing with axe-core, and fails on a finding no exception excuses (2026-10-15)

The screenshot run measured geometry, words and colours, but nothing checked a page's accessibility:
a control's name, a role, a contrast. Now every drawing of every page, at every width and theme, is
checked by axe-core.

- **axe-core 4.14, MPL-2.0,** is a dev dependency, as esbuild and typescript are: the run reads
  `node_modules/axe-core/axe.min.js` and puts it inline in each measured page, before the harness's own
  scripts. It is not copied into the repo, and the extension doesn't ship it, so `docs/THIRD-PARTY.md`
  has no row for it. A page drawn for the colour check doesn't load it.
- **The rules:** axe's tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`, the rules for WCAG 2.1 AA, on
  the whole document, once the page has been measured. Best-practice rules, such as `region` (content
  outside a landmark), don't run.
- **The dump** (`extension/scripts/a11y.ts`) carries each violation's rule, impact and short description,
  and each node's selector and text (at most 80 characters). A contrast node also carries its colours and
  each `--vscode-*` variable whose colour its text is drawn in, or "no theme colour": a selector can't say
  which theme colour a node uses, and a selector with a time in it changes from run to run. The dump also
  carries how many nodes axe examined (in its passes, violations and incomplete results) and each
  incomplete result's rule.
- **The check, `a11y`,** is one of `CHECKS`. Each violation's node is a finding that names the rule, the
  impact, the selector and the text, unless an exception excuses it. An incomplete result is no finding;
  the run prints them by rule. A drawing where axe examined no node fails, and so does one that wrote no
  `a11y` part. `RUN_FLOOR.a11y` is 190000; the full run examined 190872.
- **`A11Y_EXCEPTIONS`** names each exception's rule, a pattern for the node's selector, text or colours,
  and why. An exception excuses only its rule on what it names, and a full run fails on one that excused
  nothing. `extension/test/a11y.test.ts` pins how far each reaches, with nodes the run found and nodes
  just past each edge. There are twelve:
  - Contrast on a theme colour the page can't change, since Light and Dark keep VSCode's Dark and Light
    Modern colours (GH-109): `--vscode-charts-blue` (blue states, 3.2 to 4.5:1), `--vscode-charts-orange`
    (orange states and the rail's attention counts, 2.4 to 4.1:1), `--vscode-descriptionForeground`
    (muted text on a raised or hovered surface, 4.1 to 4.5:1) and `--vscode-textLink-foreground`
    (avatars, mentions, counts and a chosen segment, on a tint of itself, 3.6 to 4.5:1).
  - Follow-ups in files T-52 to T-54 change now: the rail's tab names leave out the count they show
    (`rail.ts`); a tracker card's name leaves out what it shows (`boards.ts`, `tasks.ts`); a done or
    closed card is faded by opacity below 4.5:1 (`boards.css`).
  - Follow-ups outside the page's shared parts: Setup's done steps faded by opacity (`setup.css`); the
    Overview's rows and cards named by less than they show, and an `ol` whose rows have the role link
    (`landing.ts`); Settings' and About's action buttons named by more than they show (`settings.ts`,
    `about.ts`); and Setup's progress bar with no name (`setup.ts`).
- **Fixed in the shared parts:** a checklist icon in a task's description (`dom.ts`) carried an
  aria-label with no role, and now is `role="img"`; a code block that scrolls sideways (`dom.ts`) now
  takes keyboard focus. The run found no duplicate id and no landmark finding among these rules, so
  `main.ts` is unchanged. The harness's page gained the `<title>` the tab has (`htmlFor` in `panels.ts`).
- **Incomplete in the full run, by rule:** color-contrast 1048, label-content-name-mismatch 276,
  aria-prohibited-attr 252, th-has-data-cells 6.
- **Checked:** `a11y.test.ts` adds twelve tests: two violations make two findings; a dump where axe
  examined nothing, wrote no part, or failed; an exception's reach and its count; an exception that
  excused nothing; an incomplete result; axe's script before the harness's in the page; the dump the
  page writes holding the `a11y` part, and a contrast node's theme variable; the two `dom.ts` fixes; and
  each exception's reach. The full screenshot run passes: 426 drawings, no findings.

Out of scope: the accessibility of VSCode's own chrome around the page, and the follow-ups above.

## D-161 Every control's name holds what it shows, and faded text still reads: the eight a11y follow-ups are fixed (2026-10-15)

D-160 left eight accessibility exceptions as follow-ups. Each is now fixed where the page draws it, and
its exception is gone: `A11Y_EXCEPTIONS` holds only the four theme colours.

axe's label-content-name-mismatch joins the text of elements that sit side by side with no space between
them, so "Tasks" beside "14" reads as one word, "Tasks14". A name that holds the right words still fails
until the page puts a space between them. The spaces are text nodes in flex rows, which draw nothing.

1. **The rail's tabs** (`rail.ts`): a space between the label and the count, and `tabName` names a tab by
   what it shows, then its hint without the count twice: "Tasks 14, need you".
2. **Task cards** (`tasks.ts`, `board-nav.ts`): a tracker card has no aria-label, so what it shows names
   it, with its labels, people and the Moving badge of a held card. Its status is its aria-description,
   and the board's keys add their words (`KEYS_DESCRIPTION`) after it.
3. **Faded task cards** (`boards.css`): a done card, and a card in a done lane, sits flat with no fill or
   lift, in place of opacity 0.75 and 0.92. Its text keeps its contrast; its lane's heading says Done.
4. **The Overview's rows and cards** (`landing.ts`, `landing.css`): a line's link is its title, named
   by the title, then its state and key (`lineName`). Enter on the link opens the line, a click anywhere on it still does, and the
   line still shows the focus. A card puts spaces between its title, count and line.
5. **The Overview's lists** (`landing.ts`): a line is a list item again, with no role of its own, so its
   `ol` holds list items.
6. **Settings' action buttons** (`settings.ts`, `about.ts` in `src/model`): each name now holds its
   label, such as "Change place: where Jira · ACME, in Acme gets its tickets, and its board" and "Update
   the plugin to 0.37.0: the acc plugin, as Setup's A4 does". Cloud builders' Turn on…, Turn off,
   Token…, Default…, Change routine… and Add the routine…, and GitHub's Add Projects access, changed too.
7. **Setup's progress** (`setup.ts`): the bar is named "Setup steps done" and reads "32 of 40".
8. **Setup's done steps** (`setup.css`): no opacity; a done step's title is the theme's muted colour,
   and the foreground on hover or focus.

- **The full screenshot run passes:** 450 drawings, no findings; a11y examined 204164, above its floor
  of 190000. Excused: charts-blue 1618, charts-orange 901, descriptionForeground 315, textLink-foreground
  249. Incomplete by rule: color-contrast 1071, label-content-name-mismatch 276, aria-prohibited-attr
  264, th-has-data-cells 6. Behaviour: 36 cases, 286 checks; mutants 55, 55 caught.
- **Checked:** `names.test.ts` adds six tests, which split a name into words as axe does: the rail's
  names, the Overview's lines and cards, tracker cards, every action's name on every sample page and in
  each cloud, GitHub and plugin state, Setup's bar, and no done card, lane or step faded below opacity 1.
  `a11y.test.ts` adds one: the list holds only the theme colours, and none of the 17 nodes the
  follow-ups excused is excused now. The detail modal's behaviour case opens a question from its line and
  checks the line is a list item and focus comes back to its link. A new behaviour case focuses the
  line's link, presses Enter, and checks the question opens and Escape sends focus back to the link; its
  mutant drops the link's Enter handler, and the case catches it.

Out of scope: the four theme-colour exceptions, and axe's best-practice rules.
## D-162 A burst of notices shows as one notification that counts them (2026-10-15)

Amends D-044. After a person is away, the first reload finds many changes at
once, and each showed as its own VSCode notification, so the notifications
panel flooded.

- **One reload's notices are told together.** `update()` in
  `extension/src/notices.ts` looks at every project first, and then shows what
  `noticeBurst` (`extension/src/logic/notices.ts`) makes of all their notices.
- **Up to `BURST_AT` (3), each notice is its own,** with its own buttons, as
  before.
- **More is one summary:** "Since you last looked: 2 need you, 2 reviews
  passed, 3 merged." It counts the notices by kind, in words from
  `NOTICE_WORDS`, one row for each kind in `NOTICE_KINDS`, with the singular
  and the plural. Kinds with the same words count together: a builder waiting
  on its prompt and a blocked task both "need you". Kinds that hold an urgent
  notice come first, then the rest, each in `NOTICE_KINDS` order.
- **The summary is urgent when any of its notices is.** Its one button is
  Show, which opens the Overview. A burst about one task (one project and one
  id) names the task and keeps the buttons of its newest notice.
- **Slack is unchanged:** each project's events are still offered, one by one.
- **Checked:** `extension/test/notices.test.ts` adds three tests: three
  notices stay three, and more make one summary with its counts in order and
  its urgency; one task keeps its buttons, no notices give none, and two
  projects make one burst; and every kind has words. `extension/test/burst.test.ts`
  adds two: `update()` shows one notification for a burst across two projects,
  offers Slack each event, and its Show opens the Overview; and three notices
  across two projects stay three, each on its own task.

Out of scope: a list on the Overview of what changed while a person was away.
## D-163 The screenshot run draws three pages at once, each job in its own Chrome (2026-10-15)

The screenshot run drew every page one at a time in one Chrome, then ran the behaviour cases and their
mutants one after another: about eleven minutes for a full run. Now it draws `DEFAULT_JOBS` (3) pages at
once, and `--jobs N` sets how many.

- **Jobs** (`extension/scripts/jobs.ts`): `splitJobs` shares the pages out by how tall each is shot, the
  tallest first, each to the job with the least so far. Each job draws its pages one after another, each
  drawing in a Chrome with the job's own `--user-data-dir` (`profile-<slot>` in the run's work folder) and
  its PNGs written into `out/.job-<slot>/` first, then moved into place. The comment that said a fresh
  profile made Chrome hang after the shot no longer held: a profile kept for a job's drawings drew and
  exited in 4 to 6 s each time.
- **Same result:** each drawing's lines, verdict and note are held until those before it are done, so the
  log, the PNG names and `shots.json` are in the pages' order whatever `--jobs` is. `--jobs 1` is one job
  drawing in the old order. `fingerprint`, `noteShots` and `looked.ts` are unchanged.
- **Failures:** a drawing that times out is drawn once more in its own job (`drawRetried`). A Chrome that
  dies, or a drawing with no geometry, fails that drawing only: the run names each one, draws the rest,
  notes what it drew, and exits 1. Before, the run stopped at the first.
- **Behaviour:** the cases, and then the mutants, run in a `pool` of as many slots, each slot with its
  own profile. A mutant builds its bundle into its own folder, `mutant-<i>/main.js`, and runs its cases
  one after another in its slot. The log is in `CASES` and `MUTANTS` order.
- **Timing:** full runs of this commit, back to back, started once no other headless Chrome was running
  and the load average was under 8 (a stuck `adb` and Malwarebytes hold about 3 of the 12 cores all the
  time; other work raised the load to 17 to 34 during the runs, so they were not on a fully idle
  machine): `--jobs 1` 660 s, `--jobs 3` 249 s. Both drew 450 drawings with no findings, ran 35 cases
  and 54 mutants, all caught, and gave the same 542-line log and, for each of the 450 shots, the same
  fingerprint, findings and classes drawn in `shots.json`. 142 PNGs' bytes differed; two runs of the
  same pages at `--jobs 1` differ the same way (7 of 12 PNGs for `loading` and `tasks`), so Chrome's
  PNG bytes aren't the same from run to run whatever `--jobs` is.
- **Checked:** `extension/test/jobs.test.ts` adds 11 tests: the splitter finds each page once across the
  jobs; an empty list, k above the count and k below 1; `--jobs`; results handed on in order; `runJobs`
  and `pool` with a failing job; `runAsync`'s output, timeout and missing program; three pages drawn with
  `--jobs 1` and `--jobs 3` by a stand-in Chrome give the same findings, counts, log and record; a Chrome
  that dies fails its drawing only; and the behaviour pool with each mutant in its own folder.
  `steady.test.ts` adds 1 for `drawRetried`.

Out of scope: skipping pages that did not change, which needs a fingerprint per page.

## D-164 News while you are away waits on the Overview's Since you last looked (2026-10-15)

Amends D-044, and builds on D-162. A person who comes back to VSCode wants
what changed while they were away in one place, and the notifications panel
is not that place.

- **Away is ten minutes with no window focus** (`AWAY_AFTER_MS`). The pure
  part, `Away` in `extension/src/logic/away.ts`, decides it from the focus
  changes and the time. `Notices.focus()` gets each change from the window's
  `onDidChangeWindowState`.
- **While away, news is held; urgent notices still show,** through D-162's
  burst rule. Slack still gets each event, as before.
- **On return after an away span with news,** one notification:
  "While you were away: 1 review passed, 2 merged.", worded by
  `noticeCounts`, the burst's counting, now shared. Its Show opens the
  Overview at the new group's heading (`acc.open.home` takes a part). A span
  with no news says nothing.
- **The Overview shows Since you last looked** between Needs you and the
  cards: a calm line for each held notice, with an icon and a label for its
  kind (`SINCE_LOOK`, orange for what needs you, blue for news), its task key
  and its text. A line opens its task. Clear (`acc.since.clear`) takes the
  group off at once and forgets the list.
- **The list stays** until Clear, or until the next away span starts, which
  starts it again with that span's news. It is held in the window's memory
  only: a reload of VSCode starts it empty.
- **Checked:** `extension/test/away.test.ts` (10 tests): nine minutes is not
  away and ten is, focus back ends the span, news is held and urgent is not,
  a span with no news says nothing, two spans keep the newer one's news,
  Clear, the welcome back's words, and the group's lines. `burst.test.ts`
  adds two that drive `Notices` with a fake window state and clock. The
  screenshot run adds `overview-since`, and a behaviour case clicks a line
  and Clear, with two mutants: Clear that leaves the group, and Clear that
  tells the extension nothing.

Out of scope: Slack's messages, and keeping the list across a reload.
## D-165 The slow tests start their processes a few at once, the dispatch tests are three files, and the tests keep a compile cache (2026-10-15)

T-57. The test suite's time went to a few tests that start processes one after another, and to one file
that held 48 of them.

- **Pool:** `pool(items, size = 4, fn)` in `packages/core/test/support.ts` runs at most `size` calls at
  once and gives the results in the items' order. A call that throws makes it reject with a `PoolError`
  that names the item, and no later item starts. `packages/core/test/pool.test.ts` has 8 tests.
- **Pooled:** the CLI junk-argument test (8 at once), the extension junk-argument test (4 commands at
  once), the hook fixture test, and the cloud-guard Edit/Write test and push test (4 at once). Each keeps
  every assertion and its count line.
- **Split:** the CLI junk-argument run is three tests, each a third of the registry's entry points dealt
  in turn, and a fourth that keeps the totals line and checks every command and subcommand was reached.
  `dispatch.test.ts` is three files: the packet, settings, model and effort tests stay; a dispatch run end
  to end is in `dispatch-run.test.ts`; conflict-aware dispatch (D-093) is in `held.test.ts`. Their shared
  helpers moved, unchanged, to `dispatch-support.ts`. Node runs test files side by side, so one file no
  longer sets the suite's time.
- **Stays in sequence:** a test whose steps read what the step before wrote (the gate ratchet test,
  `acc agents auto-merge`, `acc updates`, a builder's note) keeps its order. The merge queue's stops and
  the relaxed-floor merge run their code in-process and synchronously, so they start no processes to
  pool. The near-tests tests and the colour-table test start no processes either. The compile cache's
  folder is kept across runs on purpose, the one exception to GH-174. Activation's
  processes are the extension's own.
- **Timing:** `npm test` on this machine, load average 3 to 5 at the start, Malwarebytes' endpoint agent
  using one to two of the 12 cores throughout. Before (main's tests): 179 s; the CLI junk test 94.5 s,
  the extension junk test 66.0 s, the hook fixtures 18.2 s, cloud-guard push 12.6 s and Edit/Write
  12.0 s, `dispatch.test.ts` 122.9 s in all. After: 131 s; CLI junk 15.1, 15.0 and 15.2 s a part,
  extension junk 16.7 s, hook fixtures 6.5 s, cloud-guard push 6.2 s and Edit/Write under 5 s, the
  dispatch files 38.1, 40.8 and 26.9 s. The longest test was 16.7 s.
- **The first run's limit:** with 16 files at once instead of 11 the suite took 129 s, so the files
  weren't waiting for a slot: starting processes was the limit (223 s of system time a run), and the
  endpoint agent was at 180 to 200% of a core in the minutes after a run. The review asked for the suite
  under 120 s.
- **Compile cache:** `scripts/compile-cache.ts` is loaded before `node --test`, by npm test and the
  near-tests gate. It names `NODE_COMPILE_CACHE` (a folder in the machine's temp folder, unless the
  environment names one), so every test file and every acc a test starts reuses what Node compiled before.
  Node keys the cache by each file's contents and its own version, so an edited file compiles fresh. One
  `acc --help` went from about 300 ms to about 150 ms. `scripts/test/compile-cache.test.ts` has 3 tests.
- **Timing with the cache:** the machine was never idle: Spotlight was indexing (`mds_stores` at about
  200%) and the endpoint agent was at 160 to 200% throughout, load average 8 to 17 at the start. With the
  cache, npm test took 102.1 s (load 17 at the start) and 120.1 s (load 8, rising to 20); with it turned
  off (`NODE_DISABLE_COMPILE_CACHE=1`) straight after, 147.8 s. The longest test was 15.9 s and 22.7 s
  (both the CLI junk totals test), so no test took over 30 s.
- **Timing on a quiet machine (2026-10-15, at the merge of T-62):** no builder running, load average
  3.6 at the start. npm test took 98.4 s, under the 120 s limit, inside the full `npm run check` of
  1612 tests. Criterion 4 is met.

## D-166 The extension finds a newer release by itself, offers it in a notification, and installs it, reloads and opens the Command Center (2026-10-15)

T-62. A newer release showed only in Settings' About, and a person installed
it by hand. The author asked for the extension to look by itself, offer it,
and install it in one click.

- **This changes D-120's "a release installs by hand".** D-120 chose not to
  install from the page, since the VSIX comes from a private release. The
  install now runs as gh's active account, as About's look already does, so
  the private release is no obstacle. About's newer-release row and the
  notification both have **Install and reload**. D-120's look, its six-hour
  interval and its neutral failed look stay.
- **One look, shared.** `self-update.ts` asks About's `lookIfDue` a minute
  after activation (`FIRST_LOOK_MS`), then each `RELEASE_EVERY_MS` after the
  last look, whoever made it (`nextLookIn`). A look already going isn't
  started twice, and About shows what the look by itself found. A failed look
  stays quiet: no notification, and About's neutral row.
- **One offer for each version.** `shouldOffer`: newer than the running
  version, not the skipped one (nor older than it), and not offered in this
  session. A closed notification counts as offered. **Skip this version**
  keeps the version in global state (`acc.update.skipped`); a later version
  is offered. With `agentCommandCenter.updates.check` off, nothing is looked
  for by itself and nothing is offered; About's Check now still looks, and
  its Install and reload still installs.
- **Install and reload.** `gh release download <tag> --pattern '*.vsix'
  --pattern '*.vsix.sha256'` into a new temporary folder; exactly one `.vsix`,
  named `agent-command-center-<version>.vsix` (`pickVsix`); the SHA-256 against
  the release's `.sha256` when it has one, a mismatch refused
  (`checksumCheck`; a release with none installs, and the log says so, since
  releases before this one have none); `workbench.extensions.installExtension`
  with the file's URI. The temporary folder is removed before the reload,
  since the reload ends this run of the extension, and on every failure.
  Then `acc.update.after` holds the version and the window reloads. Each
  step shows in a progress notification. A failure says which step failed,
  in words, and offers **Release notes**.
- **After the reload.** Activation reads `acc.update.after` and clears it
  (`afterUpdate`). The running version is the saved one: the Command Center
  opens and says "Updated to <version>". Another version runs: a warning says
  the update didn't take.
- **Checksums on a release.** `npm run release` writes
  `agent-command-center-<version>.vsix.sha256` beside the notes, in the
  format `shasum -a 256` prints in the `.vsix`'s folder, and uploads it with
  the `.vsix`. A test compares it with `shasum -a 256` itself. The `.vsix`'s
  name is one function, core's `vsixName`, which packaging and the update
  share.
- **Words and states.** The notification and About speak in processes. The
  newer release stays orange with its arrow icon, and current stays blue.
- Not chosen: updating the acc plugin here (Setup's A4 fix does that);
  Marketplace updates; a modal before the reload (the notification's button
  is the person's click); keeping a session's offered versions across
  windows (Skip is the way to say no for longer).
- Changed by D-173 (2026-10-19): a release with no checksum file is now
  refused, not installed.

## D-167 The output panel shows a review as a short summary that opens up, not as plain text (2026-10-16)

T-63. A review started from a card ran in the output panel as plain text, in
a monospace font: the verdict, each criterion and each finding ran together.
The author asked for a review in the panel to read well, in the page's own
style, and to stay short, since the panel opens over the page.

- **The run knows it is a review.** `acc.task.review` starts its run with a
  `review` option: the project, the task and the branch's head as it started.
  When the run ends, and wasn't stopped, the extension reads the task's
  newest verdict file in the reviews folder, by when it was written
  (`logic/dock-review.ts`), and the lines around each finding with git, as
  the task page reads them (T-53). The run keeps what it read, so a reload
  shows it too. A verdict written before the run started is another
  review's: this run wrote none. A review kept over a reload while its
  verdict was still being read says so (`keptReview`).
- **One pure model.** `model/dock-review.ts` turns the run into one of three
  phases: running (one line, with a clock while it's live), unread (stopped,
  no verdict, or a file that isn't JSON or isn't a verdict: the run's lines
  and why), and done. A done review's card wears the verdict's look, since
  acc review exits 1 when it asks for changes, which isn't a failure; the
  run's `ok` is a verdict written, as an analysis's is (D-052).
- **Short.** A header line holds the verdict's icon and label, the task, a
  count ("3 of 4 criteria, 2 findings") and one primary button: Land for a
  pass, and Send back to the builder (`acc.task.dispatch`, the re-dispatch
  that gives the builder the findings) for changes. It stays in view when
  the rest scrolls. Who, when and how long are its hover. The summary shows
  two lines; More opens the rest and the client sentence. Then one row for
  each criterion not met, then each finding, must-fix first, its text on one
  line and its file name and line as a link; a click opens the row in place.
  The met criteria fold into one row. While the review shows, the panel's bar
  doesn't say the verdict too.
- **No second copy.** A finding's rows come from the task page's
  `ticketReview`, and draw with its `place` and `excerpt` (`review.ts`). Its
  file opens through `openReviewFile`, which the task page now calls too; the
  Command Center takes `review-file` from the panel (`dock-review.ts`).
- **The plain text stays.** Show output, in the panel's bar, shows the run's
  lines as before, and Show the review goes back.
- **Checked.** `dock-review.test.ts` has 17 tests: the model's phases and
  edge cases, the reader against a real folder, a review run ending with its
  verdict on the card, and a run that isn't a review drawing as it did. The
  screenshot run adds five pages over the Tasks board: a review that passed,
  one that asked for changes, one still running, the changes one with its
  summary, a criterion, a finding and the met criteria opened, and one whose
  verdict file isn't JSON. A behaviour
  case clicks through the panel. Four new mutants (the verdict dropped for
  the lines, a row that opens nothing, a next step that sends nothing, Show
  output that does nothing), and the task page's link mutant, each fail it.
- Not chosen: other kinds of run (an analysis can follow this one); turning
  the next step off when the task has moved on since (Land asks first, and
  acc refuses a step the task's state no longer allows, with why).

## D-168 Dispatch asks for the model, the effort and where it runs in one sheet, and a task's buttons share one size and place (2026-10-16)

T-67. A task showed Dispatch, Dispatch with…, Dispatch to the cloud, Move and
Block as buttons of different widths, in rows that wrapped where they fell.
Dispatch started a builder at once; Dispatch with… asked for the model and
the effort in two of VS Code's pickers, one after the other (D-086, D-128).
The author wanted one Dispatch that asks first, and the buttons on a task in
one size and one place.

- **One Dispatch, one sheet.** Dispatch opens a sheet over the page, in the
  page's modal (`makeModal`): "Dispatch ACME-16", or "Re-dispatch ACME-19" for
  a task in rework. Model is a list of `dispatchModelItems`, the one the
  builder uses chosen, its source in muted type ("project default", "picked
  for this task"); Another model… shows a box for a name, and Dispatch is off,
  with why, until it holds one. Effort is a segmented control of the levels
  the chosen model takes, lowest first, the one it runs with chosen; the line
  under it says where that's set or what the level means. A model that takes
  no level hides it and says so, with the pick it drops. Where is This Mac or
  the cloud, the project's default chosen; the cloud is off with
  `cloudDisabled`'s reason in its title and in a line, and chosen, a line says
  the routine's own model and effort apply there. The analysis's size shows
  in muted type. Cancel and Dispatch, the primary, close it; Enter
  dispatches, Escape cancels, and focus goes back to what opened it.
- **The page that asked shows it.** From a task's own tab, the sheet opens
  over that tab; from the modal over the board, over the Command Center
  under it; from anywhere else, such as the sidebar, a notice, the palette or
  a key binding, over the Command Center, which opens first when it's closed
  (`Panels.tell`). A card dropped in Running opens it too, in place of the
  old confirmation, and goes back to its lane meanwhile.
- **The choice is acc's arguments.** The page sends what was chosen
  (`dispatch-sheet-go`); the extension reads the task again and
  `dispatchChoiceArgs` turns the choice into arguments with
  `dispatchModelArgs`, `dispatchEffortArgs` and `noEffortArgs`. A choice the
  same as the sheet's defaults sends none, as acc keeps a pick made before; a
  place other than the project's default sends `--cloud` or `--local`.
  `dispatchTask` runs it, and a cloud builder's run says so and offers its
  session on claude.ai, as Dispatch to the cloud did.
- **Dispatch with… and Dispatch to the cloud go.** `cardActions` lists
  neither. Their commands stay for one release, so a key binding still works,
  and each opens the sheet; Dispatch to the cloud chooses the cloud when it's
  on. Dispatch anyway (D-093) opens the sheet too, its button "Dispatch
  anyway" and the tasks and files it shares above the choices. After the
  sheet, a first dispatch that would wait for others' files still asks whether
  to wait, and one acc holds still asks before Dispatch anyway, as before.
- **One size, one place.** A task's actions keep one order, `actionOrder`:
  the next step, then Move, then Block or Unblock, then the rest as they
  came. On the task page, the next step is a full-width button on a row of
  its own, and the rest sit under it in two equal columns, each 30 px high,
  with its icon and its label, cut with an ellipsis and whole in its title
  (`task-actions.ts`). A disabled one stays in its place, with its reason in
  its title. A card's next step is the same full-width button under its
  footer's line; the rest stay behind ⋯ (D-062), in the same order, one to
  a row.
- **Checked.** `dispatch-sheet.test.ts` has 9 tests: the sheet for a task
  to do and in rework, a model that takes no effort, the cloud off with its
  reason, Dispatch anyway, the effort segments, and the arguments, the
  defaults sending none and another model, effort and place each sending
  theirs. `dispatch-sheet-open.test.ts` has 5, against the built extension:
  each of the four commands opens the sheet and dispatches nothing; a task's
  tab and the modal show it over themselves; a closed Command Center opens
  first; the sheet's Dispatch reaches acc dispatch. `cards.test.ts` checks
  that no card lists Dispatch with… or Dispatch to the cloud, `actionOrder`
  and the task page's `taskActions`. The screenshot run adds four pages:
  the sheet over the Tasks board for ACME-16, analysed; over ACME-19's tab
  in rework with the cloud off; the agent board with a card's ⋯ open; and
  Dispatch anyway's sheet for ACME-35, with the files it shares. The name box
  for Another model… shows only after a pick, so the screenshots gate's
  `UNDRAWN` names it, and a behaviour case draws it. A new geometry check,
  `actions`, finds a task page's buttons equal in height, the grid's equal in
  width and the next step as wide as the grid, and a run with no task page
  buttons to measure fails; an open menu floats over the page, as a sticky
  layer does. Three behaviour cases open the sheet from a card and from the
  task page, pick a model and see the efforts change, press Enter and see
  the message, press Escape and see none, and type a model's name for
  Another model…; six new mutants, Dispatch without the sheet among them,
  each fail one.
- Not chosen: a grid of every action on a card, which D-062 put behind ⋯;
  folding acc's own wait for others' files into the sheet; Autopilot's
  dispatches, which ask nobody.
## D-169 Every run in the output panel shows as rows, never as a block of raw lines (2026-10-16)

T-64. The output panel showed each run as its command and its lines in a
monospace block. D-167 gave a review its own view, but its Show output and
every other run were still plain text. The author asked for no plain text
in the panel at all: each run in the page's own type and the theme's
colours, as the review view reads.

- **Rows from one pure function.** `logic/run-rows.ts` turns a run's lines
  into rows, with no `vscode` import: a success (a tick, "Done", "passed",
  "Deployed") with a blue mark; a warning and an error with an orange icon
  and label; a count of progress ("3/10", "45%") as a thin bar; and a note
  in muted type. "0 failed" and "no errors" aren't failures. It drops colour
  codes, blank lines, a spinner's frame, and the "npm ERR!" or "Warning:" the
  row's label says. A line that repeats is one row with a count, and a count
  that moves on is one row at its latest. The last 200 rows show; one line
  counts the rest. A URL is a link. A file path is a chip: one in the folder
  the run ran in opens at its line (`Runs.openFile`, through the review's
  `fileInCheckout`), and one outside it is a quiet label that says why.
- **The card carries it.** `runCard` adds the rows, the count not shown, how
  long it took, its folder and its result (`model/run-view.ts`). The header
  line's state label is now Failed, not "Failed (exit 1)": the exit code is
  on the result card, in words ("It reported an error (exit code 1).").
  History shows a failed run as Failed too.
- **A header line, a menu and a result card.** The header line shows the
  state's icon and label, the run's name, and its clock (the review's own
  `clock`) or how long it took. The command moves into Details, in the
  header's menu (the board's `moreMenu`) with Copy log and the run in a
  terminal. Copy log copies every line the run kept, from the extension, not
  only the rows shown. An ended run ends with a result card: one sentence,
  a failure's last error row and exit code, and one next step: Open the step
  for a setup step's fix, Run again for any other run, and none for
  autopilot, whose switch starts it. Run again starts the command with the
  options it first had, in place of the ended run; one kept over a reload
  has only its folder, label and step.
- **Reviews too.** A review's Show output shows the same rows, with no
  result card, since its review says how it went.
- **Checked.** `run-rows.test.ts` has 15 tests: each kind, a URL, a path in
  the folder and outside it, repeats, escape codes, an empty output, more
  than 200 rows, the exit code in words, the result card and the run's card.
  `run-view.test.ts` has 4: Copy log, Run again, opening a path, and the
  panel drawing every run with `renderRunRows`. The screenshot run draws four
  more pages over the Tasks board: a deploy running, the deploy done with
  more rows than it shows, a lint that failed, and the deploy with Details
  open; Setup's output page is the run waiting for an answer. A new geometry
  check, raw, fails on a `pre`, or the `pre.dock-out` the panel used, in any
  panel drawn (`RAW_OUTPUT`), with a floor of 330 panels a run, and
  `geometry.test.ts` has a test for it. A behaviour
  case clicks through the failed lint, and five new mutants each fail it:
  the raw lines again, Details showing nothing, Copy log, a chip and Run
  again each sending nothing.
- Not chosen: how acc reports its own steps (a separate task gives its
  commands a step list); the terminal tab, which stays a terminal; a menu
  that opens on a keyboard shortcut.

## D-170 History groups its entries under a line for each day, and loads them a page at a time (2026-10-16)

History in full drew up to 300 entries at once, in one long list: too much to
read, and costly on each refresh.

- **A line for each day.** Each day's entries sit under a thin rule with the
  day's name in its middle, an `h3`, so a screen reader moves from day to day:
  Today, Yesterday, a weekday within the last 7 days, then "Tuesday, 7
  October", with its year when it isn't this year's. The names come from the
  person's time zone, in the page (`webview/days.ts`, which holds no DOM). The
  rule is the page's `--edge`, mixed from the theme's foreground: in a dark
  theme the panel border is near the modal's own colour, and didn't show.
- **Rows that read well.** Each entry is one row: its state's icon and label,
  its task's key, one line of text cut with an ellipsis (all of it on hover),
  and its time on the 24-hour clock at the right. A click opens its detail in
  place, as before. A move now carries its look from the model.
- **Pages.** The home model sends History's newest 40 and each filter's count
  (`model/history-pages.ts`, no vscode import). Each entry has an id that
  stays the same from refresh to refresh, and History's order breaks a tie in
  time by id, so a page asked for after an entry starts at the same place,
  though that entry is gone. The page asks with `history-more` when the list's
  end comes near (an IntersectionObserver), and the extension answers with
  `history-page` from every entry History holds now (`src/history.ts`).
  "Loading…" shows while it waits, and "That's everything" at the end.
- **Filters and opening at an entry.** A filter asks for its own first page;
  the counts are the model's. A line that opens History at an entry not loaded
  asks for the pages up to it, then scrolls to it. An entry that's gone gives
  the next page, with nothing marked.
- **Refresh keeps the place.** What the page loaded is kept
  (`webview/history-store.ts`): a new model's newer entries go on top, and the
  row in view stays where it was (`keepPlace`, which measures again after each
  move, as a scroll can land a few px short of where it was set). It measures
  in the layout's px (`scaleOf`): while the modal still grows in as it opens,
  a box measures up to a tenth smaller than it lays out. When All's
  whole first page is new and more are still to come, there may be a gap, so
  All starts again from it.
- **Checked.** `history-pages.test.ts` has 29 tests: day names (each of the
  last 7 days, an older date, midnight in Chicago), the pages (first, next,
  last, a filter's, up to an entry; no entries, exactly 40, an entry that's
  gone), the page's store and its kept place, also while the modal grows in, the home model's 40 with its
  counts, and a mutant
  of the model that sends every entry, which the page-size check catches. The
  screenshot run adds History with 100 entries over six or seven days. A
  behaviour case scrolls to the end and sees the next page arrive, takes a
  refresh with a new entry while scrolled, picks Commands, and opens History
  at an entry on its third page; five mutants each fail it. Headless Chrome with a virtual time budget draws no frames, so no
  IntersectionObserver reports there and a scroll fires no event: the
  behaviour page stands in for it, measuring boxes on each scroll event, and
  the probe's scroll fires one.
- Not chosen: changing what History records, or its cap of 300 entries; the
  task page's own day lines (`dayLabel`), which stay as they are.

## D-171 acc's long commands report their steps, and the output panel lists them (2026-10-16)

T-65. T-64 (D-169) showed every run in the output panel as rows, but for a
run of acc's own the panel could only guess from its lines. acc knows its
steps, so it now says them, and the panel shows a deploy, a promotion, a
dispatch, a land or an analysis as a list of steps.

- **A step channel, a file.** When `ACC_STEPS` names a file, acc writes one
  JSON line for each step event: its id, its label in process words, its
  state (started, done, skipped or failed) and a short note. The last line
  is the result, ok or not, in one sentence. A file, not acc's output: the
  output stays exactly as it was, with the variable or without, and the
  panel reads steps without parsing lines. The file is written whole for
  each line (a temp file, then a rename), so a reader never sees half a
  line, and a write that fails is dropped: the work goes on unreported.
- **One helper in core.** `packages/core/src/steps.ts` gives `start`, `done`,
  `skip`, `fail`, `result` and `step(id, label, fn)`, which fails the step
  with what fn threw. Each command takes an optional `steps` in its deps; one
  not given reports nowhere (`NO_STEPS`), so autopilot's in-process calls are
  unchanged. The CLI opens this run's steps in `main` from `ACC_STEPS`, then
  takes the variable out of the environment, so a builder or analyst acc
  starts never writes to the same file. A command writes its own result; one
  that throws, or reported steps and wrote none, gets one from `main`. A
  command that reported no step writes no file.
- **The steps.** Deploy: check the branch, work out what changed, check it can
  go, check out the commit, deploy, record it, draft the tickets' updates (7).
  Promote: check the branches, work out what changed, check it can open a pull
  request, build the branch, check in the destination's org (or skipped, with
  why), push, open the pull request, record what it carries (8). Dispatch:
  check the task, check the files in flight (or skipped), make and set up the
  worktree, write the instructions, start the builder, record the run (7; 9
  in the cloud, with the push guard and the push). Land: check its review and
  checks, sign in to GitHub, look for its pull request, push, open or update
  it, check it merges, record it, draft the ticket's update (8). Analyze:
  check the task, gather what the analyst reads, analyze, read the analysis,
  save it (5). Setup's baseline and lists take a step a branch, branches a
  step a branch it makes, and readme one step.
- **The extension listens.** `Runs` gives a run of acc (`runsAcc`: acc, a
  path to it, or the extension's own `acc.mjs`) a steps file in a temp folder
  of its own, reads it every 250 ms and before each chunk of output, so each
  step keeps the lines printed while it ran, and removes the folder when the
  run ends. acc's notes and result go through `reasonInWords` (D-132). acc's
  result says whether the run worked, over its exit code: an analysis with
  questions exits 1, and its steps worked.
- **The panel.** A run with steps lists them under the header line: a quiet
  spinner while one runs, then Done, Skipped or Failed, each an icon with its
  label (a failed one's label shown, in orange); Didn't finish for one still
  running when its run ended. A failed step shows its note and opens to its
  own rows. The output rows fold into one row, "Show 42 lines". The result
  card says acc's sentence and how long it took.
- **Dispatch and land move into the panel.** They ran under a notification
  with acc's `--json` answer read at the end. They now run in the panel, so
  their steps show; `StartOptions.answer` hands the `--json` stdout to the
  extension apart from the rows, and what follows (the toast with Watch, the
  pull request's link) is as before. A sidebar given no way to run them in
  the panel (`runAccShown`), as in tests, runs them under the notification.
- **Checked.** `packages/core/test/steps.test.ts` (7 tests) covers each event,
  the result closing open steps, `step()`, notes, a write that fails, no
  `ACC_STEPS`, and reading junk. `packages/cli/test/steps.test.ts` (12 tests)
  pins each command's plain output as it was before this change, and the
  same with `ACC_STEPS`; checks each command's steps in order for a run that
  works and one that fails part way (Setup's readme has one step, so it
  fails at it); and checks `openSteps`. `extension/test/run-steps.test.ts`
  (8) and `run-view.test.ts` (3 more) drive a fake acc whose steps reach the
  card as its file grows, its folder gone at the end. A browser case clicks
  the failed step and the fold, and two new mutants each fail it. The
  screenshot run draws three more pages: a deploy in progress, a promotion
  that failed at its check (opened), and a dispatch that finished.
- Not chosen: steps for other tools' commands, such as `sf` or `brew`, which
  T-64's rows show; listing a command's steps before they start, since a
  step's label can depend on what the run finds (the environment, the
  pull request); steps written to stderr, which would change acc's output.

## D-172 The project verifies a UI change with the pinned headless shell, never the person's own browser (2026-10-16)

The screenshot and behaviour runs started the person's own Chrome app in
headless mode, three at a time, hundreds of times a run. To macOS each one was
the Chrome app: its icon flickered in the Dock, and a click on Chrome brought
a headless one forward, so the person couldn't open their browser. On
2026-10-16 this stopped the author using Chrome.

- **The rule.** The project verifies a UI change with Google's
  `chrome-headless-shell` from Chrome for Testing, at the version the repo
  pins, never the person's own browser. It is a binary with no app bundle, so
  macOS never takes it for the Chrome app. CLAUDE.md says so, and the
  screenshots gate checks it (below).
- **The pin.** `extension/scripts/browser.json` names version 155.0.8059.84
  and each platform's zip SHA-256: mac-arm64, mac-x64 and linux64. Each hash
  was taken with `shasum -a 256` of the zip downloaded from
  `chrome-for-testing-public` on 2026-10-16; mac-arm64's equals the zip the
  merger checked that day. The zips stay out of the repo.
- **Getting it.** `npm run browser` (`extension/scripts/browser.ts`) downloads
  the pinned zip into `~/Library/Caches/acc/chrome-headless-shell/<version>/`
  (on Linux `$XDG_CACHE_HOME` or `~/.cache`), checks its SHA-256, and unpacks
  it into a folder of its own before moving it into place. A zip whose hash
  differs is deleted and nothing is unpacked. With the version already there,
  it does nothing. `--check` exits 1 when it isn't there.
- **Which browser draws.** `findChrome` takes `CHROME` first, then the pinned
  shell in the cache, and the Chrome app, Chromium or Edge only when neither
  is there. It says in one line what it draws with; the Chrome app's line says
  the run may take it over, and names `npm run browser`.
- **Nothing left running.** Each browser starts in a process group of its own
  (`extension/scripts/stops.ts`), tracked until it closes. On exit, an
  uncaught error, SIGINT or SIGTERM the run stops every group, so a browser's
  helper processes go with it. The colour check now draws without blocking,
  as the others do, so a signal reaches it mid-drawing.
- **The gate.** Each shot's note in `shots.json` records the browser that drew
  it: its binary's name and the version it says it is. The screenshots gate
  (D-138) fails a shot drawn by anything but the pinned shell at the pinned
  version, and a note that names no browser, naming `npm run browser` as the
  fix. Shots taken before this change name none, so they are taken again.
- **Setup.** A new config list, `tools`, names the tools a project's own checks
  need, each with a `check` command that exits 0 when it's there and a `fix`
  command. Setup's step `B13.tools` runs each check in the main checkout and
  offers the first missing tool's fix; a project that lists none skips it. The
  core names no project's tool (D-003): this repo lists the shell, with
  `npm run browser` as its fix.
- **Checked.** `browser.test.ts` has 10 tests (the pin, the platforms and
  cache, a match, a mismatch, the version already there, a fetch that fails,
  from a local zip); `stops.test.ts` 6 (a run that exits, throws, leaves a
  promise rejected, or is sent SIGINT or SIGTERM stops 3 fake browsers and
  each one's helper, and one with nothing running stops nothing);
  `screenshot.test.ts` 3 more for `findChrome`, with the line each case
  prints, and a wrong `CHROME` gets its own message; `looked.test.ts` 2 for
  the gate; `tool-steps.test.ts` 5. With the group kill turned back into a
  plain kill, the SIGTERM test fails, naming the helpers left running; with
  `stopOnExit` taken out, all five endings fail. The full run with the shell
  drew 540 drawings, as before, with no findings, 43 behaviour cases and 77
  mutants caught, in 195 s. The merger waived a timing with the Chrome app:
  the person was using it, and the app is what this moves away from. That the
  Chrome app opens a window when clicked while the full run draws is left for
  the person to check at the merge.
- Not chosen: reusing one browser for many drawings, which can follow this.

## D-173 The self-update refuses a release that has no checksum file (2026-10-17)

T-72. D-166 let a release with no `.sha256` install, and wrote a line to the
log, since releases before 0.41.0 had none. 0.41.0 has one, and `npm run
release` uploads one with every release, so the exception is no longer needed.

- **Refused.** `checksumCheck` returns the error "the release has no checksum,
  so it isn't installed" when the release holds no checksum file. `install`
  shows it in the notification as it shows a mismatch ("Couldn't update to
  <version>: ..."), offers **Release notes**, installs nothing and does not
  reload. The "installed unchecked" log line is gone, and the result no longer
  has a `checked` field, since a pass is always checked.
- **This changes D-166's "a release with none installs".** A release before
  0.41.0 can't be installed by the update. A person installs it by hand.
- **Checked.** `self-update.test.ts` has a case for a release with no checksum
  file in its table of failures (nothing installed, no reload, nothing saved,
  the reason shown, the notes offered, the folder removed), and the unit test
  of `checksumCheck` expects the refusal.

## D-174 A Salesforce project can say it doesn't use source tracking (2026-10-17)

- **Why.** Some clients don't use source tracking. acc works without it: its
  retrieves use manifests (drift, the baseline) and its deploys and
  validations use source folders. Only Setup's two B8 steps assumed it, and
  they failed for such a project with nothing to fix.
- **The setting.** `sourceTracking` in `.acc/config.json`, true or false. Left
  out, the project uses tracking, so no existing project changes. Another type
  is refused. Outside Salesforce nothing reads it, and `false` gets a warning,
  as `strayFiles.data` does. A team template can't set it: it's each
  project's own.
- **Setup.** With it false, `B8.tracking` and `B8.cli-tracking` skip before
  they ask any org, and say the project doesn't use source tracking and where
  to turn it on: Source tracking under Limits and checks in the project's
  settings.
- **Changing it.** `acc tracking [on|off]` shows it or changes only that key,
  written whole through a temp file. On takes the key out, since on is the
  default. A builder, reviewer or analyst is refused, and so is a project that
  isn't Salesforce. Settings' Limits and checks shows a Source tracking row
  for each Salesforce project, Used or Not used, whose Change… runs it.
- **Nothing else assumed tracking.** The rest of acc's sf calls were checked:
  deploys and promotions pass `--source-dir`, drift retrieves by manifest with
  `--ignore-conflicts`, and the analyst's retrieve names its components. `acc
  init`'s note that agents work best against a source-tracked Developer
  sandbox is advice, not a check, so it stays.
- **Checked.** `source-tracking.test.ts` has 3 tests, `config.test.ts` 1,
  `onboarding.test.ts` 1, `cli/test/tracking.test.ts` 2 and `limits.test.ts`
  1.
- **A pinned refusal (2026-10-19, T-77).** `setSourceTracking` runs the
  whole `loadConfig` check, so `acc tracking on` or `off` refuses a Salesforce
  config that has any other problem, and leaves the file as it was.
  `source-tracking.test.ts` has a test for it.

## D-175 A person writes a task in a full sheet, and edits its title, description and other fields later (2026-10-19)

T-74. A person wrote a task in two one-line boxes, and after that nothing
could change it: not the title, a full description, or the details a builder
needs.

- **One command, `acc edit <id>`.** It changes a task's title, brief,
  dependencies, environment, labels and notes for the builder, with `acc
  add`'s checks (`environmentProblem` and `taskDeps`, which `upsertTasks` now
  uses too). A field left out stays as it is; `--dep ""` or `--label ""`
  clears a list. Each edit that changes something adds an entry to the task's
  `edits`, with who made it and which fields, and emits `task.updated` with
  the new values; one that changes nothing records nothing. `edits` is apart
  from `history`, which holds moves: autopilot, the packet and History read
  `history` as moves, and an edit with `from` equal to `to` would read as one.
  `acc show` lists both in time order, the Command Center's History lists
  each edit as its own entry under Tasks (`EDIT_LOOK`, with the fields in
  words from `editedWords`), and a task's page shows its edits in its
  activity beside its moves. `acc add` takes `--title` and `--label`
  too, so a title that starts with a dash reaches it.
- **When an edit is allowed.** In `todo`, `blocked`, `rework` or `review`.
  While a builder runs, it's refused: the builder works from the brief it was
  given. A done task can't be edited. `editRefusal` gives each reason in
  words with no command (D-132). A builder or reviewer can't edit, and a
  builder's session denies `acc edit`. The next builder reads the edited brief
  in the packet acc writes at dispatch; a reviewer of a task a person edited
  since its builder started gets its title and brief as they are now, under
  their own heading (`editedSection`).
- **Tracker tasks.** For a Jira, GitHub, Azure DevOps, monday.com or Slack
  task, the ticket owns the title, description, dependencies and labels,
  since intake refreshes all four (`TRACKER_OWNED`); `acc edit` refuses a
  change to them, with why. A value given as it is now is no change, so a
  sheet that sends every field still saves the rest. Its environment and a
  new field, notes for the builder (`notes`), are acc's: intake never changes
  either. The packet (`notesSection` in `renderPacket`) shows the notes under
  "Notes for the builder", and leaves the heading out when there are none.
  The reviewer reads the packet, so its prompt adds the notes only when a
  person changed them after the builder started (`notesEditedSection`), and
  says so when they were cleared. Manual tasks have notes too.
- **The task sheet.** Add task opens a sheet over the page, in the page's
  modal, as Dispatch's does (D-168): "New task in" the project, with a title,
  a description of several lines (Markdown, as briefs are), dependencies and
  labels as lists with commas, and the environment from the project's
  unprotected ones, the default chosen. Edit opens it filled in, with notes
  for the builder too. A tracker's task shows what its ticket owns as text,
  under a line that says why, with Open in Jira (or its tracker). Add task
  or Save, the primary, is off without a title, with why; Enter in a one-line
  box saves, Enter in a description is a new line, and Cmd+Enter or
  Ctrl+Enter saves from anywhere; Escape cancels. The page sends what was
  written (`task-sheet-go`); the extension reads the task again and
  `taskSheetArgs` (`model/task-sheet.ts`) turns it into `acc add`, or `acc
  edit` with only the fields that changed and none its ticket owns, each as
  `--flag=value` so a value that starts with a dash stays a value. A Save that
  changes nothing runs nothing and says so.
- **Edit on a task.** `cardActions` lists Edit (`acc.task.edit`) on every
  task, so the task page, its modal and a card's ⋯ menu have it, off with
  `editRefusal`'s reason while its builder runs or once it's done. From a
  task's own tab or the modal, the sheet opens over that page, as Dispatch's
  does; from anywhere else, over the Command Center. The palette lists Edit
  for each task that can be edited now. A task's page shows its notes under
  its description.
- **Checked.** `packages/core/test/edit.test.ts` has 12 tests: each field, the
  record and an edit that changes nothing, each state allowed or refused,
  `acc add`'s checks, a builder or reviewer refused, a tracker's read-only
  fields, intake keeping the notes and environment, the packet's notes and
  their heading left out, the reviewer's, notes set before dispatch shown
  once, notes cleared since, and an edit's fields in words.
  `packages/core/test/dispatch.test.ts`'s builder settings test checks the
  session denies `acc edit`. `extension/test/edit-history.test.ts` has 3:
  History's entry for an edit and its Overview row, none without edits, and
  a task page's edits. The screenshot run's History has an edit of ACME-19,
  and ACME-12's page an edit in its activity. `packages/cli/test/tasks.test.ts`
  has 3 more: `acc edit` with `--json`, its refusals, and a tracker task.
  `extension/test/task-sheet.test.ts` has 9: the sheet for a new, a manual
  and a tracker task, Edit off with its reason, `acc add`'s and `acc edit`'s
  arguments, a tracker's, the page's message, and opening it.
  `task-sheet-open.test.ts` has 3, against the built extension: Add task's
  sheet reaches `acc add`, Edit's sheet over a task's tab reaches `acc edit`,
  and a running task's Edit is off and says why. The screenshot run adds three
  pages: the sheet for a new task and for a manual task over the Tasks board,
  and for ACME-19, a Jira task in rework, over its tab. Three behaviour cases
  drive the sheet's keys and clicks in a browser, and four new mutants (Escape
  saves, Enter in the description saves, Save drops the notes typed, Save with
  no title) each fail one. Two more Command Center pages raise the geometry
  run's floor for the selected tab from 474 to 486 drawings.
- Not chosen: writing changes back to a tracker, which stays the place to
  change its own text; editing while a builder runs; a separate field for
  acceptance criteria, which a brief holds.

## D-176 Each Tasks board filters by person: everyone, mine, unassigned, or one person (2026-10-20)

T-79. The Tasks board showed every ticket in the place, whoever had it, with no
way to narrow it. A person who reviews other people's work, or wants only their
own, had to scan the whole board.

- **One filter on each board.** A button in the board's header says the choice
  and a count, "Mine · 7 of 42" (Everyone says the total, "Everyone · 42"). It
  opens a menu of Everyone, Mine, Unassigned and each person with a card on the
  board, by name, each with an icon (`organization`, `account`,
  `circle-large-outline`, `person`), its label and how many cards it shows. The
  logic is `webview/person-filter.ts` (pure, tested in `person-filter.test.ts`);
  `webview/person-menu.ts` draws it. Colour carries nothing here: the icon and
  the words do.
- **The page draws only the cards that show.** The filter leaves the other
  cards out of the page, not hidden, so the board's keys (D-159), which go
  between the cards on the page, skip them with no change to `board-keys.ts` or
  `board-nav.ts`. A column's count and its label count the cards that show.
  A choice that shows no card leaves the board empty, with a line, "No card
  here is yours.", and Show everyone to get back.
- **Who Mine is.** On a tracker's board it is `me()` on that tracker, read after
  the board loads (`s.me` in `trackers.ts`) and matched to a card's assignees by
  the tracker's id, else by name (`whoKey`). A tracker that can't say leaves Mine
  off, with its reason on the menu item (`NO_ME`), and a board kept on Mine then
  shows everyone (`effective`), so the filter never hides every card for a reason
  the person can't act on.
- **Each board keeps its choice** in the window's state, in `filters`, by the
  board's key (`tracker:<project>#<index>`, `agents:<project>`). It survives a
  redraw, and a tab rebuilt as the window was. A person chosen who has no card
  after a refresh stays in the menu with none, so the choice can be changed.
- **The agent board filters by who dispatched each task.** A task row carries
  `dispatchedBy`: the `by` of its latest move from `todo` to `running`, as the
  ledger wrote it (`human:<account>`, or autopilot's `orchestrator:autopilot`,
  shown as Autopilot). A task nobody has dispatched is Unassigned. Mine is
  `human:` and this account's name (`dispatcherKey`, from `hub.user`, else the
  environment's USER), which is what `acc` writes for a person's moves
  (`actorFrom`). A rework's restart is not a dispatch.
- **Checks.** Extension tests for each choice, the count, a board where no card
  matches, Mine with nobody to mean, a chosen person who left, the sample
  boards' people and `deriveRows`' `dispatchedBy`; three behaviour cases in a
  browser (the menu with its icons and counts, the choice surviving a redraw,
  Down and Right skipping the cards it hides, and a board with no match), each
  named by a mutant; and four screenshot pages: the menu open, the Jira board
  filtered to one person, the agent board on Mine, and a board where the
  choice shows no card. The geometry run's floors rise with the pages: the
  selected tab from 486 to 510 drawings, and the controls examined for overlap
  from 17900 to 18000 (the run measured 21990), which a full run needs at 30 a
  drawing.
- Not chosen: filters by label, status or type, which the task leaves out; a
  filter shared between windows or kept on disk; hiding cards with CSS, which
  would leave the keys to step onto cards that can't be seen.

## D-177 A person's own edit writes to the ticket where the tracker allows edits (2026-10-20)

T-80. The task sheet showed a tracker task's title and description, but a
person couldn't change them (D-175). A person who adds detail to tickets, such
as a TA, had to leave acc to do it. This changes D-066 and D-175: where the
tracker says `"edits": true`, a person's own edit writes to the ticket. Text
that acc drafts is still a draft a person posts (D-066).

- **The tracker writes the ticket's text.** `setText(key, { title?, markdown? })`
  on every tracker writes only what it's given. Jira puts the summary and the
  description, as ADF, as a comment goes; GitHub runs `gh issue edit` with the
  title as one argument and the body on stdin. An empty title is refused.
  Azure DevOps, monday.com and Slack refuse with `textRefusal`'s reason and
  send nothing (`TEXT_TRACKERS` names the two that write).
- **The sheet, where edits are on.** Edit on a tracker task reads its ticket
  first (`TicketEdits.sheetTicket`), so the sheet opens with the ticket's own
  title and description, not as intake last brought them in, as boxes. Its
  status, assignee and labels show under the environment, each with a Change
  that opens the ticket page's own quick pick (`pickField`, which the page
  now uses too) under the same rule (`ticketActionRefusal`), then shows the
  ticket as it is now. Its dependencies stay read-only: they come from the
  ticket. Where the tracker can't take text, the title and description stay
  text with its reason; where the ticket couldn't be read, they stay text and
  say why.
- **Where edits are off,** the fields stay read-only, as D-175 drew them, and
  the sheet says the project's settings can turn on edits (`EDITS_OFF`).
- **Safe writes.** Save sends the text the sheet opened with. The extension
  checks the project still allows edits, then `saveTicketText` reads the
  ticket again: someone changed it since, so Save writes nothing and sends the
  ticket's text back. The sheet shows both versions; Use theirs puts the
  ticket's text in the boxes, and Keep mine saves the person's over it,
  checked against the ticket's text as just read. A ticket that already says
  what the person wrote needs no write. A failed read or write says why and
  writes nothing more. In each case the sheet stays open with the person's
  text, and Save waits for the answer before it closes. Once written, the task
  is read again from the ticket through `acc import`, as Track does, keeping
  its dependencies, and acc edit then saves the environment and notes. When
  the ticket was written but acc edit then failed, Save again writes nothing
  more to the ticket, since it already says what the person wrote.
- **A Jira description that Markdown can't hold isn't written.** The sheet
  edits Markdown, and Jira keeps ADF, so writing a description back drops
  what Markdown can't hold: mentions, attachments, panels, status lozenges,
  merged or coloured table cells, coloured or underlined text and the like.
  `adfUnkept` names each kind it finds in the ticket's description. Where
  there's any, the sheet warns before Save, naming them, and shows the
  description read-only, so Save writes only the title; its status, assignee
  and labels still change. Jira's `setText` reads the description again
  first and refuses with `unkeptRefusal`'s reason, writing nothing, whatever
  it was sent. Chosen over keeping those nodes through the round trip:
  splicing ADF back into edited Markdown can't tell which node a person meant
  to keep or delete, and a refusal can't harm a client's ticket.
- **The ticket page's description** has Edit (`editText`), which opens the
  sheet over the page, only where the tracker says `"edits": true` and acc
  keeps a task for the ticket, and off with `editRefusal`'s reason while its
  builder runs or once it's done.
- **Checked.** `packages/core/test/set-text.test.ts` has 8 tests: Jira's and
  GitHub's recorded requests and their edge cases, a Jira description with a
  mention and an attachment refused while a plain one saves, what
  `adfUnkept` names, and the other trackers' refusal.
  `extension/test/ticket-text.test.ts` has 6: what Save writes, the stop
  when the ticket changed meanwhile with the person's text kept, its
  failures, and the rows. `extension/test/task-sheet-edits.test.ts` has 8:
  the fields editable only where edits are on, read-only with `EDITS_OFF`
  where they're off, the warning on a description that can't be written
  back, the trackers that can't take text, opening once the ticket is read,
  the messages, and the description's Edit.
  `extension/test/task-sheet-ticket.test.ts` has 6, against the built
  extension and a stand-in gh: Save reaches `gh issue edit` and refreshes the
  task, Save stops on an issue changed meanwhile, Change on the status closes
  the issue, Save and Change refuse for a task no tracker holds and once the
  settings turn edits off, with nothing written, and a second Save after acc
  edit failed writes the issue no more. That is 28 tests. The tests floor
  went from 1796 to 1834: the base already held 1806 tests, 10 above its
  floor, so these 28 make 1834. One behaviour case drives the sheet in a
  browser (a Change, a failed write, both versions, Keep mine), and three new
  mutants each fail it. The screenshot run adds three pages over ACME-19's
  tab with edits on: the sheet with its ticket's text to write, the choice
  when the ticket changed after it opened, and the warning on a description
  that holds a mention and an attachment.
- Not chosen: writing a ticket's text from acc for Azure DevOps, monday.com
  or Slack; a merge of the two versions; and text acc drafts, which is the next
  task, and always a draft a person posts.

## D-178 A Jira tracker follows the active sprint or one named sprint, and the Overview says when the sprint changes (2026-10-20)

T-78. Builds on D-072 and D-164. A Jira tracker read its board's whole
contents, so on a scrum board the Tasks tab showed the backlog and every
sprint together. A person who works a sprint wants that sprint's tickets.

- **The place takes `sprint`.** A Jira tracker's `sprint` is `"active"`, for
  the board's open sprints whichever they are now, or a sprint's id. It works
  alone or with `epic`, and unset it's the whole board. The config check
  refuses a `sprint` on a tracker that isn't Jira, unlike the other place keys
  (which warn and are ignored), and a value that is neither (`sprintProblem`).
  Azure DevOps iterations aren't these.
- **Every read stays inside it.** `JiraClient.placeJql` adds `sprint =
  <id>`, or for the active sprint `sprint in (<the board's open sprint ids>)`
  once the board has said which (`openSprints()` before then), so another
  board's active sprint never counts. An epic's sub-task query carries it too.
  A ticket in the project and epic but not the sprint is outside the place:
  its page says "it isn't in the active sprint", and it can't be tracked.
  With `project` only (posting a draft), the sprint doesn't count, as the epic
  doesn't.
- **The board says which sprint.** The place line names it and its dates:
  "Jira · ACME · active sprint ACME Sprint 13 (20 Oct to 2 Nov)", or "sprint
  …" for a named one (`sprintPlace`, `sprintDates`). Following the active sprint with none open, the board asks
  Jira for no issues, shows no cards, and its notice says there is no active
  sprint (`NO_ACTIVE_SPRINT`). A named sprint Jira doesn't have says so.
- **Connect picks it.** After the board, a Sprint list: The whole board, The
  active sprint (with the one open now, or "none open now"), then the board's
  open and future sprints with their dates (`jiraSprints`,
  `jiraSprintOptions`). A kanban board, which Jira refuses sprints for, offers
  only the whole board. Picking another board reloads the list, and Save
  waits for it. An existing tracker opens at its sprint; the whole board takes
  `sprint` out.
- **When the sprint changes.** After a Jira board in a sprint loads, the
  Command Center compares it with the last sprint acc kept for that tracker
  (`sprints.json` beside the ledger, by site, project and board:
  `sprintTracker`). When the sprint or its open tickets changed, it hands the
  new one to `acc intake jira --file` in `sprint`, which acc keeps
  (`rememberSprint`, written whole). When the sprint itself changed, it asks
  Jira which of the old sprint's open tickets the board no longer shows aren't
  done (`stillOpen`): those went back to the backlog, and the ones still on the
  board were carried. A ticket done in time counts as neither, and one Jira
  couldn't read isn't counted. Tickets that left the sprint are outside the
  place, so they go through D-072's path in the same intake: a task that
  never started leaves the board, and a started one stays.
- **Said once, on the Overview.** Since you last looked (D-164) gets a line,
  "ACME Sprint 13 started after ACME Sprint 12: 4 tickets carried into it, 2
  went back to the backlog. ACME-18 left the sprint after work started, so it
  stays on the agent board." (`sprintNotice`, `sprintLine`). Its kind is
  `sprint`, Sprint changed with a milestone icon in blue, and with no task the
  line opens the Tasks tab. It joins the list whether or not the person is away
  (`Away.note`), and is never a notification. acc keeping the new sprint makes
  it once; a window that loads the board twice at once tells it once too. A
  first look, the same sprint, or a board not in a sprint says nothing. The
  board's warning for started tasks names what they left: "Moved out of the
  active sprint after work started", never the sprint open now; "sprint ACME
  Sprint 12" for a named one; "epic ACME-3 or sprint 42" with both.
- **Checked.** `packages/core/test/trackers.test.ts` adds 5: the JQL for the
  active sprint, a named sprint and a sprint with an epic; a board in the
  active sprint and its place line; a board with no active sprint, which gives
  the notice and no cards; a ticket outside the sprint and `stillOpen`; and
  Connect's list, with a kanban board's none. `config.test.ts` adds 1: each
  wrong value and each tracker that isn't Jira. `packages/core/test/sprints.test.ts`
  has 4: the kept sprint and a broken file, the change's counts and words, the
  change through intake where a started task stays and is named, and the place
  words. `connect.test.ts` adds 1, `packages/cli/test/tasks.test.ts` 1 (acc
  intake keeps the sprint, and refuses one in the wrong shape or for Azure
  DevOps), `extension/test/sprint-change.test.ts` has 2, and `moved-out.test.ts`
  and `away.test.ts` add 1 each. The screenshot run adds two pages:
  `connect-sprint`, Connect's Sprint list with the active sprint picked, and
  `tasks-sprint`, a board in a sprint with a started task that left it. Since
  you last looked's sample has a sprint line. The two pages raise the geometry
  run's floor for the selected tab from 486 to 498 drawings.
- Not chosen: Azure DevOps iterations; moving a ticket between sprints from
  acc; a notification for the change, which Since you last looked holds; and
  several named sprints, which the active sprint covers when a board runs them
  side by side.

## D-179 acc drafts a ticket's acceptance criteria, test steps and edge cases, and a person edits and posts them (2026-10-20)

T-81. Builds on D-032, D-052, D-066 and D-177. A TA adds detail to tickets:
acceptance criteria, test steps and edge cases. They started from nothing.

- **A read-only drafter.** `draftCriteria` (`packages/core/src/criteria.ts`)
  runs one agent as `acc review` runs its reviewer: `claude -p` with the
  reviewer's model and effort (`agentArgs(config.agents.reviewer)`), Read,
  Grep and Glob only, `dontAsk`, and `ACC_ROLE=reviewer`. Its prompt
  (`criteriaPrompt`) holds the ticket's description, each comment with its
  author and date, each related ticket, and the project's rules; it reads the
  repo itself. It answers to `CRITERIA_SCHEMA`: acceptance criteria, test
  steps, edge cases, and open questions for the ticket's author.
  `parseCriteria` refuses an answer with no criteria. acc writes the parts as
  Markdown under sub-headings (`criteriaMarkdown`), and keeps the draft with
  the task in `.git/acc/criteria/<id>.json`, with what it read.
- **It speaks plainly.** The prompt says the draft must pass `acc ste check`,
  with the STE Strict rules (`STE_STRICT`). acc checks the draft's Markdown
  as `acc ste check` does (`criteriaWording`). A draft with hard findings
  goes back once, in the same session (`--resume`), with each finding; acc
  keeps the fix unless it is worse, and keeps any finding that stays with the
  draft, which the page shows in orange.
- **Only a tracker task.** A task with no ticket is refused
  (`criteriaRefusal`): its sheet holds its brief.
- **`acc draft criteria <id> [--ticket <file>]`** drafts and keeps it, with
  `--json`. `--ticket` gives the ticket, its comments and related tickets as
  JSON (`parseCriteriaTicket`); the CLI reads no tracker itself, so without
  it the drafter has the task's description only, and the draft says the
  comments weren't read. `acc draft show <id>` reads it back. `acc draft
  update <id>` makes it an update draft (`criteriaUpdate`, a new `criteria`
  event, which Slack takes too). A builder, reviewer or analyst can't run
  either.
- **The person decides where it goes.** A tracker task's page has an
  Acceptance criteria draft section under its description
  (`ticketCriteria`): Draft acceptance criteria, then the draft, what it was
  drafted from, and two ways out. Add to the description opens the task
  sheet over that page with the draft below the description's text, under its
  own heading (`withCriteria`, `withSheetCriteria`); it is off with why where
  the sheet can't write the description (edits off, a tracker that can't
  take text, a description with content Markdown can't hold, or a task that
  can't be edited now). Open as an update asks acc for an update draft, which
  the page's Activity shows to edit and post. The sheet drafts too, where
  Save writes the description: Draft acceptance criteria puts the draft below
  what is written, and Add the draft adds the stored one. The extension reads
  the ticket through the project's tracker and hands it to acc in a file it
  removes after (`CriteriaDrafts`, `extension/src/logic/criteria.ts`); a read
  that fails leaves acc to draft from the description. Nothing reaches the
  tracker until the person saves the sheet or posts the update.
- Tests: `packages/core/test/criteria.test.ts` has 15: the prompt with the
  ticket, comments and related tickets, the parse and its failures, the
  Markdown, the read-only run with the reviewer's settings and no update
  drafted, the wording fix and what stays, the refusals, and the update draft.
  `packages/cli/test/draft.test.ts` has 4, with a fake claude: `--json` from a
  ticket file, the description alone, `acc draft update`, and the refusals.
  `extension/test/criteria.test.ts` has 16: the page's section, both ways
  out, the sheet's draft, the ticket file acc gets, the refusals, a fake
  tracker that records any write and gets none, and the names the page and
  the extension share. That is 35 tests. Two
  behaviour cases drive the sheet's draft and the page's buttons in a
  browser, and four mutants each fail one. The screenshot run adds two pages
  over ACME-19's tab: the sheet with the draft in its description, and the
  draft as an update. With 107 pages, the run's overlap floor rises from 18900 to
  19260 (30 controls a drawing).
- Not chosen: posting or saving the draft from acc; drafting for a task with
  no tracker; and reading a tracker from the CLI.

## D-180 A rework a person sent back carries the passed review's findings (2026-10-19)

Builds on D-094, the fix for GH-80. On T-74 a review passed and listed
findings, a person sent the task back, and the builder saw only the person's
reason. The findings, with their files and lines, went to it in a separate
message.

- **The packet lists the findings** of the review of the task branch's latest
  commit, under "Why a person sent it back", after the person's reason, when
  that review passed and has findings. Each shows its file and line as the
  review's section does, and a must-fix one starts with "Must fix". `dispatch`
  now reads the branch's latest commit on every rework, and `renderPacket`
  takes it as `head`.
- **Nothing is said** when the review is of an older commit than the branch's
  last, when there is no review, or when the commit isn't known. A review of an
  older commit may name code that has changed.
- **No finding is listed twice.** A review that asked for changes shows its
  must-fix findings in "What the review asked for", and the send-back section
  lists none, whoever sent the task back.
- **"What the review asked for" lists only the must-fix findings,** as before.
  A review that asks for changes has said which findings it needs fixed; the
  others are optional, and listing them there would widen the rework beyond
  what the review asked. A passed review lists all its findings, because a
  person who sends it back chose to act on them, and may mean any of them.
- **Checked** by two tests. One in `packages/core/test/dispatch.test.ts`: a passed
  review's findings with their files and lines and the reason first; none for
  an older commit, no review or an unknown commit; and a review that asked for
  changes listing a finding once. One in `packages/core/test/dispatch-run.test.ts`,
  on a real git repo: the written packet lists the findings while the review is
  of the branch head, and leaves them out after a newer commit. It fails if
  dispatch reads the head only for checks or queue reworks.
- Not chosen: listing the non-must findings in "What the review asked for".

## D-181 A Slack channel's messages marked with a reaction are a board on the Tasks tab (2026-10-21)

T-85 completes D-145, whose second answer left "a board of messages with a chosen reaction" for later. A
team marks a message that needs work with a reaction, and the Tasks tab shows those messages as a board,
as it does for Jira, GitHub and monday.com.

- **The reaction is a setting.** A Slack tracker takes `reaction`, a reaction's name without colons such as
  `ticket`, and an optional `doneReaction`, such as `white_check_mark`. The config refuses a name with
  colons or capitals (`SLACK_REACTION`), and a done reaction the same as the reaction. A `doneReaction`
  without a `reaction` is warned about and ignored. Either key on another kind of tracker is warned about
  and ignored. DESIGN §4 describes both.
- **No reaction, no board.** `SlackClient.board()` then refuses with `NO_REACTION`, which says the board is
  off and to choose a reaction with Change. It asks Slack nothing. The Tasks tab shows that line above the
  box for a thread's link (D-148), never as an error.
- **The board.** `board()` reads `conversations.history` through `slackCall`: the last 30 days, 200 at a
  time, and at most 1,000 messages. When it stops at 1,000 with more to read, its notice says so. It keeps
  top-level messages with the reaction; a reaction with a skin tone (`ticket::skin-tone-2`) counts. A reply
  sent to the channel too, and a deleted message, are left out. A marked message that also has the done
  reaction is in Done; the rest are in Open. Without a done reaction, the board has Open only. A card's
  key is `slackKey`, its title the first line cut at 120 characters (`SLACK_CARD_MAX`), with the full line
  in `fullTitle` for its hover title. Its person is the writer, read with `users.info` once a board load,
  so a renamed person shows the new name on the next load. Its link is `chat.getPermalink`. The board's
  source is `slack`. An empty board's notice says how a message gets on it.
- **On the Tasks tab.** The extension no longer skips a Slack tracker's board. Its switch says "Slack
  board". The box for a thread's link stays above the board. A card doesn't move: its columns are
  reactions, which acc doesn't change, so `moves` is false and a drag or the board's keys offer no column.
  Track on an open card is D-074's Track, which reads the thread with `SlackClient.ticket`; a card in Done
  has none, and a tracked message shows its task. The person filter (D-176) goes by writer. Mine is off,
  as the board reads as the Slack app, not a person.
- **A missing scope is named.** `slackCall`'s `missing_scope` error now names the scope Slack's `needed`
  gives and where to add it: the app's OAuth & Permissions page at api.slack.com/apps. The Connect page
  asks for the reaction and the done reaction under the channel, from a fixed list (`SLACK_REACTIONS`),
  each with None first. A new `beforeSave` on a description runs before Save writes: Slack's reads one
  message of the channel's history (`slackCanRead`) when a reaction is chosen, so a missing
  `channels:history` or `groups:history` shows beside Save, and nothing is written.
- Evidence: `packages/core/test/slack-board.test.ts` adds 15 tests against a stand-in Slack that records
  each method: 9 of the board, 3 of the settings and 3 of the Connect page's description.
  `extension/test/slack-board.test.ts` adds 6 of the board's model, Track and the person filter, and
  `extension/test/connect.test.ts` 1 of the Connect page's fields and its scope check. The activation test
  drives the built extension: the board off, then the board with a reaction, Track from a card, and no
  write call to Slack. The screenshot run adds `tasks-slack-board`, `tasks-slack-empty` and
  `tasks-slack-scope`; `tasks-slack` now shows the board off, and `connect-slack-channel` its reactions.
  With 110 pages the geometry floors rise: overlap from 19260 to 19800 and the selected tab from 522 to 540.
- Not chosen: adding or removing reactions from acc; several channels on one board; a team's own emoji in
  the Connect page's list (the settings take any name); the Claude Code Slack connector and a message
  shortcut (D-145).

## D-182 acc verifies a developer's pull request for a tracked ticket, and drafts a QA comment a person posts (2026-10-21)

T-84. Builds on D-032, D-066, D-171 and D-179. A TA checks tickets that other
developers built. `acc review` judged only acc's own builders' branches: it
needs a task in review with acc's worktree.

- **It finds the pull request.** `verify` (`packages/core/src/verify.ts`)
  signs in to GitHub as the project's account, as `acc land` does, and lists
  the open pull requests on the project's repo whose title names the ticket's
  key (`gh pr list --search "<key> in:title"`) or whose branch does (`gh pr
  list` filtered by `headRefName`). A key counts only as a whole word
  (`namesKey`): ACME-1 is not ACME-12. One found is used. None, or several,
  is refused, and acc keeps what it found in
  `.git/acc/verifications/<task>.found.json` for the person to choose from.
  `--pr <number|url>` names one; a link to another repo is refused, with why
  (`namedPr`).
- **It checks out the head with no branch.** `checkoutHead` fetches
  `refs/pull/<n>/head` and the base branch from origin, and adds a detached
  worktree at the head's commit under the worktree root, as `verify-<task>`.
  A detached worktree there at the same commit is used again; at another
  commit it is replaced; one on a branch is refused. It runs the project's
  worktree setup (`setupWorktree`, now exported from `dispatch.ts`). acc never
  commits or pushes from it.
- **It runs the checks there.** `runGates` runs the project's required gates
  in that worktree against the pull request's base, and writes receipts by
  sha as it does for any commit. No floor is raised. A base that is no
  environment's branch is checked with no org (`baseEnvironment`). A gate that
  couldn't run (status error, such as validate with no org) is kept as
  skipped, with "It couldn't run here:" and its reason (`verifyCheck`), never
  as passed.
- **A read-only agent reviews it.** It runs as the reviewer does, with the
  reviewer's model and effort, Read, Grep and Glob only, in the verification's
  worktree. Its prompt (`verifyPrompt`) holds the diff against the base
  (`baseRef`, now exported from `review.ts`), the ticket's description, acc's
  drafted criteria where they exist (`readCriteria`), each check, and the
  project's rules. It says the work is a developer's, and the findings are for
  a QA comment. It answers to `VERDICT_SCHEMA`, read by `parseReview`. The
  verification is kept at `.git/acc/verifications/<task>-<sha>.json`. The
  task's state never moves.
- **It drafts the QA comment.** `qaComment` writes the verdict in one line,
  the pull request's link and commit, each check's result, each criterion met
  or not with its evidence, and the findings. A new `verify` update event
  (Slack takes it too) holds it as a draft (`draftUpdate`). The prompt says
  the comment must pass `acc ste check`; a comment with hard findings goes back
  to the verifier once, in the same session, as drafted criteria do. Nothing
  reaches the tracker or GitHub until a person posts the draft.
- **Commands.** `acc verify <id> [--pr <n|url>]` runs it, `acc verify show
  <id>` reads the latest back, or the pull requests to choose from, and `acc
  verify clear <id>` removes the worktree, the stored results and the choice;
  the QA comment's draft stays. Each takes `--json`. A builder, reviewer or
  analyst can't verify or clear. `acc verify` and `acc sync` clear the
  verification of a task that left the ledger (`pruneVerifications`). An id
  longer than 100 characters isn't a task id (`fileId`, `TASK_ID_MAX`), so
  a junk one is refused before a path is built from it.
- **The task page.** Each task's page has a "Verify the developer's work"
  section (`ticketVerify`, `extension/src/model/verify.ts`): the pull request
  found, or the choice with Verify this one for each, each check with its icon
  and label, each criterion met or not, the findings, and "Open the QA
  comment", which scrolls to the comment's update draft in the Activity and
  puts the cursor in it. It is off, with why, for a task acc's own builder made
  ("acc reviews its own builders' work"), a task with no tracker ticket, and a
  project with no GitHub repo; its buttons are off while a verification runs.
  Verify runs in the output panel, where its steps show (D-171). The process
  words are "Verify the developer's pull request", "See the verification" and
  "Clear the verification".
- Tests: `packages/core/test/verify.test.ts` has 17, with a real origin on
  disk and a runner that records every command: one pull request found, none,
  several, and one in another repo; the detached worktree at the head with no
  branch; a gate that couldn't run kept as skipped; the prompt's diff, ticket
  and drafted criteria; the stored verdict and the unmoved task; no `git
  push`, `git commit` or `gh` write; the wording fix; clearing and pruning.
  `packages/cli/test/verify.test.ts` has 6, with a fake gh and claude.
  `extension/test/verify.test.ts` has 15: the section and its off states, the
  choice, Open the QA comment, the logic's calls to acc, and the messages.
  That is 38 tests. The screenshot run adds three pages over ACME-21's tab: a
  passed verification, one that needs changes, and the pull-request choice.
- **Near tests.** The new `extension/src/verify.ts` left `extension.ts`
  gathering under half of its folder, so near-tests stopped guessing it as the
  folder's index. `gates.nearIndexes` now names `extension/src/extension.ts`
  and `extension/src/areas.ts`, so a change there still runs `activate.test.ts`
  and the area tests.
- Not chosen: Bitbucket and Azure DevOps pull requests; posting the comment
  or moving the ticket's status; and a manual test checklist.

## D-183 A failed verification leaves no worktree, and a dirty one says it wrote no receipt (2026-10-21)

Notes on D-182, which stays as written.

- **A failed verification removes the worktree it added.** When a step after
  the checkout throws (setup, the verifier timing out, Claude Code not
  starting), `verify` removes the `verify-<task>` worktree it added. A worktree
  it found already at that commit is left. `pruneVerifications` also lists the
  `verify-*` folders under the worktree root, so a leftover with no stored
  file goes with a task that left the board.
- **Receipts: D-182 holds for a clean worktree only.** `runGates` writes no
  receipt when the worktree is dirty, and the setup can leave files (an org's
  `.sf` config, a setup command's output). The gates don't ignore them, so
  the verification adds a `receipts` check line, skipped, with that reason
  (`DIRTY_GATE`), and writes no receipt for that commit. A clean worktree
  writes one receipt for each check, by sha.

## D-184 Cloud reviewers: a cloud task's review runs in the cloud too, where the project opts in (2026-10-21)

T-86. A project that runs builders in the cloud (D-140) still reviewed every task on the Mac, so a
cloud builder that finished while the Mac slept waited for it. acc now offers the review as a cloud
session too, where the project opts in, so a cloud task can reach reviewed with no Mac awake. Local
stays the default; analysts stay on the Mac, since a Salesforce analysis needs the person's org login.

- **A setting.** `agents.cloud.review` in `.acc/config.json`, `local` (the default) or `cloud`, read
  only where `agents.cloud` is set (it lives inside that section) and the cloud is ready: a plain
  `acc review <id>` under `cloud` with a need unmet (`cloudNeeds`: the routine, its token, the sign-in)
  runs on this Mac and says why, and an explicit `--cloud` is refused naming each need, as a cloud
  dispatch is. `acc cloud enable --review local|cloud` writes it; `acc cloud` says it; Settings' Cloud
  builders row shows it beside where a plain dispatch goes, with **Reviews…** to change it, disabled with
  the reason until the project opts in to cloud builders. `acc review <id> --local` keeps a review here
  whatever the setting says. Autopilot follows the setting when it starts a review, and then waits on the
  task as it waits on a review here: a cloud review counts as a review under way (`facts.reviewing`).
- **The fire.** `reviewInCloud` (`packages/core/src/cloud-review.ts`) runs the review's own checks
  (`prepareReview`, shared with the local review: the task in review, its checks settled), every cloud
  need, the cloud cap, and the guard committed where the cloud loads it (`cloudGuard`, shared with the
  dispatch), pushes the task branch to origin only if its head isn't there (a local builder's), and fires
  the same routine with `cloudReviewText`: three records first (`Acc-Branch: <task branch>`, `Acc-Role:
  reviewer`, `Acc-Verdict: acc/review/<task>-<sha>`), what a cloud session needs instead of acc, then the
  reviewer's standing instructions and prompt as `review()` builds them, with the base and head shas and
  the `git diff` commands in place of the diff, since the reviewer has the branch in its clone, and the
  verdict's JSON schema, which Claude Code would otherwise check for it. The task stays in review with a
  `cloudReview` record on it: the session, when it was fired, the commit, the verdict branch. The
  builder's fire text now says `Acc-Role: builder` too.
- **The verdict comes back by a push to its own branch.** The reviewer commits one file, `review.json`,
  on top of the task branch in its clone, and pushes `HEAD:acc/review/<task>-<sha>`, never the task
  branch. `acc sync` lists origin's `acc/review/*` heads in one `git ls-remote`, fetches a verdict branch,
  reads `review.json` from its head, checks it against the reviewer's schema (`checkVerdict`, which the
  local review's result goes through too), and keeps it as a local verdict is kept, under the same name
  (D-087). For the task's head now, it moves the task as a local review does (`recordVerdict`, shared):
  changes to rework with the findings, a pass stays in review, ready to land. For a commit that is no
  longer the head, the verdict is kept for its commit and nothing moves, as a stale local review is
  treated. One already kept here for the commit stands, since a person reviewed it on this Mac meanwhile.
  One acc can't read (no `review.json`, not JSON, off the schema) fails the review, written on the task
  with why, and the task needs a person. The branch is deleted on origin after it is read, whatever it
  held. A branch not there yet leaves the review under way; origin not answering leaves everything as it
  was. The file is anyone's, so its parts are capped (`VERDICT_LIMITS`, `review.ts`: 2,000 characters of
  summary, client words and a finding's message, 1,000 of a criterion and its evidence, 400 of a file,
  200 of a rule, 80 of a kind, 50 criteria, 100 findings; longer text ends in an ellipsis), since the
  summary goes whole into the rework's reason, and a `review.json` over 4 MB (`VERDICT_MAX_BYTES`) isn't
  read at all: the review fails saying it was too large, not that the file was missing. A cloud review
  ends when a verdict is kept for the task's head, whichever commit it was fired on (`recordVerdict`),
  and when the task leaves review (`applyMove`): a person's move to rework, done, or by hand. Left, the
  record would refuse the next cloud review and, once quiet, keep the task at Needs you with no way out.
  A verdict branch for a cloud review ended that way stays on origin until the task is next followed,
  and is a follow-up.
- **The guard allows that one push and nothing else.** Both lines of D-140's guard read the role. The
  record is now the three lines, and fails closed: no `Acc-Role`, a role that is neither builder nor
  reviewer, or a reviewer without a verdict branch allows no push and no checkout, as no record did. For
  a reviewer, the PreToolUse guard allows Bash for plain `git` alone, from a short list: the reads, `git
  fetch`, checkout of the recorded task branch, `git add review.json` (that file alone), `git commit -m`
  (nothing that widens the index: no `-a`, `--include`, a pathspec), and `git push origin
  HEAD:<verdict>`; every other program, wrapper, path to git, and git command is refused, naming what a
  reviewer runs. A reviewer's `git fetch` and `git grep` take only the options on an allow-list (quiet,
  a depth, no tags; what narrows a search), from origin alone and with no refspec, since `--upload-pack`
  and `-O` take a program, and a push from inside one with `--no-verify` would have skipped both lines;
  an option before git's command (`-c`, `-C`, `--exec-path`), `--output`, `--ext-diff`, a redirect, and
  a checkout that restores a path (`git checkout <ref> -- <path>`, `git checkout -- <path>`) are refused
  too. For every role, `gitProblem` now refuses the git options and commands whose value is a program:
  `--upload-pack`, `--receive-pack`, `--exec`, `--extcmd`, `--tool`, `--open-files-in-pager`,
  `--ext-diff`, grep's `-O`, rebase's `-x`, difftool's and mergetool's `-x` and `-t`, `git bisect run`
  and `git submodule foreach`; `--no-verify` inside an option's value is refused as the word is; and a
  program in another program's `--option=value` (`flock --command='sh -c …'`) is read as the command it
  is. Edit, Write and MultiEdit may touch `review.json` at the root of the clone alone;
  NotebookEdit never; the guard's own files as before. The pre-push hook's record is the verdict branch,
  and it refuses any other ref, the task branch and main among them, whatever ran git. The guard script
  changed, so a project that committed it runs `acc cloud enable` again and commits; this repo has.
  Tools the guard's matcher doesn't name (WebFetch, TodoWrite) can change neither the repo nor GitHub;
  the fire's text tells the reviewer which tools to use.
- **A quiet review needs a person.** No verdict after `agents.cloud.quietMinutes` shows the task as Needs
  you, "no verdict from its cloud reviewer for N minutes: review it on this Mac", with **Review on this
  Mac** as the way on; so does a verdict acc couldn't read, with its reason. A cloud review counts
  against `agents.cloud.max` as a builder does, and the cap's words name the reviews.
- **The Command Center** shows "Reviewing in the cloud" with the cloud icon on the task's card, in the
  Tasks line's words ("its reviewer is reading it in the cloud") and on In progress, where Watch opens the
  session on claude.ai; `extension/test/looks.test.ts` walks the look. The sample data has ACME-47 under
  review in the cloud, on the Tasks board and In progress.
- **Tests.** `packages/core/test/cloud-review.test.ts`, on the bare-origin fake GitHub cloud.test.ts uses
  (its fixtures moved to `cloud-support.ts`, shared): the setting, the fire's text, a fire for a
  cloud-built task and a local one, a verdict taken (pass, then changes to rework), stale, bad in four
  forms, a branch without the file, one already kept here, the branch deleted each time, the quiet rule,
  the cap, the verdict's caps with a 1 MB summary and a file over the size, and the cloud review cleared
  by a move and by a verdict here for the head. `cloud-guard.test.ts`: the reviewer's allowed and refused
  commands, files and pushes, in the guard and through the pre-push hook on a real origin, the two
  exploits above and each new refusal in the refused tables (a builder's and a reviewer's), the record's
  four ways of failing closed, and the role record's variants (another case, a space before the colon, a
  later message, a tool result). `autopilot-cloud.test.ts`: autopilot's review step firing in the cloud,
  staying here where a need is unmet or the setting is local, and its rules waiting on a cloud review
  under way and on a failed one. CLI tests cover `acc review --cloud`, with `--json`, its refusal where
  the project hasn't opted in, and `acc cloud enable --review`. Extension tests cover the setting, the
  card, the row and the In progress job.
- **Not built, and next:** cloud analysts. An analysis reads the orgs through the person's own Salesforce
  login (D-052), which never goes to a cloud session (D-140), so an analyst there could read only the
  repo. Worth doing for a generic project, where there is no org, and not before.
- Not chosen: a verdict posted back through the session's own message channel, which nothing reads; a
  verdict committed on the task branch, which the guard must keep a reviewer from touching; a wider hook
  matcher for the reviewer, which would run the guard on every Read of every cloud builder for no safety.
- **Note (T-88, 2026-10-21): abbreviated options.** git takes any unique prefix of a long option, so
  `git fetch --upl=sh` was `--upload-pack=sh` to git and the guard, matching full names alone, let a
  builder's fetch, archive, ls-remote and grep run a program. `programOption` in the guard now reads
  every prefix of a program option (`--upload-pack`, `--receive-pack`, `--exec`, `--extcmd`, `--tool`,
  `--open-files-in-pager`, `--ext-diff`) as the option it shortens, for every role, and says so ("--upl
  (short for --upload-pack) runs a program of its own"). The reviewer's fetch and grep allow-lists refused
  the prefixes already; the builder's tables have the rows.
- **Note (T-88, 2026-10-21): `<transport>::` remotes.** `git fetch "ext::sh -c …"` runs sh through
  git-remote-ext, and `fd::` reads a descriptor; neither names `--no-verify` as a word, so the backstop
  didn't see a push inside one. `transportProblem` refuses, for every role, any `<transport>::` remote or
  URL (as a word or an option's value, `--remote=ext::…`, trimmed first, so `" ext::…"` counts) on fetch, pull, push, ls-remote, archive, clone,
  remote and submodule. git's own `protocol.allow` refuses ext by default, but a `-c` or `GIT_ALLOW_PROTOCOL`
  could lift it, so the guard doesn't lean on it.
- **Note (T-88, 2026-10-21): `$'…'` quoting.** The splitters read bash's ANSI-C quoting as bash does, with
  its escapes decoded (`\nnn`, `\xHH`, `\uHHHH`, `\UHHHHHHHH`, `\cX` and the named ones), so
  `$'\x2d-upload-pack=sh'` is `--upload-pack=sh` and `$'git' push` is `git push`; `$"…"` reads as `"…"`.
  Both `rawCommandsOf` and `hooks.ts` `commandsOf` have the same `ansiC`, and the parity test pins seven
  more lines. Chosen over refusing any word that holds `$'`, which would have refused a plain
  `echo $'a\tb'` and still left `$"…"` unread. The guard script changed, so this repo's committed guard is
  written again.
- **Note (T-88, 2026-10-21): autopilot with the cloud full.** `realSteps.review` went to the cloud
  whenever the setting said so and the needs were met, and `reviewInCloud`'s `cloud-cap` then failed the
  step, which was written on the task. `temporary` now reads `cloud-cap` as a wait, with the cap's words
  ("1 cloud session is running for this project, and its cap is 1 (agents.cloud.max)") and "Autopilot
  looks again next pass", as it waits on the project's and the machine's caps. `autopilot-cloud.test.ts`
  drives a pass with the cloud full, then frees it with a person's move of the builder and sees the next
  pass fire; its cleared case now goes through `recordVerdict`, not a hand-made ledger change.
- **Note (T-88, 2026-10-21): a verdict ends only its own cloud review.** `recordVerdict` cleared
  `cloudReview` for any verdict it kept, so a verdict for an older commit ended a cloud review of the
  head. It clears it only when the verdict's commit is the cloud review's, or the task's head as the
  caller read it (`who.head`: `review()` reads the branch's head again once its reviewer is done, since
  the branch can move while it runs, and the cloud follow passes the branch's head). A verdict for an
  older commit is kept and ends nothing; tested in `cloud-review.test.ts`, and through `review()` with
  the branch moved mid-review in `review.test.ts`.
- **Note (T-88, 2026-10-21): no verdict branch left behind.** A cloud review ended by a move or by a
  local verdict left `acc/review/<task>-<sha>` on origin (the follow-up above). `acc sync` now lists
  origin's `acc/review/*` once (`verdictHeads` in `followGithub`, handed to `followCloudReviews`), and
  `pruneVerdictBranches` deletes each head that no cloud review under way waits on and the follow didn't
  handle, reporting each as a `pruned` review follow ("deleted acc/review/T-1-… on origin: no cloud review
  waits on it"), which `acc sync` prints with the others. A cloud project's sync lists once a run where
  it listed only with a review under way; origin not answering deletes nothing. Tested on the bare-origin
  fake GitHub: a late push after a move, a branch for a task not in the ledger, a review under way keeping
  its own, and origin offline.

## D-??? A builder that never started needs you, and "can't tell" is a state, not "fine" (2026-10-21)

On 2026-10-21 a dispatched builder (T-90) never started: Claude Code's background service was down after
it updated itself, `claude agents` failed on a missing control socket, and no conversation was ever
written. acc showed the task as Running for 18 minutes, because `builderStopped` reads no answer as "not
stopped", and the dispatch recorded the session's id anyway.

- **A dispatch proves its builder started** (`awaitStart` in `started.ts`). After `findSession`, it waits
  up to `START_WAIT_MS` (60 s; `startWaitMs` for tests) for the session to be listed with a process, or
  for its conversation to be written under Claude Code's projects folder for the worktree
  (`transcriptWrittenAt`). Without either, the task isn't moved: it stays where it was with
  `notStarted` (reason, place, and a model and effort where they were picked), which `displayState` shows
  as Needs you in To do and Rework; the half-started background session is stopped; the dispatch's
  `start` step fails with the reason, and `acc dispatch` prints Needs you and exits 1. Any move ends
  `notStarted`. Autopilot leaves such a task for a person, and a held start counts it as failed.
- **Dispatch again** (`dispatchAgain` in `again.ts`, `acc dispatch <id> --again`, the Command Center's
  `acc.task.dispatchAgain`) is a person's. A task whose builder didn't start is dispatched with what
  `notStarted` kept. A running local task is set back to To do, its listed session stopped and any resume
  ended, then dispatched on this Mac; its run keeps a picked model and effort. Both moves carry
  "Dispatched again: <why>" in its History.
- **"Can't tell" is a state** (`builderUnseen`). When `claude agents` hasn't answered (exit, unreadable
  output, or `SERVICE_DOWN` in its error) for longer than `STOPPED_GRACE_MS`, a running local task whose
  run is older than the grace needs you: "unanswered", which names what to try in process words (D-132),
  or "quiet" when its conversation, or its start where none was written, is older than the quiet limit.
  There is no local quiet setting, so `quietMs` reuses `agents.cloud.quietMinutes` (default 120). The
  Command Center keeps since when in the hub (`agentsSilentSince`); `acc show` keeps it in the repo's
  state (`noteAnswer`, `agents-silent.json`), so its first look without an answer only starts the clock.
  Dispatch again leads for "quiet" and is behind ⋯ for "unanswered", where the builder may still be at
  work. `builderStopped` is unchanged: no answer still never reads as stopped.
- **Stale sessions don't count.** `sessionsOf` finds a builder by name only among sessions started no
  earlier than `RUN_SLACK_MS` (2 min) before its run was recorded, so an old `blocked` session of the same
  name is never taken for it; ids recorded on the run are matched as before.
- Out of scope: restarting Claude Code's service from acc, and cloud builders, whose branch says whether
  they're quiet (D-140).
