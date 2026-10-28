## D-T-131 You see the plan being made as it happens (2026-10-27)

T-131. The person said that making a plan takes a while, and while it's made they're in the dark about what's
happening. The conversation panel and the task page said only that a plan was being made; Watch the plan being made
opened the analyst's whole session on another page.

- **Where it shows.** While a plan is made (Make a plan, Draft the plan, Skip to the plan) or a reply comes in the
  conversation, the conversation panel and the task page's plan section show a progress card: its state (Working,
  blue, or Not moving, orange), what it's for (Making the plan, or Writing its reply), the time so far, the step now
  in plain words, up to four steps before it, newest first, each with how long ago it began, how long since its last
  step, and, for a plan, how long plans usually take in this project. The modal over the Tasks board shows it too,
  as it shows the task page. `extension/webview/plan-progress.ts` draws it; `extension/src/model/plan-progress.ts`
  says what it says.
- **Where it comes from.** The planning agent's own session transcript, which `packages/core/src/transcript.ts`
  finds. A plan's session is in its running marker, as before. A reply's marker now names its session too
  (`Talking.sessionId`, written by `talkPlan` and `startPlan`); a marker an older acc wrote has none, so that reply
  shows its time and no steps. `extension/src/logic/plan-progress.ts` reads the transcript from where the last read
  ended, at most 512 KB at a time, so a resumed session's earlier turns are passed over in a few reads, and only the
  records from when the job began are its steps. A line cut in two waits for its end. A transcript not found yet is
  looked for again after five seconds, since finding it may read every project's folder.
- **Only while on show.** `PlanWatch.tick` runs about once a second (`TICK_MS`) and reads only the tasks whose panel,
  page or modal is on show; with none on show it reads nothing. The new progress goes to the page as a message, and
  the card is drawn again in place, so the box being typed in and the page's scroll stay where they are.
- **Plain words.** Each tool use maps to words: reading a file (its path in the repo), searching the code for
  something, looking for files, reading or searching the web, writing the plan or its reply (the tool Claude Code
  writes a JSON answer with), asking a helper agent, and using a tool for one this doesn't know. A command is never
  shown as its line: each of the analyst's reads (`ANALYST_COMMANDS`) has its own words ("Reading the project's
  history", "Querying the org's records"), one of acc's own is its process (D-132), and anything else is "Running a
  command". What the agent wrote, a path or a search, is work data (`work(…, 'transcript')`), so the words check
  leaves it alone. A path outside the repo shows its file name only.
- **Before the agent starts.** While the Command Center reads the ticket (T-110), the step is "Reading the ticket,
  its comments too", and the time counts from Draft the plan. Before its first tool use, a plan's step is "Reading
  the ticket" and a reply's "Reading your message".
- **A stall at five minutes** (`STALL_MS`). With no new record in the transcript for five minutes, the card turns
  orange and says "The planning agent hasn't moved for 5 minutes.", with Watch its session, and Stop. Five, because
  Claude Code writes a turn to its transcript once the turn is whole: the longest quiet spells that are fine are the
  plan itself, written in one turn, which takes a few minutes on a large ticket, and a Salesforce retrieve. Five
  minutes clears both and still shows a stall well inside the 20 minutes a reply and the 45 a plan may take. With no
  transcript found, nothing says it stalled.
- **Stop only where it works.** Stop is offered only when this window started the run (the output panel's run of
  `analyze`, `plan talk` or `plan start` for the task), and it asks `acc.job.stop`, which asks the person first, as In
  progress's Stop does. A plan or reply another window or a terminal started has no Stop here. Watch its session is
  offered once there's a session to open.
- **The typical time.** acc records each plan's duration as it ends (`recordPlanTime`, beside the plans, the last 20
  kept, written whole). Once a project has three (`PLAN_TIMES_MIN`), the card says "Plans here usually take about 4
  minutes", from the middle duration, so one slow plan doesn't pull it; with fewer it says nothing. A reply shows none.
- **Checked by** `extension/test/plan-progress.test.ts` (the mapping for each tool kind, an unknown tool, a
  half-written last line, an empty transcript, the time so far and since the last step, the stall at its threshold,
  the typical time, reads only while on show, Stop and Watch, the card drawn in place),
  `packages/core/test/plan-times.test.ts`, and the screenshot run's `conversation-progress`,
  `conversation-stalled` and `ticket-progress` pages.
