## D-091 One tracker sign-in for every project on a site, unless a repo keeps its own (2026-10-07)

D-027 kept every tracker sign-in per repo, so one client's login never serves
another client's repo. So someone working on ten projects on one company Jira
site signed in ten times. The author wants coworkers to use one company tracker
across many projects without friction, and nothing company-specific in acc
(GH-79). This amends D-027, and D-085's monday.com sign-in, which was kept for
one repo only because its token sees everything.

- **A sign-in can be kept for its site**, shared by every repo on this machine
  that uses the same Jira site, Azure DevOps organization or monday.com
  account: `acc.cred:site:<kind>:<host>`, beside D-027's
  `acc.cred:<repo>:<kind>:<host>`. The host is the one the tracker's config
  names, lower case, with no scheme or trailing slash. Jira and Azure DevOps
  never share one, whatever the host. No repo key starts with `site:`, so the
  two never meet. Both stay in VSCode's secret storage on this machine, never
  in a repo, `.acc/config.json`, the page model, the log or the tab's saved
  state. GitHub is unchanged: it signs in through gh as the repo's account
  (D-007, D-028).
- **A repo's own sign-in wins**, then the site's, so a repo that needs another
  account keeps one. A sign-in kept before this is its repo's own, and keeps
  working. None is moved or promoted: one becomes shared only when someone
  signs in again with the tick.
- **The Connect page offers "Use this sign-in for every project on <host>"**
  under a sign-in that's typed or Microsoft's, never gh's. It's ticked the
  first time anyone signs in to a site. After that it starts where this repo's
  sign-in lives now (a person decided): ticked when the repo keeps nothing of
  its own (it has no sign-in yet, or uses the site's), unticked when it has its
  own sign-in or a "this project only" sign-out. Ticked, the sign-in goes under
  the site's key and the repo's own key is taken out, or the repo would go on
  ignoring what was just chosen. Unticked, it goes under the repo's key, and
  the site's stays for every other project. Once a person ticks or unticks it,
  that choice stays while the page is open: typing or changing the site doesn't
  put the default back, so an untick made before the site is typed still keeps
  the sign-in this project's. The tick's label is built from the host, so the
  page still names no tracker.
- **A new tracker on a site that already has a sign-in needs nothing typed.**
  Once its site parses, the page checks the sign-in this repo would use and
  fills the lists. Before, it looked only for an existing tracker's, so a
  second repo typed the token again. Test connection with nothing typed for a
  token looks too. Sign in with Microsoft never does: it always asks VSCode
  for a Microsoft sign-in, so it can't sign in with a token kept for the
  organization instead.
- **The page and the board say which sign-in is in use**: "Signed in as
  jordan@acme.example, for every project on acme.atlassian.net", or "…for this
  project only". On the board it's a line under where its tickets come from,
  with a globe or a repo icon, in place of the "as <who>" chip. GitHub keeps
  the chip.
- **Signing out of a shared sign-in asks**, in a modal: "Every project on
  <host>" or "This project only". Every project deletes the site's key and
  nothing else. This project only leaves it and writes a sign-out under the
  repo's own key, `{"kind": "jira", "signedOut": true}`, with no secret in it,
  where lookup stops. Neither touches another site's sign-in. VSCode's secret
  storage can't list its keys, so repos with their own sign-in on the site keep
  it, which suits D-027: those were chosen on purpose. The message says so.
- **Signing out of a repo's own sign-in doesn't ask** (a person decided),
  since no other repo uses it. When the site has a shared one, the repo falls
  back to it, and the message says "<project> now uses the sign-in for every
  project on <host> (<who>)." Signing out again and choosing This project only
  signs it out fully.
- **A sign-in or sign-out reloads every open project with a tracker on that
  site**, not only the one it started from. A change made in another window
  arrives through the secret storage's change event and does the same; keys
  this window just wrote are skipped, so they don't reload twice. Whether
  VSCode fires that event across windows hasn't been checked in a real
  two-window run. If it doesn't, other windows catch up on their next refresh.
- **The rules are pure functions in `logic.ts`** (`readCreds`, `credInUse`,
  `credWrites`, `signOutWrites`, `signOutPlan`, `siteCredKey`, `credSite`),
  tested against a Map. `signOutPlan` is how sign-out chooses: it asks only
  about a site's sign-in, and Cancel writes nothing. The Connect page's tests
  run them too.
- **The packaging scan reads site keys** (`parseSignIn`), so `npm run package`
  still finds the hosts of shared sign-ins. A site key has no repo.
- **What this costs D-027.** With the tick on by default, keeping two clients'
  logins apart on one site is a choice made per repo, not the default. A
  consultant whose clients share a site, signing in to client B's repo with the
  tick left on, makes that login every project's on the site, and client A's
  repo uses it unless it has its own. The tick's hint and the board's "for
  every project on <host>" line are the cues; untick it, or sign out This
  project only.
- **A shared Microsoft sign-in** keeps one account and the org's tenant. When
  its session ends, every project on the org needs signing in again at once,
  and the error names the scope: "The Microsoft sign-in every project on
  <org> uses (<account>) has ended."
- Not chosen: sharing across machines or an organization, or anything
  company-specific in acc (the CLI still never signs in to these trackers,
  D-066); listing or managing every stored sign-in; moving existing sign-ins;
  a sign-out button on the Connect page (D-073 keeps it a command).
