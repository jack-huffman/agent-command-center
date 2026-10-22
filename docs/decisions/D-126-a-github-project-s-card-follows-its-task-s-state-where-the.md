## D-126 A GitHub Project's card follows its task's state, where the tracker says edits (2026-10-09)

GH-146. The author wants a GitHub repo's board to say where the work is, with
stages beyond Open and Closed (Todo, In Progress, Testing, Blocked, Done) from a
GitHub Project's Status field, without anyone dragging cards. acc already read a
Project's columns and could move a card by hand; now it moves the card itself as
the task changes state. It widens D-082's one change to a ticket, under the same
opt-in (D-066).

- **Only where the GitHub tracker says `"edits": true`,** the one that owns GH-
  keys, with a `github` account, and only for a task from one of its issues.
  Jira, Azure DevOps and monday.com are never moved: their status is the
  client's workflow.
- **The column is matched by name, ignoring case:** todo and ready go to Todo;
  running and rework to In Progress; review to Testing, or In Review where the
  Project has no Testing; blocked to Blocked; done to Done. The tracker's
  `statusFor` names a column per state (`{ "review": "QA" }`), and ready takes
  todo's when it names none. A named column the Project hasn't means no move,
  not the usual one: the person said which. A Project with no matching column,
  or an issue not on it, is left alone.
- **The Project is the board's:** the tracker's `board` number, else the repo's
  first open Project with a Status field, picked by the one `pickProject` the
  Tasks tab uses.
- **One write, the card's Status field,** with GraphQL's
  `updateProjectV2ItemFieldValue`, as the repo's account (D-007), after a read
  of where the card is; one already in its column isn't written.
- **On acc's own moves, after them.** The CLI notes each task's history before
  `acc set`, `done`, `block`, `dispatch`, `review`, `land`, `sync`,
  `intake github` and each autopilot pass, and afterwards follows the tasks
  whose history grew. A new task isn't a move. Reads move nothing: the
  Command Center's board and ticket reads, and `acc list` and `acc show`
  (D-012).
- **Once per state entered,** so a card a person drags on the Tasks tab stays
  where they put it: the drag moves the card as before, and acc doesn't move it
  again until the task changes state. Not chosen: a sync that put every card
  back in its state's column, which would fight each drag.
- **A failure never holds up the task.** The move has already been written;
  the card's outcome is kept on the task afterwards (`card`: the state, the
  column, when, and `failed` with gh's reason), as a `task.updated` event. The
  command that tried says it once on stderr, and `acc show` names it while the
  task stays in that state. It isn't retried: the next state change tries
  afresh. A card left alone writes nothing.
- **Checked:** `packages/core/test/cards.test.ts`, with a stand-in for gh's
  GraphQL: each state's column by name and in capitals, Testing before In
  Review, `statusFor` by name and ready's fallback, no matching column, an
  issue not on the Project and a named column it hasn't each make no write and
  leave the ledger alone, a failed write and a missing gh account leave the
  state moved and keep the failure, no `"edits"` or a task not from an issue
  calls no gh, and a GitHub board and ticket read write nothing;
  `statusFor` is checked, warned about off GitHub and written back.
  `packages/cli/test/cards.test.ts` runs acc with a gh on PATH: set, done,
  rework and block move the card one write each; list, show, status, ready and
  a sync that moves nothing call no gh and write nothing, and a dragged card
  stays put until the next move; a failed write is said once and shown by
  acc show; no `"edits"` asks gh nothing.

- **A first open before the checks finish waits for them (GH-149).** Until
  the window's first full check finishes, Setup has no machine results, most
  often in the first window after an upgrade, when GH-114's per-version cache
  makes the machine checks run again. A first open then waits for that check
  up to `FIRST_OPEN_WAIT_MS` (4 s), and lands where its results say. Still
  unfinished, it lands at **What kind of project is this?**, not **This
  machine**, so the one first open isn't spent on a machine that may well be
  ready; This machine's rows fill in when the check ends, and the status bar
  shows any step to do. A full check that got no machine rows, as when
  `acc doctor` fails and returns nothing, hasn't checked the machine either:
  it counts only when the check returned the machine's rows.
  `Setup.checked()` says whether one has, and `whenChecked()` waits for the
  first full check; `waitsForMachine` decides when to wait. Only a first open
  waits: one sent somewhere, a second open or a set-up folder opens at once.
  A click while it waits is that same first open, so a second click doesn't
  clear the jump to its part; something sent somewhere meanwhile, such as
  Connect a tracker, opens there, and the waiting open then leaves it be.
  `Setup.setUp()`, `isProject()` and `config()` now find `.acc/config.json`
  through one helper, `configFile()`. Checked in `first-open.test.ts`: the
  decision for an unchecked machine; the status bar menu's **Open the Command
  Center** and the launcher view becoming visible each land on Setup on a
  first open (the vscode stand-in now keeps a tree view's visibility
  listeners); and, through the built extension with an older version's ready
  results and a `claude` that answers after the wait, an early open opens no
  tab while it waits, a second click meanwhile shares it, and it lands at the
  question, jump and all, with the checks still running; with a `claude` that
  answers inside the wait, it lands at This machine, since `claude` fails; and
  with every `acc doctor` printing nothing, it lands at the question.

Note (D-126, 2026-10-09): a card acc couldn't move also shows on the Command Center's task page, as an
orange notice with the Project's icon beside "Checks failed on GitHub", in acc show's words, while the
task is still in the state the move was for.
