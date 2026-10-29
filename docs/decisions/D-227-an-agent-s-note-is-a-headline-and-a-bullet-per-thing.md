## D-227 An agent's note is a short headline and a bullet per thing, with API names as code (2026-10-29)

T-146. The person, with a screenshot of a task's History where "Its agent blocked it" was a 1,300-character
paragraph: "comments or notes like this from our agent on statuses for tickets, things that happen, etc come
through as MASSIVE walls of text. This needs to be concise, organized, simple to follow. Maybe concise bullet
points per thing? ... We also need to make sure API names are `` annotated." The note had a headline, then three
numbered problems run together as (1) (2) (3), each with options a/b, and its API names as bare words. In the calm
style of D-217, D-218, D-223 and D-226.

- **The shape** (`packages/core/src/agent-notes.ts`): a note an agent writes to a person is a headline, one short
  sentence, then one bullet per thing. A question's options go in its item as a) b) c), at most three (D-205),
  with (recommended) on the one the agent would pick. `noteShape` reads any note into that shape: markdown
  bullets as written, with option lines or inline a) b) under each; a paragraph split at inline (1) (2) (3) or
  1. 2. 3. markers, its first sentence the headline (a short lead-in such as "Three problems:" stays on it), and
  inline a) b) c) as options. "I recommend b" or "Recommended: (b)" marks that option. A paragraph with no
  markers has no shape.
- **acc block takes it, and refuses a wall of text.** `acc block "<headline>" --item "<thing>" --item "<thing>"`
  writes the headline and a `- ` line per item; markdown bullets in the reason are taken as they are. `--client`
  takes `--item` too, as its question's bullets. An agent's block (any actor but a person) is refused when what
  isn't in bullets is longer than `NOTE_HEADLINE_MAX`, 200 characters, when a thing is longer than a note's line
  may be (`NOTE_LIMITS.chars`, 300), or when a question gives more than three options; the refusal says how to
  split it, word for word as `NOTE_SHAPE_WORDS`. A person's block is never refused or changed.
- **API names as code.** `codeNames` puts in backticks what it recognises: a custom field or object (`__c`,
  `__r`, `__mdt`, any name with `__`), a developer name with underscores, `Object.Field`, a path with two
  slashes or a file extension or a leading `./` `~/`, a branch (`task/`, `feature/`, `fix/` and the like), a file
  by a known extension (`.flexipage-meta.xml`), and a git, npm, npx or Salesforce CLI command. It leaves ordinary
  words, links, dates, and/or, mail addresses, emphasis and text already in backticks alone. acc applies it as it
  records an agent's reason and note lines (`cmdSet`), and a review's summary and findings (`checkVerdict`); the
  client's sentence gets none. The extension applies it as it reads any note, so an old one draws its names as
  code too. Inside a shell's double quotes a backtick runs a command, so builders are told to write names bare
  and exact, and acc marks them.
- **Builders are told.** `NOTE_RULE` is in the packet, its short version the hooks give again after a compaction
  or resume, and the plan's rules; the plugin's task and orchestrate skills say it in their own words; the
  reviewer is told to open its summary with the verdict and keep each finding to one thing, with API names in
  backticks.
- **Drawn as a list** (`extension/webview/note.ts`). What acc recorded reaches the page through `noteInWords`
  (`extension/src/logic/relayed.ts`): its text in process words with its names as code, its headline, and its
  shape. The task page's "Why it's blocked" notice and the move's reason in History draw the headline, then a
  bullet per thing, each option on its own line with "Recommended" and a star where the agent picked it. A thing
  longer than 160 characters folds on its own to two lines with Show all; the note never folds as one block. A
  note with no shape keeps its paragraph, two lines and Show all, as before, with its code drawn.
- **The Agent panel** says the headline alone at a glance, one line with the blocked icon, whole on hover. This
  amends D-223, which drew no reason there: the bullets are the notice's beside it, each fact once.
- **Needs you** keeps each line one line high (GH-160, the geometry's overview check): a blocked task's note sits
  under its line, indented, in the same list item. In full, as Show all opens it, the headline and its bullets; on
  the Overview, calm, the headline and its bullets folded under "3 points", closed at first and remembered.
- **Notices** carry the headline alone: VS Code's says "ACME-18 is blocked: <headline>", where it said the title,
  and Slack's "It's blocked: <headline>", where it said "It's blocked.". With no note they say what they said.
- **Nothing recorded is rewritten.** An old note is shaped and coded only as it's read.
- **Checked by** `packages/core/test/agent-notes.test.ts` (four real-shaped old notes split, notes with no shape,
  markdown bullets, the refusal's words, the limits, the names wrapped and those left alone),
  `packages/cli/test/block-note.test.ts` (a builder's wall refused with the words and the task still running,
  `--item`, markdown bullets, note lines coded, a person's block kept as typed, `--item` with no headline,
  `--client` with items), `packages/core/test/note-rule.test.ts` (every place a builder or reviewer is told it,
  a verdict coded as read), and `extension/test/notes-drawn.test.ts` (in words and code, notices and Slack, the
  notice and History, an old note split and one kept as a paragraph, the Agent panel's glance, Needs you in full
  and calm, a long thing folding alone). The behaviour run's case "task page: a blocked note recorded as one
  paragraph…" checks the list, its options on their own lines, Recommended and the code in a browser, with the
  mutant "a note is drawn as one paragraph again". The screenshot run draws `ticket-blocked-note` and
  `ticket-blocked-wall` (the page, its History and the Agent panel), `overview-needs-wall` (Needs you in full,
  ACME-18's note an old paragraph; `overview-needs` has it new) and `overview-blocked` (the Overview, calm, its
  points opened), at every width and theme. The fixtures' notes are made up.
