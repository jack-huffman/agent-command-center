// How the page moves, answers a press and sizes its text (D-???), from an audit against Apple's design
// guidance: every animation stops or changes under reduced motion, every kind of button shows a press at
// once, and text follows VSCode's font size, so no font-size is in px but an icon's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cssRules, pageStyles, styleFile, styleFiles } from '../scripts/styles.ts';
import { pageSource, root } from './support.ts';

/** codicon.css, which the page loads beside its own styles: its spinner is an animation too. */
const codicons = (): string => readFileSync(join(root, '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'), 'utf8');

/** The body of each block a prelude opens, braces matched, and the stylesheet with those blocks taken out. */
function takeBlocks(css: string, prelude: RegExp): { inner: string[]; rest: string } {
  const inner: string[] = [];
  let rest = '';
  let i = 0;
  for (const m of css.matchAll(new RegExp(prelude.source, 'g'))) {
    if (m.index! < i) continue;
    const open = css.indexOf('{', m.index!);
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    rest += css.slice(i, m.index!);
    inner.push(css.slice(open + 1, j));
    i = j + 1;
  }
  return { inner, rest: rest + css.slice(i) };
}

/** A selector's parts, combinators dropped: classes, ids, pseudo-classes and elements, attributes and tags. */
const parts = (selector: string): string[] => selector.match(/::?[\w-]+(?:\([^)]*\))?|[.#][\w-]+|\[[^\]]*\]|[\w-]+/g) ?? [];
const selectors = (list: string): string[] => list.split(',').map((s) => s.trim()).filter(Boolean);
const animates = (r: { declarations: { name: string; value: string }[] }): boolean => r.declarations.some((d) => (d.name === 'animation' || d.name === 'animation-name') && d.value !== 'none');
const setsAnimation = (r: { declarations: { name: string }[] }): boolean => r.declarations.some((d) => d.name === 'animation' || d.name === 'animation-name');

/**
 * Each selector that runs an animation, and whether a rule under prefers-reduced-motion: reduce stops or
 * changes it. Such a rule covers a selector when each of its parts is one of the selector's: so
 * .codicon-modifier-spin covers codicon.css's .codicon-sync.codicon-modifier-spin.
 */
export function motion(css: string): { selector: string; still: boolean }[] {
  const text = takeBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''), /@keyframes[^{]*/).rest;
  const { inner, rest } = takeBlocks(text, /@media[^{]*prefers-reduced-motion:\s*reduce[^{]*/);
  const still = inner.flatMap((b) => cssRules(b)).filter(setsAnimation).flatMap((r) => selectors(r.selector)).map(parts);
  return cssRules(rest).filter(animates).flatMap((r) => selectors(r.selector)).map((selector) => {
    const has = new Set(parts(selector));
    return { selector, still: still.some((p) => p.length > 0 && p.every((x) => has.has(x))) };
  });
}

test('every animation the page runs stops or changes under reduced motion, and none is missed', () => {
  const found = motion(`${pageStyles()}\n${codicons()}`);
  // It ran: the loading screen's two, the fading line's, and codicon.css's three spinners at least.
  assert.ok(found.length >= 6, `found ${found.length} animations`);
  assert.deepEqual(found.filter((a) => !a.still).map((a) => a.selector), [], 'each of these animates with no prefers-reduced-motion rule that stops or changes it');
  for (const s of ['.lp-row.lp-fading', '.codicon-sync.codicon-modifier-spin', '.codicon-loading.codicon-modifier-spin', '.opening-ring::after']) {
    assert.ok(found.some((a) => a.selector === s), `${s} is one of the animations found`);
  }
});

test('an animation with no reduced-motion rule fails by its selector; a rule for another selector doesn\'t cover it', () => {
  const css = `.a { animation: x 1s; } .b.c { animation: y 1s; } @keyframes x { to { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .c { animation: none; } .d { animation: none; } }`;
  assert.deepEqual(motion(css), [{ selector: '.a', still: false }, { selector: '.b.c', still: true }]);
  // A rule under another media query, or one that changes no animation, isn't one that stops it.
  assert.deepEqual(motion('.a { animation: x 1s; } @media (max-width: 9px) { .a { animation: none; } }'), [{ selector: '.a', still: false }]);
  assert.deepEqual(motion('.a { animation: x 1s; } @media (prefers-reduced-motion: reduce) { .a { color: inherit; } }'), [{ selector: '.a', still: false }]);
  assert.deepEqual(motion('.a { color: inherit; }'), [], 'no animation, nothing found');
});

test('under reduced motion a fading line changes its opacity only, and doesn\'t collapse', () => {
  const css = styleFile('landing.css');
  const { inner } = takeBlocks(css, /@media[^{]*prefers-reduced-motion:\s*reduce[^{]*/);
  const name = cssRules(inner.join('\n')).find((r) => r.selector === '.lp-row.lp-fading')?.declarations.find((d) => d.name === 'animation-name')?.value;
  assert.equal(name, 'lp-fade-still');
  const frames = takeBlocks(css, new RegExp(`@keyframes ${name}\\b[^{]*`)).inner;
  assert.equal(frames.length, 1, `one @keyframes ${name}`);
  const props = new Set(cssRules(frames[0]!).flatMap((r) => r.declarations.map((d) => d.name)));
  assert.deepEqual([...props], ['opacity'], 'it changes opacity, never a height, a padding or a border');
  // The full fade still folds the line away for everyone else.
  const full = takeBlocks(css, /@keyframes lp-fade\b[^{]*/).inner[0]!;
  assert.match(full, /max-height: 0/);
});

/** The first class of each <button> the page draws: each kind of button it has. */
export const buttonKinds = (source: string): string[] =>
  [...new Set([...source.matchAll(/el\('button',\s*[`'"]([\w-]+)/g)].map((m) => m[1]!))].sort();

/** Each rule that styles a press of that kind of button: a selector whose last part has the class and :active. */
const pressRules = (cls: string, css: string) => cssRules(css).filter((r) => selectors(r.selector).some((s) => {
  const last = s.split(/\s+|>|\+|~/).filter(Boolean).at(-1) ?? '';
  return parts(last).includes(`.${cls}`) && last.includes(':active');
}));

test('every kind of button the page draws shows a press at once, with no transition, and hover keeps its fade', () => {
  const kinds = buttonKinds(pageSource());
  // It ran: the page draws more than ten kinds of button, .btn among them.
  assert.ok(kinds.length > 10 && kinds.includes('btn') && kinds.includes('nav-item'), `found ${kinds.length} kinds: ${kinds.join(', ')}`);
  const css = pageStyles();
  const none = kinds.filter((k) => !pressRules(k, css).length);
  assert.deepEqual(none, [], 'each of these kinds of button has no :active style');
  for (const k of kinds) {
    const r = pressRules(k, css);
    assert.ok(r.some((x) => x.declarations.some((d) => d.name === 'transition' && d.value === 'none')), `.${k}:active should show at once, with transition: none`);
    assert.ok(r.some((x) => x.declarations.some((d) => (d.name === 'transform' && d.value === 'scale(0.97)') || d.name === 'background-image')), `.${k}:active should shrink or darken`);
  }
  assert.ok(cssRules(css).some((r) => r.selector === '.btn' && r.declarations.some((d) => d.name === 'transition' && /background-color 0\.12s/.test(d.value))), 'hover keeps its 120 ms fade');
});

test('a button kind with no :active style fails, and a press style on a child doesn\'t count', () => {
  assert.deepEqual(buttonKinds(`el('button', 'btn primary'); el('button', \`seg\${on ? ' on' : ''}\`); el('span', 'chip')`), ['btn', 'seg']);
  assert.equal(pressRules('seg', '.seg:hover { color: inherit; }').length, 0);
  assert.equal(pressRules('seg', '.seg:active .codicon { color: inherit; }').length, 0);
  assert.equal(pressRules('seg', '.segmented .seg:active { transition: none; }').length, 1);
  assert.deepEqual(buttonKinds(''), [], 'no buttons, no kinds');
});

/**
 * The font sizes that stay in px, and why: each an icon. Text takes its size in em from VSCode's font
 * size, so a person who makes the editor's text larger gets larger text here too.
 */
export const PX_FONTS: { selector: RegExp; why: string }[] = [
  { selector: /\.codicon(?:-[\w-]+)?$/, why: 'A codicon: the font is drawn on a 16 px grid, and a whole px size keeps it sharp.' },
  { selector: /^\.agent-cell \.kind$/, why: 'An agent\'s kind is a codicon set as an image, so it keeps a px size as every icon does.' },
];

/** Each font-size in px in a stylesheet, by its selector. */
export const pxFonts = (css: string): string[] =>
  cssRules(css).filter((r) => r.declarations.some((d) => d.name === 'font-size' && /\d(?:\.\d+)?px\b/.test(d.value))).flatMap((r) => selectors(r.selector));

test('no font-size in the page\'s styles is in px, but the icons PX_FONTS names, and each exception reaches only as far as it says', () => {
  const files = styleFiles();
  assert.ok(files.length > 10, `read ${files.length} stylesheets`);
  const all = files.flatMap((f) => pxFonts(styleFile(f)).map((s) => ({ f, s })));
  const ems = cssRules(pageStyles()).filter((r) => r.declarations.some((d) => d.name === 'font-size' && /em$/.test(d.value))).length;
  assert.ok(ems > 50, `${ems} rules size their text in em`);
  const stray = all.filter(({ s }) => !PX_FONTS.some((x) => x.selector.test(s))).map(({ f, s }) => `${f}: ${s}`);
  assert.deepEqual(stray, [], 'each of these sets a font-size in px: use em, at the same size for VSCode\'s 13 px');
  // How far each exception reaches: an icon's rules, and the one agent kind.
  assert.deepEqual(PX_FONTS.map((x) => all.filter(({ s }) => x.selector.test(s)).length), [15, 1]);
  for (const x of PX_FONTS) assert.ok(x.why.length > 20, `${x.selector} says why`);
});

test('a px font-size is found wherever it sits, and an em one or none isn\'t', () => {
  assert.deepEqual(pxFonts('.a { font-size: 9.5px; } .b, .c { font: inherit; font-size: 12px; } @media (max-width: 9px) { .d { font-size: 11px; } }'), ['.a', '.b', '.c', '.d']);
  assert.deepEqual(pxFonts('.a { font-size: 0.9em; } .b { width: 20px; }'), []);
  assert.equal(PX_FONTS.some((x) => x.selector.test('.avatar')), false, 'text isn\'t an exception');
});

test('text converted from px keeps its size at VSCode\'s 13 px, with no size left unset', () => {
  // The free oracle is what each was in px before: at 13 px, em × 13 gives it back.
  const was: Record<string, number> = { '.avatar': 9.5, '.comment .avatar': 10.5, '.act-avatar .avatar': 10.5, '.avatar.avatar-lg': 14, '.tracker-meta': 12 };
  const rules = cssRules(pageStyles());
  const em = (sel: string): number => parseFloat(rules.find((r) => selectors(r.selector).includes(sel) && r.declarations.some((d) => d.name === 'font-size'))!.declarations.find((d) => d.name === 'font-size')!.value);
  for (const [sel, px] of Object.entries(was)) assert.ok(Math.abs(em(sel) * 13 - px) < 0.05, `${sel} is ${em(sel) * 13} px at 13 px, was ${px}`);
  // An avatar in a card's top line sits in text at 0.88em, so it sets its own size to stay at 9.5 px.
  assert.ok(Math.abs(em('.tcard-top') * em('.tcard-top .avatar') * 13 - 9.5) < 0.05);
});

test('large titles sit a little tighter, and body text has no letter spacing of its own', () => {
  const rules = cssRules(pageStyles());
  const spacing = (sel: string) => rules.filter((r) => selectors(r.selector).includes(sel)).flatMap((r) => r.declarations).find((d) => d.name === 'letter-spacing')?.value;
  assert.equal(spacing('h1'), '-0.01em');
  assert.equal(spacing('.ticket-title'), '-0.01em');
  assert.equal(spacing('body'), undefined, 'body text stays at 0');
});
