## D-081 The acc plugin is a walkthrough step, installed for every session from the repo's address; the docs are written for someone new (2026-10-06)

A4.plugin was a placeholder the walkthrough hid, and the README and
ONBOARDING.md assumed the author's machine (GH-61). This is the third of four
packaging tasks, after D-077 and D-079 and before GH-62.

- **The check asks Claude Code.** `claude plugin list --json` lists each
  installed plugin with its `id`, `version`, `scope` and `enabled` (Claude
  Code 2.1.292, run here). A4 passes when `acc@agent-command-center` is
  installed at user scope and enabled, and names its version. Only when it
  isn't installed there does it also read `claude plugin marketplace list
  --json`, whose entries have a `name`. Not chosen: reading
  `~/.claude/plugins/*.json` and `enabledPlugins`, which are Claude Code's
  undocumented internals.
- **Each state gets its own fix.** No marketplace: `claude plugin marketplace
  add https://github.com/jack-huffman/agent-command-center && claude plugin
  install acc@agent-command-center --scope user`, which is also the step's own
  command. The marketplace but no plugin: the install alone. Installed but
  disabled: `claude plugin enable acc@agent-command-center --scope user`.
  Installed for one project only (project or local scope): the user-scope
  install. Re-adding a marketplace that's there already exits 0, but the fix
  still says only what's missing. Not chosen: `claude plugin install
  --marketplace <source>`, one command that hides which part was missing.
- **No Claude Code, or output it can't read.** claude not installed (exit 127)
  fails and says to do A1.claude first, with no fix of its own. A list that
  doesn't run, isn't JSON, or isn't a list of objects is `unknown`, with the
  reason, never a crash.
- **User scope** (a person decided): one machine step, and every Claude Code
  session has the hooks, which do nothing in a repo without `.acc/config.json`
  (D-042). Not chosen: project scope, or committing `extraKnownMarketplaces`
  into client repos.
- **The repo is written as its full URL**, `https://github.com/jack-huffman/agent-command-center`,
  in the step, its page and the docs: D-079's scan allows only
  `github.com/<repo>`, and would stop `npm run package` at a bare
  `owner/repo`. Claude Code takes the URL as a git source and clones its
  `.git`. `PLUGIN` in the step list holds the marketplace's name, the plugin's
  name and the address; a test holds them to `.claude-plugin/marketplace.json`
  and `plugin.json`'s `repository`.
- **Credentials are the person's own** (a person decided). The marketplace is
  this private repo, and Claude Code clones it with the person's git
  credentials. **Do it** runs in a terminal, as any `claude <subcommand>` does,
  so a git prompt shows, and the step checks itself when the command ends.
  The README's Getting access says to accept the invitation with the account
  you'll use, check `git ls-remote`, and run `gh auth setup-git` if that
  fails, saying that it changes the global git config for every repo without a
  helper of its own. A private marketplace doesn't update itself without
  `GITHUB_TOKEN`, so the plugin is updated by hand after each release.
- **No version match yet.** A4 passes whatever version is installed, and names
  it. Whether a plugin older than the extension should fail is GH-62's to
  decide (a person decided).
- **`planned` is gone.** A4 was the only planned step, so the field, and its
  filters in the walkthrough, the Setup page, the screenshot fixtures and
  `acc doctor --json`'s `planned` key, went with it. A4 shows after A2 in the
  machine walkthrough, under The acc plugin on the Setup page, and in
  `acc doctor` and `acc onboard`.
- **ONBOARDING.md stays hand-written, held to the step list.** It writes every
  step as **title** (`id`), and a test takes those pairs in order and compares
  them with the steps', naming what's missing, extra or retitled. Another
  checks that every guide link a step or the README gives is one of its
  headings. Generating it from the steps (D-017) stays for later.
- **The author's own material** (a person decided): B4 says what the skeleton
  needs, with no copy from another project; the per-org folders' notes are one
  optional section, Coming from per-org folders; moving a Claude conversation
  between folders is gone; and Part C is Problems you may hit, without dated
  anecdotes. The pilot and milestone text, and Part D's commands that don't
  exist, are gone.
- **The README has Install and first run**: what you need, getting access,
  installing the `.vsix` from a release, the first run, and what acc changes on
  the machine. The plugin's by-hand install is the first run's second step;
  the developer's `npm run package && npm run install-extension` moved under
  Development. The extension's own README, which ships in the `.vsix`, names
  the walkthroughs by their titles and no longer asks for Node (D-077).
- **The docs pass the scan.** A test runs D-079's scan over the README,
  ONBOARDING.md, the extension's README, its package.json and every step page,
  with this repo's account, commit email and name as the words, and finds
  nothing.
