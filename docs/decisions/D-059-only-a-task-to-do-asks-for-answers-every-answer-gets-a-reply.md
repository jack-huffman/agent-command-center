## D-059 Only a task to do asks for answers, every answer gets a reply, and the Overview names conflicting files short (2026-10-05)

Follow-ups from GH-29's review (D-054, D-049).

- **An analysis after the build is news.** `acc analyze` takes a task in
  review, rework or blocked, but only a task to do has questions to answer on
  its page (D-054). Analyzed again in any other state, the notice says
  "GH-29's analysis is back", adds "Its 2 questions can be answered with acc
  analysis answer" when there are some, and offers only Show. It isn't a
  warning and never offers Answer or Dispatch. A task to do keeps its three
  notices. The author chose this over letting the page take answers after the
  build, which would be its own ticket.
- **Every answer sent from a page gets a reply.** The page shows "Sending your
  answer…" until it hears back, so the extension always answers: done, or why
  not. A project that isn't open, an answer for another task, or acc's refusal
  each comes back with its reason. The page shows the reason under the
  question, in orange with a warning icon, keeps the draft, and lets you send
  it again.
- **The Overview names conflicting files by folder and name,** as the cards do
  (D-049): `layouts/Lead-Lead Layout.layout-meta.xml`, the first three, then
  "and N more". Hovering the row's words lists every file in full, and the
  task's page still names every file in full.
