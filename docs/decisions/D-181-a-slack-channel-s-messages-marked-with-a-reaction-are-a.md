## D-181 A Slack channel's messages marked with a reaction are a board on the Tasks tab (2026-10-21)

T-85 completes D-145, whose second answer left "a board of messages with a chosen reaction" for later. A
team marks a message that needs work with a reaction, and the Tasks tab shows those messages as a board,
as it does for Jira, GitHub and monday.com.

- **The reaction is a setting.** A Slack tracker takes `reaction`, a reaction's name without colons such as
  `ticket`, and an optional `doneReaction`, such as `white_check_mark`. The config refuses a name with
  colons or capitals (`SLACK_REACTION`), and a done reaction the same as the reaction. A `doneReaction`
  without a `reaction` is warned about and ignored. Either key on another kind of tracker is warned about
  and ignored. DESIGN §4 describes both.
- **No reaction, no board.** `SlackClient.board()` then refuses with `NO_REACTION`, which says the board is
  off and to choose a reaction with Change. It asks Slack nothing. The Tasks tab shows that line above the
  box for a thread's link (D-148), never as an error.
- **The board.** `board()` reads `conversations.history` through `slackCall`: the last 30 days, 200 at a
  time, and at most 1,000 messages. When it stops at 1,000 with more to read, its notice says so. It keeps
  top-level messages with the reaction; a reaction with a skin tone (`ticket::skin-tone-2`) counts. A reply
  sent to the channel too, and a deleted message, are left out. A marked message that also has the done
  reaction is in Done; the rest are in Open. Without a done reaction, the board has Open only. A card's
  key is `slackKey`, its title the first line cut at 120 characters (`SLACK_CARD_MAX`), with the full line
  in `fullTitle` for its hover title. Its person is the writer, read with `users.info` once a board load,
  so a renamed person shows the new name on the next load. Its link is `chat.getPermalink`. The board's
  source is `slack`. An empty board's notice says how a message gets on it.
- **On the Tasks tab.** The extension no longer skips a Slack tracker's board. Its switch says "Slack
  board". The box for a thread's link stays above the board. A card doesn't move: its columns are
  reactions, which acc doesn't change, so `moves` is false and a drag or the board's keys offer no column.
  Track on an open card is D-074's Track, which reads the thread with `SlackClient.ticket`; a card in Done
  has none, and a tracked message shows its task. The person filter (D-176) goes by writer. Mine is off,
  as the board reads as the Slack app, not a person.
- **A missing scope is named.** `slackCall`'s `missing_scope` error now names the scope Slack's `needed`
  gives and where to add it: the app's OAuth & Permissions page at api.slack.com/apps. The Connect page
  asks for the reaction and the done reaction under the channel, from a fixed list (`SLACK_REACTIONS`),
  each with None first. A new `beforeSave` on a description runs before Save writes: Slack's reads one
  message of the channel's history (`slackCanRead`) when a reaction is chosen, so a missing
  `channels:history` or `groups:history` shows beside Save, and nothing is written.
- Evidence: `packages/core/test/slack-board.test.ts` adds 15 tests against a stand-in Slack that records
  each method: 9 of the board, 3 of the settings and 3 of the Connect page's description.
  `extension/test/slack-board.test.ts` adds 6 of the board's model, Track and the person filter, and
  `extension/test/connect.test.ts` 1 of the Connect page's fields and its scope check. The activation test
  drives the built extension: the board off, then the board with a reaction, Track from a card, and no
  write call to Slack. The screenshot run adds `tasks-slack-board`, `tasks-slack-empty` and
  `tasks-slack-scope`; `tasks-slack` now shows the board off, and `connect-slack-channel` its reactions.
  With 110 pages the geometry floors rise: overlap from 19260 to 19800 and the selected tab from 522 to 540.
- Not chosen: adding or removing reactions from acc; several channels on one board; a team's own emoji in
  the Connect page's list (the settings take any name); the Claude Code Slack connector and a message
  shortcut (D-145).
