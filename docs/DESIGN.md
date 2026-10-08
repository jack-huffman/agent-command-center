# Design

**Status:** agreed with the user on 2026-10-01. Later changes are recorded in [DECISIONS.md](DECISIONS.md). It introduces decisions D-008 to D-018
(see [DECISIONS.md](DECISIONS.md)). Behaviour that comes from Claude Code itself
was checked against version 2.1.287 and its docs on that date.

## 1. What it does

Agent Command Center turns tickets into reviewed pull requests, with a human
deciding what merges, or autopilot where a repo turns auto-merge on (§12). Tickets come in from GitHub Issues or Jira and become
tasks. Each ready task gets its own git worktree and a background Claude Code
session. The agent builds the change and runs the project's checks. A second,
fresh agent reviews the diff, a pull request opens, and acc drafts an update
for the ticket, which a person reads, edits and posts. A VSCode panel shows all
of it and holds the buttons.

```mermaid
flowchart LR
    T[("Trackers<br/>GitHub · Jira")] -->|intake| L["Ledger<br/>(tasks)"]
    L -->|ready task| D["Dispatch"]
    D -->|worktree +<br/>background session| B["Builder agent"]
    B -->|checks pass| R["Reviewer agent"]
    R -->|changes needed| B
    R -->|pass| P["Pull request"]
    P -->|a human merges| X["Done"]
    P -. "draft update,<br/>a person posts it" .-> T
```

## 2. The pieces

| Piece | What it is | Uses |
|---|---|---|
| `core` | TypeScript library: ledger, config, state rules, paths, receipts | filesystem only |
| `acc` CLI | Every action, and the **only writer** of state | core, `git`, `gh`, `claude`, `sf` |
| Plugin `acc` | Skills, hooks, a reviewer agent, and `bin/acc` for agents | Claude Code |
| VSCode extension | Views and buttons. Reads state directly, changes it only through `acc` | core, `acc`, `claude agents --json`, `gh` |

Claude Code supplies the agent runtime, and none of it is rebuilt here:

- background sessions (`claude --bg`), with `claude attach`, `logs` and `stop`
- live status (`claude agents --json`)
- hooks

### Where the code lives (D-099)

Each area of the Command Center has its own modules, so parallel builders
rarely touch the same file. Where something must name every area, each area
says so in its own module, as `export const area`, and a generated index
gathers them.

| Folder | What's in it | An area declares |
|---|---|---|
| `packages/cli/src/commands/` | One module per group of acc's commands: setup, tasks, agents (dispatch, done, block, resume, cleanup, agents, machine), pipeline (analyze, review, land, autopilot, sync), updates, environments, hooks, github, checks. `main.ts` is the entry, `shared.ts` what every group uses | its help lines (`section`, `order`, `lines`), the options it reads, its commands, and any argv a command needs changed first |
| `extension/src/model/` | The page's view models, a module per area: overview, history, tasks (the agent board), cards (what a task's card says), boards (tracker boards), task-page, updates, agents, questions, agent-page, runs, connect, worktrees, environments, setup, slack, and page (the page's own messages). `home.ts` builds the page from the areas' parts, `messages.ts` gathers their messages, `shared.ts` holds what several use | the messages its parts send with their checks (`messages`, and its `Message` type), the acc.* commands they may ask for (`commands`), and what it adds to the page (`home`: Needs you for each project or once, stat tiles, its item in the rail, in its `order`) |
| `extension/src/logic/` | Pure decisions, a module per area: setup and the walkthrough, tasks, agents, worktrees, environments, connect and trackers, runs, notices, autopilot, the status bar; `shared.ts` holds a task's row and an agent's session | nothing: nothing names every area here |
| `extension/src/` | Each area's VS Code side: tasks, agents, worktrees and environments (their commands, subclasses of `sidebar.ts`'s shared base), setup, trackers and the Connect page, identity, slack, notices (the status bar's menu), autopilot, progress (In progress's Stop), ticket (a task's page), questions, runs. `extension.ts` builds the extension's parts and hands them to every area; `hub.ts` loads, polls and caches (`task-rows.ts` reads a task's row); `panels.ts` handles the page's own messages | `register(parts)`: its commands, and with `receive` the page's messages it takes |
| `extension/webview/` | The page, flat so its tsconfig and the screenshot harness's staleness check see every file: overview, progress, tasks, task-page, updates, analysis, questions, agents, agent-page, dock, connect, worktrees, environments, slack, setup. `main.ts` is the entry; `state.ts` owns the page's state, `dom.ts` builds elements, `boards.ts` holds what boards share, `rail.ts` draws the rail | the sections and tabs it draws, what it draws over a section, its hooks around a draw, and the extension's messages it takes |
| `packages/core/src/` | dispatch.ts (the start and cleanup), packet.ts, held.ts and holding.ts (D-093); autopilot.ts (its mode and pass), autopilot-rules.ts, autopilot-log.ts. `index.ts` is generated: `export *` from each module by file name, then onboarding's (GH-95) | nothing: a module the index takes only some names from is in `scripts/areas.ts`'s `CORE_INDEX`, with why |

**A new command, message or section.** Add it to its area's module: a CLI
command to its group's `commands`, its help line to `lines` and any options to
`options`; a message the page sends to the model area's `Message` and
`messages`, and its handler to the extension area's `register` with
`receive`; an acc.* command the page asks for to the model area's `commands`.
**A new area** is a new module in the folder that declares `export const area`.
Run `npm run build`: `scripts/areas.ts` writes the folder's index (its
`AREAS`, and in model/ the `Message` union), headed "Generated … Don't edit
it", and `scripts/test/areas.test.ts` fails while one is stale.

**What still names every section** is the page's table of contents: the
sections and their titles in `model/shared.ts`, the section models a
`HomeModel` holds, each section's Refresh in `panels.ts`, and the union of the
page's models. A whole new section edits those as well as its own modules.

**The rules.** An area module imports shared modules and other areas, never an
index, so nothing loads an index from inside it. Tests import the area module
they test, not a barrel. A module node:test loads stays free of vscode: an
extension area that is also pure takes VS Code's API from the parts.

### Each area's fixtures, styles, tests and commands (GH-95)

The files every task used to touch follow the same areas, so a feature edits
only its own:

| What | Where | Adding one |
|---|---|---|
| The screenshots' sample data | `extension/scripts/fixtures/`, a module per area: tasks, agents (their sessions and ledgers), questions, history (and autopilot's steps), updates, analysis, boards, connect, task-page, agent-page, setup, runs, slack, environments, progress (In progress), overview (the merge queue). `hub.ts` puts the sample project together; `shared.ts` holds its paths and its builders' names | add it to its area's module; the screenshot script imports the module it draws from |
| The page's styles | `extension/webview/styles.css` holds what every area shares; `<module>.css` beside a module of the page holds that area's own. npm run build writes styles.css first, then the rest by file name, into one `dist/webview/styles.css`; `extension/scripts/styles.ts` gives the tests the same | a rule two areas need goes in styles.css, since the areas' order is only their names. A `.css` named for no module of the page fails the build |
| The extension's tests | `extension/test/<area>.test.ts`, named for what they test: setup, page, notices, tasks, cards, autopilot, agents, trackers, worktrees, environments, overview, updates, history, boards, and connect, progress, slack, tickets and the rest from before. `support.ts` holds what several share | put it in its area's file, so the near-tests gate (§9) finds it by name as well as by import |
| The commands the extension contributes | `extension/commands/<module>.json`, named for the module in `extension/src/` that registers them. npm run build writes package.json's `contributes.commands` from them, by file name; `extension/test/areas.test.ts` checks each is in the right file | add it to its registering module's file, then run npm run build |
| Core's exports | `packages/core/src/index.ts`, written by `scripts/areas.ts` | nothing, for a new module |

## 3. Where state lives

| Path | In git? | Holds |
|---|---|---|
| `.acc/config.json` | yes | Project settings ([section 4](#4-config)) |
| `.acc/rules.md` | yes, optional | The repo's own rules, which builders, reviewers and the analyst keep to. They win over every other ([section 8](#8-the-packet)) |
| `.acc/rules/<name>.md` | yes, optional | Rules copied in from elsewhere by `acc rules import`, each after a header naming its source, the commit or date it was copied, and its sha256 (GH-108, [docs/RULES.md](RULES.md)) |
| `.acc/packet.md` | yes, optional | Override for the builder's instructions template |
| `<git-common-dir>/acc/ledger.json` | no | Tasks: the current snapshot |
| `<git-common-dir>/acc/events.jsonl` | no | Append-only log of every change |
| `<git-common-dir>/acc/receipts/<sha>/<gate>.json` | no | Check results, tied to a commit |
| `<git-common-dir>/acc/reviews/<task>-<sha>.json` | no | Reviewer verdicts |
| `<git-common-dir>/acc/packets/<task>.md` | no | The rendered instructions each builder got |
| `<git-common-dir>/acc/logs/` | no | Full check output |
| `~/.acc/` | n/a | Machine-wide: list of managed repos, the heavy-check semaphore |
| `~/.acc/questions/` | n/a | Agents' questions waiting for the Command Center, and which windows are listening (D-030) |

**Why the git common directory (D-008).** `git rev-parse --git-common-dir`
gives the same directory from the main checkout and from every worktree, so
every agent and the extension see one ledger. Files there never appear in a
diff, never conflict on merge, and are never pushed.

The tracker stays the shared record that teammates see. The ledger is this
machine's orchestration state. `acc sync` can rebuild it from the tracker, the
branches and the pull requests.

## 4. Config

`.acc/config.json` for a Salesforce project with an org per environment:

```json
{
  "schema": 1,
  "project": "Acme",
  "profile": "salesforce",
  "github": { "repo": "acme-co/acme-salesforce", "account": "work-account" },
  "commitIdentity": { "name": "Jane Doe", "email": "jane@example.com" },
  "environments": [
    { "name": "Dev", "type": "developer", "org": "Acme Dev", "default": true, "promotesTo": ["uat", "production"] },
    { "name": "UAT", "type": "full", "org": "Acme UAT", "promotesTo": ["production"] },
    { "name": "Production", "type": "production", "org": "Acme Production", "protected": true }
  ],
  "environmentSpecific": "manifest/environment-specific.txt",
  "knownDrift": "manifest/known-drift.txt",
  "trackers": [{ "kind": "jira", "site": "example.atlassian.net", "project": "ACME" }],
  "agents": { "max": 3, "permissionMode": "acceptEdits" },
  "autonomy": "manual",
  "worktrees": { "root": "../acme-salesforce.worktrees" },
  "gates": { "required": ["format", "static", "validate"] }
}
```

A project with no Salesforce in it, such as this repo, sets
`"profile": "generic"`, gives one environment (`main`, no org), and lists its
check commands under `gates`.

**A branch is named after its environment (D-015).** The branch is the
environment name in lower case: `dev`, `uat`, `production`. Nobody has to
remember a mapping, and the tool can check it.

In the `salesforce` profile, the environment name *is* the sandbox name, which
Salesforce puts in the org's URL (`acme--uat.sandbox.my.salesforce.com` →
`uat`). Production's org isn't a sandbox and its branch is `production`.
`acc doctor` checks every environment's org against its branch and refuses to
dispatch if one doesn't match.

**Every org is known, and each project chooses its own path (D-018).** Clients
run very different pipelines, so the path isn't fixed. `acc init` reads
Production's sandbox list (`SandboxInfo`) and the logged-in aliases on the same
My Domain. It proposes an environment for each org, with its type. You then say
where each one promotes to.

| Pipeline shape | `promotesTo` |
|---|---|
| Dev → Full Copy → Production | `dev: [fullcopy]`, `fullcopy: [production]` |
| Sandbox → Production (smaller orgs) | `sandbox: [production]` |
| Dev → QA → Production, with QA optional | `dev: [qa, production]`, `qa: [production]` |

The type changes what the tool can do. Only `developer` and `developer_pro`
sandboxes support source tracking, so `acc doctor` checks it only there. A
`full` or `partial` sandbox gets validation and drift checks. `production` is
always protected. An org that's on no path, such as a training sandbox, is still
listed so that drift checks and `doctor` cover it.

| Field | Meaning |
|---|---|
| `github.account` | The `gh` account for this repo (D-007). `acc` passes `GH_TOKEN` on every call and sets the repo's commit identity and credential helper on `acc init` |
| `environments` | Every org the project has, whether or not it's on a promotion path. Each has a name, a branch (by default the lower-cased name), a `type` (`production`, `full`, `partial`, `developer`, `developer_pro`) and, in the `salesforce` profile, an org alias. A task builds from one environment's branch, and its pull request goes back into it. **Protected** environments never receive agent work. `promotesTo` lists where it can promote to, usual step first ([section 11](#11-landing)) |
| `environmentSpecific` | A list of files that differ by design in every environment, such as email service addresses, SSO and org settings. These are never edited by a task, never deployed, and never promoted (D-016) |
| `knownDrift` | Files that a drift check should expect to differ, such as features a sandbox lacks or ordering noise. They can still be edited and promoted |
| `trackers` | Where intake reads from. Several are allowed. A GitHub tracker's `skipLabels` lists labels whose issues aren't tasks, such as `["milestone"]` (D-048). Each tracker's place holds every read to this repo's tickets: its project, repo or monday.com `board`, narrowed by a Jira `epic`, GitHub `labels` (any one counts), an Azure `areaPath` or a monday.com `group` (D-072). A monday.com tracker names its `account` and `board`, and may name a `statusColumn` (D-085) |
| `agents.max` | Most builder sessions at once, default 3 |
| `autonomy` | How much the loop does on its own ([section 12](#12-the-orchestrator-loop)) |
| `autopilot.appendOnly` | Files, or folders, where autopilot may resolve a conflict with the base when both sides only added to the end, such as a decision log. Left out, there are none ([section 12](#12-the-orchestrator-loop)) |
| `dispatch.shared` | Files, or folders, that every task edits, such as the docs. Like `autopilot.appendOnly`, they never make one task wait for another's files. Left out, there are none ([section 7](#7-dispatch)) |
| `worktrees.root` | Where task worktrees go. The default is a sibling folder outside the repo ([section 7](#7-dispatch)) |
| `gates` | Which checks are required, plus per-check overrides. `gates.builder` names a builder's lighter checks, where the merge queue runs the required ones ([section 9](#9-gates-and-receipts)) |
| `template` | The team template the project was started from, written by `acc init --from`: its `name`, its `source` (a GitHub file URL, `<git-url>#<path>`, or a path inside the repo, under `~/`, or an absolute path elsewhere) and its `digest` (`sha256:` of its JSON with sorted keys). Setup's B0.template step says when the template has changed and the project now differs; nothing re-applies it ([docs/TEMPLATES.md](TEMPLATES.md), D-097) |

**Shared rules are copied in, not linked (GH-108).** A team's rules, such as
its Apex standards, reach a project as a copy in `.acc/rules/<name>.md`, never
as a path or URL read at run time, so a source that moves or goes changes
nothing here. `acc rules import <source>` makes the copy. The source is a path,
a GitHub file URL or `<git-url>#<path>`, fetched and refused as a team
template's is (D-097), and the copy starts with a header naming where it came
from. A team template's `rules` key names files to copy in when `acc init
--from` starts the project. No config key records them: each copy's header is
the only record. Setup's B0.rules step reads each source again, within 20
seconds for all of them, and says when one has changed. A person runs `acc
rules diff` to see how, and `acc rules import <source> --name <name> --force`
to take it. Copies live under `.acc/`, so the merge queue and autopilot leave
a change to them for a person to merge ([docs/RULES.md](RULES.md)).

## 5. Tasks and the ledger

A task is one unit of work, usually one ticket.

| Field | Example | Notes |
|---|---|---|
| `id` | `ACME-34`, `GH-12`, `T-3` | Tracker key, or `T-n` for a manual task. Used in branch, worktree and session names |
| `title`, `brief` | | Copied from the ticket at intake. `brief` holds the body and acceptance criteria |
| `source` | `{ "kind": "jira", "key": "ACME-34", "url": "…" }` | |
| `environment` | `dev` | One of the config environments. Defaults to the `default` one |
| `deps` | `["ACME-30"]` | Tasks that must be `done` first |
| `state` | `running` | See below |
| `run` | `{ "bgId", "sessionId", "worktree", "branch", "startedAt" }` | Set on dispatch |
| `pr` | `{ "number", "url", "state" }` | Set on land |
| `history` | `[{ "at", "by", "from", "to", "reason" }]` | Every change, and who made it |

### States

```mermaid
stateDiagram-v2
    [*] --> todo
    todo --> running: dispatch
    running --> review: builder finishes, checks pass
    review --> rework: changes needed
    rework --> running: re-dispatch
    review --> done: pull request merged
    todo --> done: issue closed before work started
    running --> todo: abandon
    done --> rework: reopened
    todo --> blocked
    running --> blocked
    review --> blocked
    rework --> blocked
    blocked --> todo: unblocked
```

Two states aren't stored. They're derived when the ledger is read:

- **Ready** means `todo` with every dependency `done`.
- **Needs you** means `running` while the session waits on a person, or while
  its builder has stopped without `acc done` or `acc block` (D-067): its session
  ended, went idle, or is gone from `claude agents`, two minutes or more after it
  started or was resumed. That's judged only when `claude agents` answers, and
  never while a resume runs. It says "Its agent stopped", with the last thing
  the agent said (an API error included, such as "Your computer went to sleep
  mid-response"), and offers Resume. A task also needs you when autopilot
  couldn't take its next step, in the state it failed in
  ([section 12](#12-the-orchestrator-loop)), and when it's in review with a pull
  request someone closed without merging (D-063).
- **Resume** (`acc resume <id>`, D-067) carries a stopped builder's session on
  in the folder its conversation is saved under, with the rules it was
  dispatched with, and tells it its last turn ended early. It's a person's or
  autopilot's, never an agent's.
- **Keeping awake** (D-067): on macOS, acc holds `caffeinate -i -w <pid>` for as
  long as a builder, reviewer or analyst it started runs, and ends it when the
  task leaves running. Only idle sleep is held off: the display still sleeps,
  and closing the lid still sleeps the Mac. Other platforms aren't kept awake.

| Shown as | Icon | Colour | Meaning |
|---|---|---|---|
| To do | `circle-outline` | neutral | Waiting on dependencies, or not picked up yet |
| Ready | `play-circle` | blue | Can be dispatched |
| Running | `sync` (spinning) | blue | A builder is working |
| Needs you | `bell` | **orange** | The session is waiting for permission or an answer, its builder stopped (`debug-disconnect`), or autopilot couldn't take a step |
| In review | `eye` | blue | Checks passed. Waiting for the reviewer or the pull request |
| Rework | `debug-restart` | **orange** | The reviewer or a human asked for changes, or autopilot sent back checks that failed on GitHub |
| Blocked | `circle-slash` | **orange** | Stopped. A reason is required |
| Done | `check` | neutral | Merged |

Orange means a person should look, and blue means work is moving. Every state
has an icon and a label, so colour never carries the meaning alone.

### Transition rules

| Change | Who may make it | Requires |
|---|---|---|
| todo → running | human, orchestrator | Every dependency done, below `agents.max`, environment not protected |
| running → review | builder (`acc done`), human | A passing receipt for every required check, on the current `HEAD` |
| review → rework | reviewer, human, orchestrator (autopilot sending back checks that failed on GitHub, D-076) | Findings or a reason |
| rework → running | human, orchestrator | |
| review → done | `acc sync` (pull request merged), human | |
| todo → done | `acc intake github`, as sync (D-048) | The issue was closed on GitHub, and the task never started (no `run`) |
| any → blocked | anyone | A reason |
| blocked → todo | human | |
| blocked → review | human | Every required check satisfied, such as by a waiver (D-031) |
| running → todo | human | A reason. The worktree is kept |

Anything else needs `--force --reason` and is recorded as an override.

**Writes.** Only `core` writes. It takes a lock (an atomic `mkdir` of
`ledger.lock`, broken if its owner process is gone). It then appends the event,
writes the new snapshot to a temporary file, and renames it into place. Readers
never see a half-written file.

## 6. Intake

Every source produces the same task input shape, and `acc import` reads it as
JSON. monday.com was one more producer (D-085).

| Source | How | Dependencies from |
|---|---|---|
| GitHub Issues | `acc intake github [--label L]`, run directly through `gh` with the repo's account | `Depends on #N` and `Blocked by #N` lines in the issue body |
| Jira, Azure DevOps | **Track** on a ticket's card on the tracker's board, or **Track in acc** on its page (one way for both), or the `acc:intake` skill: Claude queries a connector for the tracker's place and pipes the results to `acc import` | "is blocked by" issue links |
| monday.com | **Track** on an item's card, or **Track in acc** on its page. The brief is the item's long-text columns, or its first update | none |
| Manual | `acc add "title" --brief …` | `--dep` |

Intake is idempotent, keyed by tracker key, and it never changes the tracker.

Every read is held to each tracker's place (D-072): its project or repo, and
when set, a Jira epic (its tickets and their sub-tasks), GitHub labels (any
one), an Azure area path or a monday.com group. A monday.com board is the
tracker, as a Jira project is. `acc intake github` lists open issues per place
label, from the tracker's `repo`. `acc import` refuses a Jira, Azure or
monday.com key that no tracker owns. After a Jira, Azure or monday.com board
loads, the Command Center asks about the repo's unfinished tasks that aren't on
it, and hands the ones outside the place to `acc intake jira|azure|monday
--file`, which removes or names them as below.

`acc intake github` also follows issues that left the open list (D-048). It asks
GitHub about each unfinished task whose issue wasn't listed:

- **Closed**, and the task never started (`todo`, no `run`): the task moves to
  `done`, as `sync`, with the reason "Issue #N was closed on GitHub."
- **Has a label in the tracker's `skipLabels`**, open or closed: the issue isn't
  imported, and a task already made from it that never started leaves the
  ledger, with a `task.removed` event.
- **Left the place** (D-072): it has none of the place's labels, or moved to
  another repo. A task that never started leaves the ledger, as above.
- **Started already**: the task stays as it is, and the output names it.

`--json` lists these as `closed`, `removed` (of which `left` left the place) and
`leftAlone`.

## 7. Dispatch

`acc dispatch <id>` does the following:

1. **Checks.** The task is ready, running sessions are below `agents.max`, and
   the environment isn't protected, and its branch matches its org (D-015).
   Where the project wants an analysis first, the task has one with every
   question answered (D-052).
1b. **Weighs its files (D-093).** On a first dispatch, the files the task's
   analysis plans to change are compared with every task in flight: running,
   in review, rework or blocked, until its branch merges. A task in flight
   counts what its analysis plans and what its branch has changed: commits,
   and in its worktree uncommitted and untracked files. Two paths match when
   they're the same file or one is a folder holding the other. Files in
   `autopilot.appendOnly` or `dispatch.shared` never count.
   - **It shares none:** it goes on.
   - **It shares some, and another Ready task shares none:** it waits. acc
     records a hold on the task (who asked, and what it waits for), creates
     nothing, and says "GH-73 waits for GH-70's files: …, while GH-74 is ready
     to start". It stays in the Ready lane.
   - **It shares some, and nothing else is ready:** it goes on, and its run
     records which files it shares with which task.
   - **No analysis, an analysis naming no files, or a rework:** it goes on,
     and nothing in flight is looked at. A task to do says its files aren't
     known, and why.

   `acc dispatch <id> --anyway` starts it now, and its move records the
   overlap, with `anyway` when it overrode a wait. `acc dispatch --held` starts
   each held task that may go now: free ones first, oldest hold first,
   weighing the rest again after each start. It claims each in the ledger
   first, so a task is never started twice. The Command Center runs it on its
   poll when its board says a held task may go, asking less often, up to every
   10 minutes, while acc keeps saying the same tasks wait. Autopilot's `start`
   step does the same. A start that fails is written on the task, which needs
   you, and isn't tried again until a person acts. `--stop-waiting`, or any
   move, ends a hold.
2. **Creates the worktree.** It fetches, then runs
   `git worktree add <root>/<id> -b task/<id>-<slug> origin/<branch>`, where `<branch>` is the environment's branch. `<root>` is `.claude/worktrees/` inside the repo (D-022). On a
   rework, it reuses the existing worktree.
3. **Sets up the worktree.** In the `generic` profile, that means running
   `worktrees.setup` commands, such as `npm ci`. In the `salesforce` profile, it
   means writing `.sf/config.json` with the environment's org and linking
   `node_modules` from the main checkout.
4. **Writes the instructions.** It renders the packet ([section 8](#8-the-packet)).
5. **Launches the agent.** From the main checkout, which you trust once (D-022), it runs
   `claude --bg --name <name> --permission-mode <mode> --model <model> --settings <json> "<packet>"`.
   The name is `<project> · <key> <title> · builder`, such as
   `Acme Service · ACME-12 Case escalation rules · builder`: the title cut to 40
   characters at a word, and the task's second dispatch `builder 2` (D-087).
   Reviewers and analysts are named the same way, as `review` and `analysis`.
   The model is the one picked for the task, if one was, else the builder's:
   this clone's, the project's, or acc's default, `claude-opus-5-5` (D-086).
   The packet's first instruction is to call EnterWorktree on the task's worktree.
   The settings JSON sets `ACC_TASK` and `ACC_ROLE=builder` in the session's
   environment, plus an allowlist of routine commands, and a PermissionRequest
   hook that sends the builder's prompts and questions to the Command Center
   (D-030).
6. **Records the run.** It finds the new session by its name, the folder it
   started in and its start time, stores the background id, session id, name,
   number and model, and moves the task to `running`. A task's agent is found
   again by those ids, else by the recorded name, never by a name worked out
   from its title.

`acc dispatch --model <m>` picks the builder's model for this task. The run
keeps it, so a re-dispatch of its rework and a resume use it until another is
picked; the Command Center's **Dispatch with…** does the same, with the
analysis's size beside the models (D-086).

`acc dispatch --foreground` runs the same session in the current terminal
instead. You can drop into any background session with `claude attach <id>`.

**Why background sessions (D-009).** Claude Code's supervisor keeps them running
after the terminal closes. They report `working`, `blocked`, `done`, `failed` or
`stopped`, and what they're waiting for, through `claude agents --json`. Attach,
logs and stop come for free. The feature is a research preview, so
`--foreground` is the fallback.

**Why the tool makes its own worktrees.** There are three reasons:

- `claude --worktree` can only branch from the default branch or `HEAD`. A task
  has to start from its environment's branch.
- A sibling folder keeps duplicate source trees out of VSCode search and out of
  the Salesforce extensions' indexing.
- Claude Code's cleanup sweep leaves worktrees it didn't create alone. Cleanup is
  then `acc`'s job, and it refuses to delete unmerged or uncommitted work.

## 8. The packet

The packet is what a builder is told. It's rendered from `templates/packet.md`,
or from the project's `.acc/packet.md` if there is one. It contains:

- **The task:** id, title, link, brief and acceptance criteria.
- **Where:** the worktree path, the environment's branch and, for Salesforce,
  its org.
- **The finish line:**
  - Run each required check with `acc gate run <name>`: a builder's lighter
    ones where the merge queue runs the full check (§9, GH-73).
  - Commit as `<id>: <summary>`. For GitHub, add `refs #N`. Never write `fixes`
    or `closes`.
  - End with `acc done`, or with `acc block "<reason>"` if stuck.
- **Never:**
  - push, merge a pull request, open one, or deploy. Merging the base into its
    own branch is fine where the merge queue runs, as it asks when it conflicts;
    only there, and only its own base (`git merge origin/<its environment>`,
    with or without flags), is it allowed without asking
  - edit files outside the worktree
  - edit an environment-specific file
  - change the ticket
- **Rules:** one section, in a fixed order (GH-108). First the profile's rules
  (Salesforce's: bulk-safe Apex, sharing and field access, tests that assert
  outcomes, no org-specific values in metadata; a generic project has none),
  then each copy in `.acc/rules/` by file name, under a heading naming its
  source, then `.acc/rules.md`. A sentence before them says the later one
  wins, so the repo's own rules win where they conflict. They're read from the
  task's worktree, so a copy reaches builders once it's committed on the
  environment's branch. The copies' headers aren't sent. The reviewer and the
  analyst get the same section in the same order. The analyst reads it from
  the main checkout.

When the session resumes or compacts, the SessionStart hook injects a short
version again.

## 9. Gates and receipts

A gate is a named check. It has a command, a scope (usually the files changed
since the environment's branch), whether it's required, and whether it's heavy.

**Generic profile.** `format`, `lint`, `test` and `build` run the commands in
config.

**Salesforce profile:**

| Gate | Runs | Required |
|---|---|---|
| `format` | `prettier --check` on changed Apex (`.cls`, `.trigger`) and LWC code (`.js`, `.html`, `.css`). Never metadata XML (D-025) | yes |
| `lint` | ESLint on changed LWC and Aura JavaScript | when any changed |
| `static` | `sf code-analyzer run` on changed files. Fails at severity 2 or worse, which is configurable | yes |
| `lwc-tests` | `sfdx-lwc-jest --findRelatedTests` | when an LWC changed |
| `validate` | A check-only deploy of the changed source to the environment's org (`sf project deploy start --dry-run`, D-024). Uses `NoTestRun` when no Apex changed. Otherwise `RunSpecifiedTests`, with the tests the builder names and its reason for each | yes |

- **Changed files** come from `git diff --name-only <branch>...HEAD`, minus
  environment-specific files.
- **Deletions** are out of scope for agents in v1. A task that needs destructive
  changes goes to a person.
- **Receipts** record the gate, commit, pass or fail, timings, a summary, the log
  path, and any Salesforce job id, org id and tests run. They're tied to a
  commit, so a new commit makes them stale.
- **Heavy gates** take a slot in a machine-wide semaphore (one at a time by
  default). Every gate runs under `nice -n 15`.
- **A gate that doesn't apply** records `skip`, which satisfies `acc done`. A
  run with uncommitted changes records nothing. `error` (couldn't run) is kept
  apart from `fail` (the change is wrong). See D-024.

- **A waived gate** (D-031) is a skip a person chose, with a reason:
  `acc gate waive <gate>... --reason "<why>" [--task <id>]`, or **Waive…** beside
  a failing check on the ticket page. Its receipt keeps who waived it, why, and
  what it had been. It holds for that commit only, and `acc gate run` leaves it
  alone. Builders can't waive: the CLI refuses them, and their settings deny the
  command.

`acc gate run [<gate>...]` runs the required gates, or the ones named, on the
current commit. `acc gate list` shows each gate and its result on this commit,
or on the task's latest commit with `--task`.

**A builder's lighter checks** (GH-73). Where auto-merge is on, the merge queue
runs `gates.required`, the full check, once on the commit that merges (§12). A
repo can then give its builders lighter ones in `gates.builder`, such as a
typecheck and the tests near what changed: `acc gate run` with no names runs
them, and `acc done`, `acc review` and `acc land` take them. The full check
passing on a commit covers them. Left out, or where auto-merge doesn't cover the
environment, builders run `gates.required`, as before. A command gate is told
what the branch changed, and the tests near those changes, one path a line, in
`ACC_CHANGED` and `ACC_NEAR_TESTS`: the test files it changed, and, in the same
package, the tests named for each other file it changed (`merge.ts` →
`merge.test.ts`, `test_merge.py`) or that import it. A file a folder's index
gathers is near the tests of that index and of what loads it (GH-95): an index
imports the file and most of the other code in its folder, so
`packages/cli/src/commands/tasks.ts` is near the tests that run
`packages/cli/src/main.ts`. A package starts at its `src`, `lib` or `app`
folder, else at the nearest folder with a `package.json`, so the page's modules
in `extension/webview/` are near `extension/test/`. Only a gate whose command
names `ACC_NEAR_TESTS`, or names a file in the checkout that does, is given it;
acc reads each file once to work it out. This repo's builders run `typecheck`
and `near-tests` (`scripts/near-tests.mjs`, which fails if it isn't given the
list).

**Agents validate; they never deploy (D-011).** Parallel branches deploying to
one shared sandbox would overwrite each other's work. A deploy happens after
merge, from the environment's branch, one at a time, through
`acc deploy <environment>`. It sends only the changed components and never an
environment-specific file. For a protected environment, it also needs a person's
`--confirm-production`.

**Drift.** `acc drift <environment>` retrieves the baseline manifest into a
throwaway worktree. It reports what changed in the org since its branch was last
updated, ignoring `knownDrift` and `environmentSpecific`. The org isn't changed.

## 10. Review

`acc review <id>` gives a fresh agent four things:

- the packet
- the diff against the environment's branch
- the receipts
- the project's rules

It runs as `claude -p --permission-mode dontAsk --allowedTools Read Grep Glob
--output-format json --json-schema <verdict> --session-id <id>` inside the
worktree, with the reviewer's instructions appended to the system prompt
(D-032). Only the read tools are allowed, and `dontAsk` refuses everything else,
so it can't edit, run commands or ask. It starts with no context, and its
session can be watched like any agent's.

- **It checks:** whether the acceptance criteria are met, whether the project
  rules are followed, whether the change strayed outside the ticket, and whether
  the tests actually exercise the change.
- **It skips formatting,** which the checks already cover.
- **Its verdict:** `{ "verdict": "pass" | "changes", "summary", "criteria":
  [{ "text", "met", "evidence" }], "findings": [{ "message", "must", "file",
  "line", "rule" }] }`. A pass with a finding that must be fixed counts as
  changes. Verdicts are kept at `<git-common-dir>/acc/reviews/<task>-<sha>.json`.
- **On `changes`:** the task moves to `rework`, and the findings are added to
  the packet for the next run.
- **Profiles add their own checks** (D-003), as the profile's rules: the first
  part of the Rules section the builder gets too ([section 8](#8-the-packet)).
  Salesforce asks about bulk safety, sharing and field access, tests that
  assert outcomes, and org-specific values in metadata.

## 11. Landing

`acc land <id>` first requires two things on the current `HEAD`: a passing
review, and passing receipts for every required check. Then it:

1. Pushes `task/<id>-…` with the repo's account.
2. Opens the pull request:
   `gh pr create --base <branch> --title "<id>: <title>"`. The generated body
   holds a summary, an acceptance checklist, the check table, the review verdict
   and the ticket link.
3. Drafts an update for the ticket (D-066): the pull request's link and one
   plain sentence for the client, which the review writes (`client`), or the
   task's title when it has none. It posts nothing. The draft is kept in
   `<git-common-dir>/acc/updates/<task>.<n>.json`, and `--json` names it under
   `update`. A person reads it, edits it and posts it as themselves.

It never merges. A person merges the pull request on GitHub, or autopilot does
where the repo turns auto-merge on ([section 12](#12-the-orchestrator-loop)),
and its description's last line says which. Landing again pushes the new
commits and updates the open pull request's description, rather than opening another, and drafts "updated
for review". A draft of the same news that nobody posted yet is replaced, so a
pull request updated three times is one draft; one that still says it's ready
for review keeps saying so, with the latest link.

**Ticket updates (D-066).** acc never posts on a ticket by itself, apart from
closing a GitHub issue where the tracker says `"edits"` (D-082). It drafts an
update when:

- a pull request opens, or is updated, for review (`acc land`, autopilot)
- a task's pull request merges into its environment (`acc sync`), unless acc
  closes its GitHub issue instead (D-082, below)
- a promotion takes a task's change on to the next environment (`acc promote`):
  "ready to go to UAT", then "now in UAT" once `acc sync` sees it merge (D-075)
- a deploy carries a merged task to its org (`acc deploy`): each task whose
  change arrived on that branch in what was deployed, by its own merge commit
  (`pr.mergeSha`, kept by `acc sync`) or by the merge of the promotion that took
  it there
- a builder is stuck on something only the client can answer:
  `acc block --client "<question>"`. A plain block stays internal.
- a person sends one of the analysis's questions to the client (`acc update ask`)

Each draft is written for the client, with no word of agents, worktrees, acc,
builders, reviewers or rework. `acc updates` lists them. A person posts each
from the Command Center, with their edits: a GitHub issue's through acc as the
repo's account (`acc update post`), and a Jira, Azure DevOps or monday.com
ticket's through the repo's sign-in, claimed in acc first so a second window
can't post it again. A monday.com one posts as an update on the item.
`acc update discard <id>` sets one aside. A post unconfirmed for five minutes
may have gone, and says so. Builders, reviewers, analysts and autopilot can't
post or discard.

**After the pull request opens:**

- `acc sync` polls open pull requests. A merged one makes its task `done`. A
  closed-unmerged one moves its task to `blocked` with the reason. Moved back
  to review, that task needs you until a person lands it again, which updates
  the pull request if someone reopened it on GitHub, or opens a new one
  (D-063). Failing CI,
  a person's requested changes, or a conflict with its base shows the task as
  **needs you**. It finds conflicts itself, naming the files (D-049). The
  Command Center runs it every two minutes while it's open. Under
  `autonomy: review`, autopilot merges the base into a conflicting pull
  request's branch when it can ([section 12](#12-the-orchestrator-loop)). With
  auto-merge on, it merges the pull request itself once it's reviewed and green,
  and the next `acc sync` moves the task to done.
- **Where the GitHub tracker says `"edits": true`,** a task sync moves to done
  has its issue closed (D-082): as completed, as the repo's account, with one
  comment, "Done: pull request #42 merged into main.", which stands in for the
  merged draft and discards the unposted pull request and merged ones. acc
  looks first, and leaves an issue already closed, moved or gone. The close is
  marked on the pull request (`pr.issue`: pending, closed or left), so it
  happens once, and a person who reopens the issue keeps it open. A close that
  fails is named in sync's output and tried again by each sync, which the
  Command Center keeps running while one is pending. Jira and Azure DevOps
  tickets are never changed: their status is the client's workflow.
  `acc sync --close-done [--plan]` is a person's one-off tidy for tasks done
  before this, under the same rule, listing each.
- `acc cleanup <id>` removes the worktree and local branch, but only once the
  pull request is merged and the worktree is clean.

### Promotion

Promotion moves merged work from one environment's branch to another, along a
path its `promotesTo` allows. A person starts every promotion:

- `acc promote <environment>` goes to the first entry in `promotesTo`.
- `acc promote <environment> --to <other>` goes to any other listed entry.

`acc` opens a pull request into the destination branch and validates the change
against the destination's org. Environment-specific files are left out (D-034):

- **The promotion branch starts from the destination** and takes only what the
  source changed since the two branches last shared history. A fix made straight
  in the destination is never undone. A file the destination already has as the
  source does is skipped.
- **The check is its own** check-only deploy to the destination's org, protected
  or not, with the org's local tests when Apex changes. If it fails, no pull
  request opens.
- **Deletions need `--allow-deletions`,** or the page's "with the deletions".
- **Each ticket it carries gets a draft** a person posts (D-075): "ready to go
  to" the destination with the pull request's link, then "now in" it once
  `acc sync` sees the merge, then deployed there after `acc deploy`.

**Deploying.** `acc deploy <environment>` runs after a person merges, from the
environment's branch on GitHub. It deploys what changed since the last deploy acc
recorded (`<git-common-dir>/acc/deploys/<branch>.json`). A first deploy names its
starting commit with `--since`.

- It never deploys an environment-specific file or a deletion.
- It runs the org's local tests when Apex changes.
- It takes the machine's heavy slot, so it runs one at a time.
- A protected org needs `--confirm-production`. On the page, you type the
  environment's name.
- Builders and reviewers can't run `promote` or `deploy`: the CLI refuses them,
  and their settings deny both commands.

**Skipping is allowed, and stated.** If the chosen route bypasses an
environment that the usual path goes through, `acc` names it in the warning and
in the pull request body. For example: "Skips `qa`: this change hasn't been
validated there." If the pull request would delete files in the destination,
`acc` warns before opening it, because that usually means the two branches have
drifted apart.

## 12. The orchestrator loop

The loop is ordinary code, not an agent (D-010). `acc autopilot` reads the
ledger and takes the next step for each task, one task at a time, as the
`orchestrator` actor (D-055). It goes up to an open pull request and no further.

| `autonomy` | What runs on its own |
|---|---|
| `manual` (default) | Nothing. The extension shows the next steps as buttons, and `acc autopilot` does nothing |
| `review` | Autopilot reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, merges the base into a pull request that conflicts with it, and starts a task a person dispatched once the files it waits for are free. With `autopilot.autoMerge`, reviewed, green pull requests merge in turn, through the repo's merge queue |
| `dispatch` | As `review`, and it also starts Ready tasks up to `agents.max`. Not built yet: autopilot refuses |
| `full` | Read as `dispatch`, with a warning |

`acc autopilot [--once | --every <seconds>]` does one pass and exits, or a pass
every `<seconds>` (at least 30) until it's stopped. The gap runs from the end of
one pass to the start of the next, because a pass can hold a 45-minute review.
The config is read again before each pass, so setting `autonomy` back to
`manual` stops it. Each pass takes one step a task, reading the ledger again
before each:

| The task | Autopilot |
|---|---|
| In review, nothing has reviewed its latest commit, no review running | `review` (the reviewer's move, made for autopilot) |
| In review, its latest commit passed, no pull request, or an open one behind that commit | `land` |
| In review, its latest commit passed, its pull request closed without merging | Nothing. It needs you, naming the pull request: a person lands it again, or not (D-063) |
| In review, its latest commit passed and landed, but the pull request conflicts with its base (auto-merge off) | `refresh`: merge the base in, then run its checks. The next passes review and land the merge |
| In review, its latest commit passed and landed, and the pull request's checks failed on GitHub there | `checks`: send it back to its builder with each failed check's link and log (D-076). Once a commit, and 3 times a task with the merge queue's; checks still running wait; a failed check with no log on GitHub needs you |
| With auto-merge on: in review, its latest commit passed and landed, its checks passed on GitHub, and nothing waits on a person, conflict or not | It joins the repo's merge queue, at the back. Waits that settle by themselves, such as GitHub's checks running, keep its place; anything that waits on a person makes it leave |
| With auto-merge on: at the head of the merge queue, after every other task | `queue`: its base merged in if it moved on, the full check once, then pushed, or merged with `gh pr merge --match-head-commit`. One merge a pass. `acc sync` then moves it to done |
| In rework, sent back by autopilot for failing checks or from the merge queue | `dispatch`, with what the checks or the queue found |
| In rework from a review or a person, and autopilot hasn't re-dispatched one before | `dispatch`, once. A second rework waits for a person |
| Running, its builder stopped, and autopilot hasn't resumed it in this run | `resume`, once a run (D-067). A second stop waits for a person; a new dispatch is a new run |
| Running, its builder at work | Nothing |
| To do, a person dispatched it, and it waits for another task's files ([section 7](#7-dispatch)) | `start`, once nothing it shares files with is in flight, or nothing else is ready to start, under `agents.max`. A start that fails needs you |
| To do (ready or not) that nobody dispatched, blocked or done | Nothing |

- **What it never does:** waive a check, deploy, promote, change anything on
  GitHub besides landing and an auto-merge (it only reads checks and their
  logs), start a task to do that nobody dispatched, or merge a pull request
  where the repo hasn't turned auto-merge on. Builders, reviewers and analysts
  can't run it.
- **Auto-merge** (GH-67) is off unless `.acc/config.json` says
  `"autopilot": { "autoMerge": true }`, which `acc agents auto-merge on` writes
  and the Agents section's Auto-merge row runs. A Salesforce project can't turn
  it on, and it never merges into a protected environment. A task in review
  merges when its review passed and its checks settled on the branch's latest
  commit, landed; GitHub's required checks passed there, or every check when the
  base requires none (none at all count 2 minutes after the land, or at once
  for the merge queue when it conflicts, since GitHub runs none then); GitHub says
  it's mergeable; it's up to date with its base (the merge queue sees to it);
  no person asked for changes; nothing waits on a person, such as a failed step
  or an agent's question; and it changes nothing under `.acc/`. Autopilot reads
  all of it again just before `gh pr merge <n> --<method> --match-head-commit
  <sha>` as the repo's account, with the first method of merge, squash and
  rebase the repo allows. A head or base that moved, checks still running, or
  BLOCKED with no checks reported yet, wait (until 15 minutes after the land);
  a merge GitHub refuses, BLOCKED by its rules, a cancelled check or a change
  to `.acc/` is recorded as `merge`, and the task needs you. It keeps `autopilot.merged`, and `acc sync` moves the
  task to done and drafts its update.
- **The merge queue** (GH-73) is how auto-merge merges: one queue a repo, in the
  order autopilot first saw each pull request ready (`autopilot.queued`). Only
  the head takes a turn, after every other task in a pass. If its base moved
  on, the base is merged in, in its worktree, by a refresh's rules; then
  `gates.required` runs once on the result, in a heavy-check slot, unless it
  already passed there. A merge commit is pushed to the same pull request: it
  carries the review of the commit it was made on (`autopilot.carried`), with no
  new verdict, since autopilot resolves nothing but append-only files. Once
  GitHub's checks pass on it, the next turn merges it. A conflict autopilot
  can't resolve, or a full check that fails, puts the branch back and sends the
  task to its builder, review → rework as the orchestrator, with what it found
  in `<state>/queue/<task>-<sha>.json` for its packet. That send-back shares
  D-076's limits, once a commit and 3 a task. Past them, a check waived on the
  commit before, or anything else that stops the turn, such as a dirty worktree
  or a heavy-check slot that stayed taken, is recorded as `queue` (or `merge`
  for the merge itself), and the task needs you. Either way it leaves the
  queue, and the next is the head. A pull request at a commit on GitHub that
  acc didn't land, such as after Update branch, doesn't wait for GitHub: it
  takes its turn, whose fetch finds the commit this clone lacks, and it needs
  you. An agent in its worktree asking a person something keeps it out of the
  queue. A place counts only while auto-merge covers the task, so switching
  auto-merge or autonomy review off shows a conflict as needing you again. The
  Overview shows each queue: each pull request's place, and what it waits on:
  GitHub's checks only when it's them, else that wait in its own words.
- **A refresh** (D-058) merges origin's copy of the task environment's branch
  into the task branch, in the task's worktree, never the main checkout. It
  asks git again first, and a conflict that's gone is only marked gone. It
  resolves just the files in `autopilot.appendOnly` where both sides only added
  to the end, keeping the base's additions, then the branch's. Any other
  conflict aborts the merge and leaves the branch as it was. A check that fails
  on the merge commit rolls the branch back to the commit before it. Either way
  nothing is pushed, and the task needs you, saying why. A worktree with
  uncommitted changes, a missing worktree, or a branch with commits on origin
  the local one lacks stops it before it merges.
- **Failing checks** (D-076): autopilot reads, as the repo's account, the base
  branch's required checks on the pull request's latest commit, or every check
  when it requires none. It asks only for a task it could send back, and not
  once acc sync saw them pass. It waits while any still run; cancelled and
  skipped checks aren't failures. A send-back moves the task to rework with
  "Checks failed on GitHub on <sha>: <names>", keeps the commit in
  `autopilot.sentBack`, and writes each failed check's link and the last 100
  lines (10 KB) of its log to `<state>/checks/<task>-<sha>.json`, which the
  builder's packet carries: builders get no gh. Checks failing again on that
  commit are recorded as a failed `checks` step, and the task needs you; so is a
  fourth send-back. While a fix is reviewed, the old commit's failing checks
  don't show the task as needs you. A failed check that isn't an Actions job has
  no log on GitHub: alone, it needs you, as before.
- **Who did it:** lands, re-dispatches and send-backs for failing checks are
  `orchestrator`, by `orchestrator:autopilot`. A review stays the reviewer's
  move, by `reviewer:<id> for orchestrator:autopilot`. A send-back's
  re-dispatch doesn't use the review's one re-dispatch, nor the other way round.
- **One at a time:** it holds `<git-common-dir>/acc/autopilot.lock` while it
  runs, so a second autopilot on the same repo is refused, naming the first one's
  pid. Only a dead owner frees the lock. Only a refresh's checks take the
  heavy-check slot, as a builder's do. A slot still taken after its 3 hours
  undoes the merge, and the refresh fails like any step, with its reason: a
  check that holds a slot that long is stuck, and a person clears it.
- **A step that fails** is recorded on the task (`autopilot.failed`: the step,
  the commit, the state, the reason) and isn't tried again on that commit. The
  task shows as needs you with the reason. A new commit lets autopilot try
  again. A review, a land or any move clears it, so doing the step by hand does
  too. A full agent cap or a busy ledger only waits for the next pass.
- **Each land drafts the ticket's update** and posts nothing (D-066). Autopilot
  prints `Drafted an update for <KEY>`, and `--json` lists them under `updates`.
  A person posts each one.
- **`--json`** lists each task looked at, with its step (or none), the commit,
  the outcome (`done`, `failed`, `waiting` or `skipped`) and why. With `--every`,
  it prints a line of JSON a pass.
- **The Command Center hosts it** (D-064). For each repo whose autonomy isn't
  manual, a status bar switch says "Autopilot: on" or "Autopilot: off". It's
  off when VSCode opens, and a click turns it on until VSCode closes. On, the
  window runs `acc autopilot --every 60` as a background run, with its own pid
  in `ACC_AUTOPILOT_PARENT`, so autopilot stops once that window has gone. One
  started elsewhere shows as "on elsewhere", with its pid. Every window reads
  what autopilot did from the ledger's events: each step is in the Overview's
  History, and a notice. `acc agents autonomy [manual|review]` changes the
  level, and the Agents section's Autonomy row runs it. `acc agents auto-merge
  [on|off]` and its Auto-merge row do the same for auto-merge, which the status
  bar's menu shows for each repo.

An agent is used for judgment, not routing. The `acc:orchestrate` skill helps
break a large ticket into tasks, triage a blocked task, or write rework guidance.

## 13. Plugin

```
plugin/
  .claude-plugin/plugin.json   name "acc"
  bin/acc                      the launcher, on the Bash tool's PATH while the plugin is enabled
  bin/acc.mjs                  the bundled CLI it runs
  hooks/hooks.json             SessionStart, PreToolUse and Stop, each `acc hook <event>`
  agents/reviewer.md           the read-only reviewer, for use in a session
  skills/intake/  task/  orchestrate/  land/
```

A `.claude-plugin/marketplace.json` at the repo root lists `./plugin`, so this
repo is the plugin's marketplace, `agent-command-center`. The machine
walkthrough's A4 step installs it at Claude Code's user scope, for every
session: its check reads `claude plugin list --json`, and its **Do it** runs
`claude plugin marketplace add https://github.com/jack-huffman/agent-command-center`
and `claude plugin install acc@agent-command-center --scope user`, or only
what's missing (D-081). Claude Code clones the private repo with the person's
own git credentials. During development, `claude --plugin-dir plugin` loads it
in place. `npm run validate-plugin` runs `claude plugin validate --strict` on
both (D-042).

`plugin/bin/` is generated, but it's committed, because a plugin installed
from git has no build step. It's refreshed only by `npm run package`, which
copies the launcher and `acc.mjs` together, last, once the package has passed
its checks, so a branch's checks never touch it.

`bin/acc` is a small POSIX sh launcher, the same one everywhere acc ships
(D-077). It runs `acc.mjs` beside it with `$ACC_NODE` if set, else node 20 or
later on PATH, else the VSCode runtime the extension records in
`~/.acc/runtime`. With none, `acc hook …` exits 0 and prints nothing, so a
hook never breaks a session for want of Node, and any other command prints
one line naming the fix.

Hooks return at once unless the working directory is inside a repo with
`.acc/config.json`, and they do nothing for a session that isn't a builder. A
builder is known by `ACC_ROLE=builder` and `ACC_TASK` in its environment, or by
its folder being a running task's worktree. A hook never blocks by failing: on
anything unexpected it prints nothing and exits 0.

| Event | Matcher | Does |
|---|---|---|
| SessionStart | | Links the session to its task. On a resume or compaction, gives the builder its short instructions again |
| PreToolUse | `Edit\|Write\|MultiEdit\|NotebookEdit` | Stops a builder editing outside its worktree, or editing an environment-specific file |
| PreToolUse | `Bash` | Stops a builder from pushing at all, `gh pr merge`/`create`/`close`, a release (`npm run release`, `gh release create`/`upload`/`edit`/`delete`), a real `sf project deploy` (anything but `--dry-run`), deleting an org, `fixes` or `closes` keywords in a commit message, `--no-verify`, switching branch, `git worktree`, `reset --hard`, and the acc commands that are a person's (`set`, `dispatch`, `review`, `land`, `gate waive`, `promote`, `deploy`, `init`, `cleanup`) |
| Stop | | If a builder's task is still running, reminds it of the finish line, once a session |

The plugin doesn't install the permission hook (D-030) everywhere: it would
send your own interactive sessions' prompts to the page. `acc dispatch` adds it
to builders.

### Releases

acc, the extension, the plugin and its marketplace entry share one version,
the root package.json's (D-079). A release goes:

1. `npm run set-version -- <x.y.z>` writes it to every manifest, and a
   `## <x.y.z>` entry in `CHANGELOG.md` says what changed, in plain words. Both
   go through a branch and a pull request like any change.
2. On main, after the merge, `npm run package`. It refuses a version whose
   manifests disagree or that has no CHANGELOG entry, before building. Then it
   runs the checks, makes `dist/agent-command-center-<x.y.z>.vsix`, and scans
   the `.vsix` and the plugin for the packager's personal data: home paths,
   their git emails, their GitHub accounts, their name in a `.claude` or `.acc`
   path, and tracker sites. Each find is printed as `<package>: <file>:<line>:
   <what>`, and stops the package with no `.vsix` and plugin/bin unchanged. A
   clean package refreshes plugin/bin; commit it and push.
3. `npm run release` makes GitHub Release `v<x.y.z>` of main, as the repo's
   account, with the `.vsix` attached and the CHANGELOG entry as its notes. It
   runs only in a terminal, asks for the version to be typed, and refuses when
   anything doesn't match: the branch, the commit on GitHub, the tree, the
   versions, the `.vsix`, plugin/bin, or the scan, run again.

Builders can't release: their hooks and settings deny `npm run release` and
`gh release create`, `upload`, `edit` and `delete`.

**Installing a release** (D-081): with access to the private repo, a person
downloads the `.vsix` from its release (`gh release download -R
github.com/jack-huffman/agent-command-center -p '*.vsix'`) and installs it in
VSCode. The machine walkthrough then installs the plugin (A4). A private
marketplace doesn't update itself without `GITHUB_TOKEN`, so after each
release the plugin is updated by hand, as the README's Install and first run
says.

## 14. VSCode extension

An **Agents** container in the activity bar holds three views:

- **Board** (webview). Columns are To do, Ready, Running, In review, Rework,
  Blocked and Done. Each card shows id, title, agent state, checks, pull request
  and buttons.
- **Sessions** (tree). Every Claude Code session from `claude agents --json`,
  with task-linked ones first. Each shows its state and what it's waiting for.
- **Worktrees** (tree). For each task: branch, uncommitted files, ahead or behind
  the environment's branch, pull request and CI.

**Status bar:** running, needs you, and in review counts, each with its icon.
For each repo whose autonomy isn't manual, autopilot's switch: on, off, or on
elsewhere (D-064).

**Notifications:** a session needs you (with **Open in Claude Code**), a task is
ready for review, a review passed or asked for changes, CI fails on a task's
pull request, or it conflicts with its base. Each offers its next step, and each change is said once (D-044).
Each step autopilot takes is said once too, and what it couldn't do is a
warning (D-064).

**Commands:** Dispatch, Attach (`claude attach` in a terminal), Review, Land,
Clean up, Intake, Open packet, Open pull request, Block or unblock, and Refresh.

| Data | Source | Refresh |
|---|---|---|
| Tasks | `ledger.json` | When the file changes |
| Sessions | `claude agents --json` | Every 5 s while visible, 30 s hidden |
| Worktrees | `git worktree list`, `git status` | When the ledger changes, and every 15 s |
| Pull requests, CI | `gh pr list --json …` with the repo's account | Every 60 s |

The extension handles every workspace folder that has `.acc/config.json`.

### Boards and ticket pages (D-026)

- **The Tasks tab shows each tracker's own board.** A Jira board's columns are
  mapped to their statuses. A GitHub Project's columns are its Status options;
  with no Project, they're Open and Closed. A monday.com board's columns are one
  status column's labels, in monday's order, with No status first when an item
  has none (D-085). A toggle switches to acc's agent board.
- **Dragging a card moves the real ticket.** It runs the workflow transition
  whose target status the column holds. When the workflow offers several, you
  pick one; when it offers none, the card goes back and the board says so. It's
  a person's deliberate move on the board, so it works whether or not the
  tracker says `"edits"` (D-066).
- **Each card shows acc's side** of the ticket when acc keeps it: the state, and
  the next step, such as Dispatch or Attach.
- **A ticket's page** has the rendered description, the comments with a comment
  box, status, assignee and labels, and related tickets. Alongside them are acc's
  state, the agent, worktree, branch, checks and history. A ticket acc doesn't
  keep yet can be tracked from there. Tasks with no tracker get the same page
  from their brief and history.
- **Status, assignee and labels are read-only** unless the tracker says
  `"edits": true` in `.acc/config.json`, as this repo's own GitHub tracker does
  (D-066). A client's tracker is theirs. Comments stay. On a GitHub tracker,
  `"edits"` also lets acc sync close a task's issue when its work merges
  (D-082).
- **Updates acc drafted** for the ticket come first in its Activity, each in a
  box to edit, with who it posts as, Post and Discard. With no sign-in for its
  tracker, Post waits and offers the sign-in. The Overview's Needs you lists
  each as "Update ready for <KEY>", with Post, Edit and Discard.
- **An unsent edit is what Needs you shows** (D-070): the row says "Edited on
  the task page" and shows the edited text, with Edit first and Discard, and
  no Post. If acc drafts the same news again, the edit moves to the newer
  draft, saying "A newer draft replaced this one; your edit is kept". The
  newer wording shows beneath it when it differs. This holds in this window
  only, while the task page is open.
- **Rich text is drawn, never injected.** GitHub's markdown and Jira's ADF both
  become one document model, which the page builds with DOM calls. Raw HTML in a
  ticket keeps its words and loses its tags. Links open in the browser, and only
  web links. Images and attachments aren't loaded; they're shown as links.

### The Command Center page (D-029)

Clicking the Activity Bar's **Command Center** icon opens one full editor page,
and tucks the sidebar away. That replaces the five sidebar views of D-020 and
the per-view tabs of D-021. A rail on the left holds the sections, each with a
count; under 820 px wide, it becomes a tab strip along the top.

| Section | What it holds |
|---|---|
| **Overview** | **Needs you:** agents waiting on a prompt, blocked tasks, steps autopilot couldn't take (with why, and the step to take by hand), missing tracker sign-ins and setup still to do, each with its button. Then, apart, work waiting for review. Stat tiles open their sections. **Ready for an agent** has Dispatch buttons, and **History** lists your answers, every task's moves, each step autopilot took, wherever it ran, and the commands acc ran (D-064) |
| **Tasks** | The tracker's own board, or acc's agent board (D-026) |
| **Agents** | Sessions by project, each with the model it runs with (D-086), and a menu on each row (D-023). **Settings** in the header opens **How agents run** above them: builders' and reviewers' model and effort (D-036), the project's autonomy (D-064) and auto-merge (D-083). It's closed until opened, and remembered for the tab; per-token billing shows even while it's closed (D-089) |
| **Worktrees** | Every checkout, with a menu on each row |
| **Environments** | The GitHub identity card (D-028), promotion paths, and one card per environment |
| **Setup** | The checklist, with Do it on each step |

The page polls only while it's visible. The section you leave it on is where it
opens next. The sidebar keeps a single launcher view listing the sections; set
`agentCommandCenter.openFromActivityBar` to false to keep it open instead. The
icon's badge counts what needs you.

The page is a webview under a nonce content security policy. It renders text
only and accepts only allow-listed `acc.*` commands. Ticket pages stay their
own tabs, since each is a document.

### Questions, activity and output (D-030)

- **Questions.** `acc hook permission`, the PermissionRequest hook acc gives
  the sessions it starts, leaves each permission prompt and AskUserQuestion in
  `~/.acc/questions/` and waits.
  - The Overview shows it first under **Needs you**, as a card with Allow,
    "don't ask again this session" and Deny, or the question's options. A
    notification offers the same.
  - The hook waits only while a window listens for the agent's folder. With
    none, the window closed, or **In the terminal** chosen, Claude Code asks in
    its own prompt as usual.
- **Activity.** **Watch** opens an agent's own tab: its timeline from the
  session transcript, live while it works, with the waiting question at the
  top. Long results fold; failures say so in words.
- **Output.** Commands acc runs for you stream into a panel at the bottom of
  the page, which asks for them when they prompt. Only commands that need a
  keyboard of their own open a terminal.

### Walkthrough

The extension's first feature is a guided setup, built on VSCode's walkthroughs
(the **Get Started** pages). It opens on its own the first time a folder has no
`.acc/config.json`. There are two walkthroughs:

1. **Set up this machine:** steps A1 to A4 in [ONBOARDING.md](ONBOARDING.md):
   the tools, GitHub, agents' billing, and the acc plugin in Claude Code (§13).
2. **Onboard a project:** steps B0 to B14. The Salesforce-only steps are hidden
   for a `generic` project.

Each step explains why it matters and has up to three buttons:

- **Do it:** runs the `acc` command in a visible terminal, so you see exactly
  what runs.
- **Open in Salesforce:** opens the right Setup page with `sf org open --path`.
  Some steps are clicks only a person can make, such as switching on source
  tracking.
- **Check:** runs the step's check.

When a check passes, the extension sets that step's context key, and the step
ticks itself (`completionEvents: ["onContext:acc.step.<id>"]`). The extension
re-runs every check when a folder opens, so the walkthrough always reflects the
real state, not what was clicked.

**One list of steps drives everything (D-017).** Steps are data in `core`. Each
one has:

- an `id`, such as `B8.tracking`
- a title and a "why"
- the profiles it applies to
- a `check()` that returns pass, fail or unknown, with detail
- a fix: an `acc` command, a Setup path, or a docs link

`acc doctor` runs the same checks and prints the same text. `acc onboard` walks
through them in a terminal. ONBOARDING.md is written by hand, and names every
step as **title** (`id`): a test holds those to the same list, in its order
(D-081). The walkthrough, the CLI and the docs can't drift apart.

**As built in M2:**

- **The walkthrough is generated.** VSCode declares walkthrough steps in the
  extension's manifest, not at runtime, so `extension/scripts/generate.ts`
  writes them, and a page per step, from the step list. A test fails if the
  committed files are out of date.
- **Ticks stay ticked.** Once VSCode ticks a step, it stays ticked even if the
  check later fails. The status bar and **Check setup** always show the current
  state.
- **Checks are throttled.** Startup reuses machine results for 12 hours,
  from a folder with the same profile; a check that came back empty isn't
  kept. Project checks run only in folders with `.acc/config.json` or
  `sfdx-project.json`. The status bar stays hidden elsewhere, unless the
  machine needs something.
- **A full check replaces the rows it lists.** Each part it checked replaces
  that part's rows on the Setup page, so a step that no longer applies goes:
  A1.node once a folder turns generic. A part whose check failed keeps its
  rows, and a folder that isn't a project has no project rows. A Check of one
  step changes that row alone.
- **The extension runs its own copy of `acc`** with VSCode's runtime, so it
  works before Node is on PATH. Every VSCode terminal gets `acc` on its PATH.
  The extension runs `dist/bin/acc.mjs` itself; terminals, Setup's **Do it**
  and builders get the launcher beside it. Each time it starts, the extension
  writes its runtime's path to `~/.acc/runtime`, so the launcher can use it
  wherever node isn't on PATH (D-077).

## 15. Safety

- Agents work only in their own worktree, on their own branch.
- Agents can't push to an environment branch, merge, deploy, or touch the tracker.
- Nothing merges on its own unless a repo turns auto-merge on. Then autopilot
  merges only a reviewed pull request whose checks passed, that changes nothing
  under `.acc/`, into an environment that isn't protected, and never in a
  Salesforce project, one at a time through the merge queue, each with the full
  check on the commit that merges. Branch protection holds: it never uses `--admin`.
- Protected environments change only through a person's promotion pull request.
- Environment-specific files are never edited by a task, deployed or promoted.
- Every state change records who made it and why.
- Credentials never enter a repo: `GH_TOKEN` is passed per call, and the org
  logins stay in the `sf` keychain.
- Hooks do nothing in repos that haven't opted in.
- An agent's question is answered only from this machine's own windows, through
  files only you can read. With no window open, Claude Code asks as it always
  did, and a hook can never block a tool by failing.
- A cap on agents, plus a one-at-a-time semaphore for heavy checks.

## 16. Prerequisites

`acc doctor` checks each of these and says how to fix what's missing:

- git 2.40 or later
- Claude Code with `--bg` support
- `gh`, logged in as the configured account
- for Salesforce: Node 20 or later, `sf` and Code Analyzer, plus each
  environment's org logged in with its sandbox name matching its branch
- the config is valid, and the ledger directory can be written

acc runs on macOS only, on Apple Silicon or Intel (D-077). It needs no Node of
its own: its launcher falls back to VSCode's runtime (§13).

## 17. Testing

- **core:** a `node:test` unit test for every transition rule and for the lock.
- **CLI:** integration tests against throwaway git repos with real worktrees.
  Fake `claude`, `gh` and `sf` scripts on `PATH` record their calls and return
  fixtures.
- **Plugin:** `claude plugin validate --strict`, and each hook run against
  fixture payloads.
- **Extension:** the logic lives in core and is tested there. The UI is checked
  by hand at first.

## 18. Build order

Each milestone becomes GitHub Issues on this repo. The tool's own backlog is the
first thing it pulls in.

| Milestone | Delivers | Done when |
|---|---|---|
| M1 Core, CLI and onboarding checks | Ledger, config, state rules, lock, events. The onboarding step list. `init`, `add`, `import`, `list`, `ready`, `set`, `doctor`, `onboard` | Unit tests cover every rule. `acc doctor` passes on a fully set-up pilot repo and fails, with the right fix, on a fresh one |
| M2 Walkthrough | Extension skeleton plus the two walkthroughs, driven by the onboarding checks | A new project is onboarded from the walkthrough alone, and every step ticks itself |
| M3 Dispatch | Worktrees, setup, packet, background launch, session linking, `done`, `block`, `cleanup` | A real task runs end to end in this repo |
| M4 Gates | Gate runner, receipts, semaphore, the Salesforce gates, `drift` | `validate` passes against a sandbox from a worktree |
| M5 Review and land | Reviewer agent, verdicts, pull request, comments, `sync`, `deploy`, `promote` | A task goes from ticket to an open pull request |
| M6 Plugin | Manifest, `bin/acc`, hooks, skills, marketplace | `claude plugin validate --strict` passes, and the hook tests pass |
| M7 Extension views | Board, Sessions, Worktrees, status bar, notifications | Three tasks run at once, all watched from VSCode |
| M8 Pilots | This repo (generic), then a Salesforce client repo | One sprint of real tickets lands through it |

From M3 on, the remaining milestones are built by dispatching agents with what
already exists.

## 19. Left out of v1

- destructive Salesforce changes
- Slack as a ticket source (acc's notices can go to Slack: D-078 in
  DECISIONS.md)
- cloud sessions
- sharing a ledger across machines
- a Developer sandbox for each agent

## 20. Open questions

None right now. Answered on 2026-10-01:

- **Default autonomy:** `manual`, confirmed (D-014).
- **Promotion paths:** each project sets its own, every org is listed, and
  skipping a step is allowed but named (D-018).
- **The Salesforce pilot's tracker:** Jira. Its tickets move there from Azure
  DevOps first, so Azure DevOps intake isn't needed.
