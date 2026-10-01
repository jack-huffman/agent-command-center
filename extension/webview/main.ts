// Renders one editor tab. Every element is built with DOM calls and every string is set as text,
// so nothing from a ticket, branch or session can become markup. No HTML string is ever parsed.
import type {
  Action, AgentsModel, EnvironmentsModel, Look, Model, SetupModel, TasksModel, ViewKind, WorktreesModel,
} from '../src/model.ts';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const api = acquireVsCodeApi();
const app = document.getElementById('app')!;
const view = document.body.dataset.view as ViewKind;

type Child = Node | string | null | undefined | false;

function el(tag: string, cls = '', ...children: Child[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) if (c) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function icon(name: string, tone?: string): HTMLElement {
  const i = el('span', `codicon codicon-${name.replace(/~spin$/, '')}${name.endsWith('~spin') ? ' codicon-modifier-spin' : ''}${tone && tone !== 'neutral' ? ` tone-${tone}` : ''}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** A status always has words; the icon and colour only add to them. */
function status(look: Look): HTMLElement {
  return el('span', `status tone-${look.tone}`, icon(look.icon, look.tone), look.label);
}

function actionButton(a: Action): HTMLElement {
  const b = el('button', `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`, icon(a.icon), a.label) as HTMLButtonElement;
  b.type = 'button';
  b.title = a.label;
  b.addEventListener('click', () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }));
  return b;
}

function toolbarButton(command: string, label: string, iconName: string, project?: string, primary = false): HTMLElement {
  const b = el('button', `btn${primary ? ' primary' : ''}`, icon(iconName), label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => api.postMessage({ type: 'toolbar', command, project }));
  return b;
}

function header(title: string, summary: string, ...tools: Child[]): HTMLElement {
  const refresh = el('button', 'btn ghost', icon('refresh'), 'Refresh') as HTMLButtonElement;
  refresh.type = 'button';
  refresh.addEventListener('click', () => api.postMessage({ type: 'refresh' }));
  return el('header', 'page-header', el('div', 'titles', el('h1', '', title), el('p', 'summary', summary)), el('div', 'toolbar', ...tools, refresh));
}

function empty(text: string, ...tools: Child[]): HTMLElement {
  return el('div', 'empty', el('p', '', text), el('div', 'toolbar', ...tools));
}

/** A cell that truncates with an ellipsis and shows the full text on hover. */
function clipped(text: string, cls = ''): HTMLElement {
  const td = el('td', `clip ${cls}`.trim(), text);
  td.title = text;
  return td;
}

/** Tables scroll sideways in a narrow tab instead of squeezing or wrapping their cells. */
const wrap = (table: HTMLElement): HTMLElement => el('div', 'table-wrap', table);

function since(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- views

function renderTasks(m: TasksModel): Node[] {
  if (!m.projects.length) return [header('Tasks', 'No onboarded project in this workspace.'), empty('Onboard this folder to start tracking tasks.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  return m.projects.map((p) => {
    const tools: Child[] = [toolbarButton('acc.task.add', 'Add task', 'add', p.root, true)];
    if (p.github) tools.push(toolbarButton('acc.task.importGithub', 'Import GitHub issues', 'github', p.root));
    tools.push(toolbarButton('acc.task.importJira', 'Jira', 'cloud-download', p.root));
    const ready = p.columns.find((c) => c.group === 'ready')?.cards.length ?? 0;
    const needs = p.columns.find((c) => c.group === 'needs-you')?.cards.length ?? 0;
    const summary = p.total ? `${p.name}: ${plural(p.total, 'task')}, ${ready} ready${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}. Dispatching to agents arrives with M3.` : `${p.name}: no tasks yet.`;
    const board = el('div', 'board');
    for (const c of p.columns) {
      const col = el('section', `column tone-edge-${c.tone}`, el('h2', '', icon(c.icon, c.tone), c.label, el('span', 'count', String(c.cards.length))));
      col.setAttribute('aria-label', `${c.label}: ${plural(c.cards.length, 'task')}`);
      if (!c.cards.length) col.append(el('p', 'muted', 'Nothing here'));
      for (const card of c.cards) {
        col.append(el('article', `card${c.group === 'done' ? ' done' : ''}`,
          el('div', 'card-id', card.id, el('span', 'chip', card.environment)),
          el('div', 'card-title', card.title),
          card.waitingOn.length ? el('div', 'card-note', icon('clock'), `Waiting on ${card.waitingOn.join(', ')}`) : null,
          card.agent ? el('div', 'card-agent', el('span', 'muted', 'Agent: '), status(card.agent)) : null,
          card.worktree ? el('div', 'card-where mono muted', icon('git-branch'), card.worktree.split('/').slice(-2).join('/')) : null,
          el('div', 'actions', ...card.actions.map(actionButton)),
        ));
      }
      board.append(col);
    }
    return el('div', 'project', header(m.projects.length > 1 ? `Tasks · ${p.name}` : 'Tasks', summary, ...tools), p.total ? board : empty('Tasks are tickets for agents to work on.', ...tools));
  });
}

function renderAgents(m: AgentsModel): Node[] {
  const all = m.places.flatMap((p) => p.agents);
  const needs = all.filter((a) => a.needsYou).length;
  const out: Node[] = [header('Agents', m.error ?? `${plural(all.length, 'session')} on this machine${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}.`, toolbarButton('acc.agent.new', 'Start a background agent', 'add', m.places.find((p) => p.root)?.root ?? undefined, true))];
  if (!all.length) {
    out.push(empty('No Claude Code sessions are running. Background agents keep working when the terminal closes, and edit in their own worktree.'));
    return out;
  }
  for (const place of m.places) {
    if (!place.agents.length && !place.root) continue;
    const heading = el('h2', '', icon(place.root ? 'repo' : 'device-desktop'), place.label, el('span', 'count', String(place.agents.length)));
    if (!place.agents.length) {
      out.push(el('section', 'block', heading, el('p', 'muted quiet', 'No agent sessions in this project right now.')));
      continue;
    }
    const table = el('table', 'grid');
    table.append(el('thead', '', el('tr', '', ...[['Session', ''], ['State', ''], ['Kind', ''], ['Where', 'wide'], ['Started', ''], ['', '']].map(([h, c]) => el('th', c!, h!)))));
    const body = el('tbody');
    for (const a of place.agents) {
      body.append(el('tr', a.needsYou ? 'attention' : '',
        el('td', 'strong nowrap', a.name), el('td', 'nowrap', status(a.look)), el('td', 'nowrap muted', a.kind), clipped(a.where, 'mono'), el('td', 'nowrap muted', since(a.startedAt)),
        el('td', 'actions', ...a.actions.map(actionButton))));
    }
    table.append(body);
    out.push(el('section', 'block', heading, wrap(table)));
  }
  return out;
}

function renderWorktrees(m: WorktreesModel): Node[] {
  if (!m.projects.length) return [header('Worktrees', 'No onboarded project in this workspace.'), empty('Worktrees appear here once this folder is an onboarded project.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  const out: Node[] = [header('Worktrees', 'Each checkout of the repo. Agents get their own, so your folder stays as you left it.')];
  for (const p of m.projects) {
    const table = el('table', 'grid');
    table.append(el('thead', '', el('tr', '', ...[['Branch', ''], ['Location', 'wide'], ['Changes', ''], ['', '']].map(([h, c]) => el('th', c!, h!)))));
    const body = el('tbody');
    for (const w of p.worktrees) {
      body.append(el('tr', w.state.tone === 'orange' ? 'attention' : '',
        el('td', 'strong nowrap', icon(w.main ? 'repo' : 'git-branch'), w.branch), clipped(w.place, 'mono'), el('td', 'nowrap', status(w.state)),
        el('td', 'actions', ...w.actions.map(actionButton))));
    }
    table.append(body);
    out.push(el('section', 'block', el('h2', '', icon('repo'), p.name, el('span', 'count', String(p.worktrees.length))), wrap(table)));
  }
  return out;
}

function renderEnvironments(m: EnvironmentsModel): Node[] {
  if (!m.projects.length) return [header('Environments', 'No onboarded project in this workspace.'), empty('Environments appear here once this folder is an onboarded project.', toolbarButton('acc.openProjectWalkthrough', 'Onboard this project', 'rocket', undefined, true))];
  const out: Node[] = [header('Environments', 'Each environment has its own branch, named after it. Changes move between them by pull request.')];
  for (const p of m.projects) {
    const section = el('section', 'block', el('h2', '', icon('repo'), p.name, p.github ? el('span', 'muted', ` · ${p.github}`) : null));
    if (p.paths.length) {
      const flow = el('div', 'flows');
      for (const path of p.paths) {
        const line = el('div', 'flow');
        path.forEach((b, i) => {
          if (i) line.append(el('span', 'arrow', icon('arrow-right')));
          line.append(el('span', 'flow-node', b));
        });
        flow.append(line);
      }
      section.append(el('h3', '', 'Promotion paths'), flow);
    }
    const cards = el('div', 'env-cards');
    for (const e of p.envs) {
      cards.append(el('article', `env-card${e.current ? ' current' : ''}`,
        el('div', 'env-head', icon(e.icon, e.current ? 'blue' : 'neutral'), el('span', 'strong', e.name), el('span', 'chip', e.type === 'none' ? 'branch' : e.type.replace('_', ' '))),
        el('dl', '',
          el('dt', '', 'Branch'), el('dd', 'mono', e.branch),
          el('dt', '', 'Org'), el('dd', 'mono', e.org ?? (e.type === 'none' ? '–' : 'no alias')),
          el('dt', '', 'Promotes to'), el('dd', 'mono', e.promotesTo.length ? e.promotesTo.join(', ') : '–')),
        e.badges.length ? el('div', 'badges', ...e.badges.map((b) => el('span', `badge${b === 'checked out' ? ' tone-blue' : ''}`, b))) : null,
        el('div', 'actions', ...e.actions.map(actionButton)),
      ));
    }
    section.append(cards);
    out.push(section);
  }
  return out;
}

function renderSetup(m: SetupModel): Node[] {
  const todo = m.total - m.done;
  const out: Node[] = [header('Setup', m.total ? `${m.done} of ${m.total} steps done${todo ? `. ${plural(todo, 'step')} to do.` : '. Everything is set up.'}` : 'Checking…',
    toolbarButton('acc.openProjectWalkthrough', 'Walkthrough', 'checklist'))];
  if (m.total) {
    const bar = el('div', 'progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(m.done));
    bar.setAttribute('aria-valuemax', String(m.total));
    const fill = el('div', 'progress-fill');
    fill.style.width = `${Math.round((m.done / m.total) * 100)}%`;
    bar.append(fill);
    out.push(bar);
  }
  for (const part of m.parts) {
    const list = el('ul', 'steps');
    for (const s of part.steps) {
      list.append(el('li', `step${s.look.tone === 'orange' ? ' attention' : ''}`,
        el('div', 'step-head', status(s.look), el('span', 'strong', s.title), el('span', 'muted mono', s.id)),
        el('p', 'detail', s.detail),
        s.look.tone === 'orange' && s.why ? el('p', 'why', s.why) : null,
        s.fix && s.look.tone === 'orange' ? el('pre', 'fix', s.fix) : null,
        el('div', 'actions', ...s.actions.map(actionButton))));
    }
    out.push(el('section', 'block', el('h2', '', icon(part.part === 'machine' ? 'device-desktop' : 'repo'), part.label, el('span', 'count', part.todo ? `${part.todo} to do` : 'all done')), list));
  }
  return out;
}

function render(model: Model): void {
  const scroll = { x: document.querySelector('.board')?.scrollLeft ?? 0, y: window.scrollY };
  const nodes = model.kind === 'tasks' ? renderTasks(model)
    : model.kind === 'agents' ? renderAgents(model)
      : model.kind === 'worktrees' ? renderWorktrees(model)
        : model.kind === 'environments' ? renderEnvironments(model)
          : renderSetup(model);
  app.replaceChildren(...nodes);
  const board = document.querySelector('.board');
  if (board) board.scrollLeft = scroll.x;
  window.scrollTo(0, scroll.y);
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as { type?: string; model?: Model };
  if (msg?.type === 'state' && msg.model && msg.model.kind === view) render(msg.model);
});
api.postMessage({ type: 'ready' });
