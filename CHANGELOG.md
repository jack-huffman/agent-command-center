# Changelog

What changed in each release of Agent Command Center, newest first. The
extension, the plugin and acc share one version. Each release is a GitHub
Release of this repo, with the extension's `.vsix` attached and its entry here
as the notes.

## 0.36.0

- Builders, reviewers and analysts run on Claude Opus 5.5 unless the clone or
  the project names another model. **Dispatch with…**, on a card's ⋯ menu and
  the task page, picks a model for one task, with the analysis's size beside
  the choices (`acc dispatch --model` does the same). A rework and a resume
  keep the pick. Cards, the task page and the Agents tab show each agent's
  model.
- Every agent acc starts is named for its project, ticket and role, such as
  `Acme Service · ACME-12 Case escalation rules · builder`, in Claude Code's
  session list, the Command Center, notices and terminals alike. A task's
  second builder is `builder 2`.
- Auto-merge, off unless a repo turns it on: with autonomy at review, autopilot
  merges a pull request once its review and GitHub's checks passed, it's up to
  date with its base, GitHub says it can merge, and nothing waits on you. One a
  pass, never into a protected environment, never in a Salesforce project, and
  never a pull request that changes `.acc/`. Turn it on with **Auto-merge** in
  How agents run, or `acc agents auto-merge on`.
- Where a GitHub tracker says `"edits": true`, `acc sync` closes a task's issue
  when its pull request merges, with one comment saying so. `acc sync
  --close-done` does the same for tasks done before (`--plan` lists them
  first). Jira and Azure DevOps tickets are never changed.
- monday.com connects on the Connect page: an account, a personal API token, a
  board, and if wanted one group on it. Its status labels are the Tasks tab's
  columns.
- Setup forgets a step that no longer applies. Opening a folder with no
  project, then giving it a generic config, used to leave Node 20 or later
  (and the Salesforce CLI and Code Analyzer) listed under This machine, counted
  as to do, until the window reloaded. Now each full check replaces the rows
  it lists. When a check can't run, Setup keeps the rows it had rather than
  going blank, and doesn't save the empty result for the next start.
- The acc plugin step fails when the plugin in Claude Code is older than the
  extension, and its **Do it** updates the marketplace and the plugin. A newer
  plugin passes.
- The README says how to put VSCode's `code` command on PATH before installing
  the `.vsix` with it.
- `docs/FIRST-RUN.md` is the checklist for a first run on a fresh machine, to
  be filled in step by step.

## 0.35.0

- One version for everything: acc, the extension, the plugin and its
  marketplace entry all say 0.35.0. `acc --version` said 0.1.0 before.
- This changelog, and a package that won't build without an entry for its
  version.
- A package is checked for the packager's personal data before it's made: home
  folders, their git email, their GitHub accounts, their name in a `.claude` or
  `.acc` path, and the trackers they've signed in to. Anything found stops the
  package and is listed by file and line.
- The plugin's author and the marketplace's owner are now Agent Command Center,
  linking to this repo, rather than a person's GitHub account.
- Releases are on GitHub, made by a person with `npm run release`. Agents can't
  make one.
- More builders at once: a machine sets how many heavy checks (builds, tests,
  validations) run together with `acc machine heavy-slots`, two here, and this
  repo runs up to five builders, on Opus 5.5.
- Setup has a real step for the acc plugin in Claude Code: it checks the plugin
  is installed for every session and installs it from this repo. The README has
  an Install and first run section for someone new, and ONBOARDING.md matches
  the walkthrough.
- Setup no longer re-runs its checks each time a builder saves a file in its
  worktree, and saving a project's settings from the Command Center works again.

## 0.34.0

- A promotion drafts ticket updates for the tasks it carries, as a merge and a
  deploy do. A task two promotions took on arrives with the first to merge.
- A pull request whose GitHub checks fail goes back to its builder, once a
  commit, with the failing checks' report. Autopilot asks GitHub about checks
  once a commit, when they've settled.
- acc runs with no Node installed. A small launcher runs it with Node 20 or
  later when there is one, else with VSCode's own runtime. The plugin's hooks
  never break a session for want of Node.
- Notices can go to Slack: what needs you, finished reviews, pull requests
  autopilot opened, and draft updates waiting. They're off until you turn them
  on, sent once each, and in fixed words.
- Connecting a tracker says to sign in before its lists fill, and tracking a
  ticket from its card hands it to acc as before, now with a test.

## Earlier versions

Versions before 0.34.0 weren't released. See `git log` for what they changed.
