/** The system acc runs on, as far as what a person installs with: a Mac, Windows or Linux (T-124). */
export type InstallSystem = 'mac' | 'windows' | 'linux';
export const INSTALL_SYSTEMS: readonly InstallSystem[] = ['mac', 'windows', 'linux'];

/** The tools Setup tells a person to install. */
export type InstallTool = 'git' | 'node' | 'gh' | 'claude' | 'sf' | 'java' | 'python';

/** One way to install a tool: a line to run, or the maker's page when they give no one line. */
export type InstallLine = { command: string; shell: Shell } | { page: string };

/** The shell a line is written for: PowerShell on Windows, the Mac's and Linux's sh elsewhere. */
export type Shell = 'sh' | 'powershell';
export const shellOf = (system: InstallSystem): Shell => (system === 'windows' ? 'powershell' : 'sh');
const sh = (command: string): InstallLine => ({ command, shell: 'sh' });
const ps = (command: string): InstallLine => ({ command, shell: 'powershell' });

/** The system of a Node platform name (process.platform). Anything that isn't a Mac or Windows is Linux. */
export const systemOf = (platform: string): InstallSystem => (platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux');

/** The system acc runs on, read once. A test passes its own system to the functions below instead. */
export const SYSTEM: InstallSystem = systemOf(process.platform);

/**
 * Every install line Setup gives, by tool and then by system. Each was read on 2026-10-27; the exact line the
 * maker's page gives is beside its entry. Both core and extension tests fail on a tool with no mac or windows entry.
 * - Claude Code: https://code.claude.com/docs/en/setup: `brew install --cask claude-code`, `irm https://claude.ai/install.ps1 | iex`
 *   and `curl -fsSL https://claude.ai/install.sh | bash`
 * - Homebrew (A1.brew, BREW_INSTALL below): https://brew.sh: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
 * - git: Windows https://git-scm.com/install/windows (git-scm.com/download/win redirects there) gives
 *   `winget install --id Git.Git -e --source winget`; this table keeps T-124's `-e` line, the same package, and the page
 *   says that package isn't maintained by the Git for Windows project (acc needs Git for Windows for its `sh`, T-123).
 *   Linux https://git-scm.com/install/linux gives `apt-get install git` for Debian and Ubuntu. A Mac: Homebrew's `brew install git`.
 * - GitHub CLI: https://github.com/cli/cli#installation, which links its per-system pages: docs/install_windows.md gives
 *   `winget install --id GitHub.cli --source winget` (this table keeps T-124's `-e` line, the same package);
 *   docs/install_macos.md gives `brew install gh`. Linux needs a repository added in several lines, so its page.
 * - Node: https://nodejs.org/en/download shows its package-manager lines only in a browser (the page as fetched on
 *   2026-10-27 had none), so the winget id was read in the maker-independent winget manifest repository instead,
 *   github.com/microsoft/winget-pkgs, manifests/o/OpenJS/NodeJS/LTS (versions 24.21.0 to 24.22.1): `winget install --id OpenJS.NodeJS.LTS -e`.
 *   Node's Homebrew formula is `brew install node`. Linux has no one line, so the page.
 * - Salesforce CLI (T-133): https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_install_cli.htm
 *   gives an npm install; this table keeps A1.sf's `npm install -g @salesforce/cli`, the same line on every system.
 *   npm comes with Node, so A1.node and A1.npm come first.
 * - Java, for Code Analyzer's PMD and CPD engines (T-133): https://adoptium.net/installation/ gives
 *   `winget install EclipseAdoptium.Temurin.25.JDK` for the latest LTS (this table adds `--id` and `-e`, as the others
 *   do). A Mac: Homebrew's cask `temurin`. Linux: `apt-get install openjdk-21-jdk` on Debian and Ubuntu.
 * - Python, for Code Analyzer's Flow engine (T-133): https://docs.python.org/3/using/windows.html, section 4.1.10,
 *   gives `winget install 9NQ7512CXL7T -e --accept-package-agreements --disable-interactivity` (the Python install
 *   manager), then `py install --configure -y`. A Mac: Homebrew's `brew install python`. Linux: `apt-get install python3`.
 */
export const INSTALL_LINES: Record<InstallTool, Record<InstallSystem, InstallLine>> = {
  git: {
    mac: sh('brew install git'),
    windows: ps('winget install --id Git.Git -e'),
    linux: sh('sudo apt-get install git'),
  },
  node: {
    mac: sh('brew install node'),
    windows: ps('winget install --id OpenJS.NodeJS.LTS -e'),
    linux: { page: 'https://nodejs.org/en/download' },
  },
  gh: {
    mac: sh('brew install gh'),
    windows: ps('winget install --id GitHub.cli -e'),
    linux: { page: 'https://github.com/cli/cli#installation' },
  },
  claude: {
    mac: sh('brew install --cask claude-code'),
    windows: ps('irm https://claude.ai/install.ps1 | iex'),
    linux: sh('curl -fsSL https://claude.ai/install.sh | bash'),
  },
  sf: {
    mac: sh('npm install -g @salesforce/cli'),
    windows: ps('npm install -g @salesforce/cli'),
    linux: sh('npm install -g @salesforce/cli'),
  },
  java: {
    mac: sh('brew install --cask temurin'),
    windows: ps('winget install --id EclipseAdoptium.Temurin.25.JDK -e'),
    linux: sh('sudo apt-get install openjdk-21-jdk'),
  },
  python: {
    mac: sh('brew install python'),
    windows: ps('winget install 9NQ7512CXL7T -e --accept-package-agreements --disable-interactivity; if ($?) { py install --configure -y }'),
    linux: sh('sudo apt-get install python3'),
  },
};

/**
 * Homebrew's own installer, as its install page gives it (https://brew.sh): the fix of A1.brew, and of a Mac step
 * whose line is a brew command while Homebrew is missing. Only a Mac has it.
 */
export const BREW_INSTALL = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

/** Whether a tool's line on a system is a Homebrew command, so Homebrew has to be there first. */
export const needsBrew = (tool: InstallTool, system: InstallSystem): boolean => (installCommand(tool, system) ?? '').startsWith('brew ');

/** What a tool's install gives a system. */
export const installLine = (tool: InstallTool, system: InstallSystem = SYSTEM): InstallLine => INSTALL_LINES[tool][system];

/** The line to run for a tool, or null when its maker gives the system a page and no line. */
export const installCommand = (tool: InstallTool, system: InstallSystem = SYSTEM): string | null => {
  const line = installLine(tool, system);
  return 'command' in line ? line.command : null;
};

/** Words for a page-only install, as a step's text. */
export const installText = (tool: InstallTool, system: InstallSystem = SYSTEM): string | null => {
  const line = installLine(tool, system);
  return 'page' in line ? `Install it from ${line.page}.` : null;
};

/**
 * What a fix that installs a tool adds on Windows (T-124): a tool installed while VSCode is open isn't on its
 * PATH until VSCode restarts. Empty on a Mac and on Linux, where a new terminal is enough.
 */
const RESTART_WHY = 'a tool installed while VSCode is open isn\'t on its PATH until VSCode restarts.';
export const RESTART_NOTE = `After it installs, restart VSCode: ${RESTART_WHY}`;
/** The same sentence as a step's page says it, which shows every system's lines and so names Windows. */
export const RESTART_PAGE_NOTE = `On Windows, after it installs, restart VSCode: ${RESTART_WHY}`;
export const restartNote = (system: InstallSystem = SYSTEM): string => (system === 'windows' ? RESTART_NOTE : '');
