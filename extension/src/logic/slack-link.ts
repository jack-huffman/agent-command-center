/**
 * Track a Slack thread by its link (T-31): a Slack tracker has no board, so the Tasks tab takes a thread's
 * link in its place. The link is read here, before Track upper-cases what it's given, so a link's own
 * case never matters. No vscode import, so it's tested with stand-ins.
 */
import { SLACK_PREFIX, slackKey, slackThread } from '../../../packages/core/src/trackers/slack.ts';
import { parseHost, type TrackReply } from './connect.ts';

/** The Slack tracker a link must belong to: its workspace, its channel's id, and its key prefix. */
export interface SlackPlace { workspace: string | null; channel: string | null; prefix?: string | null }

/** The box's Track, as the Tasks tab shows it: the link last sent, on its way, why it didn't go, or the key it tracked. */
export interface PasteState { link: string | null; busy: boolean; error: string | null; tracked: string | null }

export const NO_PASTE: PasteState = { link: null, busy: false, error: null, tracked: null };

/** A link to a thread in this tracker's channel, as the box's example: what Copy link in Slack gives. */
export const exampleLink = (s: SlackPlace): string => `https://${(s.workspace ?? 'acme').toLowerCase()}.slack.com/archives/${(s.channel ?? 'C0123ABCD').toUpperCase()}/p1696512345123456`;

/** What the box says under it: which channel the thread must be in. */
export const pasteHint = (s: SlackPlace): string => `Paste the link to a thread in channel ${(s.channel ?? '?').toUpperCase()} of ${(s.workspace ?? '?').toLowerCase()}.slack.com. In Slack, open the thread's ⋯ menu and choose Copy link.`;

/**
 * The key of the thread a link names, or why it's refused: text that isn't a Slack thread's link (a key, a
 * channel's link, anything else) gets an example; a link from another workspace, or to a thread in another
 * channel, names it. A link to a reply names the thread the reply is in.
 */
export function slackLinkKey(link: string, s: SlackPlace): { ok: true; key: string } | { ok: false; error: string } {
  const text = link.trim();
  // A key names no channel, so only a thread's link gets past here.
  const thread = slackThread(text, s.prefix ?? SLACK_PREFIX);
  if (!thread?.channel) {
    return { ok: false, error: `That isn't a link to a Slack thread. One looks like ${exampleLink(s)}.` };
  }
  const workspace = parseHost('slack', text)!;
  const want = (s.workspace ?? '').toLowerCase();
  if (workspace !== want) return { ok: false, error: `That thread is in the workspace ${workspace}, not ${want}. Paste a link from ${want}.slack.com.` };
  const channel = (s.channel ?? '').toUpperCase();
  if (thread.channel !== channel) return { ok: false, error: `That thread is in channel ${thread.channel}, not ${channel}. This tracker takes threads in channel ${channel} only.` };
  return { ok: true, key: slackKey(thread, s.prefix ?? SLACK_PREFIX) };
}

/**
 * The box's Track: the link read, then Track with its key, which reads the thread from Slack and gives it to
 * acc. Each step's state goes to `show`: on its way, then the key it tracked, or why not. A link that's
 * refused never reaches Slack, and a thread that can't be read never changes or removes a task (D-048).
 */
export async function trackLink(link: string, s: SlackPlace, track: (key: string) => Promise<TrackReply>, show: (state: PasteState) => void): Promise<TrackReply> {
  const read = slackLinkKey(link, s);
  if (!read.ok) {
    show({ link, busy: false, error: read.error, tracked: null });
    return { ok: false, error: read.error };
  }
  show({ link, busy: true, error: null, tracked: null });
  const r = await track(read.key);
  // One already on its way (from its page, or a second paste) says nothing new: that Track settles it.
  show(r.ok ? { link, busy: false, error: null, tracked: read.key } : 'error' in r ? { link, busy: false, error: r.error, tracked: null } : { ...NO_PASTE, link });
  return r;
}
