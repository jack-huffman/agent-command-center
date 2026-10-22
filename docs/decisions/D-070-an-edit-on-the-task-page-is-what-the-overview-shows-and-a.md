## D-070 An edit on the task page is what the Overview shows, and a replaced draft keeps its edit (2026-10-06)

GH-41's review (D-066) left three points open. The first could post text the
person didn't mean to send. An edit typed on a task's page lived only in that
tab's memory, so Post in Needs you sent the draft as acc wrote it. A newer
draft of the same news got a new id, and the page dropped the edit typed for
the old one without a word.

- **The task page tells the extension about its unsent edit** (`update-edit`):
  the first keystroke that makes the box differ from acc's text (after trim)
  goes at once, then the typing after a 400 ms pause. Typing back to acc's
  text, Use the newer draft, a post or a discard sends null. After every
  redraw the page sends what it holds, so a tab brought back from hidden
  says it again. The extension keeps it in memory for that page only, and
  only for that page's own task.
- **Needs you shows the edit.** Its row says "Edited on the task page" with
  the edit icon, in orange, and shows the edited text: the text the task
  page's Post would send. Edit (open the task page) leads, Discard stays, and
  there's no Post. It still counts as needing you. A row drawn before the edit
  arrived still has Post, so the extension refuses an Overview Post whose text
  isn't the edit: "it was edited on the task page, so post it from there."
  The guard is in the Overview's handler only. Putting it in the shared post
  would refuse the task page's own Post while its last keystrokes are still
  on their way.
- **A draft names the drafts it replaced:** `replaces`, newest first, up to
  20 ids, written by `draftUpdate`. Older drafts without it carry nothing
  over, and there's no migration.
- **A replaced draft's edit moves to the newer draft.** It's moved before
  the page drops edits for drafts that have gone, and it's read through
  `replaces` even when it hasn't been moved yet, so a page hidden through
  .1 → .2 → .3 still finds it. The page says "A newer draft replaced this one;
  your edit is kept". The page records the text each edit was typed against.
  If the newer draft's wording differs from that text, the page shows both:
  the edit in the box, and the newer wording read-only beneath it, with Use
  the newer draft. While the page is hidden, the extension follows `replaces`
  too, so Needs you still says the newer draft was edited.
- **One keyed helper** (`extension/webview/pending.ts`) now keeps what the
  page waits on acc for: an answer, a post, a discard, a question sent to
  the client. It replaces two parallel pairs of maps. Messages and behaviour
  are unchanged: an answer stays "Sending…" until its question goes, and a
  refused answer shows its error only if it was still sending. The carry-over
  logic lives beside it, where node's tests can import it.
- This amends D-066: an edit still stays in the tab's memory, but the
  extension now knows of it, and a replaced draft no longer loses it.
- Limits, as the author chose: **this window only.** The edit lives in this
  window's extension. A second VS Code window's Needs you can still post
  acc's text. Closing the task page, or reloading VS Code, still drops the
  edit, and Needs you goes back to acc's text with Post.
- Not chosen:
  - Saving the edit into acc's update file (an `acc update edit`). That would
    stop Post in every window, but it would also write a person's half-typed
    text to disk.
  - Editing in Needs you. D-066 rejected that, and this doesn't change it.
