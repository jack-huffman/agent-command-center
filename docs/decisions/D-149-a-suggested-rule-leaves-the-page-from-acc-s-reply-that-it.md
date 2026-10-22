## D-149 A suggested rule leaves the page from acc's reply that it was accepted or dismissed (2026-10-14)

A person confirmed the suggested rule "edge case" under When you have a moment. acc added T-34 and wrote down
the accept, but the person saw the suggestion stay. T-35 looked for why, and the page now acts on acc's
reply, not only on the next model.

- **Why it seemed to stay.** A stale model was not reproduced. The built extension, against the vscode
  stand-in, with a copy of this repo's reviews and suggestion records and a refresh between each step of
  acc's run, sent a home model without the suggestion before acc's reply every time. The models sent while
  acc ran still held it, as acc adds the task before it writes the accept down. What the page drew next
  looked the same: the detail kept its place and drew the next suggestion there, "test coverage", under the
  same title ("A rule you accepted keeps coming back"), the same question and the same Accept and Dismiss.
  Only its quoted line and the count changed. And the page never acted on the reply itself: it ended the
  wait and drew whatever model it held, so a model that still held the suggestion showed it again.
- **The fix** (`extension/webview/pending.ts`, `extension/webview/rules.ts`): from acc's reply that it
  accepted or dismissed a suggestion, the page takes it off: from what waits on you, from the detail, and
  from the suggested rules' line, which counts the rest and the reviews they came from, or goes when none
  are left. Its list counts one fewer. The detail shows the next one, or closes. It stays off while a model
  still holds it, and the page forgets it once a model arrives without it, so one that comes back later
  shows again. Drawing the same model again isn't a new model.
- **A second accept** that acc refuses shows acc's reason on the card, in the Command Center's words: "The
  task wasn't added: No rule is suggested as … now. "See the suggested rules" lists them."
- Evidence: `extension/test/settled.test.ts` (5 tests) holds the page's Overview to the one the extension
  builds without those suggestions, under and over the list's cap. `extension/test/rule-accept.test.ts`
  (1 test) accepts a suggestion through a real suggestions folder in the built extension, and checks the
  next home model and a refused second accept. The behaviour run adds a case and two mutants.

Out of scope: how acc suggests, accepts or dismisses a rule.
