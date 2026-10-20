// The warning for tickets that left where a board's tickets come from, in plain words (T-42).
import assert from 'node:assert/strict';
import test from 'node:test';
import { movedOut, narrowedTo, noteKey } from '../src/logic/moved-out.ts';
import { sampleBoards } from '../scripts/fixtures/boards.ts';
import { trackerBoard } from '../src/model/boards.ts';

const note = (key: string) => `${key} left this repo's place: it isn't in epic ACME-3; ${key} is still blocked`;

test('a ticket that left an epic reads "Moved out of epic ACME-3 after work started: ACME-18."', () => {
  assert.equal(movedOut('Jira · ACME · epic ACME-3 Premium Support', [note('ACME-18')]), 'Moved out of epic ACME-3 after work started: ACME-18.');
});

test('each tracker names its own word for the place: labels, area path, group', () => {
  assert.equal(narrowedTo('GitHub · acme/tool · labels bug and sla'), 'labels bug and sla');
  assert.equal(narrowedTo('GitHub · acme/tool · label bug'), 'label bug');
  assert.equal(narrowedTo('Azure DevOps · Acme · Core · area Acme\\Core'), 'area path Acme\\Core');
  assert.equal(narrowedTo('monday.com · acme · Backlog board · group Backlog'), 'group Backlog');
});

test('a whole repo or project, or no place at all, still reads plainly, and no word is "place"', () => {
  assert.equal(narrowedTo('Jira · ACME'), null);
  assert.equal(narrowedTo(null), null);
  const said = movedOut('GitHub · acme/tool', ['#12 left this repo\'s place: it\'s in another repo']);
  assert.equal(said, 'Moved out of this board\'s tickets after work started: #12.');
  assert.ok(!/place/i.test(said!));
});

test('nothing left gives no warning, and several tickets are listed by key', () => {
  assert.equal(movedOut('Jira · ACME · epic ACME-3', []), null);
  assert.equal(movedOut('Jira · ACME · epic ACME-3', [note('ACME-18'), note('ACME-20')]), 'Moved out of epic ACME-3 after work started: ACME-18, ACME-20.');
  assert.equal(noteKey('a note in no known shape'), 'a note in no known shape');
});

test('the Tasks board carries the warning, from its raw place even when the line under its name is quiet', () => {
  const b = trackerBoard(sampleBoards()[0]!, [], '/repo');
  assert.equal(b.movedOut, 'Moved out of epic ACME-3 after work started: ACME-18.');
  assert.equal(trackerBoard({ ...sampleBoards()[0]!, left: [] }, [], '/repo').movedOut, null);
});

test('a Jira sprint names itself without its dates, and an epic in a sprint is either; elsewhere a group called sprint is still a group (T-78)', () => {
  assert.equal(narrowedTo('Jira · ACME · sprint ACME Sprint 12 (6 Oct to 19 Oct)'), 'sprint ACME Sprint 12');
  assert.equal(narrowedTo('Jira · ACME · the active sprint'), 'the active sprint', 'before the board loads');
  assert.equal(narrowedTo('Jira · ACME · no active sprint'), 'the active sprint', 'none open now');
  assert.equal(narrowedTo('Jira · ACME · epic ACME-3 Premium Support · sprint 42'), 'epic ACME-3 or sprint 42');
  assert.equal(movedOut('Jira · ACME · sprint Sprint 12 (6 Oct to 19 Oct)', [note('ACME-18')]), 'Moved out of sprint Sprint 12 after work started: ACME-18.');
  assert.equal(narrowedTo('monday.com · acme · sprint board · group This sprint'), 'group This sprint', 'monday.com has no sprints: its last part narrows');
  assert.equal(narrowedTo('monday.com · acme · sprint planning'), null, 'a monday.com board named for a sprint isn\'t a place');
});
