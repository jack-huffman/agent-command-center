## D-178 A Jira tracker follows the active sprint or one named sprint, and the Overview says when the sprint changes (2026-10-20)

T-78. Builds on D-072 and D-164. A Jira tracker read its board's whole
contents, so on a scrum board the Tasks tab showed the backlog and every
sprint together. A person who works a sprint wants that sprint's tickets.

- **The place takes `sprint`.** A Jira tracker's `sprint` is `"active"`, for
  the board's open sprints whichever they are now, or a sprint's id. It works
  alone or with `epic`, and unset it's the whole board. The config check
  refuses a `sprint` on a tracker that isn't Jira, unlike the other place keys
  (which warn and are ignored), and a value that is neither (`sprintProblem`).
  Azure DevOps iterations aren't these.
- **Every read stays inside it.** `JiraClient.placeJql` adds `sprint =
  <id>`, or for the active sprint `sprint in (<the board's open sprint ids>)`
  once the board has said which (`openSprints()` before then), so another
  board's active sprint never counts. An epic's sub-task query carries it too.
  A ticket in the project and epic but not the sprint is outside the place:
  its page says "it isn't in the active sprint", and it can't be tracked.
  With `project` only (posting a draft), the sprint doesn't count, as the epic
  doesn't.
- **The board says which sprint.** The place line names it and its dates:
  "Jira · ACME · active sprint ACME Sprint 13 (20 Oct to 2 Nov)", or "sprint
  …" for a named one (`sprintPlace`, `sprintDates`). Following the active sprint with none open, the board asks
  Jira for no issues, shows no cards, and its notice says there is no active
  sprint (`NO_ACTIVE_SPRINT`). A named sprint Jira doesn't have says so.
- **Connect picks it.** After the board, a Sprint list: The whole board, The
  active sprint (with the one open now, or "none open now"), then the board's
  open and future sprints with their dates (`jiraSprints`,
  `jiraSprintOptions`). A kanban board, which Jira refuses sprints for, offers
  only the whole board. Picking another board reloads the list, and Save
  waits for it. An existing tracker opens at its sprint; the whole board takes
  `sprint` out.
- **When the sprint changes.** After a Jira board in a sprint loads, the
  Command Center compares it with the last sprint acc kept for that tracker
  (`sprints.json` beside the ledger, by site, project and board:
  `sprintTracker`). When the sprint or its open tickets changed, it hands the
  new one to `acc intake jira --file` in `sprint`, which acc keeps
  (`rememberSprint`, written whole). When the sprint itself changed, it asks
  Jira which of the old sprint's open tickets the board no longer shows aren't
  done (`stillOpen`): those went back to the backlog, and the ones still on the
  board were carried. A ticket done in time counts as neither, and one Jira
  couldn't read isn't counted. Tickets that left the sprint are outside the
  place, so they go through D-072's path in the same intake: a task that
  never started leaves the board, and a started one stays.
- **Said once, on the Overview.** Since you last looked (D-164) gets a line,
  "ACME Sprint 13 started after ACME Sprint 12: 4 tickets carried into it, 2
  went back to the backlog. ACME-18 left the sprint after work started, so it
  stays on the agent board." (`sprintNotice`, `sprintLine`). Its kind is
  `sprint`, Sprint changed with a milestone icon in blue, and with no task the
  line opens the Tasks tab. It joins the list whether or not the person is away
  (`Away.note`), and is never a notification. acc keeping the new sprint makes
  it once; a window that loads the board twice at once tells it once too. A
  first look, the same sprint, or a board not in a sprint says nothing. The
  board's warning for started tasks names what they left: "Moved out of the
  active sprint after work started", never the sprint open now; "sprint ACME
  Sprint 12" for a named one; "epic ACME-3 or sprint 42" with both.
- **Checked.** `packages/core/test/trackers.test.ts` adds 5: the JQL for the
  active sprint, a named sprint and a sprint with an epic; a board in the
  active sprint and its place line; a board with no active sprint, which gives
  the notice and no cards; a ticket outside the sprint and `stillOpen`; and
  Connect's list, with a kanban board's none. `config.test.ts` adds 1: each
  wrong value and each tracker that isn't Jira. `packages/core/test/sprints.test.ts`
  has 4: the kept sprint and a broken file, the change's counts and words, the
  change through intake where a started task stays and is named, and the place
  words. `connect.test.ts` adds 1, `packages/cli/test/tasks.test.ts` 1 (acc
  intake keeps the sprint, and refuses one in the wrong shape or for Azure
  DevOps), `extension/test/sprint-change.test.ts` has 2, and `moved-out.test.ts`
  and `away.test.ts` add 1 each. The screenshot run adds two pages:
  `connect-sprint`, Connect's Sprint list with the active sprint picked, and
  `tasks-sprint`, a board in a sprint with a started task that left it. Since
  you last looked's sample has a sprint line. The two pages raise the geometry
  run's floor for the selected tab from 486 to 498 drawings.
- Not chosen: Azure DevOps iterations; moving a ticket between sprints from
  acc; a notification for the change, which Since you last looked holds; and
  several named sprints, which the active sprint covers when a board runs them
  side by side.
