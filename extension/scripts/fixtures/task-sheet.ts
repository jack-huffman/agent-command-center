/**
 * The task sheet (T-74), as the extension sends it, in the sample project with its environments: a new
 * task; a manual task kept by acc, filled in with notes for the builder; and ACME-19, a Jira task in rework, whose ticket owns
 * its title, description, dependencies and labels.
 */
import { taskSheet, type TaskSheet, type TaskSheetInput } from '../../src/model/task-sheet.ts';
import { sampleHub } from './hub.ts';
import { ROOT } from './shared.ts';

export type TaskSheetSample = 'new' | 'manual' | 'tracker';

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
  return {
    ...base,
    task: {
      id: row.id, title: row.title, state: row.state as 'rework', environment: row.environment, deps: row.deps, labels: ['email'],
      brief: 'New customers get the welcome email twice when their account is created from a lead. They should get it once.',
      notes: '', source: { kind: 'jira', key: row.id, url: `https://acme.atlassian.net/browse/${row.id}` },
    },
  };
}

export const sampleTaskSheet = (now: number, which: TaskSheetSample): TaskSheet => taskSheet(sampleTaskSheetInput(now, which))!;
