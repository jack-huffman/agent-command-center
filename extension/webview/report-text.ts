// Report a problem's issue text (T-118): its sections, in the order the bug template's fields come
// (.github/ISSUE_TEMPLATE/bug.yml), and the body the page shows and posts. It holds no DOM, so node:test loads it,
// and the template test checks each section against the template's.

/** The draft's sections: each its template field's id and label. */
export const REPORT_SECTIONS = [
  { id: 'what-happened', label: 'What happened' },
  { id: 'expected', label: 'What you expected' },
  { id: 'attached', label: 'What\'s attached' },
] as const;
export type ReportSectionId = (typeof REPORT_SECTIONS)[number]['id'];

/** What the person wrote, and what's attached, by section. */
export type ReportFields = Record<ReportSectionId, string>;

/** What a section left empty says, as a GitHub issue form writes it. */
export const NO_RESPONSE = '_No response_';

/** The issue's body, as GitHub's issue form writes one: each section a heading, then its text. */
export const issueBody = (f: ReportFields): string => REPORT_SECTIONS.map((s) => `### ${s.label}\n\n${f[s.id].trim() || NO_RESPONSE}`).join('\n\n') + '\n';
