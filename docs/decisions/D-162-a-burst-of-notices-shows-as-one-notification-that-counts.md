## D-162 A burst of notices shows as one notification that counts them (2026-10-15)

Amends D-044. After a person is away, the first reload finds many changes at
once, and each showed as its own VSCode notification, so the notifications
panel flooded.

- **One reload's notices are told together.** `update()` in
  `extension/src/notices.ts` looks at every project first, and then shows what
  `noticeBurst` (`extension/src/logic/notices.ts`) makes of all their notices.
- **Up to `BURST_AT` (3), each notice is its own,** with its own buttons, as
  before.
- **More is one summary:** "Since you last looked: 2 need you, 2 reviews
  passed, 3 merged." It counts the notices by kind, in words from
  `NOTICE_WORDS`, one row for each kind in `NOTICE_KINDS`, with the singular
  and the plural. Kinds with the same words count together: a builder waiting
  on its prompt and a blocked task both "need you". Kinds that hold an urgent
  notice come first, then the rest, each in `NOTICE_KINDS` order.
- **The summary is urgent when any of its notices is.** Its one button is
  Show, which opens the Overview. A burst about one task (one project and one
  id) names the task and keeps the buttons of its newest notice.
- **Slack is unchanged:** each project's events are still offered, one by one.
- **Checked:** `extension/test/notices.test.ts` adds three tests: three
  notices stay three, and more make one summary with its counts in order and
  its urgency; one task keeps its buttons, no notices give none, and two
  projects make one burst; and every kind has words. `extension/test/burst.test.ts`
  adds two: `update()` shows one notification for a burst across two projects,
  offers Slack each event, and its Show opens the Overview; and three notices
  across two projects stay three, each on its own task.

Out of scope: a list on the Overview of what changed while a person was away.
