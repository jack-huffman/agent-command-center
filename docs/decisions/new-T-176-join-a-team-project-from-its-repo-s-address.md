## D-T-176 Join a team project from its repo's address, and see only your own setup steps (2026-11-01)

T-176. The person wrote: "we should support starting a project from an existing git repo". In managed services a
team works from one shared repo, and each teammate needs an easy way in. Before this, a teammate cloned the repo by
hand (ONBOARDING B2), and then Setup showed every step, and they had to find their own. This amends D-017 and D-028.

- **Join a team project** (`JOIN_COMMAND` in `packages/core/src/join.ts`, id `acc.join`). It asks for one thing,
  the repo's address. The Command Center offers it in Setup wherever no project is set up (no folder open, or a
  folder with no project settings), and in the Command Palette. `acc join <url> [--dir <path>] [--account <a>]`
  does the same in a terminal, and `--dry-run` says who can read the repo and where it would go, writing nothing.
  Only a person joins: a builder, a reviewer and an analyst are refused.
- **The account that can read it.** Each account gh is signed in to is asked with its own token, so gh's active
  account never decides. When no account can read the repo, acc refuses with why and makes no folder. When more
  than one can, the Command Center asks: at most three accounts, the active one first, and the person's own words
  (D-205). In a terminal, `--account` names it.
- **Where it goes.** The default is the repo's name under the person's Documents folder: `~/Documents` on a Mac,
  This PC's Documents (the user profile's `Documents`) on Windows. A folder that holds files is refused.
- **Pinned in that clone only (amends D-028).** The clone itself uses a credential helper pinned to the account on
  git's command line. Then acc sets, each with `git config --local`, never `--global`: `user.name` and
  `user.email`, `acc.githubAccount`, acc's credential helper, and `acc.joined`. The commit identity is the
  person's own, from their GitHub account, with GitHub's private email. In a joined clone, B2.identity passes on an
  identity of its own set in the clone, not the project's `commitIdentity`, which is the person's who set it up.
  `acc github status` reports `joined`.
- **Only your steps (amends D-017).** The step list is still the one source. `OWN_STEPS` names the steps that are
  each person's own: the plugin (A4.plugin), the commit identity (B2.identity), the GitHub account and git's push
  (B2.account, B2.credentials), a login to each environment's org (B6.org-match), the floors' merge driver
  (B10.merge-floors) and the tracker sign-in (B14.tickets). In a joined clone, Setup heads them "Join <project>"
  and the walk goes through them alone. The project's other steps fold under "Set up by your team", with their
  state, outside the walk.
- **No Production login.** In a joined Salesforce project, B6.org-match passes without Production (D-208), and its
  Do it doesn't offer Production's login at all (`loginEnvironments`).
- **Share how to join.** In Settings, under GitHub accounts, a project set up in this clone (not joined) has
  Share how to join (`acc.join.share`). It copies the repo's address and three steps: install the extension, run
  Join a team project, paste the address. It names no person and holds no secret.
- **Checks.** `packages/core/test/join.test.ts` clones a real repo through a stand-in GitHub, and fails when a join
  writes any git config that isn't `--local`, or anything to the global config. `packages/cli/test/join.test.ts`
  pins the refusal with no folder made. `extension/test/join.test.ts` pins the joined Setup, the account choice and
  Share how to join, and that Windows CI skips none of the three files. The screenshot run draws `setup-first`
  (Join), `setup-joined` and `settings-github` (Share how to join).
