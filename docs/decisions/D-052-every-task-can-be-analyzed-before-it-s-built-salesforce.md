## D-052 Every task can be analyzed before it's built; Salesforce tasks must be (2026-10-05)

The author asked for this: "before we build, we need to analyze the ticket
to understand requirements, and we need to investigate the Salesforce org to
understand what is there, how things play out, what refactors may be
needed". Until now a builder got only the ticket's text.

- **`acc analyze <id>`** runs a read-only analyst agent, like the reviewer
  (D-032) but before the build. Its answer has a fixed shape (`--json-schema`):
  - requirements: the goal, testable criteria, assumptions, out of scope
  - questions only a person can answer, each with why it matters and a
    suggested answer
  - findings, each with its source
  - the approach: steps, files, refactors needed first, risks, tests, a size
  - a verdict: ready, questions, or split, with the smaller tasks it suggests

  The analysis is kept in the state folder (`analyses/<id>.json`), never in
  git.
- **Answers:** `acc analysis answer <id> <q> "<text>"`, by a person only. When
  the last question is answered, the task is ready. Analyzing again carries
  the answers over to the questions it asks again.
- **The builder is given it:** the packet gets a "What the analysis found"
  section, after the ticket. It holds the criteria, what was decided, the
  findings, the approach, the refactors, the files, the risks and the tests.
- **The gate:** `analysis.required` in `.acc/config.json`. It defaults to true
  for Salesforce and false otherwise, as the author chose. A first dispatch
  of a task that needs one is refused until there is an analysis that isn't
  "split", with every question answered. A person can dispatch with
  `--without-analysis`. A rework doesn't need a new one.
- **Read-only, three ways:**
  - Claude Code's `dontAsk` refuses any tool not allowed.
  - The allowed tools are Read, Grep, Glob, read-only git, and read-only `sf`:
    org display, data query (the Tooling API included), sobject describe,
    org list metadata, limits, project retrieve start, and apex logs.
  - The analyst's PreToolUse hook checks every command word by word, through
    chains, and refuses anything else, as well as any edit.

  On Salesforce it runs in a scratch project under the state folder, so a
  retrieve can't touch the repo, and it reads the repo with `--add-dir`.
- **What it may read:** every org the project lists, and a few sample records,
  production included, as the author chose. It's told to read only the fields
  it needs, and not to copy personal details into the analysis. The
  analysis isn't committed.
- **Our own skill (D-002).** The plugin's `analyze` skill and the analyst's
  instructions borrow from the installed house skills. They took the
  org-safety posture of working-with-salesforce-orgs, the read-only
  inventory of diagnosing-org-health, and Tooling API recipes for automation
  order and dependencies. They depend on none of them, so an analysis comes
  out the same on any machine.
- The analyst runs with the reviewer's model and effort for now. A role of its
  own would mean touching every place that lists the roles.
