## D-110 Settings raises or lowers how many builders run at once, with what it means; this machine can cap every repo's together (2026-10-07)

GH-111, the third of GH-109's six tasks. The author asked to raise or lower how
many agents run at once from Settings, with what a change means, and chose
acc commands for each limit and check, so the page never writes a file
(D-064). It amends D-092, which left changing `agents.max` or the heavy-check
slots out of the Command Center: a terminal was the only place to set them.

- **Two caps, side by side,** each with −, its number, + and Change…, how many
  run now and where it's set. **This project's cap** is `agents.max` in
  `.acc/config.json`, shared with everyone on the repo once it's committed,
  set with `acc agents max <n>`; it names its project, and says when it's
  acc's default of three. **This machine's total** counts every repo on the
  machine, since usage limits belong to the Claude account, not a project. It's
  `agents` in `~/.acc/machine.json`, beside the heavy-check slots, set with
  `acc machine agents <n>` (1 to 64) or taken out with `--none`. Unset, there's
  no total. A − or + that can't move says why, and a machine with no total
  has neither: Change… sets one.
- **The machine counts every repo** from a note acc writes, the first time a
  repo dispatches, under `~/.acc/ledgers/`: a file naming its ledger. Its
  builders are its tasks in Running, as each project's cap counts them. A note
  whose ledger has gone is left out, and dropped only by acc's own commands (a
  start, and `acc machine agents`): the Command Center's read writes nothing
  (D-012). With no total, nothing else is read. The total is read and written
  through one path, `machineJson`; where acc's environment has no home (a
  test's made-up one), nothing machine-wide is read, and setting the total is
  refused rather than written under the real home.
- **A start that would pass either cap says which.** "3 builders are running in
  this project, and its cap is 3 (agents.max)", or "6 builders are running on
  this machine, across every repo, and its total is 6 (acc machine agents)".
  A held start (D-093) and autopilot's re-dispatch wait with those words, and
  a held task's card says "as many are running as the project allows", or "as
  this machine's total allows, across every repo". A person's own dispatch is
  refused with them, as it was at the project's cap: D-093 left holding a
  dispatch for the cap out, and this keeps it so.
- **What a change means, in this machine's numbers.** Each agent is a Claude
  Code session on your account, with the builders' model (Opus 5.5 unless
  set); more at once uses the plan's limits that many times faster, and at the
  limit Claude Code pauses them until it resets; on per-token billing each one
  costs as it runs, and recent reviews' and analyses' recorded `costUsd` say
  how much. Builders' checks wait for this machine's heavy-check slots, so
  those past the slots wait in line, and recent builders' times (dispatch to
  acc done, the middle of the last ten) say how long they take. More at once
  means more tasks touching the same files: they take turns (D-093), and
  conflicts at merge get likelier. With no numbers yet, each says so.
- **The heavy-check slots and each project's checks** are rows with Change…:
  `acc machine heavy-slots` (D-080), and `acc gate required [<name>…]` and
  `acc gate builder [<name>…|--none]` (D-096), both picked many at a time from
  the project's own checks. Slots that `ACC_HEAVY_SLOTS` sets stay in view,
  with why they can't change here. No required checks shows in orange. The
  required checks, like the cap, say when they're acc's default because the
  project's file names none.
- **Read only while it's seen.** The Command Center reads the limits only
  while Settings shows, or while a task is held and the project's own cap has
  room, never on another section's render: the author's machine feels
  background load.
- **One key, byte for byte.** Each project command edits only its key in
  `.acc/config.json` (`config-edit.ts`): the value replaced where it stands, or
  a new key put after its object's last, indented as the file is, and every
  edit read back against JSON.parse before it's written, else the file is
  written whole.
- **A person's, at all three layers.** The new commands, and `acc agents set`,
  refuse builders, reviewers and analysts by name in the CLI, and autopilot as
  not a person. The hook's PERSON_ONLY_ACC names `gate waive`, `gate required`
  and `gate builder` beside `agents` and `machine`. The builder's deny list
  gains `acc agents set*`, which it lacked, `acc agents max*`, `acc gate
  required*` and `acc gate builder*`; `acc machine*` was there. A test runs
  every such command through all three.
- **Every state has an icon and words:** blue while builders work, neutral
  when none do or the next start waits in line, orange for per-token billing
  and for no required checks. Light, Dark and Match VSCode drew the same
  colours on every Settings page the colour check reads, Limits and checks'
  other states among them (505 elements there, 4,663 on all eight pages).
- Not chosen: holding a person's dispatch for a cap (D-093's call stands); a
  per-clone cap, since a cap is shared, and the machine's total is the
  person's own; counting Claude Code's sessions for the total, which counts
  finished sessions and not a stopped builder, unlike the project's cap; a lock
  across repos, so two repos dispatching in the same instant can both pass a
  total by one.
