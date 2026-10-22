## D-043 The question history keeps its newest 1,000 records (2026-10-02)

D-037's history was only cut back past 2 MB, by dropping the older half. With
short records that's thousands of them, and the extension reads the whole file
each time it changes. Issue #11.

- **The newest 1,000 records are kept,** and no more than 2 MB of them, so a few
  very large ones (a `Write` with a whole file in it) can't make the file huge.
  The newest record always stays, even one past 2 MB on its own.
- **An append doesn't read the history.** It writes the record, `stat`s the
  file, and reads `history.trimmed`, a few bytes next to it that hold the size
  the last trim left. The history is read, to be trimmed, only once it has
  grown 64 KB past that size. So between trims it holds up to 64 KB more than
  1,000 records, which is a hundred or two at a few hundred bytes each. The page
  shows the newest 500, so nobody sees the difference. Trimming on every append
  past 1,000 would read and rewrite the whole file every time.
- **Growth is measured from the last trim, not from fixed 64 KB marks.** Marks
  looked stateless, but when the newest 1,000 records add up to just under a
  mark, every append after a trim crosses it again and trims again. A missing
  `history.trimmed`, one that doesn't read, or one larger than the file (the
  file was deleted or replaced) counts as 0, so it can't stop the trimming.
- **The trim is a rewrite,** to a temp file in the same folder and then a
  rename, so a reader never sees half a file. Lines that don't read, from a
  crash or a half-written append, are dropped and don't count. The readers
  skip them, as before.
