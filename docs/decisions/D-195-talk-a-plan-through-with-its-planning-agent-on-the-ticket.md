## D-195 Talk a plan through with its planning agent, on the ticket page or in Claude Code, and turn what you agree into the plan (2026-10-22)

T-98. T-97 (D-192) gave a plan options, versions and an approval, but the person couldn't argue with it: ask
why, push back on an option, or suggest another. They chose both ways to do that: a conversation on the
ticket page, and Open in Claude Code for a longer session.

- **A conversation, kept with the plan.** `acc plan talk <id> "<message>"` (`--about d1`, `d1.a`, `s2`, `r1`
  or `q1` quotes a choice, an option, a step, a risk or a question) resumes the plan's own Claude Code session
  (`claude -p --resume`), from the folder the plan was made in, with the analyst's read-only tools, its org
  reads on Salesforce, and acc's hook (`analystFlags`, `analystEnv`, `analystDir`, shared with `analyze`). The
  person's message is kept first, so a reply that fails still shows what was asked, with why. The
  conversation lives in the state folder beside the plan (`.git/acc/analyses/<id>.talk.json`,
  `plan-talk.ts`); nothing is written to the project or the ticket. One message at a time, only before the
  build, and never while the plan is being made.
- **Replies propose; the person decides.** The agent answers with `TALK_SCHEMA`: its reply, and each change it
  suggests as a proposal: choose an option, a new option in words, an answer to a question, or a note such as
  a changed step. A proposal that names a choice, option or question the plan doesn't have is left out
  (`parseTalkReply`). `acc plan use <id> <turn> <proposal>` and the page's Use this record it as the person's
  own, through the same functions as `acc plan choose`, `acc analysis answer` and the new `acc plan note`, so
  their rules hold. On an approved plan it asks first, in acc's words (`CHANGE_APPROVED`, `NOTE_APPROVED`,
  `ANSWER_APPROVED`), with Keep the approval and Change it; Escape keeps the approval and gives focus back to
  Use this; acc refuses without `--yes`. A proposal made on an older version of the plan is refused, even
  with `--yes` (`proposalStale`): the new version may number its choices and options differently, so a
  proposal must never land on another one. The page shows it as "from v1", with Use this off and why, and
  Ask again puts it in the message box to ask about the plan as it is now.
- **Notes.** `acc plan note <id> "<text>"` adds a note to the plan, kept from version to version, given to the
  builder with the choices (`approvedPlanLines`), and shown under the plan's head as "Your notes on this
  plan". A note changes the plan, so on an approved plan it asks first, as a choice does.
- **Make a new plan.** The analyst's prompt for the next version carries the conversation, which
  proposals the person used, and the notes (`talkSection`), and asks it to reflect what was agreed. The
  conversation then says "Made v3 from this conversation." with what changed (`versionTurn`). Under the
  conversation, Make a new plan is the plan section's own Make a new plan: the same action, with one name.
- **Open in Claude Code.** `acc plan claude <id>` writes a brief beside the plan (the ticket, the latest plan,
  the conversation, and how to record to the plan) and returns how to start an interactive session in the
  main checkout, in plan mode, with only Read, Grep and Glob allowed in advance. The person makes every
  decision, so `acc plan choose`, `acc plan note` and `acc analysis answer` are not allowed in advance:
  Claude Code asks the person before each one runs, and the brief says so. The Command Center opens it in a terminal, with `ACC_PLAN_TALK` set to the task and session. What that
  session records through acc lands, as the person, on its own turn in the conversation (`recordInSession`),
  and the page shows it; when the terminal closes, the page redraws.
- **On the page.** "Talk it through" is a section of its own under the plan: each turn with who (You,
  Planning agent, Claude Code, The plan) and when, the plan version, what it's about quoted, its proposals
  with Use this or who used it, and what a Claude Code session recorded. Discuss on each choice, option,
  question, step and risk opens it with that part quoted and the cursor in the box. A message runs in the
  output panel, where its steps show (D-171); Ctrl or Cmd with Enter sends it, and Enter alone starts a new
  line. The words are the person's: Talk it through, Discuss, Use this, Make a new plan, Open in Claude
  Code; the agent's reply is marked as work data.

Tested in `packages/core/test/plan-talk.test.ts` (11 tests), `packages/cli/test/plan-talk.test.ts` (4 tests),
`extension/test/talk.test.ts` (15 tests) and `extension/test/behaviour.test.ts` (1 test). A behaviour case
drives Use this's question, Escape, Change it, Enter and Ctrl+Enter in a browser, with 6 mutants it must
catch. The screenshot run draws ACME-21's conversation (`ticket-talk`): an option quoted, a reply with one
proposal from v1, off with why and Ask again, and one used, a Claude Code session and
what it recorded, v2 made from the conversation with what changed, a message waiting for its reply, and
the next message about another option, with Discuss on each step and risk, at every width and theme.
