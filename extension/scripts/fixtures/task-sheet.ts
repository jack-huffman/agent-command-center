/**
 * The task sheet (T-74), as the extension sends it, in the sample project with its environments: a new
 * task; a manual task kept by acc, filled in with notes for the builder; and ACME-19, a Jira task in rework, whose ticket owns
 * its title, description, dependencies and labels. With edits on (T-80), ACME-19's sheet has its ticket's
 * title and description to edit, and its status, assignee and labels to change; and the ticket's text a
 * colleague wrote after the sheet opened, which Save stops on.
 */
import { taskSheet, type TaskSheet, type TaskSheetInput } from '../../src/model/task-sheet.ts';
import type { TicketTextBase } from '../../src/model/ticket-text.ts';
import { sampleHub } from './hub.ts';
import { ROOT } from './shared.ts';

export type TaskSheetSample = 'new' | 'manual' | 'tracker' | 'edits';

/** What the extension makes the sheet from, for each sample. */
export function sampleTaskSheetInput(now: number, which: TaskSheetSample): TaskSheetInput {
  const project = sampleHub(now).projects[0]!;
  const base = { project: ROOT, name: project.name, environments: project.config.environments };
  if (which === 'new') return { ...base, task: null };
  if (which === 'manual') {
    return {
      ...base,
      task: {
        id: 'T-4', title: 'Write the release notes for the spring update', state: 'todo', environment: 'dev', deps: ['ACME-16', 'ACME-19'], labels: ['docs', 'release'],
        brief: '## Goal\n\nOne page that says what changed for the sales team.\n\n- What each new field does\n- Which reports moved\n- Who to ask',
        notes: 'Keep it under a page. The sales team reads it on their phones.',
        source: { kind: 'manual', key: null, url: null },
      },
    };
  }
  // ACME-19, in rework, as its tab shows it under the sheet.
  const row = sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-19')!;
  const tracker: TaskSheetInput = {
    ...base,
    task: {
      id: row.id, title: row.title, state: row.state as 'rework', environment: row.environment, deps: row.deps, labels: ['email'],
      brief: 'New customers get the welcome email twice when their account is created from a lead. They should get it once.',
      notes: '', source: { kind: 'jira', key: row.id, url: `https://acme.atlassian.net/browse/${row.id}` },
    },
  };
  if (which === 'tracker') return tracker;
  // Edits on (T-80): the ticket as the sheet read it when it opened, which its tab shows under it.
  return {
    ...tracker,
    ticket: {
      edits: true, kind: 'jira', error: null,
      ticket: {
        title: row.title, markdown: 'New contacts get the welcome email twice when the flow runs again within a day. Send it once.',
        status: { id: '3', name: 'In Progress', category: 'doing' }, assignees: [{ id: 'a1', name: 'Jordan Kim' }], labels: [{ name: 'marketing', color: null }],
      },
    },
  };
}

export const sampleTaskSheet = (now: number, which: TaskSheetSample): TaskSheet => taskSheet(sampleTaskSheetInput(now, which))!;

/** ACME-19's ticket as a colleague left it after the sheet opened (T-80): Save stops, and shows it beside what the person wrote. */
export const SAMPLE_THEIRS: TicketTextBase = {
  title: 'Send the welcome email once per new contact',
  markdown: 'New contacts get the welcome email twice when the flow runs again within a day.\n\nSend it once, and log the second run so support can see it.',
};
