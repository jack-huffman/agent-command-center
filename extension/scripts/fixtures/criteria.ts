/**
 * ACME-19's drafted acceptance criteria (T-81): what the drafter wrote from its ticket, two comments and
 * the code, and the same draft as an update a person opened, to edit and post as a comment.
 */
import { type CriteriaDraft, criteriaMarkdown, criteriaSection } from '../../../packages/core/src/criteria.ts';
import type { Update } from '../../../packages/core/src/updates.ts';
import { MIN } from './shared.ts';

const PARTS = {
  criteria: [
    'A new contact gets the welcome email one time.',
    'The flow sends no second welcome email when it runs again within 24 hours.',
    'A contact that got the welcome email before this change gets no second email.',
  ],
  steps: [
    'Make a contact from a lead. The contact gets one welcome email.',
    'Run the flow again on that contact within 24 hours. No email goes out.',
    'Open a contact that got the email last month. Run the flow. No email goes out.',
  ],
  edgeCases: [
    'The email service fails. The contact shows no sent mark, and the next run sends the email.',
    'Two runs start at the same second. The contact gets one email.',
    'A person clears the contact\'s email address. The flow sends nothing and records why.',
  ],
  questions: ['Must a contact that changes its email address get the welcome email again?'],
};

export function sampleCriteria(now: number): CriteriaDraft {
  return {
    v: 1, task: 'ACME-19', key: 'ACME-19', ...PARTS, markdown: criteriaMarkdown(PARTS), wording: [],
    read: { comments: 2, related: 1, full: true }, sessionId: 'cr-acme-19', name: 'Acme Service · ACME-19 · criteria',
    at: new Date(now - 12 * MIN).toISOString(), durationMs: 94_000, costUsd: null,
  };
}

/** The draft as an update a person opened (T-81), waiting to be edited and posted. */
export function sampleCriteriaUpdate(now: number): Update {
  return {
    v: 1, id: 'ACME-19.1', task: 'ACME-19', tracker: 'jira', key: 'ACME-19', url: 'https://acme.atlassian.net/browse/ACME-19', event: 'criteria', state: 'draft',
    text: criteriaSection(criteriaMarkdown(PARTS)), createdAt: new Date(now - 6 * MIN).toISOString(), by: 'human:jordan',
  };
}
