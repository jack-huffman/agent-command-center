## D-028 A clone chooses its own GitHub account, and the UI always shows who you're working as (2026-10-02)

`.acc/config.json` names the account a project works as (D-007), and it's
committed. When someone switches accounts, writing that file would change the
account for everyone else who clones the repo. A client repo is often shared
by several consultants.

**The choice lives in the clone's own git config, as `acc.githubAccount`.**

- It's never committed, and every worktree of the clone shares it.
- acc reads it wherever it uses the account: gh calls, the doctor checks,
  boards and dispatch. When it's unset, the project's account applies.
- `acc github use <account>` switches, and `acc github use --default` goes back.
  `acc github status` shows the account, where it comes from, gh's scopes, who
  git push uses, and who commits are signed as.

**git push follows the choice.** The credential helper acc sets now reads
`acc.githubAccount` each time git asks, falling back to the project's account.
Switching means setting one value; the helper isn't rewritten. An older,
pinned helper is replaced the first time a clone switches. Switching only
offers accounts gh is already logged in to. "Add a GitHub account…" signs one in
through VSCode's GitHub sign-in first, then puts gh's active account back.

**You always see who you're working as.**

- **Status bar:** the repo's account, beside the branch. It changes to a warning
  icon and words when gh isn't signed in as the account, or when git would push
  as another one. Its tooltip gives the details, with Switch account and Sign
  in.
- **Environments tab:** an identity card with the account, where it's set, gh's
  scopes (including the Projects scope a GitHub Project's board needs), who git
  push uses, and who commits are signed as.
- **Boards and the comment box:** they say who they act as, for every tracker:
  the GitHub account, the Jira email, or the Microsoft account.

Commit identity isn't switched along with the account. It's shown beside it,
and B2.identity checks it.
