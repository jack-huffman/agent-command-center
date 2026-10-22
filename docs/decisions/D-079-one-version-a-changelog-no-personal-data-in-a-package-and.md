## D-079 One version, a CHANGELOG, no personal data in a package, and releases a person makes (2026-10-06)

acc said 0.1.0 while the extension, the plugin and the marketplace said
0.33.0, each bumped by hand, and nothing stopped a package carrying its
packager's own data (GH-60). This is the second of four packaging tasks, after
D-077 and before GH-61 and GH-62.

- **One version, the root package.json's.** acc reads it for `--version` and
  `acc help`; its bundle gets that one field, not the whole file. The
  extension's package.json, plugin.json, the marketplace's `acc` entry and
  package-lock.json keep literal copies, because vsce and Claude Code read
  those files as they're committed. `npm run set-version -- <x.y.z>` is the one
  way to change it: it rewrites only the version strings, and writes nothing if
  one can't be found. A test fails, naming the file, when one disagrees, and
  another when `acc --version`, from source or built, prints anything else.
  This task sets 0.35.0 (a person decided).
- **CHANGELOG.md**, at the root: `## x.y.z` headings, newest first, each once,
  each with notes in plain words, and `## Earlier versions` last. It starts at
  0.34.0, already released from main; earlier versions weren't released and
  aren't backfilled (a person decided). A test checks its shape.
- **`npm run package`** checks that the versions agree and that the CHANGELOG
  has an entry for this one, before building anything. Then `npm run check`,
  then vsce, then a scan of the `.vsix` and the plugin. **Amends D-042:**
  plugin/bin is written last, only after a clean scan. A failed scan deletes
  its `.vsix` and leaves plugin/bin as it was, so nothing personal is one
  commit from shipping. `npm run build -- --release` is gone.
- **The scan** reads every file in the `.vsix` (opened with macOS's
  `/usr/bin/unzip`), and the plugin as a release commits it: plugin/ with bin/
  as the build made it, and the marketplace. A file with a NUL byte, a font or
  an image, is read byte for byte, so a path in its metadata still shows. Each
  find is a line, `<package>: <file>:<line>: <what>`. It looks for:
  - a home path: `/Users/<name>`, `/home/<name>`, or `-Users-<name>-` as
    `~/.claude/projects` writes it;
  - the packager's git emails, from every scope and every file the system and
    global configs include, whatever its `includeIf` condition, from
    `GIT_AUTHOR_EMAIL` and the like, and from `.acc/config.json`'s
    commitIdentity;
  - a GitHub account: every one gh is signed in to, the repo's own and the
    clone's (D-028), as whole words;
  - a `.claude/` or `.acc/` path holding the packager's username or real name
    (their login name, `id -F`, git's user.name). acc's own generic paths,
    such as `~/.acc/runtime`, don't;
  - any real-looking Jira site (`<site>.atlassian.net`) or Azure DevOps
    organization (`dev.azure.com/<org>`, `<org>.visualstudio.com`);
  - the sites, organizations and client repos the packager has signed in to
    trackers for.
- **The packager's words come from their machine** each time, and are never
  written into the repo.
- **Sign-ins are read by name only** (a person decided). They live only in
  VSCode's secret storage, as `acc.cred:<repo>:<kind>:<host>` (D-027). The
  scan opens VSCode's `state.vscdb` read-only with `node:sqlite` and selects
  only the keys holding `acc.cred:`, never a value. An Azure DevOps host is a
  bare organization, so it's matched only as `dev.azure.com/<org>` or
  `<org>.visualstudio.com`. If the file can't be read, the scan says so and
  goes on by pattern. `ACC_VSCODE_STATE` names another file, or none when
  empty.
- **What may stay:** the test fixtures' placeholders, acme, jordan-kim, jordan,
  example and you, as whole names; and `github.com/jack-huffman/agent-command-center`,
  the repo's own address (a person decided). So plugin.json's author and the
  marketplace's owner are now Agent Command Center, linking to the repo, not a
  person's account. The publisher, `JackHuffman`, stays: changing it changes
  the extension's id, and loses every sign-in stored under it.
- **`npm run release`** makes the GitHub Release `v<x.y.z>` of HEAD on
  `.acc/config.json`'s github.repo, as its account or the clone's (D-007,
  D-028), with the `.vsix` attached and the CHANGELOG entry as its notes. Its
  title is the bare version, and it isn't a prerelease. It refuses, saying
  why, when there's no terminal; `ACC_ROLE` is set; HEAD isn't main, or isn't
  origin/main after a fetch; there are uncommitted changes; the versions
  disagree; the CHANGELOG has no entry; the `.vsix` is missing or holds another
  version; plugin/bin's `acc` or `acc.mjs` isn't the `.vsix`'s; the scan, run
  again, finds anything; gh isn't signed in as the account; or the release or
  its tag already exists. Last, the person types the version. The upload gets
  10 minutes, not gh's usual 2 (D-051).
- **A release, in order:** `npm run set-version -- <x.y.z>` and a CHANGELOG
  entry, on a branch like any change; once merged, on main, `npm run package`,
  commit plugin/bin and push; then `npm run release`.
- **Builders can't release.** The Bash guard denies `npm run release`,
  `node scripts/release.mjs` and `gh release create|upload|edit|delete`, through
  `nice` and the other wrappers. Builders' settings deny the same, since they
  allow `npm run *`. `gh release view` stays allowed. Fixtures:
  `gh-release-create.json`, `npm-run-release.json`, `gh-release-view.json`.
- **This repo's packaging lives in scripts/**, not core: releasing this repo
  isn't acc's product behaviour (D-003). Its tests are in scripts/test, part of
  `npm test`.
- **Accepted:** the marketplace install clones the whole repo, with its history
  and its commits' emails, so the scan doesn't make that install free of
  personal data. The repo is private and invitation-only. A packager whose own
  username is a placeholder isn't caught by the home path rule. A builder that
  runs `npm run package` on a branch still rewrites plugin/bin. macOS only, as
  D-077.
- Not chosen: setting the manifests' versions at build time (vsce and Claude
  Code read them as committed); a zip library (macOS has unzip); flagging every
  email address (it's the packager's own that matter); and releasing from CI.
