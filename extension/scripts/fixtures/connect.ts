/** The Connect page (GH-51) at each of its steps. */
import { AZURE, GITHUB, JIRA, jiraSprintOptions, MONDAY, reactionOptions, SLACK, type TrackerDescription } from '../../../packages/core/src/trackers/connect.ts';
import { countValues, placeKey } from '../../../packages/core/src/trackers/preview.ts';
import type { Board, StatusCategory, TrackerKind } from '../../../packages/core/src/trackers/types.ts';
import { blankConnect, connectModel, type ConnectModel, type ConnectState, connectValues } from '../../src/model/connect.ts';
import { connectChangesField } from '../../src/model/changes-field.ts';
import { ROOT } from './shared.ts';

/** A picker that has loaded its options, with these picked. */
const ready = (options: ConnectState['pickers'][string]['options'], selected: string[] = []): ConnectState['pickers'][string] => ({ options, selected, state: 'ready', error: null });
/** The Jira projects and boards the samples offer. */
const PROJECTS = [{ value: 'ACME', label: 'ACME', detail: 'Acme Service Desk' }, { value: 'OPS', label: 'OPS', detail: 'Operations' }];
const BOARDS = [{ value: '7', label: 'ACME Service board', detail: 'Scrum', preferred: true }, { value: '9', label: 'Support kanban', detail: 'Kanban' }];
/** The scrum board's sprints (T-78): the active one, and the next. */
const SPRINTS = jiraSprintOptions([
  { id: 13, name: 'ACME Sprint 13', state: 'active', start: '2026-10-20T09:00:00.000Z', end: '2026-11-02T17:00:00.000Z' },
  { id: 14, name: 'ACME Sprint 14', state: 'future', start: null, end: null },
]);

/** Which Connect page to draw (GH-51). */
export type ConnectSample = 'start' | 'shared' | 'jira' | 'azure' | 'github' | 'existing' | 'sprint' | 'monday' | 'slack' | 'slack-refused' | 'slack-channel' | 'epic' | 'epic-used' | 'epic-azure' | 'epic-github' | 'jira-board' | 'azure-board';

/** The tickets the sample boards hold (T-106), by title: a board takes as many as each column asks for, in turn. */
const TITLES = [
  'Renewal reminder emails go out 30 days before the end date', 'Renewal quote shows the new price list', 'Auto-renew can be turned off from the account page',
  'Partner sees their customers\' renewals', 'Renewals report for the account team', 'Grace period after a missed renewal', 'Renewal invoice carries the purchase order number',
  'Cancelled renewals are logged with a reason', 'Renewal price rises are capped at the contract rate', 'Renewal date moves with an upgrade', 'Multi-year renewals bill yearly',
  'A renewal can be approved by the partner', 'Renewal reminders stop once it\'s paid',
];

/**
 * A board as a tracker would give it (T-106): each column with this many tickets, of this kind's keys. The
 * preview draws it as the Tasks tab does.
 */
export function sampleBoard(kind: TrackerKind, title: string, columns: [string, StatusCategory, number][], prefix = 'ACME', first = 40): Board {
  let n = 0;
  const people = [{ id: 'jk', name: 'Jordan Kim' }, { id: 'ap', name: 'Avery Park' }];
  return {
    source: kind === 'azure' ? 'azure-board' : kind === 'github' ? 'github-state' : 'jira-board', title, url: null, notice: null, place: title,
    columns: columns.map(([name, category], i) => ({ id: `c${i}`, name, category, statusIds: [`s${i}`] })),
    cards: columns.flatMap(([name, category, count], i) => Array.from({ length: count }, () => {
      const t = n++;
      return {
        key: `${prefix}-${first + t}`, title: TITLES[t % TITLES.length]!, url: '', status: { id: `s${i}`, name, category }, type: t % 4 === 3 ? 'Bug' : 'Story', typeKind: t % 4 === 3 ? 'bug' as const : 'story' as const,
        typeColor: null, assignees: t % 3 === 2 ? [] : [people[t % 2]!], labels: t % 5 === 0 ? [{ name: 'renewals', color: null }] : [], priority: null, priorityLevel: null,
      };
    })),
  };
}

/** A board read for these choices (T-106): the preview's, or a card's count when it's one choice off. */
const read = (board: Board | null, state: 'ready' | 'loading' | 'failed' = 'ready', error: string | null = null): ConnectState['boards'][string] => ({ state, board, none: null, error });

/** Sets what each card's count read gives (T-106), for the choices made so far. */
function counted(s: ConnectState, d: TrackerDescription, key: string, reads: Record<string, ConnectState['boards'][string]>): void {
  const values = connectValues(s, d);
  for (const [value, r] of Object.entries(reads)) s.boards[placeKey(countValues(d.pickers, values, key, value))] = r;
}

/**
 * The Connect page at each step: a new Jira tracker before signing in; its site given, with the tick for
 * every project on it (GH-79); signed in for every project on the site, its project picked, its epics
 * loading and its boards failing; Azure DevOps whose token was refused; GitHub with labels ticked; an
 * existing Jira tracker opened to change, signed in for this project only, its epic done now but kept, with
 * the field its tickets' changes are kept in (T-105); and
 * a monday.com board signed in for this project only, with Sign in again open, so its token field, token
 * page and the tick (off) show beside its board, group and two status columns (GH-70). A Slack workspace
 * with its token not typed yet, so no field warns (T-43), and then signed in as the app for every project on it, a channel and its board's reactions picked
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
  if (which === 'jira-board' || which === 'azure-board') return sampleBoards(which);
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
    // Those labels hold no open issue (T-106): the preview says so, and what to change.
    s.boards[placeKey(connectValues(s, GITHUB))] = read(sampleBoard('github', 'Issues · acme/service', [['Open', 'todo', 0], ['Closed', 'done', 0]]));
    counted(s, GITHUB, 'labels', { '': read(sampleBoard('github', 'Issues · acme/service', [['Open', 'todo', 9], ['Closed', 'done', 3]])), bug: read(sampleBoard('github', 'Issues · acme/service', [['Open', 'todo', 4], ['Closed', 'done', 0]])) });
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
    // Its board's reactions (T-85): messages marked :ticket:, done with :white_check_mark:.
    s.pickers.reaction = ready(reactionOptions(), ['ticket']);
    s.pickers.doneReaction = ready(reactionOptions(), ['white_check_mark']);
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
    // The board couldn't be read (T-106): Use this board stays off, and Read it again is offered.
    s.boards[placeKey(connectValues(s, JIRA))] = read(null, 'failed', 'Jira answered HTTP 503: the service is unavailable.');
    return connectModel(s);
  }
  const s = blankConnect(JIRA, { id: 'c-existing', ...base, existing: { index: 0, title: 'Jira · ACME', host: 'acme.atlassian.net', values: { project: 'ACME', epic: 'ACME-3', board: '7' } } });
  s.signIn = { ...ok('Jordan Kim'), shared: false };
  s.pickers.project = ready([], ['ACME']);
  s.pickers.epic = ready([{ value: 'ACME-31', label: 'ACME-31', detail: 'Renewals' }, { value: 'ACME-30', label: 'ACME-30', detail: 'Partner portal' }], ['ACME-3']);
  s.pickers.board = ready(BOARDS, ['7']);
  s.pickers.sprint = ready(SPRINTS);
  // Its changes field (T-105): one row after its place, the field its settings name.
  return { ...connectModel(s), changesField: connectChangesField(s, [{ kind: 'jira', changesField: { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' } }], true) };
}

/**
 * Choosing a board by seeing it (T-106). Jira: signed in, ACME's boards as cards, the scrum one chosen with its
 * count and the kanban one's count failed; ten epics with a search over them, ACME-31 ticked, its tickets'
 * titles under each count and one still counting; the board's sprints; and the preview of ACME-31 on the scrum
 * board. Azure DevOps: CRM's teams, boards (each a backlog level) and area paths as cards, each counted, with
 * CRM\Billing ticked, and its board's preview.
 */
function sampleBoards(which: 'jira-board' | 'azure-board'): ConnectModel {
  const base = { root: ROOT, projectName: 'Acme Service', ownRepo: 'acme/service', ghAccount: 'jordan-kim', from: 'tasks' as const, gitEmail: 'jordan.kim@example.com' };
  if (which === 'azure-board') {
    const s = blankConnect(AZURE, { id: 'c-azure-board', ...base });
    s.host = 'acme';
    s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false, shared: true };
    s.pickers.project = ready([{ value: 'CRM', label: 'CRM' }], ['CRM']);
    s.pickers.team = ready([{ value: 'CRM Team', label: 'CRM Team', detail: 'default team', default: true }, { value: 'Billing', label: 'Billing' }], ['CRM Team']);
    s.pickers.board = ready([{ value: 'Epics', label: 'Epics', detail: 'Backlog level' }, { value: 'Stories', label: 'Stories', detail: 'Backlog level', preferred: true }], ['Stories']);
    s.pickers.areaPath = ready([{ value: 'CRM\\Billing', label: 'CRM\\Billing' }, { value: 'CRM\\Billing\\Renewals', label: 'CRM\\Billing\\Renewals' }, { value: 'CRM\\Sales', label: 'CRM\\Sales' }], ['CRM\\Billing']);
    const azure = (counts: number[]) => sampleBoard('azure', 'Stories · CRM Team', [['New', 'todo', counts[0]!], ['Active', 'doing', counts[1]!], ['Resolved', 'doing', counts[2]!], ['Closed', 'done', counts[3]!]], 'AB', 1200);
    counted(s, AZURE, 'team', { 'CRM Team': read(azure([9, 6, 3, 14])), Billing: read(azure([4, 2, 1, 7])) });
    counted(s, AZURE, 'board', { Epics: read(azure([2, 1, 0, 1])) });
    counted(s, AZURE, 'areaPath', { '': read(azure([9, 6, 3, 14])), 'CRM\\Billing': read(azure([5, 3, 2, 8])), 'CRM\\Billing\\Renewals': read(azure([2, 1, 1, 3])), 'CRM\\Sales': read(azure([4, 3, 1, 6])) });
    s.boards[placeKey(connectValues(s, AZURE))] = read(azure([5, 3, 2, 8]));
    return connectModel(s);
  }
  return connectModel(jiraBoards());
}

/**
 * The Jira page of sampleBoards (T-106) at a moment of the behaviour case: its preview still being read, drawn
 * for ACME-31, or ACME-30 chosen, whose board its card's count has read already.
 */
export function sampleChoosing(step: 'reading' | 'shown' | 'epic'): ConnectModel {
  const s = jiraBoards();
  if (step === 'reading') delete s.boards[placeKey(connectValues(s, JIRA))];
  if (step === 'epic') s.pickers.epic!.selected = ['ACME-30'];
  return connectModel(s);
}

function jiraBoards(): ConnectState {
  const base = { root: ROOT, projectName: 'Acme Service', ownRepo: 'acme/service', ghAccount: 'jordan-kim', from: 'tasks' as const, gitEmail: 'jordan.kim@example.com' };
  const s = blankConnect(JIRA, { id: 'c-jira-board', ...base });
  s.host = 'acme.atlassian.net';
  s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false, shared: true };
  s.pickers.project = ready(PROJECTS, ['ACME']);
  const epics = [['ACME-31', 'Renewals'], ['ACME-30', 'Partner portal'], ['ACME-28', 'Invoices by email'], ['ACME-27', 'Usage reports'], ['ACME-24', 'Single sign-on'], ['ACME-22', 'Mobile app'], ['ACME-19', 'Data export'], ['ACME-17', 'Onboarding emails'], ['ACME-12', 'Price list'], ['ACME-9', 'Audit log']];
  s.pickers.epic = ready(epics.map(([value, detail]) => ({ value: value!, label: value!, detail: detail! })), ['ACME-31']);
  s.pickers.board = ready(BOARDS, ['7']);
  s.pickers.sprint = ready(SPRINTS);
  const jira = (counts: number[], first = 40) => sampleBoard('jira', 'ACME Service board', [['To Do', 'todo', counts[0]!], ['In Progress', 'doing', counts[1]!], ['In Review', 'doing', counts[2]!], ['Done', 'done', counts[3]!]], 'ACME', first);
  counted(s, JIRA, 'board', { 7: read(jira([3, 2, 1, 5])), 9: read(null, 'failed', 'Jira answered HTTP 503.') });
  counted(s, JIRA, 'epic', {
    '': read(jira([18, 9, 6, 14])), 'ACME-31': read(jira([3, 2, 1, 5])), 'ACME-30': read(jira([2, 1, 0, 1], 60)), 'ACME-28': read(jira([1, 1, 0, 2], 70)),
    'ACME-27': read(null, 'loading'), 'ACME-24': read(jira([0, 0, 0, 0])),
  });
  s.boards[placeKey(connectValues(s, JIRA))] = read(jira([3, 2, 1, 5]));
  return s;
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
