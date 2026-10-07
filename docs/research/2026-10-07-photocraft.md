# PhotoCraft review, 7 October 2026

PhotoCraft (<https://github.com/storytold/photocraft>) is an open-source,
clean-room image editor in the style of Photoshop, written in Rust. This review
asks how it was built, and what Agent Command Center and our other projects
should borrow. It was read from two local copies: the snapshot of 7 October
(`~/Downloads/photocraft-main`) and a clone one day older with its git history
(`~/Downloads/photocraft`). Nothing was built or run. Paths below are relative
to the PhotoCraft repo.

Every claim was checked against code, CI or git history unless it says
otherwise. Where PhotoCraft's docs and code disagree, this review says so.

## What it really is

It looks like a mature product. It is one week old, built by agents.

- The first commit is 30 September 2026. The second is called "one-shot" and
  adds 241 files and 42,241 lines. By 7 October there are 263 commits and
  259,525 lines of Rust in 24 crates and 3 apps, with 3,113 tests.
- One maintainer wrote 189 of the commits. 141 of 263 carry a
  `Co-authored-by: Claude` trailer. Parallel Claude sessions did most of the
  work, and community pull requests (fixes, translations) began on day 4.
- It does not have Photoshop parity, and says so. The README's status note:
  "it is not yet a Photoshop replacement for daily professional work". The
  roadmap's own estimate is "well below 50%", and 25–35% for "a professional
  could switch for daily work".

So the lesson isn't the editor. It is how one person kept a swarm of agents
building a single coherent system for a week, which is the problem ACC exists
to solve.

**Verdict:** borrow the mechanisms, not the stack. Their best ideas are already
half-present in ACC (packets, gates, receipts, a reviewer, a decision log).
Their failures are just as useful, because nearly every one is a rule nothing
checked.

## The core idea: a rule holds when a tool checks it

PhotoCraft's `AGENTS.md` states about a dozen golden rules. The ones a tool
enforces held across 260,000 lines of agent-written code. The ones written only
in prose decayed within days.

| Rule | How it's checked | Result |
|---|---|---|
| No `unwrap`/`expect`/`panic!` in non-test code | Clippy deny attribute in all 27 crate roots, CI fails on warnings | 0 `unwrap`, 3 sanctioned `expect`s with a reason. Held |
| No `unsafe` | `unsafe_code = "forbid"` in the workspace; one isolated crate | One file, 3 blocks, each with a `SAFETY:` comment. Held |
| Crates depend only on lower layers | `cargo xtask layers`, in CI on 3 OSes | Held |
| A new document field is saved | `crates/format/src/convert.rs` names every field, so a new one doesn't compile | Held |
| Menu parity never drops | `FLOOR` constant plus a test | Held, but the floor is raised by hand and trails (620 vs 626) |
| Never hard-code a colour | Prose only | 316 colour literals outside the theme file |
| Use `get()`, not `[i]` | Prose only (the lint isn't enabled) | Direct indexing on file-derived data |
| No `assert!` in shipped code | Not covered by the panic lint | 21 asserts in non-test code |
| Every command survives junk input | `panic_hunt` test, but `#[ignore]`d and run by nothing | The scorecard marks it done because the file exists |
| Status rows are true | Hand-written TOML; CI only checks the doc matches the TOML | Atomic save shipped 23 minutes after the row said "missing"; it still says missing |

The pattern to take: **a rule enters as prose, and earns a check before anyone
relies on it.** Their "never crash" rule shows the full path. Community pull
requests fixed panics on day 4. The rule went into `AGENTS.md`. A fuzz harness
and the clippy settings followed. Then 11 pull requests, one per crate ("Never
crash: X is panic-free"), merged in 15 minutes from parallel agents. Last, the
rule was published as a shared standard for the sibling apps. That took about
14 hours.

## What they do, by area

### One hub file for agents

`AGENTS.md` (133 lines, vendor-neutral; there's no `CLAUDE.md`) is the first
thing every agent reads. Its fixed shape:

1. **Orientation table**: each doc, and why you'd read it.
2. **Workspace map**, by layer.
3. **Golden rules**, ranked. "Never crash" is placed above feature work.
4. **Picking work**: a ranked list of where to look. The honest assessment
   comes first, then the scorecard, current focus, missing menu items, and the
   dev log's "still open".
5. **Before you finish**: one copy-paste shell block. Each line says when it
   applies (`cargo xtask wasm  # if you touched L0–L6`). It ends with "append a
   terse entry to `log/devlog.md` … Sessions can end abruptly (crashes, context
   limits), so the dev log plus a green tree is how the next agent picks up."
6. **Parallel agents**: your own build directory; new commands in a new file
   with a `specs()` function, so shared registries get one-line edits; "If
   someone else's in-progress edit breaks the build, wait and retry; don't fix
   their files"; write manifests to a temp file, then move them into place,
   because one half-written `Cargo.toml` breaks every agent's build.
7. **Where things are tracked.**

The parallel-agent rules came from pain. One early commit is titled "Analysis,
notes, proof views, workspaces (+ in-progress work of other agents)" and
touches 162 files.

### Everything is a command

Every user-visible action is one record in one registry (`crates/engine/src/commands.rs:14-28`):

```rust
pub struct CommandSpec {
    pub id: &'static str,              // "filter.blur.gaussianBlur", Photoshop's menu tree
    pub label: &'static str,
    pub menu: &'static [&'static str], // ["Filter", "Blur"]; empty = not in menus
    pub shortcut: Option<&'static str>,// "Cmd+Shift+N", shown per platform by the UI
    pub params: &'static str,          // {"radius":px=4,"mode":"a|b"="a"}; agents read this
    pub enabled: Enabled,              // Ok(()) or Err("Trap needs a CMYK document (Image › Mode › CMYK Color)")
    pub run: Run,                      // fn(&mut Session, &Value) -> Result<Value>
    pub journal: bool,
}
```

- About 660 commands. Each area has its own file (`<area>_cmds.rs`, 63 of
  them), joined by 69 one-line `v.extend(module::specs())` calls.
- **`enabled` returns a reason, not a boolean.** The same text greys out the
  menu item, fills its tooltip, and becomes the agent's error message.
- **The UI, CLI, control channel and MCP server all dispatch by id** through
  one function. That function rejects bad params, checks `enabled`, checks for
  a running job, catches panics and journals the call. Anything a person can
  click, an agent can run.
- **One command is one undo step.** `Session::edit` clones the document
  (cheap, because tiles are shared copy-on-write), runs the change on the copy,
  and swaps it in only if it succeeded. A failed command can't half-apply. A
  `coalesce` key folds slider drags and typing into one step.
- **The params string drives three things**: the generated dialog, the live
  preview (the same command, run on a downsampled copy), and what agents read
  from `command_list`.
- **Menu parity is data.** `crates/ui-egui/src/menu_catalog.rs` lists all 765
  Photoshop menu rows with their ids and shortcuts. A menu item goes live by
  itself when a command with its id exists. An agent implements an id and gets
  the placement, label and shortcut for free.

### Architecture held as data

`xtask/src/layers.rs` holds the crate layers as a table. A crate may depend
only on lower layers, UI toolkits are banned below the UI layer, and **a crate
that isn't in the table is an error** ("register it in xtask/src/layers.rs
TABLE"). Exceptions are an exact named list, with a test that pins how far each
one reaches. Format crates (PSD, codecs, colour management) depend on nothing
else in the workspace, so they could be published alone.

### Tests that a number can't game

- **A free oracle.** A PSD file carries Photoshop's own merged image. The tests
  render each file's layers and compare against it (within 2/255), then save,
  reopen and compare again (within 1/255). Real files become a conformance
  suite nobody had to write.
- **Floors that only go up.** Pass counts are constants in the test source:
  `pass_floor: 229, roundtrip_floor: 307` for the 309-file psd-tools set
  (`crates/io/tests/corpus.rs:151-159`), with "Raise the floors when they
  improve; never lower them." A pull request can land partial progress, but it
  can't land a regression, and an agent can't "fix" a test by deleting cases.
  Commit subjects carry the change: "corpus 133 → 140".
- **Tolerances are derived, not guessed.** Where Photoshop's behaviour isn't
  public (the Dissolve blend mode's random pattern), the comment works out the
  allowed error from the noise statistics.
- **Tests that catch stubs.** `every_filter_changes_something_and_respects_zero_selection`
  (`crates/algo/src/tests.rs:91`) fails any filter that does nothing, the
  kind of placeholder agents tend to write. `every_filter_is_tile_independent`
  requires identical output at tile sizes 256 and 7.
- **Every real-world failure becomes a small synthetic test** named after the
  file that exposed it, so the fast default suite covers it without the corpus.
- **Hostile input.** Every prefix of a valid file must fail cleanly, and the
  whole file must parse (a positive control). Seeded byte flips run against
  every corpus file.
- **Determinism.** Randomness is derived from document coordinates and a seed,
  never from thread timing, so brush strokes replay exactly. A flaky test was
  fixed by sorting font names that came from an unordered set. A test that
  changed process-wide state was moved into its own process.
- **Fixtures are pinned, hashed and kept out of the repo.** One file holds the
  commit of each external corpus, and every file is checked against a sha256
  list. Corpus tests are off by default, but **once switched on, a missing
  corpus fails** with the command that fixes it. It is never a silent skip.
- **Fix discipline.** In a sample of 17 fix commits, 16 shipped a test or a
  check.

### Status that is generated, and an honest assessment

- `docs/parity.md` and `docs/scorecard.md` are generated from data files and
  marked "do not edit by hand". CI regenerates the scorecard and fails if the
  committed copy differs. The same check also runs as a unit test, so an agent
  that skips the checklist but runs the tests still catches it.
- Every failure message names its fix: "stale: run `cargo xtask scorecard` and
  commit".
- **Performance budgets never invent a number.** A scenario with no benchmark
  says `not_measurable = "<why>"`. A target the code doesn't meet yet is shown
  with `enforce = false` and a dated comment, and the rule is to flip it in the
  pull request that meets it.
- **Settings that do nothing are counted and hidden.** A source scan finds
  preferences nothing reads (60 of 135, target 0). Those are listed in
  `HIDDEN_UNTIL_IMPLEMENTED` and hidden from the dialog, because "a control
  that does nothing is worse than a missing one". A test fails both ways: if a
  hidden setting is read anywhere, or a visible one is read nowhere.
- **The honest assessment outranks the vanity number.** By day 5 the menu was
  100% wired, but real users found "214 shortcut failures" that "all counted as
  'live'". The roadmap now opens with a dated, per-dimension assessment that
  tells agents: "read it before picking work. Update it (with dated
  measurements) when the numbers move; don't restate the menu-parity number in
  its place." It gives two headline figures with a confidence level, and plans
  for the real headline to become the pass rate of 30–50 scripted workflow
  tests.

### A UI that agents can drive and check

- All UI state, including open dialogs and their field values, is one
  serialisable struct. `ui.inspect` returns it as JSON, so an agent checks
  state rather than guessing from pixels.
- The control channel is loopback-only and authenticated. It has bounded
  requests, and input calls reply only after the app has processed them, so
  the next `ui.inspect` sees the effect.
- **One dispatch function serves the live socket and an offscreen harness.**
  The `snapshot` example renders the real app with no window and no stolen
  focus, running the same script vocabulary. The README's screenshots were
  made this way, on public-domain paintings.
- **Layout is tested by geometry, not golden images.** For example,
  `no_menu_or_submenu_covers_the_menu_bar` opens every submenu at three real
  display sizes, and asserts it checked more than 30, so it can't pass on
  nothing. Other tests run across every theme, at 1× and 2× scale, at several
  widths. There are no pixel-diff tests at all.
- **Tests find widgets by accessible name**, as Testing Library does. Custom
  widgets are named "for screen readers and UI tests", so one effort serves
  accessibility, tests and agents.
- **A cross-product contract for input.** Every displayed shortcut, in each of
  4 focus places, must either run its command or say why not. That turned
  "214 failures" into 0 and kept it there.
- **Translations by source scan.** English strings are the keys, with one
  file per language. A test scans the source for every translatable literal
  and fails if a language marked complete is missing one. Community members
  added 10 languages within a day.

### Commits, pull requests and releases

- Early commits were "one-shot", "continued wip". After the first release and
  the first outside pull requests (day 4), every change went through a pull
  request and was squash-merged.
- Subjects state the behaviour a user sees, with the area first: "Crop tool:
  move the frame, resize from its handles, Space repositions while drawing
  (#132)". Bodies give the reason, then an evidence footer: "4 tests; engine
  green, clippy clean, wasm OK. Parity 609 -> 618 (98.9%); FLOOR 613."
- Clean-room provenance goes in the body: "Reverse-engineered from Photoshop
  2026 ground truth (a 0..255 ramp pushed through the app…)".
- Releases come from a `release` branch. Signing secrets live only in an
  environment restricted to that branch. Every secret is optional, so a fork
  gets unsigned builds and a warning, not a failure. The workflow makes a
  draft release a person checks and publishes, and it refuses to overwrite a
  published version.
- Size limits carry their reason: the web build fails above 24 MiB because
  Cloudflare rejected a 25.8 MiB file.

### Provenance and hygiene

- Each asset folder keeps its licence file beside it, and `ATTRIBUTION.md`
  gets a row (path, title, author, source, licence) in the same change.
- The clean-room rule names what may be read: public specs and observed
  behaviour, never proprietary code, and for raw photo decoding never GPL code
  either.
- Downloads use a generic User-Agent, with no names or emails. Demo images are
  public domain, with a sources file.

### Shared standards across sibling apps

PhotoCraft is one of eight "Craft" apps. They share a `craftrules` repo of
standards (never-crash, fonts, licensing, contributors, release playbook) but
**never share code**: "Contribute reusable learnings there, never code."
The release playbook was first written inside PhotoCraft as the reference
implementation, then moved to `craftrules` with a pointer left behind. Other
apps copy and own their version, and improvements flow back to the playbook.

## Where it falls short

These failures are as instructive as the successes.

- **Present is not passing.** `panic_hunt` is ignored and nothing runs it, yet
  the scorecard marks it done because the file exists
  (`xtask/src/scorecard.rs:486`). The GPU-versus-CPU tests print "skipping" and
  pass when there's no GPU, as on the CI runners. Fuzz targets exist, but only
  run by hand.
- **A freshness check proves the doc matches its data, not that the data is
  true.** Hand-set checklist rows went stale within an hour.
- **Ratchets raised by hand lag.** The parity floor is 620 with 626 live.
- **Handoff notes they can't share.** The dev log and plans are gitignored.
  Code comments and `AGENTS.md` point at them, but no fresh clone,
  contributor or agent on another machine can read them.
- **The architecture doc is the day-1 plan.** It describes types that don't
  exist (`CommandRegistry`, `Op`/`Transaction`, `TileStore`, `DocSnapshot`),
  and its "open decisions" were all decided. Decisions otherwise live in
  scattered issue numbers ("#569 decision"), with no index.
- **"A new file per area" breeds copies.** There are 44 local copies of
  `fn bad` and about 15 local `spec!` macros, and some comments are stale
  ("Check Spelling is not implemented"; it is, in another file). Nobody
  budgeted a consolidation pass.
- **Numbers restated by hand rot.** The roadmap gives three different PSD pass
  counts, none matching the scorecard. The README says "more than 1,700 tests";
  there are 3,113.
- **Agents' scratch files reached main:** `fb-test.log`, `fb-clippy.log`, and
  a 1,929-line `test.tmp`.
- **Squash merges lost trailers and bodies** on days 6–7, the same trailers a
  planned credits screen reads. 74 subjects carry the pull request number
  twice, because the agent wrote it and GitHub added it again.
- **Rules without a check still leak**, even in the UI that enforces the most:
  316 colour literals, and a status-bar error shown by colour alone.

## What ACC already does better

- **Decisions are indexed** (D-001 onwards, newest last, with reasons).
  PhotoCraft has none.
- **Receipts tie each check to a commit**, record who waived what and why, and
  go stale when the commit changes.
- **A fresh, read-only reviewer** judges each change against the criteria and
  rules. PhotoCraft relies on its gates and the maintainer.
- **Pull request bodies are built from receipts and the verdict**, so the
  evidence footer can't be forgotten.
- **Each task gets its own worktree**, which is stronger than PhotoCraft's
  shared tree with a build folder per agent.
- **There's a CHANGELOG, a secret scan, and a personal-data scan** of the
  package.

## Worth borrowing for ACC, ranked

1. **Ratchet gates.** A gate whose command prints a number, checked against a
   floor (or a ceiling) kept in `.acc/`. The gate fails if a change drops below
   it, and acc raises the floor itself when a merge beats it. That fixes
   PhotoCraft's lag. It would work for test counts, coverage, Apex coverage
   and Code Analyzer violations (a ceiling). It comes first because it's the
   one mechanism that stops agents trading quality for speed, it works in
   every profile, and it fits receipts as they are. *Lands in:* DESIGN §9,
   `gates.ts`, receipts.

2. **Receipts that say how much ran.** Read the test totals (run, skipped,
   todo) from `node:test`, Jest and Apex output into the receipt. A gate that
   ran no tests, or whose skipped count went up, needs a person rather than
   passing. PhotoCraft's two worst false greens were exactly this, and a
   builder that marks a test `skip` to get green is the same failure. ACC
   records test totals for Salesforce today, but not for generic gates.
   *Lands in:* `receipts.ts` `details`, the generic profile.

3. **A handoff note on `acc done` and `acc block`.** The builder writes three
   short lines: what landed, which numbers moved, and what's still open. acc
   keeps the note in the ledger, shows it to the reviewer, puts it in the next
   builder's packet (rework or follow-up) and in the pull request body.
   PhotoCraft's dev log is how its next agent picks up after a crash, but it's
   local and gitignored. ACC can hold the note properly. Today `acc done` only
   moves the task to review. *Lands in:* the CLI's `done`, the packet,
   `prBody`.

4. **Recurring findings become rules, then checks.** ACC keeps every verdict.
   Count findings by rule across reviews. When one keeps coming back, the
   Command Center proposes a line for `.acc/rules.md`, and later a gate. This
   is PhotoCraft's never-crash loop as a feature: prose rules decayed, and
   checked rules held. *Lands in:* the review verdict store, the Command
   Center.

5. **A scratch-file gate.** A cheap built-in check: a change may not add
   `*.log`, `*.tmp` or new files at the repo root unless they are listed. It
   sits beside the secret scan. Agents commit their scratch output; PhotoCraft
   proves it. *Lands in:* the gates' built-ins.

6. **Generic-profile rules that make parallel work merge cleanly.** "Put new
   behaviour in a new file and register it with one line. Don't fix another
   task's breakage. Write manifests to a temp file, then move them into place."
   These sit alongside D-093's file overlap. Pair them with a consolidation
   task after a burst of parallel work, which is the step PhotoCraft skipped
   (44 copies of `fn bad`). *Lands in:* the generic profile's rules, the
   autopilot.

7. **In this repo: turn the UI rules in CLAUDE.md into tests.**
   - Every state the UI shows has both an icon and a label, checked by
     scanning the state tables.
   - No colour literals outside the theme stylesheet, with a short allowlist.
   - Geometry checks in the screenshot harness: at several widths and in both
     themes, nothing overlaps, nothing clips, and the selected tab stays
     visible.

   PhotoCraft's "never hard-code a colour" ended in 316 literals, and its
   layout tests caught real bugs. CLAUDE.md says "Tests can't see a broken
   layout"; PhotoCraft shows they can see most of one. The icon-and-label rule
   matters too much, for a colourblind author, to rest on prose. *Lands in:*
   `extension/test`, `extension/scripts/screenshot.ts`.

8. **In this repo: a junk-input test for every command.** List every `acc`
   subcommand from the CLI's own table, and every command in `package.json`.
   Call each one, in a throwaway repo, with missing, empty, wrong-type and huge
   arguments, under a timeout. Each must end with a message, never a stack
   trace or a hang. Because it reads the registry, a new command is covered
   without anyone remembering. It runs in `npm run check`, never ignored.
   *Lands in:* `packages/cli/test`.

9. **Settings that do nothing, checked both ways.** A test that every
   `.acc/config.json` key and every extension setting is read by code and
   described in DESIGN §4, and that nothing reads a key that isn't defined.
   This is PhotoCraft's `HIDDEN_UNTIL_IMPLEMENTED` idea. *Lands in:*
   `packages/core/test`.

10. **A shared rules repo across our projects.** Learnings, never code, as in
    `craftrules`. This fits D-002. It would start from the list below. Whether
    it's worth a repo yet is the author's call.

## Worth borrowing for any project we build

- One hub file for agents: what to read and why, a module map, ranked rules,
  how to pick work, a "before you finish" block where each line says when it
  applies, and the rules for parallel work.
- Every rule gets a check before anyone relies on it. A prose rule is a
  backlog item for a lint, a test or a gate.
- Every action is a command with an id, a params description and an
  `enabled` that gives a reason. The UI, CLI and agents all call it.
- Architecture rules are data, and an unregistered module is an error.
  Exceptions are a named list with a test that pins how far each reaches.
- Floors that only go up for every quality number, raised by the tool.
- Find a free oracle: an independent source that already holds the right
  answer.
- Tests that catch stubs: every feature must change something.
- A check must prove it ran. Count cases, fail on zero, and never let a skip
  pass silently.
- Generated docs are checked twice: in CI, and as a unit test. Each number
  lives in one generated place. Hand-set statuses carry evidence and a date.
- A dated honest assessment that outranks the vanity metric, which agents
  read first.
- Hide what doesn't work. Disable with a reason, never a control that does
  nothing.
- Check layout by geometry across themes, scales and widths. Name every
  control accessibly. Make UI state inspectable as JSON.
- Pinned, hashed fixtures kept out of the repo. Once switched on, a missing one
  fails.
- Handoff notes live where the next agent can read them, never in a gitignored
  folder.
- Commit subjects say what a user sees. Bodies end with evidence: tests added,
  gates passed, numbers moved.
- Licence beside each asset, an attribution row in the same change,
  public-domain demo content, and no personal details in requests.
- Budget a consolidation pass after a burst of parallel agent work.
