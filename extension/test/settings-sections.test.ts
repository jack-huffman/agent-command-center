// Settings in sections (T-139): the jump list and its picker show one section, the tab remembers it, a deep link
// shows its part's section, long lists fold with a count, and every control the page drew before it was split
// into sections is still drawn, by name, and still does something. Drawn in page-dom.ts's small document; the
// page in a browser, at each width and theme, is the screenshot run's, and its jump the behaviour run's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudTokenUnavailable } from '../../packages/core/src/cloud.ts';
import type { HomeModel } from '../src/model/home.ts';
import { sectionOfPart, SETTINGS_SECTIONS, type SettingsModel, settingsSections } from '../src/model/settings.ts';
import { pageDom, type PageElement } from './page-dom.ts';

// A tab that keeps its memory, as VS Code's does: the section shown is read on the next draw.
const page = pageDom();
let saved: Record<string, unknown> | undefined;
/** What the tab remembers now: read through this, so a test's own `saved = …` doesn't narrow it. */
const mem = (): Record<string, unknown> => saved ?? {};
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => saved, setState: (s: Record<string, unknown>) => { saved = s; } });
const { renderSettings, shownSection, LONG_LIST } = await import('../webview/settings.ts');
const { scrollToHeading } = await import('../webview/state.ts');
const { moreKey } = await import('../webview/dom.ts');
const { sampleModel } = await import('../scripts/screenshot.ts');

const NOW = Date.UTC(2026, 9, 28);
const KINDS = ['settings', 'settings-agents', 'settings-trackers', 'settings-queues', 'settings-limits', 'settings-github', 'settings-page', 'settings-about', 'settings-about-failed', 'slack-none', 'slack-off', 'slack-paused'] as const;
const model = (kind: (typeof KINDS)[number]): SettingsModel => (sampleModel(kind, NOW, 'dark') as HomeModel).settings;
const draw = (m: SettingsModel): PageElement[] => renderSettings(m) as unknown as PageElement[];
const under = (nodes: PageElement[]): PageElement[] => nodes.flatMap((n) => [n, ...n.all()]);
const sectionsOf = (nodes: PageElement[]): PageElement[] => under(nodes).filter((e) => e.classList.contains('settings-section'));
const shown = (nodes: PageElement[]): string[] => sectionsOf(nodes).filter((s) => !s.hidden).map((s) => s.dataset.section!);
const linksOf = (nodes: PageElement[]): PageElement[] => under(nodes).filter((e) => e.classList.contains('settings-jump-link'));
const pickerOf = (nodes: PageElement[]): PageElement & { value?: string } => under(nodes).find((e) => e.classList.contains('settings-picker'))!;

/** A control as the test of every control names it: its tag, its accessible name, and [off] when it can't be used. */
const controlName = (e: PageElement): string => `${e.tagName} ${e.getAttribute('aria-label') ?? e.textContent}${e.disabled || e.getAttribute('aria-disabled') ? ' [off]' : ''}`;
const controls = (nodes: PageElement[]): PageElement[] => under(nodes).filter((e) => ['BUTTON', 'SELECT', 'INPUT'].includes(e.tagName));

/**
 * Every control Settings drew before T-139 split it into sections, by controlName, across the pages the screenshot
 * run shoots: read from the page at main's 556aee02 with this file's KINDS. Pinned here, so a control a later
 * change drops fails by name.
 */
const BEFORE = [
  'BUTTON Add Projects access on GitHub for jordan-kim, for Acme Portal',
  'BUTTON Add Projects access on GitHub for jordan-kim, for Acme Service',
  "BUTTON Change Acme Service's cap",
  "BUTTON Change acme service's cap",
  "BUTTON Change builders' checks",
  "BUTTON Change builders' model, effort or fallback, in Acme Portal",
  "BUTTON Change builders' model, effort or fallback, in Acme Service",
  'BUTTON Change heavy-check slots',
  'BUTTON Change heavy-check slots: ACC_HEAVY_SLOTS sets it for this VSCode: take it out of the environment VSCode starts in to set it here. [off]',
  'BUTTON Change place: where ACME Service board, in Acme Service gets its tickets, its board and its name',
  'BUTTON Change place: where Azure DevOps · CRM, in Acme Portal gets its tickets, its board and its name',
  'BUTTON Change place: where Issues · acme/portal, in Acme Portal gets its tickets, its board and its name',
  'BUTTON Change place: where Jira · GLX, in Acme Portal gets its tickets, its board and its name',
  'BUTTON Change place: where Slack · acme, in Acme Portal gets its tickets, its board and its name',
  'BUTTON Change place: where Unassigned issues, in Acme Service gets its tickets, its board and its name',
  'BUTTON Change place: where Waiting for support, in Acme Service gets its tickets, its board and its name',
  'BUTTON Change place: where epic ACME-3 Premium Support, in Acme Portal gets its tickets, its board and its name',
  'BUTTON Change place: where epic ACME-3 Premium Support, in Acme Service gets its tickets, its board and its name',
  'BUTTON Change place: where monday.com · acme, in Acme Service gets its tickets, its board and its name',
  'BUTTON Change required checks',
  "BUTTON Change reviewers' model, effort or fallback, in Acme Portal",
  "BUTTON Change reviewers' model, effort or fallback, in Acme Service",
  "BUTTON Change routine: give the Command Center Acme Service's routine",
  'BUTTON Change source tracking',
  "BUTTON Change this machine's total",
  "BUTTON Change tool's cap",
  'BUTTON Change what autopilot may do on its own, in Acme Portal',
  'BUTTON Change what autopilot may do on its own, in Acme Service',
  'BUTTON Change whether autopilot merges pull requests, in Acme Portal',
  "BUTTON Change… where to keep a ticket's changes, for ACME Service board, in Acme Service",
  "BUTTON Change… where to keep a ticket's changes, for Issues · acme/portal, in Acme Portal",
  "BUTTON Change… where to keep a ticket's changes, for Unassigned issues, in Acme Service",
  "BUTTON Change… where to keep a ticket's changes, for epic ACME-3 Premium Support, in Acme Portal",
  "BUTTON Change… where to keep a ticket's changes, for epic ACME-3 Premium Support, in Acme Service",
  'BUTTON Check now for a newer release, and read the versions again',
  "BUTTON Choose… where to keep a ticket's changes, for Azure DevOps · CRM, in Acme Portal",
  "BUTTON Choose… where to keep a ticket's changes, for Jira · GLX, in Acme Portal",
  "BUTTON Choose… where to keep a ticket's changes, for Slack · acme, in Acme Portal [off]",
  "BUTTON Choose… where to keep a ticket's changes, for Waiting for support, in Acme Service",
  "BUTTON Choose… where to keep a ticket's changes, for monday.com · acme, in Acme Service",
  'BUTTON Connect',
  'BUTTON Connect a tracker to a project',
  'BUTTON Copy the routine prompt for Acme Service',
  'BUTTON Dark',
  "BUTTON Default: choose where Acme Service's builders go",
  'BUTTON Folder',
  'BUTTON Full path',
  'BUTTON How to make one',
  'BUTTON Install and reload: 0.38.0, then the Command Center opens on it',
  'BUTTON Light',
  "BUTTON Lower Acme Service's cap to 2",
  "BUTTON Lower Acme Service's cap: One is the least: a project runs at least one builder. [off]",
  "BUTTON Lower Tool's cap to 15",
  "BUTTON Lower this machine's total to 5",
  "BUTTON Lower this machine's total: There's no total to lower: Change… sets one. [off]",
  'BUTTON Match VSCode',
  'BUTTON Normal',
  'BUTTON Open Setup',
  "BUTTON Raise Acme Service's cap to 2",
  "BUTTON Raise Acme Service's cap to 4",
  "BUTTON Raise Tool's cap: 16 is the most a project runs at once. [off]",
  "BUTTON Raise this machine's total to 7",
  "BUTTON Raise this machine's total: There's no total to raise: Change… sets one. [off]",
  'BUTTON Refresh',
  'BUTTON Relaxed',
  'BUTTON Remove',
  'BUTTON Remove ACME Service board, in Acme Service',
  'BUTTON Remove Azure DevOps · CRM, in Acme Portal',
  'BUTTON Remove Issues · acme/portal, in Acme Portal',
  'BUTTON Remove Jira · GLX, in Acme Portal',
  'BUTTON Remove Slack · acme, in Acme Portal',
  'BUTTON Remove Unassigned issues, in Acme Service',
  'BUTTON Remove Waiting for support, in Acme Service',
  'BUTTON Remove epic ACME-3 Premium Support, in Acme Portal',
  'BUTTON Remove epic ACME-3 Premium Support, in Acme Service',
  'BUTTON Remove monday.com · acme, in Acme Service',
  'BUTTON Replace',
  "BUTTON Report a problem: draft an issue for the Command Center's author, and see all of it before it's posted",
  "BUTTON Reviews: choose where Acme Portal's reviews run [off]",
  "BUTTON Reviews: choose where Acme Service's reviews run",
  'BUTTON Send a test',
  'BUTTON Sign in again to ACME Service board, in Acme Service',
  'BUTTON Sign in again to Azure DevOps · CRM, in Acme Portal',
  'BUTTON Sign in again to Jira · GLX, in Acme Portal',
  'BUTTON Sign in again to Slack · acme, in Acme Portal',
  'BUTTON Sign in again to Unassigned issues, in Acme Service',
  'BUTTON Sign in again to Waiting for support, in Acme Service',
  'BUTTON Sign in again to epic ACME-3 Premium Support, in Acme Portal',
  'BUTTON Sign in again to epic ACME-3 Premium Support, in Acme Service',
  'BUTTON Sign in to GitHub as jordan-kim, for Acme Portal',
  'BUTTON Sign in to monday.com · acme, in Acme Service',
  'BUTTON Sign out of ACME Service board, in Acme Service',
  'BUTTON Sign out of Azure DevOps · CRM, in Acme Portal',
  'BUTTON Sign out of Jira · GLX, in Acme Portal',
  'BUTTON Sign out of Slack · acme, in Acme Portal',
  'BUTTON Sign out of Unassigned issues, in Acme Service',
  'BUTTON Sign out of Waiting for support, in Acme Service',
  'BUTTON Sign out of epic ACME-3 Premium Support, in Acme Portal',
  'BUTTON Sign out of epic ACME-3 Premium Support, in Acme Service',
  'BUTTON Sign out of monday.com · acme, in Acme Service [off]',
  'BUTTON Slow',
  'BUTTON Switch the GitHub account Acme Portal pushes as, in this clone',
  'BUTTON Switch the GitHub account Acme Service pushes as, in this clone',
  "BUTTON Token: keep the routine's token for Acme Service",
  'BUTTON Turn off',
  'BUTTON Turn off cloud builders for Acme Service',
  'BUTTON Turn on',
  'BUTTON Turn on cloud builders for Acme Portal',
  "BUTTON Update the plugin to 0.37.0: the Command Center's Claude Code plugin, as Setup's A4 does",
  'INPUT ',
  'INPUT Slack incoming webhook',
  'SELECT Opens on',
];

/**
 * What T-139 renamed: a tracker's Change place… is Change tracker…, where changing a tracker starts (T-140). BEFORE
 * was read on a Mac; where there's no keychain, as on Windows, the routine's Token… is drawn off, with why (D-209).
 */
const renamed = (name: string): string => {
  const now = name.replace(/^BUTTON Change place: where /, 'BUTTON Change tracker: where ');
  return now.startsWith('BUTTON Token: keep the routine\'s token') && cloudTokenUnavailable() && !now.endsWith(' [off]') ? `${now} [off]` : now;
};

test('every control Settings drew before its sections is still drawn, by name, and off where it was off', () => {
  const after = new Set(KINDS.flatMap((k) => controls(draw(model(k))).map(controlName)));
  assert.ok(BEFORE.length >= 90, `${BEFORE.length} controls pinned`);
  const lost = BEFORE.map(renamed).filter((name) => !after.has(name));
  assert.deepEqual(lost, [], 'none is lost');
  // What it adds is the picker, the jump list's narrow form.
  assert.deepEqual([...after].filter((name) => !BEFORE.map(renamed).includes(name)), ['SELECT Section of Settings']);
});

test('every control that can be used still does something when used: it asks the extension, or changes the page', () => {
  let checked = 0;
  for (const k of ['settings-agents', 'settings-trackers', 'settings-limits', 'settings-github', 'settings-page', 'settings-about', 'slack-paused'] as const) {
    for (const b of controls(draw(model(k))).filter((e) => e.tagName === 'BUTTON' && !e.disabled && !e.getAttribute('aria-disabled'))) {
      const before = page.sent.length;
      const was = JSON.stringify(saved);
      b.click();
      // Slack's Replace opens the box for a new webhook: it changes the page, not the extension. A choice already
      // made (aria-pressed) is the one on show: picking it again asks nothing.
      const made = b.getAttribute('aria-pressed') === 'true';
      assert.ok(page.sent.length > before || JSON.stringify(saved) !== was || controlName(b) === 'BUTTON Replace' || made, `${k}: ${controlName(b)} does something`);
      checked++;
    }
  }
  assert.ok(checked >= 60, `${checked} controls used`);
});

test('the jump list has a link and the picker an option for each section, in order, and a click shows that section alone', () => {
  saved = undefined;
  const nodes = draw(model('settings'));
  const links = linksOf(nodes);
  assert.deepEqual(links.map((a) => a.dataset.section), [...SETTINGS_SECTIONS]);
  assert.deepEqual(links.map((a) => a.textContent), settingsSections().map((s) => s.title));
  assert.deepEqual(pickerOf(nodes).all().map((o) => o.textContent), settingsSections().map((s) => s.title));
  assert.deepEqual(shown(nodes), ['trackers'], 'the first shows until one is picked');
  const limits = links.find((a) => a.dataset.section === 'limits')!;
  limits.listeners.get('click')![0]!({ preventDefault: () => undefined });
  assert.deepEqual(shown(nodes), ['limits']);
  assert.deepEqual(links.filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.dataset.section), ['limits'], 'its link is the current one');
  assert.equal(pickerOf(nodes).value, 'limits', 'and the picker says so');
  assert.equal((page.document.activeElement as unknown as { id: string }).id, 'settings-section-limits', 'its heading takes focus');
  const heading = under(nodes).find((e) => (e as unknown as { id: string }).id === 'settings-section-limits')!;
  assert.deepEqual(heading.scrolled, [{ block: 'start' }], 'and the page scrolls to it, since the sticky list can be clicked scrolled down');
});

test('the tab remembers the section shown, and the next draw shows it; the picker picks as the list does', () => {
  saved = undefined;
  const first = draw(model('settings'));
  const picker = pickerOf(first);
  picker.value = 'accounts';
  picker.listeners.get('change')![0]!({});
  assert.deepEqual(shown(first), ['accounts']);
  assert.equal(mem().settings, 'accounts', 'the tab remembers it');
  assert.deepEqual(shown(draw(model('settings'))), ['accounts'], 'a redraw keeps it');
});

test('edge case: a remembered section the page no longer has shows the first, and no sections shows none', () => {
  saved = { settings: 'appearance' };
  assert.deepEqual(shown(draw(model('settings'))), ['trackers']);
  assert.equal(shownSection([]), undefined);
});

test('a deep link to a part in a hidden section shows that section (the reveal state.ts\'s jumpTo asks for)', () => {
  saved = { settings: 'about' };
  const nodes = draw(model('settings'));
  const part = under(nodes).find((e) => e.dataset.part === 'settings:github')!;
  const section = under(nodes).find((e) => e.classList.contains('settings-section') && e.all().includes(part))!;
  assert.equal(section.hidden, true, 'hidden at first');
  section.listeners.get('reveal')![0]!({});
  assert.deepEqual(shown(nodes), [sectionOfPart('github')]);
  assert.equal(mem().settings, 'accounts');
});

test('each section opens with its title and one line, and a part alone in its section has no heading of its own', () => {
  saved = undefined;
  const nodes = draw(model('settings'));
  for (const s of sectionsOf(nodes)) {
    const want = settingsSections().find((x) => x.id === s.dataset.section)!;
    assert.equal(s.all('settings-section-name')[0]!.textContent, want.title);
    assert.equal(s.all('settings-line')[0]!.textContent, want.line);
    assert.equal(s.all('settings-part-name').length, want.headed ? want.parts.length : 0, s.dataset.section ?? '');
  }
  assert.equal(under(nodes).filter((e) => e.classList.contains('settings-summary')).length, 0, 'no part\'s paragraph');
});

test('a long list shows its first few and folds the rest under a count, remembered once opened; edge case: one more than the few stays in view', () => {
  saved = undefined;
  const m = model('settings-trackers');
  const portal = m.trackers.projects[1]!;
  const many = { ...portal, trackers: [...portal.trackers, ...portal.trackers.map((t) => ({ ...t, index: t.index + 10, title: `${t.title} 2` }))] };
  const long = draw({ ...m, trackers: { ...m.trackers, projects: [many] } });
  const fold = under(long).find((e) => e.classList.contains('settings-more') && e.dataset.more === `trackers:${portal.root}`)!;
  assert.equal(fold.all('settings-tracker').length, many.trackers.length - LONG_LIST);
  assert.match(fold.all()[0]!.textContent, new RegExp(`^${many.trackers.length - LONG_LIST} more trackers$`));
  assert.equal((fold as unknown as { open: boolean }).open, false, 'closed at first');
  assert.ok(under(long).some((e) => e.textContent === `${many.trackers.length} trackers`), 'its project counts them');
  (fold as unknown as { open: boolean }).open = true;
  fold.listeners.get('toggle')![0]!({});
  assert.ok((mem().opened as string[]).includes(moreKey(`trackers:${portal.root}`)));
  const four = draw({ ...m, trackers: { ...m.trackers, projects: [{ ...portal, trackers: portal.trackers.slice(0, LONG_LIST + 1) }] } });
  assert.ok(!under(four).some((e) => e.dataset.more?.startsWith('trackers:')), 'no fold that hides one');
});

test('where a setting is set is its hint, not words beside it; a tracker\'s editing starts at Change tracker…', () => {
  saved = undefined;
  const nodes = draw(model('settings-trackers'));
  assert.equal(under(nodes).filter((e) => e.classList.contains('settings-from')).length, 0, 'no "this clone" or "project" tag');
  assert.ok(under(nodes).some((e) => e.title === 'Set in: project'), 'it is a hint on hover');
  const change = controls(nodes).filter((b) => b.textContent === 'Change tracker…');
  assert.equal(change.length, model('settings-trackers').trackers.projects.flatMap((p) => p.trackers).length, 'one per tracker');
  change[0]!.click();
  assert.equal((page.sent.at(-1) as { command: string }).command, 'acc.trackers.add', 'it opens the tracker where it is changed today');
});

test('edge case: scrollToHeading with no rail on the page leaves the heading no margin, scrolls it to the top and focuses it', () => {
  const h = page.document.createElement('h2');
  const style = h.style as unknown as { scrollMarginTop: string };
  style.scrollMarginTop = '40px';
  scrollToHeading(h as unknown as HTMLElement);
  assert.equal(style.scrollMarginTop, '');
  assert.deepEqual(h.scrolled, [{ block: 'start' }]);
  assert.equal(page.document.activeElement, h);
});
