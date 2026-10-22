## D-057 A task's activity reads as one feed (2026-10-05)

The author asked for the task page's Activity to "look more like a feed". It
was a list of comments, then a separate history of one-line moves, each with
its reason behind a disclosure triangle.

- **One feed, newest first:** the tracker's comments and acc's moves, in
  time order, under a heading for each day ("Today", "Yesterday", "3 Oct").
  The comment box sits above it. Six entries show first, then Show all.
- **Each entry** is an icon on a rail, then who did it in bold, what they
  did, and the state it reached as the board's own status, with its icon and
  label. Tone is blue or orange, never red against green.
- **A move's reason** shows under it as a quote. A long one stops cleanly
  after two lines: the clip is on the text inside the quote, so no half line
  shows in its padding. The last line fades into an ellipsis, with Show all
  under it, as everywhere else on the page (`foldable`). A short reason shows
  whole, with no button. (The first version had you click the text itself,
  with nothing saying there was more, and let part of a third line show.) A
  comment shows as a card.
- The Overview's History keeps its own feed (D-037). The ticket page's
  classes start with `act-`, because the two had collided over `.feed`.
