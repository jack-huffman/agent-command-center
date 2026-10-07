/** Setup's steps, as acc doctor reports them. */
import { STEPS } from '../../../packages/core/src/onboarding/steps.ts';
import type { DoctorItem } from '../../src/logic/setup.ts';

/** Every real setup step, mostly passing, with one of each other status so every style shows. */
export function sampleSetup(): { items: DoctorItem[]; confirmed: Set<string> } {
  const odd: Record<string, Partial<DoctorItem>> = {
    'A4.plugin': {
      status: 'fail', detail: 'acc isn\'t installed in Claude Code, and its marketplace isn\'t added.',
      fix: 'claude plugin marketplace add https://github.com/jack-huffman/agent-command-center && claude plugin install acc@agent-command-center --scope user',
    },
    'B0.template': {
      status: 'unknown', detail: 'ACME tools has changed since this project was made from it, and this project differs on gates.required, agents.max. The fix previews what it would write, and changes nothing.',
      fix: 'acc init --from \'~/acme/acc-templates/tools.json\' --profile generic --dry-run',
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
