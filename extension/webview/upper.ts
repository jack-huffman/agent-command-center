// A word with its first letter in upper case (T-94): one helper for the page and the extension's words alike.
// Plain data with no DOM, so the extension's modules and a test can import it, as history-store.ts is.

/** "parent" reads Parent; an empty string stays empty. */
export const upper = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
