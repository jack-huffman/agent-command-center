## D-185 Every tracker fills what it has, in one normal form (2026-10-21)

T-90. The Command Center draws every tracker with one set of rules (`extension/src/model/boards.ts`), so
a ticket looked as rich as its tracker's client filled it, and Azure DevOps' looked flat. Each client now
fills every field its tracker gives, in one form, so a later redraw (T-91) can draw them all alike.

- **Names read as names.** `personName` (`packages/core/src/trackers/normal.ts`) takes a display name
  and a unique name. A display name that is an email, or an email's local part and domain split by a
  space ("jordan acme.example", which drew as "JA"), gives way to the unique name's local part; no
  display name gives the unique name, or its local part. `Person` gains an optional `email`: Azure's
  uniqueName where it is an address, and Jira's `emailAddress` where Jira sends it. Azure's `me()` names
  the person the same way.
- **A priority level.** `priorityLevel` (1 highest to 5) sits beside `priority` on `Ticket` and
  `BoardCard`. Azure's 1 to 4 are Highest, High, Medium and Low (`AZURE_PRIORITY`), the plain word with no
  "(3)". Jira's five names have their levels (`JIRA_PRIORITY`); a name a site made itself has none.
  GitHub, monday.com and Slack have none. `priorityIcon` reads the level (`PRIORITY_ICON`), so Medium has
  an icon too, `dash`.
- **A type kind.** `typeKind` (`bug`, `story`, `task`, `subtask`, `feature`, `epic`, `test`, `issue`,
  `other`, or null with no type) sits beside `type`, from one table of Azure's, Jira's and GitHub's type
  names (`TYPE_KIND`); a Jira type it doesn't name is a sub-task when Jira marks it one, else `other`.
  GitHub's issue type comes from gh's `issueType`, and from the Project board's GraphQL; a gh or GitHub
  that refuses the field is asked again without it, and not asked for it again. `typeIcon` reads the kind
  (`TYPE_ICON`), not words in the name.
- **Related tickets carry their state and kind.** `related` items gain `status` and `typeKind`, null
  where the tracker doesn't say. Azure's batch call asks for each item's state and type, and takes the
  state's category from that type's states, read once per type; a states call that fails leaves the state
  under way. Jira reads them from the `status` and `issuetype` its links, parent and sub-tasks carry.
  monday.com's sub-items take their status column's label, done where monday marks it.
- **Azure's board uses the real category.** A card's category comes from its state among its type's
  states, read once per type, and its column only says where it sits. A type whose states can't be read
  keeps the column's category.
- **Why a ticket closed.** `Status` gains an optional `reason`, `completed` or `not-planned`. GitHub fills
  it from `stateReason` (`issueState`), on the ticket and on the Open and Closed board, which keeps the
  words "Closed as not planned"; Azure from its Completed and Removed categories. The ticket page shows a
  not-planned status with its own look (`NOT_PLANNED_LOOK`: `circle-slash`, neutral) in place of the
  category's (`statusLook`), and `looks.test.ts` walks it, with the priority and type icons.
- **Who you are on Azure.** "Commenting as" said "a personal access token" for an Azure sign-in.
  `signInName` (`extension/src/logic/sign-in-name.ts`) asks the client's `me()` for Slack and Azure
  DevOps, once per client, and a client is made once per sign-in; a `me()` that fails isn't kept, and the
  sign-in's own words stay until it answers.

The extension's `BoardInput` takes `typeKind` and `priorityLevel` as optional, so a card without them
draws the plain icons. Tested in `packages/core/test/tracker-fields.test.ts` (15 tests: each client
through a fake of its API, with the fallbacks) and `extension/test/tracker-fields.test.ts` (5 tests).
