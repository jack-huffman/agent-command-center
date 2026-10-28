## D-T-130 An answer to the planning agent's question counts the moment it's picked, and moving between questions never sends (2026-10-27)

T-130. Amends D-204. The person answered the planning agent's questions and moved between them by the dots, and
their answers were lost: a question counted as answered only when Confirm was pressed, a dot moved without
recording, and the answers sent a skipped answer for it. Confirm on the last question also sent every answer,
so the button that moved on and the button that sent looked the same. The person asked for a card that can't
lose an answer, where moving on clearly doesn't send.

- **An answer counts the moment it's picked** (`extension/webview/talk-questions.ts`). A click, a number, Up or
  Down, or words typed in Answer in my own words record the answer for that question at once. Back, Skip, Next
  question and the dots only move, and never lose an answer. The suggested answer is shown picked, but counts
  only once the person picks it or presses Next question on it. A question passed by its dot without a touch
  stays not answered. Own words picked with nothing typed is not an answer. Skip leaves a question to the
  planning agent; it is off, with why, on a question already answered, so it can't lose the answer. There is
  no way yet to clear an answer once given.
- **The dots say where each question stands**, with an icon and words: answered (blue, a check), skipped
  (orange), not answered yet (plain), and the one on show. Each is a button named "Question 2: answered" (or
  "Question 2: on show, answered"), and its tooltip is the question. `stepProgress` in
  `extension/webview/stepper.ts` takes the name as an option, so Review plan's dots are as before.
- **Moving is never sending.** The foot is Back, Skip and Next question, with an arrow. There is no Confirm. On
  the last question, Next question is Review answers. Enter goes on, as Next question does.
- **A review before anything goes.** After the last question: "Review your answers", each question with its
  answer, or "Not answered: the planning agent decides" in orange with an orange icon, each with Change, which
  goes back to it. One button sends: Send answers to the planning agent, with the send icon, and a line under
  it that it sends all the answers as one message. Enter on the review sends nothing unless Send has focus.
  Send is off, with why, while the answers are on their way or a message can't go.
- **Kept and cleared as before.** The answers are kept while the panel is closed and opened again, and when
  the questions are put aside with Escape. Once sent, they're cleared. A refusal keeps them, on the review, to
  send again. The message the extension sends is unchanged (D-204).
- **Checked by** `extension/test/talk-questions.test.ts` (a pick counted at once, a dot and Back keeping it,
  the suggestion counted only when picked or passed with Next question, Skip and its edge cases, the dots'
  names, the review's list, and that only Send sends), the browser case "questions: …" in
  `extension/scripts/behaviour.ts` with four mutants (all questions shown at once, Next question sending the
  answers, Back losing a pick, a dot move dropping the answer), and the screenshot pages
  `conversation-questions` (a question part-way: one answered, one on show, one not answered yet) and
  `conversation-questions-review` (the review with one skipped and not answered).
