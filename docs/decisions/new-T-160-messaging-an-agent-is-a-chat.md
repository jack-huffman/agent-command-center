## D-T-160 Messaging an agent looks like Claude Code's chat: your message boxed and pinned, replies full width, the message box a card (2026-10-30)

T-160. The person sent screenshots of Claude Code's chat in VS Code and asked for the same experience where they
message an agent here: "Do you see the message I send, how it's styled, how it stays on the top of the screen when I
scroll? … Claude responses … go full-width of the page … The message box also has either margin or padding at the
bottom." Two pages message an agent: the plan conversation (T-111, `extension/webview/talk.ts`) and an agent's page
(D-030, D-060, `extension/webview/agent-page.ts`). Both now draw with one shared module, `extension/webview/chat.ts`
and `chat.css`.

- **The page fits the window.** The head stays. The chat (`.chat-log`) scrolls in its own box. Under it, out of its
  way, is the foot: a status line while the agent works, then the message card, with 16 px under it. The card never
  lies over the chat.
- **Exchanges.** Each of the person's messages starts an exchange; what came back follows it. The person's message is
  a box with rounded corners, a border and a background a step from the page, with no heading. What it is about (a
  quoted part of the plan) is a chip over the words. The box sits in a pin, `position: sticky; top: 0` inside its
  exchange, in the page's own colour: while the exchange is in view, the message stays at the top and its reply
  scrolls under it; the next exchange's message takes its place. A pinned message's box is at most 9.5em high (about six lines)
  and scrolls inside itself past that.
- **Replies run the full width,** with no box, bar or background. The planning agent's reply ends with a small line
  of when and which version. A Claude Code session and a new version of the plan keep their line of who and when,
  since they are not the agent's own words.
- **Steps hang on a thin line, a dot each:** grey when done, blue while running, orange where one failed (orange
  against blue, never red against green). On an agent's page these are its tool calls, a folded run of steps, and
  the person's answers to its questions, each one line that opens.
- **Proposals and questions stay under the reply they belong to.** The planning agent's question card and progress
  go in the latest exchange; an agent's waiting question goes under its latest reply, no longer above its timeline.
- **The message card:** the words, then one row: the page's own controls on the left and Send on the right. Send is
  a small filled square with an arrow, off with "Type a message first" until the box has words, off with the page's
  own reason while a message can't go. Ctrl or Cmd with Enter sends. The agent's page's Send was on with an empty box
  before; it now follows the same rule.
- **Actions about the whole conversation** sit in one place each. On the plan conversation, Draft the plan and Skip
  to the plan, or Make a new plan and Open in Claude Code, are in the card's row. On an agent's page they stay in its
  head (Open in Claude Code, Attach, Open its folder, Stop), as D-087 and T-47 placed them.
- **The status line** is "The planning agent is reading the code to reply…", the plan being made, "Working…", "It's
  waiting in its own terminal" with Attach, or "The session has ended."
- **Where the chat opens.** Both pages open at the newest message and follow it while the person is at the bottom,
  as the agent's page did (`extension/webview/main.ts`).

**Checked by:** `extension/test/chat.test.ts` (the shared parts, and both pages drawn with them),
`extension/test/disabled-reasons.test.ts` (Send's reasons), and the screenshot run. Two pages draw each chat
scrolled with the person's message pinned at the top: `conversation-scrolled` and `agent-chat`. The geometry
check's `covered` rule (`judgeChat` in `extension/scripts/geometry.ts`) fails a pinned message that lets the chat
show through or takes more than half the chat's height, and a foot that lies over the chat.
