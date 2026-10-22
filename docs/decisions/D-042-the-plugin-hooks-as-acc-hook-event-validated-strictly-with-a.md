## D-042 The plugin: hooks as `acc hook <event>`, validated strictly, with a release-only bundle (2026-10-02)

- **The hooks are acc commands,** `acc hook session-start | pre-tool-use | stop`,
  like the permission hook. The rules live in core (`hooks.ts`) beside
  everything else they enforce.
  - Each hook finds `.acc/config.json` by walking up from the session's
    folder, before running anything, so a repo that hasn't opted in costs
    nothing.
  - A builder is known by its environment, or by its folder being a running
    task's worktree, so the guards also hold for a session started some
    other way.
  - On anything unexpected a hook prints nothing and exits 0. It never exits
    2, which would block the tool.
- **The Bash guard is stricter than the first design.** Builders never push,
  not even their own branch: `acc land` does that after review. It also stops
  switching branches, `git worktree`, `reset --hard`, and every acc command
  that's a person's. Commands are split the way the shell would, through
  quotes, `&&`, `;`, pipes, subshells and wrappers such as `nice` or
  `FOO=1`. So `git add -A && git push` is caught, and `echo 'git push'` isn't.
- **Fixtures.** Each rule has a fixture in
  `packages/core/test/fixtures/hooks/`: the event, the hook's input, and the
  outcome expected. The test runs each through the real `acc hook` command,
  against a repo with a task running in a real worktree. That's 26 cases, with
  allowed commands beside denied ones.
- **Checked live:** a `claude -p` session loaded with `--plugin-dir plugin`, as
  a builder, had `git push` refused by the hook, even though its own
  `--allowedTools` allowed it. When it then stopped short, the Stop hook sent
  it back to the finish line.
- **The permission hook isn't in the plugin.** Globally, it would send your
  own interactive sessions' prompts to the page while you're looking at the
  tab. Dispatch adds it to builders.
- **`plugin/bin/acc` is refreshed only for a release** (`npm run package`).
  Every check rebuilt it before, so any branch that ran its checks conflicted
  with `main` over a generated file: pull request #10 did. The day-to-day
  build now writes `dist/acc`, which git ignores.
- `claude plugin validate --strict` passes for the plugin, its skills and its
  agent, and for the marketplace (`npm run validate-plugin`). The profiles and
  templates folders in the first design weren't needed: profiles and the
  packet live in core.
