// Third-party code (T-12): each folder under plugin/skills/ that holds a LICENSE file is code copied in from
// elsewhere, and docs/THIRD-PARTY.md has a row for it, with its licence, source, commit and folder.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

/** The rows of the table in docs/THIRD-PARTY.md, by column name. */
function rows(markdown: string): Record<string, string>[] {
  const lines = markdown.split('\n').filter((l) => l.trim().startsWith('|'));
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const [head, separator, ...body] = lines;
  if (!head || !separator) return [];
  const names = cells(head);
  return body.map((l) => Object.fromEntries(cells(l).map((c, i) => [names[i] ?? `${i}`, c])));
}

/** The folders under plugin/skills/ that hold a LICENSE file, from the repo's root. */
function licensed(root: string): string[] {
  const skills = join(root, 'plugin', 'skills');
  return readdirSync(skills, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(skills, d.name, 'LICENSE'))).map((d) => `plugin/skills/${d.name}/`);
}

/** The licensed folders with no row, or a row missing its name, licence, source or commit. */
function unlisted(folders: string[], table: Record<string, string>[]): string[] {
  return folders.filter((f) => !table.some((r) => r.Folder?.replaceAll('`', '') === f && r.Name && r.Licence && /^https:\/\//.test(r.Source ?? '') && /^`?[0-9a-f]{40}`?$/.test(r.Commit ?? '')));
}

test('every folder under plugin/skills/ with a LICENSE file has a full row in docs/THIRD-PARTY.md, and the walk fails when it finds none', () => {
  const folders = licensed(ROOT);
  assert.ok(folders.length > 0, 'no folder under plugin/skills/ holds a LICENSE file: the walk checked nothing');
  const table = rows(readFileSync(join(ROOT, 'docs', 'THIRD-PARTY.md'), 'utf8'));
  assert.deepEqual(unlisted(folders, table), [], 'each of these needs a row: name, licence, source URL, commit and folder');
  assert.ok(folders.includes('plugin/skills/ste100/'));
});

test('a folder with no row, a row missing its commit, or an empty table is unlisted, and a full row is not', () => {
  const full = rows('| Name | Licence | Source | Commit | Folder |\n| --- | --- | --- | --- | --- |\n| x | MIT | https://github.com/a/x | `' + 'a'.repeat(40) + '` | `plugin/skills/x/` |\n| y | MIT | https://github.com/a/y | main | `plugin/skills/y/` |');
  assert.deepEqual(unlisted(['plugin/skills/x/'], full), []);
  assert.deepEqual(unlisted(['plugin/skills/y/'], full), ['plugin/skills/y/'], 'a branch name is no commit');
  assert.deepEqual(unlisted(['plugin/skills/z/'], full), ['plugin/skills/z/'], 'no row');
  assert.deepEqual(rows(''), [], 'an empty file has no rows');
  assert.deepEqual(unlisted(['plugin/skills/x/'], rows('')), ['plugin/skills/x/']);
});

test('the copied skill keeps its licence unchanged beside its SOURCE.md, which names the source and the commit', () => {
  const source = readFileSync(join(ROOT, 'plugin', 'skills', 'ste100', 'SOURCE.md'), 'utf8');
  assert.match(source, /https:\/\/github\.com\/danyuchn\/asd-ste100-skill/);
  assert.match(source, /32511c6992ecb5f1971e46a2943f2e6adceedafe/);
  assert.match(source, /Copied:\*\* \d{4}-\d{2}-\d{2}/);
  assert.match(readFileSync(join(ROOT, 'plugin', 'skills', 'ste100', 'LICENSE'), 'utf8'), /^MIT License\n\nCopyright \(c\) 2026 Dustin Yuchen Teng\n/);
  assert.ok(!existsSync(join(ROOT, 'plugin', 'skills', 'ste100', 'scripts')), 'the Python linter never ships in the plugin');
  assert.match(readFileSync(join(ROOT, 'plugin', 'skills', 'ste100', 'SKILL.md'), 'utf8'), /run `acc ste check`/);
});
