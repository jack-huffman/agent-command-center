// Ticket updates on the Overview and a task's page, and the replies to what the page sent.

import type { Action } from '../src/model/shared.ts';
import type { Model } from '../src/model/home.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import type { UpdateCard } from '../src/model/updates.ts';
import { type DraftKeys, editFor, keepEdits, Pending } from './pending.ts';
import { actionButton, button, type Child, el, icon, status, when } from './dom.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';

/** The extension says how a write went. A posted comment clears its draft; a refused one keeps it. */
export function onDone(msg: { action?: string; ok?: boolean; error?: string; project?: string; task?: string; question?: string; id?: string }): void {
  if (msg.action === 'update-post' || msg.action === 'update-discard' || msg.action === 'update-ask') {
    // The page has already redrawn with what acc did; a refusal comes back to try again, saying why (D-059).
    const key = msg.action === 'update-ask' ? askKey(msg.project ?? '', msg.task ?? '', msg.question ?? '') : updateKey(msg.project ?? '', msg.id ?? '');
    const was = pending.what(key);
    pending.settle(key, msg.ok ? null : `${was === 'discard' ? 'It wasn\'t discarded' : was === 'ask' ? 'It wasn\'t drafted' : 'It wasn\'t posted'}: ${msg.error?.trim() || 'acc didn\'t say why.'}`);
    if (msg.ok && msg.action === 'update-post') remember((s) => { delete s.drafts[key]; delete s.bases[key]; });
    if (state.last) state.draw(state.last);
    return;
  }
  if (msg.action === 'analysis-answer') {
    // An answer acc took clears its draft, and its question leaves with the next redraw; a refused one
    // comes back to edit, saying why.
    const key = answerKey(msg.project ?? '', msg.task ?? '', msg.question ?? '');
    if (msg.ok) remember((s) => { delete s.drafts[key]; });
    else if (pending.what(key)) {
      pending.settle(key, msg.error?.trim() || 'acc didn\'t say why.');
      if (state.last) state.draw(state.last);
    }
    return;
  }
  if (msg.action !== 'comment') return;
  // The composer's own box, not an update's above it: on the task's tab, or in the modal over the board (GH-158).
  const box = document.querySelector<HTMLTextAreaElement>('.composer .comment-box');
  const page = state.last?.kind === 'ticket' ? state.last : state.modal;
  if (msg.ok && page) { const m = page; remember((s) => { delete s.drafts[`${m.project}#${m.key}`]; }); if (box) box.value = ''; }
  if (box) box.disabled = false;
  const send = document.querySelector<HTMLButtonElement>('.composer .btn.primary');
  if (send) { send.replaceChildren(icon('comment'), 'Comment'); send.disabled = !box?.value.trim(); }
}

// ---------------------------------------------------------------- ticket updates (D-066)

/**
 * Answers, updates and questions on their way to acc, by key, and what's being done; shown so until acc
 * replies, then why not if it refused, until it's tried again or it leaves the page (D-059).
 */
export const pending = new Pending<'answer' | 'post' | 'discard' | 'ask'>();
export const updateKey = (project: string, id: string): string => `update:${project}#${id}`;
export const askKey = (project: string, task: string, question: string): string => `ask:${project}#${task}:${question}`;

/** An answer stays "Sending…" until its question goes, or acc refuses it. */
export const answerKey = (project: string, task: string, question: string): string => `analysis:${project}#${task}:${question}`;

export function sendUpdate(key: string, what: 'post' | 'discard' | 'ask', msg: Record<string, unknown>): void {
  if (!pending.start(key, what)) return;
  api.postMessage(msg);
  if (state.last) state.draw(state.last);
}

/** Post and Discard for an update; the text posted is the box's, on the task's page, or the draft as acc wrote it. */
function updateButtons(c: UpdateCard, text: () => string): HTMLElement[] {
  const key = updateKey(c.project, c.id);
  const sending = pending.what(key);
  if (sending) return [el('span', 'q-sending muted', icon('sync~spin'), sending === 'discard' ? 'Discarding…' : `Posting as ${c.postAs ?? 'you'}…`)];
  if (c.state === 'posting' && !c.stale) return [el('span', 'q-sending muted', icon('sync~spin'), 'Being posted…')];
  const discard = button('Discard', 'trash', () => sendUpdate(key, 'discard', { type: 'update-discard', project: c.project, id: c.id }), 'ghost');
  discard.title = 'Set it aside: it\'s kept, and never posted';
  const post = button(c.stale ? 'Post again' : 'Post', 'send', () => {
    const t = text().trim();
    if (t) sendUpdate(key, 'post', { type: 'update-post', project: c.project, id: c.id, text: t, ...(c.stale ? { again: true } : {}) });
  }, 'primary');
  post.disabled = !!c.blocked || !text().trim();
  post.title = c.blocked ?? `Post it on ${c.key} as ${c.postAs}`;
  return [discard, post];
}

/** Why an update didn't go, or may have gone, in orange with a warning icon. */
export function updateNotes(c: UpdateCard): HTMLElement[] {
  const error = pending.error(updateKey(c.project, c.id));
  const note = (text: string) => el('div', 'aq-error', icon('warning'), el('span', '', text));
  return [
    ...(c.stale ? [note(`This may have posted already: it was being posted and never confirmed. Look at ${c.key} before you post it again.`)] : []),
    ...(c.failed && !error ? [note(`The last try didn't post: ${c.failed}`)] : []),
    ...(error ? [note(error)] : []),
  ];
}

/**
 * On the Overview: Post as drafted, Edit on its task's page, or Discard. One edited on its task's page
 * is posted from there, so Post here can't send acc's text instead (GH-46): Edit leads, and Discard stays.
 */
export function overviewUpdateButtons(u: UpdateCard, actions: Action[]): Child[] {
  const own = updateButtons(u, () => u.text);
  if (own.length < 2) return [...own, ...actions.map(actionButton)];
  const [discard, post] = own;
  if (u.edited !== null) return [...actions.map(actionButton), discard];
  return [post, ...actions.map(actionButton), discard];
}

/** A draft's key, and its replaced drafts', as its edit is kept under them. */
const draftKeys = (c: UpdateCard): DraftKeys => ({ key: updateKey(c.project, c.id), text: c.text, replaces: c.replaces.map((r) => updateKey(c.project, r)) });

/** What this page last told the extension each of its updates' edits is, by update id (GH-46). */
const told = new Map<string, string>();
const telling = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Tells the extension an update's unsent edit, or that it has none, so the Overview shows it and won't
 * post acc's text instead. An edit's start and end go at once, so no Overview Post slips in between;
 * the typing in between waits for a pause.
 */
function tellEdit(project: string, id: string, text: string | null, pause = false): void {
  clearTimeout(telling.get(id));
  telling.delete(id);
  const send = () => {
    telling.delete(id);
    if (text === null) told.delete(id);
    else told.set(id, text);
    api.postMessage({ type: 'update-edit', project, id, text });
  };
  if (pause && text !== null && told.has(id)) telling.set(id, setTimeout(send, 400));
  else send();
}

/**
 * A task's page just opened in the modal over the board (GH-158): the extension knows none of its edits
 * yet, since a closed modal's went with it, so it's told them all again.
 */
export function tellAfresh(): void {
  for (const t of telling.values()) clearTimeout(t);
  telling.clear();
  told.clear();
}

/**
 * After each redraw the extension hears of every edit this page holds, carried ones too, and of each that
 * ended. A page brought back from hidden starts afresh, so it says them all again.
 */
export function tellEdits(m: TicketModel): void {
  const mem = memory();
  const held = new Map<string, string>();
  for (const c of m.updates) {
    const e = editFor(mem, draftKeys(c));
    if (e) held.set(c.id, e.text);
  }
  for (const [id, text] of held) if (told.get(id) !== text) tellEdit(m.project, id, text);
  for (const id of [...told.keys()]) if (!held.has(id)) tellEdit(m.project, id, null);
}

/** Who Post sends it as, or why it can't post yet. */
export const posterLine = (c: UpdateCard): HTMLElement => (c.blocked ? el('span', 'acting draft-blocked', icon('warning'), c.blocked) : el('span', 'acting', icon('account'), `Posting as ${c.postAs}`));

/**
 * One of a task's draft updates at the top of its Activity: what it's about, its text in a box to edit,
 * and Post or Discard. The edit stays in the tab's memory until it's posted; acc keeps only what went.
 * An edit typed for a draft that a newer one replaced stays, saying so, with the newer draft's wording
 * beneath it when that changed (GH-46).
 */
export function updateDraft(c: UpdateCard): HTMLElement {
  const key = updateKey(c.project, c.id);
  const sending = !!pending.what(key);
  const held = editFor(memory(), draftKeys(c));
  const box = el('textarea', 'comment-box act-draft-text') as HTMLTextAreaElement;
  box.value = held?.text ?? c.text;
  box.rows = 3;
  box.maxLength = 65_536;
  // Tall enough for all of its text, wrapped as the page is wide, so no line is cut; a long one scrolls.
  const fit = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight + 2, 360)}px`; };
  requestAnimationFrame(fit);
  box.disabled = sending || (c.state === 'posting' && !c.stale);
  box.setAttribute('aria-label', `Update for ${c.key}`);
  const bar = el('div', 'composer-bar', posterLine(c), el('span', 'spacer'));
  const buttons = () => updateButtons(c, () => box.value);
  bar.append(...buttons());
  // A replaced draft's edit, carried here: a note, and the newer wording to take instead when it changed.
  const note = held?.carried ? el('div', 'act-draft-note', icon('history', 'blue'), el('span', '', held.carried === 'kept'
    ? 'A newer draft replaced this one; your edit is kept.' : 'A newer draft replaced this one; your edit is kept. The newer draft words it differently: it\'s below.')) : null;
  const newer = held?.carried === 'both' ? el('div', 'act-draft-newer', el('div', 'muted small', 'The newer draft says:'), el('div', 'act-draft-newer-text', c.text),
    el('div', 'act-draft-newer-bar', button('Use the newer draft', 'replace', () => { box.value = c.text; changed(false); }, 'ghost small'))) : null;
  if (newer) newer.setAttribute('aria-label', 'The newer draft');
  const changed = (pause: boolean) => {
    fit();
    const edited = box.value.trim() !== c.text.trim();
    remember((x) => {
      if (edited) {
        x.drafts[key] = box.value;
        x.bases[key] ??= { text: c.text };
      } else {
        delete x.drafts[key];
        delete x.bases[key];
      }
      for (const r of draftKeys(c).replaces) { delete x.drafts[r]; delete x.bases[r]; }
    });
    tellEdit(c.project, c.id, edited ? box.value : null, pause);
    // Typed back to acc's text, it's no longer an edit, carried or not.
    if (!edited) { note?.remove(); newer?.remove(); }
    const post = bar.querySelector<HTMLButtonElement>('.btn.primary');
    if (post) post.disabled = !!c.blocked || !box.value.trim();
  };
  box.addEventListener('input', () => changed(true));
  const d = el('div', `act-draft tone-edge-${c.look.tone}`,
    el('div', 'act-draft-head', status(c.look), el('span', 'strong', c.about), el('span', 'muted', '·'), when(c.createdAt)),
    ...updateNotes(c), note,
    el('div', 'act-draft-edit', box, bar), newer);
  d.setAttribute('role', 'group');
  d.setAttribute('aria-label', `Update for ${c.key}: ${c.look.label}`);
  return d;
}

/**
 * An analysis's questions that have gone from the page, answered or asked again, leave nothing behind: no
 * "Sending…", no half-written answer (D-052).
 */
export function forgetAnswered(model: Model): void {
  if (model.kind !== 'home' && model.kind !== 'ticket') return;
  // A task's page in the modal over the board is on the page too (GH-158).
  const pages = model.kind === 'ticket' ? [model] : state.modal ? [state.modal] : [];
  const shown = [
    ...(model.kind === 'home' ? model.overview.attention.flatMap((a) => (a.analysis ? a.analysis.questions.map((q) => answerKey(a.analysis!.project, a.analysis!.task, q.id)) : [])) : []),
    ...pages.flatMap((t) => (t.analysis?.open ?? []).map((q) => answerKey(t.project, t.analysis!.task, q.id))),
  ];
  const keep = new Set(shown);
  if (Object.keys(memory().drafts).some((k) => k.startsWith('analysis:') && !keep.has(k))) remember((x) => { for (const k of Object.keys(x.drafts)) if (k.startsWith('analysis:') && !keep.has(k)) delete x.drafts[k]; });
  // So do updates that have gone: posted, discarded, or replaced by a newer draft (D-066).
  const updates = [...(model.kind === 'home' ? model.overview.attention.flatMap((a) => (a.update ? [a.update] : [])) : []), ...pages.flatMap((t) => t.updates)];
  const asks = [
    ...(model.kind === 'home' ? model.overview.attention.flatMap((a) => (a.analysis ? a.analysis.questions.map((q) => askKey(a.analysis!.project, a.analysis!.task, q.id)) : [])) : []),
    ...pages.flatMap((t) => (t.analysis?.open ?? []).map((q) => askKey(t.project, t.analysis!.task, q.id))),
  ];
  const live = new Set([...updates.map((u) => updateKey(u.project, u.id)), ...asks]);
  pending.forget(new Set([...keep, ...live]));
  // An edit typed for a draft that a newer one replaced moves to the newer one first; then the edits for
  // drafts that have gone are dropped (GH-46).
  for (const t of pages) {
    const mine = `update:${t.project}#${t.key}.`;
    const kept = keepEdits(memory(), t.updates.map(draftKeys), (k) => k.startsWith(mine));
    if (kept) remember((x) => { x.drafts = kept.drafts; x.bases = kept.bases; });
  }
}

export const area: PageArea = {
  before(model) {
    forgetAnswered(model);
    if (model.kind === 'ticket') tellEdits(model);
    else if (model.kind === 'home' && state.modal) tellEdits(state.modal);
  },
  receive: { done: onDone },
};
