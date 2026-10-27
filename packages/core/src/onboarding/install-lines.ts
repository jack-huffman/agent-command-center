/** The system acc runs on, as far as what a person installs with: a Mac, Windows or Linux (T-124). */
export type InstallSystem = 'mac' | 'windows' | 'linux';
export const INSTALL_SYSTEMS: readonly InstallSystem[] = ['mac', 'windows', 'linux'];

/** The tools Setup tells a person to install. */
export type InstallTool = 'git' | 'node' | 'gh' | 'claude';

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
 * Every install line Setup gives, by tool and then by system. Where each comes from, and what was read:
 * - Claude Code: https://code.claude.com/docs/en/setup, read 2026-10-27: Homebrew's cask, its PowerShell installer and its shell installer
 * - Homebrew (A1.brew, BREW_INSTALL below): https://brew.sh
 * - git: https://git-scm.com/downloads (Windows: Git for Windows, which acc needs for its `sh`; Linux: the Debian and Ubuntu line)
 * - GitHub CLI: https://github.com/cli/cli#installation (Linux needs a repository added in several lines, so the
 *   page; its Linux guide, read 2026-10-27, gives no one line)
 * - Node: https://nodejs.org/en/download (Linux has no one line, so the page)
 * The git, GitHub CLI and Node winget ids are those T-124 was given; the maker's page for each is to be read again
 * when a line changes. Both core and extension tests fail on a tool with no mac or windows entry.
 */
export const INSTALL_LINES: Record<InstallTool, Record<InstallSystem, InstallLine>> = {
  git: {
    mac: sh('brew install git'),
    windows: ps('winget install --id Git.Git -e'),
    linux: sh('sudo apt install git'),
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
export const RESTART_NOTE = 'After it installs, restart VSCode: a tool installed while VSCode is open isn\'t on its PATH until VSCode restarts.';
export const restartNote = (system: InstallSystem = SYSTEM): string => (system === 'windows' ? RESTART_NOTE : '');
