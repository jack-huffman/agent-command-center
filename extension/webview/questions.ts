// Agents' questions: a permission prompt or a question, answered in place.

import type { QuestionCard } from '../src/model/questions.ts';
import { button, type Child, el, icon, keptInput, when, work } from './dom.ts';
import { api, type Draft, memory, type PageArea, remember, state } from './state.ts';
import { pending } from './updates.ts';

// ---------------------------------------------------------------- agents' questions (D-030)

const emptyDraft = (): Draft => ({ picks: {}, other: {}, denying: false, reason: '', sent: false });
function draftOf(id: string): Draft {
  return memory().answers[id] ?? emptyDraft();
}
function saveDraft(id: string, change: (d: Draft) => void): void {
  remember((m) => { const d = m.answers[id] ?? emptyDraft(); change(d); m.answers[id] = d; });
}

/** Sends an answer, and shows it's on its way until the question leaves the page. */
function sendAnswer(q: QuestionCard, msg: Record<string, unknown>): void {
  saveDraft(q.id, (d) => { d.sent = true; });
  api.postMessage({ type: 'answer', id: q.id, ...msg });
  if (state.last) state.draw(state.last);
}

/**
 * An agent's question, to answer where it's shown: Allow or Deny for a permission prompt, its options for
 * a question. "In the terminal" hands it back to Claude Code's own prompt.
 */
export function questionCard(q: QuestionCard, opts: { watch: boolean; claudeInHeader?: boolean }): HTMLElement {
  const d = draftOf(q.id);
  // The bell and the words say it needs you; the orange edge only adds to them.
  const head = el('div', 'q-head',
    el('div', 'q-who', icon('bell', 'orange'), el('strong', '', q.who), el('span', '', q.title), q.projectName ? el('span', 'muted', `· ${q.projectName}`) : null),
    when(new Date(q.askedAt).toISOString()));
  const card = el('article', `question${d.sent ? ' sent' : ''}`, head);
  card.setAttribute('aria-label', `${q.who} ${q.title}`);
  // In progress's Answer brings this card into view (D-092).
  card.dataset.question = q.id;
  const tools: Child[] = [];
  const watch = opts.watch ? button('Watch', 'pulse', () => api.postMessage({ type: 'run', command: 'acc.agent.watch', ref: { session: q.session } }), 'ghost small') : null;
  // The agent's page has In Claude Code in its header, so its cards leave that one out (T-47). "In the terminal" stays on the card: it also releases the waiting hook, which the header's Attach doesn't.
  const inClaude = opts.claudeInHeader ? null : button('In Claude Code', 'comment-discussion', () => api.postMessage({ type: 'run', command: 'acc.agent.openInClaude', ref: { session: q.session } }), 'ghost small');
  if (inClaude) inClaude.title = 'Take its conversation over in a Claude Code tab: it stops in the background, and you carry on there';
  const inTerminal = button('In the terminal', 'terminal', () => sendAnswer(q, { decision: 'terminal' }), 'ghost small');
  inTerminal.title = 'Answer in Claude Code\'s own prompt instead: a terminal attaches to the session';
  const terminal = el('span', 'q-aside-group', inClaude, inTerminal);

  if (q.kind === 'permission') {
    if (q.detail && q.code) card.append(el('p', 'q-detail', q.detail));
    if (q.code) card.append(work(el('pre', 'q-code', q.code), 'transcript'));
    else if (q.detail) card.append(el('div', 'q-detail q-plan', q.detail));
    // Every answer its own prompt offers, numbered as there: click one, or press its number (D-038).
    const pending = q.choices.find((c) => c.key === d.choice && c.needs);
    if (pending) {
      const isCommand = pending.needs === 'command';
      const value = isCommand ? d.command ?? q.code ?? '' : d.reason;
      const box = document.createElement('textarea');
      box.className = `text-input q-words${isCommand ? ' mono' : ''}`;
      box.rows = isCommand ? Math.min(8, Math.max(2, value.split('\n').length)) : 2;
      box.value = value;
      box.dataset.keep = `${pending.key}:${q.id}`;
      box.placeholder = pending.needs === 'feedback' ? 'What should change in the plan?' : isCommand ? 'The command as it should run' : 'Tell it why, or what to do instead (optional)';
      box.setAttribute('aria-label', box.placeholder);
      const send = () => {
        const v = box.value.trim();
        if (isCommand && !v) return;
        sendAnswer(q, isCommand ? { ...pending.answer, command: v } : { ...pending.answer, message: v });
      };
      box.addEventListener('input', () => saveDraft(q.id, (x) => { if (isCommand) x.command = box.value; else x.reason = box.value; }));
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !isCommand)) { e.preventDefault(); send(); } if (e.key === 'Escape') { saveDraft(q.id, (x) => { x.choice = undefined; }); if (state.last) state.draw(state.last); } });
      card.append(el('div', 'q-deny', el('div', 'q-pending', icon(pending.icon), el('span', 'strong', pending.label.replace(/…$/, ''))), box, el('div', 'actions',
        button(isCommand ? 'Allow my version' : pending.needs === 'feedback' ? 'Keep planning' : 'Send', isCommand ? 'check' : 'send', send, 'primary'),
        button('Back', 'arrow-left', () => { saveDraft(q.id, (x) => { x.choice = undefined; }); if (state.last) state.draw(state.last); }))));
      requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) box.focus(); });
    } else {
      const list = el('ol', 'q-choices');
      list.setAttribute('aria-label', 'Answers');
      const pick = (c: typeof q.choices[number]) => {
        if (c.needs) { saveDraft(q.id, (x) => { x.choice = c.key; }); if (state.last) state.draw(state.last); return; }
        sendAnswer(q, c.answer);
      };
      q.choices.forEach((c, i) => {
        // One line each; what it means shows on hover and is read out, so the card stays short.
        const words = c.label.split(/`([^`]+)`/).map((part, j) => (j % 2 ? el('code', 'q-rule', part) : document.createTextNode(part)));
        const b = el('button', `q-choice${c.primary ? ' primary' : ''}`, el('span', 'q-num', String(i + 1)), icon(c.icon), el('span', 'q-choice-text', ...words)) as HTMLButtonElement;
        b.type = 'button';
        if (c.hint) { b.title = c.hint; b.setAttribute('aria-description', c.hint); }
        b.addEventListener('click', () => pick(c));
        list.append(el('li', '', b));
      });
      card.append(list);
      card.tabIndex = -1;
      card.addEventListener('keydown', (e) => {
        if ((e.target as HTMLElement).closest('input, textarea')) return;
        const n = Number(e.key);
        const c = Number.isInteger(n) && n >= 1 ? q.choices[n - 1] : undefined;
        if (c) { e.preventDefault(); pick(c); }
      });
      tools.push(el('span', 'q-aside', terminal, watch));
    }
  } else {
    const answered = (i: number) => (d.picks[i]?.length ?? 0) > 0 || !!d.other[i]?.trim();
    q.questions.forEach((x, i) => {
      const set = el('fieldset', 'q-set', el('legend', '', x.header ? el('span', 'chip q-chip', x.header) : null, el('span', 'q-question', x.question)));
      const opts = el('div', 'q-options');
      opts.setAttribute('role', x.multiSelect ? 'group' : 'radiogroup');
      for (const o of x.options) {
        const on = d.picks[i]?.includes(o.label) ?? false;
        const b = el('button', `q-option${on ? ' on' : ''}`, icon(x.multiSelect ? (on ? 'pass-filled' : 'circle-large-outline') : (on ? 'circle-filled' : 'circle-large-outline'), on ? 'blue' : undefined),
          el('span', 'q-option-text', el('span', 'strong', o.label), o.description ? el('span', 'muted small', o.description) : null)) as HTMLButtonElement;
        b.type = 'button';
        b.setAttribute('role', x.multiSelect ? 'checkbox' : 'radio');
        b.setAttribute('aria-checked', String(on));
        b.addEventListener('click', () => {
          saveDraft(q.id, (dd) => {
            const now = dd.picks[i] ?? [];
            dd.picks[i] = x.multiSelect ? (now.includes(o.label) ? now.filter((l) => l !== o.label) : [...now, o.label]) : [o.label];
            if (!x.multiSelect) dd.other[i] = '';
          });
          if (state.last) state.draw(state.last);
        });
        opts.append(b);
      }
      const other = keptInput(`other:${q.id}:${i}`, d.other[i] ?? '', 'Or type your own answer', (v) => {
        saveDraft(q.id, (dd) => { dd.other[i] = v; if (v.trim() && !x.multiSelect) dd.picks[i] = []; });
        const sendBtn = card.querySelector<HTMLButtonElement>('.q-send');
        if (sendBtn) sendBtn.disabled = !q.questions.every((_, k) => (k === i ? !!v.trim() || (draftOf(q.id).picks[k]?.length ?? 0) > 0 : answered(k)));
      });
      set.append(opts, other);
      card.append(set);
    });
    const send = button(q.questions.length > 1 ? 'Send answers' : 'Send answer', 'send', () => {
      const dd = draftOf(q.id);
      const answers: Record<string, string> = {};
      q.questions.forEach((x, i) => { answers[x.question] = dd.other[i]?.trim() || (dd.picks[i] ?? []).join(', '); });
      sendAnswer(q, { decision: 'allow', answers });
    }, 'primary q-send');
    send.disabled = !q.questions.every((_, i) => answered(i));
    const decide = button('Let it decide', 'sparkle', () => sendAnswer(q, { decision: 'deny', message: 'They chose not to answer: decide for yourself, and say what you chose.' }));
    tools.push(send, decide, el('span', 'q-aside', terminal, watch));
  }
  if (d.sent) card.append(el('div', 'q-sending muted', icon('sync~spin'), 'Sending your answer…'));
  else if (tools.length) card.append(el('div', 'actions q-actions', ...tools));
  return card;
}

export const area: PageArea = {
  after(model) {
    // Half-written answers to questions that have gone are dropped.
    const asked = model.kind === 'home' ? model.overview.questions : model.kind === 'agent' ? model.questions : null;
    if (asked) {
      const ids = new Set(asked.map((q) => q.id));
      if (Object.keys(memory().answers).some((k) => !ids.has(k))) remember((x) => { for (const k of Object.keys(x.answers)) if (!ids.has(k)) delete x.answers[k]; });
    }
  },
};
