## D-T-113 Talking a plan through asks one question at a time, with answers to pick, and shows less at once (2026-10-22)

T-113. The conversation's panel (D-202) drew every question the planning agent asked at once, as a numbered
list inside a long reply, beside a "Not sure yet" list, the proposals and the whole conversation so far. The
person called it information overload, and asked for the agent's questions one at a time, as Review plan
(D-200) asks a plan's choices: radio answers or their own words, stepped through like Claude Code's prompts.

- **Questions as data** (`packages/core/src/talk-questions.ts`). The opening reply and Talk it through's
  replies carry at most three questions, each with why it matters in one line, two to four short answers with
  the agent's suggestion first, and whether the person may answer in their own words. Claude Code checks the
  shape (`--json-schema`); acc drops a question with no words and blank or repeated answers, cuts to four
  answers and three questions, and lets one left with under two answers take own words only. Both prompts
  carry the same rules: the reply's own words at most about 80 words, no lists of questions in them, and what
  the agent is unsure of folded into its questions. The opening reply no longer has a separate "unsure"
  list. A reply kept before T-113 still shows: its questions as own-words questions, and what it was unsure
  of under its words. `acc plan start` and `acc plan talk` print each question with its answers.
- **One question at a time** (`extension/webview/talk-questions.ts`). Under the agent's last reply, while
  nothing was said after it and the plan is the version it asked about, the panel draws a card: "Question 1
  of 3" with a dot for each, the question, its why, its answers as a radio group with the suggestion first
  and marked Suggested (a star and the word), and Answer in my own words with a box. A number or Up and Down
  picks, Enter confirms and goes on, Back keeps every pick, Skip marks the question skipped. The dots are
  Review plan's: not yet seen plain, skipped orange, answered blue with a check. Escape puts the questions
  aside as one line with Answer the questions, keeping the picks. Review plan's dots, radios and keys moved to
  `extension/webview/stepper.ts`, which both use.
- **Answers go back as one message.** Nothing is sent until the last question is confirmed or skipped
  (Confirm and send, Skip and send). Then the page sends `talk-answers` with each answer as an option's place,
  own words or skipped; the extension numbers them with the questions acc kept ("1. <question>" and the answer
  or "(skipped)" under it) and sends them as the person's next message, so the agent replies to them. Answers
  to a reply that is no longer the last, or a count that doesn't match, are refused. A refusal keeps the picks
  to send again.
- **Less on screen.** A reply longer than about eight lines (a line each, wrapping at about 80 characters)
  folds with Show more. Turns before the person's last message fold under "Earlier in this conversation (N
  messages)", so the latest exchange and any waiting questions show; the tab remembers it open. A proposal is
  one line with Why, which opens its reasons, and Use this, or who used it.
- **Plain words** (D-188): the card speaks of questions and answers, never of commands.
- **Checked by** `packages/core/test/talk-questions.test.ts` (the schemas, the limit of three, the prompts'
  brevity rules, the answers as one turn with a fake agent), `extension/test/talk-questions.test.ts` (the
  model, the message, the extension's side, the card, the folds and the one-line proposal), the browser case
  "questions: …" in `extension/scripts/behaviour.ts` with three mutants (all questions shown at once, an
  answer sent before the last is done, Back losing a pick), and the screenshot pages `conversation-questions`
  (the card part-way) and `conversation-long` (a long conversation folded, its question put aside).
