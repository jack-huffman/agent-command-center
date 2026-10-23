/**
 * Setup's step for the tools a project's own checks need on this machine (T-68), as its config's "tools"
 * lists them, such as a pinned browser its screenshot check draws with. The core names no project's
 * tools (D-003): a project that lists none skips the step.
 */
import { mainCheckout } from '../paths.ts';
import { fail, pass, skip } from './helpers.ts';
import type { Step } from './types.ts';

export const TOOL_STEPS: Step[] = [
  {
    id: 'B13.tools', part: 'project', group: 'B13', title: 'The tools the project\'s checks need',
    why: 'Some projects\' checks need a tool on this machine that npm install doesn\'t bring, such as a pinned browser to draw screenshots with. The project lists each in its config, with a command that checks for it and one that sets it up.',
    fix: { fromCheck: true },
    check(ctx) {
      if (!ctx.paths) return skip('Not inside a repo.');
      if (!ctx.config) return skip('Needs a valid .acc/config.json first (step B0).');
      const tools = ctx.config.tools ?? [];
      if (!tools.length) return skip('The project lists no tools its checks need.');
      let root = ctx.paths.root;
      try {
        root = mainCheckout(ctx.run, ctx.paths.root);
      } catch {
        // fall back to this checkout
      }
      for (const t of tools) {
        const r = ctx.run('sh', ['-c', t.check], { cwd: root, env: ctx.env });
        if (r.code !== 0) {
          const said = (r.stderr || r.stdout).trim().split('\n')[0];
          return fail(`${t.title} isn't set up yet${said ? `: ${said}` : '.'} ${t.why}`, t.fix);
        }
      }
      return pass(`Ready: ${tools.map((t) => t.title).join(', ')}.`);
    },
  },
];
