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
