## D-066 Ticket updates are drafts a person posts; ticket fields are read-only unless a tracker opts in (2026-10-05)

The author: "we should not be using this tool to change info on tickets, but
typically we can post updates … We should review status updates manually
before posting them." Until now `acc land` commented on a GitHub issue at
once, and the Command Center posted Jira and Azure DevOps comments as you
straight after a land (D-033). Its comment said "An agent built it and another
reviewed it", which is no way to talk to a client. The task page could also
change a ticket's status, assignee and labels (D-026).

- **acc posts nothing on a ticket.** It writes a draft update instead, one file
  per event in `updates/` in the state folder (`<task>.<n>.json`): the task,
  the tracker and key, the event, the text, and whether it was posted (with
  the text that went, who and when), discarded, or is still a draft. `acc
  land`, autopilot, `acc sync` and `acc deploy` only write files, so an
  unattended sync every two minutes posts nothing.
- **Drafts for these moments,** short and plain for the client, with no word of
  agents, worktrees, acc, builders, reviewers or rework (a test checks every
  template):
  - a pull request opened, or updated, for review: the link, and one sentence
    the review now writes for the client (`client` in the verdict), or the
    task's title when an older verdict has none
  - merged into an environment (`acc sync`, naming it), and deployed to its
    org (`acc deploy`). acc sync now keeps each pull request's merge commit
    (`pr.mergeSha`); a deploy drafts for each task whose merge commit is in
    what it deployed, and nothing when it fails or deploys nothing. A task
    squash-merged before acc kept merge commits is missed. Promotions draft
    nothing yet: that's a later ticket.
  - a builder stuck on something only the client can answer: `acc block
    --client "<question>"`, as the author chose. Its instructions say when: a
    business rule, missing access, or a choice that's the client's. A plain
    block stays internal.
  - one of the analysis's questions a person chooses to send: Send to the
    client on the question, which runs `acc update ask`. The question then says
    "Drafted for the client" or "Sent to the client", and keeps its answer box.
- **The same news again replaces an unposted draft,** as the author chose: a
  pull request updated three times is one draft, with the latest link. One
  that still says "ready for review" keeps saying so. Merged and deployed are
  told apart by environment, and questions by question. A task with no tracker
  key gets no drafts.
- **Review, then post.** Needs you lists each draft as "Update ready for
  <KEY>", in orange with its icon, counted in the rail and the badge. It shows
  the text (two lines, then Show all), with Post, Edit and Discard; editing
  happens only on the task's page, as the author chose. There, each draft sits
  at the top of the Activity feed (D-057), in a box to edit, saying who it
  posts as, with Post and Discard. The edit stays in the tab's memory until
  it's posted; acc keeps only the text that went.
  - A GitHub issue posts through `acc update post`, with gh as the repo's
    account (D-007, D-028). Jira and Azure DevOps post through the repo's own
    sign-in (D-027): the extension has acc claim the draft (`acc update
    posting`), posts, then records it (`acc update posted`), or puts it back
    with why (`acc update release`). The claim, under the drafts' lock, stops a
    second window's Post. A claim unconfirmed for five minutes may have posted
    (D-051's lesson): it says so, and offers Post again and Discard.
  - With no sign-in for its tracker, Post waits and the row offers the
    sign-in, rather than failing after the claim.
  - A posted update shows in the feed as the tracker's own comment, once the
    page reloads the ticket.
  - On the command line: `acc updates [--all] [--task <id>]` lists them, and
    `acc update discard <id>` sets one aside. `acc update post <id>
    [--text-file <f>]` posts only on GitHub, and refuses a Jira or Azure DevOps
    draft, saying to post it from the Command Center. Builders, reviewers,
    analysts and autopilot can't run any of them: the CLI refuses, `guardBash`
    refuses, and the builder's settings deny `acc update*`.
- **Ticket fields are read-only** on the task page unless the tracker says
  `"edits": true` in `.acc/config.json`, which must be true or false. This
  repo's own GitHub tracker does. The extension refuses those actions when a
  page sends them anyway. Comments stay. Dragging a card between a tracker
  board's columns still moves the ticket, with or without `"edits"`, as the
  author chose: it's a person's deliberate move on the board.
- This replaces D-033's posting as you after a land, and D-006's link comment.
  It amends D-026 (the page's field edits), D-051 and D-053 (no issue comment
  to confirm, so `LAND_TIMEOUT_MS` counts three gh calls), D-055 (autopilot's
  `pendingComments` are `updates`), and D-064 (a land's notice offers Review
  the update, not autopilot's output).
- Not chosen:
  - Every block drafting an update. Both real builder blocks in this repo were
    technical, and a client shouldn't see those.
  - Making board drags read-only too. A drag is already a person's own click.
  - Editing a draft in Needs you. The task page has the room, and the ticket.
  - Posting Jira and Azure DevOps drafts from the CLI. acc has no sign-in for
    them; the extension does.
