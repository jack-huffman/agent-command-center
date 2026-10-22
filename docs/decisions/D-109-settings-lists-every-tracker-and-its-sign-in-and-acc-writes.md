## D-109 Settings lists every tracker and its sign-in, and acc writes a tracker (2026-10-07)

GH-112, the fourth of the six tasks GH-109 began. A tracker's sign-in, its place
and connecting another were on each tracker's board on Tasks, one project at a
time, and Sign out was only a command. This amends D-073 and D-091.

- **One list across the open projects,** in Settings' Trackers and sign-ins,
  each project under its name, as How agents run does (D-104). Each tracker
  shows its kind and title, where its tickets come from and its board (D-072),
  and who it signs in as, for every project on its site or this project only
  (D-091). It's drawn from what each board already knows (`BoardInput`), so
  Settings reads no tracker and no secret of its own. A project with none
  says so, and one whose trackers haven't been read yet says it's reading.
- **Where each is set:** the place and the board say "project", with a repo
  icon: they're the project's `.acc/config.json`, and no clone sets them. The
  sign-in says "VSCode on this machine", with a key, or for GitHub "gh on this
  machine". It's never in a file.
- **Every state has an icon and words,** blue or orange: signed in for every
  project on the site (a globe) or this project only (a repo); not signed in
  (a plug); signed in but refused, with the tracker's reason (a warning); gh
  as the project's account. The board: its name once read, Reading it (a
  spinner), Shows once it's signed in, or why it couldn't be read. The sign-in's
  line says what's wrong with it, and the board's doesn't say it twice.
- **Sign in again, Sign out and Change place…** on each Jira, Azure DevOps and
  monday.com tracker, each named for whose tracker it is. Sign in again and
  Change place… run `acc.trackers.signIn` and `acc.trackers.add` with the
  tracker, which open the Connect page at it, as the board's buttons do. Sign
  out runs `acc.trackers.signOut`, which the page may now ask for: a site's
  sign-in still asks every project or this one, and a project's own goes with
  no question (D-091). Not signed in, Sign in leads, and Sign out is disabled
  with why. **Connect a tracker…** ends the part, and the Connect page asks
  which project. GitHub has only Change place…: it signs in through gh as the
  project's account (D-007), which GH-113's GitHub accounts part will gather.
- **acc writes a tracker,** not the Command Center. `acc trackers set --file
  <tracker.json> [--index <n>]` adds one, or changes the one at that place,
  keeping keys the record doesn't name and taking out those it names as null,
  as D-073's Save did. Core's `saveTracker` checks the config it would make and
  writes nothing when it wouldn't load. The Connect page's Save hands it the
  record through a file that's removed after, and shows acc's refusal beside
  Save. It's a person's: the hook and the builder's deny list refuse it, as
  they refuse `acc rules import`. So every change Settings starts goes through
  acc or VSCode's secret storage (D-064). The settings check's raw read of the
  config (D-103) moves with it, to `saveTracker`.
- **The Connect page comes back to Settings** when it was opened from there:
  Back goes to the Trackers and sign-ins heading, and so does Save, in place of
  the Tasks tab. Opened anywhere else, it goes where it did.
- Not chosen: a Connect a tracker per project, since the Connect page asks;
  listing every sign-in VSCode keeps, which its secret storage can't (D-091);
  a sign-out button on the Connect page, which D-091 turned down. Sign out is a
  button in Settings, beside each tracker.
- **Checked:** `settings.test.ts` for every sign-in and board state, the
  buttons and their commands, and the page; `connect.test.ts` for Back and
  Save from Settings and acc's refusal; `activate.test.ts` through the built
  extension and acc: `acc trackers set` adds a Jira tracker, Settings lists it,
  a project's own sign-out asks nothing, a site's asks and keeps it for the
  rest, and Sign in again and Change place open the Connect page with Back to
  Settings. `config.test.ts` and `cli.test.ts` for `acc trackers set`, a hook
  fixture and the deny list. Screenshots `settings-trackers` at 1000, 620 and
  500 px in Light and Dark; `--colours` finds no difference across themes on
  its 650 elements.
