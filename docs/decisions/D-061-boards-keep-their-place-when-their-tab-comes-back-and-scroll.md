## D-061 Boards keep their place when their tab comes back, and scroll while you drag (2026-10-05)

Two things the author found on the Tasks board:

- **It jumped back to the left after a task's tab was open.** VSCode doesn't
  keep a hidden tab's page (`retainContextWhenHidden` is off, to stay
  light), so switching back rebuilt it. Scroll positions survived the page's
  own redraws, but not a rebuild. Now each page saves where it's scrolled:
  - its own position, and each board's sideways position and lanes
  - a moment after it stops moving, in the tab's saved state, which VSCode
    keeps for a hidden tab
  - per page and section

  A rebuilt page comes back there. The screenshot harness takes
  `ACC_SHOT_STATE` to start a page from a saved state, which is how this was
  checked.
- **A card couldn't reach a lane off screen.** Dragging a card near a board's
  left or right edge now scrolls the board that way, faster the closer it
  is. It stops when the card leaves the edge or the board, or the drag ends.
  This works on both boards: the tracker's and acc's.
