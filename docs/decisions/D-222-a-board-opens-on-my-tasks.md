## D-222 A board opens on my tasks (2026-10-28)

Amends D-178's default. The person filter (T-79) opened every board on Everyone. A board with no remembered choice now opens on Mine when the tracker says who the person is (the tracker's own user, as Mine already uses), and on Everyone otherwise.

- A board that can't open on Mine says why in a quiet line beside the filter: "Showing everyone: sign in to Jira to see just yours", with the tracker's own name ("the tracker" only for a kind it has no name for). A kept Mine that can't be honoured later (signed out) falls back to Everyone and says the same.
- A choice the person made is remembered per board and wins over the default, across board switches (D-211). Show everyone and the Everyone pick are choices too: they are kept, so the board does not go back to Mine.
- Mine with no cards says "Nothing assigned to you here." and offers Show everyone.
- The agent board in My work follows the same rule: it has the same filter, and Mine there is the person's own dispatches. It draws no line when it can't name the person, as it has no tracker to name.
- Checked by `extension/test/person-filter.test.ts` and four cases in `extension/scripts/behaviour.ts` (one for the agent board), with a mutant for a known person opening on Everyone.
- Shared files: this change edits `extension/scripts/behaviour.ts`, `pages.ts` and `screenshot.ts`, which T-142 also changes. Not small: `shotState` now keeps every board on Everyone for each shot except the person-filter ones, and the behaviour harness seeds Everyone for every case except those named `person filter:`. Both take the boards from `everyoneKept(root)` in `extension/scripts/fixtures/boards.ts`. T-142 merging after this must keep both.
