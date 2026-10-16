/**
 * Since you last looked (D-???): the news held while the person was away from the window, as a group on
 * the Overview above its cards. A line for each notice, which opens its task, and Clear.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { SINCE_PART } from '../logic/away.ts';
import type { NoticeKind, ProjectNotice } from '../logic/notices.ts';
import type { LandingGroup, LandingRow } from './landing.ts';
import { type Look, LOOK } from './shared.ts';

/** What Clear runs: the extension forgets the list, and the page draws the Overview without it. */
export const SINCE_CLEAR = 'acc.since.clear';

/** How a notice shows as a line: an icon and a label for each kind. What needs you is orange, news blue. */
export const SINCE_LOOK: Record<NoticeKind, Look> = {
  waiting: LOOK('Waiting on you', 'bell', 'orange'),
  stopped: LOOK('Builder stopped', 'debug-stop', 'orange'),
  review: LOOK('Ready for review', 'eye', 'blue'),
  passed: LOOK('Review passed', 'pass', 'blue'),
  rework: LOOK('Sent back', 'discard', 'orange'),
  blocked: LOOK('Blocked', 'circle-slash', 'orange'),
  'ci-failed': LOOK('Checks failed', 'warning', 'orange'),
  changes: LOOK('Changes asked for', 'comment-discussion', 'orange'),
  conflicts: LOOK('Conflicts', 'git-compare', 'orange'),
  merged: LOOK('Merged', 'git-merge', 'blue'),
  'analysis-ready': LOOK('Analysis ready', 'lightbulb', 'blue'),
  'analysis-questions': LOOK('Questions for you', 'question', 'orange'),
  'analysis-split': LOOK('Too big for one task', 'split-horizontal', 'orange'),
  'analysis-back': LOOK('Analysis back', 'lightbulb', 'blue'),
  autopilot: LOOK('Autopilot step', 'hubot', 'blue'),
};

/** The group on the Overview: its lines, Clear, and the heading the welcome back's Show opens at. */
export interface SinceGroup extends LandingGroup {
  /** Clear: the page sends its command with no argument. */
  clear: { label: string; icon: string; tip: string; command: string };
  part: string;
}

/** What the newest away span held, as the Overview's group, or null with nothing in it. Each line opens its task; with more than one project, it names its own. */
export function sinceGroup(held: readonly ProjectNotice[], projects: { name: string; root: string }[]): SinceGroup | null {
  if (!held.length) return null;
  const names = new Map(projects.map((p) => [p.root, p.name]));
  const all = held.map(({ root, notice: n }, i): LandingRow => {
    const project = projects.length > 1 ? names.get(root) : undefined;
    return {
      key: `since:${i}`, look: SINCE_LOOK[n.kind], id: n.task, title: n.text, facts: project ? [{ text: project }] : [],
      action: null, menu: null, open: { kind: 'task', project: root, key: n.task }, tip: n.text,
    };
  });
  return {
    key: 'since', title: 'Since you last looked', icon: 'history', tone: 'blue', count: all.length, shows: all.length, rows: all, total: all.length, more: null, all,
    opens: { kind: 'list', group: 'since' }, empty: null, part: SINCE_PART,
    clear: { label: 'Clear', icon: 'clear-all', tip: 'Clear this list. News from the next time you are away starts a new one.', command: SINCE_CLEAR },
  };
}
