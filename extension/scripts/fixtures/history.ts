/** History (D-037): moves the ledger recorded, and the steps autopilot took. */
import type { AutopilotRecord } from '../../../packages/core/src/autopilot-log.ts';
import type { ActivityItem } from '../../src/model/shared.ts';
import { ACME_25_REFUSED, MIN, SLEPT } from './shared.ts';

/** Moves the sample project's tasks made, newest first. */
export function sampleHistory(now = Date.now()): ActivityItem[] {
  return [
    { at: new Date(now - 4 * MIN).toISOString(), task: 'ACME-14', title: 'Route web-to-case submissions by product line', from: 'todo', to: 'running', by: 'human:jordan' },
    { at: new Date(now - 12 * MIN).toISOString(), task: 'ACME-12', title: 'Case escalation rules for the premium tier', from: 'todo', to: 'running', by: 'human:jordan' },
    { at: new Date(now - 95 * MIN).toISOString(), task: 'ACME-15', title: 'Rename the Region picklist values', from: 'running', to: 'review', by: 'builder:ACME-15' },
    { at: new Date(now - 26 * 60 * MIN).toISOString(), task: 'ACME-19', title: 'Fix the flow that double-sends welcome emails', from: 'review', to: 'rework', by: 'reviewer' },
    { at: new Date(now - 3 * 24 * 60 * MIN).toISOString(), task: 'ACME-10', title: 'Add a CHANGELOG', from: 'review', to: 'done', by: 'sync' },
  ];
}

/**
 * Steps autopilot took, as its ledger events tell them (D-064): it reviewed and landed ACME-15, couldn't
 * review ACME-25 or merge dev into ACME-26, and reviewed ACME-20, which it lands next. It sent ACME-34 back
 * for its failing checks and re-dispatched it, then wrote down that they failed again; it has just sent
 * ACME-33 back (D-076).
 */
export function sampleAutopilot(now = Date.now()): AutopilotRecord[] {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  return [
    { seq: 201, at: at(93), task: 'ACME-15', step: 'review', outcome: 'done', verdict: 'pass' },
    { seq: 203, at: at(92), task: 'ACME-15', step: 'land', outcome: 'done', pr: { number: 42, url: 'https://github.com/acme/service/pull/42', opened: true } },
    { seq: 210, at: at(48), task: 'ACME-25', step: 'review', outcome: 'failed', reason: ACME_25_REFUSED },
    { seq: 214, at: at(20), task: 'ACME-26', step: 'refresh', outcome: 'failed', reason: 'Conflicts with dev that autopilot can\'t resolve: force-app/main/default/classes/CaseTriggerHandler.cls. The branch is as it was, at 3f9c2ab, and nothing was pushed.' },
    { seq: 205, at: at(80), task: 'ACME-34', step: 'checks', outcome: 'done', checks: ['Apex tests'], reason: 'Checks failed on GitHub on 7d3e1f0: Apex tests.' },
    { seq: 206, at: at(79), task: 'ACME-34', step: 'dispatch', outcome: 'done', cause: 'checks' },
    { seq: 217, at: at(14), task: 'ACME-13', step: 'resume', outcome: 'done', reason: SLEPT },
    { seq: 218, at: at(9), task: 'ACME-34', step: 'checks', outcome: 'failed', reason: 'Checks failed on GitHub again: Apex tests. Autopilot already sent 7d3e1f0 back once: a person decides.' },
    { seq: 219, at: at(6), task: 'ACME-20', step: 'review', outcome: 'done', verdict: 'pass' },
    { seq: 221, at: at(3), task: 'ACME-33', step: 'checks', outcome: 'done', checks: ['validate', 'Apex tests'], reason: 'Checks failed on GitHub on 9a8b7c6: validate, Apex tests.' },
    // A task a person dispatched that waited for another's files (D-093): one it started, one it couldn't.
    { seq: 211, at: at(31), task: 'ACME-29', step: 'start', outcome: 'done', waitedFor: ['ACME-22'] },
    { seq: 222, at: at(2), task: 'ACME-36', step: 'start', outcome: 'failed', reason: 'Claude Code didn\'t start the agent: Claude Code doesn\'t trust this folder yet.' },
  ];
}
