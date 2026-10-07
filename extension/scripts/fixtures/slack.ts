/** The Slack card (D-078) at each of its states. */
import { blankSlack, type SlackCard, slackCard, type SlackState } from '../../src/slack.ts';
import { MIN } from './shared.ts';

/**
 * The Slack card at each of its states (D-078): not set up, sending (its last message went), turned off,
 * and paused because Slack refused a message. Two kinds are ticked when it's off, to see one unticked.
 */
export type SlackSample = 'none' | 'on' | 'off' | 'paused';
export function sampleSlack(which: SlackSample, now = Date.now()): SlackCard {
  const at = (ago: number) => now - ago * MIN;
  const s: SlackState = { ...blankSlack(), since: at(600) };
  if (which === 'on') return slackCard({ ...s, on: true, tail: 'x9Qa', last: { at: at(3), ok: true, text: 'Sent' } });
  if (which === 'off') return slackCard({ ...s, tail: 'x9Qa', kinds: ['needs-you', 'pr'], last: { at: at(140), ok: false, text: 'Slack didn\'t answer within 10 s' } });
  if (which === 'paused') return slackCard({ ...s, on: true, tail: 'x9Qa', paused: 'Slack refused it: channel_is_archived', last: { at: at(12), ok: false, text: 'Slack refused it: channel_is_archived' } });
  return slackCard(s);
}
