# Changelog

What changed in each release of Agent Command Center, newest first. The
extension, the plugin and acc share one version. Each release is a GitHub
Release of this repo, with the extension's `.vsix` attached and its entry here
as the notes.

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
