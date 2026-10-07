/** Updates acc drafted for tickets (D-066), and an edit a task page holds for one (GH-46). */
import type { Update } from '../../../packages/core/src/updates.ts';
import { MIN } from './shared.ts';

/**
 * Updates acc drafted for tickets, for a person to post (D-066): ACME-12's pull request is ready for
 * review, ACME-10 went out to QA and its promotion to Production is open (D-075), and one of ACME-21's
 * questions was drafted for the client. ACME-15's was posted. ACME-12's pull request was updated before anyone posted, so its draft replaced the first,
 * with a newer summary (GH-46).
 */
export function sampleUpdates(now = Date.now()): Update[] {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const jira = (task: string) => ({ v: 1 as const, task, tracker: 'jira' as const, key: task, url: `https://acme.atlassian.net/browse/${task}` });
  return [
    { ...jira('ACME-15'), id: 'ACME-15.1', event: 'pr-opened', state: 'posted', pr: { number: 42, url: 'https://github.com/acme/service/pull/42' }, text: 'The change is ready for review: https://github.com/acme/service/pull/42\nThe Region picklist shows the new names on both record types.', createdAt: at(92), by: 'orchestrator:autopilot', posted: { at: at(80), by: 'human:jordan', text: 'Ready for review: https://github.com/acme/service/pull/42' } },
    { ...jira('ACME-10'), id: 'ACME-10.2', event: 'deployed', state: 'draft', env: 'QA', text: 'The change is now deployed to QA.', createdAt: at(50), by: 'human:jordan' },
    { ...jira('ACME-10'), id: 'ACME-10.3', event: 'promotion-opened', state: 'draft', env: 'Production', pr: { number: 48, url: 'https://github.com/acme/service/pull/48' }, text: 'The change is ready to go to Production: https://github.com/acme/service/pull/48', createdAt: at(30), by: 'human:jordan' },
    { ...jira('ACME-12'), id: 'ACME-12.2', event: 'pr-opened', state: 'draft', pr: { number: 38, url: 'https://github.com/acme/service/pull/38' }, text: 'The change is ready for review: https://github.com/acme/service/pull/38\nPremium-tier cases now move to the Tier 2 queue when they miss their response time, using the Premium Support business hours, and the account owner and the support lead hear about each one.', createdAt: at(20), by: 'acc land', replaces: ['ACME-12.1'] },
    { ...jira('ACME-21'), id: 'ACME-21.1', event: 'question', state: 'draft', question: 'q1', text: 'Before we start, a question for you:\nShould every converted contact get a role on the new opportunity, or only the lead\'s primary contact?', createdAt: at(8), by: 'human:jordan' },
  ];
}

/**
 * What ACME-12's task page holds (GH-46): an edit typed for its first draft, before the pull request was
 * updated and acc drafted it again, and the text that draft said.
 */
export const SAMPLE_EDIT = {
  id: 'ACME-12.1',
  base: 'The change is ready for review: https://github.com/acme/service/pull/38\nPremium-tier cases now move to the Tier 2 queue when they miss their response time, using the Premium Support business hours, and the account owner hears about each one.',
  text: 'Hi Dana, the escalation change is ready for you to review: https://github.com/acme/service/pull/38\nPremium-tier cases now move to the Tier 2 queue when they miss their response time, and the account owner hears about each one. Could you look before Thursday\'s release meeting?',
};

/** The edit an open task page holds for an update, as the extension tells the Overview (GH-46). */
export const sampleEdited = (_root: string, id: string, replaces: string[]): string | null => ([id, ...replaces].includes(SAMPLE_EDIT.id) ? SAMPLE_EDIT.text : null);
