## D-199 A plan suggests a small first task for a shape other tasks build on, so they can start sooner (2026-10-22)

When one task changes a shape other tasks build on, those tasks wait for the
whole feature or start on guesses. On 22 October T-97's plan format was such a
shape: T-98 to T-100 needed it. A small first task for just the shape lets them
start within minutes. The person asked for plans to suggest that.

- **The plan names shared shapes.** The analysis (D-052, with T-97's choices) has
  `sharedShapes`: each with a name, a kind (schema, type, module, setting or file
  format), why others build on it, the files that hold it and the tasks that would
  use it. The analyst is told to look for them, and its prompt lists the tasks in
  flight (`teamOf`, T-103) and the tasks ready, so it can see who would use a shape.
  A team git can't read leaves the ready tasks, and one the ledger can't give
  leaves the list out: a plan is made without it.
- **It suggests a shape-first split.** Where a shape is shared, `shapeSplit` holds
  why, a small first task (the shape, its tests, nothing drawn) and the rest. A
  plan that names no shape suggests none: acc drops a split the analyst wrote
  without one, and a split needs a title for each task. The suggestion never
  changes the verdict, so the plan is approved and built as it is when a person
  ignores it. The older D-052 `split` list (a task too big for one task) is as it
  was; this is a second, optional suggestion.
- **Split into these tasks.** The ticket page shows the shapes, the two tasks and
  why, and the button. It runs `acc plan split <id>`, which a person runs and an
  agent can't. It makes the first task and the rest on the task's environment,
  with the rest depending on the first, and blocks the task with the reason so
  nobody builds it twice. It is refused when the plan suggests none, when it was
  made already, and when the task isn't waiting to be built. Nothing splits
  without a click (out of scope: splitting without a person).
- **The rest waits only for the shape.** A task depends on the first task like any
  other dependency: it starts once that task is done, which is its merge. The rest
  carries `shapeFrom` (the first task, the shapes and the files the plan named).
  Its packet gets "The shape you build on", after the notes of the tasks it
  depends on: the task that made the shape, the shapes, its decision (the numbered
  decision file among the files the task changed when it merged, T-99's kept
  changes, else `D-<task>`), and its files (the merged ones, else the plan's).
  A builder that needs the shape changed blocks and asks.
- **Code:** `shape-first.ts` holds the types, the schema and prompt for the analyst
  and how its answer is read. It imports nothing that imports the analysis, so the
  analysis can load it. `shape-split.ts` holds the team lines, the split and the
  packet section. The screenshot run draws a plan with the suggestion
  (`ticket-plan-shapes`).
