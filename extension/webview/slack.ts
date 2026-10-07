// acc's notices in Slack: the card on Environments.

import type { SlackCard } from '../src/model/slack.ts';
import { button, type Child, el, icon, keptInput, when } from './dom.ts';
import { api, state } from './state.ts';

// ---------------------------------------------------------------- acc's notices in Slack (GH-58)

/** The webhook as it's typed, kept only here: never in the tab's memory, and forgotten once it's sent. */
let slackTyped = '';
let slackError: string | null = null;
const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

/**
 * Where acc's notices go when you're away from VSCode: one incoming webhook for this machine. Each state
 * says so in words, with an icon: blue when it's sending, orange when Slack refused a message.
 */
export function slackCardView(c: SlackCard): HTMLElement {
  const line = (iconName: string, tone: string | undefined, ...text: Child[]) => el('div', 'id-line', icon(iconName, tone), el('span', '', ...text));
  const connect = () => {
    const url = slackTyped.trim();
    if (!SLACK_WEBHOOK.test(url)) {
      slackError = 'That isn\'t a Slack incoming webhook. It starts https://hooks.slack.com/services/ and has three parts after that.';
      if (state.last) state.draw(state.last);
      return;
    }
    api.postMessage({ type: 'slack-connect', url });
    slackTyped = '';
    slackError = null;
    if (state.last) state.draw(state.last);
  };
  const input = keptInput('slack:webhook', slackTyped, c.tail ? 'Paste a new webhook to replace it' : 'https://hooks.slack.com/services/…', (v) => { slackTyped = v; }, connect, 'password');
  input.setAttribute('aria-label', 'Slack incoming webhook');
  input.spellcheck = false;
  if (slackError) input.setAttribute('aria-invalid', 'true');
  const save = button(c.tail ? 'Replace' : 'Connect', c.tail ? 'replace' : 'plug', connect, c.tail ? '' : 'primary');
  save.disabled = c.busy;
  const help = button('How to make one', 'link-external', () => api.postMessage({ type: 'open', url: 'https://api.slack.com/messaging/webhooks' }), 'ghost');
  const hook = el('div', 'slack-hook',
    el('label', 'slack-label', c.tail ? 'Webhook' : 'Incoming webhook'),
    el('div', 'cfield-input', input, save, c.tail ? null : help),
    slackError ? el('div', 'cfield-status tone-orange', icon('warning', 'orange'), el('span', '', slackError)) : null,
    el('div', 'muted small', c.tail
      ? 'Replace sends a test message to the new one. The webhook is kept in VSCode\'s secret storage on this machine, never in a repo.'
      : 'Connect sends a test message. Make the webhook for a channel, or for a DM to yourself. It\'s kept in VSCode\'s secret storage on this machine, never in a repo.'));
  hook.querySelector('label')!.setAttribute('for', 'slack-webhook');
  input.id = 'slack-webhook';
  let kinds: HTMLElement | null = null;
  if (c.tail) {
    const ticks = el('div', 'ticks');
    ticks.setAttribute('role', 'group');
    ticks.setAttribute('aria-label', 'Which notices go to Slack');
    for (const k of c.kinds) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = k.on;
      box.value = k.key;
      box.dataset.keep = `slack:${k.key}`;
      box.addEventListener('change', () => api.postMessage({ type: 'slack-kinds', kinds: [...ticks.querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value) }));
      ticks.append(el('label', `tick${k.on ? ' on' : ''}`, box, icon(k.icon), k.label));
    }
    kinds = el('div', 'slack-kinds', el('span', 'slack-label', 'Sends'), ticks,
      c.kinds.some((k) => k.on) ? null : el('div', 'muted small', icon('info'), ' None ticked: nothing is sent.'));
  }
  const act = (label: string, iconName: string, action: string, cls = '') => {
    const b = button(label, iconName, () => api.postMessage({ type: 'slack', action }), cls);
    b.disabled = c.busy;
    return b;
  };
  const badge = el('span', 'avatar avatar-lg slack-badge', icon('bell'));
  badge.setAttribute('aria-hidden', 'true');
  return el('article', `identity slack${c.state === 'paused' ? ' attention' : ''}`,
    el('div', 'id-head', badge, el('div', 'id-who',
      el('div', 'id-name', el('span', 'strong', 'Notices in Slack'), c.tail ? el('span', 'chip mono', `…${c.tail}`) : null),
      el('div', 'muted small', 'What needs you, when you\'re away from VSCode: one message for each notice, from every project on this machine.'))),
    el('div', 'id-lines',
      line(c.look.icon, c.look.tone, c.state === 'paused' ? el('strong', '', c.look.label) : c.look.label, c.lookAt ? when(c.lookAt) : null),
      c.busy ? line('sync~spin', 'blue', 'Sending a test…') : c.last ? line(c.last.look.icon, c.last.look.tone, c.last.look.label, when(c.last.at)) : null,
      c.state === 'paused' ? line('info', undefined, el('span', 'muted', 'Nothing is sent until a test goes through, or a new webhook is pasted.')) : null,
      line('shield', undefined, el('span', 'muted', 'Each message has the task\'s id and title, what happened, and a link to its pull request or ticket. Never a draft\'s text, a ticket\'s description, code or logs.'))),
    kinds,
    hook,
    c.tail ? el('div', 'actions',
      act('Send a test', 'send', 'test', c.state === 'paused' ? 'primary' : ''),
      c.state === 'off' ? act('Turn on', 'play', 'on', 'primary') : act('Turn off', 'debug-pause', 'off'),
      act('Remove', 'trash', 'remove', 'ghost')) : null);
}
