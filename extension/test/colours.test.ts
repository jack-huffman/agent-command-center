// Colours come from the theme (GH-105): the page's styles and code name no colour of their own. Every
// colour is a --vscode-* variable, which VSCode's theme sets, or Light's and Dark's palettes in theme.css
// (GH-109), or one of the page's tokens built from them. A colour written anywhere else is one the
// theme can't change, and the author, who is colourblind, can't count on.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { styleFile, styleFiles } from '../scripts/styles.ts';
import { root } from './support.ts';

const WEBVIEW = join(root, 'webview');

/** Every colour CSS names. transparent, currentColor and the like aren't here: they name no colour of their own. */
export const NAMED_COLOURS = new Set(`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey
darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue
lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff
peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/));

/** A colour written as a hex, or as rgb() or hsl(). */
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi;

export interface ColourHit { file: string; line: number; property: string; text: string }

/**
 * The colours a stylesheet writes, in its declarations' values only, so white-space or .tone-orange aren't
 * colours. A var() name, such as --vscode-charts-orange, isn't one either.
 */
export function cssColours(file: string, css: string): ColourHit[] {
  // Comments out, their lines kept, so each hit keeps its line.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const hits: ColourHit[] = [];
  for (const block of text.matchAll(/\{([^{}]*)\}/g)) {
    const body = block[1]!;
    const at = block.index! + 1;
    for (const d of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
      const value = d[2]!.replace(/var\(\s*--[\w-]+/g, 'var(').replace(/--[\w-]+/g, '');
      const named = value.match(/[a-z]+/gi)?.filter((w) => NAMED_COLOURS.has(w.toLowerCase())) ?? [];
      for (const c of [...(value.match(LITERAL) ?? []), ...named]) {
        hits.push({ file, line: text.slice(0, at + d.index!).split('\n').length, property: d[1]!, text: c });
      }
    }
  }
  return hits;
}

/** The string and template literals in a module, comments skipped, each with its line. */
export function literals(ts: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let i = 0;
  const lineAt = (at: number) => ts.slice(0, at).split('\n').length;
  while (i < ts.length) {
    if (ts.startsWith('//', i)) { i = ts.indexOf('\n', i); if (i < 0) break; continue; }
    if (ts.startsWith('/*', i)) { i = ts.indexOf('*/', i) + 2; if (i < 2) break; continue; }
    const q = ts[i]!;
    if (q === '\'' || q === '"' || q === '`') {
      let j = i + 1;
      while (j < ts.length && ts[j] !== q) j += ts[j] === '\\' ? 2 : 1;
      out.push({ line: lineAt(i), text: ts.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * The colours a module of the page writes: a hex, rgb() or hsl() in any string, or a named colour or a hex
 * built from data put into a colour property of an element's style. A word like "orange" elsewhere, as in
 * tone-orange, is a name, and a # elsewhere, as in a task's key, isn't a colour.
 */
export function codeColours(file: string, ts: string): ColourHit[] {
  const hits: ColourHit[] = [];
  for (const l of literals(ts)) for (const c of l.text.match(LITERAL) ?? []) hits.push({ file, line: l.line, property: 'a string', text: c });
  const lineAt = (i: number) => ts.slice(0, i).split('\n').length;
  const colourProp = /(?:colou?r|background|border|fill|stroke|shadow)/i;
  const named = (line: number, property: string, value: string) => {
    for (const w of value.match(/#\$\{|[a-z]+/gi) ?? []) if (w === '#${' || NAMED_COLOURS.has(w.toLowerCase())) hits.push({ file, line, property, text: w });
  };
  // el.style.color = '…'
  for (const m of ts.matchAll(/\.style\.(\w*(?:[cC]olor|[bB]ackground|[bB]order|[fF]ill|[sS]troke|[sS]hadow)\w*)\s*=\s*(['"`])([^'"`]*)\2/g)) named(lineAt(m.index), m[1]!, m[3]!);
  // el.style.setProperty('color', '…')
  for (const m of ts.matchAll(/\.style\.setProperty\(\s*(['"`])([\w-]+)\1\s*,\s*(['"`])([^'"`]*)\3/g)) if (colourProp.test(m[2]!)) named(lineAt(m.index), m[2]!, m[4]!);
  // el.style.cssText = '…' and el.setAttribute('style', '…'): each declaration whose property is a colour's.
  for (const m of ts.matchAll(/(?:\.style\.cssText\s*=\s*|\.setAttribute\(\s*(['"`])style\1\s*,\s*)(['"`])([^'"`]*)\2/g)) {
    for (const d of m[3]!.split(';')) {
      const [prop, ...value] = d.split(':');
      if (prop && value.length && colourProp.test(prop)) named(lineAt(m.index), prop.trim(), value.join(':'));
    }
  }
  return hits;
}

/**
 * The colours the page may write, each with why. The test fails on one that matches nothing, so the list
 * only shrinks.
 */
export const COLOUR_EXCEPTIONS: { name: string; matches: (h: ColourHit) => boolean; reason: string }[] = [
  {
    name: 'mask alpha', matches: (h) => /mask-image$/.test(h.property),
    reason: 'A mask uses only its colours\' alpha, to fade an edge: black or any colour is the same in every theme.',
  },
  {
    name: 'a tracker label\'s colour', matches: (h) => h.file === 'dom.ts' && h.property === '--tint-colour' && h.text === '#${',
    reason: 'A tracker\'s label chip is tinted with the colour the tracker gave it (T-91): its data, not the page\'s palette. The label\'s name always shows on it, in the theme\'s text colour.',
  },
  {
    name: 'a tracker type\'s colour', matches: (h) => h.file === 'dom.ts' && h.property === '--type-colour' && h.text === '#${',
    reason: 'A ticket type\'s icon takes the colour the tracker gave the type (T-95): its data, as a label\'s is. The type\'s word beside it keeps the page\'s text colour.',
  },
];

/** The functions of dom.ts each tracker colour exception reaches (T-95): the label chip\'s tint, and the type icon\'s. */
const TRACKER_COLOUR_PLACES: Record<string, string> = { 'a tracker label\'s colour': 'tinted', 'a tracker type\'s colour': 'typeMark' };

/** Every colour the page's styles and modules write, but theme.css's palettes, which are the theme. */
export function pageColours(dir = WEBVIEW): ColourHit[] {
  const css = styleFiles(dir).filter((f) => f !== 'theme.css').flatMap((f) => cssColours(f, styleFile(f, dir)));
  const ts = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort().flatMap((f) => codeColours(f, readFileSync(join(dir, f), 'utf8')));
  return [...css, ...ts];
}

const where = (h: ColourHit) => `${h.file}:${h.line}: ${h.property} ${h.text}`;

test('the page\'s styles and code write no colour of their own: each comes from the theme, or is an exception with why (GH-105)', (t) => {
  const hits = pageColours();
  const unexcused = hits.filter((h) => !COLOUR_EXCEPTIONS.some((e) => e.matches(h)));
  assert.deepEqual(unexcused.map(where), [], 'a colour written outside the theme: use a --vscode-* variable or --orange, --blue, --line or --card');
  for (const e of COLOUR_EXCEPTIONS) assert.ok(hits.some((h) => e.matches(h)), `the exception for ${e.name} matches nothing: take it off the list`);
  const css = styleFiles().filter((f) => f !== 'theme.css').length;
  t.diagnostic(`scanned ${css} stylesheets and ${readdirSync(WEBVIEW).filter((f) => f.endsWith('.ts')).length} modules: ${hits.length} colours, each an exception`);
  assert.ok(css >= 15, `scanned ${css} stylesheets`);
});

test('the scan finds a hex, rgb(), hsl() and a named colour, with file and line, and passes names that aren\'t colours (GH-105)', () => {
  const css = '.a { color: #f00; }\n/* #123 in a comment */\n.b { background: rgb(1, 2, 3); border-color: hsl(0 50% 50%); }\n.c { outline: 1px solid red; white-space: nowrap; }\n.tone-orange { color: var(--vscode-charts-orange, transparent); }\n@media (max-width: 820px) { .d { fill: currentColor; } }\n';
  assert.deepEqual(cssColours('x.css', css).map(where), ['x.css:1: color #f00', 'x.css:3: background rgb(', 'x.css:3: border-color hsl(', 'x.css:4: outline red']);
  const ts = 'const a = \'tone-orange\'; // #fff in a comment\nel.style.background = `#${c}`; const k = `${p}#${key}`;\nel.style.color = \'red\';\nconst b = "rgba(0, 0, 0, 0.5)";\n/* hsl( */\nconst c = \'issue #12\';\n';
  assert.deepEqual(codeColours('x.ts', ts).map(where), ['x.ts:4: a string rgba(', 'x.ts:2: background #${', 'x.ts:3: color red']);
  // A named colour set any other way the page could: setProperty, cssText, a style attribute. Other properties pass.
  const other = 'el.style.setProperty(\'color\', \'red\');\nel.style.setProperty(\'width\', \'auto\');\nel.style.cssText = \'width: 2px; background-color: blue\';\nel.setAttribute(\'style\', \'border: 1px solid green\');\nel.setAttribute(\'title\', \'color: red\');\n';
  assert.deepEqual(codeColours('y.ts', other).map(where), ['y.ts:1: color red', 'y.ts:3: background-color blue', 'y.ts:4: border green']);
});

test('theme.css holds every colour of both palettes, and nothing else does (GH-109, GH-105)', () => {
  const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;
  // 49 a palette, and eight of each for the label and avatar tints (T-91, T-94). Setup's progress bar went (T-153), and its colour.
  assert.equal((styleFile('theme.css').replace(/\/\*[\s\S]*?\*\//g, '').match(literal) ?? []).length, 114);
});

/** The function of a module a line sits in: the nearest function declared above it. */
const functionAt = (ts: string, line: number): string | null =>
  [...ts.split('\n').slice(0, line).join('\n').matchAll(/^(?:export )?function (\w+)/gm)].at(-1)?.[1] ?? null;

test('the tracker colour exceptions reach only the label chip\'s tint and the type icon\'s, one place each in dom.ts (T-95)', (t) => {
  const hits = pageColours().filter((h) => h.text === '#${');
  const dom = readFileSync(join(WEBVIEW, 'dom.ts'), 'utf8');
  const places = Object.entries(TRACKER_COLOUR_PLACES).map(([name, fn]) => {
    const e = COLOUR_EXCEPTIONS.find((x) => x.name === name)!;
    const its = hits.filter((h) => e.matches(h));
    assert.equal(its.length, 1, `${name}: ${its.map(where).join(', ')}`);
    assert.equal(functionAt(dom, its[0]!.line), fn, `${name} is written in ${fn}`);
    return its[0]!;
  });
  assert.deepEqual(hits.map(where).sort(), places.map(where).sort(), 'a tracker colour written anywhere else is unexcused');
  t.diagnostic(`checked ${places.length} places`);
  assert.equal(places.length, 2);
});

test('edge case: a tracker colour put on any other property, or in another module, matches neither exception (T-95)', () => {
  const stray = [...codeColours('dom.ts', 'el.style.setProperty(\'--other-colour\', `#${c}`);\n'), ...codeColours('tasks.ts', 'el.style.setProperty(\'--type-colour\', `#${c}`);\n')];
  assert.equal(stray.length, 2);
  for (const h of stray) assert.ok(!COLOUR_EXCEPTIONS.some((e) => e.matches(h)), where(h));
});
