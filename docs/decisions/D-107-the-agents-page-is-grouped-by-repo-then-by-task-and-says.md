## D-107 The Agents page is grouped by repo, then by task, and says nothing twice (2026-10-07)

GH-119, after GH-110 moved How agents run off the page. In a window with
another repo open, every session of this repo sat under "Elsewhere on this
machine"; each row named its project twice, in its name and in Where; Where
repeated the worktree the task's key implies and wrapped over five lines; Kind
took a column; and an empty project took a heading and a row. The author chose
to group the page by repo, then by task.

- **Repos, each a heading with its count:** this window's projects, in the
  window's order, then every other repo on the machine by name, then **Other
  folders** for sessions in no repo. Nothing is lumped into "Elsewhere". A
  session's repo is GH-83's folder rule (`sessionFolders`, D-090), which now
  says each folder's repo, its place in it, and its worktree: a project open
  here by its config's name, else its repo's folder, named as its label names
  it (`clients/Acme Service`). The heading's hover is the repo's folder.
- **"another window"**, with an icon, on a repo another window's Command Center
  shows. Each window already keeps a listener file of the folders it shows, for
  questions (D-030), fresh every 15 s; the hub reads the others' with each
  `claude agents` look. A window that shows the repo, or a folder or worktree
  in it, has it open; one showing a folder above it doesn't. A repo open in a
  window without acc's extension doesn't say so.
- **One line per task, its agents beneath it.** The task's key and title head
  it, opening its page where its project is open here; a task elsewhere has no
  page here, so its line opens nothing. Its title comes from the task row, else
  from its repo's ledger: `SessionTie` now carries the task's `title` and a
  builder run's count `n`. Each agent's line is its role, as D-087 names it
  (builder, builder 2, review, analysis; a count the run didn't record is read
  from the name acc gave it), an icon for interactive or background with its
  word on hover, its state with an icon and a label, its model, how long it has
  run (`27 min`, with when it started on hover), and its menu. Sessions tied to
  no task go under **Other sessions**, by their own names; that line shows only
  beside tasks, since alone the repo's heading says enough.
- **Nothing said twice.** A line names neither its repo nor its task. Where
  shows only when an agent isn't in its task's own worktree: `main checkout`,
  a folder in the repo, or, inside its worktree, just that folder
  (`force-app`). A session tied to no task shows where it is in its repo; one
  named for its folder, as Claude Code names some, shows no Where. Folder or
  Full path still switches it (D-090), and the toggle shows only while some
  line has a Where. An agent's hover has its whole name, its model and its
  whole folder. Kind is no longer a column.
- **Needs you first.** Within a repo, tasks with an agent that needs you come
  first, then the rest by their newest agent, then Other sessions, unless one
  of those needs you; within a task, the same. A line that needs you has
  **Answer** while its question waits in the Command Center, **Watch**, and
  **Open in Claude Code** (Attach for a background session with no session id).
  Answer goes to the Overview and brings its question's card into view, as In
  progress's does (GH-76). Below 1280 px Watch and Open in Claude Code show
  their icons only, and below 660 px Answer too, each named on hover and to a
  screen reader.
- **Finished sessions fold** into one **Finished (N)** line under each repo,
  closed unless opened, remembered per tab like other folds. Its lines name
  their task, key and title, and role, since no task line heads them, and say
  no state: the fold's heading does. **Stop all** stops that repo's finished
  background sessions: `acc.agents.stopFinished` takes the repo's folder and
  filters D-095's plan by the same folder rule, with the same one dialog.
- **A repo with no agents is one quiet line:** "Acme Portal · no agents right
  now". With no sessions at all the page says so once, as before.
- **The header** keeps Settings, **Stop finished (N)** (shorter than "Stop
  finished sessions") and Start a background agent. Its summary counts every
  session, and how many are working, need you, and are finished: "23 sessions:
  4 working, 5 need you, 5 finished."
- **Layout:** one table for the page, so the columns line up down every repo.
  States stay on one line above 660 px and wrap to two below. Below 560 px the
  Model column goes, its model on the agent's hover. A finished line's title
  and a long session name are clamped, never `nowrap`: a `nowrap` title was
  the cell's least width, which widened the table until the sticky row menu
  covered Running. Task titles and Where take two lines at most, with their
  whole text on hover.
- **Checked:** `agents.test.ts` groups a busy machine: this window's projects
  first, the empty one too, a repo another window has open and one it
  doesn't, Other folders, a task's builder and review together, builder 2, an
  untied session, needs you first, a finished one folded with Stop all, Where
  only off a task's own worktree, and the repo the page and Stop all agree on.
  Core's tie test checks the title and count. Screenshots `agents` (two
  projects here, one empty; a repo in another window with a task whose builder
  and reviewer are both listed; an analyst in the main checkout; Other
  folders), `agents-finished` (each repo's Finished open), `agents-path` and
  `agents-billing`, at 1000, 620 and 500 px in Light and Dark; `--colours`
  finds no difference across themes on `agents` and `agents-finished` (1434
  elements).
- Not chosen: Other sessions always last, which would put an untied session
  that needs you below every task; a Where column, mostly empty once a line in
  its own worktree says nothing; telling a repo elsewhere apart from a project
  here of the same name, which D-090's rule doesn't compare.
