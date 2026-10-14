// Suggested rules acc said it accepted or dismissed (T-35), taken off the Overview at once, before a model
// without them arrives. Kept apart from rules.ts, which runs in the webview, so node's tests can import it.

import type { OverviewModel } from '../src/model/overview.ts';
import type { RuleCard } from '../src/model/rules.ts';

/** The suggested rules' line in When you have a moment, as the model words it (landing.ts's rulesRow). */
export const rulesLineTitle = (n: number): string => `${n} suggested rule${n === 1 ? '' : 's'}, from repeated review findings`;

/**
 * The Overview without the suggestions in `settled`: gone from what waits on you, and from the suggested
 * rules' line, which counts the rest and the reviews they came from, or goes when none are left. The list
 * it's in counts one fewer for each. The same overview when none of them is in it.
 */
export function hideSettled(o: OverviewModel, settled: ReadonlySet<string>, key: (c: RuleCard) => string): OverviewModel {
  const attention = o.attention.filter((a) => !a.rule || !settled.has(key(a.rule)));
  const gone = o.attention.length - attention.length;
  if (!gone) return o;
  const rules = attention.flatMap((a) => (a.rule ? [a.rule] : []));
  const reviews = new Set(rules.flatMap((r) => r.sources.map((s) => `${s.task}@${s.sha}`))).size;
  const landing = o.landing.map((g) => {
    const all = g.all ?? g.rows;
    const at = all.findIndex((r) => r.key === 'rules');
    if (at < 0) return g;
    const left = rules.length
      ? all.map((r) => (r.key === 'rules' ? { ...r, title: rulesLineTitle(rules.length), facts: [{ text: `from ${reviews} review${reviews === 1 ? '' : 's'}` }], tip: rules.map((x) => x.line).join('\n') } : r))
      : all.filter((r) => r.key !== 'rules');
    // A list over its cap shows its first few and holds the rest in `all`; one under it shows every line.
    const cap = g.all ? g.rows.length : Infinity;
    const over = left.length > cap;
    return {
      ...g, count: g.count - gone, total: left.length, rows: left.slice(0, cap),
      more: over && g.more ? { ...g.more, label: `Show all ${left.length}` } : null, all: over ? left : null,
    };
  });
  return { ...o, attention, landing };
}
