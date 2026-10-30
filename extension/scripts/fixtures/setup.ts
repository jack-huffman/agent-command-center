/** Setup's steps, as acc doctor reports them. */
import { installCommand } from '../../../packages/core/src/onboarding/install-lines.ts';
import { STEPS } from '../../../packages/core/src/onboarding/steps.ts';
import { brewShellenv } from '../../../packages/core/src/onboarding/path-fix.ts';
import type { DoctorItem } from '../../src/logic/setup.ts';
import { setupModel, type SetupStarting } from '../../src/model/setup.ts';
import type { WalkPlace } from '../../src/model/setup-walk.ts';

/** A Mac tool in Homebrew's folder but not on VSCode's PATH, as A1's steps say it (T-133). */
const NOT_ON_PATH = (name: string): Partial<DoctorItem> => ({
  place: '/opt/homebrew/bin', fix: brewShellenv('/opt/homebrew/bin'),
  detail: `${name} is installed in /opt/homebrew/bin, but VSCode can't see it: that folder isn't on its PATH. Do it adds Homebrew's shellenv line to ~/.zprofile, then quit VSCode and open it again.`,
  ask: 'Add Homebrew\'s shellenv line to ~/.zprofile, so /opt/homebrew/bin is on your PATH? Then quit VSCode and open it again.',
});

/**
 * A Salesforce project being started (T-133): the machine check found the GitHub CLI missing and Claude Code
 * installed but not on PATH, so Setup lists them first, before anything is written.
 */
export function sampleStartingSetup(): { items: DoctorItem[]; confirmed: Set<string>; setUp: false; starting: SetupStarting } {
  const todo: Record<string, Partial<DoctorItem>> = {
    'A1.gh': { status: 'fail', detail: 'gh isn\'t installed.', fix: installCommand('gh', 'mac')! },
    'A1.claude': { status: 'fail', ...NOT_ON_PATH('Claude Code') },
  };
  const items = STEPS.filter((s) => s.part === 'machine').map((s): DoctorItem => ({ id: s.id, part: s.part, title: s.title, status: 'pass', detail: 'Looks right.', ...todo[s.id] }));
  return { items, confirmed: new Set(), setUp: false, starting: { profile: 'salesforce', ids: items.map((i) => i.id) } };
}

/** Every real setup step, mostly passing, with one of each other status so every style shows. */
export function sampleSetup(): { items: DoctorItem[]; confirmed: Set<string> } {
  const odd: Record<string, Partial<DoctorItem>> = {
    'A4.plugin': {
      status: 'fail', detail: 'The plugin isn\'t installed in Claude Code, and its marketplace isn\'t added.',
      fix: 'claude plugin marketplace add https://github.com/jack-huffman/agent-command-center && claude plugin install acc@agent-command-center --scope user',
    },
    'B0.template': {
      status: 'unknown', detail: 'ACME tools has changed since this project was made from it, and this project differs on gates.required, agents.max. The fix previews what it would write, and changes nothing.',
      fix: 'acc init --from \'~/acme/acc-templates/tools.json\' --profile generic --dry-run',
    },
    'B0.rules': {
      status: 'unknown', detail: '.acc/rules/acme-salesforce.md has changed at the source since it was copied in. The fix shows the difference and changes nothing; copying one in again is yours to choose.',
      fix: 'acc rules diff acme-salesforce',
    },
    // Installed, but not on VSCode's PATH (T-133): its own look, and Do it asks before it changes PATH.
    'A1.python': { status: 'fail', ...NOT_ON_PATH('Python') },
    'B2.identity': { status: 'fail', detail: 'Commits here would go out as someone@else.example.', fix: 'git config user.email you@example.com' },
    'B8.tracking': { status: 'unknown', detail: 'Turn on source tracking in Setup, then check again.' },
    'B10.readme': { status: 'skip', detail: 'Only one environment, so there is no map to show.' },
    'B6.org-match': { status: 'fail', detail: '"Acme Dev" is logged in to a different org than the dev branch names.' },
    'B13.gate-tools': { status: 'fail', detail: 'The format and lint checks need npm install first.', fix: 'npm install' },
    'B14.tickets': { status: 'fail', detail: 'Tickets come from Azure DevOps CRM in acme. This repo isn\'t signed in to Azure DevOps · CRM yet.', fix: 'acc.trackers.signIn' },
  };
  const items = STEPS.map((s): DoctorItem => ({ id: s.id, part: s.part, title: s.title, status: 'pass', detail: 'Looks right.', ...odd[s.id] }));
  if (!items.some((i) => i.id === 'A1.claude-billing')) items.push({ id: 'A1.claude-billing', part: 'machine', title: 'Agents bill your Claude subscription', status: 'pass', detail: 'Agents use your Claude subscription.' });
  return { items, confirmed: new Set() };
}

/**
 * Setup as it's first shown in a folder that isn't set up (GH-138): a folder of no profile yet, so only this
 * machine's steps are checked. Ready, every one passes and the page opens at what kind of project it is;
 * not, two are still to do, and it opens at the machine's part.
 */
export function sampleFirstSetup(machineReady: boolean): { items: DoctorItem[]; confirmed: Set<string>; setUp: false } {
  const todo: Record<string, Partial<DoctorItem>> = machineReady ? {} : {
    'A1.gh': { status: 'fail', detail: 'gh isn\'t installed.', fix: installCommand('gh', 'mac')! },
    'A4.plugin': { status: 'fail', detail: 'The plugin isn\'t installed in Claude Code, and its marketplace isn\'t added.', fix: 'claude plugin marketplace add https://github.com/jack-huffman/agent-command-center && claude plugin install acc@agent-command-center --scope user' },
  };
  const items = STEPS.filter((s) => s.part === 'machine').map((s): DoctorItem => ({ id: s.id, part: s.part, title: s.title, status: 'pass', detail: 'Looks right.', ...todo[s.id] }));
  return { items, confirmed: new Set(), setUp: false };
}

/** The pages that draw Setup's walkthrough past its start screen (T-153). */
export const SETUP_WALK_PAGES = ['setup-walk-step', 'setup-walk-how', 'setup-walk-modal', 'setup-walk-end', 'setup-walk-chapters'] as const;

/**
 * Setup's walkthrough as the tab remembers it (T-153), over sampleSetup's steps: at a step with two skipped
 * before it; at the plugin's step with Show how open on its command line; at the tracker's step, whose Do it opens
 * Connect a tracker; at the end with every step skipped; and back at the start screen with a walk under way, one
 * step skipped, and every chapter opened to its steps. Null for any other page.
 */
export function setupWalkState(kind: string): { setupWalk: WalkPlace; opened?: string[]; sections?: Record<string, boolean> } | null {
  const s = sampleSetup();
  const chapters = setupModel(s.items, s.confirmed).chapters;
  const walk = chapters.flatMap((c) => c.steps).filter((x) => !x.done).map((x) => x.id);
  if (kind === 'setup-walk-step') return { setupWalk: { at: 'B6.org-match', walk, skipped: ['A1.python', 'B0.template'] } };
  if (kind === 'setup-walk-how') return { setupWalk: { at: 'A4.plugin', walk, skipped: [] }, opened: ['setup-how:A4.plugin'] };
  if (kind === 'setup-walk-modal') return { setupWalk: { at: 'B14.tickets', walk, skipped: [] } };
  if (kind === 'setup-walk-end') return { setupWalk: { at: 'end', walk, skipped: walk } };
  if (kind === 'setup-walk-chapters') return { setupWalk: { at: 'start', walk, skipped: ['A1.python'] }, sections: Object.fromEntries(chapters.map((c) => [c.key, true])) };
  return null;
}
