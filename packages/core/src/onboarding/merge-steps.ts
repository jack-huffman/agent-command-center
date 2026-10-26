/**
 * Setup's step for the floors file's merge driver (T-102): git keeps the better of each floor when two
 * branches both raised one, instead of stopping on the line. A project with no ratchets has no floors to
 * merge, so it skips the step.
 */
import { floorsDriverFix, floorsDriverSet, floorsDriverState } from '../floors-driver.ts';
import { fail, pass, skip } from './helpers.ts';
import type { Step } from './types.ts';

export const MERGE_STEPS: Step[] = [
  {
    id: 'B10.merge-floors', part: 'project', group: 'B10', title: 'Raised floors merge on their own',
    why: 'Two tasks that both raised a floor change the same line of the floors file. With this set up, git keeps the better of each, so neither waits for a person. A floor a person relaxed still waits for one.',
    fix: { fromCheck: true },
    check(ctx) {
      if (!ctx.paths) return skip('Not inside a repo.');
      if (!ctx.config) return skip('Needs a valid .acc/config.json first (step B0).');
      if (!Object.keys(ctx.config.gates.ratchets ?? {}).length) return skip('The project has no floors to merge.');
      const state = floorsDriverState(ctx.run, ctx.paths.root);
      if (state.configured && state.attributed) return pass('git keeps the better of each floor when two branches raised them.');
      // A driver that is set but doesn't run acc's `floors merge`: the fix sets acc's in its place.
      const set = floorsDriverSet(ctx.run, ctx.paths.root);
      if (set && !state.configured) return fail(`The floors file's merge driver in this clone's git config is "${set}", which doesn't run acc's floors merge. This step replaces it with acc's.`, floorsDriverFix(state));
      const missing = [...(state.configured ? [] : ['this clone\'s git config']), ...(state.attributed ? [] : ['.gitattributes'])];
      return fail(`The floors file's merge driver isn't in ${missing.join(' or ')}, so two raised floors conflict.`, floorsDriverFix(state));
    },
  },
];
