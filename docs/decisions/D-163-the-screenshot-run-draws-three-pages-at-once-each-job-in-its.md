## D-163 The screenshot run draws three pages at once, each job in its own Chrome (2026-10-15)

The screenshot run drew every page one at a time in one Chrome, then ran the behaviour cases and their
mutants one after another: about eleven minutes for a full run. Now it draws `DEFAULT_JOBS` (3) pages at
once, and `--jobs N` sets how many.

- **Jobs** (`extension/scripts/jobs.ts`): `splitJobs` shares the pages out by how tall each is shot, the
  tallest first, each to the job with the least so far. Each job draws its pages one after another, each
  drawing in a Chrome with the job's own `--user-data-dir` (`profile-<slot>` in the run's work folder) and
  its PNGs written into `out/.job-<slot>/` first, then moved into place. The comment that said a fresh
  profile made Chrome hang after the shot no longer held: a profile kept for a job's drawings drew and
  exited in 4 to 6 s each time.
- **Same result:** each drawing's lines, verdict and note are held until those before it are done, so the
  log, the PNG names and `shots.json` are in the pages' order whatever `--jobs` is. `--jobs 1` is one job
  drawing in the old order. `fingerprint`, `noteShots` and `looked.ts` are unchanged.
- **Failures:** a drawing that times out is drawn once more in its own job (`drawRetried`). A Chrome that
  dies, or a drawing with no geometry, fails that drawing only: the run names each one, draws the rest,
  notes what it drew, and exits 1. Before, the run stopped at the first.
- **Behaviour:** the cases, and then the mutants, run in a `pool` of as many slots, each slot with its
  own profile. A mutant builds its bundle into its own folder, `mutant-<i>/main.js`, and runs its cases
  one after another in its slot. The log is in `CASES` and `MUTANTS` order.
- **Timing:** full runs of this commit, back to back, started once no other headless Chrome was running
  and the load average was under 8 (a stuck `adb` and Malwarebytes hold about 3 of the 12 cores all the
  time; other work raised the load to 17 to 34 during the runs, so they were not on a fully idle
  machine): `--jobs 1` 660 s, `--jobs 3` 249 s. Both drew 450 drawings with no findings, ran 35 cases
  and 54 mutants, all caught, and gave the same 542-line log and, for each of the 450 shots, the same
  fingerprint, findings and classes drawn in `shots.json`. 142 PNGs' bytes differed; two runs of the
  same pages at `--jobs 1` differ the same way (7 of 12 PNGs for `loading` and `tasks`), so Chrome's
  PNG bytes aren't the same from run to run whatever `--jobs` is.
- **Checked:** `extension/test/jobs.test.ts` adds 11 tests: the splitter finds each page once across the
  jobs; an empty list, k above the count and k below 1; `--jobs`; results handed on in order; `runJobs`
  and `pool` with a failing job; `runAsync`'s output, timeout and missing program; three pages drawn with
  `--jobs 1` and `--jobs 3` by a stand-in Chrome give the same findings, counts, log and record; a Chrome
  that dies fails its drawing only; and the behaviour pool with each mutant in its own folder.
  `steady.test.ts` adds 1 for `drawRetried`.

Out of scope: skipping pages that did not change, which needs a fingerprint per page.
