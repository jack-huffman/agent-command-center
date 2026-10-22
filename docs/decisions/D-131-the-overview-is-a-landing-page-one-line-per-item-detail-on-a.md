## D-131 The Overview is a landing page: one line per item, detail on a click (2026-10-09)

The Overview had become the place where everything happened: it answered questions in full, drafted
updates, listed every suggested rule with each review behind it, and ran each builder's checks line by
line, rows running into each other. After the author accepted a batch of suggested rules it was one wall
of content (GH-160). The author: "The home page should be a landing page, not a place where deep detail
is given. Info should be surfaced, not richly displayed." Now the Overview says what's going on and where
to look, and the detail opens on a click.

This replaces, for the Overview only, what earlier decisions drew inline there: D-052's analysis questions
answered on the Overview (they're answered in the task's page, opened over it), D-066's update text, Post
and Discard on the Overview (they're in the Update drafts detail), GH-102's (D-116's) rule detail under
Needs you (it's in the Suggested rules detail), D-092's job rows under each task in In progress (a task is
one line, its checks one fact), D-037's History feed on the page (its last five, then History in full in
the modal), and D-129's bullet that the Overview opens a task in a tab (it opens it over the page, as the
Tasks board does).

- **One line per item.** Each line on the Overview has its state, as an icon and a label; its task's key and
  its title, cut with an ellipsis, all of it in the line's title; two short facts at most ("12 min",
  "near-tests running"); and one button. Any other action is in its ⋯ menu, VSCode's own, from the line's
  context (`menuButton`, `withMenu`): a task's line holds Watch, Watch the review or the analysis,
  autopilot's Output, Open in Claude Code, its pull request and Stop, each behind a flag (`TASK_MENU`, which
  package.json's `webview/context` lists under `webviewSection == 'task'`); an agent's is its Agents menu;
  the tidy-up's is Not now. Nothing else is drawn on the line: no update text, no rule detail, no list of
  checks, no question's options.
- **A card each.** A line is a raised card with the depth tokens (D-127, `--raised`, `--edge`, `--lift`),
  6 px from the next; no two share a bar or a border. Its left edge says its tone: orange needs you, blue is
  under way. The lists are headed, each with its count: Needs you (or All clear), When you have a moment,
  In progress, Merge queue, Ready for an agent, History. The header's summary and buttons, the tiles and In
  progress's machine line ("Builders: 6 of 6 · Load: busy") stay.
- **Things of a kind collapse into one line.** Every suggested rule and check: "10 suggested rules, from
  repeated review findings", with Review. Every update draft: "2 update drafts waiting to post", in Needs
  you while one waits on a person, with Review. A task's analysis questions: one line for the task, with
  Answer. The heading still counts each thing, as the badge does, though drafts share a line. Questions
  come first in Needs you, then the collapsed lines, so they're seen within the five.
- **Five to a list.** No list shows more than five lines (`CAP`); "Show all N" opens the rest: the list in
  the modal, Ready on Tasks, and History in full, with its filters, in the modal.
- **Detail opens on a click,** in the modal a task's page opens in over the board (D-129), now a shared frame
  (`modal.ts`), sized to what it holds. A question's line shows the question with Answer, which opens it with
  its answers and its box, answered exactly as the card on the page was. Review opens the suggested rules one
  at a time, each with its line, the reviews it came from, Accept… and its draft, and Dismiss, with Previous
  and Next; the update drafts the same, each with its text, who it posts as, and Post, Edit and Discard. A
  task's line, in any list, opens the task's page over the Overview; an answer or a command in History opens
  History at it. Which detail is open is kept in the tab's memory, so a redraw draws it again from the new
  model, and one whose items have all gone closes. Answer on Agents opens its question the same way.
- **In progress, a line per task.** What its first job is doing, for how long, and its checks as one fact
  ("validate running", "2 checks, 1 waiting"), never as rows. A click opens the task; its ⋯ menu's Stop names
  the line's jobs' stops, and asks which when there are several (`pickStop`). A job that ended stays a minute
  as a line that fades.
- **The landing page is a model** (`landing.ts`): `homeModel` works the lines out from what the Overview
  already held, which stays for the details. The page draws them (`webview/landing.ts`, `detail.ts`).
- **Checked:** the screenshot run's new `overview` geometry check: on the Overview no line is taller than
  44 px at any width it draws, no list shows more than five, and neighbouring lines are at least 4 px apart;
  the Overview with no lines fails, so it proves it ran. It failed on the Overview before this change (301
  findings dark at 1000 px alone: lines up to 160 px high, History 24 lines, rows 0 px apart) and passes now.
  A busy Overview fixture, `overview-landing` (ten suggested rules, six tasks building with their checks,
  three questions, two update drafts, twelve things in History), and the same with a question, the update
  drafts and History opened over it, drawn light and dark at 1000, 620 and 500 px; `rules` and
  `rules-accept` open the Suggested rules detail. `landing.test.ts`: rules and drafts collapse with their
  count, the cap and Show all, each detail opens with the actions it had, the checks fact, the task menu
  against package.json and Stop's pick, and nothing is lost: every action the Overview offered on three
  fixtures (219 of them) is still a line's button, its ⋯ menu, or what the detail it opens holds.
- Not chosen: a page of its own for In progress or History, which the ticket left to the modal; dropping
  the In progress fold; an in-page menu in place of VSCode's own, which the rest of the page uses.
