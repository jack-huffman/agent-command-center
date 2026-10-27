// The issue templates (T-118): .github/ISSUE_TEMPLATE/bug.yml's fields are Report a problem's sections, by id and
// label in the same order, so an issue posted from the Command Center reads as one filed from the template; and
// the draft's body is the template's headings, each with its text or GitHub's own word for none.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { issueBody, NO_RESPONSE, REPORT_SECTIONS } from '../webview/report-text.ts';

const DIR = new URL('../../.github/ISSUE_TEMPLATE/', import.meta.url);

/** Each field of an issue form, from its YAML: its type, id and label, in order. A form field with no id is kept with null. */
function formFields(yaml: string): { type: string; id: string | null; label: string | null }[] {
  const out: { type: string; id: string | null; label: string | null }[] = [];
  for (const block of yaml.split(/\n  - type: /).slice(1)) {
    const type = block.split('\n')[0]!.trim();
    const id = /\n {4}id: (.+)/.exec(block)?.[1]?.trim() ?? null;
    const label = /\n {6}label: (.+)/.exec(block)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? null;
    out.push({ type, id, label });
  }
  return out;
}

test('the bug template\'s fields are the draft\'s sections, by id and label, in the same order', () => {
  const fields = formFields(readFileSync(new URL('bug.yml', DIR), 'utf8')).filter((f) => f.type !== 'markdown');
  assert.ok(fields.length > 0, 'read no fields');
  assert.deepEqual(fields.map((f) => [f.type, f.id, f.label]), REPORT_SECTIONS.map((s) => ['textarea', s.id, s.label]));
  assert.equal(fields.length, 3);
});

test('the template has a name and a description, and config.yml is there', () => {
  const bug = readFileSync(new URL('bug.yml', DIR), 'utf8');
  assert.match(bug, /^name: Report a problem$/m);
  assert.match(bug, /^description: .+/m);
  assert.ok(existsSync(new URL('config.yml', DIR)));
  assert.match(readFileSync(new URL('config.yml', DIR), 'utf8'), /^blank_issues_enabled: (true|false)$/m);
});

test('the draft\'s body is each section\'s heading then its text, as GitHub\'s form writes it, and an empty section says so (edge case)', () => {
  const body = issueBody({ 'what-happened': '  It broke.  ', expected: '', attached: '- VSCode: 1.105.1' });
  assert.equal(body, `### What happened\n\nIt broke.\n\n### What you expected\n\n${NO_RESPONSE}\n\n### What's attached\n\n- VSCode: 1.105.1\n`);
  assert.deepEqual([...body.matchAll(/^### (.+)$/gm)].map((m) => m[1]), REPORT_SECTIONS.map((s) => s.label));
});

test('the form reader: a field with no id or label is read as null, and a quoted label loses its quotes (edge case)', () => {
  const yaml = 'body:\n  - type: markdown\n    attributes:\n      value: hi\n  - type: input\n    id: one\n    attributes:\n      label: "Quoted"\n';
  assert.deepEqual(formFields(yaml), [{ type: 'markdown', id: null, label: null }, { type: 'input', id: 'one', label: 'Quoted' }]);
  assert.deepEqual(formFields(''), []);
});
