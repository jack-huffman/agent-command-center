/**
 * What a machine needs, by system and by profile (T-133): one list, beside install-lines.ts, that Setup's A1 steps,
 * the walkthrough, `acc doctor --part machine` and starting a project all read. Each need names its step, the
 * program it looks for and its least version, why acc needs it, where its line to install it is, and the folders
 * its installer puts it in on each system. A program that isn't on VSCode's PATH is looked for in those folders,
 * so "installed, but VSCode can't see it" is told apart from "not installed" (path-fix.ts).
 *
 * Each need names the maker's page it was checked against and the date that page was read.
 *
 * A place is a folder. {HOME}, {USERPROFILE}, {ProgramFiles}, {LOCALAPPDATA} and {APPDATA} are the person's own
 * folders, read from the environment; {npm} is npm's global folder for programs (`npm prefix -g`, with /bin on a
 * Mac and on Linux). A `*` stands for any one folder, such as a version's.
 */
import type { Profile } from '../config.ts';
import type { InstallSystem, InstallTool } from './install-lines.ts';

export interface MachineNeed {
  /** The A1 step that checks it: an existing step keeps its id (D-017). */
  step: string;
  /** What the need is called, in words. */
  name: string;
  /** The program looked for on PATH, on each system where it's needed. */
  program: Partial<Record<InstallSystem, string>>;
  /** The program's file in an install place, where it isn't the program's own name: git.exe, sf.cmd. */
  file?: Partial<Record<InstallSystem, string>>;
  /** What prints its version, where it isn't `--version`: Java 8 knows only `-version`. */
  versionArgs?: readonly string[];
  /** Its least version, or null when any version does. */
  min: string | null;
  why: string;
  /** The systems that need it. */
  systems: readonly InstallSystem[];
  /** The profiles that need it. Absent: every profile. */
  profiles?: readonly Profile[];
  /** Its install line, from install-lines.ts; null where the step gives its own (Homebrew, winget, a plugin). */
  install: InstallTool | null;
  /** The folders its installer puts it in, on each system it's needed on. */
  places: Partial<Record<InstallSystem, readonly string[]>>;
  /** The maker's page it was checked against, and the date that page was read. */
  source: { page: string; read: string };
}

const BREW_BIN = ['/opt/homebrew/bin', '/usr/local/bin'];
const READ = '2026-10-27';
const EVERY: readonly InstallSystem[] = ['mac', 'windows', 'linux'];

/** Every need, in Setup's order. */
export const MACHINE_NEEDS: readonly MachineNeed[] = [
  {
    step: 'A1.brew', name: 'Homebrew', program: { mac: 'brew' }, min: null,
    why: 'On a Mac, git, Node, the GitHub CLI, Claude Code, Java and Python are installed with Homebrew.',
    systems: ['mac'], install: null,
    // Apple silicon, then Intel: the two prefixes Homebrew's installer uses.
    places: { mac: BREW_BIN },
    source: { page: 'https://docs.brew.sh/Installation', read: READ },
  },
  {
    step: 'A1.winget', name: 'winget (App Installer)', program: { windows: 'winget' }, min: null,
    why: 'On Windows, git, Node, the GitHub CLI, Java and Python are installed with winget, which comes in Microsoft\'s App Installer.',
    systems: ['windows'], install: null,
    places: { windows: ['{LOCALAPPDATA}\\Microsoft\\WindowsApps'] },
    source: { page: 'https://learn.microsoft.com/en-us/windows/package-manager/winget/', read: READ },
  },
  {
    step: 'A1.git', name: 'git', program: { mac: 'git', windows: 'git', linux: 'git' }, min: '2.40',
    why: 'Worktrees and the shared git directory need a recent git. On Windows, Git for Windows also brings the sh acc runs command lines with.',
    systems: EVERY, install: 'git',
    places: { mac: BREW_BIN, windows: ['{ProgramFiles}\\Git\\cmd', '{LOCALAPPDATA}\\Programs\\Git\\cmd'], linux: ['/usr/bin', '/usr/local/bin'] },
    source: { page: 'https://git-scm.com/install/windows', read: READ },
  },
  {
    // Not a program on PATH: the sh beside Git for Windows' git (T-123), found from git --exec-path.
    step: 'A1.sh', name: 'Git for Windows\' sh', program: {}, min: null,
    why: 'acc runs a project\'s check commands, and every other command line, with the sh that Git for Windows ships (D-209). Windows has no sh of its own.',
    systems: ['windows'], install: 'git',
    places: { windows: ['{ProgramFiles}\\Git\\usr\\bin', '{ProgramFiles}\\Git\\bin'] },
    source: { page: 'https://gitforwindows.org', read: READ },
  },
  {
    step: 'A1.node', name: 'Node', program: { mac: 'node', windows: 'node', linux: 'node' }, min: '20',
    why: 'The Salesforce CLI and its plugins run on Node, and npm installs them. The Command Center itself doesn\'t need it.',
    systems: EVERY, profiles: ['salesforce'], install: 'node',
    places: { mac: BREW_BIN, windows: ['{ProgramFiles}\\nodejs'], linux: ['/usr/bin', '/usr/local/bin'] },
    source: { page: 'https://nodejs.org/en/download', read: READ },
  },
  {
    step: 'A1.npm', name: 'npm', program: { mac: 'npm', windows: 'npm', linux: 'npm' }, file: { windows: 'npm.cmd' }, min: null,
    why: 'npm installs the Salesforce CLI. It comes with Node.',
    systems: EVERY, profiles: ['salesforce'], install: 'node',
    places: { mac: BREW_BIN, windows: ['{ProgramFiles}\\nodejs'], linux: ['/usr/bin', '/usr/local/bin'] },
    source: { page: 'https://nodejs.org/en/download', read: READ },
  },
  {
    step: 'A1.gh', name: 'the GitHub CLI', program: { mac: 'gh', windows: 'gh', linux: 'gh' }, min: null,
    why: 'Pull requests, issues and the per-repo account all go through gh.',
    systems: EVERY, install: 'gh',
    places: { mac: BREW_BIN, windows: ['{ProgramFiles}\\GitHub CLI', '{LOCALAPPDATA}\\Microsoft\\WinGet\\Links'], linux: ['/usr/bin', '/usr/local/bin'] },
    source: { page: 'https://github.com/cli/cli#installation', read: READ },
  },
  {
    step: 'A1.claude', name: 'Claude Code', program: { mac: 'claude', windows: 'claude', linux: 'claude' }, min: null,
    why: 'Builders run as `claude --bg` sessions (D-009). The VSCode extension ships its own copy, so the terminal CLI can fall far behind.',
    systems: EVERY, install: 'claude',
    // Homebrew's cask, then the native installer's folder, on each system.
    places: { mac: [...BREW_BIN, '{HOME}/.local/bin'], windows: ['{USERPROFILE}\\.local\\bin'], linux: ['{HOME}/.local/bin'] },
    source: { page: 'https://code.claude.com/docs/en/setup', read: READ },
  },
  {
    step: 'A1.sf', name: 'the Salesforce CLI', program: { mac: 'sf', windows: 'sf', linux: 'sf' }, file: { windows: 'sf.cmd' }, min: null,
    why: 'Validation, retrieves and org checks use sf.',
    systems: EVERY, profiles: ['salesforce'], install: 'sf',
    // npm's global folder, where `npm install -g` puts it; Salesforce's own Windows installer's folder.
    places: { mac: ['{npm}', ...BREW_BIN], windows: ['{npm}', '{APPDATA}\\npm', '{ProgramFiles}\\sf\\bin'], linux: ['{npm}', '/usr/local/bin'] },
    source: { page: 'https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_install_cli.htm', read: READ },
  },
  {
    // A plugin of sf's, not a program: it's found in `sf plugins`.
    step: 'A1.code-analyzer', name: 'Salesforce Code Analyzer', program: {}, min: '5.0',
    why: 'The `static` check runs `sf code-analyzer`, Code Analyzer 5.',
    systems: EVERY, profiles: ['salesforce'], install: null, places: {},
    source: { page: 'https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/setup.html', read: READ },
  },
  {
    step: 'A1.java', name: 'Java', program: { mac: 'java', windows: 'java', linux: 'java' }, versionArgs: ['-version'], min: '11',
    why: 'Code Analyzer\'s PMD and CPD engines run on a Java Development Kit, version 11 or later, as Salesforce\'s Code Analyzer setup page says.',
    systems: EVERY, profiles: ['salesforce'], install: 'java',
    places: {
      mac: ['/Library/Java/JavaVirtualMachines/*/Contents/Home/bin', '/opt/homebrew/opt/openjdk/bin'],
      windows: ['{ProgramFiles}\\Eclipse Adoptium\\*\\bin', '{ProgramFiles}\\Java\\*\\bin', '{ProgramFiles}\\Microsoft\\*\\bin'],
      linux: ['/usr/lib/jvm/*/bin', '/usr/bin'],
    },
    source: { page: 'https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/setup.html', read: READ },
  },
  {
    step: 'A1.python', name: 'Python', program: { mac: 'python3', windows: 'python', linux: 'python3' }, min: '3.10',
    why: 'Code Analyzer\'s Flow engine runs on Python 3.10 or later, as Salesforce\'s Code Analyzer setup page says. Without it, that engine is turned off in code-analyzer.yml.',
    systems: EVERY, profiles: ['salesforce'], install: 'python',
    places: {
      mac: [...BREW_BIN, '/Library/Frameworks/Python.framework/Versions/*/bin'],
      windows: ['{LOCALAPPDATA}\\Python\\bin', '{LOCALAPPDATA}\\Microsoft\\WindowsApps', '{LOCALAPPDATA}\\Programs\\Python\\*'],
      linux: ['/usr/bin', '/usr/local/bin'],
    },
    source: { page: 'https://docs.python.org/3/using/windows.html', read: READ },
  },
];

/** The need a step checks. Throws for a step that has none, so a typo fails when the steps load. */
export function needOf(step: string): MachineNeed {
  const n = MACHINE_NEEDS.find((x) => x.step === step);
  if (!n) throw new Error(`No machine need for ${step}`);
  return n;
}

/** What a system needs for a profile, in Setup's order. */
export const needsFor = (system: InstallSystem, profile: Profile): MachineNeed[] =>
  MACHINE_NEEDS.filter((n) => n.systems.includes(system) && (!n.profiles || n.profiles.includes(profile)));

/** The program a need looks for on a system, or null when it isn't one (a plugin, Git's sh) or isn't needed there. */
export const programOn = (need: MachineNeed, system: InstallSystem): string | null => need.program[system] ?? null;

/** The file name of a need's program in an install place: its own name, with .exe on Windows unless the need names one. */
export function fileOn(need: MachineNeed, system: InstallSystem): string | null {
  const program = programOn(need, system);
  if (!program) return null;
  return need.file?.[system] ?? (system === 'windows' ? `${program}.exe` : program);
}
