// Add a board (T-127), in a module of its own with no imports, so the webview and the extension both use it.

/**
 * Add a board's argument for acc.trackers.add (T-127): the project, and that Save adds another board. The Tasks
 * toolbar's Add a board and a saved board's Add another board both send it.
 */
export const addAnother = (root: string): string => JSON.stringify({ root, add: true });
