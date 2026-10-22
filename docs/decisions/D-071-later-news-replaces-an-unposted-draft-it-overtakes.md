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
