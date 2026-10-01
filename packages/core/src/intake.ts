import type { TaskInput } from './ledger.ts';

export interface GithubIssue {
  number: number;
  title: string;
  body?: string | null;
  url: string;
  labels?: { name: string }[];
}

/** "Depends on #3", "Blocked by #4 and #5", "depends on #6, #7" become dependencies (DESIGN.md section 6). */
export function depsFromBody(body: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (body ?? '').matchAll(/\b(?:depends on|blocked by)\s+((?:#\d+(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    for (const n of m[1]!.matchAll(/#(\d+)/g)) out.add(`#${n[1]}`);
  }
  return [...out];
}

export function githubIssuesToTasks(issues: GithubIssue[], environment?: string): TaskInput[] {
  return issues.map((i) => ({
    source: { kind: 'github', key: `#${i.number}`, url: i.url },
    title: i.title,
    brief: i.body ?? '',
    deps: depsFromBody(i.body).filter((d) => d !== `#${i.number}`),
    labels: (i.labels ?? []).map((l) => l.name),
    ...(environment ? { environment } : {}),
  }));
}
