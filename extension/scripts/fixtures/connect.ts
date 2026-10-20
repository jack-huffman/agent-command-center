/** The Connect page (GH-51) at each of its steps. */
import { AZURE, GITHUB, JIRA, jiraSprintOptions, MONDAY, SLACK } from '../../../packages/core/src/trackers/connect.ts';
import { blankConnect, connectModel, type ConnectModel, type ConnectState } from '../../src/model/connect.ts';
import { ROOT } from './shared.ts';

/** A picker that has loaded its options, with these picked. */
const ready = (options: ConnectState['pickers'][string]['options'], selected: string[] = []): ConnectState['pickers'][string] => ({ options, selected, state: 'ready', error: null });
/** The Jira projects and boards the samples offer. */
const PROJECTS = [{ value: 'ACME', label: 'ACME', detail: 'Acme Service Desk' }, { value: 'OPS', label: 'OPS', detail: 'Operations' }];
const BOARDS = [{ value: '7', label: 'ACME Service board', detail: 'scrum', preferred: true }, { value: '9', label: 'Support kanban', detail: 'kanban' }];
/** The scrum board's sprints (T-78): the active one, and the next. */
const SPRINTS = jiraSprintOptions([
  { id: 13, name: 'ACME Sprint 13', state: 'active', start: '2026-10-20T09:00:00.000Z', end: '2026-11-02T17:00:00.000Z' },
  { id: 14, name: 'ACME Sprint 14', state: 'future', start: null, end: null },
]);

/** Which Connect page to draw (GH-51). */
export type ConnectSample = 'start' | 'shared' | 'jira' | 'azure' | 'github' | 'existing' | 'sprint' | 'monday' | 'slack' | 'slack-refused' | 'slack-channel' | 'epic' | 'epic-used' | 'epic-azure' | 'epic-github';

/**
 * The Connect page at each step: a new Jira tracker before signing in; its site given, with the tick for
 * every project on it (GH-79); signed in for every project on the site, its project picked, its epics
 * loading and its boards failing; Azure DevOps whose token was refused; GitHub with labels ticked; an
 * existing Jira tracker opened to change, signed in for this project only, its epic done now but kept; and
 * a monday.com board signed in for this project only, with Sign in again open, so its token field, token
 * page and the tick (off) show beside its board, group and two status columns (GH-70). A Slack workspace
 * with its token not typed yet, so no field warns (T-43), and then signed in as the app for every project on it, a channel picked
 * (T-29). The existing Jira tracker again, following the active sprint, picked from its board's sprints (T-78). Then a project
 * started from Setup (GH-81): from a Jira epic, signed in for every project on the site, its epics listed
 * and none picked yet; with an epic another repo here uses picked, marked; from an Azure DevOps area path
 * one over another repo's; and from GitHub labels, one of them another repo's.
 */
export function sampleConnect(which: ConnectSample): ConnectModel {
  const base = { root: ROOT, projectName: 'Acme Service', ownRepo: 'acme/service', ghAccount: 'jordan-kim', from: 'tasks' as const, gitEmail: 'jordan.kim@example.com' };
  const ok = (who: string): ConnectState['signIn'] => ({ state: 'ok', who, error: null, again: false });
  if (which === 'start') return connectModel(blankConnect(JIRA, { id: 'c-start', ...base }));
  if (which.startsWith('epic')) return sampleStart(which);
  if (which === 'shared') {
    const s = blankConnect(JIRA, { id: 'c-shared', ...base });
    s.host = 'acme.atlassian.net';
    return connectModel(s);
  }
  if (which === 'jira') {
    const s = blankConnect(JIRA, { id: 'c-jira', ...base });
    s.host = 'acme.atlassian.net';
    s.signIn = { ...ok('Jordan Kim'), shared: true };
    s.pickers.project = ready(PROJECTS, ['ACME']);
    s.pickers.epic = { options: [], selected: [], state: 'loading', error: null };
    s.pickers.board = { options: [], selected: [], state: 'failed', error: 'Jira answered HTTP 503: the service is unavailable.' };
    return connectModel(s);
  }
  if (which === 'azure') {
    const s = blankConnect(AZURE, { id: 'c-azure', ...base });
    s.host = 'acme';
    s.method = 'pat';
    s.fieldErrors = { token: 'Azure DevOps (acme) didn\'t accept this sign-in. Check the token has Work Items: Read & write, and hasn\'t expired.' };
    s.signIn = { state: 'failed', who: null, error: null, again: false };
    return connectModel(s);
  }
  if (which === 'github') {
    const s = blankConnect(GITHUB, { id: 'c-github', ...base });
    s.signIn = ok('jordan-kim');
    s.pickers.labels = ready(['billing', 'bug', 'documentation', 'enhancement', 'good first issue', 'invoices', 'milestone', 'question'].map((l) => ({ value: l, label: l })), ['billing', 'invoices']);
    return connectModel(s);
  }
  if (which === 'slack') {
    const s = blankConnect(SLACK, { id: 'c-slack', ...base });
    s.host = 'acme';
    return connectModel(s);
  }
  // A user token (xoxp-) typed, and Test connection clicked: the field warns and the sign-in is not signed in (T-45).
  if (which === 'slack-refused') {
    const s = blankConnect(SLACK, { id: 'c-slack-refused', ...base });
    s.host = 'acme';
    s.fields = { token: 'xoxp-1234-5678-notabottoken' };
    s.fieldErrors = { token: SLACK.methods[0]!.fields![0]!.check!(s.fields.token!) ?? '' };
    s.signIn = { state: 'failed', who: null, error: null, again: false };
    return connectModel(s);
  }
  if (which === 'slack-channel') {
    const s = blankConnect(SLACK, { id: 'c-slack-channel', ...base });
    s.host = 'acme';
    s.signIn = { ...ok('Acme Command Center'), shared: true };
    s.pickers.channel = ready([
      { value: 'G0BILLING1', label: '#billing', detail: 'private' },
      { value: 'C0ESCALATE', label: '#premium-support-escalations-and-renewals', detail: 'public' },
      { value: 'C0SUPPORT1', label: '#premium-support', detail: 'public' },
    ], ['C0SUPPORT1']);
    return connectModel(s);
  }
  if (which === 'monday') {
    const s = blankConnect(MONDAY, { id: 'c-monday', ...base });
    s.host = 'acme';
    s.signIn = { ...ok('Jordan Kim'), again: true, shared: false };
    s.share = false;
    s.pickers.board = ready([{ value: '1234567890', label: 'Client work', detail: 'Acme' }, { value: '1234567999', label: 'Approvals', detail: 'Main workspace' }], ['1234567890']);
    s.pickers.group = ready([{ value: 'topics', label: 'This sprint' }, { value: 'new_group29179', label: 'Backlog' }], ['topics']);
    s.pickers.statusColumn = ready([{ value: 'status', label: 'Status', detail: 'Not started, Working on it, Stuck, Done', default: true }, { value: 'priority', label: 'Priority', detail: 'High, Medium, Low' }], ['status']);
    return connectModel(s);
  }
  if (which === 'sprint') {
    const s = blankConnect(JIRA, { id: 'c-sprint', ...base, existing: { index: 0, title: 'Jira · ACME', host: 'acme.atlassian.net', values: { project: 'ACME', epic: null, board: '7', sprint: 'active' } } });
    s.signIn = { ...ok('Jordan Kim'), shared: true };
    s.pickers.project = ready([], ['ACME']);
    s.pickers.epic = ready([{ value: 'ACME-31', label: 'ACME-31', detail: 'Renewals' }, { value: 'ACME-30', label: 'ACME-30', detail: 'Partner portal' }]);
    s.pickers.board = ready(BOARDS, ['7']);
    s.pickers.sprint = ready(SPRINTS, ['active']);
    return connectModel(s);
  }
  const s = blankConnect(JIRA, { id: 'c-existing', ...base, existing: { index: 0, title: 'Jira · ACME', host: 'acme.atlassian.net', values: { project: 'ACME', epic: 'ACME-3', board: '7' } } });
  s.signIn = { ...ok('Jordan Kim'), shared: false };
  s.pickers.project = ready([], ['ACME']);
  s.pickers.epic = ready([{ value: 'ACME-31', label: 'ACME-31', detail: 'Renewals' }, { value: 'ACME-30', label: 'ACME-30', detail: 'Partner portal' }], ['ACME-3']);
  s.pickers.board = ready(BOARDS, ['7']);
  s.pickers.sprint = ready(SPRINTS);
  return connectModel(s);
}

/** A project started from Setup's "From a Jira epic…" (GH-81), at each of its kinds. */
function sampleStart(which: ConnectSample): ConnectModel {
  const base = { root: '/Users/me/code/acme-renewals', projectName: 'acme-renewals', ownRepo: 'acme/renewals', ghAccount: 'jordan-kim', from: 'setup' as const, gitEmail: 'jordan.kim@example.com', start: true };
  if (which === 'epic-azure') {
    const s = blankConnect(AZURE, { id: 'c-epic-azure', ...base });
    s.host = 'acme';
    s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false, shared: true };
    s.pickers.project = ready([{ value: 'CRM', label: 'CRM' }], ['CRM']);
    s.pickers.team = ready([{ value: 'CRM Team', label: 'CRM Team', detail: 'default team', default: true }, { value: 'Billing', label: 'Billing' }], ['CRM Team']);
    s.pickers.board = ready([{ value: 'Epics', label: 'Epics' }, { value: 'Stories', label: 'Stories', preferred: true }], ['Stories']);
    s.pickers.areaPath = ready([
      { value: 'CRM\\Billing', label: 'CRM\\Billing', usedBy: 'overlaps crm-everything' },
      { value: 'CRM\\Billing\\Renewals', label: 'CRM\\Billing\\Renewals', usedBy: 'overlaps crm-everything' },
      { value: 'CRM\\Sales', label: 'CRM\\Sales' },
    ], ['CRM\\Billing\\Renewals']);
    return connectModel(s);
  }
  if (which === 'epic-github') {
    const s = blankConnect(GITHUB, { id: 'c-epic-github', ...base });
    s.signIn = { state: 'ok', who: 'jordan-kim', error: null, again: false };
    s.pickers.labels = ready(['billing', 'bug', 'documentation', 'enhancement', 'invoices', 'renewals'].map((l) => ({ value: l, label: l, ...(l === 'billing' ? { usedBy: 'used by acme-billing' } : {}) })), ['billing', 'renewals']);
    return connectModel(s);
  }
  const s = blankConnect(JIRA, { id: `c-${which}`, ...base });
  s.host = 'acme.atlassian.net';
  s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false, shared: true };
  s.pickers.project = ready(PROJECTS, ['ACME']);
  s.pickers.epic = ready([
    { value: 'ACME-31', label: 'ACME-31', detail: 'Renewals' },
    { value: 'ACME-30', label: 'ACME-30', detail: 'Partner portal', usedBy: 'used by acme-portal' },
    { value: 'ACME-12', label: 'ACME-12', detail: 'Single sign-on for the customer portal and the partner portal' },
  ], which === 'epic-used' ? ['ACME-30'] : []);
  s.pickers.board = ready(BOARDS, ['7']);
  s.pickers.sprint = ready(SPRINTS);
  return connectModel(s);

}
