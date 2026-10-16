/** Settings' Limits and checks (GH-111): this machine's limits and the sample project's, as the hub reads them. */
import { parseConfig } from '../../../packages/core/src/config.ts';
import { gatesFor } from '../../../packages/core/src/gates.ts';
import type { LimitsFacts, ProjectLimits } from '../../src/model/limits.ts';
import { MIN, ROOT } from './shared.ts';

/** A Salesforce project's checks, as acc lists them. */
const SF = gatesFor(parseConfig({ schema: 1, project: 'Acme Service', profile: 'salesforce', environments: [{ name: 'Dev', type: 'developer', org: 'Acme Dev', default: true }] }).config!).map((g) => ({ name: g.name, about: g.about }));

/** The sample project: full at its cap of three, with a month of builds, reviews and analyses behind it. */
export function sampleProjectLimits(): ProjectLimits {
  return {
    name: 'Acme Service', root: ROOT, repo: `${ROOT}/.git/acc/ledger.json`,
    max: 3, maxFrom: 'project', running: 3,
    required: ['format', 'static', 'validate'], requiredFrom: 'project', builder: null, gates: SF, queue: [],
    model: 'claude-opus-5-5', modelFrom: 'acc',
    recent: { builds: [42, 35, 61, 28, 50, 47].map((m) => m * MIN), reviews: [0.84, 1.12, 0.61, 0.95], analyses: [1.4, 1.05] },
  };
}

/** Two heavy-check slots, both in use and one check waiting; a total of six across two repos, four running. */
export function sampleLimits(): LimitsFacts {
  return {
    machine: { slots: 2, slotsFrom: 'machine', inUse: 2, waiting: 1, total: 6, running: 4, repos: 2 },
    projects: [sampleProjectLimits()],
  };
}

/**
 * The other states: no total, slots that ACC_HEAVY_SLOTS sets, a second project that builds through the
 * merge queue with lighter checks for its builders, one with no required checks, and nothing done yet to
 * put numbers to.
 */
export function sampleLimitsOther(): LimitsFacts {
  const none = { builds: [], reviews: [], analyses: [] };
  return {
    machine: { slots: 1, slotsFrom: 'env', inUse: 0, waiting: 0, total: null, running: 0, repos: 0 },
    projects: [
      { ...sampleProjectLimits(), max: 1, maxFrom: 'acc', running: 0, required: [], requiredFrom: 'acc', recent: none },
      {
        name: 'Tool', root: '/Users/me/code/tool', repo: '/Users/me/code/tool/.git/acc/ledger.json', max: 16, maxFrom: 'project', running: 0,
        required: ['check'], requiredFrom: 'project', builder: ['typecheck', 'near-tests'],
        gates: [{ name: 'check', about: 'npm run check' }, { name: 'typecheck', about: 'npm run typecheck' }, { name: 'near-tests', about: 'node scripts/near-tests.mjs' }],
        queue: ['main'], model: 'claude-sonnet-5-5', modelFrom: 'project', recent: none,
      },
    ],
  };
}
