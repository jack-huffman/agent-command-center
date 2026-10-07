/**
 * Ticket updates (D-066): what acc drafted for a ticket, for a person to read, edit and post.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { isTrackerKind, type TrackerKind, trackerName } from '../../../packages/core/src/trackers/types.ts';
import { isOpenUpdate, stalePosting, type Update, UPDATE_ID, UPDATE_TEXT_MAX } from '../../../packages/core/src/updates.ts';
import type { AnalysisAsk } from '../logic/shared.ts';
import type { BoardInput } from './boards.ts';
import { KEY, type Look, LOOK, type ModelArea, short } from './shared.ts';
import { trackerForKey } from '../../../packages/core/src/config.ts';

// ---------------------------------------------------------------- ticket updates (D-066)

/** An update acc drafted for a ticket, as the Overview and its task's page show it, for a person to read, edit and post. */
export interface UpdateCard {
  project: string;
  id: string;
  task: string;
  /** The ticket as its board names it: GH-41, ACME-12. */
  key: string;
  tracker: TrackerKind;
  /** What it's about, in words. */
  about: string;
  look: Look;
  text: string;
  state: 'draft' | 'posting';
  /** Claimed for posting over five minutes ago and never confirmed: it may have gone (D-051). */
  stale: boolean;
  createdAt: string;
  /** Who Post sends it as, or null when it can't be posted from here. */
  postAs: string | null;
  /** Why it can't be posted from here yet, such as "Sign in to Jira first." */
  blocked: string | null;
  /** The sign-in that would let it post. */
  signIn: { command: string; label: string; arg: string } | null;
  /** Why the last try didn't post. */
  failed: string | null;
  /** The drafts of the same news it replaced, newest first: an edit typed for one of them is its edit now. */
  replaces: string[];
  /** On the Overview, the edit its task's page holds, unsent: what Post there would send instead of acc's text. */
  edited: string | null;
}

/** Whether a task's source is a tracker's ticket, which can take updates. */
export const hasTicket = (kind: string): boolean => isTrackerKind(kind);

/** What an update is about, for the person posting it. */
export function updateAbout(u: Pick<Update, 'event' | 'env' | 'pr'>): string {
  switch (u.event) {
    case 'pr-opened': return u.pr ? `Pull request #${u.pr.number} is ready for review` : 'Ready for review';
    case 'pr-updated': return u.pr ? `Pull request #${u.pr.number} was updated` : 'Updated for review';
    case 'merged': return `Merged into ${u.env ?? 'its environment'}`;
    case 'promotion-opened': return u.pr ? `Promotion #${u.pr.number} to ${u.env ?? 'its next environment'} is ready` : `Ready to go to ${u.env ?? 'its next environment'}`;
    case 'promoted': return `Promoted to ${u.env ?? 'its next environment'}`;
    case 'deployed': return `Deployed to ${u.env ?? 'its environment'}`;
    case 'blocked': return 'Blocked on a question only the client can answer';
    case 'question': return 'A question from its analysis';
  }
}

/**
 * Who an update posts as, or why it can't be posted from here: GitHub as the repo's account (D-028), Jira
 * and Azure DevOps through this repo's sign-in (D-027). Without one, Post waits for it.
 */
export function updatePoster(tracker: UpdateCard['tracker'], index: number | null, root: string, github: string | null, boards: BoardInput[]): Pick<UpdateCard, 'postAs' | 'blocked' | 'signIn'> {
  if (tracker === 'github') return github ? { postAs: github, blocked: null, signIn: null } : { postAs: null, blocked: 'This project has no GitHub account in .acc/config.json to post as.', signIn: null };
  const name = trackerName(tracker);
  // The tracker that owns the ticket's key, not the first of its kind: a repo can have two Jira sites.
  const b = index === null ? undefined : boards.find((x) => x.index === index && x.kind === tracker);
  if (!b) return { postAs: null, blocked: `This repo has no ${name} tracker to post through.`, signIn: null };
  if (b.signedInAs) return { postAs: b.signedInAs, blocked: null, signIn: null };
  return { postAs: null, blocked: `Sign in to ${name} first.`, signIn: b.connect ?? { command: 'acc.trackers.signIn', label: `Sign in to ${name}`, arg: JSON.stringify({ root, index: b.index }) } };
}

/** The updates still waiting on a person, as cards: drafts, and any being posted. `trackerOf` finds the tracker that owns a key. */
export function updateCards(root: string, updates: Update[], github: string | null, boards: BoardInput[], trackerOf: (key: string) => number | null, now = Date.now()): UpdateCard[] {
  return updates.filter(isOpenUpdate).map((u) => {
    const stale = stalePosting(u, new Date(now));
    const look = stale ? LOOK('May have posted', 'warning', 'orange') : u.state === 'posting' ? LOOK('Posting', 'sync~spin', 'blue') : LOOK('Draft update', 'comment-draft', 'orange');
    return {
      project: root, id: u.id, task: u.task, key: u.tracker === 'github' ? u.task : u.key, tracker: u.tracker, about: updateAbout(u), look, text: u.text,
      state: u.state === 'posting' ? 'posting' : 'draft', stale, createdAt: u.createdAt, ...updatePoster(u.tracker, u.tracker === 'github' ? null : trackerOf(u.key), root, github, boards),
      failed: u.state === 'draft' ? u.failed?.reason ?? null : null, replaces: u.replaces ?? [], edited: null,
    };
  });
}

/** An analysis's questions, each saying whether it was drafted for the client, or posted (D-066). */
export function withClient(questions: AnalysisAsk[], task: string, updates: Update[]): AnalysisAsk[] {
  return questions.map((q) => {
    const u = updates.filter((x) => x.task === task && x.event === 'question' && x.question === q.id && x.state !== 'discarded').at(-1);
    return u ? { ...q, client: u.state === 'posted' ? 'posted' : 'drafted' } : q;
  });
}

export type Message =
  /**
   * A person posts an update with the text they edited, or discards it, or sends one of an analysis's
   * questions to the client as a draft (D-066). acc records each; the page never writes them.
   */
  | { type: 'update-post'; project: string; id: string; text: string; again?: boolean }
  | { type: 'update-discard'; project: string; id: string }
  | { type: 'update-ask'; project: string; task: string; question: string }
  /** The task page's unsent edit of an update, or null once it's acc's text again, so the Overview won't post acc's. */
  | { type: 'update-edit'; project: string; id: string; text: string | null };

export const area: ModelArea = {
  home: {
    order: 12,
    attention(c, p) {
      const { hub, i, attention } = c;
      // Updates acc drafted for tickets (D-066): each waits for a person to read and post it, or discard it.
      for (const drafted of updateCards(p.root, hub.updates?.(p.root) ?? [], p.config.github?.account ?? null, i.boards(p.root), (key) => trackerForKey(p.config.trackers ?? [], key))) {
        // Edited on its task's page and not sent: the Overview shows that edit, and it's posted from there,
        // so Post here can't send acc's text instead.
        const edit = drafted.state === 'draft' || drafted.stale ? i.edited?.(p.root, drafted.id, drafted.replaces) ?? null : null;
        // One that may have posted already keeps saying so (D-051): that warning comes before the edit.
        const card = edit !== null && edit.trim() !== drafted.text.trim() ? { ...drafted, edited: edit, look: drafted.stale ? drafted.look : LOOK('Edited on the task page', 'edit', 'orange') } : drafted;
        attention.push({
          key: `u:${p.root}:${card.id}`, look: card.look, title: card.stale ? `Update for ${card.key} may have posted` : `Update ready for ${card.key}`,
          detail: `${p.name} · ${card.about}`, project: p.name,
          actions: [{ command: 'acc.task.show', label: 'Edit', icon: 'edit', ref: { project: p.root, task: card.task }, ...(card.edited !== null ? { primary: true } : {}) }],
          ...(card.signIn ? { extra: { command: card.signIn.command, label: card.signIn.label, icon: 'plug', arg: card.signIn.arg } } : {}),
          update: card,
        });
      }
    },
  },
  messages: {
    'update-post': (x) => short(x.project, 4096) && short(x.id, 120) && UPDATE_ID.test(x.id as string) && short(x.text, UPDATE_TEXT_MAX) && !!(x.text as string).trim() && (x.again === undefined || typeof x.again === 'boolean'),
    'update-discard': (x) => short(x.project, 4096) && short(x.id, 120) && UPDATE_ID.test(x.id as string),
    'update-edit': (x) => short(x.project, 4096) && short(x.id, 120) && UPDATE_ID.test(x.id as string) && (x.text === null || (typeof x.text === 'string' && x.text.length <= UPDATE_TEXT_MAX)),
    'update-ask': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && typeof x.question === 'string' && /^q\d{1,3}$/.test(x.question),
  },
};
