// acc hook: the hooks acc gives the sessions it starts, including the PermissionRequest hook the
// Environments help lists.

import { ask, hookOutput, parseEventInput, parseHookInput, postToolUseHook, preToolUseHook, run, sessionStartHook, stopHook } from '../../../core/src/index.ts';
import { type CommandArea, now, out } from '../shared.ts';

async function readStdin(limit = 4 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += (c as Buffer).length;
    if (size > limit) break;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The PermissionRequest hook (D-030). It never blocks a tool by failing: on anything unexpected it prints
 * nothing and exits 0, so Claude Code asks in its own prompt as usual.
 */
/**
 * The plugin's hooks (D-042). Like the permission hook, they never block by failing: anything unexpected
 * prints nothing, and Claude Code carries on as it would without acc.
 */
async function cmdHookEvent(event: 'session-start' | 'pre-tool-use' | 'post-tool-use' | 'stop'): Promise<number> {
  try {
    const input = parseEventInput(await readStdin());
    if (!input) return 0;
    const ctx = { cwd: input.cwd || process.cwd(), env: process.env, run, now };
    // A builder's command that can write records is noted, and says nothing back (T-100).
    if (event === 'post-tool-use') { postToolUseHook(input, ctx); return 0; }
    const out = event === 'session-start' ? sessionStartHook(input, ctx) : event === 'pre-tool-use' ? preToolUseHook(input, ctx) : stopHook(input, ctx);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (e) {
    process.stderr.write(`acc hook ${event}: ${(e as Error).message}\n`);
  }
  return 0;
}

async function cmdHookPermission(): Promise<number> {
  const stop = new AbortController();
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => stop.abort());
  try {
    const input = parseHookInput(await readStdin());
    if (!input) return 0;
    const r = await ask(input, { signal: stop.signal });
    const output = r ? hookOutput(r.question, r.answer) : null;
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (e) {
    process.stderr.write(`acc hook permission: ${(e as Error).message}\n`);
  }
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Environments',
    order: 51,
    lines: `  acc hook permission                   Claude Code's PermissionRequest hook: puts an agent's prompt in the
                                        Command Center, when one is open, and waits for the answer`,
  },
  subcommands: { hook: ['permission', 'session-start', 'pre-tool-use', 'post-tool-use', 'stop'] },
  commands: {
    hook: (_o, rest) => {
      if (rest[0] === 'permission') return cmdHookPermission();
      if (rest[0] === 'session-start' || rest[0] === 'pre-tool-use' || rest[0] === 'post-tool-use' || rest[0] === 'stop') return cmdHookEvent(rest[0]);
      // Exit 1, never 2: for a hook, 2 would block the tool.
      process.stderr.write('acc hook takes permission, session-start, pre-tool-use, post-tool-use or stop.\n');
      return 1;
    },
  },
};
