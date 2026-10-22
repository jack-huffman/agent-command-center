## D-T-114 A single choice offers at most three options and your own words, everywhere a person is asked (2026-10-22)

T-114. The person said that many options per question is far too much choice: a big decision should offer
about three and a free-text field, never eight. Only a question where the person ticks several may list every
option.

- **The rule.** A single choice (one answer picked) lists at most three options, the suggested or
  recommended one first, then "Something else…" or "Answer in my own words" with a box. A question that ticks
  several (labels, epics, environments) lists its options, up to the eight a multi-select
  question already allowed (`MULTI_OPTIONS_MAX`, unchanged here).
- **Where it holds.** A plan's design choices: `ANALYSIS_SCHEMA` already says `maxItems: 3`, and Review plan
  cuts an older plan's longer list to three (`offered` in `extension/src/model/review-plan.ts`), keeping the
  choice made now on the list. The planning agent's questions (D-204): `OPTIONS_MAX` is 3, not 4, in the schema,
  the prompt, `parseQuestions`, the model and the card. An agent-made question (`questionsOf`): a single
  choice is cut to three; one that ticks several keeps `MULTI_OPTIONS_MAX`. The agents' prompts say: offer the
  three answers that matter most, never a long list; if more exist, the person writes their own.
- **Own words are always there.** The agent can no longer turn them off: `own` is gone from `TalkAsk`, the
  schema and the card. A turn kept with an `own` field is read without it.
- **The limits ride on the model.** `TicketTalk.questions` carries `optionsMax` and `answerMax`; the card no
  longer copies core's `ANSWER_MAX` (D-204's review). `picksOf` and `answersOf` take them from it.
- **The check** (`extension/test/choice-limit.test.ts`). It walks every webview module that draws a radio
  group, and fails on one not named with how it keeps to the rule (the Connect page's lists, the dispatch
  sheet's settings and the person filter are named as exempt). It walks the agents' schemas for every
  `options` list and fails on one over three. It draws a plan question with five suggested answers from a fake
  agent and shows three plus own words. A radio group handed a fourth option is cut by the card.
- **Out of scope.** The Connect page's lists of boards, teams or epics: they are things to pick from.
