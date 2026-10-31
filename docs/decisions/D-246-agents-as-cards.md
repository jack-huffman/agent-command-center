## D-246 The Agents page shows each agent as a card, and says what it's doing (2026-10-30)

T-164. The person, with five builders running: the project was one grey block, the agents blended together, and
every one said "Working". This amends GH-119's table of task lines and agent lines, and works in the calm style of
D-216 to D-218: one level of borders, even spacing, each fact once.

- **Each agent is a card** (`extension/webview/agents.ts`, `agents.css`). A repo's name and count are a quiet
  heading on the page's own background, with no fill or band around the project. Under it, one card for each
  task's agent, in a list with even space between the cards and a thin border round each. The card's first line
  is the task's key and title, which opens its page. Its second line is what the agent is doing, its role with
  interactive or background as an icon, its model and how long it has run. The menu, with Answer, Watch and Open
  in Claude Code while it needs you, is on the card's right. Where shows under them, as before. A card that needs
  you has an orange left edge beside its bell and words. Other sessions and the Finished fold stay under the cards
  as cards. The table, its column headings and its narrow rule that hid Model are gone: a card's facts wrap.
- **What it's doing** (`extension/src/logic/doing.ts`). One table, `ACTIVITIES`, holds each activity's words and
  icon: Planning (`list-ordered`), Researching (`search`), Building (`tools`), Testing (`beaker`), Deploying
  (`rocket`), Committing (`git-commit`), Reviewing (`eye`), and Working (`sync~spin`) for a step the table does
  not know. All are blue; needing you stays orange, as before. A reviewer is Reviewing and an analyst is Planning
  by their role. A builder, or a session tied to no task, is what its newest step that the table knows says,
  looking back at most five steps (`RECENT_STEPS`): Read, Grep, Glob and the web tools, or a command that only
  reads, are Researching; Edit and Write are Building; `npm test`, `npm run check`, `node --test`,
  `sf apex run test`, `acc gate run` other than deploy, and a check-only deploy are Testing; `acc gate run deploy`,
  `acc deploy` and `sf project deploy start` are Deploying; `git commit` and `acc done` are Committing.
- **Where the steps come from.** `lastStepIn` (`extension/src/transcript.ts`) keeps a session's latest tool calls,
  newest first, beside its latest step. The hub reads them for each running builder, as before, and now also for
  every other session that is at work, only while the page is on screen.
- **The step behind it** is the activity's title and its `aria-description`, in process words (D-132): "Running
  the checks", "Editing force-app/main/default/classes/CaseTriggerHandler.cls", "Editing the design guide". The raw
  command stays in the extension.
- **The same words elsewhere.** The Agent panel on a task's page shows a running builder's activity beside
  Running (it hides a plain Working, which says the same). In progress shows it as its builder's state. The status
  bar's tooltip says it after each running task, "Running: ACME-13 (Deploying)". `Look` gains `tip` and `busy`,
  and a task row's agent carries them, so the page can tell a builder at work without matching words.
- **The screenshot run** draws the Agents pages with five busy agents in five activities (`SAMPLE_STEPS` in
  `extension/scripts/fixtures/agents.ts`), which adds one background session at work in side-project.
- **Checked by** `extension/test/doing.test.ts` (each activity and its icon, Working for a step the table doesn't
  know, Testing and not Working for a builder that runs the tests, the look back, the process words, the cards
  drawn with no table and no fill, the Agent panel and the status bar), `extension/test/looks.test.ts` (the
  table's states), and `extension/test/progress.test.ts` (the latest calls read from a transcript).
