## D-209 acc runs natively on a Mac and on Windows, with no WSL (2026-10-27)

T-123. A coworker is installing the Command Center on Windows. The person decided: it works natively on a Mac
and on Windows, with no WSL. acc assumed a Mac or Linux shell in several places, and started programs that
Windows can only start through cmd.exe. The approach is agnostic first, with a branch for one system only where
nothing else works. A Mac behaves as before; where its behaviour differs at all, this entry says so.

- **One shell** (`packages/core/src/shell.ts`). `inShell(line)` is how acc runs a command line, everywhere:
  `/bin/sh -c <line>` on a Mac or Linux, and on Windows the sh that Git for Windows ships. git is a required
  install there, and acc finds its sh from git's own folder: `git --exec-path`, then up to three folders above
  it, `usr/bin/sh.exe`, else `bin/sh.exe`. No git, or no sh near it, is an error with a plain reason. Command
  gates and ratchets, the onboarding tools step, dispatch's worktree setup commands and the Command Center's
  output-panel runs (`extension/src/runs.ts`, which used `shell: true`, cmd.exe on Windows) all go through it,
  so a project's check commands keep working as written. A check's command is shown and recorded as
  `sh -c …` whichever sh ran it (`shownCommand`), so it reads the same everywhere and compares with earlier
  receipts.
- **One way to start a program** (`packages/core/src/start.ts`). Windows can't start a `.cmd` or `.bat`
  without cmd.exe, and the CLIs npm and the Salesforce installer put on PATH are `.cmd` shims: sf, npm, npx,
  code, and claude when npm installed it. `startFor` looks a name up on PATH with PATHEXT as cmd does, and runs
  a `.cmd` or `.bat` as `cmd.exe /d /s /c "<line>"`, each word quoted as Windows programs read words, then
  every one of cmd's special characters caret-escaped twice, since a shim reads its words again through `%*`.
  That is cross-spawn's escaping (MIT, github.com/moxystudio/node-cross-spawn), written again here, and a
  command-injection boundary: `packages/core/test/start.test.ts` sends 17 hostile words, `&`, `|`, `%PATH%`,
  quotes, carets and more, through a real `.cmd` on Windows, and each must arrive as it was, with no command
  run. A word holding a line break never goes through cmd (cmd would end its line there): an npm shim, such
  as claude installed by npm with dispatch's multi-line prompt, has its node script run by node, as the shim
  would run it (`npmShimScript`); any other `.cmd` is refused, with why. A missing program still comes back as
  code 127. A program that exits without reading all of its input gives its answer, not spawnSync's error
  for the input it left unread: EPIPE on a Mac and Linux, EOF or ECANCELED on Windows (`unpiped`). `startSync`, `startChild` and `startFile` are the
  only places in acc's shipped code that start a program: the runner (`exec.ts`), the extension's `runFile`
  and trackers' `exec`, dispatch's foreground claude, resume's detached claude and the output panel's runs.
  On a Mac and Linux they start the program as named, as before.
- **No variable set inline.** `ELECTRON_RUN_AS_NODE=1 '<runtime>' '<script>'` was what the extension and the
  CLI put in hooks, settings files and output-panel lines, and only a POSIX shell reads it. Each now names the
  launcher beside acc.mjs (`accLine`), which finds a runtime as it always did (D-077) and sets
  ELECTRON_RUN_AS_NODE itself. On Windows its paths use forward slashes, which Git's sh reads. The one
  difference on a Mac: a hook the Command Center writes now runs acc with node on PATH when node is 20 or
  later, as the plugin's hooks already did, rather than always with VSCode's runtime; it is the same acc.mjs.
  A builder's PATH in its settings joins folders with the system's separator (`;` on Windows).
- **The launcher on Windows.** Claude Code's hook docs say a command hook runs through "`sh -c` on macOS and
  Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed"
  (code.claude.com/docs/en/hooks), and its setup docs say "With Git for Windows, Claude Code uses Git Bash for
  the Bash tool" (code.claude.com/docs/en/setup). Git is required, so the sh launcher `acc` stays for hooks
  and for Git's sh. `acc.cmd` beside it does the same for cmd and PowerShell: ACC_NODE, then node 20 or later
  on PATH, then the runtime in `%USERPROFILE%\.acc\runtime` with ELECTRON_RUN_AS_NODE; with none, `acc hook`
  exits 0 without a word. So acc resolves by name in every shell there. The build ships `acc`, `acc.cmd` and
  `acc.mjs` together (`scripts/ship-cli.mjs`), and a release checks all three match the .vsix. `.gitattributes`
  keeps `acc.cmd` in CRLF and the sh launchers in LF wherever they're checked out. The terminals the Command
  Center types lines into open Git's sh on Windows (`terminalShell`), since the lines are written for one;
  Setup's terminal is left to the task that does Setup's Windows install lines.
- **nice.** acc lowered its checks with the `nice` command, which Windows doesn't have (it skipped it there).
  A run now asks for it (`nice: true`), and the runner starts the command through a small Node script
  (`NICE_SCRIPT`) that lowers its own priority with `os.setPriority(15)` and then starts the command, which
  inherits it, as does everything it starts (on Windows, the below-normal class). A stop at the timeout is
  passed on to the command on a Mac and Linux; on Windows a process is ended without a signal to pass on, so a
  stopped check's command may run on there. The screenshot run lowers Chrome the same way, by its pid. gh is
  never run through the script: its timeout stops it with SIGKILL, which the script can't pass on.
- **Paths compare as Windows compares them.** git names a folder `C:/Users/…`, Node and Claude Code
  `C:\Users\…`, and a temp folder can come in its short 8.3 form. On Windows `pathKey` makes one spelling
  (one slash, no case, no trailing slash), and `samePath` also spells out short names. Claude Code's trust
  (`isTrusted`), an agent asking in a worktree (`askingUnder`) and the main checkout's check compare that way,
  and the list of repos on this machine keeps a Windows root (`isAbsolute`, not a leading `/`). A Mac compares
  exactly as before.
- **Home.** Every read of HOME already had a fallback (`homedir()`, or USERPROFILE for the machine folder),
  so nothing changed there.
- **Mac-only for now.** Keep-awake (caffeinate) stays the Mac's. So does the routine's token for cloud
  builders, which lives in the macOS keychain through `security`: on Windows acc never runs it (Linux, where
  CI runs, keeps the keychain stand-in its tests use, as before),
  `cloudTokenUnavailable` gives the reason ("Not available on Windows yet: the routine's token is kept in the
  macOS keychain"), Setup's token step skips with it, and Settings' Token… button is off with it. A token in
  ACC_CLOUD_TOKEN still works everywhere.
- **The checks.** `scripts/test/one-shell.test.ts` reads acc's code and the repo's scripts and fails on an sh
  started by name or `shell: true`, a `VAR=value` at the start of a command line acc builds, and the nice
  command; in acc's shipped code also on a program started without the start helper. Its exceptions are a
  named list, each with why and the exact number of lines it reaches. It counts the files and lines it read.
  CI's Windows job (`.github/workflows/check.yml`, `windows`) runs typecheck, the build, the unit tests
  (`scripts/windows-tests.ts`), installs the Salesforce CLI, and runs `scripts/windows-smoke.ts --sf`:
  `acc doctor --part machine` by name through Git's sh and through cmd, from a folder outside any project,
  needing git, node, gh and sf's steps to pass, then git, node, npm, gh and sf run by acc's runner, sf niced
  too, counting its checks. It runs no screenshot run: Windows minutes cost twice Linux's on this repo. What
  can't run on Windows yet is `WINDOWS_SKIPS`: whole test files, and single tests that skip through
  `skipOnWindows`, each with why, printed with their count before the run;
  `scripts/test/windows-tests.test.ts` fails when the list is longer than where the branch left main. A
  test's stand-in program (`packages/core/test/stand-in.ts`) gets npm's own `.cmd` shim beside it on Windows,
  so acc starts it by name as it starts npm's claude: through cmd, or by node when a word holds a line break,
  as dispatch's and the drafter's prompts do. For a node script the shim runs the script; for an sh script it
  runs a node runner beside it, which runs the script by Git's sh, each word quoted as Git's sh reads its
  command line. The tests' temp root is its long path there, with TEMP and TMP set.
- **A step's line on each system.** A Setup step whose fix differs by system, A4.plugin's `&&` chain (a
  PowerShell `if ($?)` on Windows) and a tool's install line, has its fix for each system (`fixOn`); `fix` is
  the one for the system acc runs on, which Do it runs. A step's page for a system shows that system's
  (`fixFor`), so the walkthrough files, which the build writes for a Mac, show a Mac's lines whichever system
  builds them.
