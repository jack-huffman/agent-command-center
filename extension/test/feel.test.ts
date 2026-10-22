// How the page moves, answers a press and sizes its text (D-147), from an audit against Apple's design
// guidance: every animation stops or changes under reduced motion, every kind of button shows a press at
// once, and text follows VSCode's font size, so no font-size is in px but an icon's.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
function motion(css: string): { selector: string; still: boolean }[] {
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
const buttonKinds = (source: string): string[] =>
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
  assert.deepEqual(buttonKinds(`el('button', 'btn primary'); el('button', \`seg\${on ? ' on' : ''}\`); el('span', 'tag')`), ['btn', 'seg']);
  assert.equal(pressRules('seg', '.seg:hover { color: inherit; }').length, 0);
  assert.equal(pressRules('seg', '.seg:active .codicon { color: inherit; }').length, 0);
  assert.equal(pressRules('seg', '.segmented .seg:active { transition: none; }').length, 1);
  assert.deepEqual(buttonKinds(''), [], 'no buttons, no kinds');
});

/**
 * The font sizes that stay in px, and why: each an icon. Text takes its size in em from VSCode's font
 * size, so a person who makes the editor's text larger gets larger text here too.
 */
const PX_FONTS: { selector: RegExp; why: string }[] = [
  { selector: /\.codicon(?:-[\w-]+)?$/, why: 'A codicon: the font is drawn on a 16 px grid, and a whole px size keeps it sharp.' },
  { selector: /^\.agent-cell \.kind$/, why: 'An agent\'s kind is a codicon set as an image, so it keeps a px size as every icon does.' },
];

/** Each font-size in px in a stylesheet, by its selector. */
const pxFonts = (css: string): string[] =>
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
  // avatar() in dom.ts draws a person's initials as .avatar, the class these sizes are for.
  assert.match(pageSource('dom.ts'), /export function avatar\(p: PersonChip\): HTMLElement \{\n  const a = el\('span', 'avatar', p\.initials\);/);
  for (const [sel, px] of Object.entries(was)) assert.ok(Math.abs(em(sel) * 13 - px) < 0.05, `${sel} is ${em(sel) * 13} px at 13 px, was ${px}`);
  // An avatar in a card's top line sits in text at 0.88em, so it sets its own size to stay at 9.5 px.
  assert.ok(Math.abs(em('.tcard-top') * em('.tcard-top .avatar') * 13 - 9.5) < 0.05);
});

test('large titles sit a little tighter, and body text has no letter spacing of its own', () => {
  const rules = cssRules(pageStyles());
  const spacing = (sel: string) => rules.filter((r) => selectors(r.selector).includes(sel)).flatMap((r) => r.declarations).find((d) => d.name === 'letter-spacing')?.value;
  assert.equal(spacing('h1'), '-0.01em');
  // A ticket's title takes the scale's title tracking (T-91).
  assert.equal(spacing('.ticket-title'), 'var(--track-title)');
  assert.equal(rules.find((r) => r.selector === ':root' && r.declarations.some((d) => d.name === '--track-title'))?.declarations.find((d) => d.name === '--track-title')?.value, '-0.015em');
  assert.equal(spacing('body'), undefined, 'body text stays at 0');
});

/** A line of the page's source that draws a primary button: a 'primary' class, or a primary passed or read. */
const PRIMARY_MARK = /'primary\b|'btn primary\b|\? ' primary'|(?:toolbarButton|argButton)\([^;]*,\s*(?:true|[\w.]*\.primary)\)/;

/**
 * The places the page may draw a primary button, the blue fill, each with its reason: only where the
 * person must act (D-147, T-39). Answer, Resume and a Needs you step, a fix for a sign-in that failed, and
 * the button that sends what the person typed in the box beside it. Anything else is outlined.
 */
const PRIMARY: { file: string; at: RegExp; why: string }[] = [
  { file: 'agent-page.ts', at: /'primary small'/, why: 'Send: the message the person typed, to an agent that waits on it.' },
  { file: 'agents.ts', at: /b\('Answer'/, why: 'Answer: an agent waits on the person\'s answer to its question.' },
  { file: 'verify.ts', at: /\(first \? 'primary' : ''\);$/, why: 'Verify the developer\'s work (T-84): Verify before there is a verification, then Open the QA comment, the comment the person edits and posts.' },
  { file: 'manifest.ts', at: /s\.built \? '' : 'primary'\),$/, why: 'Manifest for this ticket (T-101): Build the manifest, before there is one.' },
  { file: 'manifest.ts', at: /s\.built \? 'primary' : '', \{ check: true \}\),$/, why: 'Manifest for this ticket (T-101): once it\'s built, Check against the org, which reads the org\'s fresh copies.' },
  { file: 'criteria.ts', at: /primary \? 'primary' : ''\);$/, why: 'Drafted acceptance criteria (T-81): Draft acceptance criteria before there is a draft, then Add to the description, the person\'s next step, as the model marks it.' },
  { file: 'analysis.ts', at: /button\('Answer'/, why: 'Answer: the analysis waits on the person\'s answer.' },
  { file: 'task-actions.ts', at: /\$\{primary \? ' primary'/, why: 'A task\'s next step, on its page and its card, such as a card\'s Answer: primary only where the model\'s action is (D-168).' },
  { file: 'task-sheet.ts', at: /'primary ts-go'/, why: 'The task sheet\'s Add task or Save: what the person wrote in it, sent; the sheet opened only to take it (T-74).' },
  { file: 'task-sheet.ts', at: /button\('Keep mine'/, why: 'Keep mine: the Save the person asked for, which stopped because the ticket changed meanwhile, and waits on their pick (T-80).' },
  { file: 'dispatch-sheet.ts', at: /'primary ds-go'/, why: 'The sheet\'s Dispatch: what the person chose in it, sent; the sheet opened only to take it (D-168).' },
  { file: 'connect.ts', at: /m\.method\.test/, why: 'Test, until the sign-in passes: the dialog can\'t go on without it.' },
  { file: 'connect.ts', at: /m\.save\.label/, why: 'Save: the dialog\'s last step, which the person opened it to take.' },
  { file: 'detail.ts', at: /a\.extra\.arg, true\)/, why: 'A Needs you step: the fix for a tracker that is not signed in.' },
  { file: 'dock-review.ts', at: /'btn primary dr-next'/, why: 'A finished review\'s next step: Land a pass, or send changes back to the builder, the one thing the person does next (T-63).' },
  { file: 'run-view.ts', at: /'btn primary dock-next'/, why: 'An ended run\'s next step on its result card: Run again, or Open the step, the one thing the person does next (T-64).' },
  { file: 'dock.ts', at: /button\('Yes'/, why: 'Yes: a run asks the person, and waits.' },
  { file: 'dock.ts', at: /button\('Send'/, why: 'Send: the answer the person typed to a run that asks.' },
  { file: 'dom.ts', at: /\$\{a\.primary \?/, why: 'actionButton: primary only when the model\'s action says so. The model sets it for a next step that needs the person.' },
  { file: 'dom.ts', at: /\$\{primary \?/, why: 'toolbarButton and argButton: primary only when the caller says so, and this test reads each caller.' },
  { file: 'environments.ts', at: /'Onboard this project'.*true\)/, why: 'An empty tab with no project: onboarding is the one way on, and only the person can start it.' },
  { file: 'tasks.ts', at: /'Onboard this project'.*true\)/, why: 'An empty tab with no project: onboarding is the one way on, and only the person can start it.' },
  { file: 'worktrees.ts', at: /'Onboard this project'.*true\)/, why: 'An empty tab with no project: onboarding is the one way on, and only the person can start it.' },
  { file: 'landing.ts', at: /b\.primary \?/, why: 'The Overview\'s lines: primary in Needs you only, as the model sets it (D-147, landing.test.ts).' },
  { file: 'overview.ts', at: /'Add task'.*true\)/, why: 'The Overview\'s header, which D-150 laid out and T-39 leaves out of its scope.' },
  { file: 'questions.ts', at: /button\(isCommand/, why: 'An agent\'s question: the answer the person gives it.' },
  { file: 'questions.ts', at: /q-choice\$\{c\.primary/, why: 'An agent\'s question: its Yes, as the model marks it.' },
  { file: 'questions.ts', at: /'primary q-send'/, why: 'An agent\'s question: Send, the answer the person typed.' },
  { file: 'rules.ts', at: /button\('Accept…'/, why: 'A suggested rule waits on the person\'s yes or no: Accept… is the yes.' },
  { file: 'rules.ts', at: /^\s*\}, 'primary'\);$/, why: 'Confirm: the rule the person wrote, sent.' },
  { file: 'dom.ts', at: /a\.primary\)/, why: 'settingsButton, which Settings and About share (T-71): Settings\' fix for a tracker or GitHub not signed in, and About\'s for a plugin out of date or off. The model marks it primary then, and only then.' },
  { file: 'slack.ts', at: /c\.tail \? '' : 'primary'/, why: 'Connect: the webhook the person pasted in the box beside it.' },
  { file: 'slack.ts', at: /'Send a test'.*'paused'/, why: 'Send a test while notices are paused: nothing is sent until a test goes through.' },
  { file: 'task-page.ts', at: /'Comment'/, why: 'Comment: the comment the person typed in the box beside it.' },
  { file: 'task-page.ts', at: /m\.connect\.label/, why: 'The fix for a tracker that is not signed in, so the ticket can\'t load.' },
  { file: 'tasks.ts', at: /button\(WORDS\.addToWork, 'add', send, 'primary'/, why: 'Add to my work: the thread link the person pasted in the box beside it.' },
  { file: 'tasks.ts', at: /b\.connect\.label/, why: 'The fix for a tracker that is not signed in, so its board can\'t load.' },
  { file: 'updates.ts', at: /'primary'\);$/, why: 'Post: an update the person drafted, sent.' },
];

/** Each line of each file that draws a primary button, and how many PRIMARY entries it matches. */
function primaries(files: Record<string, string>, places = PRIMARY): { file: string; line: string; matches: number }[] {
  return Object.entries(files).flatMap(([file, src]) => src.split('\n').filter((l) => PRIMARY_MARK.test(l)).map((line) => ({ file, line: line.trim(), matches: places.filter((p) => p.file === file && p.at.test(line)).length })));
}

const webviewFiles = (): Record<string, string> => Object.fromEntries(readdirSync(join(root, 'webview')).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(join(root, 'webview', f), 'utf8')]));

test('the page draws a primary button only where PRIMARY says, each with its reason, and each place is still drawn (T-39)', () => {
  const src = webviewFiles();
  const found = primaries(src);
  // It ran: about 30 places across the page.
  assert.ok(found.length >= 25, `found ${found.length} primary buttons`);
  assert.deepEqual(found.filter((f) => f.matches !== 1).map((f) => `${f.file}: ${f.line}`), [], 'each of these draws a primary button that PRIMARY names not once: outline it, or name it with why it needs the person');
  const stale = PRIMARY.filter((p) => !found.some((f) => f.file === p.file && p.at.test(f.line)));
  assert.deepEqual(stale.map((p) => `${p.file}: ${p.at}`), [], 'each of these names a place that no longer draws a primary button');
  for (const p of PRIMARY) assert.ok(p.why.length > 30, `${p.file} ${p.at} says why`);
  // The places T-39 outlined stay outlined: Open org, Switch account, Add task, Start a background agent,
  // Slack's Turn on and a ticket's Track in acc.
  assert.doesNotMatch(readFileSync(join(root, 'src', 'model', 'environments.ts'), 'utf8'), /label: 'Open org'[^}]*primary/);
  assert.match(src['environments.ts']!, /argButton\('acc\.github\.switch', [^;]*'arrow-swap', root\),/);
  assert.match(src['tasks.ts']!, /toolbarButton\('acc\.task\.add', 'Add task', 'add', p\.root\)\]/);
  assert.match(src['agents.ts']!, /toolbarButton\('acc\.agent\.new', 'Start a background agent', 'add', [^;]*\?\? undefined\);/);
  assert.match(src['slack.ts']!, /act\('Turn on', 'play', 'on'\)/);
  assert.match(src['task-page.ts']!, /el\('button', 'btn ticket-track'\)/);
});

test('a primary button with no reason fails, one whose place matches twice fails, and an outlined one isn\'t counted (T-39)', () => {
  const places = [{ file: 'a.ts', at: /'Go'/, why: 'x' }, { file: 'a.ts', at: /button\('G/, why: 'x' }];
  assert.deepEqual(primaries({ 'a.ts': "button('Open', 'globe', go, 'primary');" }, places).map((f) => f.matches), [0], 'a primary no place names');
  assert.deepEqual(primaries({ 'a.ts': "button('Go', 'go', go, 'primary');" }, places).map((f) => f.matches), [2], 'named twice');
  assert.deepEqual(primaries({ 'b.ts': "button('Go', 'go', go, 'primary');" }, places).map((f) => f.matches), [0], 'another file\'s entries don\'t reach it');
  assert.deepEqual(primaries({ 'a.ts': "toolbarButton('acc.x', 'Open', 'globe', root, true);\nargButton('acc.y', 'Y', 'y', arg, a.primary);\nel('button', 'btn primary', icon('x'), 'Open org');" }, []).map((f) => f.matches), [0, 0, 0], 'a primary passed in, read from the model or set as a class is found');
  assert.deepEqual(primaries({ 'a.ts': "toolbarButton('acc.x', 'Open', 'globe', root);\nbutton('Go', 'go', go, 'ghost');" }, places), [], 'outlined, nothing found');
  assert.deepEqual(primaries({}), [], 'no files, nothing found');
});

/** The selectors of each rule outside reduced motion whose transition scales or translates (T-47; a chevron turning in place is neither), with no reduced-motion rule that pins them: what the animation walk above can't see. */
function movingTransitions(css: string): string[] {
  const text = takeBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''), /@keyframes[^{]*/).rest;
  const { inner, rest } = takeBlocks(text, /@media[^{]*prefers-reduced-motion:\s*reduce[^{]*/);
  const pinned = inner.flatMap((b) => cssRules(b)).filter((r) => r.declarations.some((d) => ['scale', 'transform', 'translate'].includes(d.name))).flatMap((r) => selectors(r.selector)).map(parts);
  return cssRules(rest).filter((r) => r.declarations.some((d) => d.name === 'transition' && /\b(scale|translate)\b/.test(d.value)))
    .flatMap((r) => selectors(r.selector)).filter((selector) => {
      const has = new Set(parts(selector));
      return !pinned.some((p) => p.length > 0 && p.every((x) => has.has(x)));
    });
}

test('a transition that scales or moves has a reduced-motion rule that pins its scale, and the task modal\'s starting style too (T-47)', () => {
  assert.deepEqual(movingTransitions(pageStyles()), [], 'each of these transitions scale or translate with no prefers-reduced-motion rule that pins it');
  const modal = takeBlocks(styleFile('task-modal.css'), /@media[^{]*prefers-reduced-motion:\s*reduce[^{]*/).inner.join('\n');
  assert.match(modal, /\.task-modal\[open\][^{]*\{[^}]*scale:\s*1/, 'the open modal keeps its size under reduced motion');
  assert.match(modal, /@starting-style\s*\{[^{]*\{[^}]*scale:\s*1/, 'and so does the style it starts from: it only fades');
});

test('edge case: a scaling transition with no reduced-motion rule, or with one for another selector, is found', () => {
  assert.deepEqual(movingTransitions('.a { transition: scale 1s; }'), ['.a']);
  assert.deepEqual(movingTransitions('.a { transition: opacity 1s; }'), [], 'a fade alone isn\'t motion');
  assert.deepEqual(movingTransitions('.a { transition: translate 1s; } @media (prefers-reduced-motion: reduce) { .b { translate: none; } }'), ['.a']);
  assert.deepEqual(movingTransitions('.a { transition: translate 1s; } @media (prefers-reduced-motion: reduce) { .a { translate: none; } }'), []);
  assert.deepEqual(movingTransitions('.a { transition: transform 1s; }'), [], 'a turn in place, such as a chevron\'s, isn\'t travel');
});
