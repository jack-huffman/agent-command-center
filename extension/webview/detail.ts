// The Overview's details (GH-160): what a line opens, in the modal over the page (modal.ts, as a task's page
// over the board has, D-129). A question with its answers; the suggested rules one at a time, with the
// reviews each came from, Accept and Dismiss; the update drafts one at a time, with Post, Edit and Discard;
// a list in full, In progress with its machine line on top; or History. Which one is open is kept in the tab's memory, so it's drawn again from each
// new model, and when the page is rebuilt; one whose items have all gone closes.

import type { HomeModel, Model } from '../src/model/home.ts';
import type { Detail } from '../src/model/landing.ts';
import type { AttentionItem } from '../src/model/overview.ts';
import { argButton, button, type Child, el, keepFocus, status } from './dom.ts';
import { renderHistory } from './history.ts';
import { landingRows, opensKey } from './landing.ts';
import { makeModal } from './modal.ts';
import { machineLine } from './progress.ts';
import { questionCard } from './questions.ts';
import { ruleButtons, ruleDetail } from './rules.ts';
import { memory, type PageArea, remember, state } from './state.ts';
import { overviewUpdateButtons, posterLine, updateNotes } from './updates.ts';

let modal: { dialog: HTMLDialogElement; body: HTMLElement; title: HTMLElement } | null = null;
/** The detail last drawn, so a new one starts at its top and a redraw keeps its scroll. */
let drawn: string | null = null;
/**
 * Which kind of element opened it: a line and its button both open the same detail, so focus goes back to
 * the one used (GH-170), found again by its data-opens if the page redrew meanwhile.
 */
let openedBy: string | null = null;
/**
 * What the page opened first: a detail opened from inside another, as the suggested rules from the list a
 * card opens (T-36), sends focus back to that card when it closes, as nothing on the page opens it.
 */
let from: string | null = null;

/** Opens a detail over the page. */
export function openDetail(d: Detail): void {
  const a = document.activeElement as HTMLElement | null;
  if (!modal?.dialog.contains(a)) {
    openedBy = a?.dataset?.opens === opensKey(d) ? a.tagName : null;
    from = opensKey(d);
  }
  remember((m) => { m.detail = d; });
  draw();
}

/** Closes the detail, and focus goes back to what opened it. */
export function closeDetail(): void {
  const d = memory().detail;
  if (!d) return;
  remember((m) => { delete m.detail; });
  drawn = null;
  if (modal?.dialog.open) modal.dialog.close();
  modal?.body.replaceChildren();
  const openers = [...document.querySelectorAll<HTMLElement>(`[data-opens="${CSS.escape(from ?? opensKey(d))}"]`)];
  (openers.find((e) => e.tagName === openedBy) ?? openers[0])?.focus();
  openedBy = null;
  from = null;
}

function make(): NonNullable<typeof modal> {
  const close = button('Close', 'close', () => closeDetail(), 'ghost task-modal-close');
  close.title = 'Close it, back to the Overview (Escape)';
  const title = el('h2', 'detail-title');
  const m = makeModal('detail-modal', [title, close], closeDetail);
  m.dialog.addEventListener('close', () => { if (!m.dialog.open && memory().detail) closeDetail(); });
  return { ...m, title };
}

/** Previous, which one of how many, and Next, for details shown one at a time. */
function pager(at: number, n: number, what: string, go: (at: number) => void): HTMLElement {
  const prev = button('Previous', 'arrow-left', () => go(at - 1), 'ghost small');
  const next = button('Next', 'arrow-right', () => go(at + 1), 'ghost small');
  prev.disabled = at <= 0;
  next.disabled = at >= n - 1;
  prev.title = at <= 0 ? `This is the first ${what}` : `The ${what} before this one`;
  next.title = at >= n - 1 ? `This is the last ${what}` : `The next ${what}`;
  const p = el('div', 'detail-pager', prev, el('span', 'muted detail-place', `${at + 1} of ${n}`), next);
  p.setAttribute('role', 'group');
  p.setAttribute('aria-label', `${what}s, one at a time`);
  return p;
}

/** One of several shown one at a time: the one at `at`, kept in range as items go. */
function oneAt(d: Detail & { at?: number }, items: AttentionItem[], what: string, card: (a: AttentionItem) => HTMLElement): Node[] {
  const at = Math.min(Math.max(0, d.at ?? 0), items.length - 1);
  const go = (n: number) => openDetail({ ...d, at: n } as Detail);
  return [...(items.length > 1 ? [pager(at, items.length, what, go)] : []), card(items[at]!)];
}

/** A card's head: its state, and what it is. */
const head = (a: AttentionItem): HTMLElement => el('div', 'detail-head', status(a.look), el('strong', 'detail-name', a.title));

/** What the open detail shows, from this model, or null when what it showed has gone. */
function content(m: HomeModel, d: Detail): { title: string; nodes: Node[] } | null {
  const o = m.overview;
  switch (d.kind) {
    case 'question': {
      // Answered there exactly as the card on the page was (D-030): its answers, its box, In Claude Code, Watch.
      const q = o.questions.find((x) => x.id === d.id);
      return q ? { title: `A question from ${q.who}`, nodes: [questionCard(q, { watch: true })] } : null;
    }
    case 'rules': {
      // Each with its line, the reviews it came from, Accept… and its draft, and Dismiss (GH-102).
      const items = o.attention.filter((a) => a.rule);
      return items.length ? {
        title: `Suggested rules: ${items.length}`,
        nodes: oneAt(d, items, 'suggested rule', (a) => el('article', 'detail-card', head(a), el('div', 'muted small', a.detail), ruleDetail(a.rule!), el('div', 'actions detail-actions', ...ruleButtons(a.rule!)))),
      } : null;
    }
    case 'updates': {
      // Each with its text, who it posts as, why it didn't post, and Post, Edit and Discard (D-066). An edit on its
      // task's page shows here, and is posted from there (GH-46).
      const items = o.attention.filter((a) => a.update);
      return items.length ? {
        title: `Update drafts: ${items.length}`,
        nodes: oneAt(d, items, 'update draft', (a) => {
          const u = a.update!;
          const buttons: Child[] = overviewUpdateButtons(u, a.actions);
          if (a.extra) buttons.push(argButton(a.extra.command, a.extra.label, a.extra.icon, a.extra.arg, true));
          return el('article', 'detail-card', head(a), el('div', 'muted small', a.detail), el('div', 'detail-update-text', u.edited ?? u.text), el('div', 'detail-poster', posterLine(u)), ...updateNotes(u), el('div', 'actions detail-actions', ...buttons));
        }),
      } : null;
    }
    case 'list': {
      const g = o.landing.find((x) => x.key === d.group);
      const rows = g ? g.all : [];
      // In progress's machine line (heavy-check slots, builders, load) heads its list (T-36).
      const top = d.group === 'progress' ? machineLine(o.inProgress) : null;
      if (!g || !rows.length) return null;
      const list = landingRows(rows, g.title);
      // Marked for the screenshot run's Overview check, which measures its lines as it does the page's (T-36).
      list.dataset.overviewGroup = `detail:${g.key}`;
      return { title: `${g.title}: ${g.total}`, nodes: [...(top ? [top] : []), list] };
    }
    case 'history':
      return { title: 'History', nodes: [renderHistory(o.history, o.projects.length > 1, d.item)] };
  }
}

/** Draws the open detail from the page's last model, where it was scrolled to, keeping focus in it. */
function draw(): void {
  const d = memory().detail;
  const m = state.last;
  if (!d || m?.kind !== 'home') return;
  const c = content(m, d);
  if (!c) return closeDetail();
  modal ??= make();
  const key = opensKey(d);
  const fresh = drawn !== key;
  const y = fresh ? 0 : modal.body.scrollTop;
  const inside = modal.dialog.contains(document.activeElement);
  const keep = keepFocus();
  modal.title.textContent = c.title;
  modal.title.title = c.title;
  modal.dialog.setAttribute('aria-label', c.title);
  modal.body.replaceChildren(...c.nodes);
  if (!modal.dialog.open) modal.dialog.showModal();
  modal.body.scrollTop = y;
  keep();
  drawn = key;
  // Opened at a History item: it's brought into view.
  if (fresh) modal.body.querySelector<HTMLElement>('[data-at]')?.scrollIntoView({ block: 'center' });
  // A button that went with the redraw leaves focus in the modal, not on the page under it.
  if (fresh || (inside && !modal.dialog.contains(document.activeElement))) modal.body.focus({ preventScroll: true });
}

/** Answer, from Agents or In progress: the question over the page, with its answers. */
export function answerHere(id: string): void {
  openDetail({ kind: 'question', id });
}

export const area: PageArea = {
  // After every draw, a new model or the page's own, the open detail draws again from it.
  after(model: Model) {
    if (model.kind === 'home' && memory().detail) draw();
  },
};
