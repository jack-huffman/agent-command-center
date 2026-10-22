## D-132 The Command Center speaks in processes, not commands (2026-10-09)

The Command Center talked to people in its own internals: "run `acc gate run`", a task that "ended before
acc done or acc block", "see `.acc/config.json`" (GH-163). The author: "I don't want to see 'run acc do
xxx', but rather 'finalize deployment' or whatever applicable language." Now it names the process a
person runs, and the file by what it is.

- **One vocabulary.** `extension/src/logic/processes.ts` holds it, and it's the only place the extension
  maps a command to words. `PROCESSES` gives every command and subcommand acc's own registry lists (its
  `entryPointsOf`) a name, a verb first, in the button's words where a button does it: Run the checks,
  Finish the task, Mark it blocked, Open its pull request, Refresh from GitHub, Deploy to <env>, Promote,
  Bring in tickets, Check the setup, Set up this project, Import the team's rules. Where the extension has
  an acc.* command that does it, the row names it. `FILES` names each file a person is told about: the
  project's settings, this machine's settings, the project's rules, the first-run checklist, the
  onboarding guide. The table is TypeScript in `logic/`, not a file in `extension/commands/`, which the
  build reads as package.json's contributions: the models, the page, the notices and the tests all import
  it. It sits beside the command registry by naming, for each process, the registered command that runs
  it. `acc.doctor`'s title is now "Check the setup", its process's name.
- **The extension's own words use it.** Every notice, quick pick, tooltip, empty state, Setup step, error
  and status line that named a command or a path now says the process or the thing: "Changed in the
  project's settings: commit the change to share it", "its turn ended before it finished or blocked", "It
  moves to done at the next refresh from GitHub". Where it asks a person to act it offers the button: a
  Setup step whose fix is acc's shows "Do it: Compare the rules with their source." beside **Do it**, not
  the line it runs; another tool's line, such as `brew install gh`, is still shown to copy. The
  walkthrough's pages say the same. A run in the output panel is labelled by its process.
- **What acc says is translated at the boundary, by one translator.** `inProcessWords` rewrites each acc
  command a message names into its process ("Run acc gate run first." reads "Run the checks first.";
  "acc land does that" reads '"Open its pull request" does that') and each path into its name, with the
  verb agreeing ("the project's settings name the checks"). "acc" as the tool's name, as in "acc drafted
  it", stays. It runs where acc's words reach a person: `accSays` and the other places the extension
  shows a command's refusal, Setup's step details and reasons, the walkthrough, a hook's reason in
  History and on an agent's page, autopilot's refusal and the last line it printed (in its notice and
  the status bar), and a tracker's error on its board or a task's page. Chosen over a
  person-facing form for each of core's messages because those messages are also what the CLI prints in
  a terminal and what agents read, both out of scope here; there are hundreds of them, and a second form
  beside each would drift from the first. One translator keyed off the same table keeps one mapping, and
  a command acc adds is covered as soon as it has a row, which `processes.test.ts` requires. The cost is
  grammar: a process named mid-sentence reads in quotes.
- **What acc recorded is translated where the extension reads it.** acc writes reasons into the ledger
  and its events with its commands in them: a step autopilot couldn't take ("Run acc gate run in its
  worktree, or waive them, then review."), a held task that couldn't start, a builder's block. These
  reach a person through many views (a notice, History, a card, the Overview, a task's page), so
  each kind is put in process words once, where it's read, by `extension/src/logic/relayed.ts`: the
  hub's `autopilotLog` hands out each step through `stepInWords`; `deriveRows` builds each task's row
  through `rowInWords` (why autopilot couldn't take a step, why a held task couldn't start, why the merge
  queue holds it, its review's summary, what its stopped builder last said); a task's page and its
  document put its blocked reason, its moves' reasons and its card's failure through `reasonInWords`;
  and a held dispatch's failure is said that way in its notice. Chosen over translating in each view,
  which is a dozen places, and a new view would have to remember. The screenshot fixtures pass their
  sample rows and steps through the same functions, so the words check reads what the boundary makes:
  ACME-25's review refusal and ACME-12's builder's block name `acc gate run` as acc writes them. A
  reason is translated whoever wrote it, acc, autopilot, a reviewer, a builder or a person, since it's
  the line a person acts on, and the translator rewrites only acc's commands and paths. The record the
  log keeps is left as acc wrote it: `stepInWords` returns a copy, once for each record.
- **What stays literal, by name.** On the page, work data, in regions marked `data-work`
  (`work()` in `dom.ts`): `files` (the files a task conflicts on or shares with another, an analysis's
  files, a finding's place), `branch`
  (branches and worktrees), `transcript` (an agent's transcript on its page, the command it ran or asked
  to run, its note, a review's findings), `output` (check and command output, and the output panel), and `agent-text`
  (a rule's line, the builder's instructions on its page). `WORK_DATA` in `extension/scripts/words.ts`
  says why each stays; `MARKS` in `extension/test/words.test.ts` pins every place the page marks one, by
  file and kind. In the extension's code, `LITERAL` in the same test names the lines that may still hold
  a command or a path: the vocabulary itself, a name looked up by its path, a command line run in a
  terminal or the output panel, a file the code reads or watches, who acc records made a change, and the
  extension's own log. Text for agents (packets, the finish line, rules, review prompts) and the CLI's
  terminal output are core's, and unchanged.
- **Checked.** The screenshot run gains a `words` check: each drawing gathers every string it holds,
  shown or folded away, with each element's title, aria-label, placeholder and alt, and fails on `acc`
  followed by one of acc's commands, `npm run`, a `.acc/` path, a `docs/` page or the packet, outside
  work data. It counts what it read, fails a drawing that gathered none, fails a run in which a kind of
  work data held nothing, and has a floor (`RUN_FLOOR.words`, 76400). It failed on the pages before this
  change, with 177 findings dark at 1000 px alone, and passes now: all 342 drawings read 76564 strings
  with no finding, drawn in seven groups of pages since Chrome hit its 30 s limit on a loaded machine,
  with each check's total over its floor. `processes.test.ts`: every command acc has has
  a name; no name is empty, a command line, a path or another's; the ticket's names; each process's
  command is declared; a sample of core's messages comes through with no command or path left.
  `words.test.ts`: the rules, work data counted and never judged, `MARKS`, a scan of every line of the
  extension's code against `LITERAL`, the walkthrough, and the commands and settings VSCode lists.
  `relayed.test.ts`: core's own refusals (review's, land's, autopilot's, a dispatch held for its
  analysis) and a builder's block come through with no command or path left; a failed autopilot step
  reaches its notice, History, its card and the Overview in process words, and so do a hold, a review's
  summary and a stopped builder's last words; `deriveRows` and the task page translate; a step with no
  reason, an empty one and text naming no command are left as they were, as are a row's files and
  branch; and the hub and the screenshot fixtures read through the boundary. Translators that return
  their input unchanged fail five of them; taking out the boundary's three call sites fails three. The words check found five strings naming `acc gate run` in four
  drawings at 1000 px dark (ACME-25's card on the Tasks page and in its modal, ACME-12's move there and
  on its page, and History) before the boundary, and none after.
- Not chosen: translating the whole model as it's sent to the page, which would rewrite the work data;
  renaming acc's commands; a person-facing form for each of core's messages.

Note (GH-168, 2026-10-10): Setup and the settings speak in processes too. The words check looked only for
`acc <word>`, `npm run`, `.acc/` and `docs/*.md`, so two kinds of literal stayed: another tool's command line,
and config keys. This note supersedes the line above that another tool's command, such as `brew install gh`, is
"still shown to copy".
- **A step says what Do it does, and keeps its command line to show on request.** `toolLineDoes` in
  `processes.ts` names each line the steps give, as acc's own are named: `claude plugin marketplace add … &&
  claude plugin install …` is "Install the acc plugin in Claude Code", `claude plugin enable …` is "Turn on
  the acc plugin in Claude Code", `gh auth login` is "Sign in to GitHub as this repo's account". Setup shows
  "Do it: <that>." beside the button, and the line itself behind a folded "Show the command", marked as
  work data (`output`, one more place in `MARKS`), for someone who runs it by hand. Advice that isn't a
  command ("Remove them, rotate the credential…") is still shown, since there's nothing to fold. A command
  line with no entry in `TOOL_LINES` is shown as before and fails the words check if it's a claude or gh
  command, so a new one gets its words when it's added; the test runs every fixed command a step carries and a line for each way a check works one out.
- **Config keys are words, from one table.** `extension/src/logic/config-words.ts`, beside `processes.ts`,
  names every key acc's schema knows (`CONFIG_KEYS`, 64 of them, 58 dotted): `gates.required` is "its required checks",
  `agents.max` is "its builder limit", `gates.ratchets` is "its floors". It's typed over `CONFIG_KEYS`, so tsc
  refuses a key with no name and a name for a key that's gone. `inProcessWords` calls `inConfigWords` first,
  so every message from acc reaches a person with its keys in words ("differs on its required checks, its
  builder limit"); a key in parentheses that only says where a setting is kept ("its cap is 6
  (agents.max).") is dropped, since the sentence names where. The extension's own text no longer carries a
  key. `agents.cloud`, which the ticket named, wasn't a key this acc read when this was built; GH-69 (D-140)
  merged first, and at this merge its four keys got names: `agents.cloud.routine` is "its cloud routine",
  `agents.cloud.default` "where its builders go by default", `agents.cloud.quietMinutes` "how long a cloud
  builder may be quiet", `agents.cloud.max` "its cloud builder limit". Its `claude auth login` step is
  "Sign in to Claude Code with your claude.ai account", and Settings' lookup of `agents.cloud.routine`
  joins `autopilot.autoMerge` on `LITERAL`'s line for a setting looked up by its key.
- **GitHub commands in acc's messages are said as what they do.** `gh auth login` reads "sign in to
  GitHub"; `gh auth switch -u X` reads "switch GitHub's active account to X"; `gh auth refresh -s project`
  reads "give it access to Projects". A GitHub Project's notice on a board now goes through `inProcessWords`
  like the rest of what acc says; it reached the page as acc wrote it. The core messages stay as they are: the
  CLI and agents read them literally.
- **Checked.** The words check (`words.ts`) also fails on a `claude <subcommand>` line, a `gh
  <subcommand>`, and a dotted config key taken from the schema, each outside work data. It failed on the
  pages before this change, with 174 findings in 342 drawings (Setup's `claude plugin …` line and the
  `gh auth` in a step's tooltip, the template step's `gates.required`, `agents.max` on Settings and the
  Overview, and a Project notice's `gh` commands), and passes now: all 342 drawings read 76670 strings with
  no finding. `config-words.test.ts` pins every key's name, how the words reach acc's text, what each tool
  line is named, the Setup row, and the three rules with their edge cases. The walkthrough's pages
  (`stepMedia`) still show another tool's command in a bash block, which `words.test.ts` has always
  exempted: a page that opens beside the step, for someone following along in a terminal. A fix's text that
  ends "In a terminal: <command>." keeps that command there too, in its own bash block: the GitHub sign-in
  steps' pages had lost it to the `gh auth login` rewrite (found in review, fixed at merge).
- **Two lines joined `LITERAL`** in `words.test.ts`, the list of source lines that may name a command or key
  because no person reads them: `runs.ts`'s `needsTerminal`, which matches the claude lines that need a
  terminal, and `settings.ts`'s `autopilot.autoMerge`, the key the code finds that setting by. The list is
  meant only to shrink; these two are code, not words on a page.
