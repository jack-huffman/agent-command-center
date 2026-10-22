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
