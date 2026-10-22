## D-094 A rework a person sends back tells its builder why (2026-10-07)

GH-80 came back from two reworks with no commits. Its review had passed, and
a person moved it to rework with a list of fixes (`acc set <id> rework
--reason …`). The packet shows a review's findings only when the review asked
for changes, so the builder read a passing review, found nothing to fix, and
finished.

- **The packet quotes the person's reason** under "Why a person sent it back",
  before where the builder works, whenever the task's latest move into rework
  was a person's and gave one. A reviewer's send-back keeps its own section,
  and autopilot's checks send-back its own (D-076).
- Not chosen: copying the reason into the review's verdict, which is the
  reviewer's record, not a person's.
