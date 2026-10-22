## D-072 Each repo's tickets come only from its own place in its tracker (2026-10-06)

A Jira board's cards came from the board's own filter, which can span several
projects, and a ticket page opened any key. So a repo could show, and track,
another project's or another client's tickets (GH-50). This is the first of
three tasks: the Connect page (GH-51) and Track on each card (GH-52) come next.

- **Each tracker names its place in `.acc/config.json`.** Always its project or
  repo, and, when set, something narrower: a Jira `epic` (one, by key), GitHub
  `labels` (an issue with any one of them counts, whatever its case) or an
  Azure DevOps `areaPath` (that area and everything under it). Not chosen: Jira
  components, labels, raw JQL or several epics. A key on the wrong kind of
  tracker is a warning and ignored, as `skipLabels` is.
- **An epic's place is its child tickets and their sub-tasks**, not the epic
  itself (a person decided). The board asks for `project = "P" AND parent = E`,
  then for the sub-tasks with `parent in (<those keys>)`, rather than JQL's
  `parentEpic`, which would also bring the epic and is harder to check on every
  site.
- **Every read is held to the place.** The board's cards: a Jira board's JQL,
  and any card from another project the board still returns is dropped; one
  `gh issue list --label` per label, since gh wants all the labels it's given;
  the Azure WIQL adds `[System.AreaPath] UNDER`. A single ticket: one outside the
  place throws `TrackerError` of kind `outside`, which names the place, so its
  page says so instead of failing, and it can't be tracked. A moved Jira issue
  comes back under its new key, so the key and project that come back are
  compared, not the key asked for. Azure work item ids are the organization's,
  so the project is checked even with no area path. `acc intake github` reads
  the GitHub tracker's `repo` (the project's own by default), not always the
  project's.
- **The board says where its tickets come from**, on a line under its name:
  "Tickets from Jira · ACME · epic ACME-3 Premium Support". The epic's name is
  read from Jira as the board loads, not stored.
- **A ticket that leaves the place** (it moved, or the place was narrowed)
  follows D-048: its task leaves the ledger if work never started, with a
  `task.removed` event that keeps the reason; one that started stays on the
  agent board and is named. One helper does this for skipped labels and for
  the place. GitHub's is found by `acc intake github`. Only the Command Center
  signs in to Jira and Azure DevOps (D-066), so after a board loads it asks
  about the repo's unfinished tasks it doesn't show (`outside()`), and hands
  the ones outside to the new `acc intake jira|azure --file`. The started ones
  get an orange notice on the tracker's board, with an icon and words. A failed
  read never counts as outside, and a removed task comes back only when someone
  tracks it again.
- **`acc import` refuses a Jira or Azure key no tracker owns.** It can't check an
  epic or area path without a sign-in, so the intake skill queries only the
  place, and the board's check removes strays. A repo that names no trackers
  takes any key, as before.
- **Posting a draft is held to the project or repo only**, not the narrower
  place (a person decided): a started task's ticket may leave its epic and
  still hear how it went. A draft for a ticket now in another project or repo
  is refused with the reason, and can be discarded.
- **Add a tracker ends with the place**, each picked from a list with the whole
  project, repo or team first: the project's open epics, a tick list of the
  repo's labels (none ticked is the whole repo), or the team's area paths and
  the ones under them. Re-adding one as the whole project clears its place.
