/**
 * Rules suggested by review findings that keep coming back (GH-102). Generic sample wording, written for
 * these screenshots: no real project's reviews.
 */
import type { Suggestion, SuggestionSource } from '../../../packages/core/src/rule-suggestions.ts';
import type { HubLike } from '../../src/model/shared.ts';
import { sampleIdleHub } from './progress.ts';
import { MIN } from './shared.ts';

/**
 * Two suggestions: a rule written nowhere yet, that colours come from the theme, from four findings across
 * three tasks; and a rule already in CLAUDE.md that the reviews keep finding broken, offered as a check, with
 * more reviews than show before Show all. One of its findings was said again by a later review of the same task and file, so it isn't counted again.
 */
export function sampleSuggestions(now = Date.now()): Suggestion[] {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  let n = 0;
  const src = (task: string, file: string, line: number, message: string, ago: number, extra: Partial<SuggestionSource> = {}): SuggestionSource => {
    n++;
    const sha = `${(0xa1b2c3d + n * 0x111111).toString(16)}0f`.padEnd(40, '0').slice(0, 40);
    return { finding: `${task}@${sha.slice(0, 7)}#1`, task, sha, at: at(ago), sessionId: `5e55${n}0de-0000-4000-8000-00000000000${n}`, name: `Review ${task}`, message, must: false, file, line, counted: true, ...extra };
  };
  return [
    {
      id: 'r-4c0f1e', kind: 'rule', by: 'rule', head: 'Colours come from the theme, never a literal', line: 'Colours come from the theme, never a literal.', written: null, again: null,
      findings: 4, tasks: 3, must: 1, hint: 'lint',
      sources: [
        src('ACME-12', 'webview/escalation.css', 41, 'The new badge sets #e8590c directly, so it ignores the light theme.', 4 * 24 * 60),
        src('ACME-14', 'webview/routing.css', 12, 'Two colour literals in the routing table; use the theme\'s tokens.', 3 * 24 * 60, { must: true }),
        src('ACME-14', 'webview/board.css', 88, 'The lane header hard-codes its background.', 3 * 24 * 60),
        src('ACME-20', 'webview/report.css', 7, 'The chart\'s bars are rgb() literals.', 26 * 60),
      ],
    },
    {
      id: 'r-9a7b21', kind: 'check', by: 'rule', head: 'Look at UI changes before shipping them', line: 'Look at UI changes before shipping them.', written: 'CLAUDE.md', again: null,
      findings: 4, tasks: 4, must: 0, hint: 'gate',
      sources: [
        src('ACME-10', 'webview/changelog.ts', 30, 'No screenshot shows the new changelog panel.', 6 * 24 * 60),
        src('ACME-13', 'webview/leads.ts', 112, 'The screenshots stop above the new duplicate list.', 5 * 24 * 60),
        src('ACME-13', 'webview/leads.ts', 118, 'The duplicate list still isn\'t in a screenshot.', 5 * 24 * 60 - 90, { counted: false }),
        src('ACME-28', 'webview/renewals.ts', 64, 'The reminder card was only looked at in the dark theme.', 2 * 24 * 60),
        src('ACME-31', 'webview/territories.ts', 20, 'The territory picker was never shown at 500 px.', 9 * 60),
      ],
    },
  ];
}

/**
 * The quiet Overview, with nothing running: one blocked task, which needs you and comes first, then the two
 * suggestions, which never count in the badge.
 */
export function sampleRulesHub(now = Date.now()): HubLike {
  const hub = sampleIdleHub(now);
  const root = hub.projects[0]!.root;
  const rows = hub.taskRows(root).filter((r) => r.id === 'ACME-18' || r.state === 'done');
  return { ...hub, taskRows: () => rows, updates: () => [], autopilotLog: () => [], suggestions: (r: string) => (r === root ? sampleSuggestions(now) : []) };
}
