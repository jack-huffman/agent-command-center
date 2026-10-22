/**
 * The Command Center's words for someone new (T-96, D-188). A person adds a ticket to their work, an agent
 * makes a plan, they build it, and they merge it: they never meet "acc", nor Track, Analyze, Dispatch, Land,
 * Rework or Waive. Each main action's button carries what it does and doesn't do as its title, from here,
 * and the Tasks tab says the five steps once (FIRST_STEPS).
 *
 * The page and the extension both read it, as processes.ts reads upper.ts. The words check
 * (extension/scripts/words.ts) fails on acc by name, and on each retired word as a label.
 */

/** What a person calls the Command Center's main actions and places. */
export const WORDS = {
  addToWork: 'Add to my work',
  myWork: 'My work',
  makePlan: 'Make a plan',
  buildIt: 'Build it',
  // The person chose Merge for Land. Land pushes and opens the pull request and never merges, so its button says where the work goes.
  openPullRequest: 'Open pull request',
  sentBack: 'Sent back',
  acceptAnyway: 'Accept anyway',
} as const;

/** What Add to my work does, and doesn't, for a ticket on a tracker's board: the tracker's name, as "Jira". */
export const addToWorkTitle = (tracker: string): string =>
  `Adds this ticket to your work here, so an agent can plan it and, once you approve, build it. Nothing changes in ${tracker}.`;

/** What Make a plan does, and doesn't. */
export const MAKE_PLAN_TITLE = 'An agent studies the ticket, the code and the org, and proposes a plan with options for you to choose. It changes nothing.';

/** What Build it does, and doesn't. */
export const BUILD_IT_TITLE = 'An agent builds the plan on its own copy of the project. Nothing reaches the project until you merge it.';

/** What Open pull request does: it pushes and opens the pull request, and never merges it. */
export const OPEN_PULL_REQUEST_TITLE = 'Pushes the reviewed work and opens its pull request. It merges there, by you, or by autopilot where you allow it. Nothing reaches the project until then.';

/** Each command whose button explains itself, by its command id, with what it does and doesn't. */
const EXPLAINED: Record<string, string> = {
  'acc.task.analyze': MAKE_PLAN_TITLE,
  'acc.task.dispatch': BUILD_IT_TITLE,
  'acc.task.dispatchWith': BUILD_IT_TITLE,
  'acc.task.dispatchCloud': BUILD_IT_TITLE,
  'acc.task.dispatchAnyway': BUILD_IT_TITLE,
  'acc.task.dispatchAgain': BUILD_IT_TITLE,
  'acc.task.land': OPEN_PULL_REQUEST_TITLE,
};

/** A button's title: its label, then what its command does and doesn't, where it's a main action. */
export const explains = (command: string, label: string): string => (EXPLAINED[command] ? `${label}: ${EXPLAINED[command]}` : label);

/** How the Command Center works, in five steps: said once, on the Tasks tab, until it's dismissed. */
export const FIRST_STEPS: readonly { icon: string; step: string }[] = [
  { icon: 'add', step: 'Add a ticket to your work' },
  { icon: 'lightbulb', step: 'Make a plan' },
  { icon: 'check', step: 'Choose and approve' },
  { icon: 'rocket', step: 'Build it' },
  { icon: 'git-merge', step: 'Review and merge' },
];
