## D-108 A project starts from an epic, an area path or labels, picked on the Connect page (2026-10-07)

GH-81. The author plans to run each new project from an epic in a shared
Jira: "we plan on building out epics and tickets in there for future
projects." A repo's tracker could be narrowed to an epic (D-072) only once the
repo was set up and its tracker connected after. It builds on GH-79's shared
sign-ins (D-091) and GH-80's team templates (D-097).

- **Setup's "What kind of project is this?" offers "From a Jira epic…",**
  beside Salesforce, Other and From a team template. It asks where the rest of
  the settings come from (one of those three, with GH-80's confirmation of a
  template's check commands), reads `acc init … --dry-run --json` for the
  project's name and GitHub, then opens the Connect page (D-073) for a folder
  with no config yet, over Setup. Nothing is written until **Start the
  project**.
- **The place is required in this flow** (a person decided), and the whole
  project isn't offered: taking a whole project stays Other project, then Add
  a tracker. Jira's place is an epic from the project's open epics, Azure
  DevOps' an area path, GitHub's at least one label, monday.com's a group.
  Each tracker's description in `trackers/connect.ts` names which of its
  lists stands in for an epic, with words the page shows under it ("In Azure
  DevOps, an area path stands in for an epic: …"), so the page still names no
  tracker; a test checks each names one of its lists.
- **acc init writes it once.** `acc init --tracker '<json>'` takes one tracker
  as a description's toConfig gives it, and parseConfig checks it with the
  rest. It replaces a template's tracker and `--jira-*`, with a note: flags
  beat templates (D-097). A template's tracker of the same kind on the same
  host keeps its key prefix unless the one picked names its own, as
  withTracker keeps it on a replace. The page's Save runs it with the rest of the
  choice's arguments; acc's refusal shows beside Save in its own words, and
  the page stays open. One write, rather than acc init and then a patch from
  the extension, so a failed second step can't leave a half-started project.
  Back, Cancel or closing the tab write nothing; only a sign-in tested on the
  page stays, in VSCode's secret storage, as D-073 and D-091 allow.
- **A sign-in kept for the new project alone is under the key it will have.**
  The page's sign-in calls take the project as an object, its GitHub repo and
  its ledger in the git directory its clones share, rather than a root looked
  up among open projects, so the key is D-027's from the dry run. A test
  checks the dry run's key and the written config's are the same.
- **A site every project shares fills in signed in** (GH-79). With no
  template tracker, the page takes the first site another repo on this
  machine uses, the most used first, that has a sign-in kept for it. A
  template's tracker fills in its site or organization and its project.
- **This machine lists the repos acc set up:** `~/.acc/repos.json`
  (`ACC_REPOS_FILE` in tests), their roots and nothing else. acc init adds the
  repo it writes, and the Command Center each project it loads, so repos set up
  before count too. A root listed already stays where it is, so loading the
  projects again writes nothing. Each listed config is read when a place list loads, and
  one that's gone or broken is skipped, never holding the list up.
- **A place another repo here uses is marked "used by <repo>"** (a person
  decided what counts): the same Jira epic on the same site, the same GitHub
  label on the same repo, the same monday.com group on the same board, and an
  Azure area path equal to another's, or over or under it ("overlaps
  <repo>"). Names and keys match whatever their case. A clone or worktree of
  the same repo (D-027's key) never counts. The mark is in the list's words,
  and the one chosen says it under the list with a warning icon and words;
  a label says it in its tick. Picking a marked one asks in a modal: Use it
  too selects it, Cancel keeps the choice before. Add a tracker and Change
  mark them too: it's the same list.
- **Nothing is written to the tracker.** The page only reads: a test records
  every request through the Jira, Azure DevOps and GitHub flows and allows
  only GET and HEAD, Azure's two read POSTs (`_apis/wit/wiql` and
  `workitemsbatch`), and gh's api GETs, lists and views, failing on none
  recorded.
- **The README names the place** (B10): `acc setup readme` writes "Its
  tickets come from Jira epic [ACME-3](…/browse/ACME-3)", an Azure area path
  with its project linked, each GitHub label linked to its issues, or a
  monday.com group with its board linked. The key, never the epic's name, so
  it doesn't go stale and nothing is read from the tracker to write it.
  B10.readme applies once a tracker has a place, even with one environment,
  and fails until the README links it. Repos already narrowed to a place see
  it fail until `acc setup readme` runs again. Setup leaves this to B10's Do
  it rather than editing README.md as the project starts.
- **After Start the project** the projects load, the Tasks tab shows the
  board ("Tickets from Jira · ACME · epic ACME-3 …"), every card not done has
  Track (D-074), and Setup checks again.
- Not chosen: creating or changing anything in a tracker; several epics per
  repo, JQL or components (D-072); a template naming an epic, labels or an
  area path (D-097 keeps those per project); the CLI listing epics or signing
  in (D-066); sharing the repos list or sign-ins across machines; a GitHub
  Project picker.
