// The Tasks section: acc's agent board, and each tracker's own board.

import type { TrackerBoard, TrackerCard } from '../src/model/boards.ts';
import type { TasksModel } from '../src/model/tasks.ts';
import { cardFoot, cardMenu, moreMenu } from './boards.ts';
import { actionButton, avatar, button, type Child, el, empty, header, icon, labelChip, openable, plural, status, titled, toolbarButton } from './dom.ts';
import { api, go, memory, type PageArea, remember, state } from './state.ts';

export function renderTasks(m: TasksModel): Node[] {
  if (!m.projects.length) return [header('Tasks', 'No onboarded project in this workspace.'), empty('Onboard this folder to start tracking tasks.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  return m.projects.map((p) => {
    const tools: Child[] = [toolbarButton('acc.task.add', 'Add task', 'add', p.root, true)];
    // With a tracker's board on show, its tickets come from the board (Track on a card), not an import.
    if (!p.boards.length) {
      if (p.github) tools.push(toolbarButton('acc.task.importGithub', 'Import GitHub issues', 'github', p.root));
      tools.push(toolbarButton('acc.task.importJira', 'Connect Jira', 'plug', p.root));
    }
    const ready = p.columns.find((c) => c.group === 'ready')?.cards.length ?? 0;
    const needs = p.columns.find((c) => c.group === 'needs-you')?.cards.length ?? 0;
    const summary = p.total ? `${p.name}: ${plural(p.total, 'task')}, ${ready} ready${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}.` : `${p.name}: no tasks yet.`;
    if (p.boards.length) {
      const mode = memory().modes[p.root] ?? 'tracker';
      const toggle = el('div', 'segmented');
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', 'Which board');
      for (const [m, label, ic] of [['tracker', p.boards.length === 1 ? p.boards[0]!.title : 'Tracker boards', KIND_ICON[p.boards[0]!.kind] ?? 'issues'], ['agents', 'Agent board', 'hubot']] as const) {
        const b = el('button', `seg${mode === m ? ' on' : ''}`, icon(ic), label) as HTMLButtonElement;
        b.type = 'button';
        b.setAttribute('aria-pressed', String(mode === m));
        b.addEventListener('click', () => { remember((s) => { s.modes[p.root] = m; }); if (state.last) state.draw(state.last); });
        toggle.append(b);
      }
      tools.unshift(toggle);
      if (mode === 'tracker') {
        const cards = p.boards.reduce((n, b) => n + b.columns.reduce((k, c) => k + c.cards.length, 0), 0);
        const head = header(m.projects.length > 1 ? `Tasks · ${p.name}` : 'Tasks', `${p.name}: ${plural(cards, 'ticket')} on the board${ready ? `, ${ready} ready for an agent` : ''}${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}.`, ...tools);
        return el('div', 'project', head, ...p.boards.map((b) => renderTrackerBoard(p.root, b)));
      }
    }
    const board = el('div', 'board agent-board');
    for (const c of p.columns) {
      const col = el('section', `column tone-edge-${c.tone}`, el('h2', '', icon(c.icon, c.tone), c.label, el('span', 'count', String(c.cards.length))));
      col.setAttribute('aria-label', `${c.label}: ${plural(c.cards.length, 'task')}`);
      col.dataset.group = c.group;
      if (!c.cards.length) col.append(el('p', 'muted drop-hint', 'Nothing here'));
      for (const card of c.cards) {
        // Drag a card to another lane to move it (D-041), so the cards need no Move button.
        const art = el('article', `card${c.group === 'done' ? ' done' : ''}`,
          el('div', 'card-id', card.id, el('span', 'chip', card.environment)),
          openable(el('div', 'card-title', card.title), { type: 'run', command: 'acc.task.show', ref: { project: p.root, task: card.id } }),
          card.waitingOn.length ? el('div', 'card-note', icon('clock'), `Waiting on ${card.waitingOn.join(', ')}`) : null,
          // Its pull request won't merge into its base (D-049): an icon and the words, in orange.
          card.conflicts ? el('div', 'card-note conflict', icon('warning'), el('span', '', card.conflicts)) : null,
          // Its checks failed on GitHub, or autopilot sent it back for them (D-076): an icon and the words, in orange.
          card.failedChecks ? el('div', 'card-note conflict', icon('github-action'), el('span', '', card.failedChecks)) : null,
          // A step autopilot couldn't take, and why (D-055): an icon and the words, in orange.
          card.autopilot ? el('div', 'card-agent', status(card.autopilot)) : null,
          // Its pull request was closed, and autopilot won't replace it (D-063): an icon and the words, in orange.
          card.closedPr ? el('div', 'card-agent', status(card.closedPr)) : null,
          // Its builder stopped before acc done or acc block, and what it last said (D-067): in orange, with its icon.
          card.stopped ? el('div', 'card-agent', status(card.stopped)) : null,
          // Its files beside other tasks' (D-093): it waits for them (a clock, in blue), its start failed (the
          // bell, in orange), it shares them, or a Ready task's aren't known.
          card.files ? el('div', 'card-agent', status(card.files)) : null,
          card.agent ? titled(el('div', 'card-agent', el('span', 'muted', 'Agent: '), status(card.agent)), card.agentName) : null,
          // The model it runs with (D-086), in plain mono text: a name, not a state.
          card.agent && card.model ? el('div', 'card-where card-model', icon('sparkle'), el('span', 'mono muted', card.model)) : null,
          // Its analysis (D-052), in its own words: under way, waiting on you, or ready to build from.
          card.analysis ? el('div', 'card-agent', status(card.analysis)) : null,
          cardFoot(card),
        );
        // Everything but the next step sits behind ⋯, in the card's corner (D-062).
        const more = moreMenu(`card:${p.root}#${card.id}`, card.id, cardMenu(card.actions));
        if (more) art.prepend(more);
        art.dataset.task = card.id;
        art.dataset.drops = card.drops.join(' ');
        art.draggable = card.drops.length > 0;
        art.setAttribute('aria-label', `${card.id}: ${card.title}. ${card.drops.length ? 'Drag to another lane to move it.' : ''}`);
        art.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/x-acc-task', card.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          art.classList.add('dragging');
          board.classList.add('dragging-task');
          for (const lane of board.querySelectorAll<HTMLElement>('.column')) lane.classList.toggle('can-drop', card.drops.includes(lane.dataset.group ?? ''));
        });
        art.addEventListener('dragend', () => {
          art.classList.remove('dragging');
          board.classList.remove('dragging-task');
          for (const lane of board.querySelectorAll<HTMLElement>('.column')) lane.classList.remove('can-drop', 'drop-target');
        });
        col.append(art);
      }
      // Only a lane the card may go to takes it; the rest stay dimmed while you drag.
      col.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes('text/x-acc-task') || !col.classList.contains('can-drop')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drop-target');
      });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget as Node)) col.classList.remove('drop-target'); });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drop-target');
        const id = e.dataTransfer?.getData('text/x-acc-task');
        const moved = id ? board.querySelector<HTMLElement>(`[data-task="${CSS.escape(id)}"]`) : null;
        if (!id || !moved || !col.classList.contains('can-drop') || moved.closest('.column') === col) return;
        // Shown in place at once; the board redraws from the ledger, or snaps back if acc refuses.
        col.querySelector('.drop-hint')?.remove();
        col.append(moved);
        api.postMessage({ type: 'move-task', project: p.root, task: id, to: c.group });
      });
      board.append(col);
    }
    return el('div', 'project', header(m.projects.length > 1 ? `Tasks · ${p.name}` : 'Tasks', summary, ...tools), p.total ? board : empty('Tasks are tickets for agents to work on.', ...tools));
  });
}

const SOURCE_LABEL: Record<string, string> = { 'jira-board': 'Jira board', 'github-project': 'GitHub Project', 'github-state': 'Open and closed', 'azure-board': 'Azure board', 'monday-board': 'monday.com board' };
export const KIND_ICON: Record<string, string> = { github: 'github', jira: 'issues', azure: 'azure-devops', monday: 'table', acc: 'checklist' };
export const KIND_NAME: Record<string, string> = { github: 'GitHub', jira: 'Jira', azure: 'Azure DevOps', monday: 'monday.com' };

function trackerCard(root: string, b: TrackerBoard, c: TrackerCard): HTMLElement {
  const kind = el('span', 'tcard-type', icon(c.typeIcon));
  kind.title = c.type ?? 'Issue';
  const prio = c.priorityIcon ? el('span', 'tcard-prio', icon(c.priorityIcon)) : null;
  if (prio) prio.title = `Priority: ${c.priority}`;
  const card = el('article', `card tcard${c.acc?.needsYou ? ' attention' : ''}`,
    el('div', 'tcard-top', kind, el('span', 'tcard-key', c.key), prio, el('span', 'spacer'), ...c.assignees.slice(0, 3).map(avatar)),
    el('div', 'card-title', c.title),
    c.labels.length ? el('div', 'labels', ...c.labels.slice(0, 4).map(labelChip)) : null,
    c.acc ? el('div', 'tcard-acc', status(c.acc.look), el('span', 'spacer'), c.acc.action ? actionButton(c.acc.action) : null) : null,
    c.acc?.conflicts ? el('div', 'card-note conflict tcard-conflict', icon('warning'), el('span', '', c.acc.conflicts)) : null,
    c.acc?.failedChecks ? el('div', 'card-note conflict tcard-conflict', icon('github-action'), el('span', '', c.acc.failedChecks)) : null,
    c.track ? el('div', 'tcard-acc', el('span', 'spacer'), trackButton(root, b, c.key, c.track.busy)) : null,
    c.track?.error ? el('div', 'card-note conflict tcard-conflict', icon('warning'), el('span', '', `Couldn't track it: ${c.track.error}`)) : null,
  );
  card.dataset.key = c.key;
  card.draggable = true;
  card.setAttribute('aria-label', `${c.key}: ${c.title}. ${c.status}. Press Enter to open, or drag to another column.`);
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/x-acc-card', c.key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return openable(card, { type: 'ticket', project: root, tracker: b.index, key: c.key });
}

/**
 * Track on a card acc doesn't keep yet (D-074): one click, and it says Tracking… at once, until the card
 * shows acc's task or why it couldn't. The extension holds that, so it outlasts a redraw, and a second
 * click does nothing.
 */
function trackButton(root: string, b: TrackerBoard, key: string, busy: boolean): HTMLButtonElement {
  const show = (on: boolean) => {
    go.replaceChildren(icon(on ? 'sync~spin' : 'add'), on ? 'Tracking…' : 'Track');
    go.disabled = on;
    go.setAttribute('aria-label', on ? `Tracking ${key} in acc` : `Track ${key} in acc`);
  };
  const go = button('Track', 'add', () => {
    if (go.disabled) return;
    show(true);
    api.postMessage({ type: 'track', project: root, tracker: b.index, key });
  }, 'tcard-track');
  go.title = 'Add it to acc, to analyze or dispatch it. The ticket isn\'t changed.';
  show(busy);
  return go;
}

function renderTrackerBoard(root: string, b: TrackerBoard): HTMLElement {
  const tools: Child[] = [];
  if (b.url) {
    const open = el('button', 'btn ghost', icon('link-external'), `Open in ${KIND_NAME[b.kind] ?? 'the tracker'}`) as HTMLButtonElement;
    open.type = 'button';
    open.addEventListener('click', () => api.postMessage({ type: 'open', url: b.url }));
    tools.push(open);
  }
  // Its place, board or sign-in, changed on the Connect page (GH-51).
  const change = el('button', 'btn ghost', icon('settings'), 'Change') as HTMLButtonElement;
  change.type = 'button';
  change.title = 'Change where its tickets come from, its board, or its sign-in';
  change.addEventListener('click', () => api.postMessage({ type: 'toolbar', command: 'acc.trackers.add', arg: JSON.stringify({ root, index: b.index }) }));
  tools.push(change);
  const out = el('section', 'tracker',
    el('div', 'tracker-head',
      el('h2', '', icon(KIND_ICON[b.kind] ?? 'issues'), b.title, b.source ? el('span', 'chip', SOURCE_LABEL[b.source] ?? b.source) : null, b.signedInAs && !b.signIn ? el('span', 'acting', icon('account'), `as ${b.signedInAs}`) : null, b.loading ? el('span', 'muted loading', icon('sync~spin'), 'Loading') : null),
      el('div', 'toolbar', ...tools)));
  // Where its tickets come from (D-072): only these are shown, tracked or taken in.
  if (b.place) out.append(el('p', 'tracker-place', icon('filter'), el('span', '', 'Tickets from ', el('strong', '', b.place))));
  // Who it's signed in as, and whether every project on the site shares that sign-in (GH-79).
  if (b.signIn) out.append(el('p', 'tracker-place tracker-signin', icon(b.signIn.icon, b.signIn.tone), el('span', '', b.signIn.label)));
  if (b.left.length) {
    out.append(el('div', 'notice attention left-place', icon('warning', 'orange'),
      el('div', 'left-text', el('strong', '', `Left this repo's place after work started: ${plural(b.left.length, 'task')}`),
        el('ul', '', ...b.left.map((n) => el('li', '', n))),
        el('span', 'muted', 'They stay on the agent board, for you to finish or set aside.'))));
  }
  if (b.error) {
    const fix = b.connect ? el('button', 'btn primary', icon('plug'), b.connect.label) as HTMLButtonElement : null;
    if (fix && b.connect) { fix.type = 'button'; const c = b.connect; fix.addEventListener('click', () => api.postMessage({ type: 'toolbar', command: c.command, arg: c.arg })); }
    out.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', b.error), fix));
  }
  if (b.notice) out.append(el('div', 'notice', icon('info'), el('span', '', b.notice)));
  if (!b.columns.length) {
    if (!b.error) out.append(el('p', 'muted', b.loading ? 'Loading the board…' : 'This board has no columns.'));
    return out;
  }
  const board = el('div', 'board');
  for (const c of b.columns) {
    const col = el('section', `column tone-edge-${c.tone}${c.done ? ' done-col' : ''}`, el('h2', '', icon(c.icon, c.tone), c.name, el('span', 'count', String(c.cards.length))));
    col.setAttribute('aria-label', `${c.name}: ${plural(c.cards.length, 'ticket')}`);
    col.dataset.col = c.id;
    for (const card of c.cards) col.append(trackerCard(root, b, card));
    if (!c.cards.length) col.append(el('p', 'muted drop-hint', 'Nothing here'));
    col.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('text/x-acc-card')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drop-target');
    });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget as Node)) col.classList.remove('drop-target'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop-target');
      const key = e.dataTransfer?.getData('text/x-acc-card');
      const moved = key ? board.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
      if (!key || !moved || moved.closest('.column') === col) return;
      // Shown in place at once; the board reloads from the tracker, or snaps back if the move is refused.
      col.querySelector('.drop-hint')?.remove();
      col.append(moved);
      api.postMessage({ type: 'move', project: root, tracker: b.index, key, to: c.id });
    });
    board.append(col);
  }
  out.append(board);
  return out;
}

export const area: PageArea = {
  sections: { tasks: { draw: (m) => renderTasks(m.tasks), fill: true } },
  views: { tasks: renderTasks },
};
