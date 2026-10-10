/**
 * The tidy-up offer on the Overview (GH-104): once `tidy.every` tasks have merged in a repo since the last
 * tidy-up, one blue item says so, with Draft tidy-up and Not now. It's an offer, not a blocker, so it
 * doesn't raise the badge. Nothing is added until a person confirms the draft.
 */
import { LOOK, type ModelArea } from './shared.ts';

export const area: ModelArea = {
  home: {
    order: 13,
    attention(c, p) {
      const t = c.hub.tidy?.(p.root);
      if (!t?.due) return;
      // Projects that share a repo share its ledger, and its offer: one item for both.
      const key = `tidy:${t.ledger}`;
      if (c.attention.some((a) => a.key === key)) return;
      const ref = { project: p.root };
      c.attention.push({
        key, look: LOOK('Tidy-up due', 'wand', 'blue'), title: `Tidy up after ${t.count} merges`,
        detail: `${p.name} · ${t.count} tasks merged since the last tidy-up. A tidy-up finds duplicated helpers and comments that contradict the code in the files they changed, and changes no behaviour.`,
        project: p.name,
        actions: [
          { command: 'acc.tidy.draft', label: 'Draft tidy-up', icon: 'wand', ref, primary: true },
          { command: 'acc.tidy.skip', label: 'Not now', icon: 'close', ref },
        ],
        // Not now, in its line's ⋯ menu on the Overview (GH-160).
        menu: { section: 'tidy', ref, flags: {} },
      });
    },
  },
  commands: ['acc.tidy.draft', 'acc.tidy.skip'],
};
