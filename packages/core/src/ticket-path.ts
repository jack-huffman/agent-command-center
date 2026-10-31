/**
 * Where a ticket may still go (T-156). The person: "deploying lets us choose one of the other orgs in the
 * pipeline. We pick." A ticket's path is each environment along promotesTo from where its change is now
 * (D-018), the usual way first; the person picks any of them, not only the next step. Where it is now, the
 * ticket's own development environment and the project's default one are never a choice: building and the
 * deploy to the development org stay automatic (D-206).
 */
import { type Config, type Environment, environmentByBranch } from './config.ts';

/**
 * The environments ahead of `at` on the path, the usual next step first and each farther one after, each once.
 * `never` names branches that are no choice (the ticket's own environment); `at` and the default environment
 * are left out too. A path that loops back ends where it came from.
 */
export function environmentsAhead(config: Pick<Config, 'environments'>, at: Environment, never: string[] = []): Environment[] {
  const out: Environment[] = [];
  const seen = new Set<string>([at.branch]);
  const queue: Environment[] = [at];
  while (queue.length) {
    const here = queue.shift()!;
    for (const b of here.promotesTo) {
      if (seen.has(b)) continue;
      seen.add(b);
      const e = environmentByBranch(config, b);
      if (!e) continue;
      // The development environment is not a choice: the ticket's own, or the project's default.
      if (!never.includes(e.branch) && !e.default) out.push(e);
      queue.push(e);
    }
  }
  return out;
}

/** The names of the environments ahead, in one list for a refusal: "UAT, Production", or "nowhere". */
export const aheadWords = (ahead: Environment[]): string => (ahead.length ? ahead.map((e) => e.name).join(', ') : 'nowhere');
