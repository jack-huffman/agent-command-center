## D-103 Every config key and setting is read and described, checked both ways (2026-10-07)

GH-107. A setting that does nothing is worse than a missing one: PhotoCraft
found 60 of its 135 preferences read by nothing. acc's `.acc/config.json`, the
extension's settings and DESIGN §4's table could drift the same way, and had:
§4 described 21 of the 57 keys, and the README neither setting.

- **The keys parseConfig knows are data.** `CONFIG_KEYS` in config.ts lists
  every key by its path: `gates.severity`, `environments[].org`,
  `trackers[].team`, `agents.builder.model`. A list of strings or a map such as
  `gates.commands` is one key. It's typed against `Config`, so tsc refuses a
  path that isn't one, and a key a Config has that's left out.
- **An unknown key warns at every level**, from that list: `gates.foo`,
  `trackers[0].foo`, `agents.builder.foo`. Before, only the top level,
  `autopilot` and `dispatch` warned, and a misspelt nested key was dropped
  without a word. A config that loaded quietly may now print a warning; it's a
  warning, not an error, and what the config does is the same.
- **scripts/test/settings.test.ts checks both ways.** Each key has a read in
  source outside the tests, and is described in §4's Field table: a row of its
  own, or its nearest parent's row naming it in backticks. Each contributed
  `agentCommandCenter.*` setting is read with
  `getConfiguration('agentCommandCenter').get('<name>')` in extension/src and
  named in README.md. Every setting extension/src names is contributed, and
  every key read from a raw parse of .acc/config.json, at the three places
  `RAW_READS` pins, is one parseConfig knows. Each part asserts how many it
  checked, and each finding names the key, what's missing where, and the fix.
- **What counts as a read.** TypeScript 7 has no language service to ask, so
  it's the source text: a qualified read, such as `gates.severity` or
  `autopilot?.autoMerge`, anywhere; for a key read through a variable (an
  environment's, a tracker's, an agent role's, the secret scan's, the
  template's), `.<key>` in the files `READ_IN` names. A pointer that goes stale
  fails, and says to move it. Comments and quoted strings don't count, nor does
  config.ts's validator, its writers or its key lists (`NOT_READS`, pinned by
  declaration); its helpers that act on a key, such as `autoMergeOn` and
  `defaultEnvironment`, do.
- **Two keys only the validator reads, pinned.** `VALIDATOR_ONLY` holds
  `schema`, which must be 1, and the raw `environments[].branch`, which must be
  the lower-cased name; code reads the branch it derives from the name. The
  test pins the list to these two, so it can't grow quietly.
- **A key nothing reads is listed before it's removed.** `UNREAD_KEYS` takes
  it, with the ticket or decision that will read it, and the test fails once
  something reads it, so it comes off. Remove a key only when no decision or
  doc promises it: a removed key makes configs that set it warn. The list is
  empty today.
- **The Command Center hides a listed key.** How agents run tags each part and
  row with its key and shows none that's listed, nor a role with no parts left;
  the Connect page offers no picker whose `trackers[].<key>` is listed, and
  keeps the tracker's value for it. An extension setting is never listed:
  VSCode's Settings can't hide a contributed one, so a setting nothing reads
  comes out of package.json.
- **Gaps fixed:** §4 has a row or a named mention for every key, and its
  `worktrees.root` row and example say `.claude/worktrees/`, per D-022, not a
  sibling folder. The README has a Settings part.
- Not done here: the team template's own keys (template.ts's `ALLOWED` and
  `PROJECT_ONLY`, where `dispatch` and `gates.builder` get the generic "isn't
  a template key" error), writing §4's table from `CONFIG_KEYS`, and the
  plugin's skills, which name tracker keys in prose.
