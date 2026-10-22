## D-068 The agent board starts at To do; a tracker's board keeps its own columns, in its order (2026-10-06)

The author: "by default, the To Do column should be furthest left, but if we're
importing from a ticketing system, we should use their swim lanes in the order
they are listed."

- **The agent board's lanes run left to right as a task goes:** To do, Ready,
  Running, Needs you, In review, Rework, Blocked, Done (`BOARD_LANES`). Needs you
  sits after Running, where most tasks come to it from. Until now the board used
  the lists' attention order, with Needs you first and To do second to last.
- **A tracker's board is as the tracker has it:** a Jira board's columns from
  its configuration, a GitHub Project's Status options, an Azure board's
  columns, each in the order the tracker lists them. That was already so, and
  stays so: the Command Center never sorts them. A GitHub Project's "No status"
  column comes first when a card has none, as GitHub shows it.
- **Lists keep the attention order** (`TASK_GROUPS`: Needs you first), since a
  list is read top to bottom for what to look at next. A card's Move menu lists
  lanes in board order.
- Not chosen: the agent board taking a tracker's columns. Its lanes are acc's
  own states, and the tracker's board is one click away, in its own order.
