## D-037 What you answered stays on the page (2026-10-02)

Once a question was answered, its card vanished, and nothing on the page said
what had been asked or decided.

- **The hook keeps a record.** It's the one place that knows how each question
  ended, so it appends it to `~/.acc/questions/history.jsonl` (only you can
  read it; trimmed past 2 MB). The record holds:
  - what was asked, and when
  - the outcome: allowed, allowed for the session, said no (with your reason),
    answered (with the answers), let it decide, handed to its terminal, or
    stopped
  - when no window was listening, so it asked in its own terminal
- **Each agent's page shows its decisions in place.** A "You" entry sits after
  the step before you decided, with what it asked, the command, and what you
  said.
- **The Overview's History** replaces Recent activity. It's a scrolling box,
  newest first, holding your answers, task moves, and the commands acc ran.
  Each line says what happened in words; open one for the full command, your
  words or the command's output. Filters: All, Your answers, Tasks, Commands.
- **Finished commands are kept** in the workspace with the end of their output,
  so the output panel and History still have them after a reload.
