// The tints a label chip or an avatar takes (T-91). Plain data with no DOM, so a test can run it: most other
// modules here reach the VSCode API as they load. The tints themselves are --tint-1 to --tint-8 in styles.css,
// each a theme colour that is neither red nor green.

/** How many tints the palette holds (T-94: eight, up from five). */
export const TINTS = 8;

/** A label's tint: the tracker's own colour as six hex digits, or one of the palette's tints. */
export type Tint = { colour: string } | { tint: number };

/** A stable tint, 1 to TINTS, for a key: the same name or id gets the same tint on every page and every draw. */
export function tintOf(key: string): number {
  // FNV-1a over the key's code points: small, and spreads short keys such as "bug" and "sla" well.
  let h = 0x811c9dc5;
  for (const c of key) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193);
  return ((h >>> 0) % TINTS) + 1;
}

/**
 * What tints a label: the tracker's own colour, when it gives one as six hex digits, or else the tint its
 * name picks, the same whatever its case.
 */
export function labelTint(l: { name: string; color: string | null }): Tint {
  return l.color && /^[0-9a-f]{6}$/i.test(l.color) ? { colour: l.color } : { tint: tintOf(l.name.toLowerCase()) };
}

/**
 * The tints of one card's or one ticket's labels (T-94), in their order: each takes its name's tint, but a
 * name whose tint another name here already holds takes the next free one, so two labels share a tint only
 * once every tint is used. The same name twice, in any case, keeps one tint; a tracker's own colour stays.
 */
export function labelTints(labels: readonly { name: string; color: string | null }[]): Tint[] {
  const held = new Set<number>();
  const given = new Map<string, number>();
  return labels.map((l) => {
    const t = labelTint(l);
    if ('colour' in t) return t;
    const name = l.name.toLowerCase();
    const known = given.get(name);
    if (known !== undefined) return { tint: known };
    let tint = t.tint;
    for (let i = 0; i < TINTS && held.has(tint); i++) tint = (tint % TINTS) + 1;
    // Every tint is held: the name keeps its own, which another label here shares.
    if (held.has(tint)) tint = t.tint;
    held.add(tint);
    given.set(name, tint);
    return { tint };
  });
}
