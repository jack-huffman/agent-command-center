## D-090 Agents show each session's folder in context, with Full path a toggle (2026-10-06)

The Agents tab's Where column was relative only for a session in a project open
in the window. Every session elsewhere showed its whole cwd, the same long text
on every row, clipped at the column's edge. The agent's page and its Needs you
card each worked the folder out again, three ways (GH-83).

- **One helper names a session's folder,** `sessionFolders` in the extension's
  model, for the Agents tab, an agent's page, its Needs you card, and GH-76's
  In progress section when it's built. Each folder has a label and its full
  path, with `~` for the home folder.
- **In a project open in this window,** a session reads as where it is in it:
  `main checkout`, `worktree ACME-12`, `force-app/main`, or `worktree AV-2` for
  a linked worktree outside the project's folder. The Agents tab leaves out the
  project, which its group's heading names. The agent's page leads with the
  project's name from its config: `Acme Service › worktree ACME-14`. The Needs
  you card reads `Acme Service · worktree ACME-11`, as the other cards put their
  project first.
- **Elsewhere,** a session reads as its repo's folder name, then the path inside
  it: `Acme Service`, `Acme Service › force-app/main`. The repo is the nearest
  folder up holding `.git`, a folder or a linked worktree's file. A builder's
  worktree under `.claude/worktrees/` reads as its repo's from the path alone,
  `Acme Service › worktree ACME-12`, though its own `.git` file would make it a
  repo. Outside any repo, a session reads as its folder's own name, or `~`.
- **The walk stops before the home folder and `/`.** A repo at `~` (dotfiles)
  would otherwise be every folder's repo, and every label would start `me ›`.
  The hub looks for `.git` once per folder each time `claude agents` answers,
  so a repo made since shows on the next poll.
- **Two folders of one name each add their parent folders until they differ:**
  `clients/Acme Service` and `personal/Acme Service`. The rule compares the
  folder that names a session, its repo or itself, across every session `claude
  agents` lists. So a worktree of one says which it is, `clients/Acme Service ›
  worktree ACME-40`, and a session reads the same in the table, on its page and
  on its card. Sessions in a project open here are named by their project and
  aren't compared. Two sessions in one folder share one label.
- **Folder or Full path, by a toggle with an icon and a label each,** that
  switches the Agents tab only. It sits just above the Where column's heading,
  on the right, outside the table. In the heading it set the column's least
  width: at 1000 px the row menu then covered Started, and at 500 px the toggle
  scrolled out of view. Folder is the default. The choice is kept in the
  window's workspaceState (`acc.agents.where`), as the section is, so it
  survives closing the Command Center and reloading the window. A stored value
  other than `folder` or `path` is ignored.
- **Full path shows the whole folder, with `~` for home.** Both views wrap a
  label too long for its cell, as the session names do (D-087), rather than
  clip it: beside the names and the Model column, a clipped cell kept only
  `worktree ACM…` at 1000 px, and clipping a path at its start cut its last
  letter. They break between words and after a slash, never inside a name or
  a key (`ACME-12` stays whole), and the cell has no minimum width, so a narrow
  tab never pushes the table under the row menu. Below 660 px the session's
  name stops taking all the room left over, so the columns share it. Hovering a Where cell shows the full path in either view, as do the
  folder on an agent's page and the Needs you card.
- Folder labels are names, not paths, so they're in the UI's font, on the
  Agents tab and the agent's page. Full paths stay in the code font.
- Not chosen:
  - The toggle switching the agent's page and the Needs you card too: a person
    decided they always show the folder in context, with the full path on
    hover.
  - Resolving a linked worktree's `.git` file back to its main repo. A linked
    worktree outside `.claude/worktrees/`, in a repo not open here, reads as its
    own folder.
  - The Worktrees tab's Location column, question and permission cards, and the
    acc CLI's output, which name worktrees and files, not sessions' folders.
