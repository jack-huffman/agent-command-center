## D-T-168 A ticket's tabs are words, Plan is Plan & build, and its notices are banners closed by default (2026-10-31)

T-168. The person sent two screenshots of a pilot ticket on 0.55.0 and wrote: "Too many icons on the tabs." About
the "Why it's blocked" and "Shares files with" notices above the tabs: "I'm not happy with their styling … I think
some kind of banner that is expandable with detailed info, but defaults to being collapsed?" And: "can we rename the
'Plan' tab to 'Plan & Build' or something like that? It needs to be clear at a glance where we go to actually build
the solution."

- **The tabs are words** (`TAB_LOOK`, `extension/webview/tab-rules.ts`). A tab shows its name, its count and the
  needs-you mark (an orange bell and "needs you"), and no icon of its own. Its accessible name is still its visible
  words.
- **Plan is "Plan & build"** where a person reads the tab's name. The part's id stays `plan`, so a link, a notice or
  Needs you that names the part still opens it. Links that say "See the plan" or "Answer" name what they show, not
  the tab, so they keep their words. The palette lists no tabs.
- **Each notice above the tabs is a banner** (`extension/webview/banners.ts`): Blocked, Conflicts, Checks failed,
  Card, and the files one (Shares, Waits, Starting, Needs you or Files, by what the files notice says). Each is a
  `details` element whose summary is one line: an icon with the label in bold, then the summary, which read as one
  sentence ("Blocked: …", "Shares 3 files with ACME-13"), cut with an ellipsis where there's no room and whole in
  its title, then a chevron. It is closed on each draw unless the person opened it; the tab remembers that per task
  in its opened list, as its other folds do (`banner:<id>:<project>#<task>`). Opened, it shows the detail: the
  note's bullets, the files, the checks, or the reason in full.
- **One level of border, the theme's colours.** A banner has one border, its tone on that border only: orange for
  what waits on the person, blue for news, the theme's line otherwise. No box inside it. The page's error and
  outside-the-repo notices above the header are not banners: they hold a button, or are not about the task's work.
- **A blocked note's question is a choice.** Where the note's item lists options (a, b, c), the open banner shows a
  native radio group named by the question: the first three options (`CHOICE_MAX`, pinned to `OPTIONS_MAX`, D-205),
  then In your own words with a text box. Typing picks own words. Send is off, with why, until there is an answer.
  An item with no options stays a bullet.
- **Sending gives the answer to the blocked builder** as the Agent panel's reply does (D-060): the page sends
  `blocked-answer` (`extension/src/model/banners.ts`), and the `blocked-answer` area (`extension/src/blocked-answer.ts`)
  finds the builder's session (`answerSession`: the listed one, else the one acc recorded, in its worktree) and
  resumes it with the answer through `AgentPages.send`. The message the builder reads names the note's headline, the
  question and the answer. It does not unblock the task: the builder carries on, and finishes or blocks again, as
  after any reply. The page hears back (`blocked-answered`): the question then shows "Your answer was sent to its
  builder", and the banner's line says Answer sent. A refusal says why under Send, with the pick kept. An answer
  kept for an older note doesn't count for a new one.
- **Where it can't go.** A cloud builder's session is on claude.ai (GH-69), and a run with no session has no
  conversation to carry on (`blockedReply`): the choice is off and says why.

Checked by `extension/test/banners.test.ts` (closed by default, remembered per task, detail, the choice's three and
own words, Send and its reply, the message's check, the session it goes to), `extension/test/task-tabs.test.ts`
(no icon on a tab, Plan & build), `extension/test/choice-limit.test.ts` (the banner's radio group) and
`extension/test/notes-drawn.test.ts`. The screenshot run draws `ticket-banners` (all closed), `ticket-banners-open`
(all open, an answer picked and own words written) and `ticket-banners-sent`, at each width and theme.
