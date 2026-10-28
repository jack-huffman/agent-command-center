## D-T-143 A board opens on my tasks (2026-10-28)

Amends D-178's default. The person filter (T-79) opened every board on Everyone. A board with no remembered choice now opens on Mine when the tracker says who the person is (the tracker's own user, as Mine already uses), and on Everyone otherwise.

- A board that can't open on Mine says why in a quiet line beside the filter: "Showing everyone: sign in to Jira to see just yours", with the tracker's own name.
- A choice the person made is remembered per board and wins over the default, across board switches (D-211). Show everyone and the Everyone pick are choices too: they are kept, so the board does not go back to Mine.
- Mine with no cards says "Nothing assigned to you here." and offers Show everyone.
- The agent board in My work follows the same rule: it has the same filter, and Mine there is the person's own dispatches.
- Checked by `extension/test/person-filter.test.ts` and three cases in `extension/scripts/behaviour.ts`, with a mutant for a known person opening on Everyone.
