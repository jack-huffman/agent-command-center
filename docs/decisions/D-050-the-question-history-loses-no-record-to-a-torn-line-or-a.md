## D-050 The question history loses no record to a torn line or a trim (2026-10-05)

Two ways D-043's history could lose a record, from GH-11's second review.
Issue #17. Neither was new, but D-043 trims every 64 KB of growth, not every
1 MB, so the second came up more often.

- **An append after a torn last line starts a line of its own.** A crash
  mid-write leaves a last line with no newline, and the next record joined it,
  so neither read. An append now reads the file's last byte, and only that, and
  writes a newline first when it isn't one. The newline and the record go in one
  write. The torn line stays a line that doesn't read, which the readers skip and
  the next trim drops (D-043).
- **An append and its trim hold a lock,** `history.lock` next to the history,
  with `withLock`, as the ledger's writes do. Without it, a trim that read the
  file before another hook's append renamed its copy over it, and the record
  was gone. Both take milliseconds, so the lock is short: a lock held past 5
  seconds is broken, and a waiter gives up after 10, so it always outlasts one
  left by a crash.
- The readers don't take the lock. A trim still renames a whole file into
  place, so they never see half of one.
- Not chosen: the trim re-reading after its rename and keeping what arrived
  meanwhile. An append that opened the old file just before the rename could
  still write to it just after the re-read, so it narrows the window without
  closing it.
