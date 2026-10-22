/**
 * Settings' How agents run (GH-110), with every state it shows: a second project beside the sample one,
 * whose autonomy is manual and whose auto-merge is on, with this clone's choices next to the project's, and
 * agents that would bill per token. Then its Trackers and sign-ins (GH-112), with every state a tracker's
 * sign-in and board can be in.
 */
import type { DoctorItem } from '../../src/logic/setup.ts';
import type { BoardInput } from '../../src/model/boards.ts';
import type { HubLike, ProjectLike } from '../../src/model/shared.ts';
import { sampleHub } from './hub.ts';
import { sampleSetup } from './setup.ts';

/** A second project, generic: auto-merge on, autonomy manual, a builder model this clone chose. */
const PORTAL: ProjectLike = {
  name: 'Acme Portal', root: '/Users/me/code/acme-portal', branch: 'staging',
  agents: {
    builder: { model: 'claude-fable-5-1', effort: null, fallbackModel: null, from: { model: 'clone', effort: 'default', fallbackModel: 'default' } },
    reviewer: { model: 'claude-opus-5-5', effort: 'medium', fallbackModel: 'claude-haiku-4-5-20251001', from: { model: 'acc', effort: 'project', fallbackModel: 'clone' } },
  },
  config: {
    github: { repo: 'acme/portal', account: 'jordan-kim' }, profile: 'generic', autonomy: 'manual', autopilot: { autoMerge: true },
    // GitHub keeps a ticket's changes in its description's section (T-105); Slack has no fields, so its row is off.
    trackers: [
      { kind: 'github', project: null, prefix: null, changesField: { id: 'description', name: 'Changes (kept by the Command Center)', format: 'markdown' } },
      { kind: 'azure', project: 'CRM', prefix: null }, { kind: 'jira', project: 'GLX', prefix: null }, { kind: 'slack', project: null, prefix: 'SL' },
    ],
    environments: [
      { name: 'Production', branch: 'production', type: 'production', org: null, default: false, protected: true, promotesTo: [] },
      { name: 'Staging', branch: 'staging', type: 'partial', org: null, default: true, protected: false, promotesTo: ['production'] },
    ],
  },
  worktrees: [{ path: '/Users/me/code/acme-portal', head: 'e5f6a7b', branch: 'staging', main: true, changed: 0, locked: false, prunable: false }],
};

/** The sample hub with the second project after the first. */
export function sampleSettingsHub(now = Date.now()): HubLike {
  const hub = sampleHub(now);
  return { ...hub, projects: [...hub.projects, PORTAL], taskRows: (root) => (root === PORTAL.root ? [] : hub.taskRows(root)) };
}

/** Setup's checks, with agents that would bill per token through an API key in the environment. */
export function samplePerTokenSetup(): { items: DoctorItem[]; confirmed: Set<string> } {
  const s = sampleSetup();
  const items = s.items.map((i) => (i.id === 'A1.claude-billing' ? { ...i, status: 'fail' as const, detail: 'Agents would bill per token, not your Claude subscription: ANTHROPIC_API_KEY in the environment.' } : i));
  return { ...s, items };
}

/** A tracker's board as the extension knows it, with nothing read yet: each state below fills in its own. */
const tracker = (index: number, kind: BoardInput['kind'], title: string, more: Partial<BoardInput>): BoardInput => ({
  index, kind, title, board: null, error: null, connect: null, loading: false, signedInAs: null, signInScope: null, place: title, left: [], ...more,
});
const board = (title: string, source: NonNullable<BoardInput['board']>['source'] = 'jira-board'): NonNullable<BoardInput['board']> => ({ source, title, url: null, notice: null, columns: [], cards: [] });
/** The Sign in button a board shows when its tracker wants a sign-in (D-073). */
const signIn = (root: string, index: number, name: string) => ({ command: 'acc.trackers.signIn', label: `Sign in to ${name}`, arg: JSON.stringify({ root, index }) });

/**
 * Each project's trackers as their boards know them (GH-112). The sample project: Jira, signed in for every
 * project on its site, and monday.com, not signed in. The portal: GitHub through gh, Azure DevOps signed in
 * for this project only with its board still being read, a second Jira site that refused its sign-in, and
 * Slack, whose changes field is off (T-105).
 */
export function sampleTrackerBoards(root: string): BoardInput[] {
  if (root === PORTAL.root) {
    return [
      tracker(0, 'github', 'GitHub · acme/portal', { signedInAs: 'jordan-kim', place: 'GitHub · acme/portal · labels billing or invoices', board: board('Issues · acme/portal', 'github-state') }),
      tracker(1, 'azure', 'Azure DevOps · CRM', { signedInAs: 'jordan@acme.example', signInScope: { shared: false, host: 'acme' }, place: 'Azure DevOps · CRM · CRM Team · area CRM\\Billing', loading: true }),
      tracker(2, 'jira', 'Jira · GLX', {
        signedInAs: 'jordan@globex.example', signInScope: { shared: false, host: 'globex.atlassian.net' },
        error: 'Jira refused the email and API token. Check them, or make a new token.', connect: signIn(root, 2, 'Jira'),
      }),
      tracker(3, 'slack', 'Slack · acme', { signedInAs: 'Acme Command Center', signInScope: { shared: false, host: 'acme' }, place: 'Slack · acme · channel C0123ABCD' }),
    ];
  }
  return [
    tracker(0, 'jira', 'Jira · ACME', { signedInAs: 'jordan@acme.example', signInScope: { shared: true, host: 'acme.atlassian.net' }, place: 'Jira · ACME · epic ACME-3 Premium Support', board: board('ACME Service board') }),
    tracker(1, 'monday', 'monday.com · acme', {
      place: 'monday.com · acme · board 1234567890 · group This sprint',
      error: 'Sign in to monday.com (acme) for this repo to see its board and items.', connect: signIn(root, 1, 'monday.com'),
    }),
  ];
}
