## D-145 Slack is a tracker kind: a channel's threads are its tickets (2026-10-14)

T-23 asked how a Slack thread can be a task. The person took the recommended answer to each of its five
questions (2026-10-14):

1. **How acc reads Slack.** Through a Slack app with a bot token, which the Command Center keeps in VSCode's
   secret storage. The Claude Code Slack connector can come later, in the intake skill. D-078's incoming
   webhook only writes, so it stays a separate secret for notices.
2. **What a Slack task is.** A thread that a person tracks by pasting its link. A board of messages with a
   chosen reaction is a later task. A message shortcut is not a way in.
3. **Who a reply posts as.** The Slack app (bot token, `chat:write`), not the person.
4. **Which drafts go to a thread.** Only merged, deployed and the client's questions (blocked, question).
5. **What the brief holds.** The root message and its replies as they are when the thread is tracked. A
   person is named by their Slack name, never their email.

T-27 builds the core part: the kind, its settings and a client. The design:

- **The kind.** `slack` is in `TRACKER_KINDS`, named "Slack". A team template can't name one: a Slack
  tracker's channel is each project's own, so `parseTemplate` refuses it. The extension makes no client for
  a Slack tracker yet: its board says that signing in to a Slack app isn't built, and it offers no sign-in.
- **Its settings.** A Slack tracker names its `workspace` (the domain before `.slack.com`) and its `channel`
  (a channel's id, such as `C0123ABCD`). The config refuses one without either, and the error names the
  missing key; it refuses a channel's name in place of its id. Either key on a tracker of another kind is
  warned about and ignored. Its keys start `SL` unless it names a `prefix`.
- **A key.** The prefix, a hyphen, and the thread's first message's timestamp without its dot:
  `SL-1696512345123456`. `slackKey` makes one; `slackThread` reads a key back to its timestamp, and also
  reads a thread's link (`https://acme.slack.com/archives/C0123ABCD/p1696512345123456`, or a reply's link,
  whose `thread_ts` names its thread). A key names no channel: it is the tracker's own. Only a link can name
  another, so only a link can be outside.
- **`SlackClient`** (`packages/core/src/trackers/slack.ts`) uses `fetch` and the Web API with the bot token:
  `auth.test`, `conversations.replies`, `users.info`, `chat.getPermalink` and `chat.postMessage`. Every call
  waits for `auth.test`, made once, and a token for another workspace fails there with an error that names
  that workspace, before anything is read.
- **A ticket.** The title is the first line of the root message, clipped to 150 characters. The body holds
  the root message and each reply in time order, each under its writer's Slack name (display name, else
  full name, else handle) and its time. Mentions become `@name`, links their label and address, and any
  email address in a name or a message becomes "[email hidden]". A thread whose root message was deleted,
  or that Slack doesn't give back (too old for the workspace's plan, or in a channel the app isn't in), is
  `not-found`.
- **Outside.** A link into another channel is outside, naming that channel, but only when acc can read the
  thread there. An error, a deleted root message or an empty answer is never outside (D-048).
- **A reply.** `comment` posts the text in the thread as the app, through `slackEscape`, which moved from
  the extension to `packages/core/src/text.ts` so the notices and the client share it. A reply so can't
  mention `@channel` or a person.
- **No fields.** A thread has no statuses, people to assign or labels: `transitions`, `labels` and
  `assignable` give empty lists, and `transition`, `assign` and `setLabels` throw a `refused` error that
  says so. `board()` throws a `refused` error that says to track a thread by its link.
- **Trouble.** An HTTP 429 gives an error that says when to try again, from `Retry-After`. A refused token
  is `auth`, a missing scope `scope` and names it.
- Evidence: `packages/core/test/slack.test.ts` adds 16 tests, with Slack's answers as fixtures, including an
  empty reply list, a deleted root message, a thread from another channel and a 429.
  `packages/core/test/template.test.ts` adds 1 for the refused template. `slackEscape` is tested in the
  reply test there and in `extension/test/slack.test.ts`.

Out of scope: the Connect page, the secret storage, Track, which drafts go to a thread, and a board of
Slack messages.
