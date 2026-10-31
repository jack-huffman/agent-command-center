## D-249 Discuss a ticket: one conversation about the whole ticket, with everything acc knows about it (2026-10-31)

T-169. The person wrote: "We should also be able to just open a chat to discuss the ticket in general, and the chat
will have context for the state of the ticket, metadata involved... everything about it so far." Until now the plan
conversation (T-98, T-111, T-160) talked only about the plan, only before the build, and "Open in Claude Code" opened
a session with the ticket and the plan alone.

- **One conversation per ticket.** The plan's conversation is the ticket's conversation: the same file
  (`<task>.talk.json`), the same panel, now titled "Discuss <key>" (`conversationTitle`). Discuss, first of the
  tools in the ticket's header (`headerDiscuss`, `extension/webview/talk.ts`), opens it with nothing quoted, as Open
  conversation does. The plan's Discuss on a part still opens it with that part quoted, and a proposal still has Use
  this.
- **At any state.** A message is no longer refused once the ticket is being built, in review, blocked or done
  (`ticketToTalk`, `packages/core/src/plan-talk.ts`). Before the build with no plan, a message still starts the plan
  (T-111, `acc plan start`), and each of its messages gives the agent the context pack. A ticket built with no plan starts a session of its
  own on its first message, and later messages resume it (`lastSession`).
- **The context pack.** Each message gives the agent one pack, built by acc from what it holds
  (`ticketPack` and `readTicketPack`, `packages/core/src/ticket-context.ts`): the ticket and its comments (the
  ticket the plan read, else the description), the plan and its criteria, what the work changed as the Changes tab
  lists it (`changesDraft`, from the branch's paths in flight, else what acc kept), where it is deployed (acc's
  record, the latest deploy to each org), the checks on its latest commit (`checkLine`), the latest review's
  criteria and findings, why it is blocked, the builder's notes, and its history. Each part is cut to its own size
  (`PACK_LIMITS`), with a line that says what was cut; the history keeps its newest lines, the rest their first.
- **Read-only, as the planning agent.** The agent runs as it does to make a plan: the analyst's tools, its hook and
  `ACC_ROLE=analyst`, on the planner's model (D-243). While the ticket waits to be built it may propose a plan
  change, as before. Once the build has started the plan is settled: the prompt asks for no proposal, and acc drops
  any that comes (`parseTalkReply` with no plan), so no Use this shows.
- **Open in Claude Code** writes the same pack as the session's brief (`claudeBrief`), with the conversation so far.
  Past the build it says the plan is settled and records nothing; before, it says how to record to the plan, as
  before.
- **The empty state** says what the person can ask (`TALK_NOTE`). The screenshot run draws the conversation as the
  header's Discuss opens it on a ticket in review (`conversation-discuss`).

