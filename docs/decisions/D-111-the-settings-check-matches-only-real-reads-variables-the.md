## D-111 The settings check matches only real reads: variables, the config's own reads, and the intake skill (2026-10-08)

GH-122, from GH-107's review. It amends D-103. Its check could pass in three
ways it shouldn't, each a gap in how strictly it matched a read, not a key left
unread today.

- **A listed key read through a variable still fails the list.** A key on
  `UNREAD_KEYS` was looked for only by its qualified name, such as
  `builder.fallbackModel`, while agentArgs reads `p?.fallbackModel` for every
  role. The check now also looks for `.<key>` in the files `READ_IN` names for
  the key's siblings, as the read check does: listing
  `agents.builder.fallbackModel` fails, pointing at agents.ts. This errs
  towards failing the list, the safe side.
- **A `READ_IN` entry can pin the config's read.** An entry is a file or
  `{ file, via }`, where `via` is the read itself. `trackers[].labels` is pinned
  to `tracker?.labels` in intake.ts, where an issue's `i.labels` satisfied it
  before, and `environments[].name` to `env.name` in packet.ts. A finding names
  the pattern it looked for. A sibling search uses only the entry's file.
- **The intake skill is on `RAW_READS`.** It tells a session to read the
  tracker's place from `.acc/config.json`, so each tracker key it names in
  backticks, after "tracker's", "its" or "it names" (`repo`, `labels`,
  `skipLabels`, `project`, `epic`, `areaPath`, `board`, `group`, `prefix`),
  must be one parseConfig knows. A place that isn't source is read from disk,
  whole, comments and all. This closes part of D-103's "the plugin's skills".
- Not done here: pinning the other `READ_IN` entries whose `.<key>` also
  matches unrelated reads in the same file, such as `.repo` in intake.ts, which
  `gh.repo` would satisfy; the other skills that name config keys.
