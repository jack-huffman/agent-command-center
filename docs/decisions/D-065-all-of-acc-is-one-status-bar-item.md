## D-065 All of acc is one status bar item (2026-10-05)

The author found VSCode's status bar "so cluttered". Four of its items were
acc's: the repo's GitHub account, the task summary (D-044), setup's progress,
and "Checking setup" while it re-checked. Autopilot's switch (D-064) would
have made five.

- **One item.** It says what needs you first ("3 need you", in the warning
  colour). If nothing does, what's running and in review. If none of that,
  setup left to do. A command acc runs for you that waits on an answer
  takes its place. A spinner shows while acc is busy: a command running for
  you, or setup being checked. A robot shows while autopilot is on in this
  window. It hides when there's nothing to say.
- **Its tooltip** has the rest: what needs you, what's running, what's in
  review, each repo's autopilot, setup's done of total, and the GitHub
  account.
- **A click** opens a short menu: the Command Center, autopilot on or off for
  each repo that can run it, what's running, Setup, and the GitHub account.
- **The GitHub account** keeps an item of its own only when it's the wrong
  one: a warning worth its own place. Setup, runs and autopilot make no
  items, and setup's re-check no longer shows VSCode's window progress.
