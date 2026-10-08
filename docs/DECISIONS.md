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

## D-??? Settings raises or lowers how many builders run at once, with what it means; this machine can cap every repo's together (2026-10-07)

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
  whose ledger has gone is dropped. With no total, nothing else is read.
  Where acc's environment has no home (a test's made-up one), nothing
  machine-wide is read or written.
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
  with why they can't change here. No required checks shows in orange.
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
  colours on both Settings pages (686 elements).
- Not chosen: holding a person's dispatch for a cap (D-093's call stands); a
  per-clone cap, since a cap is shared, and the machine's total is the
  person's own; counting Claude Code's sessions for the total, which counts
  finished sessions and not a stopped builder, unlike the project's cap; a lock
  across repos, so two repos dispatching in the same instant can both pass a
  total by one.
