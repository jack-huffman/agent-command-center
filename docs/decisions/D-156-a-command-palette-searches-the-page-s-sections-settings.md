## D-156 A command palette searches the page's sections, Settings, tasks, agents and actions, and Enter runs the choice (2026-10-15)

T-52. Every action is a command with an id, and a reason when it's off; the palette is the one place
that reaches all of them.

- **What it holds:** `paletteItems` in `extension/src/model/palette.ts` makes the items from the page's
  model, and `homeModel` sends them as `palette`. Each section; each part of Settings, which goes to its
  heading by `settingsKey`; each task row, by its title, with its key as its hint, which opens it over
  the page as a card's click does; each agent, which opens its page; and the actions: the header's Add
  task, Start an agent, Add a tracker and Refresh, each card's next step when it is Dispatch, Resume,
  Answer or Watch (`paletteStep`), and Agents' Stop finished. An action sends the same message, with
  the same argument, as its button. Off, an item carries its reason as its hint (no project: the
  header's three; no finished session: Stop finished), and doesn't run.
- **The search is the page's:** `extension/webview/fuzzy.ts` holds the match and the results, with no
  DOM, so `palette.test.ts` loads it. Each typed character, in order, anywhere in an item's words, case
  ignored, spaces in the query left out. A character scores 1, 6 more at the start of a word (after a
  space or a sign, or a capital after a small letter), and 8 more right after the last one; the best
  way through the words wins, and a tie goes to the match nearer the front. At most 12 results show,
  grouped by kind, the group with the best match first; a line under them counts the rest, or says
  nothing matches. With nothing typed: the last 8 items run, kept in the tab's memory as drafts are,
  then the sections.
- **Words, not commands:** an item's words start with its title, then its hint when that is a key or
  Settings, then more words to find it by. A disabled item's reason is never in its words.
- **How it opens:** the rail's **Search or run a command** under the brand (its icon alone in the
  narrow strip), `/` outside a text box or another modal, and `acc.palette`, which the manifest binds
  to Cmd+K on a Mac and Ctrl+K elsewhere when `activeWebviewPanelId == 'acc.home'`. The command posts
  `{ type: 'palette' }` to the page; with the page closed, it opens it and posts once the page is ready
  (`Panels.tell`). Cmd+K also starts VS Code's own two-key shortcuts; the terminal's Clear binds it the
  same way, a single key with a `when`, and the key wasn't tried in a VS Code window on this branch.
- **The sheet:** the page's modal (`makeModal`), 560 px at most, 48 px from the top, the box in its bar
  above the results. It opens with the modal's fade and scale from its top edge, and under reduced
  motion only fades (task-modal.css). The box is a combobox naming the choice with
  `aria-activedescendant`; the list a listbox of options in labelled groups; the line under them is the
  live region. Up, Down, Home and End move the choice, Enter runs it, Escape and a click outside close
  it. Tab and Shift+Tab stay in the box, and a key typed elsewhere in it goes to the box. Focus goes
  back to what opened it, the rail's button found again if the page redrew under it.
- **Checked:** `palette.test.ts` adds 16 tests: the items on the busy Overview (each section, part,
  task, agent and action, counted), no tasks, two tasks with one title, a disabled action, the next
  steps, the ranking rules, an expected order for a small set, groups, a key alone, the limit, recents,
  bold parts, the manifest's key and the rail's button. `activate.test.ts` checks the command posts the
  message to an open page, and to a closed one only once it's ready. The behaviour run adds 7 palette
  cases and 9 mutants, and the Escape mutant now names the palette's case too. The screenshot run adds
  `palette` ("acme" typed) and `palette-empty` (recents, then sections), and the colour check draws
  `palette`.

Out of scope: a search inside transcripts, history or ticket bodies.
