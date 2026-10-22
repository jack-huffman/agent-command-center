## D-092 In progress on the Overview: every job under way, a group a task; heavy checks wait in line (2026-10-07)

GH-76. The author: "Can we develop an 'In Progress' page that shows each of the
currently running jobs, their statuses and relevant info, grouped per task?"
With five builders and two heavy-check slots (D-080), what was happening was
spread over the Agents tab, the output panel, cards and notices.

- **A section on the Overview, right below Needs you,** as the author suggested,
  with no page of its own. Its heading counts the groups with something under
  way. The rail's Overview badge still counts only what needs you, so a task can
  be in both: a stopped builder is in Needs you with Resume, and here as a row.
  It folds to its heading, kept per tab, as Setup's sections are.
- **What counts as under way:** a task in Running, whatever its builder's state,
  and any job for a task: an analysis, a review, a resume, a check holding or
  waiting for a heavy-check slot, autopilot's step, a land or a refresh.
  Promotions and deploys belong to an environment (D-034, D-075), so, as the
  author chose, each has a group of its own, "Promote dev → qa" or "Deploy dev",
  among the tasks' groups. A promotion's group names the tasks in its source not
  yet in its destination, as far as the ledger says. Groups go busiest first,
  then the longest running.
- **Each row** has an icon and words for its state, how long it has run, and
  what it's doing. A builder shows its session's state (Working, Waiting on you,
  Idle, Stopped, D-067), its latest tool step as its page tells it (D-057), its
  model from its transcript, or its setting until it has answered, and its
  branch's commits and files since its environment's branch, with files not yet
  committed. Orange is only for what waits on a person, blue for what's working,
  neutral for idle, in line or done.
- **Each row's actions:** Watch, Open in Claude Code, Answer, which brings its
  question in Needs you into view, and Stop where acc can stop it. Each says
  what it does on hover, and Stop asks first. As the author chose, Stop pauses a
  builder with `claude stop`: its task stays Running and shows its agent stopped,
  with Resume. It also ends a resume, and a command this window started.
  Autopilot's step offers Turn autopilot off, in the window that runs it (D-064).
  A land, a check, and anything another window or a terminal started have no
  Stop: ending acc leaves its child running, and another window's run isn't this
  one's to end.
- **The machine line:** heavy checks in use and free, and how many wait, with who
  holds each slot and who's in line on hover; builders running out of
  `agents.max` for each repo, where projects sharing a ledger are one repo; and
  the load in words, from the last minute's load average per core: below 0.7
  calm, below 1.5 busy, more very busy. Where it reads 0, as on Windows, it says
  nothing rather than calm.
- **A heavy-check slot says what holds it.** Its owner file carries what it runs,
  its task, its project and its folder, or the environment for a deploy, a
  promotion's validation, a drift check or a baseline retrieve. `acc gate run`
  names its task (`ACC_TASK`, else its branch's task), and a refresh names its
  own. An older acc writes only its pid: the line calls it a check from an older
  acc, and it's in no group.
- **Heavy checks wait first come, first served,** as the author chose. A check
  that has to wait writes itself under `~/.acc/heavy/waiting/`, touches the file
  each poll, and takes a free slot only while fewer live waiters came before it
  than there are free slots. A waiter whose process has gone, or that hasn't
  touched its file for 15 seconds, loses its place. Until now, whichever check
  looked first after a slot freed took it. An older acc doesn't join the line,
  so it can still take a free slot ahead of it.
- **Jobs mark themselves under way:** a land, a refresh, a promotion, a deploy and
  autopilot's step each write `jobs/<key>.json` beside the ledger, with their pid
  and start, and remove it however they end. acc writes; every window reads
  (D-012), whichever window or terminal started the work. Autopilot's step stands
  for the land, refresh or review it runs: one row, not two.
- **Live:** a jobs poll beside the tasks poll, every 3 seconds on screen and 15
  hidden (D-044), of stats and small reads. A builder's transcript tail is read
  only when it has changed, and only on screen; branch counts run in the
  worktrees poll, which runs only on screen, for running tasks only. The page
  redraws when something changed, and every 15 seconds while anything is under
  way, so its times move on.
- **A job that ends** leaves a one-line done row, such as "Review finished:
  passed", which fades over a minute and goes. Its age is the extension's clock:
  the fade starts that far in, so a redraw never restarts it. Nothing ends on the
  first look after VSCode opens. A group with nothing left in it leaves.
- Not chosen: a page of its own; reading Claude Code's own job files (D-067);
  live output for a check, whose log is written when it ends; the reviewer's and
  analyst's models; changing `agents.max` or the heavy-check slots from here.
- The analysis had a refresh running its checks in a temporary worktree. It runs
  them in the task's own worktree, and names its task all the same. Its "merge"
  is autopilot's refresh (D-058) and, where a repo turns it on, autopilot's merge
  of a pull request (GH-67), each shown as autopilot's step.
