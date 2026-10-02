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
- **An append stays one write and one `stat`.** The file is read, to be trimmed,
  only each time it grows past another 64 KB. So between trims it holds up to
  64 KB more than 1,000 records, which is a hundred or two at a few hundred
  bytes each. The page shows the newest 500, so nobody sees the difference. Trimming on every append past 1,000 would
  read and rewrite the whole file every time.
- **The trim is a rewrite,** to a temp file in the same folder and then a
  rename, so a reader never sees half a file. Lines that don't read, from a
  crash or a half-written append, are dropped and don't count. The readers
  skip them, as before.
