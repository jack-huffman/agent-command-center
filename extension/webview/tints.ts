// The tints a label chip or an avatar takes (T-91). Plain data with no DOM, so a test can run it: most other
// modules here reach the VSCode API as they load. The tints themselves are --tint-1 to --tint-5 in styles.css,
// each a theme colour that is neither red nor green.

/** How many tints the palette holds. */
export const TINTS = 5;

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
export function labelTint(l: { name: string; color: string | null }): { colour: string } | { tint: number } {
  return l.color && /^[0-9a-f]{6}$/i.test(l.color) ? { colour: l.color } : { tint: tintOf(l.name.toLowerCase()) };
}
