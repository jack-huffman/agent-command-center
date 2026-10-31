/** A command, as every action is one: its id, what it takes, and whether it can run now, with why not. */
export interface TaskCommand<S> {
  id: string;
  params: string;
  enabled(s: S): { ok: true } | { ok: false; why: string };
}
