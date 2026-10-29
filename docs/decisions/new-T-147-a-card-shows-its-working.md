## D-T-147 A card shows it's working the moment you click, and a cleaned-up task leaves Done (2026-10-29)

T-147. The person: "clicking "Clean Up" on a finished task in "My Work" sat idle for a few seconds, presumably as
stuff loaded, and then eventually I got a modal confirming my decision. There needs to be an indication on the
ticket itself that we are loading [...] after confirming the clean up, the ticket still sat in the "Done" swim
lane, and clicking "Refresh" at the top of the tasks board didn't clear it."

**What took the time.** Nothing between the click and the question loads: the page's `run` message is resolved
from the hub's cached rows (`nodeFor`), and `cleanupTask` asked at once. The wait was the extension host being
busy. The Overview's tidy-up offer (`hub.tidy`, GH-104) asked git, with a synchronous `git merge-base` for every
finished task, on the first draw after each read of the ledger, and the ledger is read again whenever any acc
command writes it (every builder's progress, every Refresh, the cleanup itself). Measured on this repo's own
ledger (234 tasks, 227 done), with the real Hub under a stand-in for vscode: `hub.tidy()` after a ledger read
took 10,898 ms, the first Tasks draw 5,829 ms, and a click that arrived meanwhile waited behind it. Now
`hub.tidy()` after a ledger read takes 0 ms and the draw 2 to 13 ms, so the question opens as the click arrives:
`working.test.ts` times it at under 100 ms with a git that takes 150 ms an ask.

- **Git is asked in the background** (`extension/src/logic/in-environment.ts`). A draw reads what git has
  answered; a task not answered yet counts as not merged for now, and is asked about one process at a time,
  after the draw. Once a round is in, the page draws again. A yes is kept across reads of the ledger (merged
  work stays merged); a no is asked again after the next read. `inEnvironmentAsks` in core's `tidy.ts` is the
  one list of asks, which `branchInEnvironment` now runs too. The tidy-up offer can appear a moment later than
  before, once git has answered.
- **One working state for every action that waits on the extension** (`extension/webview/working.ts`). A
  card's next step, its ⋯ menu's items and a task page's buttons (on its tab and in the modal over the board)
  send through `press`: the button spins, says the action under way ("Cleaning up…", "Blocking…", else
  "Working…"), is `aria-busy` and `aria-disabled`, and a second press sends nothing. ⋯ spins and says which while
  one of its items works, and still opens. The button changes where it is, with no redraw, so it keeps focus
  and a sheet it opens gives focus back to it: a disabled button would drop focus, so it isn't `disabled`.
- **The extension answers every action** (`extension/src/logic/ran.ts`, `answerRun`). The Command Center's
  page and a task's page wrap each `run` and post `ran` messages: `asked` when a question opened, `running`
  after a yes, and `done` with the result: ok, refused with why, or `cleaned`. A command learns how far it has
  got through `say` on its node; one that says nothing is answered done when it returns, and one that throws is
  answered with why. A command the page can't run, and a task gone from the hub, are answered too, so no button
  is left working. `asked` puts the button back, as the question is now on screen; a cancel ends done and ok.
  Every task action that asks a question asks it through `asking` (`logic/ran.ts`), which says `asked` as it
  opens and `running` after an answer: Clean up, Block and Unblock's reason, Move's pick and its reason,
  Abandon's reason, Send to merge, Send a message, and Dispatch's two questions about others' files. Dispatch
  from its sheet carries no `say`, so those two say nothing there; the sheet's own opening answered the press.
- **Clean up asks first, then answers acc's result before the reload.** A removed worktree is answered with
  `cleaned`, and the card leaves Done at once, from that answer: the page moves it into the fold before any new
  model, and forgets the move once a model holds it there. A refusal ("Kept the worktree: …") stays on the card,
  in orange with its icon, until it's tried again, and the card stays in Done.
- **Done holds what's still to tidy** (`extension/src/model/done-fold.ts`, `extension/webview/done-fold.ts`).
  A finished task with a worktree is in the lane, and counted; the rest sit under a closed "Cleaned up (n)"
  fold at its foot, remembered open per project by the tab. The palette and the person filter still find them.
- **Refresh already read acc's record.** The Tasks tab's Refresh runs `acc.tasks.refresh`, which reads the
  ledger whatever its stamp says. The card stayed in Done because Done showed every finished task. A test now
  runs acc's own cleanup, as a terminal would, and checks Refresh takes the card into the fold.

Checked by `extension/test/working.test.ts` (11 tests) and `extension/test/working-page.test.ts` (5 tests), and
two behaviour cases in `extension/scripts/behaviour.ts`, with two mutants each caught: "the button shows
nothing while it waits" and "a cleaned-up task stays in Done". The screenshot run adds three pages: a card
cleaning up with the fold closed (`tasks-done-working`), a refused cleanup (`tasks-done-refused`), and the fold
open (`tasks-done-fold`).

Not changed: a reason left on a card stays until that action is tried again or the page is reloaded, and an
agent's own page (`activity.ts`) answers no `run`, as its Stop isn't one of these buttons.
