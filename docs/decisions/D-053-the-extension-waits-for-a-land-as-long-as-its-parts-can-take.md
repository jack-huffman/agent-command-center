## D-053 The extension waits for a land as long as its parts can take (2026-10-05)

The review of D-051 found three loose ends. The extension stopped `acc land`
after 180 seconds, though its issue comment alone may take 2 minutes. A
reviewer stopped at its timeout said "Claude Code didn't start: claude didn't
finish within 45 minutes". And the extension showed an unconfirmed comment as
information, while the CLI shows it in orange after a `!`.

- **The land budget comes from land's own timeouts.** land names them:
  `PUSH_TIMEOUT_MS` (5 minutes), `FETCH_TIMEOUT_MS` (2 minutes) and
  `GH_TIMEOUT_MS` (2 minutes, for each gh call). `LAND_TIMEOUT_MS` is the push,
  the fetch and four gh calls (auth token, pr list, pr create or edit, issue
  comment), plus a minute for local git and the ledger lock: 16 minutes. The
  extension runs `acc land` with it, so raising one of land's timeouts raises
  the extension's too. Every other acc command keeps 180 seconds.
- **A reviewer stopped at its timeout says so,** as the analyst already did:
  "The review didn't finish within 45 minutes, so acc stopped it." Only a
  `claude` that never ran says "Claude Code didn't start".
- **A comment that isn't confirmed, or failed, is a warning.** After a land,
  the Command Center shows it with VSCode's warning icon, matching the CLI's
  orange `!`. That covers a GitHub comment gh didn't confirm, and a Jira or
  Azure DevOps comment the extension couldn't post. Its words and the "Open
  pull request" button stay the same.
- Not chosen:
  - One long timeout for every acc command. A hung `acc add` or `acc sync`
    would leave the extension waiting 16 minutes before it said anything.
  - A cancellable land. Cancelling midway could leave a pushed branch and an
    open pull request with nothing in the ledger.
