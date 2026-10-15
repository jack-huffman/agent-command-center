// Settings' guide and its folded explanations (T-40): a link for each part, under the title in place of the
// old 30-word subtitle, and which explanations go into a closed "What this means". The drawn page is read in
// a browser by the screenshot run's Settings case (scripts/behaviour.ts); these read the page model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeModel, type HomeModel } from '../src/model/home.ts';
import { openAt, PAGES, sampleModel } from '../scripts/screenshot.ts';
import { BILLING_MEANING, foldsMeaning, meaningKey, SETTINGS_PARTS, settingsGuide, settingsKey, settingsMeanings, SHORT_MEANING } from '../src/model/settings.ts';
import { hub, pageSource } from './support.ts';

const settings = (kind: 'settings' | 'settings-agents' | 'settings-about' = 'settings-agents') => (sampleModel(kind, Date.now(), 'dark') as HomeModel).settings;

test('the guide has a link for each part of Settings, in its order, each opening the heading another page opens', () => {
  const m = settings('settings');
  const links = settingsGuide(m.parts);
  assert.deepEqual(m.guide, links, 'the model carries the guide');
  assert.equal(links.length, SETTINGS_PARTS.length);
  assert.deepEqual(links.map((l) => l.id), [...SETTINGS_PARTS]);
  for (const [i, l] of links.entries()) {
    const p = m.parts[i]!;
    assert.deepEqual([l.label, l.icon, l.part], [p.title, p.icon, settingsKey(p.id)], `${p.id}'s link is its title and icon, and opens its heading`);
  }
});

test('edge case: the guide of no parts is empty, not a row of nothing', () => {
  assert.deepEqual(settingsGuide([]), []);
});

test('the page draws the guide in place of the subtitle, and a link jumps as a deep link does', () => {
  const page = pageSource('settings.ts');
  assert.ok(page.includes("head.querySelector('.summary')!.replaceWith(guide(m));"));
  assert.ok(page.includes("a.addEventListener('click', (e) => { e.preventDefault(); jumpTo(g.part); });"));
  assert.ok(!page.includes('How the Command Center looks and behaves on this machine'), 'the old subtitle is gone');
  // The heading each link opens is the one a deep link opens.
  assert.ok(page.includes('h.dataset.part = `settings:${p.id}`'));
});

test('deep links into Settings still open at their part, and their pages are still shot', () => {
  for (const [page, part] of [['settings-agents', 'agents'], ['settings-trackers', 'trackers'], ['settings-limits', 'limits']] as const) {
    assert.ok((PAGES as readonly string[]).includes(page), `${page} is shot`);
    if (page !== 'settings-limits') assert.equal(openAt(page), settingsKey(part));
  }
});

test('one short sentence stays in view; two sentences, or one past the limit, folds', () => {
  assert.equal(SHORT_MEANING, 90);
  assert.equal(foldsMeaning('Nothing happens on its own.'), false);
  assert.equal(foldsMeaning('A Salesforce project never auto-merges: a person merges every pull request.'), false);
  assert.equal(foldsMeaning('One. Two.'), true, 'two sentences, however short');
  assert.equal(foldsMeaning(`${'a'.repeat(SHORT_MEANING)}.`), true, 'one sentence past the limit');
  assert.equal(foldsMeaning('a'.repeat(SHORT_MEANING)), false, 'one sentence at the limit');
  assert.equal(foldsMeaning(BILLING_MEANING), true);
});

test('edge case: an empty explanation neither folds nor is listed, and a version number\'s dot isn\'t a sentence end', () => {
  assert.equal(foldsMeaning(''), false);
  assert.equal(foldsMeaning('The installed acc is 0.40.0, from this machine.'), false);
  const m = settings();
  const empty = { ...m, page: { ...m.page, preferences: m.page.preferences.map((p) => ({ ...p, meaning: '' })) } };
  assert.ok(settingsMeanings(empty).every((x) => !x.id.startsWith('page:')));
});

test('the page model lists every row\'s explanation, each long one folding and each short one in view', () => {
  const m = settings();
  const all = settingsMeanings(m);
  const ids = all.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'each remembered under its own id');
  assert.ok(ids.includes('theme') && ids.includes('billing'));
  for (const s of m.agents.projects) {
    if (s.autoMerge) assert.ok(ids.includes(`auto-merge:${s.root}`));
    if (s.cloud) assert.ok(ids.includes(`cloud:${s.root}`));
  }
  for (const p of m.page.preferences) assert.ok(ids.includes(`page:${p.id}`));
  const folds = all.filter((x) => foldsMeaning(x.text));
  assert.ok(folds.length >= 5, `${folds.length} fold`);
  assert.ok(all.length - folds.length >= 2, 'a short one stays in view');
  assert.ok(folds.some((x) => x.id === 'billing') && folds.some((x) => x.id.startsWith('page:')));
  assert.deepEqual(m.folded, folds.map((x) => x.id), 'the model names the ones that fold, for the page');
  // About's versions, once read.
  const about = settings('settings-about');
  assert.ok((about.about?.rows ?? []).every((r) => !r.meaning || settingsMeanings(about).some((x) => x.id === `about:${r.key}`)));
});

test('edge case: before About is read, its versions add nothing, and a workspace with no projects lists no project\'s rows', () => {
  const m = homeModel({ hub: hub(), section: 'settings', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } }).settings;
  const ids = settingsMeanings({ ...m, about: null, agents: { ...m.agents, projects: [] } }).map((x) => x.id);
  assert.ok(ids.every((id) => !id.startsWith('about:') && !/^(autonomy|auto-merge|cloud):/.test(id)), ids.join(', '));
  assert.ok(ids.includes('theme'));
  assert.ok(!m.folded.some((id) => id.startsWith('about:')), 'the model folds no version before About is read');
});

test('each fold is remembered by the tab under its own key, and the page draws each explanation through it', () => {
  assert.equal(meaningKey('theme'), 'settings-meaning:theme');
  const page = pageSource('settings.ts');
  for (const call of ["whatThisMeans('theme', now.meaning, m.folded)", 'whatThisMeans(`autonomy:${s.root}`, s.autonomy.meaning, folded)', 'whatThisMeans(`auto-merge:${s.root}`, s.autoMerge.meaning, folded)',
    'whatThisMeans(`cloud:${s.root}`, c.meaning, folded)', "whatThisMeans('billing', b.meaning, m.folded)", 'whatThisMeans(`page:${p.id}`, p.meaning, folded)']) assert.ok(page.includes(call), call);
  assert.ok(pageSource('about.ts').includes("whatThisMeans(`about:${r.key}`, r.meaning ?? '', folded)"));
  const dom = pageSource('dom.ts');
  assert.ok(dom.includes("'What this means'") && dom.includes('d.open = memory().opened.includes(key);'), 'closed until opened, and remembered');
  assert.ok(dom.includes(`const key = \`${meaningKey('${id}')}\`;`), 'the page remembers it under the model\'s key');
});
