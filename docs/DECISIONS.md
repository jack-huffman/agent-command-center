# Decisions

Newest last. Each entry records what was decided and why, so later changes can
see what they are overturning.

## D-001 Build a thin layer over Claude Code, don't adopt an orchestrator (2026-10-01)

Claude Code already runs agents in isolated worktrees, keeps a registry of live
sessions, and exposes hooks. What is missing is one view in VSCode and intake
from issue trackers. Standalone tools either live outside VSCode, don't write
back to trackers, or bring a heavy stack. See
[research/2026-10-01-landscape.md](research/2026-10-01-landscape.md).

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
  A retry leaves an issue a person reopened in between. One a timed-out close
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
  second run does nothing. `--plan` only looks: it lists what it would close or
  leave, without syncing, closing or writing. A done task with no pull request,
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
