## D-T-161 A built ticket has a Testing tab: it opens the development org and gives the steps to test it (2026-10-30)

T-161. The person wrote: "If I have an agent building a ticket, I would expect to come back to it when the build is
done, and be able to log into that Salesforce org and test and see metadata in place." A Salesforce builder already
deploys to the development org, checks each component there and runs the tests there before `acc done` (D-206), but
the ticket gave no way into that org: Open org was only in the Environments view, and the builder's note did not say
how to test the change. This builds on T-158's rows (D-242).

The first build put Open <environment>, How to test it and a list of every component, each with its own Open, on the
development environment's row of the Changes tab and in the Agent panel. The person saw it and wrote (2026-10-31):
"it opens EVERY component? That feels like too much. The ticket should have a testing tab that explains testing steps
or something." So the list of every component is gone, and the rest moved to a tab of its own.

- **A Testing tab, after Changes** (`TAB_ORDER`, `extension/webview/tab-rules.ts`; `TASK_PART`,
  `extension/src/model/task-tabs.ts`, so a link may name it). A Salesforce task whose environment the settings name
  has it from the start (`testing`, `extension/src/model/testing.ts`). Before its builder's deploy to that environment
  passed, it says what it will hold and why it is empty. Outside Salesforce there is no tab.
- **Testing is not Verify.** Verify (D-084) checks a developer's pull request. Testing is for trying the builder's
  work in its development org. The empty tab says so in its one line (`TESTING_ABOUT`).
- **When it is ready.** The builder's deploy to the ticket's own environment passed (`passedDeploy`): its latest
  deploy there by its builder, not a person's (a person's names who said yes), whose tests did not fail. A later
  deploy whose tests failed takes it away again.
- **What it shows, in order, and nothing else.** One line of where the work is: "Deployed to Dev 2 h ago, tests
  passed, 88% coverage" (`testsWords`; "no Apex tests ran" where none ran). One primary button, Open <environment>
  (`sf org open --target-org <org>`). Then Steps to test it: the builder's How to test it lines, numbered. No list
  of every component: the Changes tab already lists the metadata.
- **A step links to the one component it names** (`stepComponent`). A step that names exactly one component the
  builder deployed, by its API name (a part of an object also by its own part, `Job_Title__c` for
  `Contact.Job_Title__c`), gets one small link that opens that component's page. A step that names none, two, or a
  component the builder did not deploy, gets no link. A name found only inside a longer one (`Contact` in
  `Contact.Job_Title__c`, `JobService` in `JobServiceTest`) is not named on its own.
- **Open is off with its reason**, beside it, in its title and to a screen reader, where the settings name no org for
  the environment, or the last Setup check in this project said this machine is not logged in to it (B6.org-match,
  by the org's alias, or Production by its branch as D-208 reads it: `orgOff`, `orgNotHere`,
  `extension/src/logic/org-open.ts`). Each step's link is off with it. Before that check it is not known, and Open
  stays on; a failed open says what sf said.
- **Each component's page** (`ORG_PAGES`, `packages/core/src/sf-org-pages.ts`, the salesforce profile's, D-003).
  One table, by the Metadata API's type: a custom object at its Object Manager page; a field, validation rule, record
  type, compact layout, field set, button or link, or page layout at its object's page for that part in Object
  Manager; a flow in Flow Builder; an Apex class or trigger at its Setup page; a Lightning page in the App Builder; a
  permission set or permission set group at its Setup page; a report or dashboard at its record. Every page but
  Object Manager's needs the record's id, so the open asks the org first (`sf data query`, through the Tooling API
  where the type lives there, by the component's own name), then opens the page with `sf org open --path`. Where the
  org finds no id, the type's list opens. A type the table does not name opens Setup (`SETUP_HOME`, which Setup's
  source-tracking step uses too). A name a URL or a query cannot carry as it is (`SAFE_NAME`) is never put in one. A
  field opens its object's Fields & Relationships list: the field's own page needs its id, which this does not look up.
- **The page says what the extension checks.** The page's `org-open` message names the task, and a component by its
  source path. The extension opens only a path its builder's passing deploy made (`openPlan`), and refuses any other,
  saying why.
- **The builder's steps say where.** A builder's note has a fourth part, How to test it (`--test`, `NOTE_ALL`,
  `packages/core/src/ledger.ts`), never required, kept with the run as the other parts, to the same limits (10 lines,
  300 characters a line), and read by the wording check line by line (D-230). A Salesforce builder's packet asks for
  3 to 7 numbered steps a person follows in the development org, one `--test` a step: where to go, what to do, and
  what they see when it works. Each step names at most one component by its API name, so the tab can link it
  (`SF_TEST_NOTE`, `TEST_STEPS`, `packages/core/src/packet.ts`). The 3 to 7 is asked, not enforced.
- **The Agent panel** keeps one link once the build is done (review or done, `BUILT_STATES`) and the deploy passed:
  How to test it, which opens the Testing tab. Open and the steps are on the tab only.
- **Needs you comes from nothing here.** Testing is the person's choice: the tab never says it needs them, and it is
  last in `NEEDS_FIRST`.
- **Not covered.** A cloud builder's note, given by commit trailers (`Acc-Landed`, `Acc-Moved`, `Acc-Open`), has no
  trailer for How to test it yet; its ticket's Testing tab opens the org, with no steps. The Builder's note section on
  the Plan tab does not draw How to test it: the Testing tab does.
- **Checked by** `packages/core/test/sf-org-pages.test.ts` (a page for each of the table's 16 types, the lookups, the
  list where none is found, Setup for a type with no page, unsafe names, the id read from sf's answer),
  `packages/core/test/how-to-test.test.ts` (the part as given, its limits, kept with the run, the markdown, the
  wording check, and the Salesforce packet's 3 to 7 steps), `extension/test/testing.test.ts` (when the tab is ready,
  the one line, Open off with why, which step links which component, the message, the Setup check, the open against
  the ticket, the lookup and its fallback through a fake sf, a failed open, the tab drawn before and after the deploy
  and off, no component list on the Changes tab, and the Agent panel's link) and `extension/test/task-tabs.test.ts`
  (the tab's place in the order). The screenshot run draws `ticket-testing-before`, `ticket-testing` (in review, Open
  Dev and four steps, three with a link) and `ticket-testing-off` (Open off, as this machine is not logged in to
  acme-dev, and no steps given) at each width and theme.
