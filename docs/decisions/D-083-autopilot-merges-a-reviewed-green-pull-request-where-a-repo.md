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
