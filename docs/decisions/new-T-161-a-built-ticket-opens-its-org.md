## D-T-161 A built ticket opens its development org and each component there, and says how to test it (2026-10-30)

T-161. The person wrote: "If I have an agent building a ticket, I would expect to come back to it when the build is
done, and be able to log into that Salesforce org and test and see metadata in place." A Salesforce builder already
deploys to the development org, checks each component there and runs the tests there before `acc done` (D-206), but
the ticket gave no way into that org: Open org was only in the Environments view, and the builder's note did not say
how to test the change. This builds on T-158's rows (D-242).

- **When.** The builder's deploy to the ticket's own environment passed (`passedDeploy`,
  `extension/src/model/try-it.ts`): its latest deploy there by its builder, not a person's (a person's names who said
  yes), whose tests did not fail. A later deploy whose tests failed takes it away again. Outside Salesforce, and before
  that deploy, there is none.
- **Where it shows.** On the Changes tab, under the development environment's row: Open <environment>, then How to test
  it, then Open each component. In the Agent panel, under the actions, once the build is done (review or done,
  `BUILT_STATES`): Open <environment> and How to test it, without the components.
- **Open <environment>** opens the org in the browser (`sf org open --target-org <org>`). It is off with its reason,
  beside it, in its title and to a screen reader, where the settings name no org for the environment, or the last Setup
  check in this project said this machine is not logged in to it (B6.org-match, by the org's alias, or Production by
  its branch as D-208 reads it: `orgNotHere`, `extension/src/logic/org-open.ts`). Before that check it is not known,
  and Open stays on; a failed open says what sf said.
- **Each component at its own page** (`ORG_PAGES`, `packages/core/src/sf-org-pages.ts`, the salesforce profile's,
  D-003). One table, by the Metadata API's type: a custom object at its Object Manager page; a field, validation rule,
  record type, compact layout, field set, button or link, or page layout at its object's page for that part in Object
  Manager; a flow in Flow Builder; an Apex class or trigger at its Setup page; a Lightning page in the App Builder; a
  permission set or permission set group at its Setup page; a report or dashboard at its record. Every page but Object
  Manager's needs the record's id, so the open asks the org first (`sf data query`, through the Tooling API where the
  type lives there, by the component's own name; a report or dashboard by its name, not its folder), then opens the
  page with `sf org open --path`. Where the org finds no id, the type's list opens. A type the table does not name, and
  a path the profile cannot name, opens Setup. A name a URL or a query cannot carry as it is (`SAFE_NAME`) is never put
  in one: the type's list opens, or Setup. A field opens its object's Fields & Relationships list, not the field
  itself: the field's own page needs its id, which this does not look up.
- **The page says what the extension checks.** The page's `org-open` message names the task, and a component by its
  source path. The extension opens only a path its builder's passing deploy made (`openPlan`), and refuses any other,
  saying why.
- **How to test it.** A builder's note has a fourth part, How to test it (`--test`, `NOTE_ALL`,
  `packages/core/src/ledger.ts`), never required, kept with the run as the other parts, to the same limits (10 lines,
  300 characters a line), and read by the wording check line by line (D-230). A Salesforce builder's packet tells it to
  end the note with a short list: where to go in the org, what to do, and what the person sees when it works
  (`SF_TEST_NOTE`). The ticket shows the list, numbered, next to Open <environment>; where the builder gave none, it
  says so. The note's markdown, on the pull request, has it after Still open, only where it was given.
- **Not covered.** A cloud builder's note, given by commit trailers (`Acc-Landed`, `Acc-Moved`, `Acc-Open`),
  has no trailer for How to test it yet; a cloud builder deploys from this machine's collect, so its ticket opens the
  org, with no steps. The Builder's note section on the Plan tab does not draw How to test it: the Changes tab and the
  Agent panel do.
- **Checked by** `packages/core/test/sf-org-pages.test.ts` (a page for each of the table's 16 types, the lookups, the
  list where none is found, Setup for a type with no page, unsafe names, the id read from sf's answer),
  `packages/core/test/how-to-test.test.ts` (the part as given, its limits, kept with the run, the markdown, the
  wording check, and the Salesforce packet's line), and `extension/test/try-it.test.ts` (when it shows, off with why,
  the components and their places, the message, not logged in by the Setup check, the open against the ticket, the
  lookup and its fallback through a fake sf, a failed open, and the drawing on the row, in the Agent panel and off).
  The screenshot run draws `ticket-deploy-built` (in review, Dev's row with Open Dev, How to test it and each
  component; the Agent panel with Open Dev and the list) and `ticket-deploy-built-off` (Open off, as this machine is
  not logged in to acme-dev, and no steps given) at each width and theme.
