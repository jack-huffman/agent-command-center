# Shared rules

A lesson learned in one project should reach the next project's agents. A team
keeps its rules in a Markdown file, such as its Apex standards, and each
project copies that file in. The copy lives in the project's repo, in
`.acc/rules/`, with a header saying where it came from. Agents read only the
copy, so a source that moves or goes changes nothing for the project. acc
ships no rules. The sample below is ACME's, a made-up team.

```bash
acc rules import <source>              # copy a rules file into .acc/rules/
acc rules import <source> --dry-run    # say what it would copy, writing nothing
acc rules list                         # each copy, and whether its source has changed
acc rules diff [<name>]                # how a copy differs from its source now
```

In VSCode, Setup's **Copied-in rules are current** row always offers **Import
rules…**. It asks for the source, shows the file's first lines and where it
goes, and copies it in only when you say so.

## A sample

ACME keeps its Salesforce rules in a GitHub repo, at
`https://github.com/acme/acc-rules/blob/main/salesforce.md`:

```markdown
# ACME Salesforce rules

- Every Apex class has a test class named `<Class>Test`, in the same folder.
- Triggers hold no logic: each calls one handler class, `<Object>TriggerHandler`.
- Log with `ACME_Logger.log(...)`, never `System.debug`, in code that ships.
- Custom fields are named in PascalCase, with no underscores but `__c`.
- A new permission goes in a permission set named `ACME_<Feature>`, never in a profile.
```

`acc rules import https://github.com/acme/acc-rules/blob/main/salesforce.md`
writes `.acc/rules/salesforce.md`:

```markdown
<!-- acc-rules v1: copied in by acc rules import. This repo keeps its own copy and may edit it; acc rules diff compares it with the source.
source: https://github.com/acme/acc-rules/blob/main/salesforce.md
commit: 0f3c9a1e2b4d5c6f7a8b9c0d1e2f3a4b5c6d7e8f
copied: 2026-10-07
sha256: 3b1f…
-->
# ACME Salesforce rules
…
```

The text after the header is the source's, unchanged. Review the file and
commit it like any other change. Builders read it once it's on the
environment's branch their worktree starts from.

## Where rules come from

| Source | Example | Read with | The header records |
|---|---|---|---|
| A file in one of the team's GitHub repos | `https://github.com/acme/acc-rules/blob/main/salesforce.md` | `gh api`, as the repo's account | the last commit that changed the file |
| A file in any git repo | `https://git.example.com/acme/acc-rules.git#salesforce.md` | a shallow `git clone` | the commit it read |
| A path on this machine | `~/acme/acc-rules/salesforce.md` | read from disk | the date only |

Sources are read and refused as team templates are (docs/TEMPLATES.md): `gh`
reads as `--github-account`, else the account the repo pushes as, else gh's
active account, and acc never runs `gh auth switch`. acc refuses a sign-in in
the URL, plain `http://`, any other web address, a source starting with `-`,
an empty file, and a file over 64 KB. All the copies together may come to
128 KB, since every packet, review and analysis carries them.

A path inside the repo is recorded relative to it, and one under your home
folder as `~/…`, so no home folder is committed. The copy's name is the
source's file name; `--name <name>` gives another. A copy already there is
replaced only with `--force`.

## The order agents read them in

Builders, reviewers and the analyst get one **Rules** section, always in this
order:

1. **The profile's rules.** A Salesforce project's: bulk-safe Apex, sharing
   and field access, tests that assert outcomes, and no values that belong to
   one org. A generic project has none.
2. **Each copy in `.acc/rules/`,** by file name, under a heading naming where
   it came from. The header isn't sent.
3. **`.acc/rules.md`,** the repo's own rules.

Where two disagree, the later one wins, and the section says so. So a project
that needs to differ from its team writes the exception in `.acc/rules.md`:

```markdown
- ACME's test-class rule doesn't apply to the generated classes in force-app/main/default/classes/gen/.
```

A copy may be edited in the repo too, as each project keeps and evolves its
own. acc never reads a source when it dispatches, reviews or analyzes.

## When the team changes its rules

Setup's **Copied-in rules are current** step (`B0.rules`) reads each source
again, within 20 seconds for all of them together. It compares the source with
what was copied, by the sha256 in the header, so an edit made in the repo never
counts as a change at the source.

- **Every source is unchanged:** Done, and it says which copies were edited
  here.
- **A source has changed:** Check by hand, naming the copy. **Do it** runs
  `acc rules diff <name>`, which shows the copy against the source now and
  changes nothing. When the copy was edited here, it says copying in again
  would replace those edits.
- **A source can't be read,** such as a repo you can't reach: Check by hand,
  with the reason. Nothing changes.
- **A path that isn't on this machine:** Doesn't apply.
- **Nothing copied in:** Doesn't apply.

acc never copies a rules file in again by itself. To take the team's change,
run `acc rules import <source> --name <name> --force`, read the diff in git,
and commit it. Any edits made to the copy here need making again.

## From a team template

A team template can name rules files to copy in when a project starts:

```json
"rules": ["https://github.com/acme/acc-rules/blob/main/salesforce.md"]
```

`acc init --from <template>` reads every one before it writes anything, then
copies each in as `acc rules import` would. `--dry-run` lists them and copies
nothing. A path in a template starts with `/` or `~/`, since a relative one
would mean a different file on each machine. docs/TEMPLATES.md has the rest.

## Who does what

Copying rules in is a person's: a builder can't run `acc rules import`, and a
change under `.acc/` is never merged by the merge queue or autopilot. A
builder may run `acc rules list` and `acc rules diff`, which only read.
