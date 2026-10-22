## D-146 A Slack channel connects from the Connect page, with its app's bot token (2026-10-14)

T-27 (D-145) made Slack a tracker kind, but the Connect page didn't offer it and the extension wouldn't
make its client. T-29 adds `SLACK` to the Connect page's descriptions (`packages/core/src/trackers/connect.ts`).

- **Where.** The host is the workspace: `acme`, or any link from `acme.slack.com`. Other text is refused with
  that example.
- **Sign-in.** One method: the bot token of a Slack app, in a secret field that refuses a token that doesn't
  start `xoxb-` (a user token would post as the person, not the app). Its button opens Slack's page for apps.
  The hint says the token stays in VSCode on this machine, and that a person must invite the app to the
  channel. The extension keeps it as it keeps the others' tokens, `acc.cred:<repo>:slack:<workspace>` or the
  workspace's shared key: `trackerHost` gives a Slack tracker's workspace.
- **Who.** `verify` is `slackApp`: `auth.test` checks the workspace (`slackAuth`, which `SlackClient` now uses
  too), and a token for another workspace fails, naming it. The name is the app's, from `bots.info`, so the
  page says who a reply posts as. When `bots.info` can't be read, it is the bot user's name from `auth.test`.
- **Channel.** One picker, from `conversations.list` (public and private, archived left out). It lists only
  the channels the app is in, since the app reads no other, sorted by name and shown as `#name`, with
  "public" or "private". The channel is Slack's place (what stands in for an epic) and names the tracker, as
  a monday.com board does: it has no "whole" to choose.
- **A second channel.** `withTracker` tells Slack trackers apart by workspace and channel, and `ownPrefix`
  gives a second channel's tracker `SL2` (then `SL3`), as a second monday.com board gets `MON2`.
- **The extension** makes a `SlackClient` from the kept token, and a Slack board with no token offers Sign in
  to Slack. Its board is still the client's refusal (track a thread by its link), until Track is built.
- Evidence: `packages/core/test/slack.test.ts` adds 3 tests, `packages/core/test/connect.test.ts` 2 and
  `extension/test/connect.test.ts` 2, and the activation test checks the sign-in button and the client's
  refusal. The screenshot run adds `connect-slack` and `connect-slack-channel`, and `ticket-nofields` is a
  Slack thread now.

Out of scope: Track on a thread's link, which update drafts go to a thread, and a board of Slack messages.
