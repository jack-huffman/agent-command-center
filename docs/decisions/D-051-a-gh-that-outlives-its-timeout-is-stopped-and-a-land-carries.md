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
