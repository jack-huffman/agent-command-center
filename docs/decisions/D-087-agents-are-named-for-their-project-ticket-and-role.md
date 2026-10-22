## D-087 Agents are named for their project, ticket and role (2026-10-06)

A builder's Claude Code session was named after its task's id alone (`GH-44`),
and reviewers and analysts had no name. With several builders in several repos
(D-080), that didn't say whose work it was (GH-77).

- **The name is `<project> · <key> <title> · <role>`** (the author chose it):
  `Acme Service · ACME-12 Case escalation rules · builder`. The project is
  `.acc/config.json`'s, the key the task's id, and the role `builder`, `review`
  or `analysis`. `sessionName()` in core's `names.ts` makes it, for dispatch,
  review and analyze alike.
- **Short:** the title, and the project as a guard, are cut at the last space
  that leaves 39 characters or fewer, with trailing punctuation dropped and `…`
  added, so each is at most 40. A single longer word is cut at 39. A title
  that's empty or cleans away leaves the key alone.
- **Safe to show anywhere:** only letters and digits of any language, spaces
  and `- _ . , : ( ) + #` stay. Whitespace, control characters, `/`, `\`, `~`
  and `·` become spaces, so a path falls apart into words and `·` only ever
  separates; everything else (`"'$!;|&<>*?` and backticks among them) is
  dropped. A word that looks like a token is dropped too: one starting `ghp_`,
  `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, `sk-`, `xox`, `AKIA` or `eyJ`,
  or one of 20 characters or more mixing letters and digits. An id that isn't
  one is cut to what an id holds. A false positive only shortens a name.
- **Builder N** (a person decided): the Nth dispatch of a task is `builder N`,
  and the first has no number. acc never runs two builders on one task at once,
  so the second is a rework or a re-dispatch after Abandon. A run recorded
  before names counts as the first. A resume keeps its run's name and number.
  Each review or analysis is a one-off, so it's never numbered.
- **What Claude Code does** (2.1.292, checked with throwaway `-p` sessions,
  and by reading the CLI for `--bg`, which won't start in an untrusted folder
  and can't be started from a builder's worktree):
  - `-p --name` names the session. `claude agents --json` lists it, as
    `interactive`, under exactly that name: 84 characters with `·` and `…`
    came back unchanged.
  - `-p --resume <id>` without `--name` lists the session under a name of its
    own (`probe-5e`); with `--name` it's the name given. So a resume, and
    D-060's reply, pass the run's name.
  - `--bg` makes its own session id: it warns "--bg manages the session id;
    ignoring --session-id". So a builder can't be found by an id acc chose.
- **acc never finds an agent by its name alone.** Dispatch records `name` and
  `n` on the task's run, and `--name` on the review and analysis puts the name
  in their running markers and in the verdict and analysis they write. The new
  background session is found by its name, in the folder it started in (or the
  worktree it may already have entered), started at most 5 s before the launch:
  two clones of a repo name a task's builder alike, and an older session of the
  same name is another run's. After that, `sessionsOf` (core) and `sessionFor`
  (extension), now one rule, find a task's agent by its background or session
  id; when neither was recorded, by a background session named as its run
  recorded; and for a run from before names, by one named the task's id, as
  before. A title changed later doesn't lose it, and a name worked out from the
  new title is never taken. builderStopped, resume and autopilot all use it.
- **The same name everywhere it shows.** `displayName()` gives the name acc
  recorded (the run's, the review's or the analysis's, by session) before
  Claude Code's, so a resumed session listed under another name still reads
  the same. It's used on the Agents tab, the agent page and its tab title, the
  Overview, the Stop prompt, and the terminals Attach and Watch open
  (`claude: <name>`); `acc dispatch` and `acc show` print it. The agent page
  names it once in its breadcrumb, linked to its task, with the task's title
  as the heading. The task page shows the builder's name under Agent, and a
  card's agent line shows it on hover. GH-76's In progress section is to use
  `displayName(session, row)` from extension/src/logic.ts.
- **Notices and Slack name the agent** (a person decided), which amends
  D-078's fixed words: a notice about an agent says its name in place of
  "GH-12's agent" ("… · builder is waiting for you in its own prompt.",
  "… · builder stopped: …"), and Slack's lines about one do too, escaped like
  the rest ("… · builder has a question for you."). A run from before names
  keeps the old words. Other notices name the task, as before.
- **The Agents table wraps a name** rather than clipping it, since the part
  that says what an agent works on comes last; the name takes the room left
  over, and Kind is dropped below 1100px rather than 800px.
- Open in Claude Code's "Its task stays Running" hint finds the task by its
  session, not by a session name that looks like a task id.
- **Accepted:** sessions already running keep their old names; nothing renames
  them. A `--bg` name of 90 characters wasn't tried live, only `-p`'s. Free-form
  agents from "New background agent" keep the name a person types; branches,
  worktree folders, packets and `ACC_ROLE`/`ACC_TASK` are unchanged. Question
  cards still say which task asks.
- Not chosen: finding a builder by a name worked out from its task (a title
  can change); `--bg --session-id` (ignored); numbering reviews; and clipping
  names in the Agents table.
