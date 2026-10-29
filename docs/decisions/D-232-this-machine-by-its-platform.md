## D-232 The Command Center names this machine by its platform: This Mac, This PC or This computer (2026-10-29)

T-150. A coworker set the Command Center up on Windows, and it still said "This Mac" there: the place of a
local builder or review, and the messages that send a person back to this machine. D-209 says acc works
natively on a Mac and on Windows, so its words must too.

- **One function in core names this machine** (`packages/core/src/this-machine.ts`): `machineNoun` gives
  Mac on darwin, PC on win32 and computer on any other platform. `thisMachine` gives "this Mac", "this PC" or
  "this computer" for the middle of a sentence, and `thisMachineLabel` "This Mac", "This PC" or "This
  computer" for a label. Each takes a platform and reads `process.platform` when none is given, at the call.
- **Every message about this machine uses it.** The CLI (`acc cloud`, `acc review`, `acc dispatch`'s help,
  `acc show`), core's refusals and reasons (a cloud review that needs you, a collect, Dispatch again, the
  missing `claude`), the extension's cards, In progress, Settings and quick picks, and the cloud builder's
  prompt ("acc runs them on the PC when it collects your branch"). `BUILDER_PLACE_LOOK` is now
  `builderPlaceLook(platform)`. Build it's sheet takes the platform as an input, so the screenshot run draws it
  as Windows on its `dispatch-sheet-windows` page, where the place reads This PC.
- **On a Mac nothing reads differently,** but for one hidden title: the `acc.task.reviewLocal` command's
  title in `package.json`, which a manifest can't vary by platform, is now "Review on this machine". The
  command palette hides that command; its button on a card still says "Review on this Mac" on a Mac.
- **Words about a Mac only stay as they are:** the keychain that keeps the scheduled task's token on a Mac,
  Homebrew, caffeinate, and "when the Mac slept" (D-067), which is about a Mac going to sleep.
- **Checked by** `scripts/test/this-machine.test.ts`: it reads acc's code, the extension's pages and
  commands and the agents' prompts, and fails on a line outside a comment that says "this Mac" in its own
  words. Its exceptions are a named list of the five files that speak of a Mac's keychain, each with the
  number of lines it reaches pinned. `packages/core/test/this-machine.test.ts` pins the words for each
  platform, and runs core's messages and the cloud prompt as Windows, so a function that says Mac on win32
  fails. The tests that pinned "this Mac" pin `thisMachine()` now, so they pass on the Windows CI job.
- **Not changed:** the cloud guard's message "acc cloud enable writes it, on the Mac". The guard is a file
  written once and committed for a cloud session to run, so it can't follow the platform of whoever reads it.
