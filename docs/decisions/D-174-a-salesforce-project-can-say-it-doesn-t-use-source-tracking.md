## D-174 A Salesforce project can say it doesn't use source tracking (2026-10-17)

- **Why.** Some clients don't use source tracking. acc works without it: its
  retrieves use manifests (drift, the baseline) and its deploys and
  validations use source folders. Only Setup's two B8 steps assumed it, and
  they failed for such a project with nothing to fix.
- **The setting.** `sourceTracking` in `.acc/config.json`, true or false. Left
  out, the project uses tracking, so no existing project changes. Another type
  is refused. Outside Salesforce nothing reads it, and `false` gets a warning,
  as `strayFiles.data` does. A team template can't set it: it's each
  project's own.
- **Setup.** With it false, `B8.tracking` and `B8.cli-tracking` skip before
  they ask any org, and say the project doesn't use source tracking and where
  to turn it on: Source tracking under Limits and checks in the project's
  settings.
- **Changing it.** `acc tracking [on|off]` shows it or changes only that key,
  written whole through a temp file. On takes the key out, since on is the
  default. A builder, reviewer or analyst is refused, and so is a project that
  isn't Salesforce. Settings' Limits and checks shows a Source tracking row
  for each Salesforce project, Used or Not used, whose Change… runs it.
- **Nothing else assumed tracking.** The rest of acc's sf calls were checked:
  deploys and promotions pass `--source-dir`, drift retrieves by manifest with
  `--ignore-conflicts`, and the analyst's retrieve names its components. `acc
  init`'s note that agents work best against a source-tracked Developer
  sandbox is advice, not a check, so it stays.
- **Checked.** `source-tracking.test.ts` has 3 tests, `config.test.ts` 1,
  `onboarding.test.ts` 1, `cli/test/tracking.test.ts` 2 and `limits.test.ts`
  1.
- **A pinned refusal (2026-10-19, T-77).** `setSourceTracking` runs the
  whole `loadConfig` check, so `acc tracking on` or `off` refuses a Salesforce
  config that has any other problem, and leaves the file as it was.
  `source-tracking.test.ts` has a test for it.
