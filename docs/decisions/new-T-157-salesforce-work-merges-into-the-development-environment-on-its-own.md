## D-T-157 Salesforce work merges into the development environment on its own, set in a Pipeline section of Settings (2026-10-30)

T-157. The person: "The agents should also auto commit and push to their git branches and deploy and merge
automatically (except to prod)", and "we default to building and deploying automatically to the development
environment (could be Developer, Partial, FullCopy, etc, just not prod)", "On for every project, with a section
in Settings to define". Until now a Salesforce builder committed on its branch and deployed to its build org
before it was done (D-206), and a person landed it and merged: D-014 said nothing auto-merges, and D-083 let
autopilot merge a reviewed, green pull request where a repo turned it on, never in a Salesforce project. This
amends D-014 and D-083 for Salesforce projects.

- **On by default in a Salesforce project.** `autoMergeOn` reads `autopilot.autoMerge` where it's set, else the
  profile's default (`autoMergeDefault`, `packages/core/src/pipeline.ts`): on for Salesforce, off for every other
  profile as before. The parser keeps the switch only where it differs from the default, so a Salesforce config
  with no word on it is on, `false` turns it off, and `true` is the same as none. The config no longer refuses it,
  and `acc agents auto-merge off` writes `false` there (on with nothing written changes nothing, as off did
  elsewhere). Builders, reviewers and analysts still can't run it: the role check and the builder's settings deny
  stay (D-083).
- **Only into the development environment.** The development environment is the project's default environment
  of any type but Production (`developmentEnvironment`): Developer, Developer Pro, Partial Copy or Full Copy. In a
  Salesforce project `autoMergeFor` covers its branch alone: never Production's, a protected environment's or any
  further environment's, protected or not. The merge queue, the builder's allowed `git merge origin/<base>`, the
  Agents rows and `acc agents auto-merge` all read it through `autoMergeFor`, so each follows. A project whose
  default is Production or protected (which the parser refuses, but a config read another way can show) has no
  development environment, and Settings says why (`notMergingWhy`).
- **Each condition of D-083 still holds**: autonomy review, autopilot switched on in the Command Center, the review
  passed on the branch's latest commit, the full check settled there, GitHub's checks passed, GitHub says it
  merges, no person asked for changes, nothing waiting on a person, nothing changed under `.acc/`, and one merge
  a pass. The base is merged in first at its turn (D-096), and the full check's deploy gate skips there
  (elsewhere, D-206), so the queue never deploys.
- **On the builder's own deploy.** `mergePr` refuses a Salesforce task unless `ownRunBefore` finds a passing deploy
  of the task's own, to its environment, on the head or an ancestor of it (D-206's rule for land, asked outright
  for the merge, whatever the receipts on the merge commit say). A deploy past the development org is never
  autopilot's: it is a person's pick, run by an agent (D-235).
- **A step by hand first holds the deploy.** The builder's packet for Salesforce says: a change that needs a step
  by hand in the development org before it can deploy (data to load, a setting metadata can't carry, a feature to
  turn on) isn't deployed; the builder runs `acc block "Needs a step by hand in the org before the deploy: <what>"`
  with one `--item` per step, stops, and deploys only when the person says it's done.
- **Settings has a Pipeline section** (`extension/src/model/pipeline.ts`, `extension/webview/pipeline.ts`), after
  Agents, following D-226's sections. For each project, under its name: the switch ("Merges on its own": on in
  blue, off neutral, or orange "on, but nothing merges" with why), its words folded under What this means, and
  Change…, which runs the Agents area's auto-merge command; then one table of the environments in path order
  (`inPromotionOrder`, moved from the extension's logic to core so acc lists them the same way), each with its
  branch, org, type, its place in the pipeline as an icon and a label (`PIPELINE_ROLE_LOOK`: development, Production,
  protected, further), where it goes next, Make it development (off with why on Production, a protected environment
  and the development environment itself) and Next steps…. A project that isn't Salesforce lists its environments
  too; its switch row says Agents' Auto-merge row holds the words, and has no Change….
- **The changes go through acc** (`acc environments development <env>`, `acc environments next <env> [<to>...]`,
  `packages/cli/src/commands/environment-settings.ts`, with `setDevelopmentEnvironment` and `setNextSteps` in
  `packages/core/src/pipeline-settings.ts`): each edits the project's settings by their keys, checks the whole
  through the parser before anything is written (so Production, a protected environment, an unknown name, a
  self-promotion and a loop are refused with nothing written), and writes the file whole, for a person to commit.
  `acc environments` alone shows the pipeline. Builders, reviewers and analysts are refused by role, and the
  builder's settings deny both. The extension's `acc.pipeline.development` picks among the environments that can
  be it, and `acc.pipeline.next` ticks the other environments, usual step first.
- **In words.** `acc agents auto-merge` on a Salesforce project names the development environment and its org,
  what it needs, and what it never merges into; off says a person merges, and what on would do. Settings' Agents
  Auto-merge row says the same and points at Pipeline, with Change… now, since a Salesforce project can turn it
  off. The autonomy row's words say auto-merge is on. README and DESIGN say where a Salesforce project merges.
- Not chosen:
  - Merging into every unprotected environment in a Salesforce project, as D-083 does elsewhere: the person said
    the development environment, and "never further".
  - Letting a person's waiver of the deploy gate (D-031) stand in for the builder's deploy at the merge: acc done
    takes it, the merge doesn't, so the task needs you and a person merges it.
  - Turning autonomy to review by default for a Salesforce project: D-014's manual first stands.

Tested in `packages/core/test/pipeline.test.ts` (9 tests: the default by profile, the development environment by
type and the edge cases that leave none, the words, the development branch alone covered, the promotion order,
and the two setters with their refusals and nothing written), `packages/core/test/config.test.ts` (a Salesforce
config on with nothing written, off kept, true kept out, dev covered and uat and production not),
`packages/core/test/merge.test.ts` (the mutant that merges into an unprotected environment that isn't the
development one, Production marked after the build, the switch off, and the mutant that merges before the
builder's deploy passed), `packages/core/test/deploy-gate.test.ts` (a refreshed Salesforce task's merge refused
under manual and taken to GitHub under review on its deploy before), `packages/core/test/queue.test.ts` (a
Salesforce task joins into dev, never into uat or production, not with the switch off),
`packages/core/test/dispatch.test.ts` (the builder's `git merge origin/dev` on the development environment alone),
`packages/core/test/packet.test.ts` (the step-by-hand rule, and not for a generic builder),
`packages/cli/test/agents.test.ts` (the words, on written as nothing, off written as false),
`packages/cli/test/environment-settings.test.ts` (5 tests: the listing, off and a generic project, the development
change and its refusals, next steps and a loop, the three roles refused), `extension/test/pipeline.test.ts` (6
tests: the model's order and roles, each button and why it's off, the switch's three states and a generic
project, the edge cases with no development environment, the section and its folds, and the drawn page with
each button's message), `extension/test/settings.test.ts`, `settings-sections.test.ts` (the 12 controls the
section adds, by name), `settings-guide.test.ts` (the section shot at its part) and `looks.test.ts` (both tables
walked). The screenshot run's `settings-pipeline` page draws it, both projects, at every width and theme.
