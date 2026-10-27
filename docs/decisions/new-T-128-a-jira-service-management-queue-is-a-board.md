## D-T-128 A Jira Service Management queue is a board a project holds, and acc's comments on its tickets stay internal (2026-10-27)

T-128. The person asked (2026-10-27) for Jira Service Management queues as boards: each of a service desk's
queues, such as "Unassigned issues" or "Waiting for support", is a board a project holds, with its tickets.
T-127 adds the Tasks tab's switch between a project's boards; this entry is the Jira and JSM part.

- **A queue board is a tracker.** A Jira tracker's `queue` is a queue's id. Each queue ticked on the Connect
  page is a tracker of its own, so a board switcher lists each one. A `queue` takes no `epics` or `sprint`, since
  the queue's JQL is its place; the config refuses the mix, and a `queue` on any other tracker. Two queue boards
  of one service desk share its project's keys on purpose, so the config gives no warning for them. A ticket
  key goes to the first of them, and that tracker's place check speaks for all of them (below).
- **Connect.** After the project, a service desk offers its queues as cards, each with its name and its ticket
  count (`includeCount=true`). Ticking one or more sets the epics, board and sprint aside: they aren't drawn or
  needed, and Save writes one tracker a queue (the description's `more` adds the second and later ones beside
  the first). A project that isn't a service desk (its `projectTypeKey` isn't `service_desk`) has no queues, so
  the list isn't drawn and its epics show as before. Only a service desk's agent can read its queues: Jira
  answers 403 to anyone else, and the page says so in plain words, with the epics still offered.
- **Reading a queue.** Its tickets come from the queue's own JQL, held to the project (`project = KEY AND
  (filter)`, then the queue's ORDER BY), through Jira's search (`/rest/api/3/search/jql`, page by page), and
  become the same tickets every tracker fills (D-185). The columns are the tickets' statuses, in the order of
  their status category (To do, In progress, Done), and within one as first seen. An empty queue says so.
- **Place check (D-072).** A ticket is inside when the JQL of the board's queue, or of another queue board on
  the same project, picks it out: `key = X AND ((queue 1) OR (queue 2))`, each queue's ORDER BY taken off. One
  outside is told by the queues it isn't in, such as "it isn't in queues Unassigned issues or Waiting for
  support". A ticket leaves a queue as it moves on (resolved, assigned), so intake takes out one that never
  started and names one that did, as for an epic.
- **Comments are internal.** On a service desk's ticket a comment is posted as a request comment with `public:
  false`, never Jira's own comment: Jira's own can't be made internal (its `jsdPublic` is read-only, and its docs
  point to Create request comment). A queue board's tickets are a service desk's without asking; any other Jira
  ticket's project type is read once per project per client, and a failed read fails the comment rather than
  risk a customer seeing it. Every comment goes through the client's `comment`, so updates acc posts (D-006) and a
  person's own comment from the ticket page (D-177) both follow the rule. The request comment's body is the
  Markdown as text, not ADF.
- **Settings.** A queue board's place is "Jira · KEY · service desk <name> · queue <name>" once its board has
  loaded, and "Jira · KEY · queue <id>" before; its sign-in is the site's (D-091).

Each API, from Atlassian's Jira Service Management Cloud and Jira Cloud platform REST docs, read on 2026-10-27,
is named beside the code in `packages/core/src/trackers/jira-queue.ts`: Get queues, Get service desk by id, the
project identifiers that `{serviceDeskId}` takes (`projectKey:KEY`), Create request comment, Get project, and
Search for issues using JQL.

Files the team shares: `extension/src/model/connect.ts` and `extension/src/connect.ts` (two small, general
additions: a list drawn only when it holds something, a list set aside while another has a choice, and the
extra trackers Save writes), `packages/core/src/config.ts`, `packages/core/src/trackers/types.ts`, and the
screenshot pages list.
