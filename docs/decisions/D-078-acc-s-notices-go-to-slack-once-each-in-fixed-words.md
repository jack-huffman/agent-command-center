## D-078 acc's notices go to Slack, once each, in fixed words (2026-10-06)

The Command Center tells a person what needs them, but only inside VSCode
(D-044, D-064). Away from it, nothing reached them (GH-58). D-005 had left
Slack for later; this is Slack for notices, not as a tracker.

- **One incoming webhook for this machine**, for every project open here. It's
  pasted on a **Notices in Slack** card under **This machine** in the
  Environments section (a person decided), and kept in VSCode's secret storage
  under `acc.slack.webhook`. It's never in a repo, `.acc/config.json`, the
  page's model or saved state, globalState or the log: the card shows only its
  last four characters. Only a `https://hooks.slack.com/services/…` address is
  taken, so a notice can't go anywhere else. The switch, the kinds, the turn-on
  time and the last result sit in `globalState`, which isn't synced. The
  commands **Send notices to Slack…** (opens the card), **Send a test message
  to Slack** and **Stop sending notices to Slack** reach it from the Command
  Palette. There's no status bar item for it.
- **Off until a person turns it on.** Connect keeps the webhook, turns sending
  on and sends a test, whose result shows on the card. **Turn off** stops every
  message; **Remove** deletes the secret. Nothing that happened before it was
  turned on is sent: a moment carries when it happened (a question's ask, a
  draft's creation, the ledger's move), and one from before is dropped.
- **Four kinds, each with a tick,** all ticked the first time (a person
  decided):
  - **Needs you:** every urgent notice the Command Center shows: blocked, an
    agent waiting in its own prompt, a stopped builder, checks failed, a
    reviewer asked for changes, a conflict with its base, an analysis with
    questions or saying the task is too big, "Autopilot couldn't …", and a
    task's agent asking a question or for permission (D-030).
  - **Review finished:** a review that passed or asked for changes, a person's
    or autopilot's. A review asking for changes is this kind even when it waits
    for you.
  - **Pull request opened:** autopilot's land that opened one. A person's own
    land isn't sent: they were there.
  - **Draft update waiting:** a new draft update for a ticket (D-066).

  Not sent: ready for review, merged, an analysis ready or back, autopilot
  re-dispatching, resuming or merging its base, a pull request updated. A
  question no task asks isn't sent, since the message names a task.
- **Slack ignores the toast's quiet rules** (a person decided): it sends while
  the Overview or Tasks is on screen, and when `agentCommandCenter.notifications`
  is off. So each window works out what changed at every reload, whether or not
  a toast shows (`News`), and toasts only when it may.
- **Fixed words, never the toast's text.** Each message is the kind, the repo's
  name, the task's id and title, a fixed phrase for what happened (a pull
  request's number at most), and one link: the task's pull request, else its
  ticket, else none. It never has a review's summary, an agent's last words,
  autopilot's reason, a question's text, a command, conflicting files, a draft's
  text or a ticket's description. The title and repo name are escaped (`&`,
  `<`, `>`), so a title like `<!channel>` mentions nobody, and a link Slack would
  read as markup isn't sent. Every message sets `unfurl_links` and
  `unfurl_media` to false. A GitHub or Jira app installed in the Slack
  workspace may still preview a link; a person who minds can untick kinds or
  use a DM.
- **Once each, from every window and across restarts.** A moment's key is built
  from ledger data, never from when a window noticed it, so every window builds
  the same one: a question's id; autopilot's event sequence; a draft's id; and
  for a task notice its kind with the move's time (blocked, a review's result),
  the review's own time (passed), the run's start (a stopped or waiting builder:
  once a run), the pull request's number and the run's start (checks, a
  reviewer, a conflict), or the analysis's time. A window claims a key by
  writing its sha256 to `~/.acc/slack/sent` with an exclusive create
  (`ACC_SLACK_DIR` in tests) before it sends; a window that finds the claim
  there sends nothing. Claims older than 30 days are pruned when VSCode starts.
  A draft that replaces one already told isn't told again (D-071), and the
  draft of a pull request autopilot opened is told by that pull request's
  message, which says its update waits.
- **Never a loop, never a flood.** One POST per message, never retried, each a
  second after the last, with a 10 s timeout. A 4xx other than 429 shows
  Slack's word for it (`channel_is_archived`) on the card, in orange with a
  warning icon, pauses sending until a test goes through or the webhook is
  replaced, and shows one VSCode warning; the Environments item in the rail
  turns orange too. Turned off while paused, the card says off and the rail
  isn't orange; turned on again, it's still paused until a test goes through.
  A 429, a 5xx, a timeout or a network error loses that one message and says
  why on the card. A burst is cut short after the one on its way and twenty
  waiting, with one message saying how many more there were.
  Errors are scrubbed of the webhook before they're shown or logged.
- **Accepted:** a message claimed and then refused, or lost to a crash between
  the claim and the POST, isn't sent again. Paused, a moment isn't claimed, so
  once it's fixed, what comes next still goes. A builder waiting in its own
  prompt twice in one run is one message, and so are checks that fail, pass and
  fail again in one run: the ledger keeps no time for a check's result. A pull
  request autopilot opened is one message: its draft update isn't told again,
  even with Pull request opened unticked.
- **A message only ever goes to the webhook pasted:** a redirect isn't followed.
- **Only the extension sends.** The CLI and autopilot never post to Slack, so
  `packages/core` is unchanged (D-003). A machine with no VSCode open sends
  nothing.
- Not chosen: keeping the webhook in settings.json, where it would sync and be
  readable by other extensions; retrying a failed message; sending from the CLI
  or autopilot; a webhook per repo or project; Slack's OAuth apps, bot tokens,
  buttons or replies; and the toast's own text, which can carry what a client
  wouldn't want in Slack.
