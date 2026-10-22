## D-179 acc drafts a ticket's acceptance criteria, test steps and edge cases, and a person edits and posts them (2026-10-20)

T-81. Builds on D-032, D-052, D-066 and D-177. A TA adds detail to tickets:
acceptance criteria, test steps and edge cases. They started from nothing.

- **A read-only drafter.** `draftCriteria` (`packages/core/src/criteria.ts`)
  runs one agent as `acc review` runs its reviewer: `claude -p` with the
  reviewer's model and effort (`agentArgs(config.agents.reviewer)`), Read,
  Grep and Glob only, `dontAsk`, and `ACC_ROLE=reviewer`. Its prompt
  (`criteriaPrompt`) holds the ticket's description, each comment with its
  author and date, each related ticket, and the project's rules; it reads the
  repo itself. It answers to `CRITERIA_SCHEMA`: acceptance criteria, test
  steps, edge cases, and open questions for the ticket's author.
  `parseCriteria` refuses an answer with no criteria. acc writes the parts as
  Markdown under sub-headings (`criteriaMarkdown`), and keeps the draft with
  the task in `.git/acc/criteria/<id>.json`, with what it read.
- **It speaks plainly.** The prompt says the draft must pass `acc ste check`,
  with the STE Strict rules (`STE_STRICT`). acc checks the draft's Markdown
  as `acc ste check` does (`criteriaWording`). A draft with hard findings
  goes back once, in the same session (`--resume`), with each finding; acc
  keeps the fix unless it is worse, and keeps any finding that stays with the
  draft, which the page shows in orange.
- **Only a tracker task.** A task with no ticket is refused
  (`criteriaRefusal`): its sheet holds its brief.
- **`acc draft criteria <id> [--ticket <file>]`** drafts and keeps it, with
  `--json`. `--ticket` gives the ticket, its comments and related tickets as
  JSON (`parseCriteriaTicket`); the CLI reads no tracker itself, so without
  it the drafter has the task's description only, and the draft says the
  comments weren't read. `acc draft show <id>` reads it back. `acc draft
  update <id>` makes it an update draft (`criteriaUpdate`, a new `criteria`
  event, which Slack takes too). A builder, reviewer or analyst can't run
  either.
- **The person decides where it goes.** A tracker task's page has an
  Acceptance criteria draft section under its description
  (`ticketCriteria`): Draft acceptance criteria, then the draft, what it was
  drafted from, and two ways out. Add to the description opens the task
  sheet over that page with the draft below the description's text, under its
  own heading (`withCriteria`, `withSheetCriteria`); it is off with why where
  the sheet can't write the description (edits off, a tracker that can't
  take text, a description with content Markdown can't hold, or a task that
  can't be edited now). Open as an update asks acc for an update draft, which
  the page's Activity shows to edit and post. The sheet drafts too, where
  Save writes the description: Draft acceptance criteria puts the draft below
  what is written, and Add the draft adds the stored one. The extension reads
  the ticket through the project's tracker and hands it to acc in a file it
  removes after (`CriteriaDrafts`, `extension/src/logic/criteria.ts`); a read
  that fails leaves acc to draft from the description. Nothing reaches the
  tracker until the person saves the sheet or posts the update.
- Tests: `packages/core/test/criteria.test.ts` has 15: the prompt with the
  ticket, comments and related tickets, the parse and its failures, the
  Markdown, the read-only run with the reviewer's settings and no update
  drafted, the wording fix and what stays, the refusals, and the update draft.
  `packages/cli/test/draft.test.ts` has 4, with a fake claude: `--json` from a
  ticket file, the description alone, `acc draft update`, and the refusals.
  `extension/test/criteria.test.ts` has 16: the page's section, both ways
  out, the sheet's draft, the ticket file acc gets, the refusals, a fake
  tracker that records any write and gets none, and the names the page and
  the extension share. That is 35 tests. Two
  behaviour cases drive the sheet's draft and the page's buttons in a
  browser, and four mutants each fail one. The screenshot run adds two pages
  over ACME-19's tab: the sheet with the draft in its description, and the
  draft as an update. With 107 pages, the run's overlap floor rises from 18900 to
  19260 (30 controls a drawing).
- Not chosen: posting or saving the draft from acc; drafting for a task with
  no tracker; and reading a tracker from the CLI.
