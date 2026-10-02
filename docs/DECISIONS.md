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
