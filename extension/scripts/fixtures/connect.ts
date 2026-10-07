/** The Connect page (GH-51) at each of its steps. */
import { AZURE, GITHUB, JIRA, MONDAY } from '../../../packages/core/src/trackers/connect.ts';
import { blankConnect, connectModel, type ConnectModel, type ConnectState } from '../../src/model/connect.ts';

/** Which Connect page to draw (GH-51). */
export type ConnectSample = 'start' | 'shared' | 'jira' | 'azure' | 'github' | 'existing' | 'monday';

/**
 * The Connect page at each step: a new Jira tracker before signing in; its site given, with the tick for
 * every project on it (GH-79); signed in for every project on the site, its project picked, its epics
 * loading and its boards failing; Azure DevOps whose token was refused; GitHub with labels ticked; an
 * existing Jira tracker opened to change, signed in for this project only, its epic done now but kept; and
 * a monday.com board signed in for this project only, with Sign in again open, so its token field, token
 * page and the tick (off) show beside its board, group and two status columns (GH-70).
 */
export function sampleConnect(which: ConnectSample): ConnectModel {
  const root = '/Users/me/code/acme-service';
  const base = { root, projectName: 'Acme Service', ownRepo: 'acme/service', ghAccount: 'jordan-kim', from: 'tasks' as const, gitEmail: 'jordan.kim@example.com' };
  const ready = (options: ConnectState['pickers'][string]['options'], selected: string[] = []): ConnectState['pickers'][string] => ({ options, selected, state: 'ready', error: null });
  const ok = (who: string): ConnectState['signIn'] => ({ state: 'ok', who, error: null, again: false });
  const projects = [{ value: 'ACME', label: 'ACME', detail: 'Acme Service Desk' }, { value: 'OPS', label: 'OPS', detail: 'Operations' }];
  const boards = [{ value: '7', label: 'ACME Service board', detail: 'scrum', preferred: true }, { value: '9', label: 'Support kanban', detail: 'kanban' }];
  if (which === 'start') return connectModel(blankConnect(JIRA, { id: 'c-start', ...base }));
  if (which === 'shared') {
    const s = blankConnect(JIRA, { id: 'c-shared', ...base });
    s.host = 'acme.atlassian.net';
    return connectModel(s);
  }
  if (which === 'jira') {
    const s = blankConnect(JIRA, { id: 'c-jira', ...base });
    s.host = 'acme.atlassian.net';
    s.signIn = { ...ok('Jordan Kim'), shared: true };
    s.pickers.project = ready(projects, ['ACME']);
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
  const s = blankConnect(JIRA, { id: 'c-existing', ...base, existing: { index: 0, title: 'Jira · ACME', host: 'acme.atlassian.net', values: { project: 'ACME', epic: 'ACME-3', board: '7' } } });
  s.signIn = { ...ok('Jordan Kim'), shared: false };
  s.pickers.project = ready([], ['ACME']);
  s.pickers.epic = ready([{ value: 'ACME-31', label: 'ACME-31', detail: 'Renewals' }, { value: 'ACME-30', label: 'ACME-30', detail: 'Partner portal' }], ['ACME-3']);
  s.pickers.board = ready(boards, ['7']);
  return connectModel(s);
}
