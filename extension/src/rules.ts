// Rules suggested by review findings that keep coming back (GH-102): a person accepts or dismisses one from
// Needs you, through acc, and opens the review each finding came from.
import { dirname, join } from 'node:path';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { readVerdict } from '../../packages/core/src/review.ts';
import type { AgentPages } from './activity.ts';
import type { ExtensionArea } from './area.ts';
import type { Hub } from './hub.ts';
import type { FromWebview } from './model/messages.ts';
import { accRunner } from './run.ts';

type RuleMessage = Extract<FromWebview, { type: 'rule-accept' | 'rule-dismiss' }>;

/** acc's arguments for a person's Confirm or Dismiss. Each text is joined to its option, so none is read as one. */
export function ruleArgs(m: RuleMessage): string[] {
  if (m.type === 'rule-dismiss') return ['rules', 'dismiss', m.id, '--json'];
  return ['rules', 'accept', m.id, `--line=${m.line}`, `--title=${m.title}`, `--check=${m.check}`, ...(m.note?.trim() ? [`--note=${m.note.trim()}`] : []), '--json'];
}

export const area: ExtensionArea = {
  register({ vscode, hub, panels, pages, accScript, accSays, receive }) {
    const act = (m: RuleMessage) => {
      // Every one gets a reply: what acc added, or why it refused.
      const reply = (r: { ok: boolean; error?: string; task?: string }) => panels.reply({ type: 'rule-done', action: m.type, project: m.project, id: m.id, ...r });
      const p = hub.project(m.project);
      if (!p) return void reply({ ok: false, error: 'That project isn\'t open here.' });
      void accRunner(accScript)(ruleArgs(m), p.root)
        .then(async (r) => {
          await hub.loadTasks(true);
          if (r.code !== 0) return reply({ ok: false, error: accSays(r) });
          let task: string | undefined;
          try {
            task = (JSON.parse(r.stdout) as { task?: string }).task;
          } catch {
            task = undefined;
          }
          if (task) void vscode.window.showInformationMessage(`Added ${task} in To do. Dispatch it when you're ready: a person merges its pull request.`);
          return reply({ ok: true, ...(task ? { task } : {}) });
        })
        .catch((e: unknown) => reply({ ok: false, error: (e as Error).message }));
    };
    receive('rule-accept', act);
    receive('rule-dismiss', act);
    receive('rule-open-review', (m) => openReview(hub, pages, m));
  },
};

/**
 * A finding's review: its reviewer's session page, which keeps the name acc gave it (D-087), as Watch the
 * review opens it. A suggested rule's finding opens it, and so does a task page's Open the review (T-53).
 * A project that isn't open, or a verdict with no session, opens nothing.
 */
export function openReview(hub: Pick<Hub, 'project' | 'ledger'>, pages: Pick<AgentPages, 'open'>, m: { project: string; task: string; sha: string }): void {
  const p = hub.project(m.project);
  if (!p) return;
  const v = readVerdict({ reviews: join(dirname(p.ledgerPath), 'reviews') } as RepoPaths, m.task, m.sha);
  if (!v?.sessionId) return;
  const cwd = hub.ledger(p.root)?.tasks.find((t) => t.id === m.task)?.run?.worktree ?? p.root;
  pages.open(v.sessionId, { cwd, kind: 'background', startedAt: Date.parse(v.at) || Date.now(), sessionId: v.sessionId, name: v.name ?? `Review ${m.task}` }, () => false);
}
