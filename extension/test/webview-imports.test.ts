// The page imports no values from outside extension/webview (D-121), and its copy of `plural` matches the core's.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { plural as corePlural } from '../../packages/core/src/text.ts';

const webview = resolve(dirname(fileURLToPath(import.meta.url)), '../webview');

/** Each import or re-export that isn't `import type` and reaches outside `dir`, as "line N: specifier". */
const outsideValueImports = (source: string, dir: string): string[] => {
  const found: string[] = [];
  const re = /^[ \t]*(import|export)(\s+type)?\b([^;'"]*?\bfrom)?\s*['"]([^'"]+)['"]/gm;
  for (const m of source.matchAll(re)) {
    if (m[2] || (m[1] === 'export' && !m[3])) continue;
    const spec = m[4]!;
    const inside = spec.startsWith('.') && !relative(dir, resolve(dir, spec)).startsWith('..');
    if (!inside) found.push(`line ${source.slice(0, m.index).split('\n').length}: ${spec}`);
  }
  return found;
};

test('the page imports no values from outside extension/webview, only types (D-121)', () => {
  const files = readdirSync(webview, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 0, 'read no page files');
  const bad = files.flatMap((f) => outsideValueImports(readFileSync(join(webview, f), 'utf8'), webview).map((b) => `extension/webview/${f} ${b}`));
  assert.deepEqual(bad, [], `a value import from outside the page, use import type:\n${bad.join('\n')}`);
});

test('the import check catches each form of value import and lets type imports and inner files pass', () => {
  const src = [
    "import type { A } from '../src/a.ts';",
    "import { b } from './state.ts';",
    "import { c } from '../src/c.ts';",
    'import {',
    '  d,',
    "} from '../../packages/core/src/d.ts';",
    "export { e } from '../src/e.ts';",
    "export type { F } from '../src/f.ts';",
    "import 'left-pad';",
    'export const x = 1;',
    "export * from '../src/g.ts';",
    "import { type H } from '../src/h.ts';",
  ].join('\n');
  assert.deepEqual(outsideValueImports(src, webview), [
    'line 3: ../src/c.ts',
    'line 4: ../../packages/core/src/d.ts',
    'line 7: ../src/e.ts',
    'line 9: left-pad',
    'line 11: ../src/g.ts',
    'line 12: ../src/h.ts',
  ]);
});

/** `plural` from dom.ts, read from its source: the page's modules can't load in node, where there is no VS Code API. */
const pagePlural = (): ((n: number, one: string, many?: string) => string) => {
  const m = /export const plural = (\([^)]*\)) => (.*);\n/.exec(readFileSync(join(webview, 'dom.ts'), 'utf8'));
  assert.ok(m, 'found no plural in dom.ts');
  const params = m[1]!.replace(/: (number|string)/g, '');
  return new Function(`return ${params} => ${m[2]}`)() as never;
};

test("the page's plural gives the same text as the core's, with two arguments and with three", () => {
  const page = pagePlural();
  let cases = 0;
  for (const n of [0, 1, 2, 5, 100, -1]) {
    for (const one of ['file', 'task', 'entry']) {
      assert.equal(page(n, one), corePlural(n, one), `${n} ${one}`);
      assert.equal(page(n, one, 'entries'), corePlural(n, one, 'entries'), `${n} ${one} entries`);
      cases += 2;
    }
  }
  assert.equal(cases, 36);
});
