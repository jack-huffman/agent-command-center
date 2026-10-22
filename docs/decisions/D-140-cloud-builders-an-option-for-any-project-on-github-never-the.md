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
