/**
 * One status bar item: what it says, and its tooltip.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import type { TaskRow } from './shared.ts';

export interface StatusSummary {
  /** Empty when nothing is in play: the item hides. */
  text: string;
  tooltip: string;
  attention: boolean;
}

/**
 * The status bar's one line on the swarm: what needs you, what's running, what's in review. Each count
 * has its icon and its words, so it reads without colour. Its tooltip says what each running task's agent
 * is doing, in the Agents page's words (T-164).
 */
export function statusSummary(rows: Pick<TaskRow, 'id' | 'title' | 'display' | 'agent'>[], needsYou: number): StatusSummary {
  const running = rows.filter((r) => r.display === 'running');
  const review = rows.filter((r) => r.display === 'review');
  const parts = [
    needsYou ? `$(bell) ${needsYou} need${needsYou === 1 ? 's' : ''} you` : '',
    running.length ? `$(sync) ${running.length} running` : '',
    review.length ? `$(eye) ${review.length} in review` : '',
  ].filter(Boolean);
  const doing = (r: (typeof rows)[number]) => (r.agent?.busy && r.agent.label !== 'Working' ? ` (${r.agent.label})` : '');
  const list = (label: string, rs: typeof rows) => (rs.length ? [`${label}: ${rs.map((r) => `${r.id}${doing(r)}`).join(', ')}`] : []);
  const tooltip = [
    needsYou ? `${needsYou} thing${needsYou === 1 ? '' : 's'} need${needsYou === 1 ? 's' : ''} you` : '',
    ...list('Running', running),
    ...list('In review', review),
  ].filter(Boolean).join('\n');
  return { text: parts.join('  '), tooltip: tooltip ? `${tooltip}\n\nOpen the Command Center` : '', attention: needsYou > 0 };
}

// ---------------------------------------------------------------- one status bar item (D-065)

export interface StatusParts {
  rows: Pick<TaskRow, 'id' | 'title' | 'display' | 'agent'>[];
  needsYou: number;
  /** A command acc runs for you that waits on an answer: its label. */
  asking: string | null;
  /** Commands acc runs for you, by label; autopilot's own isn't one. */
  running: string[];
  /** Setup is being checked right now. */
  checking: boolean;
  setup: { done: number; total: number; todo: number } | null;
  autopilot: { project: string; state: 'on' | 'off' | 'elsewhere' | 'refused' }[];
  /** The repo's GitHub account, and whether it's the right one. */
  account: { name: string; ok: boolean } | null;
}

const AUTOPILOT_WORDS = { on: 'on here', off: 'off', elsewhere: 'on in another window', refused: 'can\'t run' } as const;

/**
 * All of acc in one status bar item (D-065): what needs you first, else what's running and in review,
 * else setup left to do. A robot when autopilot is on here, and a spinner while acc is busy. The tooltip
 * says the rest; the item hides when there's nothing to say.
 */
export function combinedStatus(p: StatusParts): { text: string; tooltip: string[]; attention: boolean } {
  const tasks = statusSummary(p.rows, p.needsYou);
  const auto = p.autopilot.some((a) => a.state === 'on');
  const busy = p.checking || p.running.length > 0;
  let main = p.asking ? `$(bell) ${p.asking}: waiting for you` : tasks.text;
  if (!main && p.setup?.todo) main = `$(checklist) Setup: ${p.setup.todo} to do`;
  if (!main && busy) main = `$(sync~spin) ${p.running[0] ?? 'Checking setup'}`;
  else if (main && busy) main += ' $(sync~spin)';
  if (!main && auto) main = 'Autopilot on';
  const text = main ? `${auto ? '$(hubot) ' : ''}${main}` : '';
  const tooltip = [
    ...(tasks.tooltip ? tasks.tooltip.split('\n').filter((l) => l && !/^Open the Command Center$/.test(l)) : []),
    ...(p.asking ? [`$(bell) ${p.asking} is waiting for your answer`] : []),
    ...p.running.map((r) => `$(sync~spin) Running for you: ${r}`),
    ...p.autopilot.map((a) => `$(hubot) Autopilot ${AUTOPILOT_WORDS[a.state]}${p.autopilot.length > 1 ? `: ${a.project}` : ''}`),
    ...(p.setup ? [`$(checklist) Setup: ${p.setup.done} of ${p.setup.total} done${p.checking ? ', checking now' : ''}`] : p.checking ? ['$(sync~spin) Checking setup'] : []),
    ...(p.account ? [`${p.account.ok ? '$(github)' : '$(warning)'} GitHub: ${p.account.name}${p.account.ok ? '' : ', the wrong account'}`] : []),
  ];
  return { text, tooltip, attention: !!p.asking || p.needsYou > 0 || (p.account ? !p.account.ok : false) };
}
