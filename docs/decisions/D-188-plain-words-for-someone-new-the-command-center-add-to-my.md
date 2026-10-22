## D-188 Plain words for someone new: the Command Center, Add to my work, Make a plan, Build it (2026-10-22)

The person who built this tool said "acc" means nothing to them in the UI, and that someone with no
background must understand how to use the Command Center. About 25 strings a person read named "acc",
and its verbs were insider words. The person chose the new words on 2026-10-22:

| Was | Now | Its plain explanation (a button's title, and where it's first met) |
|---|---|---|
| acc (the app) | the Command Center | |
| Track / Track in acc | **Add to my work** | "Adds this ticket to your work here, so an agent can plan it and, once you approve, build it. Nothing changes in <tracker>." |
| Agent board | **My work** | The tickets you've added, by stage |
| Analyze | **Make a plan** | "An agent studies the ticket, the code and the org, and proposes a plan with options for you to choose. It changes nothing." |
| Dispatch | **Build it** | "An agent builds the plan on its own copy of the project. Nothing reaches the project until you merge it." |
| Land | **Open pull request** (see below) | "Pushes the reviewed work and opens its pull request. It merges there, by you, or by autopilot where you allow it. Nothing reaches the project until then." |
| Rework | **Sent back** | |
| Waive | **Accept anyway** | |
| the acc plugin | the Command Center's Claude Code plugin | |

- **Land is Open pull request, not Merge.** The person first chose Merge. `acc land` pushes the branch and
  opens the pull request, and never merges it (`packages/cli/src/commands/pipeline.ts`), so a button named
  Merge would say something the code doesn't do. Asked again on 2026-10-22, the person chose Open pull
  request. While it works it says Opening pull request, and the process for `acc land` has the same name, so
  the button and acc's own messages agree.
- **Where the words live.** `extension/webview/plain-words.ts` holds the words, each main action's
  explanation by its command id (`explains`, which a button's title shows after its label), and the five
  first steps. The page and the extension both import it, as `processes.ts` imports `upper.ts`. The process
  names in `processes.ts` take the new verbs (Build it, Make a plan, Accept a check anyway), and
  `inProcessWords` now says acc by name as the Command Center, so what acc itself prints reaches a person
  in these words too. Core's own words a person reads change with them: the Sent back state, Build it
  again, and the setup steps' titles and reasons.
- **First steps, said once.** The first time a person opens the Tasks tab with a tracker connected, a line
  under the header says how it works in five steps: Add a ticket to your work, Make a plan, Choose and
  approve, Build it, Review and merge. Got it hides it, and the tab's memory (`firstStepsSeen`) keeps it
  hidden. The screenshot run draws it on its own page, `tasks-first`; every other shot starts with it
  dismissed, as for someone who has used the tab before, so the board's first column stays inside
  `BOARD_TOP`. Behaviour's case "first steps: Got it hides the five steps" drives Got it in a browser, with a
  mutant that forgets to remember it.
- **The check.** The words check (`extension/scripts/words.ts`, D-132) also fails on acc by name (whole
  word, any case; not a command id, a path, the plugin's id or a file name) and on each retired word as a
  label (capitalised, as on a button: Track, Track in acc, Analyze, Dispatch, Agent board, Land, Rework,
  Waive; and "agent board" in any case). Work data is still counted, never judged. Notices, quick picks and
  the status bar never reach a drawing, so `extension/test/words.test.ts` also reads every string in the
  extension's code for both rules, with a named list of the strings that run a command.
- **Kept.** Command ids (`acc.task.dispatch` and the rest) and the command line's own names (`acc dispatch`)
  don't change: only words a person reads. README and ONBOARDING say once, for developers, that `acc` is the
  command-line engine behind the Command Center.
