## D-128 A task's builder effort is picked like its model, and Haiku 5.5 replaces Haiku 4.5 (2026-10-09)

The author asked that each agent's model and effort follow the task at hand (GH-156), citing Anthropic's
guides on choosing a model and on effort. acc took a model per task (D-086), but effort only per clone or
project (D-036), though the guide calls effort often a better lever than the model, and its advice depends
on the model: Opus 5.5 defaults to medium, with xhigh for long agentic coding; Sonnet 5.5 suits medium for
well-specified agentic work and high for harder or longer; Fable 5.1 starts at high. D-086 had left "a
per-task effort" out; this adds it.

- **`acc dispatch <id> --effort <low|medium|high|xhigh|max>`** picks the builder's effort for this task.
  It's kept as the model is: `run.effort` and `run.effortPicked`, and `held.effort` while a dispatched
  task waits for others' files (D-093), so a re-dispatch, by a person or autopilot, a held start, a resume
  and the reply to its builder (D-060) use it until another is picked. Without one, the clone's or the
  project's effort applies, as before; with none set, `--effort` is left out and the model's own default
  applies. The run records the effort it started or resumed with, when one was named.
- **A pick can be cleared.** `acc dispatch <id> --effort default` drops the task's pick (`held.effort`
  keeps `default` while it waits), so the builder's own applies again. A model picked now that doesn't
  take the task's earlier pick drops it rather than refusing, and says so (`effortDroppedWords`, the
  outcome's `effortDropped`): without that, a person who picked Claude Haiku 4.5 through Another model…
  was refused with "leave effort unset", which nothing let them do.
- **A level the model doesn't take is refused before anything starts,** on every dispatch, re-dispatch,
  held start, resume and reply, not only one that picks a model or an effort: the pair the builder would
  get is checked wherever each is set, so a task's pick meeting a clone's model changed since is refused
  in acc's words, not inside Claude Code. The refusal names the levels the model takes, where the effort
  is set and how to change it (`effortFixWords`: the task's pick, or the builder's own in acc agents),
  and where acc's list came from and when. A resume and a reply check before any session is stopped.
  `acc agents set` refuses a name that isn't a level in the same words (`checkEffortName`).
- **acc's list of each model's levels is copied in,** not fetched (D-098): `MODEL_EFFORTS` in core's
  `efforts.ts`, from https://platform.claude.com/docs/en/build-with-claude/effort, read 2026-10-09
  (`EFFORT_SOURCE`). Not every model that takes `max` takes `xhigh` (Claude Opus 4.6, Sonnet 4.6 and Mythos
  Preview don't), Claude Opus 4.5 takes up to high, and Claude Haiku 4.5 takes none. Opus 5.5's and Haiku
  5.5's default is medium, the rest's high. A name is matched without a date or a context suffix; a model
  the list doesn't name, such as an alias, isn't checked: Claude Code decides. A newer model is an acc
  release, as a newer default model is (D-086).
- **Dispatch with… (Re-dispatch with… on a rework) asks for the effort after the model,** offering only
  the levels that model takes, and skipping the step for one that takes none, which drops a pick and
  says so. The task's pick comes first, when the model takes it, then the builder's own (this clone,
  project default, or Claude Code's default, named by the model's default level), each saying where
  it's set in the model choice's words (`FROM_WORDS`); after a pick, the builder's own says it drops
  it, and does (`--effort default`). The builder's own is left out when the model doesn't take it, since
  acc dispatch would refuse it. Each other level follows with its words (`EFFORT_WORDS`, which How
  agents run's Change… uses too), and the model's default says so. Choosing the effort it runs with
  anyway, on a task with none picked before, adds no `--effort`, so the task goes on following the
  settings.
- **The task page's Model and the Agents line show the effort** beside the model, only when one was
  named and isn't the model's default: `claude-sonnet-5-5 · xhigh effort`, `sonnet-5-5 · xhigh`. A review
  or an analysis runs with the reviewer's profile (D-052), so shows none.
- **Claude Haiku 5.5 (`claude-haiku-5-5`) replaces Claude Haiku 4.5 in the model choices** (Dispatch
  with… and Change…). A clone or project that names `claude-haiku-4-5-20251001` still runs with it, and
  How agents run says it's an older model and which replaced it (`OLDER_MODELS`).
- **Checked:** core's `efforts.test.ts` (the list's source, order and defaults; the refusal; which effort
  a builder gets); `dispatch.test.ts` (`--effort` reaches `claude --bg` over the clone's and the
  project's, a rework and a held start keep it, one nobody picked follows the clone's, a level the
  model doesn't take, or no level at all, is refused before a worktree is made, `--effort default` and a
  model that doesn't take the pick drop it, on a run and on a hold, and a re-dispatch naming neither is
  refused when the clone's model changed under the pick); `resume.test.ts` (a resume keeps a picked
  effort, records the clone's otherwise, and a resume or reply whose pick meets a changed model is
  refused before its session is stopped); the extension's `efforts.test.ts` (the picker's items, their
  words and order, the way back to the builder's own, its arguments, the skipped step's drop, and when a
  page shows an effort) and
  `settings.test.ts` (Haiku 4.5 is an older model). The screenshot fixtures' ACME-12 runs Sonnet 5.5 at
  xhigh, picked for it.
- Not chosen: picking an effort from the analysis's size, as D-086 declined for the model; a per-task
  fallback model; asking the guide at run time; dropping a pick that meets a clone's or project's model
  changed since, which a person didn't ask for, rather than refusing it; checking the pair in acc agents
  set, where no task's model is known.

Note (D-168, 2026-10-16): the effort is no longer a second picker. Dispatch's sheet shows the levels the
chosen model takes as a segmented control, lowest first, the one it runs with chosen and the picker's words
under it; a model that takes none hides it and says so, with the pick it drops. `dispatchEffortItems`,
`dispatchEffortArgs` and `noEffortArgs` are unchanged: the sheet's choice goes through them.

Note (D-127, 2026-10-09): tables are raised panels too, so Agents, Worktrees and the rest match the
Overview and Tasks. A `.grid` table's wrapper takes the raised surface, edge and lift; its column headings
are a band in a well, and Agents' repo headings are the same band, so each repo reads as a section. Sticky
action cells take the table's colour, not the page's. Environments' promotion paths sit in a panel of
their own, their branches in wells.

Note (D-127, 2026-10-09): a task's own page matches. The main column's sections (Description, Related,
the builder's note, Activity) are raised panels like the Details and Agent panels beside them, and an
analysis takes the same lift.
