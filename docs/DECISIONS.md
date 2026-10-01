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
