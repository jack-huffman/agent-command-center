## D-T-148 A task's acceptance criteria pass the wording check before acc adds or edits it (2026-10-29)

T-148. The person confirmed that every requirement is written in Simplified Technical English (T-12,
`packages/core/src/ste.ts`), and asked for a check on the briefs a person or an agent writes. Before this, the
check held drafted acceptance criteria (D-179), the requirement lines a plan reads back, and an agent's notes
(D-230), but not `acc add` or `acc edit`: three tasks added on 2026-10-29 had 12 hard findings in their criteria
between them.

- **The check** (`packages/core/src/brief-wording.ts`): `briefCriteria` reads the list items under each
  "Acceptance criteria" heading, at any level, until a heading of the same or a higher level. An item may have a
  box (`- [ ]`, `- [x]`) or none, and may be numbered. A line indented under an item goes on with it. Lines in a
  code fence don't count. The heading's words are `CRITERIA_TITLE`, which drafted criteria use too
  (`CRITERIA_PARTS.criteria`). `briefWording` runs `steLint` on each criterion on its own, as a list item, with
  its API names in backticks first (`codeNames`, as D-230 does). So a dangling "and" is caught, a synonym in one
  criterion never counts against another, and code is left alone.
- **A hard finding stops the command, and acc writes nothing.** `refuseBriefWording` throws `refused` with the
  count and each hard finding: its line in the brief, its criterion, its rule and its fix (the check's own
  message), and what it matched. `acc add` runs it before it opens the ledger. `editTask` runs it on a new brief
  after its other checks, inside the ledger's lock but before it changes the task, so the refused edit writes no
  field, not even the others it was given. An edit that leaves the brief alone isn't checked, so a brief
  written before this check stays editable.
- **Advice goes on.** The advisory findings (passive voice, a compound tense) come back from the check. `acc add`
  and `acc edit` print them dimmed under "Advice on the wording of the acceptance criteria", and give them as
  `advice` in `--json`. They never stop the command.
- **A tracker's ticket is never refused.** Intake and `acc import` don't run the check. A tracker's ticket owns
  its brief (T-74), so `editTask` refuses an edit to it before the wording check is reached. Its plan shows the
  findings on the criteria it reads back, as advice, as before (T-12).
- **The task sheet shows each finding beside its criterion before Save** (`extension/src/model/sheet-wording.ts`).
  A new task's sheet and acc's own task's open with `wording`: each criterion with a finding, with its number,
  its line, its text, and each finding's rule in words (`STE_RULE_WORDS`) and fix. A tracker's sheet has none.
  As the person writes, the page waits 250 ms after a key, then sends `task-sheet-wording` with the description.
  The Command Center and a task's own tab answer with the same check acc runs (`wordingReply`). The page takes an
  answer only for the text in the box now, and draws the findings in place, so the box keeps its focus. A fix is
  orange with its warning icon, and advice is blue with its info icon. The list is read out as it changes
  (`aria-live`). While the last answer has a hard finding, Save is off with "Fix the wording of the acceptance
  criteria first: N findings" (`wordingOff`). Before an answer comes back for new text, Save goes by the last
  one, and `acc add` or `acc edit` still refuses a brief that fails.
- **Not covered:** a manual task added through `acc import`. It is a person's or an agent's text, but import
  reports each task's errors on its own and isn't named here.
- **Checked by** `packages/core/test/brief-wording.test.ts` (13: the criteria and their lines, briefs with none,
  a pass, each hard rule with its line and fix, the refusal's words, advice let through, code and each criterion
  on its own, an edit refused with nothing written, a tracker's ticket never refused and its plan's findings, and
  two mutants caught: one skips the check in `editTask`, one finds and still lets the brief through),
  `packages/cli/test/brief-wording.test.ts` (6: a pass, `acc add` refused with each line, rule and fix and nothing
  written, advice from `acc add` and `acc edit`, `acc edit` refused with no field written, code and no criteria,
  and a tracker's ticket imported and edited), `extension/test/sheet-wording.test.ts` (6: the findings beside
  each criterion, Save off, none to show, which sheets are checked, the answer, and the page's message checked),
  `extension/test/task-sheet-open.test.ts` (2: the answer over the Command Center and a task's tab, and the
  sheet's Add task refused by `acc add`), and a behaviour case in `extension/scripts/behaviour.ts` with four
  mutants of its own (Save with a finding to fix, no second check, an answer for older text taken, no findings
  drawn). The screenshot run draws the sheet with a fix and a piece of advice (`task-sheet-wording`).
