## D-166 The extension finds a newer release by itself, offers it in a notification, and installs it, reloads and opens the Command Center (2026-10-15)

T-62. A newer release showed only in Settings' About, and a person installed
it by hand. The author asked for the extension to look by itself, offer it,
and install it in one click.

- **This changes D-120's "a release installs by hand".** D-120 chose not to
  install from the page, since the VSIX comes from a private release. The
  install now runs as gh's active account, as About's look already does, so
  the private release is no obstacle. About's newer-release row and the
  notification both have **Install and reload**. D-120's look, its six-hour
  interval and its neutral failed look stay.
- **One look, shared.** `self-update.ts` asks About's `lookIfDue` a minute
  after activation (`FIRST_LOOK_MS`), then each `RELEASE_EVERY_MS` after the
  last look, whoever made it (`nextLookIn`). A look already going isn't
  started twice, and About shows what the look by itself found. A failed look
  stays quiet: no notification, and About's neutral row.
- **One offer for each version.** `shouldOffer`: newer than the running
  version, not the skipped one (nor older than it), and not offered in this
  session. A closed notification counts as offered. **Skip this version**
  keeps the version in global state (`acc.update.skipped`); a later version
  is offered. With `agentCommandCenter.updates.check` off, nothing is looked
  for by itself and nothing is offered; About's Check now still looks, and
  its Install and reload still installs.
- **Install and reload.** `gh release download <tag> --pattern '*.vsix'
  --pattern '*.vsix.sha256'` into a new temporary folder; exactly one `.vsix`,
  named `agent-command-center-<version>.vsix` (`pickVsix`); the SHA-256 against
  the release's `.sha256` when it has one, a mismatch refused
  (`checksumCheck`; a release with none installs, and the log says so, since
  releases before this one have none); `workbench.extensions.installExtension`
  with the file's URI. The temporary folder is removed before the reload,
  since the reload ends this run of the extension, and on every failure.
  Then `acc.update.after` holds the version and the window reloads. Each
  step shows in a progress notification. A failure says which step failed,
  in words, and offers **Release notes**.
- **After the reload.** Activation reads `acc.update.after` and clears it
  (`afterUpdate`). The running version is the saved one: the Command Center
  opens and says "Updated to <version>". Another version runs: a warning says
  the update didn't take.
- **Checksums on a release.** `npm run release` writes
  `agent-command-center-<version>.vsix.sha256` beside the notes, in the
  format `shasum -a 256` prints in the `.vsix`'s folder, and uploads it with
  the `.vsix`. A test compares it with `shasum -a 256` itself. The `.vsix`'s
  name is one function, core's `vsixName`, which packaging and the update
  share.
- **Words and states.** The notification and About speak in processes. The
  newer release stays orange with its arrow icon, and current stays blue.
- Not chosen: updating the acc plugin here (Setup's A4 fix does that);
  Marketplace updates; a modal before the reload (the notification's button
  is the person's click); keeping a session's offered versions across
  windows (Skip is the way to say no for longer).
- Changed by D-173 (2026-10-19): a release with no checksum file is now
  refused, not installed.
