## D-202 A plan starts with a conversation, and the conversation lives in its own panel beside the ticket (2026-10-22)

T-111. Make a plan (D-052, D-192) planned from the ticket alone (T-110: the whole ticket), so the planning agent
guessed at what the person was thinking. Talk it through (D-195) came only after a plan, and drew the whole
conversation on the ticket page, where a long one took up far too much room. The person asked for both on
2026-10-22: a plan that starts with what they say, and a dedicated place for the conversation.

- **A plan starts with a conversation.** For a task with no plan, Make a plan opens the conversation's panel
  with its question, "What do you want to do here, and what are you thinking?", and runs no plan yet. The
  person writes in their own words; `acc plan start <id> "<message>"` (`packages/core/src/plan-opening.ts`)
  answers read-only, with the analyst's tools and hook, before any deep investigation: what the agent
  understood from the ticket and the person's words, what it's unsure of, and at most three questions
  (`OPENING_SCHEMA`, cut to three by `parseOpeningReply`). The first message carries the whole ticket, comments
  too (`--ticket`, as Make a plan reads it); a later one resumes the session, which holds it already.
- **Draft the plan, or Skip to the plan.** Draft the plan runs `acc analyze`, whose prompt holds the conversation
  under "## What the person said before the plan" (`openingSection`) and asks the plan to name what it took from
  it, starting "You said: ", where a choice or a recommendation rests on it. It is off, with why, until
  something is said. Skip to the plan runs `acc analyze --skip-opening`: today's way, from the ticket alone, in
  a new session, and the conversation doesn't say the plan was made from it.
- **One planning session.** The opening runs in a new Claude Code session (`--session-id`); each later message,
  the plan (`planningSession`: the newest of the agent's replies and the plan before) and Talk it through resume
  it (`--resume`), from the same folder, so the agent remembers what was said first. A task planned without an
  opening conversation keeps today's way: each version starts its own session. The opening's turns are kept in
  the plan's conversation, beside the plan (`.talk.json`), as the plan's version 0, shown "Before the plan".
- **Once at a time.** Draft the plan, Skip to the plan and Make a new plan each read the ticket, then run acc. A
  second click while one is under way is ignored (`PlansMaking`, `extension/src/logic/conversation.ts`), and the
  panel says what is under way: the ticket being read, then the plan, with the status bar saying the ticket is
  being read. This replaces the moment T-110 left, when Make a plan showed nothing while the tracker was read.
- **A panel of its own.** The conversation is a Command Center tab titled "<key> · Plan conversation"
  (`extension/src/conversation.ts`), opened in the editor group beside the task's page, so it stays open as the
  person moves around the ticket. A task page says how wide it is (`page-width`); one narrower than 900 px
  (`BESIDE_MIN`) opens it as a tab of its own instead. Open conversation, Discuss (D-195), Review plan's Discuss
  (T-109) and the plan's Talk it through open it, with the item quoted where there is one; the panel puts the
  quote over its box once it's ready. It has the box, the turns, proposals with Use this, Make a new plan and
  Open in Claude Code, as Talk it through had.
- **One line on the page.** The plan section shows "Conversation · 12 messages · 5 min ago" with Open
  conversation, and never the turns or the box. Before a plan, the line sits in the section that says there is
  no plan yet.
- **The panel and the page agree.** Both are drawn from one model (`TicketPanels.talkModel`), and every redraw of
  a task's pages redraws its panel too, so Use this, an answer, a choice or a new plan in either place shows in
  the other at once.

Tested in `packages/core/test/plan-opening.test.ts` (9 tests), `packages/cli/test/plan-start.test.ts` (2 tests),
`extension/test/conversation.test.ts` (14 tests) and `extension/test/conversation-panel.test.ts` (3 tests, the
built extension: beside, a tab when narrow, the quote, a change shown in both). Two behaviour cases drive the
panel from its question to Draft the plan, and the page's one line to Open conversation, each with a mutant it
must catch: the page drawing the turns, and Draft the plan ignoring the conversation. The screenshot run draws
the panel at the start of a plan (`conversation-start`), mid-conversation with a reply on its way
(`conversation`), Talk it through once v2 is made (`conversation-talk`), and the page with its one line before
its plan (`ticket-conversation`) and with one (`ticket-talk`), at every width and theme.

### Note, 2026-10-22 (T-112): always beside the ticket

Make a plan, Discuss and Open conversation now open the ticket's page first when no tab shows it, in the active
group, and the panel beside it (`TicketPanels.ensureTab`, called by `ConversationPanels.open`). From the Tasks
board's modal the modal is asked to close (`task-modal-shut`) and closed on the extension's side, so the board is
left with the pair. On a narrow window the panel is still a tab, as before. `extension/test/conversation-panel.test.ts`
now has 6 tests (3 added): from the modal, from the board with no page, and one that sends a message and uses a
proposal in the panel and approves on the page, checking each place shows it. The browser case "Make a plan on the
task page" clicks Make a plan on the page; the panel is a document of its own, so that case ends at what the page asks
of the extension, and the panel's own case is renamed "the panel opens at its question".

Note (2026-10-31, T-169): the panel is now titled "Discuss <key>", and it is the ticket's one conversation at any state, opened by Discuss in the ticket's header too. See D-T-169.
