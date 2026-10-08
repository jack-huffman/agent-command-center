/**
 * Settings' How agents run (GH-110), with every state it shows: a second project beside the sample one,
 * whose autonomy is manual and whose auto-merge is on, with this clone's choices next to the project's, and
 * agents that would bill per token.
 */
import type { DoctorItem } from '../../src/logic/setup.ts';
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
    github: { repo: 'acme/portal', account: 'jordan-kim' }, profile: 'generic', autonomy: 'manual', autopilot: { autoMerge: true }, trackers: [],
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
