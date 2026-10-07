import { isSlackWebhook, SLACK_KINDS, type SlackKind } from '../slack.ts';
import type { ModelArea } from './shared.ts';
/**
 * acc's notices in Slack: the Environments card's buttons.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

/** What the Slack card's buttons ask for (GH-58). The card itself is drawn from a SlackCard. */
export type { SlackCard } from '../slack.ts';
export const SLACK_ACTIONS = ['test', 'on', 'off', 'remove'] as const;
export type SlackAction = (typeof SLACK_ACTIONS)[number];

export type Message =
  /**
   * The Slack card (GH-58). A webhook travels once, in slack-connect, to VSCode's secret storage, and is
   * never sent back: the card shows only its last four characters.
   */
  | { type: 'slack-connect'; url: string }
  | { type: 'slack'; action: SlackAction }
  | { type: 'slack-kinds'; kinds: SlackKind[] };

export const area: ModelArea = {
  messages: {
    'slack-connect': (x) => typeof x.url === 'string' && isSlackWebhook(x.url.trim()),
    slack: (x) => (SLACK_ACTIONS as readonly string[]).includes(x.action as string),
    'slack-kinds': (x) => Array.isArray(x.kinds) && x.kinds.length <= SLACK_KINDS.length && x.kinds.every((k) => (SLACK_KINDS as readonly unknown[]).includes(k)),
  },
};
