/** Setup's steps, as acc doctor reports them. */
import { installCommand } from '../../../packages/core/src/onboarding/install-lines.ts';
import { STEPS } from '../../../packages/core/src/onboarding/steps.ts';
import type { DoctorItem } from '../../src/logic/setup.ts';

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
