## D-089 How agents run is behind a Settings button on the Agents page (2026-10-07)

The author asked for the Agents page's "How agents run" to show only after
clicking a Settings button. The settings are set once and changed rarely, and
they pushed the sessions, which change all the time, below the fold.

- **Settings**, with a gear, sits in the Agents header beside Start a
  background agent. It opens How agents run above the sessions, and reads
  **Hide settings** while it's open (`aria-expanded` says the same). Closed is
  the default; the tab remembers which way it was left.
- **Per-token billing still shows while it's closed.** It costs money while
  nobody is looking, so its orange line stays above the sessions (D-036).
- **The status bar's Auto-merge item opens it.** It goes to the Agents section
  with How agents run open, since that's where Auto-merge is changed (D-083).
- Not chosen: a separate settings page, which would take you away from the
  sessions for a row or two of choices.
