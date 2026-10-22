## D-T-102 Parallel work merges on its own: floors take the higher, pages and decisions are a line or a file each, numbered at merge (2026-10-22)

On 21 and 22 October nearly every merge of parallel work conflicted in the
same few files, though no two tasks disagreed: each branch only added a line.
Both raised the tests floor in `.acc/floors.json`. Each new screenshot page
bumped hand-set numbers in `RUN_FLOOR`, and was written into two lists of
pages. Every task appended to `docs/DECISIONS.md`, and the merger numbered
`D-???` by hand, twice also renumbering the rule text that says `D-???`. Now
those files merge on their own:

- **Floors.** `.gitattributes` names a merge driver for `.acc/floors.json`,
  `acc floors merge %O %A %B`, which keeps the better of each floor with the
  same logic autopilot's merges use (GH-99). A floor one side relaxed stays a
  conflict, with git's markers, for a person. Setup's step `B10.merge-floors`
  installs the driver in the clone's git config and says when it is missing. A
  clone without it conflicts as before.
- **Screenshot floors.** The overlap, tab and words floors only follow the
  number of pages, so the run works them out from `PAGES`: 30 controls and 100
  strings a drawing, and the selected tab on every drawing of a page with a
  rail. The other checks' floors are measured counts: they moved from
  `RUN_FLOOR` into `.acc/floors.json` as `screenshots.<check>`, and a clean whole
  run raises each to what it examined, only ever up, so they merge by the
  driver. A missing one is an error, never a floor of nothing. These floors
  equal what was measured, with nothing spare, so a change that removes a page,
  a control or some text needs a person: `acc gate relax screenshots.<check>
  --to <n> --reason "<why>"` relaxes one for one task, as it does the tests
  floor, with the same record (GH-130), and the run then passes at that count.
  The screenshots check fails unrun on a branch that lowers or drops one by
  hand. So does any check in `gates.commands` whose `<check>.<what>` floor is
  lowered.
- **Pages.** `PAGES` lives in `extension/scripts/pages.ts`, a page a line, in
  groups by section, and `.gitattributes` merges the file as a union of lines.
  The screenshot test checks the list (each page once, each with a sample whose
  model is right) instead of repeating it.
- **Decisions.** Each is `docs/decisions/D-NNN-<slug>.md`. A task branch adds
  `new-<task>-<slug>.md` and calls it `D-<task>`. The merge queue numbers a pull
  request's at its turn, land numbers them where a person merges the pull
  request, and `acc decisions number` does it for a merge a person makes: the
  next free number, the file renamed, and the id written over in the branch's
  own added and changed lines only. Two pull requests landed against one base
  before either merged take one number. On main at a person's merge commit,
  `acc decisions number` counts against the merge's first parent, main as it
  was, so the second's number, taken by the first, is numbered again. Until
  then the merged tree holds one number twice, and `acc decisions check` and the
  index's unit test fail on it. `docs/DECISIONS.md` is a generated index,
  checked by a unit test and `acc decisions check`, and merges as a union of
  rows. The split kept every decision's text exactly; a test compares each file
  with its section of the old file at the commit that split it. Only the blank
  line between two sections went, where there was one.
- **Raised floors go through autopilot.** Autopilot's merge leaves a change
  to `.acc/` to a person. A floors file whose every floor rose, or was added,
  with no new relax on it, is left out of that: the screenshot run writes one
  on most UI changes. Anything else under `.acc/`, or a floors file that
  lowers, drops or relaxes a floor, still waits for a person.

Union merges are kept to the two files whose lines are each a whole entry. A
union of two versions of one line, such as an import list, keeps both, so it
stays a conflict there.

Tests: core decisions 10, floors driver 5, stored floors 3, the gates' stored
floors 1, .acc/ changes 2, CLI merging 7, queue 3, land 2, geometry 2, pages 3,
the split and index 2, and the merge itself 1: two
branches from one base, each adding a page, raising the tests floor and adding
a decision, merged with real git with no conflict.
