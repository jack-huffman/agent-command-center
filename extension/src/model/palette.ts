/**
 * The command palette's items (T-52): every section, part of Settings, task, agent and action the
 * Command Center page offers, each with what it does. The page searches them as you type; its matching is
 * in webview/fuzzy.ts. Plain data, posted to the webview with the page's model. No vscode import, so it's
 * testable.
 */

import { CHECK_MACHINE } from '../logic/processes.ts';
import { reportAction } from './about.ts';
import type { HomeModel } from './home.ts';
import { type SettingsPart, settingsKey } from './settings.ts';
import type { Action, HomeSection, Ref } from './shared.ts';

/** What an item is: a section, a part of Settings, a task, an agent, or an action. */
export type PaletteKind = 'section' | 'setting' | 'task' | 'agent' | 'action';

/**
 * What an item does when it runs: each the same as the control it stands for on the page. A section or a
 * part of Settings goes there; a task opens over the page, as a card's click does; an action sends what its
 * button sends, a task's command with its ref, a header's command with its project, an Answer with its
 * question opens it in Needs you, and Refresh reads the page again.
 */
export type PaletteDo =
  | { kind: 'go'; section: HomeSection; part?: string }
  | { kind: 'task'; project: string; key: string }
  | { kind: 'run'; command: string; ref: Ref }
  | { kind: 'toolbar'; command: string; project?: string }
  | { kind: 'answer'; question: string }
  | { kind: 'refresh' };

export interface PaletteItem {
  /** Stays the same from one model to the next, so the page can remember what was run. */
  id: string;
  kind: PaletteKind;
  title: string;
  /** The muted words on its right: a task's key, the section a part of Settings is in, or why it is off. */
  hint: string;
  /**
   * The words a query matches: its title first, then its hint when that's a key or a section, then more
   * words to find it by, such as a task's project. Never the reason it's off.
   */
  words: string;
  icon: string;
  does: PaletteDo;
  /** Why it can't run now: shown with it, and it doesn't run. */
  disabled?: string;
}

/** The commands a card's next step may be, for the palette to offer it (T-52): Dispatch, Resume, Answer or Watch. */
export const PALETTE_STEPS: readonly string[] = ['acc.task.dispatch', 'acc.task.dispatchAnyway', 'acc.task.resume', 'acc.task.watch'];

/** A card's next step, as its footer shows it (webview/boards.ts's cardPrimary), when it is one the palette offers. */
export function paletteStep(actions: Action[]): Action | null {
  const a = actions.find((x) => x.primary && x.command !== 'acc.task.move');
  if (!a) return null;
  return PALETTE_STEPS.includes(a.command) || (a.command === 'acc.task.show' && !!a.question) ? a : null;
}

/** Why the header's project actions are off on a page with no project. */
export const NO_PROJECT = 'No project here yet: set this folder up first';
/** Why Stop finished is off. */
export const NOTHING_FINISHED = 'No finished background session to stop';

const words = (...parts: (string | null | undefined)[]): string => parts.filter(Boolean).join(' ');

/** Every item the page's palette searches, from the page's model: sections, Settings' parts, tasks, agents, then actions. */
export function paletteItems(m: Omit<HomeModel, 'palette'>): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const n of m.nav) out.push({ id: `section:${n.section}`, kind: 'section', title: n.label, hint: '', words: words(n.label, n.hint), icon: n.icon, does: { kind: 'go', section: n.section } });
  for (const p of m.settings.parts) {
    out.push({ id: `setting:${p.id}`, kind: 'setting', title: p.title, hint: 'Settings', words: words(p.title, 'Settings', p.summary), icon: p.icon, does: { kind: 'go', section: 'settings', part: settingsKey(p.id as SettingsPart) } });
  }
  const many = m.tasks.projects.length > 1;
  const steps: PaletteItem[] = [];
  const edits: PaletteItem[] = [];
  for (const p of m.tasks.projects) {
    for (const c of p.columns) {
      for (const card of c.cards) {
        out.push({ id: `task:${p.root}#${card.id}`, kind: 'task', title: card.title, hint: card.id, words: words(card.title, card.id, p.name), icon: 'tasklist', does: { kind: 'task', project: p.root, key: card.id } });
        // Edit (T-74), for a task that can be edited now: one whose builder runs, or that's done, says why on its page.
        const edit = card.actions.find((a) => a.command === 'acc.task.edit' && !a.disabled);
        if (edit) edits.push({ id: `edit:${p.root}#${card.id}`, kind: 'action', title: `Edit: ${card.title}`, hint: card.id, words: words(`Edit: ${card.title}`, card.id, many ? p.name : null), icon: edit.icon, does: { kind: 'run', command: edit.command, ref: edit.ref } });
        const step = paletteStep(card.actions);
        if (!step) continue;
        const does: PaletteDo = step.question ? { kind: 'answer', question: step.question } : { kind: 'run', command: step.command, ref: step.ref };
        steps.push({ id: `step:${p.root}#${card.id}`, kind: 'action', title: `${step.label}: ${card.title}`, hint: card.id, words: words(`${step.label}: ${card.title}`, card.id, many ? p.name : null), icon: step.icon, does, ...(step.disabled ? { disabled: step.disabled, hint: step.disabled } : {}) });
      }
    }
  }
  for (const r of m.agents.repos) {
    for (const a of [...r.tasks.flatMap((t) => t.agents), ...r.finished]) {
      out.push({ id: `agent:${a.key}`, kind: 'agent', title: a.name, hint: a.task?.key ?? '', words: words(a.name, a.task?.key, a.task?.title, r.label), icon: a.background ? 'server-process' : 'terminal', does: { kind: 'run', command: 'acc.agent.watch', ref: { session: a.key } } });
    }
  }
  // The header's actions (the Overview's Add task and its ⋯ menu), each on the first project, as there.
  const root = m.overview.projects[0]?.root;
  const header = (id: string, title: string, icon: string, command: string): PaletteItem => ({
    id: `action:${id}`, kind: 'action', title, hint: root ? '' : NO_PROJECT, words: title, icon, does: { kind: 'toolbar', command, project: root }, ...(root ? {} : { disabled: NO_PROJECT }),
  });
  out.push(header('add-task', 'Add task', 'add', 'acc.task.add'), header('start-agent', 'Start an agent', 'hubot', 'acc.agent.new'), header('add-tracker', 'Add a tracker', 'plug', 'acc.trackers.add'));
  out.push({ id: 'action:refresh', kind: 'action', title: 'Refresh', hint: '', words: 'Refresh', icon: 'refresh', does: { kind: 'refresh' } });
  // Report a problem (T-118), as Settings' About offers it: off with its reason while a report posts.
  const report = m.settings.about?.report ?? reportAction({});
  out.push({ id: 'action:report', kind: 'action', title: report.label, hint: report.disabled ?? '', words: words(report.label, 'issue bug GitHub'), icon: report.icon, does: { kind: 'toolbar', command: report.command }, ...(report.disabled ? { disabled: report.disabled } : {}) });
  // Check this machine (T-133), as Setup's header offers it: VSCode's Command Palette has it too.
  out.push({ id: 'action:check-machine', kind: 'action', title: CHECK_MACHINE.name, hint: '', words: words(CHECK_MACHINE.name, 'Setup tools PATH install'), icon: 'device-desktop', does: { kind: 'toolbar', command: CHECK_MACHINE.command } });
  out.push(...steps, ...edits);
  // Agents' Stop finished, through the same command as its header's button; off with its reason when there's none.
  const n = m.agents.stopFinished;
  out.push({ id: 'action:stop-finished', kind: 'action', title: 'Stop finished sessions', hint: n ? `${n} finished` : NOTHING_FINISHED, words: words('Stop finished sessions', 'Agents'), icon: 'debug-stop', does: { kind: 'toolbar', command: 'acc.agents.stopFinished' }, ...(n ? {} : { disabled: NOTHING_FINISHED }) });
  // Two items of one id, such as two rows that share a key, each keep their own: the later ones are numbered.
  const seen = new Map<string, number>();
  return out.map((i) => {
    const n = (seen.get(i.id) ?? 0) + 1;
    seen.set(i.id, n);
    return n > 1 ? { ...i, id: `${i.id}~${n}` } : i;
  });
}
