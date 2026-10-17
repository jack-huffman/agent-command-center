# Onboarding

What it takes to run Agent Command Center: once per machine (Part A), then once
per project (Part B). Install the extension first: see
[Install and first run](../README.md#install-and-first-run) in the README.

Every step here is also a step in VSCode's walkthroughs, a row on the Command
Center's **Setup** page, and a check in `acc doctor`. This guide writes each one
as **title** (`id`), with the id `acc doctor --step` takes. The walkthrough
and Setup tick a step when its check passes, and most steps have a **Do it**
that does the step for you, in a terminal or an output panel you can watch. This
guide says what each step is for, and how to do it by hand.

Placeholders: `<client>` is the project's short name. `<prod>`, `<qa>` and
`<dev>` are org aliases. `<account>` is a GitHub account. `<owner>/<repo>` is
the project's GitHub repo.

---

## Part A: This machine (once)

### A1. Install the tools

| Step | Check | Install or fix |
|---|---|---|
| **git 2.40 or later** (`A1.git`) | `git --version` | `brew install git` |
| **Node 20 or later** (`A1.node`) | `node --version` | Salesforce projects only, for the Salesforce CLI. acc itself needs no Node: it runs on VSCode's own runtime. `brew install node` |
| **GitHub CLI** (`A1.gh`) | `gh --version` | `brew install gh` |
| **Claude Code CLI with background sessions** (`A1.claude`) | `claude --help` lists `--bg` | `brew install --cask claude-code`, then `claude update`. The VSCode extension ships its own copy, so the terminal CLI can fall far behind |
| **Agents bill your Claude subscription** (`A1.claude-billing`) | See below | See below |
| **Salesforce CLI** (`A1.sf`) | `sf --version` | Salesforce projects only. `npm install -g @salesforce/cli` |
| **Salesforce Code Analyzer** (`A1.code-analyzer`) | `sf plugins` lists `code-analyzer` | Salesforce projects only. `sf plugins install code-analyzer` |

**Agents and billing.** Builders and reviewers run on whatever Claude Code is
signed in with. On a Claude subscription, their work counts toward your plan. An
API key, Bedrock or Vertex bills every token instead, and nothing else tells
you. The check fails, and names each place it found one, when any of these is
set:

- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in the environment
- `apiKeyHelper`, or either of those variables under `env`, in
  `~/.claude/settings.json`, or in the project's `.claude/settings.json` or
  `.claude/settings.local.json`
- `CLAUDE_CODE_USE_BEDROCK` or `CLAUDE_CODE_USE_VERTEX` set to a true value

It names the place, never the key. Remove the setting: take the variable out of
your shell profile, or delete it from the settings file. If you keep one on
purpose, mark the step done.

### A2. Log in to every GitHub account you'll use

- [ ] **Logged in to GitHub** (`A2.gh-login`). The walkthrough's **Do it** uses
  VSCode's own GitHub sign-in: pick the account, or add it, and `gh` gets that
  login, with access to GitHub Projects for the board. gh's active account
  stays as it was. From a terminal instead: `gh auth login` once per account,
  then check with `gh auth status`.
  - Only one account is "active". **Never run `gh auth switch`**, because it
    changes the account for every session on the machine.
  - Each repo pins its own account instead (B2).

### A4. Install the acc plugin in Claude Code

- [ ] **The acc plugin in Claude Code** (`A4.plugin`). The plugin's hooks keep
  each builder inside its own worktree and away from pushes, merges and
  deploys, and send it back to its finish line if it stops early. It also
  brings acc's skills and the reviewer agent. It's installed once, at Claude
  Code's user scope, so every Claude Code session on this machine has it; in a
  repo without `.acc/config.json` its hooks do nothing.

  **Do it** runs, in a terminal:

  ```bash
  claude plugin marketplace add https://github.com/jack-huffman/agent-command-center
  claude plugin install acc@agent-command-center --scope user
  ```

  The check reads `claude plugin list --json`, and asks for only what's
  missing: the marketplace and the plugin, the plugin alone, or
  `claude plugin enable acc@agent-command-center --scope user` when it's
  installed but disabled. A plugin older than acc fails too, and its fix
  updates it: `claude plugin marketplace update agent-command-center`, then
  `claude plugin update acc@agent-command-center --scope user`. A newer one
  passes. Sessions already running don't load the plugin, so start a new one.

  **The marketplace is this private repo.** Claude Code clones it with your own
  git credentials, so:
  1. Accept the invitation to the repo with the GitHub account you'll use.
  2. Check that git can read it:
     `git ls-remote https://github.com/jack-huffman/agent-command-center`.
  3. If that asks for a password or says the repository isn't found, let gh
     answer for git: `gh auth setup-git`. That changes your global git config,
     so every repo on the machine gets github.com credentials from gh's active
     account, except repos with their own helper (B2).

  **Updates are by hand.** Claude Code updates a private marketplace in the
  background only when `GITHUB_TOKEN` is set, so after each release:

  ```bash
  claude plugin marketplace update agent-command-center
  claude plugin update acc@agent-command-center --scope user
  ```

  The Command Center's **Settings → About** shows the versions of acc, the
  extension and the plugin. It says when the plugin is older than the
  extension, with the same fix as this step, and when a newer release is out,
  with a link to its notes. It looks for one as gh's active account, so that
  account needs read access to the repo.

### Optional: acc's notices in Slack

For hearing what needs you when you're away from VSCode. Nothing checks this,
and nothing needs it.

1. In Slack, make an incoming webhook for a channel, or for a DM to yourself:
   [api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks).
   It looks like `https://hooks.slack.com/services/T…/B…/…`.
2. In the Command Center, open **Settings**. Under **Notices in Slack**, paste
   it and choose **Connect**. A test message goes to Slack, and the card says
   whether it arrived.
3. Untick any kind you don't want: **Needs you**, **Review finished**, **Pull
   request opened**, **Draft update waiting**. **Turn off** stops them all;
   **Remove** deletes the webhook from this machine.

The webhook is kept in VSCode's secret storage on this machine, for every
project open here, never in a repo. Each message has the task's id and title,
what happened and a link to its pull request or ticket; never a draft's text, a
ticket's description, code or logs. If Slack refuses a message (the channel was
archived, say), the card turns orange with Slack's reason and nothing more is
sent until **Send a test** goes through.

---

## Part B: A project (once per repo)

The project walkthrough opens by itself once in a Salesforce folder with no
`.acc/config.json`; **Agent Command Center: Onboard this project** in the
Command Palette opens it any time, and the Command Center's **Setup** page shows
the same steps. Steps marked *Salesforce
only* are hidden for a `generic` project.

### B0. Open the repo, and give it a config

- [ ] **Inside the project's repo** (`B0.repo`). Everything per project hangs
  off the repo: its config, its branches, and acc's ledger in the git
  directory. Open the repo's folder in VSCode (File → Open Folder). If the
  folder open is a copy beside the repo, the check names the repo, and **Do
  it** opens it. No repo yet? See B1 and B2.
- [ ] **Project config** (`B0.config`). `.acc/config.json` names the
  environments, the GitHub repo and account, the commit identity and the
  checks. **Do it** asks what kind of project it is. For a Salesforce project
  it lists the Production orgs you're logged in to, and finds every sandbox
  from Production's sandbox list. In a terminal:

  ```bash
  acc init --profile salesforce --production-org "<prod>"
  acc init --profile generic
  ```

  If your team keeps a template of its settings, choose **From a team
  template…** instead, and give its path or URL. It sets what the team agreed
  on, such as the checks and the tracker, and acc finds the rest. Setup lists
  what it sets and the commands it runs before anything is written. In a
  terminal, `acc template show <template>` lists them first, and
  `acc init --from <template>` writes the config. docs/TEMPLATES.md says what
  a template holds.

  If the project's tickets are one epic in a tracker your team shares, choose
  **From a Jira epic…**. It asks where the rest of the settings come from
  (Salesforce, Other, or a team template), then opens the Command Center's
  Connect page for this folder: the site, signed in already when another
  project on this machine signs in to it for every project (B14), then the
  project, the epic from the project's open epics, and the board. Azure
  DevOps works the same way with an area path, and GitHub Issues with labels;
  monday.com with a group. An epic another repo on this machine uses already
  says "used by <repo>", and picking it asks first. **Start the project**
  runs `acc init` once, with that tracker narrowed to the epic; leaving the
  page writes nothing, and nothing is ever written to the tracker. In a
  terminal, `acc init` takes the tracker as JSON:

  ```bash
  acc init --profile generic --tracker '{"kind":"jira","site":"acme.atlassian.net","project":"ACME","epic":"ACME-3"}'
  ```

  Review the file and commit it. `acc init --force` writes it again.
- [ ] **The team template is current** (`B0.template`). A project started
  from a team template records which one. This step reads it again, and
  passes while it's unchanged, or when the project already agrees with it.
  When the team has changed it and the project now differs, it names what
  differs, for you to check by hand. **Do it** previews what the template
  would write, changing nothing. acc never applies it by itself: to take it,
  run `acc init --from '<template>' --force` and review the diff. A project
  not started from a template skips this step.
- [ ] **Copied-in rules are current** (`B0.rules`). Rules your team shares,
  such as its Apex standards, are copied into `.acc/rules/`, each with a
  header saying where it came from and when. Builders, reviewers and the
  analyst read only those copies, after the profile's rules and before the
  repo's own `.acc/rules.md`, which wins. **Import rules…** on this row copies
  one in from a path, a GitHub file or a git repo, and previews it first. In a
  terminal: `acc rules import <source>`. Review the file and commit it. This
  step reads each source again: it passes while each is unchanged, even when
  the copy was edited here. When one has changed, **Do it** shows the
  difference and changes nothing; to take it, run
  `acc rules import <source> --name <name> --force` and review the diff. A
  repo with no copies skips this step. docs/RULES.md says more.

### B1. Decide where everything lives

- [ ] **One private GitHub repo per client**, under the account or organization
  the work belongs to.
- [ ] **A local layout** that keeps client data out of the repo:

  ```text
  <client>/
    <client>/                  the repo clone, one checkout for every environment
    <client> Working Files/    client data and working notes, never in git
  ```

- [ ] **Every org is listed** (`B1.orgs`). *Salesforce only.* List every org the
  client has, not just the ones you'll use first. Production's sandbox list is
  the full set:

  ```bash
  sf data query --use-tooling-api -q "SELECT SandboxName, LicenseType FROM SandboxInfo" -o "<prod>"
  ```

  For each org, record its environment name (the sandbox name), its type
  (`DEVELOPER`, `DEVELOPER_PRO`, `PARTIAL` or `FULL`) and an alias. Then decide
  where it promotes to. Pipelines differ by client:

  | Shape | Promotes |
  |---|---|
  | Strict | Dev → Full Copy → Production |
  | Small org | Sandbox → Production |
  | QA when it's worth it | Dev → QA *or* straight to Production, then QA → Production |

  An org on no path, such as a training sandbox, is still listed so that drift
  checks cover it. `acc init` lists them all; **Do it** runs
  `acc init --force` to list them again.

### B2. Clone the repo and pin its GitHub account

Clone the repo. Then set its commit identity and credentials **in that repo
only**.

- [ ] **Commit identity** (`B2.identity`). Commits in this repo carry the name
  and email in the config's `commitIdentity`. **Do it** sets them:

  ```bash
  git config user.name  "<name>"
  git config user.email "<email>"
  ```

- [ ] **The repo's GitHub account is logged in** (`B2.account`). acc runs every
  gh call for this repo as the config's `github.account`, so gh needs a login
  for it. **Do it** opens VSCode's GitHub sign-in, as in A2.
- [ ] **git pushes as the right account** (`B2.credentials`). **Do it** gives
  the repo its own credential helper:

  ```bash
  git config credential.helper ''      # drop the machine-wide helper for this repo
  git config --add credential.helper '!f() { test "$1" = get || exit 0; echo username=<account>; echo "password=$(gh auth token -u <account>)"; }; f'
  ```

  Then check that git resolves to the right account. This prints the login
  without showing the token:

  ```bash
  T=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
  GH_TOKEN="$T" gh api user --jq .login; unset T
  ```

> **Why:** `gh`'s own credential helper ignores the username you ask for and
> always returns the *active* account's token. Without this, a repo silently
> pushes as the wrong account.

For any `gh` command you run for this repo, prefix it with
`GH_TOKEN=$(gh auth token -u <account>)`.

**Switching the account later.** The project's account is a default. To work
as another account in your clone only, click the GitHub account in the status
bar, or use **Switch account** on the Environments tab. In a terminal:
`acc github use <account>`. Nothing committed changes, and git push follows
(D-028). `acc github status` shows the account, where it comes from, gh's
access, and who git push and commits use.

### B3. Keep client data out of git

- [ ] **Client data blocked at the repo root** (`B3.gitignore`). *Salesforce
  only.* Root-level patterns in `.gitignore` are a backstop: `/*.csv`,
  `/*.xls`, `/*.xlsx`, `/*.eml`, plus any export folders. **Do it** adds the
  missing ones.
- [ ] **No client data files in git** (`B3.data-files`). *Salesforce only.*
  Move CSV, XLS, XLSX and EML files, contact exports and working notes into the
  working-files folder beside the repo (B1). Scripts that read those files go
  with them, so their relative paths keep working. **Do it** takes the tracked
  ones out of git (`git rm --cached`) and leaves the files where they are.
- [ ] **No credentials in tracked files** (`B3.secrets`). Scan before the first
  commit, and the check scans again each time. By hand:

  ```bash
  git grep -I -l -E 'force://[A-Za-z0-9._~-]+:[^@[:space:]]+@|"access_token"[[:space:]]*:[[:space:]]*"[^"]{20,}"|<consumerSecret>[A-Za-z0-9]{8,}</consumerSecret>|<password>[^<[:space:]]{6,}</password>|sk_live_[0-9a-zA-Z]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[0-9A-Za-z]{30,}|AKIA[0-9A-Z]{16}' -- force-app config scripts
  ```

  The pattern matches credential *values*, not words like `access_token`, so
  documentation doesn't set it off. A credential that was committed must be
  rotated, and removed from history if it was pushed.

### B4. Build the project skeleton

- [ ] **Salesforce project skeleton** (`B4.skeleton`). *Salesforce only.* The
  repo needs:
  - `sfdx-project.json`, with the project's `name`, a `sourceApiVersion`, and
    `packageDirectories` naming the source folders (usually `force-app`)
  - `.forceignore`
  - a `.gitignore` that keeps local tool state out: `.sf/`, `.sfdx/`,
    `.claude/settings.local.json`, `coverage/` and `node_modules/`
  - for the `format`, `lint` and `lwc-tests` checks (B13): a `package.json`
    with Prettier, ESLint and LWC Jest, and their config

  `sf project generate --name <client>` makes all of these in a new folder, from
  Salesforce's standard template; copy over what the repo lacks. **Don't**
  commit `.sf/`, `.sfdx/` or `.claude/settings.local.json`: that's one
  machine's tool state. The check fails, with the `git rm --cached` that fixes
  it, when any of them is tracked.

### B5. Make one baseline manifest for every environment

- [ ] **Baseline manifest** (`B5.baseline`). *Salesforce only.* Every branch is
  retrieved with the same component list, so a diff between branches is real
  drift and not just different retrieve scopes. **Do it** runs
  `acc setup baseline`: it lists the components on every environment branch
  with sf, or on this checkout when there's no branch yet, and writes their
  union to `manifest/baseline-package.xml`. Commit it on each branch. By hand:
  1. For each environment branch, in a checkout of it:

     ```bash
     sf project generate manifest --source-dir force-app --output-dir <scratch> --name <branch>
     ```

  2. Merge them into one **union** manifest, `manifest/baseline-package.xml`:
     every component any of them lists, at the newest API version.

### B6. Create a branch per environment, named after it, and seed each from its org

- [ ] **A branch for every environment** (`B6.branches`). **Do it** runs
  `acc setup branches`, which makes each missing branch as below: production's
  from this checkout, then each sandbox's from production's with its source
  cleared, each retrieved from its own org. It only reads the orgs, and pushes
  nothing unless you add `--push`. Each org must be logged in first (the next
  step). By hand:

  **The branch name is the environment name:** `production` for Production,
  and the sandbox name for each sandbox. The sandbox name is in its URL,
  `<domain>--<name>.sandbox.my.salesforce.com`.

  1. **`production` first.** Retrieve Production and commit it:

     ```bash
     sf project retrieve start --manifest manifest/baseline-package.xml --target-org "<prod>" --wait 30
     git add -A && git commit -m "Baseline: Production org metadata, retrieved <date>"
     ```

  2. **Then each existing sandbox.** Branch from `production`, clear
     `force-app`, retrieve the sandbox and commit. Clearing it first means files
     that exist only in Production show up as differences:

     ```bash
     git switch -c <sandbox-name>
     git rm -r -q force-app && mkdir -p force-app/main/default
     sf project retrieve start --manifest manifest/baseline-package.xml --target-org "<qa>" --wait 30
     git add -A && git commit -m "Baseline: <sandbox-name> metadata, retrieved <date>"
     ```

  - "Cannot be found" warnings during these retrieves are expected. They're
    components that exist in another org.
  - If the repo started with `main`, rename it:
    `gh api -X POST repos/<owner>/<repo>/branches/main/rename -f new_name=production`.
    Then locally: `git branch -m main production && git branch -u origin/production production`.
  - **Count drift with `git diff --no-renames --name-status production <branch>`.**
    Without `--no-renames`, git pairs unrelated files as "renames" and the
    counts come out wrong.

- [ ] **Each branch points at the right org** (`B6.org-match`). *Salesforce
  only.* A sandbox's name is in its URL, so acc can prove a branch deploys
  where its name says. Log in to each org with the alias in the config:

  ```bash
  sf org login web --alias "<dev>" --instance-url https://<domain>--<name>.sandbox.my.salesforce.com
  ```

  **Do it** checks each environment's org, lists the ones that need a login
  first, and opens the login at the URL the environment's name implies.

### B8. Set up a source-tracked Developer sandbox for day-to-day work

*Salesforce only.*

A project that doesn't use source tracking skips this part: turn Source
tracking off under Limits and checks in the project's settings, or run
`acc tracking off`. Both B8 checks then skip and say why. acc's retrieves use
manifests and its deploys use source folders, so nothing else changes.

- [ ] **Create it** in Production: Setup → Sandboxes → New Sandbox → Developer.
  Its name becomes its branch name, and B1 lists it (`acc init --force`).
- [ ] **Developer sandboxes are source tracked** (`B8.tracking`). A Developer
  sandbox is only tracked if Production's setting was **on when the sandbox
  was created or last refreshed**. To see the setting:

  ```bash
  sf project retrieve start -m "Settings:SourceTracking" -o "<prod>" --output-dir <scratch>
  # look for <enableSourceTrackingSandboxes>true
  ```

  **If it's off,** turn tracking on in that sandbox. There's no refresh
  needed: log in to the sandbox, go to Setup → **Sandbox Settings**, and click
  **Enable Source Tracking in This Sandbox**. **Open in Salesforce** opens
  Setup in the right org.
  - It tracks changes from that moment on.
  - A refresh turns it off again, so repeat this after every refresh.
  - The Production-wide alternative is Setup → Dev Hub → **Enable Source
    Tracking in Developer and Developer Pro Sandboxes**. It covers sandboxes
    created or refreshed after it's switched on.
- [ ] **The CLI knows they're tracked** (`B8.cli-tracking`). An org logged in
  before tracking was switched on is remembered as untracked. Log in after
  tracking is on (B6), or **Do it** runs `sf org enable tracking -o "<dev>"`.
  To check by hand:

  ```bash
  sf data query --use-tooling-api -q "SELECT COUNT() FROM SourceMember" -o "<dev>"   # fails on untracked orgs
  sf project retrieve preview -o "<dev>"                                              # needs tracking
  ```

- [ ] **Give it a branch from `production`.** A new Developer sandbox is a copy
  of Production's metadata, so `git branch <name> production`. Don't commit its
  environment differences. Those are covered in B9.

Source: [Enable Source Tracking in Sandboxes](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-setup-enable-source-tracking-sandboxes.html), Salesforce DX Developer Guide.

### B9. Sort out the environment-specific differences

- [ ] **Environment-specific and known-drift lists** (`B9.lists`). *Salesforce
  only.* Environment config is never promoted or deployed, and drift checks
  need to know what differs by design. **Do it** runs `acc setup lists`. It
  drafts both lists from how each sandbox's branch differs from production's:
  - org configuration (email services, named credentials, SSO, settings) goes
    to environment-specific
  - app logos, and files that differ only in line order, go to known drift
  - it names every difference that neither list explains

  It never overwrites a list you already have; it suggests additions instead.
  Read the drafts before committing them. By hand:

  1. Retrieve the sandbox into a throwaway worktree of `production` and list
     what differs:

     ```bash
     git worktree add --detach ../<client>-drift production
     cd ../<client>-drift
     sf project retrieve start --manifest manifest/baseline-package.xml --target-org "<dev>" --ignore-conflicts --wait 30
     git status --short
     ```

  2. Sort every difference into one of three groups:

     | Group | Typical files | Goes in | Rule |
     |---|---|---|---|
     | **Environment config** | Email services, Case Email-to-Case addresses, SSO, My Domain, security and email settings | `manifest/environment-specific.txt` | Never promoted, deployed or edited as part of a task |
     | **Features the sandbox lacks** | App logos (content assets), permission sets and profiles that reference a disabled feature | `manifest/known-drift.txt` | Promote normally. Validating against that sandbox may fail on the missing references |
     | **Ordering noise** | Object files with `formFactor` swapped, the Data Cloud geolocation file | `manifest/known-drift.txt` | Promote normally. Drift checks ignore them |

  - **Never leave a blank line in either list.** A blank line in a `grep -f`
    pattern file matches everything.
  - **Check:** the drift check in B11 prints nothing.

### B10. Set safe defaults

- [ ] **GitHub's default branch is the day-to-day one**
  (`B10.default-branch`), so new pull requests target day-to-day work, not a
  protected environment. **Do it** runs
  `gh repo edit <owner>/<repo> --default-branch <dev-branch>`.
- [ ] **The local default org is the day-to-day one** (`B10.default-org`).
  *Salesforce only.* With the checkout on that branch,
  `sf config set target-org "<dev>"`. A deploy without `--target-org` then
  can't reach Production.
- [ ] **Task worktrees are git-ignored** (`B10.ignore-worktrees`). Task
  worktrees live in `.claude/worktrees/` inside the repo (D-022). Ignoring it
  keeps them out of your main checkout's changes and out of VSCode's search.
  **Do it** adds `.claude/worktrees/` to `.gitignore`.
- [ ] **README names every environment** (`B10.readme`). **Do it** runs
  `acc setup readme`, which writes the first two of these between markers in
  README.md and keeps them up to date; the rest are yours:
  - the environments table: environment, branch, alias, type, My Domain, role
  - the promotion flow
  - where the tickets come from, when a tracker is narrowed to an epic, an
    area path, labels or a group: its key, linked, such as "Jira epic
    [ACME-3](https://acme.atlassian.net/browse/ACME-3)". This applies even
    with one environment, and the step fails until the README links it
  - getting-started commands
  - the environment-specific rule
  - drift numbers
  - work in progress
  - the client-data rule
- [ ] **Keep the README and both lists identical on every non-production
  branch**, so promotions don't conflict over them.
- [ ] **No promotion pull requests while a branch has drifted far from
  Production.** For example, a Partial Copy that hasn't been refreshed in a
  long time would propose deleting Production files. Reconcile it first.

### B12. Trust the repo for background agents

- [ ] **Claude Code trusts the repo for background agents** (`B12.trust`).
  Background agents start in your main checkout, and Claude Code only starts
  one in a folder you've trusted. VSCode's own Claude sessions don't record
  this trust, so do it once in a terminal. **Do it** opens the terminal and
  runs `claude` for you:

  ```bash
  cd <repo>
  claude        # accept the "trust this folder" prompt, then type /exit
  ```

### B13. Make sure the checks can run

- [ ] **The required checks can run** (`B13.gate-tools`). Agents can't finish a
  task until its required checks (`gates.required`) pass, so each needs a
  command, and its tools. The Salesforce checks `format`, `lint` and
  `lwc-tests` use the repo's own Prettier, ESLint and LWC Jest, so install them
  once in the main checkout. Task worktrees share its `node_modules`.

  ```bash
  cd <repo>
  npm install
  ```

  If the repo's `package.json` uses husky, `npm install` also turns on its
  pre-commit hook. `static` needs Code Analyzer (A1), and `validate` needs the
  environment's org logged in (B6).
- [ ] **The tools the project's checks need** (`B13.tools`). Some checks need a
  tool on this machine that `npm install` doesn't bring, such as a pinned
  browser to draw screenshots with. List each under `tools` in
  `.acc/config.json`, with a `check` command that exits 0 when it's there and a
  `fix` command that sets it up. The step runs each check in the main checkout,
  and offers the first missing tool's fix. A project that lists none skips it.

  ```json
  "tools": [{ "title": "The pinned headless shell", "why": "The screenshot run draws with it.", "check": "npm run browser -- --check", "fix": "npm run browser" }]
  ```

`acc gate list` shows each check, and `acc gate run` runs them on the current
commit.

### B14. Connect the ticket source

- [ ] **The repo's ticket source** (`B14.tickets`). Each repo names its own
  ticket source in `.acc/config.json` (`"trackers"`). The Tasks tab shows that
  tracker's board, and every ticket opens as a page you can work from (D-026).
  The easy way is the **Connect page** in the Command Center, with nothing to
  edit by hand. This step's **Do it** opens it, and so do **Connect Jira** on
  the Tasks tab, **Add a tracker** on the Overview, **New work**, and **Agent
  Command Center: Add a tracker…** in the Command Palette. Pick Jira, GitHub
  Issues, Azure DevOps or monday.com, give its site, repo, organization or
  account, sign in and click **Test connection**: it says who it signed in as,
  or why not, beside the field. Then pick the project, the place and the board
  from lists of what that sign-in can see, and **Save** asks acc to write the
  repo's `.acc/config.json` (`acc trackers set`), for you to commit. Sign-ins
  stay in VSCode's secret storage on this machine, never in the file.
- [ ] **One sign-in for every project on a site.** Beside the sign-in, **Use
  this sign-in for every project on acme.atlassian.net** is ticked the first
  time you sign in to a site, so every other repo on this machine that uses
  the same Jira site, Azure DevOps organization or monday.com account signs in
  with it: connecting its tracker needs nothing typed. Untick it to keep the
  sign-in for this project only, as for a client whose login mustn't serve
  another client's repo on the same site; a project's own sign-in always wins
  over the shared one. The Connect page and the board say which is in use:
  "Signed in as you@example.com, for every project on acme.atlassian.net", or
  "…for this project only". **Sign out of a tracker** asks, for a shared
  sign-in, whether to sign out every project on the site or this one only.
  GitHub signs in through `gh`, as the repo's account, as before.
- [ ] The **place** is which of its tickets are this repo's, so another
  project's or another client's never show up here (D-072). The whole project,
  repo, team or board is listed first. A narrower place is an epic (Jira),
  labels (GitHub), an area path (Azure DevOps) or a group (monday.com). The
  board shows only tickets in the
  place, says where they come from under its name, and a ticket outside it
  can't be opened or tracked. **Change**, on the board, opens the tracker on the
  Connect page to change its place, board or team, or to sign in again; every
  **Sign in to Jira**, **Sign in to Azure DevOps** or **Sign in to monday.com**
  button opens it there too.
  Another project is another tracker. **Sign out of a tracker** is in the
  Command Palette.
- [ ] **Settings' Trackers and sign-ins** lists every open project's trackers
  in one place: each one's place and board, and who it signs in as, for this
  project only or for every project on its site. Each has **Sign in again**,
  **Sign out** and **Change place…**, and **Connect a tracker…** adds another.
  Opened from there, the Connect page goes back there.
  - **Azure DevOps:** choose **Sign in with Microsoft** and pick the account
    that belongs to that client in the chooser VSCode shows at the top of the
    window. If the client's tenant blocks it, choose **Personal access token**:
    **Create a token** opens the organization's token page; give it Work
    Items: Read & write.
    `{ "kind": "azure", "organization": "acme", "project": "CRM", "board": "Stories" }`,
    plus `"team"` for a team other than the default, and
    `"areaPath": "CRM\\Billing"` for only the work items under that area.
  - **Jira:** the email comes from the repo's `git config user.email`. **Create
    an API token** opens
    [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens);
    paste the token in its field.
    `{ "kind": "jira", "site": "acme.atlassian.net", "project": "ACME", "board": 7 }`,
    where `"board"` is the board whose columns the Tasks tab shows, and
    `"epic": "ACME-3"` for only that epic's tickets and their sub-tasks. The
    board's own filter still applies, so pick a board that shows the epic's
    tickets.
  - **GitHub Issues:** `{ "kind": "github" }` uses the project's repo and
    account through `gh`, with nothing to type: the page signs in as soon as
    it knows the repo, and lists its labels to tick. To use a GitHub
    Project's columns rather than Open and Closed, give the account Projects
    access once. gh refreshes only its active account, so switch to it first
    and back after: `gh auth switch -u <account>`, then
    `gh auth refresh -h github.com -s project`, signing in as that account.
    Add `"board": <project number>` to pick a Project, `"repo": "owner/name"`
    for another repo's issues, and `"labels": ["billing"]` for only issues
    with one of those labels. `acc intake github` reads the same place.
  - A ticket that leaves the place, because it moved or the place was
    narrowed, leaves acc's board if work on it never started. One that started
    stays on the agent board, and the tracker's board names it for you.
  - **monday.com:** a personal API token. **Create a token** opens the
    account's Developer Center (`https://acme.monday.com/apps/manage/tokens`);
    paste it in its field. The token sees everything you can see in
    monday.com, and one from another account is refused. Like any sign-in, it
    can be kept for every project on the account, or this one only. Then pick the board, and a group on it for only that group's
    items. A board with more than one status column, such as Status and
    Priority, asks which one: its labels are the Tasks tab's columns, in
    monday's order.
    `{ "kind": "monday", "account": "acme", "board": 1234567890 }`, plus
    `"group": "topics"` for one group, `"statusColumn": "status_1"` for a
    status column other than the one called Status, and `"prefix": "CW"` for
    keys like CW-123. A second board on the account gets `"prefix": "MON2"`
    from the Connect page, so each board's keys are its own. An item is a
    task as `MON-<item id>`; its long-text columns are its brief. Updates
    post as item updates. With `"edits": true`, the task page can change its
    status label and its board's first People column; monday.com items have
    no labels.
  - Slack isn't a ticket source; acc's notices can go to it instead (Part A).

If a repo keeps its tasks in acc alone, mark the step done. `acc doctor` checks
that the config names a source. The walkthrough also checks that this repo is
signed in to it, which a terminal can't see.

### B15. Cloud builders (optional)

A project may let a task's builder run as a Claude Code cloud session instead
of on this Mac (GH-69). It's never the default: `acc cloud enable` opts the
project in, and each task then chooses with `acc dispatch <id> --cloud` or
`--local`. These steps apply only once a project has opted in; before that,
Setup skips them.

- [ ] **Claude can clone the repo from the cloud** (`B15.cloud-github-app`). A
  cloud session clones the repo from GitHub and pushes its branch back through
  the GitHub access connected to your claude.ai account: the Claude GitHub App
  installed on the repo (https://github.com/apps/claude), or `/web-setup` in a
  `claude` session, which sends gh's token to your account. acc can see only
  the app, so after `/web-setup`, tick this yourself.
- [ ] **A routine for the repo** (`B15.cloud-routine`). A script can start a
  cloud session only by firing a routine's API trigger. At
  https://claude.ai/code/routines, make a routine for this repo: paste acc's
  routine prompt as its instructions (`acc cloud` shows it), pick the repo and
  the model, keep the Default environment, and add an API trigger. Copy its
  trigger id into `acc cloud enable --routine trig_…`.
- [ ] **The routine's token is in the keychain** (`B15.cloud-token`). On the
  routine's page, click Generate token, copy it once, and paste it on stdin to
  `acc cloud token`. It goes to this Mac's keychain, under `acc-cloud-routine`
  for this repo, and never into `.acc/config.json` or git.
- [ ] **Claude Code is signed in to claude.ai** (`B15.cloud-login`). Sending a
  cloud builder a message (`claude -p … --cloud <session>`) needs the CLI
  signed in with the claude.ai account that owns the routine:
  `claude auth login`.
- [ ] **The push guard is committed** (`B15.cloud-guard`). A cloud session runs
  the repo's own `.claude/settings.json` hooks and not acc's plugin, so
  `acc cloud enable` writes `.claude/hooks/acc-push-guard.mjs` and a
  PreToolUse hook on Bash and the editing tools that allows a plain push of
  the task's branch alone and refuses everything else that could push, a write
  under `.claude/`, and a deploy, in cloud sessions only, failing closed.
  Commit both: the check reads HEAD's tree, not the files on disk, since only
  what's committed reaches the cloud, and a dispatch refuses `--cloud` until
  the branch the cloud clones and the task branch both carry it. Where GitHub
  enforces no protection on an environment branch, `acc cloud` and the
  dispatch warn, without refusing: a private repo on the free plan has none.

### B11. Drift check (any time)

- [ ] **The day-to-day org matches its branch** (`B11.drift`). *Salesforce
  only.* A change made straight in an org is lost the next time its branch is
  deployed there. A drift check finds it first. **Do it** runs it for the
  day-to-day environment:

  ```bash
  acc drift <environment>     # e.g. acc drift dev
  ```

This retrieves the baseline manifest from the environment's org into a
throwaway worktree. It compares that with the branch, as the remote has it,
leaving out the known-drift and environment-specific lists. It prints nothing
when they match. Otherwise it lists:

- what changed in the org
- what exists only in the org
- what the branch has and the org lacks

That last list is often features a sandbox doesn't have, such as standard list
views for objects it doesn't provision. Add those files to the known-drift list
with a comment saying why. Add `--keep` to keep the retrieved copy for a closer
look. The retrieve only reads the org. The step shows the last result, and asks
for a new one after 14 days.

### Coming from per-org folders

*Optional.* If the project used to live in one folder per org, each with its own
retrieve, those folders can stay where they are until they're retired. Before
retiring one, check it for work that never reached an org:

- [ ] Compare the folder with its environment's freshly retrieved branch,
  ignoring formatting. Canonical XML (`xml.etree.ElementTree.canonicalize` in
  Python) removes attribute order and whitespace.
- [ ] Look closely at files that exist **only** in the folder. They're either
  drafts that were never deployed or things deleted from the org. Most
  "different" files mean the org changed after the folder's last retrieve.

If VSCode has one of those folders open, B0.repo names the repo beside it, and
**Do it** opens the repo.

---

## Part C: Problems you may hit

| Symptom | Cause | Fix |
|---|---|---|
| A4's **Do it** fails: `Repository not found`, or git asks for a password | Claude Code clones the private marketplace with your git credentials, and git has none for github.com that can read it | Accept the invitation with that account, then `gh auth setup-git` (A4) |
| The plugin is installed, but a session doesn't have its hooks | Claude Code loads plugins when a session starts | Start a new session |
| A repo pushed, or would have pushed, as the wrong GitHub account | `gh auth git-credential` ignores the username | Repo-local credential helper (B2) |
| A `for n in $list` loop ran once | zsh doesn't split unquoted variables | Run the loop under `bash -c`, or use `${=list}` |
| `git worktree add ../x <branch>` refused | That branch is already checked out | Add `--detach` |
| A new Developer sandbox wasn't tracked | Production's setting was off when the sandbox was created | Sandbox Settings → Enable Source Tracking in This Sandbox (B8) |
| The CLI listed tracking as unknown | The org was authorized before tracking was switched on | `sf org enable tracking -o <alias>` |
| Drift counts came out wrong | Git rename detection | `git diff --no-renames` |
| The same file changed on every retrieve | Data Cloud geolocation and `formFactor` ordering | List it in `known-drift.txt` |
| A Profile retrieved alone looked very different | Profile content depends on what else is in the same retrieve | Compare profiles only from full baseline retrieves |
| A promotion pull request would delete hundreds of files | The sandbox hadn't been refreshed in a long time, so its branch was far behind Production | Reconcile before promoting (B10) |
| B0.repo fails: "This folder isn't a git repo" | VSCode has a folder beside the repo open, not the repo clone | Open the repo folder. B0.repo names it, and **Do it** opens it |
| `acc dispatch` failed: "Workspace not trusted" | Claude Code only starts background sessions in folders you've trusted, and trust doesn't carry from a parent folder into a worktree | Trust the main checkout once (B12). Worktrees live in `.claude/worktrees/`, and agents enter them from there (D-022) |
| Every new task worktree looked dirty (`?? node_modules`) | The linked `node_modules` is a symlink, and a `node_modules/` ignore rule only matches folders | `acc dispatch` adds `node_modules` to the repo's shared `info/exclude` |
| `npm install` failed with `EACCES … _cacache` | Files in `~/.npm` owned by `root` after a `sudo npm` | `sudo chown -R "$(whoami)":staff ~/.npm`. It needs `sudo`; without it, the root-owned files stay. Check with `find ~/.npm ! -user "$(whoami)" \| wc -l`, which should print 0 |

---

## Part D: What `acc` automates

`acc doctor` runs every check above and prints the fixes; `acc onboard` shows
the same checks as a guided list, with the next step to do. The walkthroughs and
the Setup page run the same checks.

| Step | Command | Checked by |
|---|---|---|
| A1 | `acc doctor` | Version checks, and nothing sends agents to per-token billing |
| A2 | `acc doctor` | `gh auth status` lists an account, and the configured one |
| A4 | `claude plugin install …` | `claude plugin list --json` lists `acc@agent-command-center` at user scope, enabled |
| B0 | `acc init` | The folder is a git repo, and `.acc/config.json` is valid |
| B1 | `acc init --force` | Every sandbox in `SandboxInfo` appears in `environments`, with its type |
| B2 | `acc init --configure-git` | Commit identity matches, gh has the account, and `credential fill` resolves to it |
| B3 | `acc doctor` | `.gitignore` has the backstop patterns, no data files are tracked, and the secret scan is clean |
| B4 | `acc doctor` | `sfdx-project.json` exists, and no local tool state is tracked |
| B5 | `acc setup baseline` | `manifest/baseline-package.xml` lists components |
| B6 | `acc setup branches` | One branch per environment, each named to match its org's sandbox name |
| B8 | `acc doctor` | Each Developer environment answers `SourceMember`, and the CLI tracks it |
| B9 | `acc setup lists` | Both lists exist, have no blank line, and name only files that exist |
| B10 | `acc setup readme` | Default branch, local default org, ignored worktrees, and the README's environments |
| B11 | `acc drift <environment>` | The day-to-day org's last drift check was clean, within the last 14 days |
| B12 | `claude` | Claude Code's state lists the main checkout as trusted |
| B13 | `acc gate list` | Every required gate has a command, and the Salesforce gates' Node tools are installed |
| B14 | The Connect page | The config names a ticket source |
