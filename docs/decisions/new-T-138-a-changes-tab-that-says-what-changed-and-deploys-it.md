## D-T-138 A Changes tab that says what changed and deploys it, with a confirmation (2026-10-28)

T-138. The person found the Changes tab, and the manifest most of all, too much: "I want to know the metadata
changed, but everything else is too involved." They also want to deploy straight from the ticket, with a
confirmation so it can't happen by accident. This draws D-219's ticket deploy on the task page, in the calm
style of D-216 to D-218: no repeated tab heading, one level of borders, even spacing, each fact once.

It amends D-189 (Planned changes, then Changes, with a Planned/Changed toggle), D-190 (Record changes as a
section of their own) and D-191 and D-196 where they place their sections on the page. What those sections do
stands: they move, they aren't taken away.

- **Where it is and Deploy come first.** The path line and Deploy sit at the top of the tab, under the tabs and
  above the list, so a long list never pushes Deploy out of view (the person asked for this while it was built).
- **Then what changed, mostly alone.** One list, by type with a count ("Apex Class 3",
  "Flow 1"), each component by name with its paths in its title. Before there's work it is the plan's ("Metadata
  planned"); once there is, what was made ("Metadata changed"). There is no Planned/Changed toggle. What was
  planned and not made, and made and not planned, wait behind one quiet line that says how many and opens them,
  each with its mark (`changeList` in `extension/src/model/changes.ts`). Outside Salesforce the list says
  "Files". The tab's count is this list's.
- **Deletions in words.** A component every path of which the branch deletes carries a trash icon and the word
  "deleted", never colour alone. In flight the extension asks git which changed paths the branch deletes
  (`deletedPaths`); once merged, the deletions a ticket deploy kept say so.
- **A ticket deploy keeps each deletion as a step.** acc never deletes a component in an org (D-191). After a
  ticket deploy, each component it deletes is kept on the task as a change outside git of a new kind,
  `deletion` (`packages/core/src/deletion-kind.ts`, registered in `OUTSIDE_KINDS`), so it is a step in each org
  the ticket reaches, marked done or skipped as a record change's step is (D-190). A later deploy keeps it once.
- **Record changes are a short list in words** after the metadata, when there are any.
- **Where it is: one line.** "Dev, merged · QA, deployed 3 h ago · UAT, next · Production, later": the
  environments along the path's usual way (each one's first `promotesTo`), each with an icon and words. Blue for
  where the change is, orange for the next step, quiet for later (`ticketPath`).
- **Deploy to <next environment> is the tab's one primary button.** Another next step on the path is in a
  small menu beside it, three at most (D-205). It is off, with its reason beside it and in its title, when D-219's
  command says so (not built yet, a builder at work, the end of the path, not Salesforce, not on GitHub), while
  its own checks fail and no one accepted them ("The validate check failed: fix it, or accept it anyway, first.",
  `deployBlockers`), while its pull request conflicts with its environment ("It conflicts with dev: take in dev
  first."), when a task it depends on isn't in that environment yet, when its org isn't in the settings, and while a check or a
  deploy of the ticket is under way, in this window or another (acc's deploy job, D-092).
- **It opens a sheet, and never deploys at once.** The click asks the extension for D-219's plan, in the output
  panel, where its steps show; the sheet says "Checking against UAT…" and, under it, the step acc is on. Then it
  shows the destination and its org, the components (a count, the list folded), the tests that run, and what is
  left to do by hand with how many: deletions, record steps and environment-specific files. A failed check says
  why per component and has no Deploy at all. The sheet's own Deploy is on only after a passed check, and for
  production or a protected org only once its name (or its org's alias) is typed. Cancel, Escape and the
  backdrop always close it: a check under way is let go, its plan never shown; a deploy under way can't be
  taken back, so the sheet closes and the tab says what it's doing, then how it went.
- **The yes is checked twice.** Only the sheet's Deploy sends `deploy-go`, with the check's id and the typed
  name. The extension refuses it unless its own kept run is a passed check for that environment with that id,
  and the name typed where it's asked (`yesRefusal`); acc refuses any yes it didn't check (D-219).
- **After the deploy**, the sheet shows the result: deployed, the pull request, and any warning. The steps left
  are listed on the tab under "Left to do by hand", each environment's, with Mark done and Skip: record steps and
  deletions alike.
- **Everything else is under one closed More**, at the end: Manifest for this ticket (its package.xml with View,
  Copy and Save as a file, Check against the org and its differences, D-191), the tracker's changes field
  (D-196), Record changes with Add a change made by hand and the steps already made or skipped (D-190), its
  builder's own deploys with what the tests found (D-206), and the team (T-103). Notices that need the person
  stay above the tabs. Nothing that works today is lost; it's a fold away.
- **The tab's needs-you** comes from the deploy waiting on the person (a passed check not yet confirmed) and the
  steps left to do by hand, never from the manifest's or the field's state.
- **The command `acc.task.deploy`** is registered (D-219's spec): it opens the ticket's Changes tab and starts
  the check toward its next environment, or the one named. It is hidden from the command palette, as
  `acc.env.deploy` is.
- **Review's notices (T-135).** A rework notice keys its part on its cause: work sent back because its checks
  failed on GitHub names no part, so it no longer opens the Review tab; a review's own notices still do. The
  Review block no longer draws the orange attention border: the tab's needs-you bell carries that state.

Checked by `extension/test/ticket-deploy.test.ts` (the path line, Deploy off with a reason in each case, the
sheet's facts, the yes only for a passed check with the typed name), `extension/test/changes-tab.test.ts` (the
tab as drawn, More closed holding what moved, needs-you), `extension/test/changes.test.ts` (the list's groups,
counts, quiet line and deletions), `packages/core/test/deletion-kind.test.ts`, and five behaviour cases with
five mutants: Deploy runs without the sheet's confirmation, a failed check still offers Deploy, Production
deploys without its name typed, Deploy on the tab deploys at once, and Deploy off doesn't say why beside it.
