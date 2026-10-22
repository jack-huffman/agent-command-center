## D-173 The self-update refuses a release that has no checksum file (2026-10-17)

T-72. D-166 let a release with no `.sha256` install, and wrote a line to the
log, since releases before 0.41.0 had none. 0.41.0 has one, and `npm run
release` uploads one with every release, so the exception is no longer needed.

- **Refused.** `checksumCheck` returns the error "the release has no checksum,
  so it isn't installed" when the release holds no checksum file. `install`
  shows it in the notification as it shows a mismatch ("Couldn't update to
  <version>: ..."), offers **Release notes**, installs nothing and does not
  reload. The "installed unchecked" log line is gone, and the result no longer
  has a `checked` field, since a pass is always checked.
- **This changes D-166's "a release with none installs".** A release before
  0.41.0 can't be installed by the update. A person installs it by hand.
- **Checked.** `self-update.test.ts` has a case for a release with no checksum
  file in its table of failures (nothing installed, no reload, nothing saved,
  the reason shown, the notes offered, the folder removed), and the unit test
  of `checksumCheck` expects the refusal.
