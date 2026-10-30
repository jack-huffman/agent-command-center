// Setup as a guided walkthrough (T-153): a start screen that says where Setup stands, with one button and the
// chapters; then one step on each screen, in order; then an end screen with what was skipped. The tab remembers
// where the person is, and so does the folder (the setup-walk message), so they come back to it. walk.ts works
// out which screen shows and where each button goes.

import type { Action } from '../src/model/shared.ts';
import type { RunCard } from '../src/model/runs.ts';
import type { MachineFirst, SetupModel } from '../src/model/setup.ts';
import type { WalkPlace, WalkStep } from '../src/model/setup-walk.ts';
import { redrawDock } from './dock.ts';
import { actionButton, button, el, header, icon, plural, refreshPage, status, titled, work } from './dom.ts';
import { stepProgress, stepTag } from './stepper.ts';
import { api, go, memory, type PageArea, remember, state } from './state.ts';
import { back, begin, dotState, goTo, next, PASS_PAUSE_MS, type Placed, resume, skip, startButton, WALK_END, WALK_START, walkScreen, type WalkScreen } from './walk.ts';

/** The Setup model last drawn, for a move made between draws, such as the one after a pass. */
let drawn: SetupModel | null = null;
/** The step last drawn while still to do: once it passes, it stays a moment with its Done, then the walk moves on. */
let shownTodo: string | null = null;
let pause: { id: string; timer: number } | null = null;
/** A move the person made: the next draw puts focus on the new screen's heading, so a screen reader starts there. */
let focusHeading = false;

/** Where the walk is: the tab's memory, else where the folder last left it. */
const placeOf = (m: SetupModel): WalkPlace | null => memory().setupWalk ?? m.walk;

/** Keeps the walk's place in the tab and the folder, drawing nothing. */
function keep(p: WalkPlace): void {
  remember((x) => { x.setupWalk = p; });
  api.postMessage({ type: 'setup-walk', place: p });
}

/** Goes to a screen: a pause under way after a pass is dropped, as the person has moved on. */
function move(p: WalkPlace): void {
  if (pause) { clearTimeout(pause.timer); pause = null; }
  shownTodo = null;
  keep(p);
  focusHeading = true;
  if (state.last) state.draw(state.last);
}

/** A step's screen, as the output panel's Open the step goes to it (T-64): Setup, at that step. */
export function showSetupStep(id: string): void {
  if (drawn) keep(goTo(drawn.chapters, placeOf(drawn), id));
  focusHeading = true;
  go('setup');
}

/** A step's fix while it runs, or how it ended: one line, and a way to its output. */
function stepRun(r: RunCard | undefined, open: boolean): HTMLElement | null {
  // A failed run matters only while its step is still to do.
  if (!r || (!r.running && !(open && r.look.tone === 'orange'))) return null;
  const show = button('Show output', 'output', () => { remember((x) => { x.dock = { open: true, run: r.id }; }); redrawDock(); }, 'ghost small');
  return el('div', `step-run tone-row-${r.look.tone}`, status(r.look), titled(el('span', 'muted step-run-cmd', r.label), r.label), show);
}

/** An action as a small icon button, named for screen readers and on hover. */
function iconButton(a: Action): HTMLElement {
  const b = el('button', 'icon-btn', icon(a.icon)) as HTMLButtonElement;
  b.type = 'button';
  b.title = `${a.label} again`;
  b.setAttribute('aria-label', `${a.label} again`);
  b.addEventListener('click', () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }));
  return b;
}

/** Go to it: a step's screen, one click from its chapter or the end screen. Named for its step, as every row has one. */
function goButton(m: SetupModel, p: WalkPlace | null, s: WalkStep): HTMLElement {
  const b = button('Go to it', 'arrow-right', () => move(goTo(m.chapters, p, s.id)), 'ghost small');
  b.setAttribute('aria-label', `Go to it: ${s.title}`);
  return b;
}

/**
 * A step in a list: its state, its name, Skipped for now when it was (unless the list's heading says so of them
 * all), and Go to it while it's still to do.
 */
function stepRow(m: SetupModel, p: WalkPlace | null, s: WalkStep, name = s.name, allSkipped = false): HTMLElement {
  const skipped = !s.done && !allSkipped && !!p?.skipped.includes(s.id);
  const li = el('li', `walk-row${s.done ? ' done' : ''}`, status(s.look), titled(el('span', 'walk-row-name', name), s.detail),
    skipped ? stepTag('walk-skipped', 'debug-step-over', 'Skipped for now') : null,
    s.done ? (s.check ? iconButton(s.check) : null) : goButton(m, p, s));
  li.dataset.step = s.id;
  return li;
}

/**
 * The start screen: where Setup stands in one sentence, and one button (Start, Continue or Check again); then the
 * chapters, This machine's and This project's, each closed with its state, to open for its steps. A project being
 * started (T-133) leads with what this machine still needs for it, and its own Start the project or Go on anyway.
 */
function startScreen(m: SetupModel, p: WalkPlace | null): HTMLElement {
  const { left, button: which } = startButton(m.chapters, p);
  const primary = m.machineFirst?.actions.some((a) => a.primary) ? '' : 'primary';
  const go = which === 'check' ? button('Check again', 'refresh', () => refreshPage(), primary)
    : which === 'continue' ? button('Continue', 'arrow-right', () => move(resume(m.chapters, p)), primary)
      : button('Start', 'arrow-right', () => move(begin(m.chapters)), primary);
  const words = !m.chapters.length ? 'Checking this machine and this project…' : left ? `${plural(left, 'thing')} left to do.` : 'Setup is done.';
  const lead = el('h2', 'walk-lead', icon(left || !m.chapters.length ? 'checklist' : 'pass', left ? undefined : 'blue'), words);
  lead.tabIndex = -1;
  const hero = m.machineFirst ? machineFirstHero(m, m.machineFirst, p, go) : el('div', 'walk-hero', lead, el('div', 'actions', go));
  const parts = m.parts.map((part) => {
    const chapters = m.chapters.filter((c) => c.part === part.part);
    if (!chapters.length) return null;
    const h = el('h3', 'walk-part', icon(part.part === 'machine' ? 'device-desktop' : 'repo'), part.label);
    // Where the first open lands (GH-138): This machine, or, in a folder that isn't set up, This project, which asks what kind it is.
    h.dataset.part = part.part === 'project' && m.start ? m.start.part : part.jump;
    h.tabIndex = -1;
    return el('div', 'walk-chapters', h, ...chapters.map((c) => {
      const d = el('details', 'chapter') as HTMLDetailsElement;
      d.open = memory().sections?.[c.key] ?? false;
      d.addEventListener('toggle', () => remember((x) => { x.sections = { ...(x.sections ?? {}), [c.key]: d.open }; }));
      d.append(el('summary', '', el('span', 'tool-chev', icon('chevron-right')), el('span', 'chapter-title', c.title), status(c.look)),
        el('ul', 'walk-rows', ...c.steps.map((s) => stepRow(m, p, s))));
      return d;
    }));
  });
  const screen = el('section', 'walk-start', hero, ...parts);
  // A jump to a part, such as the first open's, shows the start screen where a step's screen is on show.
  screen.addEventListener('reveal', () => {
    screen.hidden = false;
    screen.nextElementSibling?.remove();
    if (p) keep({ ...p, at: WALK_START });
  });
  return screen;
}

/** Before a project starts (T-133): what this machine still needs for it, each a click away, then the walk or Go on anyway, and Not now. */
function machineFirstHero(m: SetupModel, f: MachineFirst, p: WalkPlace | null, go: HTMLElement): HTMLElement {
  const h = el('h2', 'walk-lead', icon(f.rows.length ? 'device-desktop' : 'pass', f.rows.length ? undefined : 'blue'), f.title);
  h.dataset.part = f.part;
  h.tabIndex = -1;
  const steps = m.chapters.flatMap((c) => c.steps);
  const rows = f.rows.map((r) => steps.find((s) => s.id === r.id)).filter((s): s is WalkStep => !!s);
  return el('div', 'walk-hero machine-first', h, el('p', 'detail', f.detail), rows.length ? el('ul', 'walk-rows', ...rows.map((s) => stepRow(m, p, s, s.title))) : null,
    el('div', 'actions', rows.length ? go : null, ...f.actions.map(actionButton)));
}

/**
 * One step's screen: its chapter and "3 of 8" with a dot for each step of the walk; the one thing to do and why;
 * the live check, with Check again; its one action; how to do it by hand, folded; then Back, Skip for now and
 * Next, which stays off with why until the check passes.
 */
function stepScreen(m: SetupModel, sc: Extract<WalkScreen, { kind: 'step' }>, p: WalkPlace, live: RunCard[]): HTMLElement {
  const s = sc.step;
  const dots = stepProgress(`${sc.index + 1} of ${sc.list.length}`, sc.list.map((x) => ({ title: x.step.title, state: dotState(x, p, s.id) })), (k) => {
    const x = sc.list[k];
    if (x && !x.step.done) move(goTo(m.chapters, p, x.step.id));
  });
  // A step that's done has no screen, so its dot goes nowhere: it's off, and its title says it's done.
  dots.querySelectorAll<HTMLButtonElement>('.rp-dot.done').forEach((b) => { b.disabled = true; });
  const title = el('h2', 'walk-title', s.title);
  title.id = 'walk-title';
  title.tabIndex = -1;
  // Only a step still to do with no action of its own has Check again as its one action.
  const main = s.main ?? (!s.done && s.check ? { ...s.check, label: 'Check again', primary: true } : null);
  const check = el('div', 'walk-check', status(s.look), s.check && main?.command !== s.check.command ? button('Check again', 'refresh', () => api.postMessage({ type: 'run', command: s.check!.command, ref: s.check!.ref }), 'ghost small') : null);
  check.setAttribute('aria-live', 'polite');
  const how = howFold(s);
  const nextB = button('Next', 'arrow-right', () => { if (!nextB.disabled) move(next(m.chapters, p, s.id)); }, s.done ? 'primary' : '');
  nextB.disabled = !!s.next;
  if (s.next) { nextB.title = s.next; nextB.setAttribute('aria-description', s.next); }
  const foot = el('div', 'walk-foot',
    button('Back', 'arrow-left', () => move(back(m.chapters, p, s.id)), 'ghost'),
    el('div', 'walk-foot-why', s.next ? status({ label: s.next, icon: 'info', tone: 'neutral' }) : null),
    s.done ? null : button('Skip for now', 'debug-step-over', () => move(skip(m.chapters, p, s.id)), 'ghost'),
    nextB);
  const screen = el('section', 'walk-step',
    el('div', 'walk-top', el('span', 'walk-chapter', icon(sc.chapter.part === 'machine' ? 'device-desktop' : 'repo'), sc.chapter.title), dots),
    title, s.why ? el('p', 'walk-why', s.why) : null, check, stepRun(live.find((r) => r.step === s.id), !s.done),
    main && !s.done ? el('div', 'walk-do', actionButton(main), s.opens ? el('span', 'muted small walk-opens', `Opens ${s.opens}, then comes back here.`) : null) : null,
    how, foot);
  screen.setAttribute('aria-labelledby', title.id);
  screen.dataset.step = s.id;
  return screen;
}

/**
 * Show how: the step's detail, what Do it does, the command line to run by hand, and its other buttons, such as
 * Guide. Closed until opened; the tab remembers it opened (D-132 keeps the command line in here alone).
 */
function howFold(s: WalkStep): HTMLElement | null {
  if (!s.detail && !s.fix && !s.does && !s.more.length) return null;
  const key = `setup-how:${s.id}`;
  const d = el('details', 'walk-how',
    el('summary', 'muted', 'Show how'),
    s.detail ? el('p', 'detail', s.detail) : null,
    s.does ? el('p', 'muted small step-does', icon('wrench'), `${s.main?.label ?? 'Do it'}: ${s.does}.`) : null,
    s.fix ? work(el('pre', 'fix', s.fix), 'output') : null,
    s.more.length ? el('div', 'actions', ...s.more.map(actionButton)) : null) as HTMLDetailsElement;
  d.open = memory().opened.includes(key);
  d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, key])] : x.opened.filter((o) => o !== key); }));
  return d;
}

/** The end screen: Setup is done, or what's left, skipped ones marked, each a click away. */
function endScreen(m: SetupModel, left: Placed[], p: WalkPlace): HTMLElement {
  const skipped = left.filter((x) => p.skipped.includes(x.step.id)).length;
  const words = !left.length ? 'Setup is done' : skipped === left.length ? `${left.length} skipped` : `${plural(left.length, 'step')} left to do`;
  const title = el('h2', 'walk-title', icon(left.length ? 'debug-step-over' : 'pass', left.length ? 'orange' : 'blue'), words);
  title.id = 'walk-title';
  title.tabIndex = -1;
  const screen = el('section', 'walk-end', title,
    el('p', 'walk-why', left.length ? 'Each one is a click away, whenever you are ready.' : 'Every step has passed.'),
    left.length ? el('ul', 'walk-rows', ...left.map((x) => stepRow(m, p, x.step, x.step.title, skipped === left.length))) : null,
    el('div', 'walk-foot',
      left.length ? button('Back', 'arrow-left', () => move(back(m.chapters, p, WALK_END)), 'ghost') : null,
      el('div', 'walk-foot-why'),
      button('See every step', 'list-unordered', () => move({ ...p, at: WALK_START }), left.length ? '' : 'primary')));
  screen.setAttribute('aria-labelledby', title.id);
  return screen;
}

/** A step that passed while on show stays a moment with its Done, then the walk moves on by itself. */
function holdPass(sc: WalkScreen): void {
  if (sc.kind !== 'step') { shownTodo = null; return; }
  if (!sc.step.done) { shownTodo = sc.step.id; return; }
  if (pause?.id === sc.step.id) return;
  const id = sc.step.id;
  pause = { id, timer: window.setTimeout(() => {
    pause = null;
    const p = drawn && placeOf(drawn);
    if (drawn && p?.at === id) move(next(drawn.chapters, p, id));
  }, PASS_PAUSE_MS) };
}

export function renderSetup(m: SetupModel, live: RunCard[] = []): Node[] {
  drawn = m;
  const p = placeOf(m);
  const sc = walkScreen(m.chapters, p, shownTodo);
  holdPass(sc);
  const summary = m.start ? 'This folder isn\'t set up yet.' : m.total ? 'One thing at a time, with its check.' : 'Checking…';
  // The head keeps Refresh alone (T-153): the VS Code walkthroughs are in the command palette.
  const start = startScreen(m, p);
  const out: Node[] = [header('Setup', summary), start];
  if (sc.kind !== 'start' && p) {
    start.hidden = true;
    out.push(sc.kind === 'step' ? stepScreen(m, sc, p, live) : endScreen(m, sc.left, p));
  }
  return out;
}

export const area: PageArea = {
  sections: { setup: { draw: (m) => renderSetup(m.setup, m.runs) } },
  views: { setup: (m) => renderSetup(m) },
  fallback: true,
  after() {
    if (!focusHeading) return;
    focusHeading = false;
    document.querySelector<HTMLElement>('.walk-step .walk-title, .walk-end .walk-title, .walk-start:not([hidden]) .walk-lead')?.focus({ preventScroll: false });
  },
};
