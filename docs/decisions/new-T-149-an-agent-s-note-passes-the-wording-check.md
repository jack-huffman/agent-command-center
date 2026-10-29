## D-T-149 An agent's note to a person passes the wording check before acc records it (2026-10-29)

T-149. The person asked for an agent's notes to a person to pass the Simplified Technical English check (T-12,
`packages/core/src/ste.ts`), after a blocked note reached them as a 1,300-character paragraph. D-227 (T-146) gave
each note its shape: a headline and a bullet per thing. This makes each line of that note plain, as a drafted
acceptance criterion is (D-179).

- **The check** (`packages/core/src/note-wording.ts`): `noteWording` runs `steLint` on each line of a note on its
  own, so a synonym in one line never counts against another. A line goes in as a list item, so one that ends on
  "and" or "or" is caught, the headline too. Only hard findings count: a semicolon, a sentence past 25 words, a
  phrasal verb, a marketing adjective, a frozen noun, a synonym rotation and a dangling conjunction. The advisory
  ones (a passive, a compound tense) are often right to keep, as in `requirementWording`.
- **Code is left alone.** Each line gets `codeNames` first, the same function that puts an agent's API names in
  backticks as acc records the note (D-227). `steLint` already skips text in backticks, so a path, a field, a
  developer name or a command, bare or in backticks, is never checked.
- **Where it runs.** On an agent's notes alone, never a person's (any actor but `human`):
  - `acc block`: the headline and each thing, the question for the client (`--client`, with its items), and any
    `--landed`, `--moved` and `--open` lines. A question's options are part of its thing. A wall of text and a
    wording finding are said in one refusal, so the builder fixes both at once.
  - `acc done`: each line of the finish note, before acc checks the move itself (its checks passed, its note
    given).
  - A local review (`review()`): its summary, its sentence for the client and each finding's message.
- **A hard finding stops it, and acc records nothing.** `acc block` and `acc done` throw `refused` before
  `cmdSet`: the task's state, history, blocker and note are as they were. The refusal counts the findings and
  gives each one with where it is ("Headline", "Thing 2", "The question for the client, headline", "What landed 1")
  and its fix, which is the check's own message. The builder writes the note again and runs the command again.
- **A reviewer is asked again in its session.** A review that fails is given `noteFixPrompt`, each finding and
  its fix, with `--resume` on the same session, as the criteria drafter is (D-179). Its answer replaces the
  first, and both are paid for. After `NOTE_FIX_TRIES` (2) fixes that still fail, `acc review` stops with the
  findings and keeps no verdict: the task stays in review, for a review again.
- **A cloud review can't be asked again,** so a `review.json` whose words fail is a failed cloud review, as one
  acc can't read is (T-86): it names the lines that fail, nothing is kept, and the person reviews on this Mac.
- **Builders and reviewers are told.** `NOTE_STE_RULE` (in `agent-notes.ts`, beside `NOTE_RULE`, which now ends
  with it) is in the packet, its short version the hooks give again, and the plan's rules, through `NOTE_RULE`.
  The headless reviewer's system prompt has it word for word. The plugin's task skill and its reviewer agent
  say it in their own words.
- **Not covered:** the analyst's open questions, the planning agent's questions in Talk it through, and
  autopilot's step reasons. They are not agents' notes recorded by `acc block`, `acc done` or a review.
- **Checked by** `packages/core/test/note-wording.test.ts` (a note's lines, each hard rule with its place and
  fix, advisory findings let through, code and bare API names left alone, each line on its own, a finish note
  and a review's lines, the refusal's words, the fix prompt, and two mutants that let a hard finding through:
  one keeps the advisory findings in place of the hard ones, one finds and still records),
  `packages/cli/test/note-wording.test.ts` (a builder's block refused with each fix and nothing recorded, then
  recorded when written again; a question's options and a question for the client; a wall of text with a
  wording finding in one refusal; code left alone; `acc done` refused with nothing kept; a person's block not
  checked), `packages/core/test/review.test.ts` (a review asked again with `--resume` and its fix kept; one
  that still fails after two fixes refused with no verdict kept; the reviewer told in both places) and
  `packages/core/test/cloud-review.test.ts` (a cloud review whose words fail is a failed review).
