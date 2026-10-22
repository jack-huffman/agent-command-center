## D-033 acc land opens the pull request; acc sync follows it (2026-10-02)

- **`acc land <id>`** needs the task in review, its checks settled, and a passing
  review on the branch's latest commit.
  - It pushes with the clone's credential helper, so as the repo's account
    (D-028). It opens the pull request with `gh` as that account.
  - The description holds the review's summary, the acceptance criteria ticked
    off, every check (waivers named, with their reasons), and the non-blocking
    findings.
  - A GitHub issue gets a comment with the link. A Jira or Azure DevOps ticket
    gets one from the extension, signed in as you.
  - Landing again after rework updates the same pull request. It never merges.
  - The page asks first, because landing is the first thing that leaves the
    machine.
- **`acc sync`** reads each open pull request:
  - merged → done
  - closed without merging → blocked, with the reason
  - failing checks, or a person asking for changes → needs you, with the reason
    on the Overview
  - It writes to the ledger only when something changed.
- **On the page,** a task in review shows one next step: Watch the review,
  Review, Land, or its pull request.
