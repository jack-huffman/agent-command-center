## D-127 The Command Center has depth: wells set into the page, and raised cards and panels on it (2026-10-09)

The author found light mode too flat, and dark mode flat too: the page, the board's columns and its cards
were nearly one colour (light: white, then #f8f8f8 for both columns and cards).

- **Three levels.** Board columns are wells: a soft grey in light, darker than the page in dark (the
  theme's sidebar colour). Cards and panels are raised on the page: its own white in light, a shade lighter
  in dark, with a firmer edge and a soft shadow (the theme's widget shadow). They're mixed from the theme's
  colours, so Match VSCode works with any theme.
- **Light follows the rule for themes (GH-109):** Settings' Light, or Match VSCode while VSCode's theme is
  light (its class on body, only under data-theme="vscode").
- **A column that holds waiting work looks it.** A tracker column named Blocked, Stuck, On hold, Waiting or
  Impeded is orange with a blocked icon, though the tracker counts it as under way.
- **The Tasks tab says each thing once.** The board switch names a tracker's board by its kind (GitHub
  board), never by its title, which can match the app's own name; a place shows only when it narrows the
  board.
