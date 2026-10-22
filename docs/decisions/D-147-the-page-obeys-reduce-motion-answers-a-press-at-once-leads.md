## D-147 The page obeys reduce motion, answers a press at once, leads only with what needs you, and follows the font size (2026-10-14)

An audit of the Command Center against Apple's design guidance found four things. T-33 makes each one a rule,
and `extension/test/feel.test.ts` and `extension/test/landing.test.ts` check them.

- **Reduce motion.** Under `prefers-reduced-motion: reduce`, a codicon spinner (`codicon-modifier-spin`)
  stands still: the word beside each one gives the state. codicon.css turns it with two classes, so the rule
  is `!important`. A finished job's Overview line (`.lp-row.lp-fading`) fades with `lp-fade-still`, which
  changes opacity only: it keeps its height, so the lines under it don't move. The test reads the page's
  styles and codicon.css, counts each selector that runs an animation, and fails on one that no
  reduced-motion rule stops or changes, by its selector.
- **A press shows at once.** Each kind of button the page draws (the first class of each `el('button', …)`)
  has an `:active` rule with `transition: none`. A compact button shrinks to `scale(0.97)`; a row as wide as
  its list (`.nav-item`, `.more-item`, `.q-choice`, `.q-option`, `.aq-suggest`, `.tile`) darkens with
  `--pressed`, mixed from the theme's foreground, instead, as a wide row that shrinks seems to jump. Hover
  keeps its 120 ms fade. The test fails on a kind of button with no `:active` style.
- **Primary only for what needs you.** On the Overview, only the lines in Needs you have the primary
  button. Every other list, Ready's Dispatch lines among them, uses the outlined one. `group()` in
  `src/model/landing.ts` sets each line's `primary` from its list, so the page model says which.
- **Text follows the font size.** No `font-size` in the page's styles is in px, but an icon's: a codicon is
  drawn on a 16 px grid, and a whole px keeps it sharp. `PX_FONTS` in the test names the exceptions, each
  with why, and pins how far each reaches (15 icon rules, and an agent's kind). The avatars and the board's
  facts line are now in em, at the size they had at VSCode's 13 px; an avatar in a card's top line sets its
  own size to stay there. `h1` and `.ticket-title` have `letter-spacing: -0.01em`; body text has none.

Out of scope: an animation for the task modal, translucent surfaces, springs and drag physics, which don't
suit a VSCode panel.
