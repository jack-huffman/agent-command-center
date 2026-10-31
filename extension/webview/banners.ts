// The notices above a task page's tabs, as banners (T-168): each one line, an icon with its label, a summary and a
// chevron, closed on each new draw unless the person opened it; the tab remembers that per task, as its other
// folds. Opened, it shows the detail: a blocked note's bullets, or the files, checks or reason. Where a blocked
// note asks the person to choose, each question is a choice of its options, three at most, and the person's own
// words (D-205); Send gives the answer to the blocked builder's own session, as the Agent panel's reply does.

import type { NoteItem, NoteOption } from '../../packages/core/src/agent-notes.ts';
import type { AgentNote } from '../src/logic/relayed.ts';
import type { BlockedAnswered } from '../src/model/banners.ts';
import type { TicketAcc, TicketModel } from '../src/model/task-page.ts';
import { button, type Child, el, icon, keptInput, md, plural, work } from './dom.ts';
import { optionWords } from './note.ts';
import { Pending } from './pending.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';

export type BannerId = 'blocked' | 'conflicts' | 'checks' | 'card' | 'files';

/** One banner: its label, then its summary, which read as one sentence; and what it shows opened. */
export interface Banner {
  id: BannerId;
  icon: string;
  tone: 'orange' | 'blue' | 'neutral';
  /** The word or two that say what it is, in bold: "Blocked", "Shares". */
  label: string;
  /** What joins the label to the summary: ": " or " ". */
  sep: string;
  summary: string;
  /** A blocked note, whose bullets the open banner shows. */
  note: AgentNote | null;
  /** A sentence the open banner shows in full, such as why a card didn't move. */
  text: string | null;
  /** A list the open banner shows: files or checks. */
  lines: string[];
  /** Its lines are paths, which the words check leaves alone. */
  files: boolean;
}

/** A single choice's options, at most (D-205): the person's own words come after them. Pinned to core's OPTIONS_MAX by choice-limit.test.ts. */
export const CHOICE_MAX = 3;
/** The longest answer the page sends: core's ANSWER_MAX, which the message's check holds to. */
const ANSWER_MAX = 4000;

/** "AB-1", "AB-1 and AB-2", "AB-1, AB-2 and AB-3". */
const names = (ids: string[]): string => (ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : ids[0] ?? '');

/** "Conflicts with dev: a, b" as its head and its list. A line with no list is its head alone. */
function headAndList(line: string): { head: string; list: string[] } {
  const at = line.indexOf(': ');
  if (at < 0) return { head: line, list: [] };
  return { head: line.slice(0, at), list: line.slice(at + 2).split(', ').map((x) => x.trim()).filter(Boolean) };
}

/** The files banner: what its task shares, or waits for, or why its files aren't known (D-093), as a label and its summary. */
function filesBanner(a: Pick<TicketAcc, 'files' | 'shares'>): Banner | null {
  const look = a.files;
  if (!look) return null;
  const shares = a.shares;
  const base = { id: 'files' as const, icon: look.icon, tone: look.tone as Banner['tone'], note: null, text: null, files: true };
  const listed = shares.length > 1 ? shares.flatMap((s) => s.files.map((f) => `${s.task}: ${f}`)) : shares.flatMap((s) => s.files);
  // Sharing files with tasks in flight: "Shares 3 files with AB-20526".
  if (look.icon === 'files' && shares.length) {
    const count = shares.reduce((n, s) => n + s.files.length, 0);
    return { ...base, label: 'Shares', sep: ' ', summary: `${plural(count, 'file')} with ${names(shares.map((s) => s.task))}`, lines: listed };
  }
  // A start that failed, a wait, a start on its way, or files not known: the look's own words, its first ones as the label.
  for (const [lead, label, sep] of [['Needs you: ', 'Needs you', ': '], ['Waits ', 'Waits', ' '], ['Starting: ', 'Starting', ': ']] as const) {
    if (look.label.startsWith(lead)) return { ...base, label, sep, summary: look.label.slice(lead.length), text: look.label, lines: listed };
  }
  return { ...base, label: 'Files', sep: ': ', summary: look.label.replace(/^Its /, 'its '), text: null, lines: listed };
}

/** The banners a task's page shows above its tabs, in the order the notices were: why it's blocked first, its files last. */
export function bannersOf(a: Pick<TicketAcc, 'blocker' | 'conflicts' | 'failedChecks' | 'cardFailed' | 'files' | 'shares'> | null): Banner[] {
  if (!a) return [];
  const out: Banner[] = [];
  if (a.blocker) out.push({ id: 'blocked', icon: 'circle-slash', tone: 'orange', label: 'Blocked', sep: ': ', summary: a.blocker.headline, note: a.blocker, text: null, lines: [], files: false });
  if (a.conflicts) {
    const { head, list } = headAndList(a.conflicts);
    out.push({ id: 'conflicts', icon: 'warning', tone: 'orange', label: 'Conflicts', sep: ' ', summary: `${head.replace(/^Conflicts /, '')} in ${plural(list.length, 'file')}`, note: null, text: null, lines: list, files: true });
  }
  if (a.failedChecks) {
    const { list } = headAndList(a.failedChecks);
    out.push({ id: 'checks', icon: 'github-action', tone: 'orange', label: 'Checks failed', sep: ' ', summary: `on GitHub: ${plural(list.length, 'check')}`, note: null, text: null, lines: list, files: false });
  }
  if (a.cardFailed) out.push({ id: 'card', icon: 'project', tone: 'orange', label: 'Card', sep: ': ', summary: 'it couldn\'t move on its GitHub Project', note: null, text: a.cardFailed, lines: [], files: false });
  const files = filesBanner(a);
  if (files) out.push(files);
  return out;
}

/** Where the tab remembers a banner opened, per task. */
export const bannerKey = (m: Pick<TicketModel, 'project' | 'key'>, id: BannerId): string => `banner:${id}:${m.project}#${m.key}`;

/** An answer the page sent, kept per task and question, with the headline it answered: a new note is a new question. */
interface Sent { about: string; answer: string }
const sentKey = (m: Pick<TicketModel, 'project' | 'key'>, item: number): string => `blocked-sent:${m.project}#${m.key}:${item}`;
const pickKey = (m: Pick<TicketModel, 'project' | 'key'>, item: number): string => `blocked-pick:${m.project}#${m.key}:${item}`;
const wordsKey = (m: Pick<TicketModel, 'project' | 'key'>, item: number): string => `blocked-words:${m.project}#${m.key}:${item}`;

/** The answer sent to this question of this note, or null. One sent for an older note doesn't count. */
export function sentAnswer(m: Pick<TicketModel, 'project' | 'key'>, item: number, about: string): string | null {
  const raw = memory().drafts[sentKey(m, item)];
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Sent;
    return s.about === about ? s.answer : null;
  } catch {
    return null;
  }
}

/** Answers on their way to the builder, by sentKey, and why the last one didn't go. */
export const sending = new Pending<'answer'>();

/** The value of the own-words radio: no option's letter is a word. */
export const OWN = 'own';

/** The answer in words: the option's letter and words, or the person's own. */
export const answerWords = (pick: NoteOption | null, words: string): string => (pick ? `${pick.label}) ${optionWords(pick)}` : words.trim());

/** What the builder reads: the note's headline, the question, and the person's answer, as one message. */
export function answerText(headline: string, item: NoteItem, answer: string): string {
  const asked = item.text ? `\nYou asked: ${item.text}` : '';
  return `This is the answer to your blocked note: ${headline}${asked}\nThe answer: ${answer}`.slice(0, ANSWER_MAX);
}

/** What each answer on its way said, by sentKey: kept as sent once the extension says it went. */
const said = new Map<string, Sent>();

/** Sends the answer to item `i` of the blocked note: once at a time per question, and shown as on its way until the extension replies. */
function send(m: TicketModel, n: AgentNote, i: number, answer: string, text: string): void {
  const key = sentKey(m, i);
  if (!text.trim() || !sending.start(key, 'answer')) return;
  said.set(key, { about: n.headline, answer });
  api.postMessage({ type: 'blocked-answer', project: m.project, task: m.key, item: i, text });
  if (state.last) state.draw(state.last);
}

/** The extension's reply: the answer went, so the banner says so, or why it didn't, under its Send. A reply for nothing on its way is dropped. */
export function onAnswered(msg: BlockedAnswered): void {
  const task = { project: msg.project, key: msg.task };
  const key = sentKey(task, msg.item);
  if (!sending.what(key)) return;
  sending.settle(key, msg.ok ? null : msg.error?.trim() || 'The Command Center didn\'t say why.');
  const s = said.get(key);
  said.delete(key);
  if (msg.ok && s) {
    remember((x) => {
      x.drafts[key] = JSON.stringify(s);
      delete x.drafts[pickKey(task, msg.item)];
      delete x.drafts[wordsKey(task, msg.item)];
    });
  }
  if (state.last) state.draw(state.last);
}

/**
 * A question's choice (D-205): each of its options, three at most, as a radio with its letter and words, then the
 * person's own words, then Send. Native radios, so the arrow keys move between them and a screen reader names the
 * group by its question. Send is off, with why, until there's an answer. Once sent, the choice is the answer sent.
 */
function choice(m: TicketModel, n: AgentNote, item: NoteItem, i: number): HTMLElement {
  const sent = sentAnswer(m, i, n.headline);
  if (sent !== null) return el('p', 'banner-sent', icon('pass', 'blue'), el('span', '', 'Your answer was sent to its builder: ', md(sent)));
  const reply = m.acc!.reply;
  const options = item.options.slice(0, CHOICE_MAX);
  const name = `blocked-${m.project}#${m.key}:${i}`;
  const mem = memory().drafts;
  let pick = mem[pickKey(m, i)] ?? '';
  const group = el('fieldset', 'banner-choice');
  // The question heads the bullet, so its marker sits beside it; the group takes its name from it, for a screen reader.
  group.setAttribute('aria-label', (item.text || 'Your answer').replace(/`/g, ''));
  const radios: HTMLInputElement[] = [];
  const radio = (value: string, ...label: Child[]): HTMLElement => {
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = name;
    r.value = value;
    r.checked = pick === value;
    r.disabled = !reply.can;
    r.dataset.keep = `${name}:${value}`;
    r.addEventListener('change', () => { if (r.checked) choose(value); });
    radios.push(r);
    return el('label', `banner-option${value === OWN ? ' own' : ''}`, r, ...label);
  };
  for (const o of options) {
    group.append(radio(o.label, el('span', 'note-letter', `${o.label})`), el('span', 'banner-option-text', md(optionWords(o)), o.recommended ? el('span', 'note-rec', icon('star-full', 'blue'), 'Recommended') : null)));
  }
  const words = keptInput(wordsKey(m, i), mem[wordsKey(m, i)] ?? '', 'Write your answer', (v) => {
    remember((x) => { x.drafts[wordsKey(m, i)] = v; });
    if (v.trim() && pick !== OWN) { const own = radios.find((r) => r.value === OWN); if (own) own.checked = true; choose(OWN); } else ready();
  }, () => go());
  words.disabled = !reply.can;
  words.maxLength = 2000;
  group.append(radio(OWN, el('span', 'banner-option-text', 'In your own words')), words);
  const key = sentKey(m, i);
  const on = sending.what(key);
  const go = (): void => {
    const p = options.find((o) => o.label === pick) ?? null;
    const text = pick === OWN ? (memory().drafts[wordsKey(m, i)] ?? '') : '';
    if (!reply.can || (!p && !text.trim())) return;
    const answer = answerWords(p, text);
    send(m, n, i, answer, answerText(n.headline, item, answer));
  };
  const sendBtn = button(on ? 'Sending…' : 'Send to its builder', on ? 'sync~spin' : 'send', go, 'primary small');
  sendBtn.dataset.keep = `${name}:send`;
  const ready = (): void => {
    const why = !reply.can ? reply.why : on ? 'Your answer is on its way.' : !pick ? 'Pick an answer first.' : pick === OWN && !(memory().drafts[wordsKey(m, i)] ?? '').trim() ? 'Write your answer first.' : null;
    sendBtn.disabled = !!why;
    sendBtn.title = why ?? 'Send this answer to its builder, which carries on with it';
  };
  function choose(value: string): void {
    pick = value;
    remember((x) => { x.drafts[pickKey(m, i)] = value; });
    ready();
  }
  ready();
  const error = sending.error(key);
  const foot = el('div', 'banner-send', sendBtn,
    !reply.can ? el('span', 'muted small', icon('info'), reply.why) : null,
    error ? el('span', 'banner-error', icon('warning', 'orange'), `It wasn't sent: ${error}`) : null);
  return el('div', 'banner-answer', item.text ? el('div', 'banner-question', md(item.text)) : null, group, foot);
}

/** A blocked note's detail: each thing a bullet, and a question with options its choice. A note with no shape is its words in full. */
function noteDetail(m: TicketModel, n: AgentNote): HTMLElement {
  const items = n.shape?.items ?? [];
  if (!items.length) return el('div', 'banner-detail-text', md(n.text));
  return el('ul', 'banner-items', ...items.map((item, i) => el('li', 'banner-item', item.options.length ? choice(m, n, item, i) : md(item.text))));
}

/** Whether an answer to the note went from this page: the banner's summary says so too. */
const answered = (m: TicketModel, n: AgentNote): boolean => (n.shape?.items ?? []).some((it, i) => it.options.length > 0 && sentAnswer(m, i, n.headline) !== null);

/** One banner: a details element whose summary is the one line, closed unless the person opened it for this task. */
export function drawBanner(m: TicketModel, b: Banner): HTMLDetailsElement {
  const key = bannerKey(m, b.id);
  const sentence = `${b.label}${b.sep}${b.summary}`.replace(/`/g, '');
  const line = el('span', 'banner-line', el('strong', 'banner-label', b.label), b.sep, b.files ? work(el('span', 'banner-summary', md(b.summary)), 'files') : el('span', 'banner-summary', md(b.summary)));
  line.title = sentence;
  const done = b.note && answered(m, b.note) ? el('span', 'banner-done', icon('pass', 'blue'), 'Answer sent') : null;
  const summary = el('summary', 'banner-head', icon(b.icon, b.tone), line, done, el('span', 'banner-chev', icon('chevron-down')));
  summary.dataset.keep = key;
  const detail: Child[] = [];
  if (b.note) detail.push(noteDetail(m, b.note));
  if (b.text) detail.push(el('p', 'banner-detail-text', md(b.text)));
  if (b.lines.length) {
    const list = el('ul', 'banner-lines', ...b.lines.map((l) => el('li', '', l)));
    detail.push(b.files ? work(list, 'files') : list);
  }
  if (!detail.length) detail.push(el('p', 'banner-detail-text', md(b.summary)));
  const d = el('details', `banner banner-${b.tone}`, summary, el('div', 'banner-body', ...detail)) as HTMLDetailsElement;
  d.dataset.banner = b.id;
  d.open = memory().opened.includes(key);
  d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, key])].slice(-200) : x.opened.filter((y) => y !== key); }));
  return d;
}

/** The banners above a task page's tabs, or none. */
export function renderBanners(m: TicketModel): HTMLElement[] {
  return bannersOf(m.acc).map((b) => drawBanner(m, b));
}

export const area: PageArea = {
  receive: { 'blocked-answered': onAnswered },
};
