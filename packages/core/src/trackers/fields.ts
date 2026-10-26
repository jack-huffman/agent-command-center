/**
 * A ticket field's text in each tracker's own format (T-105), through the document model's converters: a
 * field is edited and drafted as Markdown, and goes out as Markdown to GitHub, HTML to an Azure DevOps HTML
 * field, ADF to a Jira long-text field, and plain text to a plain field. Read back, each becomes Markdown again.
 * GitHub has no such field, so a ticket's changes are a section of the issue's description under a heading
 * the Command Center owns, and the rest of the description is never touched.
 */
import { type AdfNode, fromAdf, fromHtml, fromMarkdown, plainText, toAdf, toHtml, toMarkdown } from './doc.ts';
import type { FieldFormat, TextField } from './types.ts';

/** The heading of a GitHub issue's section that holds its changes. Text above and below it is the person's. */
export const GITHUB_SECTION = 'Changes (kept by the Command Center)';

/** GitHub's one place for a ticket's changes: the section of the description under GITHUB_SECTION. */
export const GITHUB_CHANGES: TextField = { id: 'description', name: GITHUB_SECTION, format: 'markdown' };

/**
 * What a field is sent, from Markdown, in its format: Markdown as it is, HTML, ADF, or plain text. Empty
 * text clears the field: null.
 */
export function fieldValue(markdown: string, format: FieldFormat): string | AdfNode | null {
  if (!markdown.trim()) return null;
  const doc = fromMarkdown(markdown);
  switch (format) {
    case 'markdown': return markdown.trim();
    case 'html': return toHtml(doc);
    case 'adf': return toAdf(doc);
    case 'plain': return plainText(doc, { lists: true });
  }
}

/** A field's value as a tracker gives it, as Markdown: '' for none. ADF and HTML go through the document model. */
export function fieldMarkdown(value: unknown, format: FieldFormat): string {
  if (value === null || value === undefined) return '';
  if (format === 'adf') return typeof value === 'object' ? toMarkdown(fromAdf(value as AdfNode)) : String(value).trim();
  if (typeof value !== 'string') return '';
  return format === 'html' ? toMarkdown(fromHtml(value)) : value.trim();
}

/** A Markdown heading's level and text, or null for a line that isn't one. */
const heading = (line: string): { level: number; text: string } | null => {
  const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  return m ? { level: m[1]!.length, text: m[2]! } : null;
};

/** Where the section is in a description's lines: its heading's line and the line after its end. Null when it has none. */
function sectionAt(lines: string[]): { start: number; end: number } | null {
  let fenced = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^ {0,3}(```|~~~)/.test(lines[i]!)) fenced = !fenced;
    const h = fenced ? null : heading(lines[i]!);
    if (!h) continue;
    // The section runs to the next heading as big as its own, or bigger: smaller ones are inside it.
    if (start >= 0 && h.level <= 2) return { start, end: i };
    if (start < 0 && h.level === 2 && h.text === GITHUB_SECTION) start = i;
  }
  return start >= 0 ? { start, end: lines.length } : null;
}

/** The text under a description's changes section, or null when it has none. A heading in a code block doesn't count. */
export function githubSection(body: string): string | null {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const at = sectionAt(lines);
  return at ? lines.slice(at.start + 1, at.end).join('\n').trim() : null;
}

/**
 * The description with its changes section set to `markdown`: in place where it has one, else added at the
 * end. Everything outside the section stays as it was. Empty text leaves the heading with nothing under it.
 */
export function withGithubSection(body: string, markdown: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const at = sectionAt(lines);
  const section = [`## ${GITHUB_SECTION}`, '', ...(markdown.trim() ? [markdown.trim(), ''] : [])];
  if (!at) return `${body.trimEnd()}${body.trim() ? '\n\n' : ''}${section.join('\n').trimEnd()}\n`;
  const after = lines.slice(at.end);
  return [...lines.slice(0, at.start), ...section, ...after].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
