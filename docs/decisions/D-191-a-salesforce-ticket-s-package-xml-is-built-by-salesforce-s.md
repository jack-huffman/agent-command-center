## D-191 A Salesforce ticket's package.xml is built by Salesforce's own CLI, checked against its org, and compared with the org's fresh copies (2026-10-22)

T-101. Builds on D-003, D-015, D-016 and D-024. A person asked for a
`package.xml` built from a ticket, correct, and from the most recent and
relevant metadata in the org. It belongs to the `salesforce` profile.

- **The ticket's paths.** `ticketPaths` (`packages/core/src/manifest.ts`) is
  the one place the manifest reads what the ticket's branch changed. Today it
  calls `branchFiles`: the branch's commits since its environment's branch,
  and in its worktree what isn't committed yet. T-99 keeps each ticket's
  changed paths; it can point this one function at its list. Paths outside
  the project's source folders, and environment-specific files (D-016), are
  left out and counted on the page.
- **Salesforce's own mapping.** `buildManifest` runs `sf project generate
  manifest` with each changed path as a `--source-dir` and the project's
  `sourceApiVersion` from `sfdx-project.json` as `--api-version`, in the
  ticket's worktree, or a scratch checkout of its branch when it has none. acc
  has no path rules of its own for this. A project with no `sourceApiVersion`
  is refused with why. A second generate over the files the base commit
  doesn't hold names the components the ticket creates.
- **Deletions apart.** sf maps the deleted files from the base commit's
  copies, in a scratch project, with `--type post`: they go in
  `destructiveChangesPost.xml`, never in `package.xml`. A file deleted from a
  component the branch still holds, such as one file of an LWC bundle, is a
  change of that component: its other files go to the package's generate, and
  it leaves the deletions. The page says the Command Center never deploys
  deletions, nor the manifest (D-016, and destructive changes left out of v1).
- **Checked against the org.** The development org is the task's
  environment's org (D-015). `sf org list metadata-types` is asked once;
  `sf org list metadata --metadata-type <t>` once a type, and once a folder
  for a type the org says it keeps in folders, such as Report. A
  name is matched as the org lists it or with its %-encoding read. A type the
  org doesn't know, a member it doesn't hold that the ticket doesn't create,
  and a list the org couldn't give are each a finding with why. With no org,
  the manifest is built unchecked and says so.
- **Fresh from the org.** `--check` retrieves the manifest from the org with
  `sf project retrieve start --manifest` into a detached scratch worktree at
  the branch's commit under `.git/acc/manifests/`, never the ticket's
  worktree, and removes it after. Each component whose files then differ
  (known drift and environment-specific files left out, as in drift) says
  "The org's copy differs from this ticket's branch: changed in the org after
  the last commit", with its difference kept for See the difference.
- **Changed in the org, not in the branch.** Where the project uses source
  tracking (T-73), `sf project retrieve preview` runs in the ticket's worktree,
  or the checkout when it has none. Its `toRetrieve` and `conflicts`, but
  ignored ones and the ticket's own components, are listed. With tracking off,
  or a preview that fails, the page says the check isn't available and why.
- **Only a person changes the branch.** `acc manifest retrieve <id>
  <Type:Member>` (Use the org's copy, and Add to this ticket) retrieves one
  component into the ticket's worktree, or a scratch checkout of its branch,
  and commits the source files the retrieve changed as the git identity set
  there; a file left untracked there before the click stays out. `acc
  manifest commit <id>` (Add to the ticket's branch) writes the kept manifest
  to `manifest/tickets/<ticket key>/package.xml`, and
  `destructiveChangesPost.xml` beside it, each written whole, and commits
  them. Both refuse while the task is running and when its worktree has
  changes that aren't committed; a builder, reviewer or analyst can do
  neither. Building and checking commit nothing.
- **Commands.** `acc manifest <id> [--check] [--out <file>] [--json]` builds
  it, keeps it at `.git/acc/manifests/<task>.json`, and with `--out` writes it
  (and the deletions beside it). `acc manifest show <id>` reads it back. Since
  `acc rules` takes `--check` with a value, `acc manifest` gives its bare
  `--check` one before it's parsed. Nothing in it deploys.
- **The task page.** A Salesforce task's page has a "Manifest for this ticket"
  section of its own, after Verify, apart from the changes section T-99
  redraws (`ticketManifest`, `extension/src/model/manifest.ts`). It shows the
  components, the org's findings, each org copy that differs with See the
  difference and Use the org's copy, each org change with Add to this ticket,
  and the deletions. View opens package.xml (and the deletions) beside the
  page, Copy copies package.xml, Save as a file writes both where the person
  chooses. Its buttons are off while one runs, and the branch-changing ones
  while its builder works. The process words are "Build the manifest", "See
  the manifest", "Use the org's copy" and "Add the manifest to the ticket's
  branch".
- Tests: `packages/core/test/manifest.test.ts` has 16, with a real git repo
  and a fake sf that records every call. `packages/core/test/manifest-sf.test.ts`
  has 3: the pinned fixture project (an object and two fields, a flow, an Apex
  class, an LWC bundle, a layout with a space and encoded characters in its
  name, a custom metadata record) and its expected file, each pinned by its
  sha256; a missing fixture failing; and real `sf project generate manifest`
  over it, skipped with its reason where sf isn't on the machine
  (`ACC_REAL_SF=1` turns it on anyway, `0` off). `packages/cli/test/manifest.test.ts`
  has 4, with a fake sf on PATH. `extension/test/manifest.test.ts` has 15. That
  is 38 tests. The screenshot run adds `ticket-manifest`: ACME-19 with an org
  copy that differs, an org change to add, and a deletion.
- Not chosen: deploying with the manifest; comparing with production; and
  naming a changed file that sf maps to no component (sf leaves it out of the
  manifest silently, as a README in a source folder).
