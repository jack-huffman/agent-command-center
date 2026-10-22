## D-194 Tick several Jira epics, and choose a GitHub Project from its card (2026-10-22)

The person asked to tick epics, and for a GitHub repository's Projects to be cards. D-193 kept one epic a
Jira tracker and gave GitHub only its labels' cards; this changes both, and the preview follows each choice.

- **Several epics.** A Jira tracker's place is `epics`, a list of epics' keys (`Tracker.epics`). A file
  before this one names one as `epic`: parseConfig reads it as a list of one, and with both keys it reads
  each epic once. `epicKeys` writes one epic as `epic`, as before, so an older acc still reads it, and several
  as `epics`; the other key is null, so changing a tracker takes it out. The board asks Jira for
  `parent in (…)` of every epic, and their sub-tasks as before. Intake's place check (D-072) takes a ticket
  under any of them, or a sub-task of one, as inside; outside, it says "it isn't in epic ACME-3 or ACME-7".
  The place reads "epics ACME-3 Premium Support or ACME-7 Renewals", and the README links each epic.
- **The epic step ticks.** The Connect page's Jira list is now Epics (`epics`, `multi`): ticked cards, The
  whole project for none, as GitHub's labels are. The preview reads the board of the ticked set; each card's
  count is still its own epic's board. Starting a project from Setup says "from epics".
- **GitHub Projects as cards.** GitHub's Connect steps gain a Project list (`board`, before Labels):
  Issues, open and closed, then each of the repo's Projects with a Status field
  (`githubProjectOptions`, from `GithubClient.projects()` through gh), with its title, `#number` and item
  count, and "closed" on a closed one. A Project with no Status field has no columns to give, so it isn't
  offered. The repo's first open Project is the default, as the board takes it with no `board` set, so
  keeping it leaves `board` out; another sets `board` to its number. Its card reads no count: it says its
  own items.
- **No Project.** Issues, open and closed writes `board: "issues"` (`GITHUB_NO_PROJECT`): the board's
  columns are Open and Closed even where the repo has a Project, with no notice, and a task's card isn't
  moved on a Project (GH-146), so GitHub isn't asked. Before this there was no way to say it.
- **No access.** Where gh can't read Projects, the list is one card, Issues, open and closed, whose detail
  is `projectsAccess`, the words the Tasks tab's notice already used, now shared. Like the notice, it goes
  through `inProcessWords`, so the card says what to do, not a gh command line (D-132): every card's detail
  on the Connect page now does. The board can still be
  used, and once access is given, the board takes the repo's first Project.
- **Checked by** `packages/core/test/epics.test.ts` (several epics and an old one in the settings, how
  they're written, the board's query, intake's inside check, the README and place words),
  `packages/core/test/github-projects.test.ts` (the Projects list and its refusal, the cards, the board
  written, the preview of each, and `"issues"` in the settings), a case in `packages/core/test/cards.test.ts`
  (no Project: no card moved), `extension/test/connect.test.ts` (the Project cards in the session: the
  default chosen, another and no Project saved, the preview following each, and the access card), and
  `extension/test/choose-board.test.ts` (ticking a second epic reads the ticked set's board, and the
  GitHub shots' models). The behaviour case "connect: choosing a board…" ticks a second epic and checks
  both are sent. The shots `connect-jira-epics` (two epics ticked, and their board), `connect-github-board`
  and `connect-github-access` draw them.
