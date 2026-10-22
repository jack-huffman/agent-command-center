## D-047 Setup reads in the order things are set up, a section for each thing, with done steps muted (2026-10-03)

The author found the Setup page "too large and disorganized". Steps showed in
the order their checks finished, so B14 (tickets), re-checked first as
projects load, came before the repo itself. Every step was a full tile with
its id, and done steps looked the same as ones still to do.

- **Order:** the step list's order, the order you'd set up a new project in.
  The checks' order no longer matters. A step this build doesn't know goes at
  the end of its group.
- **Sections:** each group of steps is named for what it sets up:
  - This machine: Tools, Accounts.
  - This project: The repo, Orgs, GitHub account, Client data and secrets,
    Salesforce project, Environment branches, Source tracking, Environment
    differences, Safe defaults, Background agents, Tickets, Drift.

  Neighbouring groups with the same name share a section: B4 and B5, and B12
  and B13. The names live beside the steps in core (`GROUP_TITLES`), so there
  is still one source (D-017).
- **Done steps look done:** one muted line with the icon, "Done", the title
  and the detail, and Check again on hover or focus. A section with nothing to
  do folds to one line ("All 3 done"), and one with steps to do opens. Opening
  or closing one by hand is remembered.
- **Steps to do stay whole, but shorter:** the status, the title, what's wrong
  in a sentence, the command to copy if there is one, and the buttons. The
  step's id is gone from the tile, and why the step matters is the title's
  tooltip.
- "Pass" reads "Done" and "Fail" reads "To do", since this is a checklist.
