## D-T-152 Install and reload updates the Claude Code plugin too (2026-10-30)

T-152. The extension's Install and reload (T-62) changed the extension and the acc it carries, but not the
Claude Code plugin. Builders run the plugin's own acc and its hooks, and a private marketplace doesn't update
itself (D-081), so the plugin stayed behind until the person did Setup's A4, which then failed with "older than
this Command Center". The person asked that the update bring the plugin along: "There's no reason for that to
be a manual step hidden in setup after installing a new version."

- **The plugin step comes after the download check and before the install.** `extension/src/self-update.ts`
  reads `claude plugin list --json` and decides with `pluginPlan` (`extension/src/logic/plugin-update.ts`). It
  updates only a plugin that `userPlugin` finds for every session and that `pluginBehind` finds older than
  the new version: the same reader and comparison as A4 and Settings' About. A plugin that is turned off is
  still updated, because the update doesn't turn it on. A plugin that isn't there, one for one project only,
  or no claude at all is left alone: Setup installs it.
- **It runs A4's own fix line.** `pluginUpdate` in core is now exported, and `pluginUpdateRun` runs it with
  `shellRun` (`extension/src/logic/shells.ts`): acc's own `sh -c` (`inShell`) on a Mac and Linux, and the encoded PowerShell that
  Do it runs on Windows (D-209, T-124). It runs as gh's active account: a token in the environment is left
  out (`activeAccountEnv`, D-088), so the marketplace's git uses the person's own credentials.
- **The progress notification shows the step** as "Updating the Claude Code plugin", only when it runs.
- **A failed plugin step never stops the extension's update.** A failed run, a list that can't be read, or a
  claude that throws gives a reason. The extension logs it ("The Claude Code plugin didn't update to …") and
  saves it in `acc.update.after` with the version. The extension then installs and reloads as before.
- **The message after the reload says what the plugin step did.** A good update adds "The Claude Code plugin
  updated too. Claude Code sessions that are open keep the old plugin until they start again." A failure adds
  "The Claude Code plugin didn't update: <why>." as a warning, with **Update the plugin**, which runs Setup's
  A4 Do it (`acc.step.fix A4.plugin`). A save from before this change, with no plugin outcome, reads as before.
- **Settings' About says the same**, in its details line.
- **Checked by** `extension/test/self-update.test.ts`: the update's steps in order with the plugin step
  between the check and the install, the Windows line through PowerShell, five cases the step leaves alone,
  and three failures that still install and reload. It also checks the message after the reload, with its
  button. A mutant that skips the step fails the first test. A mutant that stops on a failed step fails the
  failures test. `extension/test/plugin-update.test.ts` pins the plan, the lines on each system, a run's
  outcome, the saved outcome, the words, and Settings' About.
- **Not changed:** a failure of the extension's own steps still installs nothing, and the plugin step may
  have run before it. A plugin newer than the extension does no harm (GH-62).
