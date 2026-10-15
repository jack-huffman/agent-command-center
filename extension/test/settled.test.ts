// A suggested rule acc accepted or dismissed leaves the Overview at once (T-35): the page's hideSettled,
// held to the free oracle of the model the extension builds without those suggestions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HubLike } from '../src/model/shared.ts';
import { type HomeModel, homeModel } from '../src/model/home.ts';
import { landing, overviewCards } from '../src/model/landing.ts';
import type { AttentionItem, OverviewModel } from '../src/model/overview.ts';
import { LOOK } from '../src/model/shared.ts';
import type { RuleCard } from '../src/model/rules.ts';
import { hideSettled, ruleKey, rulesLineTitle } from '../webview/pending.ts';
import { sampleLandingHub } from '../scripts/fixtures/landing.ts';
import { sampleRulesHub } from '../scripts/fixtures/rules.ts';
import { sampleBoards } from '../scripts/fixtures/boards.ts';
import { sampleIdentity } from '../scripts/fixtures/environments.ts';
import { sampleSetup } from '../scripts/fixtures/setup.ts';
import { sampleEdited } from '../scripts/fixtures/updates.ts';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const key = ruleKey;
const model = (hub: HubLike): HomeModel => homeModel({ hub, section: 'overview', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: [], edited: sampleEdited, autopilot: () => 'on', now: NOW });
/** The hub without the suggestions in `gone`: what the extension sends once acc wrote the rest down. */
const without = (hub: HubLike, gone: Set<string>): HubLike => ({ ...hub, suggestions: (r: string) => (hub.suggestions?.(r) ?? []).filter((s) => !gone.has(s.id)) });
const ids = (m: HomeModel): string[] => m.overview.attention.flatMap((a) => (a.rule ? [a.rule.id] : []));

/** The extension's Overview, with `notes` more neutral lines waiting when you have a moment, before the suggestions. */
const withNotes = (hub: HubLike, notes: number): OverviewModel => {
  const o = model(hub).overview;
  const extra = Array.from({ length: notes }, (_, i): AttentionItem => ({ key: `note:${i}`, look: LOOK('Note', 'info', 'neutral'), title: `Note ${i + 1}`, detail: 'Acme', project: 'Acme', actions: [] }));
  const attention = [...extra, ...o.attention];
  const lists = landing({ ...o, attention }, NOW);
  return { ...o, attention, landing: lists, cards: overviewCards(lists) };
};

for (const [name, hub, notes] of [['ten suggestions, their line first on the card', sampleLandingHub(NOW), 0], ['two suggestions, with six notes in their list', sampleRulesHub(NOW), 6], ['two suggestions, with three notes in their list', sampleRulesHub(NOW), 3]] as const) {
  test(`${name}: hiding the first, some, or every one gives the Overview the extension would send without them, the last one taking the line with it (T-35)`, () => {
    const all = ids(model(hub));
    assert.ok(all.length >= 2, `${all.length} suggestions`);
    const card = withNotes(hub, notes).cards.find((c) => c.key === 'moment');
    assert.equal(card?.line, rulesLineTitle(all.length), 'the card leads with the suggested rules\' line, before any note');
    const counts = [1, all.length - 1, all.length];
    for (const n of counts) {
      const gone = new Set(all.slice(0, n));
      const full = withNotes(hub, notes);
      const want = withNotes(without(hub, gone), notes);
      const got = hideSettled(full, new Set([...gone].map((id) => key({ project: full.attention.find((a) => a.rule?.id === id)!.rule!.project, id }))), key);
      assert.deepEqual(got.attention, want.attention, `${n} hidden: what waits on you`);
      assert.deepEqual(got.landing, want.landing, `${n} hidden: every list, the suggested rules' line and its count`);
      assert.deepEqual(got.cards, want.cards, `${n} hidden: the When you have a moment card's count and line (T-36)`);
      const line = got.landing.flatMap((g) => g.all).find((r) => r.key === 'rules');
      assert.equal(line?.title, n === all.length ? undefined : rulesLineTitle(all.length - n));
    }
  });
}

test('nothing settled, or only a suggestion no longer there, leaves the Overview as it was: the edge case of a model that arrived without it', () => {
  const m = model(sampleRulesHub(NOW));
  assert.equal(hideSettled(m.overview, new Set(), key), m.overview);
  assert.equal(hideSettled(m.overview, new Set([key({ project: '/elsewhere', id: 'r-000000' })]), key), m.overview);
});

test('the line\'s words are the model\'s, one or many', () => {
  assert.equal(rulesLineTitle(1), '1 suggested rule, from repeated review findings');
  assert.equal(rulesLineTitle(3), '3 suggested rules, from repeated review findings');
});
