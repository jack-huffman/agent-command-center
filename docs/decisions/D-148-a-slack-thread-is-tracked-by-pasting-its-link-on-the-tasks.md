## D-148 A Slack thread is tracked by pasting its link on the Tasks tab (2026-10-14)

A Slack tracker has no board (D-145): `SlackClient.board` refuses. T-31 puts a box for a thread's link in
the board's place, so a person makes a task from a thread (T-23, question 2).

- **No refusal.** The extension makes a Slack tracker's client, so a missing token still offers Sign in to
  Slack, but it doesn't ask it for a board, so the client's refusal is never shown. The Tasks tab shows the
  box, which says the channel and workspace the thread must be in and how to copy a thread's link. A Slack
  tracker that can't be read shows its error and no box.
- **The link is read first** (`extension/src/logic/slack-link.ts`): `slackThread` reads it and `slackKey`
  makes the key, before `Trackers.track` upper-cases what it's given, so a link's case never changes what it
  names. A link to a reply names the thread it's in. Text that isn't a thread's link (a channel's link, a
  key, anything else) is refused with an example link in the tracker's own channel. A link from another
  workspace, or to a thread in another channel, is refused, naming that workspace or channel. None of these
  reach Slack.
- **Track** is the same Track as a card's (D-074): it reads the thread with `SlackClient.ticket` and gives
  its title and brief, with each writer's Slack name, to `acc import`. Import upserts by key, so a second
  Track of one thread changes its task's text and never makes a second task. A thread that can't be read is
  refused with Slack's reason and never reaches acc, so it never changes or removes a task (D-048).
- **The box's state** is the extension's, per tracker: the link last sent, Tracking…, why it didn't go
  (orange, a warning icon), or the key it tracked (blue, a check). The link stays in the box so a refused one
  can be fixed. Track is off, with its reason, until there's a link.
- **The task page** is unchanged: a Slack task's key finds its tracker, the page reads the thread, and
  Refresh reads it again.
- Evidence: `extension/test/slack-link.test.ts` adds 11 tests, against a stand-in Slack and a real ledger,
  and the activation test checks the box and a refused link in place of the client's refusal. The
  screenshot run adds `tasks-slack` and `tasks-slack-refused`.

Out of scope: a board of Slack messages with a reaction, and the Claude Code Slack connector.
