## D-097 A team template starts a project; acc ships none, and never re-applies one (2026-10-06)

The author wants coworkers to start projects the same way, with the team's
tracker, profile, environments and checks, without acc knowing whose team it is
(GH-80). `acc init` and Setup discovered settings from the repo and the
machine, and each person typed the rest.

- **A team template is a JSON file the team keeps,** wherever it keeps things,
  and acc fetches it only with gh and git: a GitHub file URL
  (`github.com/<owner>/<repo>/blob/<ref>/<path>`, or
  `raw.githubusercontent.com/…`), `<git-url>#<path>` for any git repo, or a
  path on this machine. docs/TEMPLATES.md shows a sample, ACME's (D-079): acc
  ships no template, not even that one.
- **What a template may say:** `schema` (1), a `name` and `description`, the
  `profile`, `environments` (name, type, default, protected, promotesTo),
  `gates` (required, commands, heavy, severity), one `tracker` (its kind, its
  place: a Jira site, an Azure DevOps organization or a monday.com account, and
  a default project, or a monday.com board; an Azure or monday.com prefix),
  `autonomy` and `agents` (max, and builder and reviewer's model, effort and
  fallbackModel). Values are checked by the config's own rules, D-015 and
  D-018's for environments included.
- **Every other key is refused, by its dotted path** (`gatez`,
  `agents.builder.efort`), not warned about as the config's are: a typo in a
  file a whole team uses would quietly drop a rule. The error says to update
  acc, for a template written for a newer one. Keys that belong to one
  project's config (github, commitIdentity, worktrees, secretScan, an org
  alias, agents.permissionMode, a tracker's edits, epic, labels or area path)
  are refused as that. agents.permissionMode is one of them so that a fetched
  file can't loosen what builders may do. A key that looks like a sign-in
  (token, apiToken, password, pat, email, secret…) is refused as one, at any
  level: sign-ins stay on the Connect page (D-027, D-073).
- **Precedence:** explicit flags, then the template, then discovery, then acc's
  defaults. `--jira-project` replaces the template's project; a `--profile`
  that disagrees with the template's is refused, naming both. A Jira or Azure
  tracker with no project, or a monday.com one with no board, is left out with
  a note pointing at the Connect page. Gate commands the template adds run on
  every coworker's machine, so they're listed before anything is written by
  Setup's confirmation, `acc template show` and `acc init --from … --dry-run`.
  `acc init --from` without `--dry-run` writes first and lists them in its
  output; the config is reviewed before it's committed.
- **A Salesforce template meets the client's real orgs** (a person decided).
  Production's sandbox list decides which environments exist and their types.
  For each sandbox the template names (by lower-case name, D-015), the
  template's promotesTo, default and protected win; a promotesTo naming an
  environment that doesn't exist is dropped, with a note, and when the
  template's default doesn't exist, discovery's default stays. A template
  environment with no sandbox is left out, with a note. A sandbox the template
  doesn't name keeps acc's usual path, with a note. A generic project takes
  the template's environments as they are.
- **A template may start a project at autonomy manual or review** (a person
  decided), the two that `acc agents autonomy` offers. dispatch and full are
  refused in a template. This amends D-014's "starts at manual": a team can
  agree on review for its projects. Nothing auto-merges because of a template:
  `autopilot` isn't a template key, so auto-merge stays a project's own choice
  (D-083).
- **The project records where it came from:** `"template": { "name",
  "source", "digest" }` in .acc/config.json. The digest is sha256 of the
  template's JSON with its keys sorted, so whitespace and key order don't
  change it. A local source is recorded as `~/…` under the home folder, or
  relative to the repo inside it, so no home path is committed.
- **B0.template says when the template changed, and never applies it** (a
  person decided how loudly). It doesn't apply without a record. It passes
  while the digest matches, and when the template changed but this project
  already agrees with it. When it changed and the project disagrees, it's
  Check by hand, naming the keys that differ, with `acc init --from '<src>'
  --dry-run` to preview. A tracker agrees when the project has one of the
  same kind at the same place: its project may differ, as `--jira-project`
  allows. It can't read the template: Check by hand, with the reason; a local
  file that isn't on this machine: Doesn't apply. It waits 20 seconds at most
  in all: a GitHub or git template takes two calls, which share one deadline.
  It reads a GitHub template as the account in the project's `github`.
  Accepted: "I've done this" is kept by step id, so it hides later changes
  too. Re-applying is only ever a person running `acc init --from … --force`.
- **Setup's "What kind of project is this?" offers "From a team template…"**,
  with the last 5 sources used on this machine, newest first, then "Another
  path or URL…". It reads the template with `acc template show --json`, shows
  a bad one's errors and writes nothing, and asks before starting, showing
  the name, description, what it sets and its check commands. A template that
  sets no profile goes on to "Salesforce or Other", and acc init gets the
  answer as `--profile`. A Salesforce one goes on to the Production org pick.
  The list is the extension's machine-wide state (`acc.recentTemplates`),
  sources and names only.
- **A template with no profile leaves an environment's type to the project**
  when it gives none: null in the template, Production's sandbox list in a
  Salesforce project, `none` in another. So `--profile salesforce` notes only
  a type the template gave that Production's list contradicts.
- **Refused sources:** a URL with a sign-in in it (`https://user:token@…`), a
  plain `http://` URL, any other web address (acc doesn't fetch without gh or
  git), a source that starts with `-`, and a file over 64 KB. A committed
  config's source reaches git on every Setup refresh, so git clone also gets
  `--` before the URL. git runs with no prompt (GIT_TERMINAL_PROMPT=0, ssh in
  batch mode), in a temporary folder that's always removed. A
  raw.githubusercontent.com URL may carry `refs/heads/` or `refs/tags/` before
  its ref, as GitHub's Raw button links it.
- **One account reads a GitHub template, for `acc template show` and `acc init
  --from` alike:** `--github-account`, else the account the repo pushes as
  when its origin is on GitHub, else gh's active one, through GH_TOKEN, never
  `gh auth switch` (D-007). A `--github-repo` with no GitHub origin doesn't
  pick it. So Setup's preview and the acc init after it read as the same
  account.
- Not chosen: merging a changed template into a config; inheritance or
  layering; a template gallery or editor; formats other than JSON; templates
  setting analysis, autopilot, worktrees or the secret scan.
