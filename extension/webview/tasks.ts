// The Tasks section: My work, the tasks added to the Command Center, and each tracker's own board.

import { addAnother } from '../src/model/add-board.ts';
import type { TrackerBoard, TrackerCard, Who } from '../src/model/boards.ts';
import type { TasksModel } from '../src/model/tasks.ts';
import { boardKeys, liveLine } from './board-nav.ts';
import { boardChoice, boardCounts, boardOpen, boardSwitch, tellShown, toggleBoard } from './board-switch.ts';
import { cardFoot, cardMenu, moreMenu, nextStep } from './boards.ts';
import { shows } from './person-filter.ts';
import { personFilter } from './person-menu.ts';
import { fitLabels } from './fit-labels.ts';
import { argButton, avatar, button, type Child, el, empty, header, icon, keptInput, labelChips, peekable, plural, stateChip, status, titled, toolbarButton, typeMark } from './dom.ts';
import { api, go, memory, type PageArea, remember, state } from './state.ts';
import { firstSteps } from './first-steps.ts';
import { addToWorkTitle, WORDS } from './plain-words.ts';

export function renderTasks(m: TasksModel): Node[] {
  if (!m.projects.length) return [header('Tasks', 'No onboarded project in this workspace.'), empty('Onboard this folder to start tracking tasks.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  // How it works, in five steps, under the first header, the first time a tracker's board is here (T-96).
  let intro = m.projects.some((p) => p.boards.length) ? firstSteps() : null;
  const once = (): HTMLElement | null => { const i = intro; intro = null; return i; };
  return m.projects.map((p) => {
    const tools: Child[] = [toolbarButton('acc.task.add', 'Add task', 'add', p.root)];
    // With a tracker's board on show, its tickets come from the board (Add to my work on a card), not an import.
    if (!p.boards.length) {
      if (p.github) tools.push(toolbarButton('acc.task.importGithub', 'Import GitHub issues', 'github', p.root));
      tools.push(toolbarButton('acc.task.importJira', 'Connect Jira', 'plug', p.root));
    }
    const ready = p.columns.find((c) => c.group === 'ready')?.cards.length ?? 0;
    const needs = p.columns.find((c) => c.group === 'needs-you')?.cards.length ?? 0;
    const summary = p.total ? `${p.name}: ${plural(p.total, 'task')}, ${ready} ready${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}.` : `${p.name}: no tasks yet.`;
    if (p.boards.length) {
      // Which board is on show (T-127): the one kept for this project while it's there, else the first.
      const choice = boardChoice(p.boards, memory().modes[p.root]);
      tellShown(p.root, choice);
      tools.unshift(boardSwitch(p.root, p.boards, choice, (k) => KIND_ICON[k] ?? 'issues'));
      // Another tracker for this project, of any kind (T-127): the Connect page adds it as another board.
      tools.push(argButton('acc.trackers.add', 'Add a board', 'add', addAnother(p.root)));
      if (choice !== 'agents') {
        const shown = choice === 'all' ? p.boards : p.boards.filter((b) => `board:${b.id}` === choice);
        // A ticket two boards show is one task: All boards counts it, and whether it needs you, once.
        const keys = (keep: (x: TrackerCard) => boolean) => new Set(shown.flatMap((b) => b.columns.flatMap((c) => c.cards.filter(keep).map((x) => x.key.toUpperCase())))).size;
        const cards = choice === 'all' ? keys(() => true) : shown[0]!.tickets;
        const waiting = keys((x) => !!x.acc?.needsYou);
        const where = choice === 'all' ? `on ${plural(shown.length, 'board')}` : `on ${shown[0]!.name}`;
        // The header counts the board on show (T-127). A Slack channel with no board to count (T-31) counts its tasks instead.
        // A board that couldn't be read says so, not that it holds no tickets.
        const unread = choice !== 'all' && shown[0]!.error && !shown[0]!.columns.length;
        const counted = unread ? `${p.name}: ${shown[0]!.name} can't be read now.`
          : shown.some((b) => !b.paste || b.columns.length) ? `${p.name}: ${plural(cards, 'ticket')} ${where}${waiting ? `, ${waiting} need${waiting === 1 ? 's' : ''} you` : ''}.` : summary;
        const head = header(m.projects.length > 1 ? `Tasks · ${p.name}` : 'Tasks', counted, ...tools);
        // All boards (T-127): each folded to its heading and counts until it's opened, so ten don't run on for pages.
        return el('div', 'project', head, once(), ...shown.map((b) => renderTrackerBoard(p.root, b, choice === 'all' ? { open: boardOpen(p.root, b.id), toggle: () => toggleBoard(p.root, b.id) } : undefined)));
      }
    }
    const board = el('div', 'board agent-board');
    // Its person filter (T-79), by who dispatched each task: Mine is this person's own dispatches.
    const filter = p.total ? personFilter(`agents:${p.root}`, p.columns.flatMap((c) => c.cards), p.me) : null;
    if (filter) tools.push(filter.control);
    const showing = (card: { people: Who[] }): boolean => !filter || shows(filter.choice, card.people, p.me);
    // A drop and Enter on a held card (T-54) send the same move.
    const moveTask = (task: string, to: string): void => api.postMessage({ type: 'move-task', project: p.root, task, to });
    for (const c of p.columns) {
      const cards = c.cards.filter(showing);
      // Its heading is its state chip (T-91), as a tracker board's columns are.
      const col = el('section', `column tone-edge-${c.tone}`, el('h2', 'column-head', stateChip(c), el('span', 'count', String(cards.length))));
      col.setAttribute('aria-label', `${c.label}: ${plural(cards.length, 'task')}`);
      col.dataset.group = c.group;
      if (!cards.length) col.append(el('p', 'muted drop-hint', 'Nothing here'));
      for (const card of cards) {
        // Drag a card to another lane to move it (D-041), so the cards need no Move button.
        const art = el('article', `card${c.group === 'done' ? ' done' : ''}`,
          el('div', 'card-id', card.id, el('span', 'chip', card.environment)),
          // A click opens it over the board; the modal's Open as tab opens its tab (GH-158).
          peekable(el('div', 'card-title', card.title), p.root, card.id),
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
          // Its agent's state and its analysis's are state chips, as every board's states are (T-94).
          card.agent ? titled(el('div', 'card-agent', el('span', 'muted', 'Agent: '), stateChip(card.agent)), card.agentName) : null,
          // Where its builder runs (GH-69): This Mac or Cloud, an icon and a label, beside the agent line.
          card.place ? el('div', 'card-where card-place', icon(card.place.icon), el('span', 'muted', card.place.label)) : null,
          // The model it runs with (D-086), in plain mono text: a name, not a state.
          card.agent && card.model ? el('div', 'card-where card-model', icon('sparkle'), el('span', 'mono muted', card.model)) : null,
          // Its analysis (D-052), in its own words: under way, waiting on you, or ready to build from.
          card.analysis ? el('div', 'card-agent', stateChip(card.analysis)) : null,
          cardFoot(card),
        );
        // Everything but the next step sits behind ⋯, in the card's corner (D-062).
        const more = moreMenu(`card:${p.root}#${card.id}`, card.id, cardMenu(card.actions));
        if (more) art.prepend(more);
        art.dataset.task = card.id;
        art.dataset.drops = card.drops.join(' ');
        art.draggable = card.drops.length > 0;
        art.setAttribute('aria-label', `${card.id}: ${card.title}. ${card.drops.length ? 'Drag it, or press Space, to move it to another lane.' : ''}`);
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
        moveTask(id, c.group);
      });
      board.append(col);
    }
    const live = liveLine(`agents:${p.root}`);
    boardKeys(board, live, {
      key: `agents:${p.root}`, column: (col) => col.dataset.group ?? '', card: (art) => art.dataset.task ?? '',
      lanes: (art) => (art.dataset.drops ?? '').split(' ').filter(Boolean), move: moveTask,
    });
    return el('div', 'project', header(m.projects.length > 1 ? `Tasks · ${p.name}` : 'Tasks', summary, ...tools), once(), ...(p.total ? [...(filter && !p.columns.some((c) => c.cards.some(showing)) ? [filter.none(board)] : []), live, board] : [empty('Tasks are tickets for agents to work on.', ...tools)]));
  });
}

const SOURCE_LABEL: Record<string, string> = { 'jira-board': 'Jira board', 'github-project': 'GitHub Project', 'github-state': 'Open and closed columns', 'azure-board': 'Azure board', 'monday-board': 'monday.com board', slack: 'Messages marked with its reaction' };
export const KIND_ICON: Record<string, string> = { github: 'github', jira: 'issues', azure: 'azure-devops', monday: 'table', slack: 'comment-discussion', acc: 'checklist' };
export const KIND_NAME: Record<string, string> = { github: 'GitHub', jira: 'Jira', azure: 'Azure DevOps', monday: 'monday.com', slack: 'Slack' };

/** How many people a tracker's card shows (T-91), and how many labels where nothing measures them (T-94). */
const CARD_MOST = 3;

/** A tracker's card on the Tasks tab, or `still` in the Connect page's preview (T-106): drawn alike, but nothing opens or moves it. */
export function trackerCard(root: string, b: TrackerBoard, c: TrackerCard, still = false): HTMLElement {
  const kind = el('span', 'tcard-type', typeMark(c.typeIcon, c.typeColor));
  kind.title = c.type ?? 'Issue';
  const prio = c.priorityIcon ? el('span', 'tcard-prio', icon(c.priorityIcon)) : null;
  if (prio) prio.title = `Priority: ${c.priority}`;
  // As many labels as fit whole (T-94), each named in its title; the rest are "+2", named in its title.
  const chips = labelChips(c.labels).map((chip, i) => titled(chip, c.labels[i]!.name));
  const more = el('span', 'label label-more');
  const labels = c.labels.length ? el('span', 'labels', ...chips, more) : null;
  if (labels) fitLabels(labels, chips, more, c.labels.map((l) => l.name), CARD_MOST);
  const people = c.assignees.length ? el('span', 'tcard-people', ...c.assignees.slice(0, CARD_MOST).map(avatar)) : null;
  // The card (T-91): its kind and key, then the people who have it and its priority at the right; its title, up to
  // three lines, whole in its title; then its labels, with their +N, on a row of their own so the +N never wraps
  // away from them. A field its tracker doesn't give leaves its place out.
  const card = el('article', `card tcard${c.acc?.needsYou ? ' attention' : ''}`,
    el('div', 'tcard-top', kind, el('span', 'tcard-key', c.key), el('span', 'spacer'), people, prio),
    titled(el('div', 'card-title tcard-title', c.title), c.fullTitle ?? c.title),
    labels ? el('div', 'tcard-foot', labels) : null,
    c.acc ? el('div', 'tcard-acc', stateChip(c.acc.look), el('span', 'spacer'), c.acc.action ? nextStep(c.acc.action) : null) : null,
    c.acc?.conflicts ? el('div', 'card-note conflict tcard-conflict', icon('warning'), el('span', '', c.acc.conflicts)) : null,
    c.acc?.failedChecks ? el('div', 'card-note conflict tcard-conflict', icon('github-action'), el('span', '', c.acc.failedChecks)) : null,
    c.track ? el('div', 'tcard-acc', el('span', 'spacer'), trackButton(root, b, c.key, c.track.busy)) : null,
    c.track?.error ? el('div', 'card-note conflict tcard-conflict', icon('warning'), el('span', '', `Couldn't track it: ${c.track.error}`)) : null,
  );
  card.dataset.key = c.key;
  if (still) { card.setAttribute('aria-description', `${c.status}.`); return card; }
  // A Slack board's cards stay in their columns (T-85): acc changes no reaction.
  card.draggable = b.moves;
  // No aria-label (T-59): what the card shows names it, its labels, people and Moving badge too. Its status,
  // which its column may share with others, is its description, before the board's keys add theirs.
  card.setAttribute('aria-description', `${c.status}.`);
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/x-acc-card', c.key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return peekable(card, root, c.key, b.index);
}

/**
 * Add to my work on a card the Command Center doesn't keep yet (D-074, T-96): one click, and it says Adding…
 * at once, until the card shows its task or why it couldn't. The extension holds that, so it outlasts a redraw, and a second
 * click does nothing.
 */
function trackButton(root: string, b: TrackerBoard, key: string, busy: boolean): HTMLButtonElement {
  const show = (on: boolean) => {
    go.replaceChildren(icon(on ? 'sync~spin' : 'add'), on ? 'Adding…' : WORDS.addToWork);
    go.disabled = on;
    go.setAttribute('aria-label', on ? `Adding… ${key}` : `${WORDS.addToWork}: ${key}`);
  };
  const go = button(WORDS.addToWork, 'add', () => {
    if (go.disabled) return;
    show(true);
    api.postMessage({ type: 'track', project: root, tracker: b.index, key });
  }, 'tcard-track');
  go.title = addToWorkTitle(KIND_NAME[b.kind] ?? 'the tracker');
  show(busy);
  return go;
}

/** What each Slack tracker's box holds as it's typed, by `${root}#${index}`, so a redraw keeps it. */
const typedLinks = new Map<string, string>();

/**
 * A Slack tracker's box for a thread's link (T-31): Add to my work reads the thread and adds it. It is off
 * until there's a link, and says Adding… while it goes. Under the box: which channel the thread must be
 * in, then why the last one didn't go (orange, with a warning icon), or the key it tracked (blue, with a check).
 */
function threadLink(root: string, b: TrackerBoard, paste: NonNullable<TrackerBoard['paste']>): HTMLElement {
  const id = `${root}#${b.index}`;
  // The link last sent stays in the box until something else is typed, so a refused one can be fixed.
  if (!typedLinks.has(id) && paste.link) typedLinks.set(id, paste.link);
  const send = () => {
    const link = (typedLinks.get(id) ?? '').trim();
    if (!link || go.disabled) return;
    show(true);
    api.postMessage({ type: 'track-link', project: root, tracker: b.index, link });
  };
  const input = keptInput(`thread-link:${id}`, typedLinks.get(id) ?? '', paste.example, (v) => { typedLinks.set(id, v); show(paste.busy); }, send, 'url');
  input.id = `thread-link-${b.index}`;
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Slack thread link');
  if (paste.error) input.setAttribute('aria-invalid', 'true');
  const go = button(WORDS.addToWork, 'add', send, 'primary');
  const show = (busy: boolean) => {
    const empty = !(typedLinks.get(id) ?? '').trim();
    go.replaceChildren(icon(busy ? 'sync~spin' : 'add'), busy ? 'Adding…' : WORDS.addToWork);
    go.disabled = busy || empty;
    go.title = busy ? 'Reading the thread from Slack' : empty ? 'Paste a thread\'s link first' : 'Adds this thread to your work here, so an agent can plan it and, once you approve, build it. Nothing changes in Slack.';
  };
  show(paste.busy);
  const label = el('label', 'cfield-label', 'Thread\'s link');
  label.setAttribute('for', input.id);
  return el('div', 'thread-link',
    label,
    el('div', 'cfield-control',
      el('div', 'cfield-input', input, go),
      el('p', 'cfield-hint muted', paste.hint),
      paste.error ? el('div', 'cfield-status tone-orange', icon('warning', 'orange'), el('span', '', `Couldn't add it: ${paste.error}`)) : null,
      paste.tracked && !paste.error && !paste.busy ? el('div', 'cfield-status', icon('check', 'blue'), el('span', '', `Added ${paste.tracked} to your work. It's on ${WORDS.myWork}.`)) : null));
}

/**
 * One tracker's board. `fold`, in All boards (T-127): its heading is a button that opens or folds it, and folded it
 * shows only its heading, its counts and, when it can't be read, an orange icon.
 */
export function renderTrackerBoard(root: string, b: TrackerBoard, fold?: { open: boolean; toggle: () => void }): HTMLElement {
  if (fold && !fold.open) return el('section', 'tracker folded', el('div', 'tracker-head', foldHead(b, fold)));
  const tools: Child[] = [];
  // Its person filter (T-79): Everyone, Mine, Unassigned, or one person. A board with no columns, as a Slack box without a board, has no cards to filter.
  const filter = b.columns.length ? personFilter(`tracker:${root}#${b.index}`, b.columns.flatMap((c) => c.cards), b.me) : null;
  if (filter) tools.push(filter.control);
  if (b.url) {
    const open = el('button', 'btn ghost', icon('link-external'), `Open in ${KIND_NAME[b.kind] ?? 'the tracker'}`) as HTMLButtonElement;
    open.type = 'button';
    open.addEventListener('click', () => api.postMessage({ type: 'open', url: b.url }));
    tools.push(open);
  }
  // Its place, board or sign-in, changed on the Connect page (GH-51).
  const change = el('button', 'btn ghost', icon('settings'), 'Change') as HTMLButtonElement;
  change.type = 'button';
  change.title = b.changeTitle;
  change.addEventListener('click', () => api.postMessage({ type: 'toolbar', command: 'acc.trackers.add', arg: JSON.stringify({ root, index: b.index }) }));
  tools.push(change);
  const out = el('section', 'tracker',
    el('div', 'tracker-head',
      fold ? foldHead(b, fold) : el('h2', '', icon(KIND_ICON[b.kind] ?? 'issues'), b.name, b.loading ? el('span', 'muted loading', icon('sync~spin'), loadingWords(b)) : null),
      el('div', 'toolbar', ...tools)));
  // One quiet source line under its name (T-42): where its tickets come from (D-072) when that narrows it,
  // else what its columns are. Who it's signed in as sits in Change's title, and in Settings, Trackers.
  const source = b.place ? el('span', 'meta-item', icon('filter'), el('span', '', 'Tickets from ', el('strong', '', b.place)))
    : b.source ? el('span', 'meta-item', icon(b.source === 'github-state' ? 'list-flat' : 'project'), SOURCE_LABEL[b.source] ?? b.source) : null;
  if (source) out.append(el('div', 'tracker-meta', source));
  if (b.movedOut) {
    out.append(el('div', 'notice attention left-place', icon('warning', 'orange'),
      el('div', 'left-text', el('strong', '', b.movedOut),
        el('span', 'muted', `They stay on ${WORDS.myWork}, for you to finish or set aside.`))));
  }
  if (b.error) {
    const fix = b.connect ? argButton(b.connect.command, b.connect.label, 'plug', b.connect.arg, true) : null;
    out.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', b.error), fix));
  }
  if (b.notice) out.append(el('div', 'notice info', icon('info', 'blue'), el('span', '', b.notice)));
  // A Slack board that is off says why, and how to turn it on (T-85).
  if (b.off) out.append(el('div', 'notice info slack-off', icon('circle-slash', 'blue'), el('span', '', b.off)));
  // A Slack channel's box for a thread's link (T-31), above its board when it has one (T-85), else in its place.
  if (b.paste) {
    out.append(threadLink(root, b, b.paste));
    if (!b.columns.length) return out;
  }
  if (!b.columns.length) {
    if (!b.error) out.append(b.loading ? boardSkeleton() : el('p', 'muted', 'This board has no columns.'));
    return out;
  }
  const board = el('div', 'board');
  // Only the cards the choice shows are drawn, so the board's keys, which go between the cards on the page, skip the rest (T-79).
  const showing = (c: TrackerCard): boolean => shows(filter!.choice, c.people, b.me);
  // A board with no card at all (new, or an empty place) has nothing for the choice to hide, so it says nothing (T-79 review).
  if (b.columns.some((c) => c.cards.length) && !b.columns.some((c) => c.cards.some(showing))) out.append(filter!.none(board));
  // A drop and Enter on a held card (T-54) send the same move.
  const moveCard = (key: string, to: string): void => api.postMessage({ type: 'move', project: root, tracker: b.index, key, to });
  for (const c of b.columns) {
    // Its heading is its state chip (T-91), the same as a card's and the ticket page's, with its count.
    const cards = c.cards.filter(showing);
    const col = el('section', `column tone-edge-${c.tone}${c.done ? ' done-col' : ''}`, el('h2', 'column-head', stateChip({ label: c.name, icon: c.icon, tone: c.tone, quiet: c.quiet }), el('span', 'count', String(cards.length))));
    col.setAttribute('aria-label', `${c.name}: ${plural(cards.length, 'ticket')}`);
    col.dataset.col = c.id;
    for (const card of cards) col.append(trackerCard(root, b, card));
    if (!cards.length) col.append(el('p', 'muted drop-hint', 'Nothing here'));
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
      moveCard(key, c.id);
    });
    board.append(col);
  }
  // Any column but its own takes a ticket, as a drag drops it in any.
  const live = liveLine(`tracker:${root}#${b.index}`);
  boardKeys(board, live, {
    key: `tracker:${root}#${b.index}`, column: (col) => col.dataset.col ?? '', card: (art) => art.dataset.key ?? '',
    lanes: (art) => (b.moves ? b.columns.map((c) => c.id).filter((id) => id !== art.closest<HTMLElement>('.column')?.dataset.col) : []), move: moveCard,
  });
  out.append(live, board);
  return out;
}

/** A board's heading in All boards (T-127): a button with its name and counts, which opens or folds it. */
function foldHead(b: TrackerBoard, fold: { open: boolean; toggle: () => void }): HTMLElement {
  const counts = boardCounts(b);
  const btn = el('button', 'board-fold', icon(fold.open ? 'chevron-down' : 'chevron-right'), b.error ? icon('warning', 'orange') : icon(KIND_ICON[b.kind] ?? 'issues'),
    el('span', 'board-fold-name', b.name), el('span', `board-fold-count${counts.failed ? ' tone-orange' : ' muted'}`, counts.text)) as HTMLButtonElement;
  btn.type = 'button';
  btn.title = `${b.name}: ${counts.text}`;
  btn.setAttribute('aria-expanded', String(fold.open));
  btn.addEventListener('click', fold.toggle);
  return el('h2', 'board-fold-head', btn);
}

export const area: PageArea = {
  sections: { tasks: { draw: (m) => renderTasks(m.tasks), fill: true } },
  views: { tasks: renderTasks },
};

/** A board drawn from the repo's cache is refreshing; one with nothing yet is loading (2026-10-21). */
export const loadingWords = (b: Pick<TrackerBoard, 'columns'>): string => (b.columns.length ? 'Refreshing' : 'Loading');

/**
 * A board on its way, with nothing kept from before (2026-10-21): quiet columns of card shapes that breathe,
 * still under reduced motion, and its words for a screen reader. Once a board has loaded, the repo's cache
 * draws it at once instead.
 */
function boardSkeleton(): HTMLElement {
  const column = (cards: number) => el('div', 'skel-col', el('div', 'skel-line skel-head'),
    ...Array.from({ length: cards }, () => el('div', 'skel-card', el('div', 'skel-line short'), el('div', 'skel-line'), el('div', 'skel-line mid'))));
  const out = el('div', 'board-skeleton', el('p', 'skel-words', 'Loading the board…'), column(3), column(2), column(1));
  out.setAttribute('role', 'status');
  out.setAttribute('aria-busy', 'true');
  return out;
}
