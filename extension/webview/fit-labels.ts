// Whole labels on a tracker's card (T-94): its one row of labels shows as many as fit whole, at least one, and
// folds the rest into +N, whose title names each label it holds. A narrow card used to cut each name short.

/**
 * How many labels fit whole in a row `room` wide: their widths with `gap` between, and, while some are left
 * over, a gap and the +N's width after them. At least one, which may then be cut short; none of none.
 */
export function labelsThatFit(widths: readonly number[], room: number, gap: number, more: number): number {
  let used = 0;
  let fit = 0;
  for (const [i, w] of widths.entries()) {
    used += (i ? gap : 0) + w;
    const after = i + 1 < widths.length ? gap + more : 0;
    if (used + after > room + 0.5) break;
    fit = i + 1;
  }
  return Math.max(fit, Math.min(1, widths.length));
}

/** The +N for the labels a card leaves out: how many, with each one's name in its title. */
export function foldedLabels(names: readonly string[], shown: number): { text: string; title: string } | null {
  const rest = names.slice(shown);
  return rest.length ? { text: `+${rest.length}`, title: rest.join(', ') } : null;
}

/** Shows the first `shown` chips, and the +N for the rest, or hides it when none are left. */
function show(chips: readonly HTMLElement[], more: HTMLElement, names: readonly string[], shown: number): void {
  chips.forEach((c, i) => { c.hidden = i >= shown; });
  const folded = foldedLabels(names, shown);
  more.hidden = !folded;
  more.replaceChildren(folded?.text ?? '');
  more.title = folded?.title ?? '';
}

/**
 * Fits a card's row of labels just after it is drawn and again whenever its width changes: each chip is measured
 * at its whole width, then the ones that don't fit are hidden into the +N. Without a layout, as in a test's
 * small document, it shows the first `first` and folds the rest.
 */
export function fitLabels(row: HTMLElement, chips: readonly HTMLElement[], more: HTMLElement, names: readonly string[], first: number): void {
  show(chips, more, names, Math.min(first, chips.length));
  if (typeof ResizeObserver === 'undefined') return;
  // A board redraws on every state message: a row that was on the page and left it lets its observer go.
  let drawn = false;
  const observer = new ResizeObserver(() => fit());
  const fit = () => {
    if (!row.isConnected) {
      if (drawn) observer.disconnect();
      return;
    }
    drawn = true;
    if (!row.clientWidth) return;
    // Measured whole: every chip shown and kept from shrinking, and the +N at its widest.
    for (const c of chips) { c.hidden = false; c.style.flex = 'none'; }
    more.hidden = false;
    more.replaceChildren(`+${chips.length}`);
    const widths = chips.map((c) => c.getBoundingClientRect().width);
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const room = row.clientWidth;
    const plus = more.getBoundingClientRect().width;
    for (const c of chips) c.style.flex = '';
    show(chips, more, names, labelsThatFit(widths, room, gap, plus));
  };
  // Fitted once it is drawn, as reading a width lays the page out, and again whenever its width changes.
  setTimeout(fit, 0);
  observer.observe(row);
}
