# Team templates

A team template starts every project the same way: the team's profile,
environments, checks, tracker, autonomy and agents, and the rules files its
agents keep to. It's a JSON file the team
keeps wherever it keeps things, and acc doesn't know whose team it is. acc
ships no template. The one below is ACME's, a made-up team.

```bash
acc template show <template>                     # what it sets, before using it
acc init --from <template>                       # a generic project
acc init --from <template> --production-org "<prod>"   # a Salesforce one
```

In VSCode, Setup's **Project config** step offers **From a team template…**
under **Do it**. It remembers the last five templates used on this machine.
When a template sets no profile, Setup asks whether the project is Salesforce
or another kind, and passes `--profile`.

## A sample

ACME's Salesforce projects run Dev → UAT → Production, track work in Jira,
let autopilot review and land, and keep ACME's Apex rules:

```json
{
  "schema": 1,
  "name": "ACME Salesforce",
  "description": "ACME's Salesforce projects: Dev to UAT to Production, tracked in Jira.",
  "profile": "salesforce",
  "environments": [
    { "name": "Production", "protected": true },
    { "name": "UAT", "type": "full", "promotesTo": ["production"] },
    { "name": "Dev", "type": "developer", "default": true, "promotesTo": ["uat", "production"] }
  ],
  "gates": {
    "required": ["format", "static", "validate"],
    "commands": { "lint": "npm run lint" },
    "severity": 2
  },
  "tracker": { "kind": "jira", "site": "acme.atlassian.net", "project": "ACME" },
  "autonomy": "review",
  "agents": {
    "max": 3,
    "builder": { "model": "claude-opus-5-5", "effort": "high" },
    "reviewer": { "model": "claude-opus-5-5" }
  },
  "rules": ["https://github.com/acme/acc-rules/blob/main/salesforce.md"]
}
```

## Where a template lives

| Source | Example | Fetched with |
|---|---|---|
| A file in one of the team's GitHub repos | `https://github.com/acme/acc-templates/blob/main/salesforce.json` | `gh api`, as the repo's account |
| The same file, raw (GitHub's **Raw** button may add `refs/heads/`) | `https://raw.githubusercontent.com/acme/acc-templates/refs/heads/main/salesforce.json` | `gh api`, as the repo's account |
| A file in any git repo | `https://git.example.com/acme/acc-templates.git#salesforce.json` | a shallow `git clone` |
| A path on this machine | `~/acme/acc-templates/salesforce.json` | read from disk |

`acc template show` and `acc init --from` read a GitHub file as the same
account: `--github-account`, else the account the repo pushes as when its
origin is on GitHub, else gh's active account. So Setup's preview and the
`acc init` after it read as one account. acc never runs `gh auth switch`
(D-007). git runs without prompting for a password, in a temporary folder it
always removes.

acc refuses a URL with a sign-in in it (`https://user:token@…`), a plain
`http://` URL, any other web address, a source that starts with `-` (git would
read it as an option; write a file named so as `./-…`), and a file over 64 KB.

## What a template may say

| Key | What |
|---|---|
| `schema` | Always `1` |
| `name` | A short name, such as `ACME Salesforce` |
| `description` | A sentence or two |
| `profile` | `generic` or `salesforce` |
| `environments` | Each one's `name`, `type`, `default`, `protected` and `promotesTo`, under the config's rules (D-015, D-018). In a Salesforce template, a type may be left out: Production's sandbox list gives it. In a template with no profile, a type left out is left to the project: Production's list in a Salesforce project, `none` in another |
| `gates` | `required`, `commands`, `heavy` and `severity`, as in `.acc/config.json` |
| `tracker` | One tracker: its `kind`, its place and a default project. Jira: `site`, `project`. Azure DevOps: `organization`, `project`, `prefix`. monday.com: `account`, `board`, `prefix`. GitHub: `kind` only, since it reads the project's own repo |
| `autonomy` | `manual` or `review`. `dispatch` and `full` are a person's choice in the project's own config |
| `agents` | `max`, and `builder` and `reviewer`, each with `model`, `effort` and `fallbackModel` |
| `rules` | A list of rules files acc init copies into `.acc/rules/`, each as `acc rules import` would, with a header naming where it came from (GH-108). Each is a GitHub file URL, `<git-url>#<path>`, or a path from `/` or `~/`: a relative path would mean a different file on each machine. Two can't share a file name. docs/RULES.md says how copies work |

Any other key is refused, by its dotted path, such as `agents.builder.efort`:
a typo in a file the whole team uses would otherwise quietly drop a rule. If a
template was written for a newer acc, update acc.

What belongs to one project is refused too: `github`, `commitIdentity`, an
environment's `org`, `worktrees`, `secretScan`, `strayFiles`, `autopilot`,
`agents.permissionMode`, and a tracker's `edits`, `epic`, `labels` and
`areaPath`. So is anything that looks like a sign-in, such as `token`,
`apiToken`, `password` or `email`, at any level. Each person signs in to a
tracker on the Command Center's Connect page.

## How acc init uses it

Flags win, then the template, then what acc init discovers, then acc's
defaults. `--jira-project` replaces the template's project. A `--profile` that
disagrees with the template's is refused.

- **The project, its GitHub repo and account, and its commit identity** are
  always discovered.
- **A generic project** takes the template's environments as they are.
- **A Salesforce project** takes its environments from Production's sandbox
  list, which decides which exist and their types. For each sandbox the
  template names, the template's `promotesTo`, `default` and `protected` win.
  A template environment with no sandbox is left out, and a sandbox the
  template doesn't name keeps acc's usual path. acc init says which, in a note.
- **A tracker with no project** (a monday.com one with no board) is left out,
  with a note. Connect it on the Command Center's Connect page.
- **A project started from an epic** (Setup's **From a Jira epic…** with a
  template) opens the Connect page at the template's tracker, with its site or
  organization and its project filled in. The epic, area path or labels are
  always the person's to pick, never the template's. The tracker picked
  (`acc init --tracker`) replaces the template's, with a note. On the same
  kind of tracker and host it keeps the template's `prefix`, unless the
  picked one names its own.
- **Check commands** the template adds run on the machine of everyone who
  uses the project. `acc template show`, `acc init --from … --dry-run` and
  Setup's confirmation list them before anything is written. `acc init
  --from` without `--dry-run` writes the config first, then lists them in its
  output, so review the file before you commit it.
- **Rules files** the template names are read before anything is written, so
  one that can't be read writes nothing. Each is copied into
  `.acc/rules/<name>.md`, named after its file, as `acc rules import` copies
  one. A copy already there is kept, with a note. `--dry-run` lists them and
  copies nothing. Review the copies and commit them with the config.

The project records where it came from:

```json
"template": { "name": "ACME Salesforce", "source": "https://github.com/acme/acc-templates/blob/main/salesforce.json", "digest": "sha256:…" }
```

A path is recorded relative to the repo, or as `~/…`, so no home folder is
committed.

## When the template changes

Setup's **The team template is current** step (`B0.template`) reads the
template again, as the account in the project's `github`. It waits 20
seconds at most in all: a GitHub or git template takes two calls, and they
share the time. It passes while the template is unchanged, or when it changed
but the project already agrees. When the project now differs, it asks you to check by
hand, names the keys that differ, and offers a preview that writes nothing.
`rules` differs when the template names a rules file with no copy in
`.acc/rules/`. Whether a copied rules file changed at its source is for the
**Copied-in rules are current** step (`B0.rules`) to say:

```bash
acc init --from '<template>' --dry-run
```

acc never applies a changed template by itself. To take it, run
`acc init --from '<template>' --force` and review the diff before you commit.
