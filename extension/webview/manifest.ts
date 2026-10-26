// Manifest for this ticket on a Salesforce task's page (T-101): the components Salesforce's own CLI listed for
// the ticket's branch, what its org said of each, and after Check against the org, each org copy that
// differs, with See the difference and Use the org's copy, and each change in the org to Add to this ticket.
// Deletions are listed apart, and never deployed. Each button asks the extension, and shows it's on its way
// until the extension says how it went; a refusal shows why, beside the buttons.

import type { TicketModel } from '../src/model/task-page.ts';
import type { ManifestButton, ManifestFileAsk, ManifestRow, TicketManifestSection } from '../src/model/manifest.ts';
import { button, el, icon, peekKey, status, when, work } from './dom.ts';
import type { PageArea } from './state.ts';
import { type AskReply, TicketAsks } from './ticket-asks.ts';

type Ask = 'manifest-build' | 'manifest-retrieve' | 'manifest-commit' | 'manifest-file' | 'manifest-diff';

/** What's on its way, by project and task: the message and what it's for, and why the last one didn't go. */
const asks = new TicketAsks();

const which = (type: Ask, extra: Record<string, unknown>): string => `${type}${extra.check ? ':check' : ''}${extra.component ? `:${extra.component as string}` : ''}${extra.how ? `:${extra.how as string}` : ''}`;

function ask(m: TicketModel, s: TicketManifestSection, type: Ask, extra: Record<string, unknown> = {}): void {
  asks.ask(peekKey(m.project, s.task), which(type, extra), { type, project: m.project, task: s.task, ...extra });
}

/** A button of the section: off with why, or while another of its buttons is on its way; the one on its way spins. */
function action(m: TicketModel, s: TicketManifestSection, b: ManifestButton, type: Ask, iconName: string, cls: string, extra: Record<string, unknown> = {}): HTMLButtonElement {
  const busy = asks.busy(peekKey(m.project, s.task));
  const mine = busy === which(type, extra);
  const x = button(b.label, mine ? 'loading~spin' : iconName, () => ask(m, s, type, extra), cls);
  const why = b.disabled ?? (busy ? 'Wait for the one on its way' : null);
  x.disabled = !!why;
  if (why) x.title = why;
  return x;
}

/** One row: its state's icon and label where it has one, its type and member, a muted line, and its buttons. */
const row = (r: ManifestRow, sub: HTMLElement | null, ...buttons: HTMLElement[]): HTMLElement =>
  el('li', 'mf-row', r.look ? status(r.look) : null, el('div', 'mf-text', el('span', 'mf-name', el('span', 'muted', `${r.type} `), work(el('span', 'mono', r.member || r.type), 'files')), sub), ...buttons);

const sub = (text: string, kind: 'files' | 'output' | null = null): HTMLElement => {
  const s = el('span', 'muted mf-sub', text);
  return kind ? work(s, kind) : s;
};

/** The section: its state, the components, what the org said and found, the deletions, and its buttons. */
export function renderManifest(m: TicketModel, s: TicketManifestSection): HTMLElement {
  const key = peekKey(m.project, s.task);
  const sec = el('section', `analysis manifest tone-edge-${s.look.tone}`,
    el('div', 'an-head', el('h2', '', 'Manifest for this ticket'), status(s.look), el('span', 'spacer'), s.built ? when(s.built.at) : null));
  sec.setAttribute('aria-label', `Manifest for this ticket: ${s.look.label}`);
  if (s.note) sec.append(el('p', 'muted an-note', s.note));
  if (s.built) {
    sec.append(el('p', 'mf-built', icon('file-code'), el('span', '', `${s.built.components} component${s.built.components === 1 ? '' : 's'} from`), work(el('span', 'mono', s.built.branch), 'branch'),
      el('span', 'muted', 'at'), work(el('span', 'mono', s.built.sha), 'branch'), el('span', 'muted', `· API version ${s.built.apiVersion}`)));
  }
  if (s.types.length) {
    sec.append(el('h3', 'vf-h', 'Components'), el('ul', 'mf-list', ...s.types.flatMap((t) => t.members.map((r) => row(r, null)))));
  }
  if (s.findings.length) {
    sec.append(el('h3', 'vf-h', 'What the org said'), el('ul', 'mf-list', ...s.findings.map((f) => row(f, sub(f.why)))));
  }
  if (s.unchecked) sec.append(el('p', 'muted mf-note', s.unchecked));
  const c = s.check;
  if (c) {
    sec.append(el('h3', 'vf-h', `Checked against ${c.org}`), el('p', 'muted mf-note', c.same));
    if (c.differs.length) {
      // Its words need the row's width, so its two buttons go on a line of their own under them.
      sec.append(el('ul', 'mf-list', ...c.differs.map((d) => row(d, el('span', 'mf-says', el('span', '', d.says), sub(d.files.join(', '), 'files'),
        el('span', 'mf-buttons',
          action(m, s, { label: 'See the difference', disabled: null }, 'manifest-diff', 'diff', 'small ghost', { component: d.component }),
          action(m, s, d.use, 'manifest-retrieve', 'cloud-download', 'small', { component: d.component })))))));
    }
    sec.append(el('h3', 'vf-h', 'Changed in the org, not in this branch'));
    if (c.changes.why) sec.append(el('p', 'muted mf-note', c.changes.why));
    else if (!c.changes.items.length) sec.append(el('p', 'muted mf-note', 'None: the org\'s tracked changes are all in this branch.'));
    else {
      sec.append(el('ul', 'mf-list', ...c.changes.items.map((x) => row(x, sub(x.state),
        action(m, s, x.add, 'manifest-retrieve', 'add', 'small', { component: x.component })))));
    }
  }
  if (s.deletions.length) {
    sec.append(el('h3', 'vf-h', 'Deleted by this ticket'), el('ul', 'mf-list', ...s.deletions.map((r) => row(r, null))));
    if (s.deletionsNote) sec.append(el('div', 'notice why mf-never', icon('info'), el('span', '', s.deletionsNote)));
  }
  if (s.leftOut) sec.append(el('p', 'muted mf-note', s.leftOut));
  const error = asks.error(key);
  if (error) sec.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', error)));
  const file = (b: ManifestButton | null, how: ManifestFileAsk, iconName: string) => (b ? action(m, s, b, 'manifest-file', iconName, 'ghost', { how }) : null);
  sec.append(el('div', 'actions an-actions',
    action(m, s, s.build, 'manifest-build', s.built ? 'refresh' : 'file-code', s.built ? '' : 'primary'),
    action(m, s, s.orgCheck, 'manifest-build', 'cloud', s.built ? 'primary' : '', { check: true }),
    file(s.view, 'view', 'eye'), file(s.copy, 'copy', 'copy'), file(s.save, 'save', 'save'),
    s.commit ? action(m, s, s.commit, 'manifest-commit', 'git-commit', 'ghost') : null));
  if (s.commit) sec.append(el('p', 'muted mf-note', 'Add to the ticket\'s branch commits ', work(el('span', 'mono', s.file), 'files'), ' as you, with the deletions beside it.'));
  return sec;
}

/** How a button went: done redraws with what was done; a refusal shows why, to try again. */
const done = (msg: AskReply): void => asks.done(msg);

export const area: PageArea = {
  receive: { 'manifest-done': done },
};
