## D-240 A modal opens the moment you click, loading, and a task's page draws from its record first (2026-10-30)

T-162. The person, on the Overview's Needs you list: "clicking one of these links has a long delay of several
seconds before I see the popup for the task. We need a loading animation for opening a modal so we know the
extension is responding to our input, otherwise it looks like a broken button or link."

**Where the seconds went.** The page sent `task-modal-open` and drew nothing until the extension replied with
`task-modal`, and the extension replied only once `post` had built the whole model. Measured with the built
extension under the vscode stand-in, on a copy of this repo with a copy of its own ledger (247 tasks, six in
flight), from the message to the first `task-modal` reply. Each draw read the tracker's client, the branch's
changes (git, about 0.3 s), the checks' receipts (up to 1 s), the review, and the team (`teamOf`, synchronous
git): the team took 29 to 38 s for GH-69, whose branch is many merges behind, and blocked the extension host
while it ran. Each page redraw read it again, so draws queued behind one another. The tracker itself was a
stand-in that fails at once, so these times leave out GitHub's own answer.

| Task | Before: first model | Before: full | After: first model | After: full | After, opened again |
|---|---|---|---|---|---|
| T-155 (in flight, acc's own) | 3,258 ms | 3,258 ms | 52 ms | 1,483 ms | 1 ms first, 229 ms full |
| GH-69 (blocked, GitHub) | 112,527 ms | 172,314 ms | 585 ms | 24,856 ms | 5 ms first, 492 ms full |

- **The modal opens at the click** (`extension/webview/task-modal.ts`). The page hears every message it sends
  (`onSent` in `state.ts`), so whatever sends `task-modal-open` (a line on the Overview or its button, a card, the
  palette, a blocked task's line with its note, a Since you last looked line) opens the modal at once, with the task's key and the title the line or card
  showed (the message's new optional `title`), and a loading state. Open as tab is off until the model says what
  it sends. Close and Escape work while it loads, and tell the extension. A model for a task the modal no longer
  waits for, because it closed or another opened, opens nothing.
- **One shared part** (`extension/webview/loading.ts`): a turning ring and words in a `role=status` box, read out
  once, with the body `aria-busy`; `Opening` keeps one modal's wait. A load that fails says what and why in a
  `role=alert` box, in orange with its icon, with Try again; one that nothing answers in 20 s
  (`LOAD_LIMIT_MS`) fails the same way, so no spinner is left turning.
- **The other modals that open after a wait** use it too: the dispatch sheet on Build it (`OPENS_SHEET`, the
  extension's `SHEET_COMMANDS` copied), which also says a refusal from the extension's `ran` answer and closes if
  the extension finished with no sheet; the deploy sheet on Deploy; Connect a tracker (`acc.trackers.add`); and Set
  up cloud builders (`acc.cloud.setup`). A tracker or cloud page that comes after its loading modal closed is
  cancelled, not shown. The button that sent the action keeps T-147's working state (D-229).
- **The extension answers a failure** (`task-modal-failed`, `MODAL_FAILED`): for a project that isn't open
  (`NO_PROJECT`), and for a load that throws.
- **The first model comes from the record alone** (`extension/src/ticket.ts`, `load` and `post(o, first)`): no
  git, tracker client, sign-in or org is asked, and the model says `filling`, which the page shows as one line
  ("Reading its checks, its branch and its team…"). The extension then yields, so the first model goes before any
  synchronous git starts, and draws the full model; a tracker's ticket is read while it does.
- **A task's team is kept** until a branch head or a task in flight changes (`teamKey`,
  `extension/src/logic/team-key.ts`), so a second open, a tab, or a redraw doesn't read it again.

Checked by `extension/test/modal-loading.test.ts` (12 tests), two new tests in `extension/test/task-modal.test.ts`, and
three behaviour cases in `extension/scripts/behaviour.ts` with two mutants: "the task modal waits for the model
before it opens" (caught by all three) and "a model after the modal closed opens it again". The screenshot run
adds `tasks-modal-loading`, `tasks-modal-failed` and `ticket-filling`.

Not changed: the first read of a team many merges behind still holds the extension host for its git (25 s for
GH-69 here) after the first model has gone. `teamOf` in core runs git synchronously; reading it in the background
is a change to core of its own.
