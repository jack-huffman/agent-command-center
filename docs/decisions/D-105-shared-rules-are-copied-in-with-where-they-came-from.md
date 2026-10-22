## D-105 Shared rules are copied in, with where they came from (2026-10-07)

A lesson learned in one project should reach the next project's agents
(GH-108). Each repo had only its own `.acc/rules.md`, and nothing carried a
rule across. PhotoCraft's sibling apps read shared standards by a relative
path (`../craftrules`), which breaks for anyone who clones one app alone; its
release playbook copies files in, and each app keeps its own. D-098 chose the
second: anything taken from elsewhere is copied in, with where it came from.

- **A copy, never a link.** `acc rules import <source>` copies a rules file into
  `.acc/rules/<name>.md`, named after the source's file or `--name`. The source
  is a path, a GitHub file URL or `<git-url>#<path>`, read and refused exactly
  as a team template is (D-097): one module, `source.ts`, now serves both,
  each naming itself in its messages. A person commits the copy. Shared rules
  are the author's own text, not skills, so D-002 holds.
- **The header is the only record.** The copy starts with an HTML comment:
  its source (a path recorded from the repo's root or `~/`, never a home path,
  D-079), the commit it was read at (on GitHub, the last commit to change the
  file at its ref; in git, the clone's HEAD; none for a path), the day it was
  copied, and the sha256 of the text as copied. It's read strictly, and no
  config key repeats it. A file in `.acc/rules/` with no header is rules kept
  here, with no source to compare.
- **Agents read only the repo's files.** The packet, the review and the
  analysis each get one Rules section, in a fixed order: the profile's rules,
  then each copy by file name, then `.acc/rules.md`. A sentence says the later
  one wins, so the repo's own rules win where they conflict. Nothing reads a
  source at dispatch, review or analysis, so a source that moves or goes
  changes nothing: the packet is byte for byte the same.
- **The profile's rules are the reviewer's old Salesforce focus list.** No
  rules text existed per profile; the reviewer's system prompt had four
  Salesforce lines builders never saw. They're `PROFILE_RULES.salesforce` now,
  first in the section every agent gets, and out of the system prompt so
  they're said once. A generic project has none.
- **An update is a person's choice.** Setup's B0.rules step reads each source
  again, sharing 20 seconds, and compares digests, so an edit made in the repo
  never counts as a change at the source. Unchanged: pass, naming copies
  edited here. Changed: check by hand, with `acc rules diff <name>` as the fix,
  which shows the copy against the source now (what copying in again would
  change) and says when that would replace edits made here. Unreadable: check
  by hand, with the reason. A path not on this machine: doesn't apply. A
  header's source is untrusted, as a committed config's is: one acc won't fetch
  never reaches gh or git. To take a change, a person runs
  `acc rules import <source> --name <name> --force`; there's no merging.
- **A team template may name rules** (`"rules": [<source>, …]`), each a URL or
  a path from `/` or `~/`: a relative path would mean a different file on each
  machine. `acc init --from` reads every one before it writes anything, then
  copies each in, keeping a copy already there. B0.template counts `rules` as
  different when the template names a source with no copy.
- **Limits:** each file at most 64 KB, as a template; all the copies together
  at most 128 KB, since every packet, review and analysis carries them. An
  empty file, or one with a NUL, is refused.
- **A person's, not a builder's.** The hook and the builder's deny list refuse
  `acc rules import`; `acc rules list` and `acc rules diff` only read. Copies
  live under `.acc/`, so the merge queue and autopilot leave them to a person.
- **`--name`, not `--as`:** `--as` is every command's actor option.
- **Setup's row always offers Import rules…,** from a step's new `offer` field,
  so the page and the walkthrough both show it. It previews with
  `acc rules import --dry-run --json` before anything is written.
- Not done here: the `.acc/packet.md` override and `templates/packet.md` that
  DESIGN.md §8 names still don't exist.
