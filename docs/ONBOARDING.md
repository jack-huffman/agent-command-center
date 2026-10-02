# Onboarding

Every step needed to get the orchestrator running: once per machine, then once
per Salesforce project. It was written down while setting up the first pilot on
2026-10-01, including the problems hit along the way.

Today these steps are manual. Each one will become a check in `acc doctor` and a
step in the VSCode walkthrough, which ticks itself when the check passes. See
[DESIGN.md, Walkthrough](DESIGN.md#walkthrough).

Placeholders: `<client>` is the project's short name. `<prod>`, `<qa>` and
`<dev>` are org aliases. `<account>` is a GitHub account.

---

## Part A: This machine (once)

- [ ] **A1. Install the tools.**

  | Tool | Check | Notes |
  |---|---|---|
  | git 2.40+ | `git --version` | |
  | GitHub CLI | `gh --version` | |
  | Node 20+ | `node --version` | |
  | Claude Code CLI | `claude --version` | Run `claude update`. The VSCode extension ships its own copy, so the terminal CLI can fall far behind. Ours was 100+ versions old |
  | Salesforce CLI | `sf --version` | |
  | Code Analyzer | `sf plugins` lists `code-analyzer` | `sf plugins install code-analyzer` |

- [ ] **A2. Log in to every GitHub account you'll use.** Run `gh auth login`
  once per account, then check with `gh auth status`.
  - Only one account is "active". **Never run `gh auth switch`**, because it
    changes the account for every session on the machine.
  - Each repo pins its own account instead (step B2).

- [ ] **A3. Connect the trackers.**
  - **Jira:** connect the Atlassian connector in claude.ai settings.
  - **GitHub Issues:** works through `gh`, with nothing else to set up.
  - **monday.com and Slack:** later.

- [ ] **A4. Install the plugin.** This becomes available once milestone M5 lands:
  `claude plugin marketplace add <path or repo>` and then
  `claude plugin install acc@agent-command-center`.

<details>
<summary><b>Moving a Claude conversation into a project folder</b></summary>

Claude Code files each conversation under the folder it started in:
`~/.claude/projects/<folder path with every non-alphanumeric character turned into ->/`.
Its memory notes live in that folder's `memory/` directory.

To continue a conversation from another folder:

1. Wait until the session is idle, then copy `<session-id>.jsonl` and the
   `<session-id>/` folder into the new folder's directory.
2. Link or copy the memory files you want to keep.
3. Open the new folder in VSCode and pick the conversation from its history.
4. Once it resumes, move the original `.jsonl` out of the old directory, so it
   isn't listed twice. Keep the old `<session-id>/` folder, because the
   transcript points at files inside it.

</details>

---

## Part B: A Salesforce project (once per client)

### B1. Decide where everything lives

- [ ] **One private GitHub repo per client**, under the account or organisation
  the work belongs to.
- [ ] **A local layout:**

  ```text
  <Client>/
    <Client>/                  the repo clone, one checkout for every environment
    <Client> Working Files/    client data and working notes, never in git
  ```

  Older per-org folders stay where they are until they're retired.

- [ ] **List every org the client has**, not just the ones you'll use first.
  Production's sandbox list is the full set:

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
  checks cover it.

### B2. Clone the repo and pin its GitHub account

- [ ] Clone the repo, then set its commit identity and credentials **in that repo only**:

  ```bash
  git config user.name  "<name>"
  git config user.email "<email>"
  git config credential.helper ''      # drop the machine-wide helper for this repo
  git config --add credential.helper '!f() { test "$1" = get || exit 0; echo username=<account>; echo "password=$(gh auth token -u <account>)"; }; f'
  ```

- [ ] **Check** that git now resolves to the right account. This prints the login
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

### B3. Keep client data out of git

- [ ] Move CSV, XLS, XLSX and EML files, contact exports and working notes into
  `<Client> Working Files/`. Scripts that read those files go with them, so
  their relative paths keep working.
- [ ] Add root-level patterns to `.gitignore` as a backstop: `/*.csv`, `/*.xls`,
  `/*.xlsx`, `/*.eml`, plus any export folders.
- [ ] **Scan for secrets before the first commit.** `acc doctor` runs this scan
  as check B3.secrets. By hand:

  ```bash
  git grep -I -l -E 'force://[A-Za-z0-9._~-]+:[^@[:space:]]+@|"access_token"[[:space:]]*:[[:space:]]*"[^"]{20,}"|<consumerSecret>[A-Za-z0-9]{8,}</consumerSecret>|<password>[^<[:space:]]{6,}</password>|sk_live_[0-9a-zA-Z]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[0-9A-Za-z]{30,}|AKIA[0-9A-Z]{16}' -- force-app config scripts
  ```

  The pattern matches credential *values*, not words like `access_token`, so
  documentation doesn't set it off.

### B4. Build the project skeleton

- [ ] Copy over from the newest existing project folder: `sfdx-project.json`
  (set `name`, keep `sourceApiVersion`), `.forceignore`, `.gitignore`,
  `package.json`, the Prettier, ESLint and Jest config, `.husky/`, `config/`,
  `scripts/`, and `.vscode/` settings.
- [ ] **Don't** copy `.sf/`, `.sfdx/`, `.claude/` or `coverage/`. That's local
  tool state.

### B5. Make one baseline manifest for every environment

- [ ] Generate a manifest from each existing project folder:

  ```bash
  sf project generate manifest --source-dir force-app --output-dir <scratch> --name <env>-local
  ```

- [ ] Merge them into one **union** manifest, `manifest/baseline-package.xml`.
  Every branch is retrieved with the same component list, so a diff between
  branches is real drift and not just different retrieve scopes.

<details>
<summary>Union script (until <code>acc</code> does it)</summary>

```python
import xml.etree.ElementTree as ET
NS='http://soap.sforce.com/2006/04/metadata'; ET.register_namespace('', NS)
def load(f):
    out={}
    for t in ET.parse(f).getroot().findall(f'{{{NS}}}types'):
        out.setdefault(t.find(f'{{{NS}}}name').text,set()).update(m.text for m in t.findall(f'{{{NS}}}members'))
    return out
parts=[load(f) for f in ['prod-local.xml','qa-local.xml']]
u={k:set().union(*(p.get(k,set()) for p in parts)) for k in set().union(*parts)}
root=ET.Element(f'{{{NS}}}Package')
for k in sorted(u):
    t=ET.SubElement(root,f'{{{NS}}}types')
    for m in sorted(u[k]): ET.SubElement(t,f'{{{NS}}}members').text=m
    ET.SubElement(t,f'{{{NS}}}name').text=k
ET.SubElement(root,f'{{{NS}}}version').text='64.0'
ET.indent(root, space='    ')
open('manifest/baseline-package.xml','w').write('<?xml version="1.0" encoding="UTF-8"?>\n'+ET.tostring(root,encoding='unicode')+'\n')
```

</details>

### B6. Create a branch per environment, named after it, and seed each from its org

**The branch name is the environment name:** `production` for Production, and
the sandbox name for each sandbox. The sandbox name is in its URL,
`<domain>--<name>.sandbox.my.salesforce.com`.

- [ ] **`production` first.** Retrieve Production and commit it:

  ```bash
  sf project retrieve start --manifest manifest/baseline-package.xml --target-org "<prod>" --wait 30
  git add -A && git commit -m "Baseline: Production org metadata, retrieved <date>"
  ```

- [ ] **Then each existing sandbox.** Branch from `production`, clear
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
  Without `--no-renames`, git pairs unrelated files as "renames" and the counts
  come out wrong.

### B7. Check the old folders for work that never reached an org

- [ ] Compare each old project folder with its freshly retrieved branch, ignoring
  formatting. Canonical XML (`xml.etree.ElementTree.canonicalize`) removes
  attribute order and whitespace.
- [ ] Look closely at files that exist **only** in the old folder. They're
  either drafts that were never deployed or things deleted from the org. Most
  "different" files mean the org changed after the folder's last retrieve.

### B8. Set up a source-tracked Developer sandbox for day-to-day work

- [ ] **Create it** in Production: Setup → Sandboxes → New Sandbox → Developer.
  Its name becomes its branch name.
- [ ] **Check whether it got source tracking.** A Developer sandbox is only
  tracked if Production's setting was **on when the sandbox was created or last
  refreshed**:

  ```bash
  sf project retrieve start -m "Settings:SourceTracking" -o "<prod>" --output-dir <scratch>
  # look for <enableSourceTrackingSandboxes>true
  ```

- [ ] **If it's off,** turn tracking on in that sandbox. There's no refresh
  needed: log in to the sandbox, go to Setup → **Sandbox Settings**, and click
  **Enable Source Tracking in This Sandbox**.
  - It tracks changes from that moment on.
  - A refresh turns it off again, so repeat this after every refresh.
  - The Production-wide alternative is Setup → Dev Hub → **Enable Source
    Tracking in Developer and Developer Pro Sandboxes**. It covers sandboxes
    created or refreshed after it's switched on.
- [ ] **Authorize it after tracking is on:**

  ```bash
  sf org login web --alias "<dev>" --instance-url https://<domain>--<name>.sandbox.my.salesforce.com
  ```

- [ ] **Check** that tracking really works. If the CLI lists tracking as unknown,
  run `sf org enable tracking -o "<dev>"`.

  ```bash
  sf data query --use-tooling-api -q "SELECT COUNT() FROM SourceMember" -o "<dev>"   # fails on untracked orgs
  sf project retrieve preview -o "<dev>"                                              # needs tracking
  ```

- [ ] **Give it a branch from `production`.** A new Developer sandbox is a copy
  of Production's metadata, so `git branch <name> production`. Don't commit its
  environment differences. Those are covered in B9.

Source: [Enable Source Tracking in Sandboxes](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-setup-enable-source-tracking-sandboxes.html), Salesforce DX Developer Guide.

### B9. Sort out the environment-specific differences

- [ ] Retrieve the new sandbox into a throwaway worktree of `production` and list
  what differs:

  ```bash
  git worktree add --detach ../<client>-drift production
  cd ../<client>-drift
  sf project retrieve start --manifest manifest/baseline-package.xml --target-org "<dev>" --ignore-conflicts --wait 30
  git status --short
  ```

- [ ] Sort every difference into one of three groups:

  | Group | Typical files | Goes in | Rule |
  |---|---|---|---|
  | **Environment config** | Email services, Case Email-to-Case addresses, SSO, My Domain, security and email settings | `manifest/environment-specific.txt` | Never promoted, deployed or edited as part of a task |
  | **Features the sandbox lacks** | App logos (content assets), permission sets and profiles that reference a disabled feature | `manifest/known-drift.txt` | Promote normally. Validating against that sandbox may fail on the missing references |
  | **Ordering noise** | Object files with `formFactor` swapped, the Data Cloud geolocation file | `manifest/known-drift.txt` | Promote normally. Drift checks ignore them |

- [ ] **Never leave a blank line in either list.** A blank line in a
  `grep -f` pattern file matches everything.
- [ ] **Check:** the drift check in B11 prints nothing.

### B10. Set safe defaults

- [ ] **GitHub default branch = the Developer sandbox's branch**, so new pull
  requests target day-to-day work: `gh repo edit <owner>/<repo> --default-branch <dev-branch>`.
- [ ] **Local checkout** on that branch, with `sf config set target-org "<dev>"`.
  A deploy without `--target-org` then can't reach Production.
- [ ] **README** with:
  - the environments table: environment, branch, alias, type, My Domain, role
  - the promotion flow
  - getting-started commands
  - the environment-specific rule
  - drift numbers
  - work in progress
  - the client-data rule
- [ ] **Keep the README and both lists identical on every non-production
  branch**, so promotions don't conflict over them.
- [ ] **No promotion pull requests while a branch has drifted far from
  Production.** For example, a Partial Copy that hasn't been refreshed in months
  would propose deleting Production files. Reconcile it first.

### B12. Trust the repo for background agents

- [ ] Background agents start in your main checkout, and Claude Code only starts
  one in a folder you've trusted. VSCode's own Claude sessions don't record this
  trust, so do it once in a terminal:

  ```bash
  cd <repo>
  claude        # accept the "trust this folder" prompt, then type /exit
  ```

- [ ] Make sure `.claude/worktrees/` is in `.gitignore`. Task worktrees live
  there (D-022).

`acc doctor` checks both (B12.trust and B10.ignore-worktrees). The walkthrough's
**Do it** opens the terminal and runs `claude` for you.

### B13. Make sure the checks can run

- [ ] Agents can't finish a task until its required checks (`gates.required`)
  pass. The Salesforce checks `format`, `lint` and `lwc-tests` use the repo's
  own prettier, ESLint and LWC Jest, so install them once in the main checkout.
  Task worktrees share its `node_modules`.

  ```bash
  cd <repo>
  npm install
  ```

  If the repo's `package.json` uses husky, `npm install` also turns on its
  pre-commit hook.
- [ ] `static` needs Code Analyzer (A1), and `validate` needs the environment's
  org logged in (B1).

`acc doctor` checks this (B13.gate-tools). `acc gate list` shows each check, and
`acc gate run` runs them on the current commit.

### B11. Drift check (any time)

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
look. The retrieve only reads the org.

`acc doctor` shows the day-to-day org's last result (B11.drift).

---

## Part C: Problems we hit

| Symptom | Cause | Fix |
|---|---|---|
| A repo pushed, or would have pushed, as the wrong GitHub account | `gh auth git-credential` ignores the username | Repo-local credential helper (B2) |
| A `for n in $list` loop ran once | zsh doesn't split unquoted variables | Run the loop under `bash -c`, or use `${=list}` |
| `git worktree add ../x <branch>` refused | That branch is already checked out | Add `--detach` |
| A new Developer sandbox wasn't tracked | Production's setting was off when the sandbox was created | Sandbox Settings → Enable Source Tracking in This Sandbox (B8) |
| The CLI listed tracking as unknown | The org was authorized before tracking was switched on | `sf org enable tracking -o <alias>` |
| Drift counts were off by 10 | Git rename detection | `git diff --no-renames` |
| The same file changed on every retrieve | Data Cloud geolocation and `formFactor` ordering | List it in `known-drift.txt` |
| A Profile retrieved alone looked very different | Profile content depends on what else is in the same retrieve | Compare profiles only from full baseline retrieves |
| A promotion pull request would delete hundreds of files | The Partial Copy was 19 months behind Production | Reconcile before promoting (B10) |
| B0.repo fails: "This folder isn't a git repo" | VSCode has an old per-org folder open (such as `<Client> Production`), not the repo clone | Open the repo folder. B0.repo names it, and **Do it** opens it |
| `acc dispatch` failed: "Workspace not trusted" | Claude Code only starts background sessions in folders you've trusted, and trust doesn't carry from a parent folder into a worktree | Trust the main checkout once (B12). Worktrees live in `.claude/worktrees/`, and agents enter them from there (D-022) |
| Every new task worktree looked dirty (`?? node_modules`) | The linked `node_modules` is a symlink, and a `node_modules/` ignore rule only matches folders | `acc dispatch` adds `node_modules` to the repo's shared `info/exclude` |
| A copied conversation was missing its last reply | The copy ran while the session was still writing | Copy only after the session is idle (Part A) |
| `npm install` failed with `EACCES … _cacache` | Files in `~/.npm` owned by `root` after a `sudo npm` | `sudo chown -R "$(whoami)":staff ~/.npm`. It needs `sudo`; without it, the root-owned files stay. Check with `find ~/.npm ! -user "$(whoami)" \| wc -l`, which should print 0 |

---

## Part D: What `acc` automates

`acc doctor` runs every check below as of M1. Run `acc onboard` to see the next
step to do. The VSCode walkthrough (M2) shows the same steps.

| Step | Command | Checked by |
|---|---|---|
| A1 | `acc doctor` | Version checks |
| A2 | `acc doctor` | `gh auth status` lists the configured account |
| B1 | `acc init` | Every sandbox in `SandboxInfo` appears in `environments`, with its type |
| B2 | `acc init` | `credential fill` resolves to `github.account`, and commit identity matches |
| B3 | `acc init` | `.gitignore` has the backstop patterns, and the secret scan is clean |
| B5–B6 | `acc baseline` | One branch per environment, each named to match its org's sandbox name |
| B8 | `acc doctor` | Each Developer environment answers `SourceMember` |
| B9 | `acc drift --classify` | The drift check is empty after both lists are applied |
| B10 | `acc init` | Default branch, local default org, and the README sections exist |
| B11 | `acc drift <environment>` | The day-to-day org's last drift check was clean, within the last 14 days |
| B12 | `acc doctor` | Claude Code's state lists the main checkout as trusted, and `.claude/worktrees/` is ignored |
| B13 | `acc gate list` | Every required gate has a command, and the Salesforce gates' Node tools are installed |
