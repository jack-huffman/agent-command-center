## D-T-125 A person with no access to Production still sets up a Salesforce project and uses the Command Center (2026-10-27)

T-125. On a Salesforce project some people have no access to Production. The person decided (2026-10-27)
that they must still be able to set up the Command Center and use it. Builders never deploy to Production
(the deploy gate refuses it, `packages/core/src/deploy-gate.ts`), so setting up and building don't need it.
This amends D-018, where `acc init` finds the environments from Production's `SandboxInfo`: that stays the
way with Production, and this adds a way without it.

**Joining a project someone else set up.** Its settings are committed. A machine that has no org for
Production, or isn't logged in to the one the settings name, passes Setup on the rest. Production's line
says, in plain words, that this machine isn't logged in to Production, that setting up and building don't
need it, and that someone with access to Production looks after it (`PRODUCTION_NOT_HERE`,
`packages/core/src/sf-discovery.ts`). A Production alias that is logged in but points at a sandbox still
fails, as before.

**Starting a new project without Production.** `acc init --profile salesforce --my-domain <domain>` (not
with `--production-org`) reads `sf org list`, takes every logged-in sandbox on that My Domain (the URL
`<domain>--<sandbox>.sandbox.my.salesforce.com` gives both), and records Production with no org on this
machine. Each sandbox's name is its name in the URL, in lower case. Sandboxes this person isn't logged in to
aren't found; the notes say so.

- **A sandbox's type, without Production's list.** Only Production's `SandboxInfo` says Developer, Developer
  Pro, Partial or Full. acc chooses a safe default and doesn't ask: a sandbox the CLI tracks source for is
  `developer`, since only Developer sandboxes can be; any other is `partial` (`GUESSED_TYPE`). Partial isn't
  treated as source tracked, so nothing relies on tracking a guessed sandbox has, and it sits on the usual
  path before Production. The notes name each guessed sandbox. A team template's type wins over a guessed
  one (`overlayEnvironments`), where Production's list would win over the template.
- **B0.config's Do it.** The Production org list offers, beside the orgs and "Log in to another Production
  org…", "I don't have access to Production". The orgs are things to pick from, as the Connect page's boards
  are, and the question's own answers are those two (D-205). It then asks which My Domain,
  from those with a logged-in sandbox, each with its sandboxes named. With none logged in, it says so and
  offers the sandbox login. A team template that is Salesforce asks the same.
- **Filling in Production later.** The settings are written the same way, Production with `"org": null`.
  Someone with access to Production runs `acc setup production --org <alias>` (new): it checks the alias is
  logged in to a Production org, refuses one on another My Domain than the sandboxes logged in on that
  machine, reads its sandbox list, corrects each listed sandbox's type to Salesforce's, and names the
  sandboxes the settings lack. In the settings file it changes only Production's org and those types; every
  other key each environment has stays as the file has it (`writeJsonKey`). Then they commit
  the settings and make production's branch with `acc setup branches`.

**Every place that reads Production's org,** and what each does without it:

1. **B1.orgs** (Every org is listed) compares the settings with Production's sandbox list. Without
   Production here it is skipped, and says it runs where Production is logged in. It used to fail on
   Production with no org.
2. **B6.org-match** (Each branch points at the right org): Production's line passes with the reason above.
   When a sandbox fails the step, the failure still ends with Production's line, so item 8 knows.
3. **B6.branches** (A branch for every environment): a missing production branch isn't a failure while
   Production isn't here, since it's retrieved from Production; the line says who makes it. A sandbox's
   missing branch still fails.
4. **acc setup branches** (`seedBranches`): production's branch is skipped, with that reason, and nothing is
   retrieved from Production. Each sandbox's branch starts from this checkout, with nothing cleared, as it
   already did with no production branch.
5. **B9.lists** and **acc setup lists** (`draftLists`): the lists are drafted against production's branch.
   With that branch missing and Production not here, the step is skipped with the reason, so Do it isn't
   offered to fail; `acc setup lists` refuses, saying someone with access to Production makes the branch.
6. **B5.baseline** (`buildBaseline`) reads only the environment branches there are, never an org. It works
   without Production.
7. **B6's Do it** (log in to an environment's org) lists Production, when it has an org alias, last, with a
   "not needed" mark and reason; Production with no org isn't listed.
8. **The Environments page**: Production's Open org and Deploy… are disabled, with the reason
   (`PRODUCTION_AWAY`), when Production has no org, and when it has an alias that the last Setup check
   (B6.org-match, run in this project's folder) found isn't logged in here (`productionNotHere`). Before
   that check, or for another project than the one it ran in, the extension doesn't know, and they stay
   on as before. The page's `actionButton` draws a disabled action disabled, its reason in its title; it
   used to ignore `disabled`. Compare reads branches only, and works.
9. **A team template's preview** (B0.template, `previewCommand`) uses `--my-domain <my-domain>` for a
   project whose Production has no org.
10. **acc deploy** and **acc drift** to Production refuse an environment with no org already, with the
    reason. The deploy gate never deploys to Production.
