// An agent's page: its timeline, and replying to it, laid out as Claude Code's chat (T-160, chat.ts).

import type { Look } from '../src/model/shared.ts';
import type { AgentModel, EntryView } from '../src/model/agent-page.ts';
import type { Block } from '../../packages/core/src/trackers/doc.ts';
import { actionButton, button, type Child, el, empty, foldable, icon, openable, plural, renderDoc, since, status, titled, when, work } from './dom.ts';
import { chatCard, chatExchange, chatFoot, chatLog, chatReply, chatStatus, chatStep, chatSteps, chatYou, sendButton, type StepTone } from './chat.ts';
import { questionCard } from './questions.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';

// ---------------------------------------------------------------- an agent's page (D-030)

function toolEntry(e: Extract<EntryView, { k: 'tool' }>): HTMLElement {
  const look = e.status === 'running' ? { icon: 'sync~spin', tone: 'blue', label: 'Running' } : e.status === 'error' ? { icon: 'warning', tone: 'orange', label: 'Failed' } : { icon: 'pass', tone: 'neutral', label: 'Done' };
  // Done is the usual case and needs no mark; running and failed say so, in words for screen readers.
  const mark = e.status === 'done' ? null : status({ label: look.label, icon: look.icon, tone: look.tone as Look['tone'] });
  const dot: StepTone = e.status === 'error' ? 'failed' : e.status === 'running' ? 'running' : 'done';
  const more = !!(e.code?.includes('\n') || e.result || (e.code && e.code.length > 80));
  const line = (...lead: Child[]) => [...lead, icon(e.icon), titled(el('span', 'tool-title', e.title), e.title), e.code && !e.code.includes('\n') ? work(titled(el('code', 'tool-code', e.code), e.code), 'transcript') : null, el('span', 'spacer'), mark];
  if (!more) return chatStep(dot, `entry tool static${e.status === 'error' ? ' failed' : ''}`, el('div', 'tool-line', ...line(el('span', 'tool-chev'))));
  const summary = el('summary', 'tool-line', ...line(el('span', 'tool-chev', icon('chevron-right'))));
  const details = el('details', 'tool-details', summary,
    e.code ? work(el('pre', 'tool-pre', e.code), 'transcript') : null,
    e.result ? work(el('pre', `tool-pre result${e.status === 'error' ? ' failed' : ''}`, e.result), 'output') : null,
    e.more ? el('div', 'muted small', `… ${plural(e.more, 'more line')}`) : null) as HTMLDetailsElement;
  details.open = memory().opened.includes(e.id);
  details.addEventListener('toggle', () => remember((m) => { m.opened = details.open ? [...new Set([...m.opened, e.id])].slice(-200) : m.opened.filter((x) => x !== e.id); }));
  return chatStep(dot, `entry tool${e.status === 'error' ? ' failed' : ''}`, details);
}

/** A run of tool steps in a few words: "8 steps: ran 5 commands, read 2 files, edited 1". */
function stepsSummary(items: { tool: string }[]): string {
  const n = (tools: string[]) => items.filter((t) => tools.includes(t.tool)).length;
  const ran = n(['Bash']);
  const read = n(['Read']);
  const edited = n(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
  const searched = n(['Grep', 'Glob', 'WebSearch', 'WebFetch']);
  const other = items.length - ran - read - edited - searched;
  const parts = [ran ? `ran ${plural(ran, 'command')}` : '', read ? `read ${plural(read, 'file')}` : '', edited ? `edited ${edited}` : '', searched ? `searched ${searched}` : '', other ? `${other} more` : ''].filter(Boolean);
  return `${items.length} steps: ${parts.join(', ')}`;
}

export function renderAgent(m: AgentModel): Node[] {
  // The agent's name, once (D-087): it says the project, task and role. A builder's opens its task's own page.
  const named = titled(el('span', 'crumb-name', m.name), m.name);
  const name = m.task ? openable(named, { type: 'run', command: 'acc.task.show', ref: { project: m.task.project, task: m.task.id } }) : named;
  const crumbs = el('div', 'crumbs', icon('hubot'), name);
  const facts = el('div', 'agent-facts muted small',
    m.startedAt ? el('span', '', `Started ${since(m.startedAt)}`) : null,
    m.model ? el('span', '', el('span', 'sep', '·'), el('span', 'mono', m.model)) : null,
    m.lastAt ? el('span', '', el('span', 'sep', '·'), 'last active ', when(m.lastAt)) : null,
    m.where ? el('span', '', el('span', 'sep', '·'), Object.assign(el('span', '', m.where), { title: m.path })) : null);
  // Stop ends the agent's work, so it stands apart from the buttons that only open things (T-47): at the far end of the bar, after a rule.
  const stop = m.actions.find((a) => a.command === 'acc.agent.stop');
  const bar = el('div', 'ticket-bar', status(m.look), el('span', 'spacer'),
    el('div', 'actions', ...m.actions.filter((a) => a !== stop).map(actionButton)),
    stop ? el('div', 'actions actions-stop', actionButton(stop)) : null);
  const out: Node[] = [el('header', 'ticket-head agent-head', crumbs, el('h1', 'ticket-title', m.task?.title ?? m.name), facts, bar)];
  // In Claude Code is in the header when it has it: a card doesn't repeat it. The card keeps In the terminal, which hands a question back.
  const claudeInHeader = m.actions.some((a) => a.command === 'acc.agent.openInClaude');
  const asks = m.questions.length ? el('section', 'agent-asks', ...m.questions.map((q) => questionCard(q, { watch: false, claudeInHeader }))) : null;
  const recap = [...m.entries].reverse().find((e) => e.k === 'recap');
  const recapNote = recap && recap.k === 'recap' ? foldable(`recap:${m.key}`, el('div', 'notice recap', icon('info', 'blue'), el('div', 'why-text', el('strong', '', 'Where it got to: '), recap.text)), 'why-text', 2) : null;
  if (!m.readable) {
    out.push(chatLog('Its activity', recapNote, empty(m.live ? 'Its activity will show here as it works. Nothing is recorded yet.' : 'There\'s no record of this session\'s activity to show.',
      ...m.actions.filter((a) => a.command === 'acc.agent.attach').map(actionButton)), asks));
    out.push(chatFoot(m.reply ? agentReply(m, m.reply) : null));
    return out;
  }
  // Runs of tool steps fold to one line each, except the latest run and any of two steps or fewer. A folded
  // run with a failed or running step says so on its line.
  type Tool = Extract<EntryView, { k: 'tool' }>;
  type Block = Exclude<EntryView, Tool> | { k: 'steps'; id: string; items: Tool[] };
  const blocks: Block[] = [];
  for (const e of m.entries) {
    if (e.k === 'recap') continue;
    const prev = blocks[blocks.length - 1];
    if (e.k === 'tool') { if (prev?.k === 'steps') prev.items.push(e); else blocks.push({ k: 'steps', id: `steps:${e.id}`, items: [e] }); }
    else blocks.push(e);
  }
  // The last 25 blocks, with the rest a click away.
  const showKey = `earlier:${m.key}`;
  const showAll = memory().opened.includes(showKey);
  const shown = showAll ? blocks : blocks.slice(-25);
  const list = el('div', 'timeline');
  if (shown.length < blocks.length || m.hidden) {
    list.append(el('div', 'entry earlier', button(`Show ${plural(blocks.length - shown.length + m.hidden, 'earlier step')}`, 'chevron-up', () => { remember((x) => { x.opened = [...x.opened, showKey]; }); if (state.last) state.draw(state.last); }, 'ghost small')));
  }
  // As a chat (T-160): each prompt starts an exchange, its words boxed and pinned; what the agent said runs the
  // full width under it, and its steps and the person's answers hang on a line, a dot each.
  let exchange: HTMLElement | null = null;
  let steps: HTMLElement | null = null;
  const reply = (): HTMLElement => { if (!exchange) { exchange = chatExchange(null); list.append(exchange); } return exchange; };
  const step = (li: HTMLElement): void => { if (!steps) { steps = chatSteps(); reply().append(steps); } steps.append(li); };
  const lastSteps = [...shown].reverse().find((b) => b.k === 'steps');
  for (const e of shown) {
    if (e.k === 'recap') continue;
    if (e.k === 'steps') {
      const loud = e.items.filter((t) => t.status !== 'done');
      if (e === lastSteps || e.items.length <= 2) { for (const t of e.items) step(toolEntry(t)); continue; }
      const failed = loud.some((t) => t.status === 'error');
      const d = el('details', 'steps-details', el('summary', 'tool-line', el('span', 'tool-chev', icon('chevron-right')), icon('list-flat'),
        titled(el('span', 'tool-title', stepsSummary(e.items)), stepsSummary(e.items)), el('span', 'spacer'), loud.length ? status({ label: failed ? `${loud.length} failed` : 'Running', icon: failed ? 'warning' : 'sync~spin', tone: failed ? 'orange' : 'blue' }) : null)) as HTMLDetailsElement;
      d.open = memory().opened.includes(e.id);
      d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, e.id])] : x.opened.filter((y) => y !== e.id); }));
      d.addEventListener('toggle', () => { if (d.open && !d.querySelector('ol')) d.append(el('ol', 'steps-list chat-steps', ...e.items.map(toolEntry))); });
      if (d.open) d.append(el('ol', 'steps-list chat-steps', ...e.items.map(toolEntry)));
      step(chatStep(failed ? 'failed' : loud.length ? 'running' : 'done', 'entry tool steps', d));
      continue;
    }
    if (e.k === 'decision') {
      // Your part of the conversation: what it asked, and what you said, as one step that opens.
      const d = e.decision;
      const fold = el('details', 'tool-details decision-details', el('summary', 'tool-line', el('span', 'tool-chev', icon('chevron-right')), icon('account'),
        titled(el('span', 'tool-title', `It ${d.asked}`), `It ${d.asked}`), el('span', 'spacer'), status(d.look), e.at ? when(e.at) : null),
      el('div', 'decision-body', d.code ? work(el('pre', 'q-code', d.code), 'transcript') : null, d.detail ? el('div', 'history-detail', d.detail) : null)) as HTMLDetailsElement;
      fold.open = memory().opened.includes(e.id);
      fold.addEventListener('toggle', () => remember((x) => { x.opened = fold.open ? [...new Set([...x.opened, e.id])] : x.opened.filter((y) => y !== e.id); }));
      step(chatStep('done', `entry decision tone-row-${d.look.tone}`, fold));
      continue;
    }
    steps = null;
    const said = e.k === 'prompt' && e.instructions ? null : work(renderDoc(e.body, ''), 'transcript');
    if (e.k === 'prompt') {
      // The task's instructions are what it was asked first: long, so folded in the box.
      let body = said;
      if (!body) {
        const d = el('details', 'prompt-details', el('summary', '', icon('note'), el('strong', '', 'Task instructions'), el('span', 'muted small', ' · what it was given to do')), work(renderDoc(e.body, ''), 'agent-text')) as HTMLDetailsElement;
        d.open = memory().opened.includes(e.id);
        d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, e.id])] : x.opened.filter((y) => y !== e.id); }));
        body = d;
      }
      const you = chatYou(e.instructions ? 'Task instructions' : 'Asked', null, body);
      you.classList.add('entry', 'prompt');
      exchange = chatExchange(you);
      list.append(exchange);
      continue;
    }
    reply().append(chatReply('entry say', said));
  }
  const attach = m.actions.filter((a) => a.command === 'acc.agent.attach').map(actionButton);
  // The status line, over the message box: working, waiting in its own terminal, or ended.
  const tail = m.look.tone === 'blue' && m.live ? chatStatus('sync~spin', 'blue', '', 'Working…')
    : m.look.tone === 'orange' && !m.questions.length ? chatStatus('bell', 'orange', '', `${m.look.label}. It's waiting in its own terminal.`, ...attach)
      : !m.live ? chatStatus('circle-slash', undefined, 'muted', 'The session has ended.') : null;
  // The agent's questions go under its latest reply.
  if (asks) reply().append(asks);
  out.push(chatLog('Its activity', recapNote, list));
  out.push(chatFoot(tail, m.reply ? agentReply(m, m.reply) : null));
  return out;
}

/**
 * Writing to an agent from its page (D-060), as the message card under the chat (T-160). What you send goes to
 * its own session, in its own folder; its answer streams into the chat above. Kept while the page redraws.
 */
function agentReply(m: AgentModel, r: NonNullable<AgentModel['reply']>): HTMLElement {
  const key = `reply:${m.key}`;
  const box = el('textarea', 'reply-box') as HTMLTextAreaElement;
  box.dataset.keep = key;
  box.rows = 2;
  box.placeholder = `Write to ${m.task?.id ?? m.name}…`;
  box.disabled = !r.can;
  box.value = memory().drafts[key] ?? '';
  box.setAttribute('aria-label', `Message to ${m.task?.id ?? m.name}`);
  box.addEventListener('input', () => remember((x) => { x.drafts[key] = box.value; }));
  const send = sendButton(box, {
    why: r.can ? null : r.hint,
    go: () => {
      const text = box.value.trim();
      if (!text || !r.can) return;
      api.postMessage({ type: 'agent-reply', text });
      box.value = '';
      box.dispatchEvent(new Event('input'));
      remember((x) => { delete x.drafts[key]; });
    },
  });
  const hint = r.can ? el('span', 'muted small', r.hint) : el('span', 'muted small reply-why', icon('info'), r.hint);
  return el('div', 'agent-reply', chatCard({ box, left: [hint], send }));
}

export const area: PageArea = {
  views: { agent: renderAgent },
};
