// Report a problem's tab (T-118): a title, what happened, what was expected, and what's attached, already
// scrubbed, each a box the person can change; under them the whole issue as it will be posted, kept as they
// type; then Post, the only thing that sends it. Where it can't go, the state says why and offers Copy the
// issue text. What's typed is kept in the tab's memory between redraws; a new Report a problem starts a new draft.

import type { ReportModel } from '../src/model/report.ts';
import { button, el, icon, linkTo, status } from './dom.ts';
import { issueBody, REPORT_SECTIONS, type ReportFields } from './report-text.ts';
import { api, memory, type PageArea, remember } from './state.ts';

/** Where what's typed is kept, by draft and box, so a redraw or a hidden tab keeps it. */
export const draftKey = (draft: number, box: 'title' | keyof ReportFields): string => `report:${draft}:${box}`;

/** The issue as it will be posted, and as Copy the issue text copies it: its title, then its body. */
export const issueText = (title: string, f: ReportFields): string => `${title.trim()}\n\n${issueBody(f)}`;

/** Why Post is off, or null: it needs a title and what happened, and the model's own reason while it posts. */
export const postOff = (m: ReportModel, title: string, f: ReportFields): string | null =>
  m.postOff ?? (!title.trim() ? 'Give it a title' : !f['what-happened'].trim() ? 'Say what happened' : null);

const HINTS: Record<keyof ReportFields, string> = {
  'what-happened': 'What you did, and what the Command Center did. Your own words.',
  expected: 'What you thought it would do.',
  attached: 'The Command Center filled this in. Change or take out anything you\'d rather not send.',
};

/** A box of the form: its label over it, kept as it's typed in. */
function field(id: string, label: string, box: HTMLInputElement | HTMLTextAreaElement, hint: string | null): HTMLElement {
  box.id = `report-${id}`;
  const l = el('label', 'ts-label', label);
  l.setAttribute('for', box.id);
  return el('div', 'ts-field', l, box, hint ? el('p', 'ts-hint muted', hint) : null);
}

export function renderReport(m: ReportModel): Node[] {
  const kept = memory().drafts;
  const was = (box: 'title' | keyof ReportFields, start: string): string => kept[draftKey(m.draft, box)] ?? start;
  const t = { title: was('title', ''), fields: { 'what-happened': was('what-happened', m.happened), expected: was('expected', ''), attached: was('attached', m.attached) } as ReportFields };
  const keep = (box: 'title' | keyof ReportFields, value: string) => remember((x) => { x.drafts[draftKey(m.draft, box)] = value; });
  const preview = el('pre', 'report-preview');
  const post = button(m.posting ? 'Posting…' : 'Post to GitHub', m.posting ? 'loading~spin' : 'github', () => {
    if (postOff(m, t.title, t.fields)) return;
    api.postMessage({ type: 'report-post', title: t.title.trim(), body: issueBody(t.fields) });
  }, 'primary');
  const update = () => {
    preview.replaceChildren(issueText(t.title || '(no title yet)', t.fields));
    const off = postOff(m, t.title, t.fields);
    post.disabled = !!off;
    post.title = off ?? '';
    if (off) post.setAttribute('aria-description', off);
    else post.removeAttribute('aria-description');
  };
  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'ts-box';
  title.value = t.title;
  title.placeholder = 'In a line, what went wrong';
  title.addEventListener('input', () => { t.title = title.value; keep('title', title.value); update(); });
  const boxes = REPORT_SECTIONS.map((s) => {
    const b = document.createElement('textarea');
    b.className = `ts-box ts-text${s.id === 'attached' ? ' report-attached' : ''}`;
    b.rows = s.id === 'attached' ? 10 : 4;
    b.value = t.fields[s.id];
    b.spellcheck = s.id !== 'attached';
    b.addEventListener('input', () => { t.fields[s.id] = b.value; keep(s.id, b.value); update(); });
    const hint = s.id === 'attached' && m.scrubbed ? `${m.scrubbed} ${HINTS[s.id]}` : HINTS[s.id];
    return field(s.id, s.label, b, hint);
  });
  update();
  const state = m.look ? el('div', 'report-state', status(m.look),
    m.meaning ? el('p', 'muted small report-meaning', m.meaning) : null,
    m.url ? linkTo(m.url, icon('link-external'), 'Open the issue on GitHub') : null,
    m.copy ? button('Copy the issue text', 'copy', () => api.postMessage({ type: 'report-copy', text: issueText(t.title, t.fields) })) : null) : null;
  state?.setAttribute('role', 'status');
  return [
    el('header', 'convo-head', el('h1', 'convo-title', icon('report'), el('span', '', m.title)),
      el('p', 'muted convo-task', `For the Command Center's author, as an issue on GitHub in ${m.repo}, posted as the GitHub account you're signed in with. Nothing is sent until you click Post to GitHub.`)),
    field('title', 'Title', title, null),
    ...boxes,
    el('h2', 'report-heading', 'The issue as it will be posted'),
    preview,
    state,
    el('div', 'actions report-foot', post),
  ].filter((n): n is HTMLElement => n !== null);
}

export const area: PageArea = {
  views: { report: renderReport },
};
