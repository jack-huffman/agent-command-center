// What a page is waiting on acc for. Kept apart from main.ts, which runs in the webview, so node's tests
// can import it.

import type { OverviewModel } from '../src/model/overview.ts';
import type { RuleCard } from '../src/model/rules.ts';

/**
 * Replies a page waits for, by key: an answer being recorded, an update being posted or discarded, a
 * question being drafted for the client. Each shows as on its way until acc replies, and a refusal
 * stays, saying why, until it's tried again or the thing it was for leaves the page (D-059).
 */
export class Pending<W extends string> {
  private readonly sending = new Map<string, W>();
  private readonly errors = new Map<string, string>();

  /** Starts sending, and drops the last try's error. False if one is already on its way. */
  start(key: string, what: W): boolean {
    if (this.sending.has(key)) return false;
    this.sending.set(key, what);
    this.errors.delete(key);
    return true;
  }

  /** What's on its way for this key, if anything. */
  what(key: string): W | undefined {
    return this.sending.get(key);
  }

  /** Every key with something on its way. */
  inFlight(): string[] {
    return [...this.sending.keys()];
  }

  /** Why the last try didn't go. */
  error(key: string): string | undefined {
    return this.errors.get(key);
  }

  /** acc replied: it's no longer on its way. A refusal keeps why; a success clears it. Returns what was sent. */
  settle(key: string, why: string | null): W | undefined {
    const was = this.sending.get(key);
    this.sending.delete(key);
    if (why === null) this.errors.delete(key);
    else this.errors.set(key, why);
    return was;
  }

  /** Shows why without touching what's on its way: the page found a reason of its own, and acc's reply still lands. */
  fail(key: string, why: string): void {
    this.errors.set(key, why);
  }

  /** Whatever has left the page leaves nothing behind: no "Sending…", no old error. */
  forget(live: ReadonlySet<string>): void {
    for (const k of [...this.sending.keys()]) if (!live.has(k)) this.sending.delete(k);
    for (const k of [...this.errors.keys()]) if (!live.has(k)) this.errors.delete(k);
  }
}

// ---------------------------------------------------------------- an update's edit, on its task's page (D-066)

/** What an edit to an update was typed against: acc's text then, and the draft it was carried from if a newer one replaced that. */
export interface EditBase { text: string; from?: string }

/** A task page's edits to its updates, by key, and what each was typed against. Other drafts share `drafts`. */
export interface Edits { drafts: Record<string, string>; bases: Record<string, EditBase> }

/** A draft as an edit sees it: its key, acc's text, and the keys of the drafts it replaced, newest first. */
export interface DraftKeys { key: string; text: string; replaces: string[] }

const same = (a: string, b: string): boolean => a.trim() === b.trim();

/**
 * The edit a draft holds, reading through the drafts it replaced, so it's found even before it's been
 * moved. Text typed back to acc's own isn't an edit. A carried edit says so: `kept` when acc's newer
 * draft says what the edit was typed against, `both` when its wording changed, so the page shows both.
 */
export function editFor(e: Edits, d: DraftKeys): { text: string; carried: 'kept' | 'both' | null } | null {
  for (const k of [d.key, ...d.replaces]) {
    const text = e.drafts[k];
    if (text === undefined) continue;
    if (same(text, d.text)) return null;
    const base = e.bases[k];
    if (k === d.key && !base?.from) return { text, carried: null };
    // One with no base was typed before edits were carried: show both, rather than claim nothing changed.
    return { text, carried: base && same(base.text, d.text) ? 'kept' : 'both' };
  }
  return null;
}

/**
 * A task page's edits after a redraw. Each edit typed for a draft that a newer one replaced moves to the
 * newer one, then edits for drafts that have gone (posted or discarded) are dropped. Carrying comes
 * first, or a replaced draft's edit would be dropped with the rest. `mine` says which keys are this
 * page's updates; every other draft is left alone. Null when nothing changed.
 */
export function keepEdits(e: Edits, drafts: DraftKeys[], mine: (key: string) => boolean): Edits | null {
  const next: Edits = { drafts: { ...e.drafts }, bases: { ...e.bases } };
  let changed = false;
  for (const d of drafts) {
    if (next.drafts[d.key] !== undefined) continue;
    const from = d.replaces.find((k) => next.drafts[k] !== undefined);
    if (!from) continue;
    next.drafts[d.key] = next.drafts[from]!;
    // An edit typed before edits were carried has no base: an empty one, so the page shows both.
    next.bases[d.key] = { text: next.bases[from]?.text ?? '', from };
    changed = true;
  }
  const live = new Set(drafts.map((d) => d.key));
  for (const k of Object.keys(next.drafts)) if (mine(k) && !live.has(k)) { delete next.drafts[k]; changed = true; }
  for (const k of Object.keys(next.bases)) if (mine(k) && !live.has(k)) { delete next.bases[k]; changed = true; }
  return changed ? next : null;
}

// ---------------------------------------------------------------- suggested rules acc settled (T-35)

// Suggested rules acc said it accepted or dismissed, taken off the Overview at once, before a model
// without them arrives.

/** The suggested rules' line in When you have a moment, as the model words it (src/model/landing.ts's rulesRow). */
export const rulesLineTitle = (n: number): string => `${n} suggested rule${n === 1 ? '' : 's'}, from repeated review findings`;

/** A suggested rule's key on the page: what the page remembers about it, and what acc's reply settles. */
export const ruleKey = (c: Pick<RuleCard, 'project' | 'id'>): string => `rule:${c.project}#${c.id}`;

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
    // The list shows its first `shows` lines, and Show all while it holds more.
    return {
      ...g, count: g.count - gone, total: left.length, rows: left.slice(0, g.shows), all: left,
      more: g.more && left.length > g.shows ? { ...g.more, label: `Show all ${left.length}` } : null,
    };
  });
  // Only When you have a moment holds suggested rules: its card takes that list's count and first line, or goes with its last line.
  const cards = o.cards.flatMap((c) => {
    if (c.key !== 'moment') return [c];
    const moment = landing.find((g) => g.key === 'moment');
    return moment?.all.length ? [{ ...c, count: moment.count, line: moment.all[0]!.title }] : [];
  });
  return { ...o, attention, landing, cards };
}
