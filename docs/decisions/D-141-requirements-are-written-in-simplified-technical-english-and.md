## D-141 Requirements are written in Simplified Technical English, and acc checks their wording (2026-10-13)

A builder reads the analysis's requirements with no one to ask what they mean (T-12). The analyst now
writes the goal, each acceptance criterion, each assumption and each out-of-scope item in ASD-STE100
Simplified Technical English, Strict mode, so each reads one way only. The method is the MIT-licensed
skill at https://github.com/danyuchn/asd-ste100-skill.

- **The copy.** `plugin/skills/ste100/` holds the skill at commit
  `32511c6992ecb5f1971e46a2943f2e6adceedafe`, taken from GitHub's archive of that commit (the builder's
  session refuses git outside its worktree, so it couldn't clone). `LICENSE` is unchanged.
  `SOURCE.md` names the URL, the commit, the date, each file's hash and each change: two edits to
  `SKILL.md` so its linter step names `acc ste check`, and `README.md` left out. `docs/THIRD-PARTY.md`
  has its row, and `scripts/test/third-party.test.ts` fails on a folder under `plugin/skills/` with a
  `LICENSE` file and no full row.
- **The port.** `packages/core/src/ste.ts` ports every structural rule of the skill's
  `scripts/ste-lint.py`: semicolon, phrasal verb, marketing adjective, nominalization, long sentence,
  synonym rotation and dangling conjunction (hard), and passive voice and present perfect (advisory), with
  its protection of hedges ("may have failed" is never a present perfect). Python's `\b` and `\w` are
  Unicode-aware and its columns count code points, so the port's patterns and columns do the same. The
  Python's hard level, `advisory-free`, is `hard` here. Its `--baseline` and `--disable` options aren't
  ported.
- **The oracle.** The Python stays unchanged at `packages/core/test/fixtures/ste100/ste-lint.py`, never in
  the plugin, and `SOURCE.md` pins its hash. `packages/core/test/ste.test.ts` ports each assertion of its
  `selftest()`, then runs it and the port on the same texts (12 samples, and every Markdown file of the
  plugin and the docs, `.acc/rules.md`, the README and CLAUDE.md) and compares every finding: rule and
  line first, then column, level, match and message. It fails with a message when `python3` isn't there,
  on no texts, and on fewer than 100 findings from the oracle. It runs the oracle's own `--selftest` too.
- **The command.** `acc ste check [<file>...]` reads the files, or stdin, prints each finding as the Python
  printed it, and exits 1 on a hard finding. `--json` gives the findings.
- **The analyst.** Its prompt holds the STE Strict rules in full (`STE_STRICT` in `analyze.ts`), so it
  needs no skill installed; the schema's descriptions of the four requirement parts say the same.
- **The record.** `parseAnalysis` runs the port on each requirement line as acc reads the analysis, and
  records each hard finding in the analysis's `wording`, with the part, its place and the line it came
  from. Each line is checked on its own, so a synonym in one criterion never counts against another. A
  criterion, assumption or out-of-scope item is checked as a list item, so one that ends on "and" is
  caught; the goal is a sentence. Advisory findings aren't recorded. Analyses written before this have
  no `wording`, and none is rewritten.
- **Where it shows.** The task page's Analysis section shows an orange "Wording: 2 findings" state with the
  whole-word icon beside the verdict, and lists each finding: where it came from ("Criterion 2"), the
  rule's words, the words it caught and the line. `acc show <id>` and `acc analysis <id>` list them too.
  No finding shows no state.
- **Advice, not a hold.** A wording finding never stops a dispatch: `analysisProblems` doesn't read it, and
  the verdict's state stays as it was.
- **The rule.** `.acc/rules.md` gains: write each requirement that an agent reads in STE Strict mode,
  checked by `packages/core/test/ste.test.ts`.

Out of scope: the official STE dictionary, whose licence doesn't let us copy it; the builder's
instructions, review findings, builder notes and the existing rules text; and rewriting older analyses.
