/**
 * Sends a draft through a tracker's client: claim it, post it with the client's `comment`, and on a failed
 * post release the claim with the reason, so the draft is a draft again. A Slack client's `comment` replies in
 * the task's thread (T-30). No vscode import, so it's testable.
 */
import type { TrackerClient } from '../../../packages/core/src/trackers/types.ts';

export interface AccResult { code: number; stdout: string; stderr: string }
type Acc = (args: string[], cwd: string) => Promise<AccResult>;

/** `says` turns a failed acc result into words for the person. */
export async function postClaimed(
  client: Pick<TrackerClient, 'comment'>, acc: Acc, root: string, key: string, id: string, text: string, againArgs: string[], says: (r: AccResult) => string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const claimed = await acc(['update', 'posting', id, ...againArgs, '--json'], root);
  if (claimed.code !== 0) return { ok: false, error: says(claimed) };
  try {
    await client.comment(key, text);
  } catch (e) {
    const why = (e as Error).message;
    await acc(['update', 'release', id, `--reason=${why}`, '--json'], root);
    return { ok: false, error: why };
  }
  return { ok: true };
}
