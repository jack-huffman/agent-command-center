# Where this skill came from

- **Source:** https://github.com/danyuchn/asd-ste100-skill
- **Commit:** `32511c6992ecb5f1971e46a2943f2e6adceedafe`
- **Copied:** 2026-10-13, for T-12. The files came from GitHub's archive of that commit
  (`https://codeload.github.com/danyuchn/asd-ste100-skill/tar.gz/32511c6992ecb5f1971e46a2943f2e6adceedafe`),
  which holds the same tree as a clone checked out at it. At its merge (2026-10-13) each copied file and the
  oracle were compared byte for byte with a clone checked out at the commit: all identical. acc never fetches
  the skill at run time.
- **Licence:** MIT, in `LICENSE` beside this file, copied with no change. `docs/THIRD-PARTY.md` has its row.

## The files, and each change

| File | Change | SHA-256 at the commit |
| --- | --- | --- |
| `LICENSE` | None. | `d3c674e8592076c9021a59b55177adbcba6fd7e1710082becb922522b22ec672` |
| `SKILL.md` | Two edits, below. | `39940a0db3d185416edfd757eff4c971006d8f59ad39715295b150b552344342` |
| `references/writing-rules.md` | None. | `4b92c86bf803f9f54e069767d34dc7356fbb95fb52a3f28476093917c608c102` |
| `examples/before-after.md` | None. | `d7bf2b4a390f1997a18790b243dd4c0670018d0d4d5183ec8ed44cbbf282bc52` |
| `examples/linter-edge-cases.md` | None. | `b6cc08af876014453b0c72d26ee4bfaeed1e9a154b5046947392752911ce1774` |
| `scripts/ste-lint.py` | Not in the plugin. It is kept unchanged as a test oracle at `packages/core/test/fixtures/ste100/ste-lint.py`. | `1b97b2d22ba50cde10654db56e1b98adf96d250dd3c8f693f8a81361b1084e85` |
| `README.md` | Not copied. It is the source repo's landing page, and it tells you to run the Python script. | |

The two edits to `SKILL.md`:

1. Process, step 3: the linter step names `acc ste check`, not `scripts/ste-lint.py`. The
   sentences on `--baseline N` and `--disable` became "It exits 1 when it finds a hard violation."
   acc's command has neither option.
2. Additional Resources: the `scripts/ste-lint.py` entry names `acc ste check`. It drops "stdlib-only",
   `--baseline` and `--disable`, and says the tests (not `--selftest`) assert that "may have failed"
   passes clean.

`acc ste check` runs `packages/core/src/ste.ts`, the TypeScript port of `scripts/ste-lint.py`.
`packages/core/test/ste.test.ts` runs the oracle and the port on the same texts and compares each finding.
