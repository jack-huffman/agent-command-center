// What a link may name of a task's page (T-134): one of its tabs (Testing, T-161), or one comment by its id. The tabs' own rules
// are the page's (extension/webview/tab-rules.ts); this is what a message from a page may ask to open.

/** A part a link may name: a tab, or one comment by its id. */
export const TASK_PART = /^(ticket|plan|changes|testing|review|verify|comment:[\w.:-]{1,200})$/;
