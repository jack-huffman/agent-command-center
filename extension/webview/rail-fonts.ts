// The rail's selected tab, scrolled into view again when a font finishes loading (T-24).

/** What the rail needs of document.fonts: the event that says a font finished loading. */
export interface FontEvents {
  addEventListener: (type: 'loadingdone', fn: () => void) => void;
  removeEventListener: (type: 'loadingdone', fn: () => void) => void;
}

/**
 * Calls show each time a font finishes loading, and returns what stops it. document.fonts.ready resolves
 * before the icon font starts to load (nothing has asked for it yet), so the tabs widen after it and the
 * selected tab can end up past the strip's edge. loadingdone is used rather than fonts.load('codicon'): it
 * needs no font name, and also covers a font that is asked for later than the rail's first frame.
 */
export function showOnFontLoad(fonts: FontEvents, show: () => void): () => void {
  fonts.addEventListener('loadingdone', show);
  return () => fonts.removeEventListener('loadingdone', show);
}
