## D-029 One Command Center page replaces the sidebar views (2026-10-02)

Five narrow, stacked trees in the sidebar made people hunt, and each tab opened
on its own. Now there's one full page. This supersedes D-020's sidebar and
D-021's separate tabs.

- **The activity bar icon is a launcher.** Clicking it opens the page and closes
  the sidebar. Its one view lists the sections with their counts, for anyone who
  sets `agentCommandCenter.openFromActivityBar` to false. Its badge counts what
  needs a person.
- **A rail holds the sections:** Overview, Tasks, Agents, Worktrees,
  Environments and Setup. Each shows a count, outlined in orange when it's
  something for you. Arrow keys move between them. Below 820 px the rail becomes
  a tab strip along the top.
- **Overview comes first.**
  - **Needs you** lists agents waiting on a prompt (with Attach), blocked tasks,
    missing tracker sign-ins and setup still to do. It counts only those, so the
    rail and the inbox agree.
  - Work waiting for review follows as its own group.
  - Stat tiles open their sections. **Ready for an agent** has Dispatch, and
    **Recent activity** shows the latest moves across tasks.
  - An agent already shown through its task isn't listed twice.
- **One model.** The page gets every section's data in one message, and moves
  between sections without a round trip. It reopens where it was left.
  `acc.open.<section>` opens it at that section.
- **Ticket pages stay separate tabs.** A ticket is a document, and several can
  be open side by side.
