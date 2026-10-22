## D-164 News while you are away waits on the Overview's Since you last looked (2026-10-15)

Amends D-044, and builds on D-162. A person who comes back to VSCode wants
what changed while they were away in one place, and the notifications panel
is not that place.

- **Away is ten minutes with no window focus** (`AWAY_AFTER_MS`). The pure
  part, `Away` in `extension/src/logic/away.ts`, decides it from the focus
  changes and the time. `Notices.focus()` gets each change from the window's
  `onDidChangeWindowState`.
- **While away, news is held; urgent notices still show,** through D-162's
  burst rule. Slack still gets each event, as before.
- **On return after an away span with news,** one notification:
  "While you were away: 1 review passed, 2 merged.", worded by
  `noticeCounts`, the burst's counting, now shared. Its Show opens the
  Overview at the new group's heading (`acc.open.home` takes a part). A span
  with no news says nothing.
- **The Overview shows Since you last looked** between Needs you and the
  cards: a calm line for each held notice, with an icon and a label for its
  kind (`SINCE_LOOK`, orange for what needs you, blue for news), its task key
  and its text. A line opens its task. Clear (`acc.since.clear`) takes the
  group off at once and forgets the list.
- **The list stays** until Clear, or until the next away span starts, which
  starts it again with that span's news. It is held in the window's memory
  only: a reload of VSCode starts it empty.
- **Checked:** `extension/test/away.test.ts` (10 tests): nine minutes is not
  away and ten is, focus back ends the span, news is held and urgent is not,
  a span with no news says nothing, two spans keep the newer one's news,
  Clear, the welcome back's words, and the group's lines. `burst.test.ts`
  adds two that drive `Notices` with a fake window state and clock. The
  screenshot run adds `overview-since`, and a behaviour case clicks a line
  and Clear, with two mutants: Clear that leaves the group, and Clear that
  tells the extension nothing.

Out of scope: Slack's messages, and keeping the list across a reload.
