# Decisions

<!-- Made from docs/decisions/ by acc decisions index. Don't edit it: a test fails when it's stale. -->

Each decision is a file in [decisions/](decisions/), and records what was decided and why, so later
changes can see what they are overturning. A task adds `decisions/new-<task>-<slug>.md` and calls it
`D-<task>`. At merge, acc gives it the next free number.

| Decision | Title | Date |
| --- | --- | --- |
| [D-001](decisions/D-001-build-a-thin-layer-over-claude-code-don-t-adopt-an.md) | Build a thin layer over Claude Code, don't adopt an orchestrator | 2026-10-01 |
| [D-002](decisions/D-002-no-dependency-on-other-skills.md) | No dependency on other skills | 2026-10-01 |
| [D-003](decisions/D-003-project-agnostic-core-with-a-salesforce-profile.md) | Project-agnostic core with a Salesforce profile | 2026-10-01 |
| [D-004](decisions/D-004-typescript-for-the-cli-and-the-extension.md) | TypeScript for the CLI and the extension | 2026-10-01 |
| [D-005](decisions/D-005-github-issues-and-jira-first-monday-com-and-slack-later.md) | GitHub Issues and Jira first; monday.com and Slack later | 2026-10-01 |
| [D-006](decisions/D-006-trackers-are-read-and-only-commented-on.md) | Trackers are read, and only commented on | 2026-10-01 |
| [D-007](decisions/D-007-each-repo-declares-its-own-github-account.md) | Each repo declares its own GitHub account | 2026-10-01 |
| [D-008](decisions/D-008-the-ledger-lives-in-the-git-common-directory-not-in-the-repo.md) | The ledger lives in the git common directory, not in the repo | 2026-10-01 |
| [D-009](decisions/D-009-builders-run-as-claude-code-background-sessions.md) | Builders run as Claude Code background sessions | 2026-10-01 |
| [D-010](decisions/D-010-the-orchestrator-loop-is-code-not-an-agent.md) | The orchestrator loop is code, not an agent | 2026-10-01 |
| [D-011](decisions/D-011-in-salesforce-projects-agents-validate-and-never-deploy.md) | In Salesforce projects, agents validate and never deploy | 2026-10-01 |
| [D-012](decisions/D-012-one-cli-is-the-only-writer-and-it-ships-inside-the-plugin.md) | One CLI is the only writer, and it ships inside the plugin | 2026-10-01 |
| [D-013](decisions/D-013-the-tool-creates-its-own-worktrees-outside-the-repo.md) | The tool creates its own worktrees, outside the repo | 2026-10-01 |
| [D-014](decisions/D-014-autonomy-starts-at-manual-and-nothing-ever-auto-merges.md) | Autonomy starts at manual, and nothing ever auto-merges | 2026-10-01 |
| [D-015](decisions/D-015-each-branch-is-named-after-its-environment.md) | Each branch is named after its environment | 2026-10-01 |
| [D-016](decisions/D-016-environment-specific-files-are-never-edited-by-a-task.md) | Environment-specific files are never edited by a task, deployed or promoted | 2026-10-01 |
| [D-017](decisions/D-017-one-list-of-onboarding-steps-drives-the-cli-the-walkthrough.md) | One list of onboarding steps drives the CLI, the walkthrough and the docs | 2026-10-01 |
| [D-018](decisions/D-018-every-org-is-listed-and-each-project-sets-its-own-promotion.md) | Every org is listed, and each project sets its own promotion path | 2026-10-01 |
| [D-019](decisions/D-019-the-gui-is-a-vscode-extension-and-a-thin-one.md) | The GUI is a VSCode extension, and a thin one | 2026-10-01 |
| [D-020](decisions/D-020-the-sidebar-comes-before-dispatch.md) | The sidebar comes before dispatch | 2026-10-01 |
| [D-021](decisions/D-021-every-sidebar-view-also-opens-as-an-editor-tab.md) | Every sidebar view also opens as an editor tab | 2026-10-01 |
| [D-022](decisions/D-022-task-worktrees-live-in-claude-worktrees-and-agents-enter.md) | Task worktrees live in .claude/worktrees/, and agents enter them from the trusted main checkout | 2026-10-01 |
| [D-023](decisions/D-023-row-actions-in-tabs-open-vscode-s-own-context-menu.md) | Row actions in tabs open VSCode's own context menu | 2026-10-01 |
| [D-024](decisions/D-024-gates-how-they-run-what-a-receipt-proves-and-how-validate.md) | Gates: how they run, what a receipt proves, and how validate stays check-only | 2026-10-01 |
| [D-025](decisions/D-025-the-salesforce-format-gate-checks-apex-and-lwc-code-never.md) | The Salesforce format gate checks Apex and LWC code, never metadata XML | 2026-10-01 |
| [D-026](decisions/D-026-the-extension-reads-and-writes-trackers-directly-and-draws.md) | The extension reads and writes trackers directly, and draws each tracker's own board | 2026-10-02 |
| [D-027](decisions/D-027-tracker-sign-ins-belong-to-one-repo-and-azure-devops-joins.md) | Tracker sign-ins belong to one repo, and Azure DevOps joins the trackers | 2026-10-02 |
| [D-028](decisions/D-028-a-clone-chooses-its-own-github-account-and-the-ui-always.md) | A clone chooses its own GitHub account, and the UI always shows who you're working as | 2026-10-02 |
| [D-029](decisions/D-029-one-command-center-page-replaces-the-sidebar-views.md) | One Command Center page replaces the sidebar views | 2026-10-02 |
| [D-030](decisions/D-030-agents-ask-and-commands-answer-in-the-command-center.md) | Agents ask, and commands answer, in the Command Center | 2026-10-02 |
| [D-031](decisions/D-031-a-person-can-waive-a-check-on-one-commit-with-a-reason.md) | A person can waive a check on one commit, with a reason | 2026-10-02 |
| [D-032](decisions/D-032-a-read-only-reviewer-agent-judges-each-commit-before-it.md) | A read-only reviewer agent judges each commit before it lands | 2026-10-02 |
| [D-033](decisions/D-033-acc-land-opens-the-pull-request-acc-sync-follows-it.md) | acc land opens the pull request; acc sync follows it | 2026-10-02 |
| [D-034](decisions/D-034-promotion-builds-its-branch-from-the-destination-deploys.md) | Promotion builds its branch from the destination; deploys follow what was last deployed | 2026-10-02 |
| [D-035](decisions/D-035-the-last-project-setup-steps-get-a-do-it-of-their-own.md) | The last project setup steps get a Do it of their own | 2026-10-02 |
| [D-036](decisions/D-036-builders-and-reviewers-each-have-a-model-and-effort-set-per.md) | Builders and reviewers each have a model and effort, set per clone or per project | 2026-10-02 |
| [D-037](decisions/D-037-what-you-answered-stays-on-the-page.md) | What you answered stays on the page | 2026-10-02 |
| [D-038](decisions/D-038-a-prompt-on-the-page-offers-every-answer-claude-code-s-own.md) | A prompt on the page offers every answer Claude Code's own prompt does | 2026-10-02 |
| [D-039](decisions/D-039-pages-say-the-gist-first-and-a-lone-board-fills-the-page.md) | Pages say the gist first, and a lone board fills the page | 2026-10-02 |
| [D-040](decisions/D-040-agents-open-in-claude-code-for-vscode-not-a-terminal.md) | Agents open in Claude Code for VSCode, not a terminal | 2026-10-02 |
| [D-041](decisions/D-041-cards-move-by-drag-and-drop-a-worktree-s-conversation-opens.md) | Cards move by drag and drop; a worktree's conversation opens in its own window; agent pages fit the window | 2026-10-02 |
| [D-042](decisions/D-042-the-plugin-hooks-as-acc-hook-event-validated-strictly-with-a.md) | The plugin: hooks as `acc hook <event>`, validated strictly, with a release-only bundle | 2026-10-02 |
| [D-043](decisions/D-043-the-question-history-keeps-its-newest-1-000-records.md) | The question history keeps its newest 1,000 records | 2026-10-02 |
| [D-044](decisions/D-044-the-swarm-at-a-glance-a-status-bar-summary-and-notices-when.md) | The swarm at a glance: a status bar summary, and notices when a task changes | 2026-10-02 |
| [D-045](decisions/D-045-a-task-branch-s-decision-is-numbered-when-it-merges.md) | A task branch's decision is numbered when it merges | 2026-10-03 |
| [D-046](decisions/D-046-open-in-claude-code-finds-a-conversation-s-folder-from-the.md) | Open in Claude Code finds a conversation's folder from the file it's saved in | 2026-10-03 |
| [D-047](decisions/D-047-setup-reads-in-the-order-things-are-set-up-a-section-for.md) | Setup reads in the order things are set up, a section for each thing, with done steps muted | 2026-10-03 |
| [D-048](decisions/D-048-closed-issues-leave-the-board-and-milestones-aren-t-tasks.md) | Closed issues leave the board, and milestones aren't tasks | 2026-10-03 |
| [D-049](decisions/D-049-a-pull-request-that-conflicts-with-its-base-says-so-and-in.md) | A pull request that conflicts with its base says so, and in which files | 2026-10-03 |
| [D-050](decisions/D-050-the-question-history-loses-no-record-to-a-torn-line-or-a.md) | The question history loses no record to a torn line or a trim | 2026-10-05 |
| [D-051](decisions/D-051-a-gh-that-outlives-its-timeout-is-stopped-and-a-land-carries.md) | A gh that outlives its timeout is stopped, and a land carries on without its comment | 2026-10-05 |
| [D-052](decisions/D-052-every-task-can-be-analyzed-before-it-s-built-salesforce.md) | Every task can be analyzed before it's built; Salesforce tasks must be | 2026-10-05 |
| [D-053](decisions/D-053-the-extension-waits-for-a-land-as-long-as-its-parts-can-take.md) | The extension waits for a land as long as its parts can take | 2026-10-05 |
| [D-054](decisions/D-054-the-command-center-shows-each-task-s-analysis-and-you-answer.md) | The Command Center shows each task's analysis, and you answer its questions there | 2026-10-05 |
| [D-055](decisions/D-055-acc-autopilot-reviews-lands-and-reworks-once-up-to-an-open.md) | acc autopilot reviews, lands and reworks once, up to an open pull request | 2026-10-05 |
| [D-056](decisions/D-056-a-sandbox-deploy-can-skip-the-tests-when-a-person-says-so.md) | A sandbox deploy can skip the tests, when a person says so | 2026-10-05 |
| [D-057](decisions/D-057-a-task-s-activity-reads-as-one-feed.md) | A task's activity reads as one feed | 2026-10-05 |
| [D-058](decisions/D-058-autopilot-merges-the-base-into-a-pull-request-that-conflicts.md) | Autopilot merges the base into a pull request that conflicts with it | 2026-10-05 |
| [D-059](decisions/D-059-only-a-task-to-do-asks-for-answers-every-answer-gets-a-reply.md) | Only a task to do asks for answers, every answer gets a reply, and the Overview names conflicting files short | 2026-10-05 |
| [D-060](decisions/D-060-you-write-to-an-agent-from-its-page.md) | You write to an agent from its page | 2026-10-05 |
| [D-061](decisions/D-061-boards-keep-their-place-when-their-tab-comes-back-and-scroll.md) | Boards keep their place when their tab comes back, and scroll while you drag | 2026-10-05 |
| [D-062](decisions/D-062-a-card-has-one-next-step-the-rest-wait-behind.md) | A card has one next step; the rest wait behind ⋯ | 2026-10-05 |
| [D-063](decisions/D-063-autopilot-never-replaces-a-closed-pull-request.md) | Autopilot never replaces a closed pull request | 2026-10-05 |
| [D-064](decisions/D-064-the-command-center-runs-autopilot-and-shows-what-it-did.md) | The Command Center runs autopilot and shows what it did | 2026-10-05 |
| [D-065](decisions/D-065-all-of-acc-is-one-status-bar-item.md) | All of acc is one status bar item | 2026-10-05 |
| [D-066](decisions/D-066-ticket-updates-are-drafts-a-person-posts-ticket-fields-are.md) | Ticket updates are drafts a person posts; ticket fields are read-only unless a tracker opts in | 2026-10-05 |
| [D-067](decisions/D-067-builders-keep-the-mac-awake-a-stopped-builder-needs-you-and.md) | Builders keep the Mac awake; a stopped builder needs you and can be resumed | 2026-10-06 |
| [D-068](decisions/D-068-the-agent-board-starts-at-to-do-a-tracker-s-board-keeps-its.md) | The agent board starts at To do; a tracker's board keeps its own columns, in its order | 2026-10-06 |
| [D-069](decisions/D-069-a-heavy-check-slot-that-times-out-during-a-refresh-needs-you.md) | A heavy-check slot that times out during a refresh needs you | 2026-10-06 |
| [D-070](decisions/D-070-an-edit-on-the-task-page-is-what-the-overview-shows-and-a.md) | An edit on the task page is what the Overview shows, and a replaced draft keeps its edit | 2026-10-06 |
| [D-071](decisions/D-071-later-news-replaces-an-unposted-draft-it-overtakes.md) | Later news replaces an unposted draft it overtakes | 2026-10-06 |
| [D-072](decisions/D-072-each-repo-s-tickets-come-only-from-its-own-place-in-its.md) | Each repo's tickets come only from its own place in its tracker | 2026-10-06 |
| [D-073](decisions/D-073-a-tracker-is-connected-on-one-page-in-the-command-center.md) | A tracker is connected on one page in the Command Center, drawn from its description | 2026-10-06 |
| [D-074](decisions/D-074-track-a-ticket-from-its-card-on-the-tracker-s-board.md) | Track a ticket from its card on the tracker's board | 2026-10-06 |
| [D-075](decisions/D-075-a-promotion-drafts-ticket-updates-as-a-merge-and-a-deploy-do.md) | A promotion drafts ticket updates, as a merge and a deploy do | 2026-10-06 |
| [D-076](decisions/D-076-autopilot-sends-a-pull-request-whose-github-checks-fail-back.md) | Autopilot sends a pull request whose GitHub checks fail back to its builder, once a commit | 2026-10-06 |
| [D-077](decisions/D-077-acc-runs-without-a-node-install-behind-a-small-launcher.md) | acc runs without a Node install, behind a small launcher | 2026-10-06 |
| [D-078](decisions/D-078-acc-s-notices-go-to-slack-once-each-in-fixed-words.md) | acc's notices go to Slack, once each, in fixed words | 2026-10-06 |
| [D-079](decisions/D-079-one-version-a-changelog-no-personal-data-in-a-package-and.md) | One version, a CHANGELOG, no personal data in a package, and releases a person makes | 2026-10-06 |
| [D-080](decisions/D-080-a-machine-sets-how-many-heavy-checks-run-at-once-this-repo.md) | A machine sets how many heavy checks run at once; this repo runs five builders on Opus 5.5 | 2026-10-06 |
| [D-081](decisions/D-081-the-acc-plugin-is-a-walkthrough-step-installed-for-every.md) | The acc plugin is a walkthrough step, installed for every session from the repo's address; the docs are written for someone new | 2026-10-06 |
| [D-082](decisions/D-082-acc-sync-closes-a-task-s-github-issue-when-its-work-merges.md) | acc sync closes a task's GitHub issue when its work merges, where the tracker says edits | 2026-10-06 |
| [D-083](decisions/D-083-autopilot-merges-a-reviewed-green-pull-request-where-a-repo.md) | Autopilot merges a reviewed, green pull request where a repo turns it on | 2026-10-06 |
| [D-084](decisions/D-084-a-builder-s-conversation-still-opens-in-its-worktree-s.md) | A builder's conversation still opens in its worktree's window: Claude Code can't open it here | 2026-10-06 |
| [D-085](decisions/D-085-a-monday-com-board-is-a-tracker-connected-on-the-connect.md) | A monday.com board is a tracker, connected on the Connect page | 2026-10-06 |
| [D-086](decisions/D-086-opus-5-5-by-default-and-a-model-picked-per-task.md) | Opus 5.5 by default, and a model picked per task | 2026-10-06 |
| [D-087](decisions/D-087-agents-are-named-for-their-project-ticket-and-role.md) | Agents are named for their project, ticket and role | 2026-10-06 |
| [D-088](decisions/D-088-the-first-run-is-a-checklist-someone-fills-in-on-another.md) | The first run is a checklist someone fills in on another machine; a full check replaces Setup's rows; an older plugin fails A4 | 2026-10-06 |
| [D-089](decisions/D-089-how-agents-run-is-behind-a-settings-button-on-the-agents.md) | How agents run is behind a Settings button on the Agents page | 2026-10-07 |
| [D-090](decisions/D-090-agents-show-each-session-s-folder-in-context-with-full-path.md) | Agents show each session's folder in context, with Full path a toggle | 2026-10-06 |
| [D-091](decisions/D-091-one-tracker-sign-in-for-every-project-on-a-site-unless-a.md) | One tracker sign-in for every project on a site, unless a repo keeps its own | 2026-10-07 |
| [D-092](decisions/D-092-in-progress-on-the-overview-every-job-under-way-a-group-a.md) | In progress on the Overview: every job under way, a group a task; heavy checks wait in line | 2026-10-07 |
| [D-093](decisions/D-093-two-tasks-that-change-the-same-files-take-turns-where.md) | Two tasks that change the same files take turns, where another task can go first | 2026-10-06 |
| [D-094](decisions/D-094-a-rework-a-person-sends-back-tells-its-builder-why.md) | A rework a person sends back tells its builder why | 2026-10-07 |
| [D-095](decisions/D-095-a-finished-task-s-leftover-session-reads-as-finished-and-can.md) | A finished task's leftover session reads as Finished, and can be stopped | 2026-10-07 |
| [D-096](decisions/D-096-a-merge-queue-passing-pull-requests-are-refreshed-checked.md) | A merge queue: passing pull requests are refreshed, checked once and merged in turn | 2026-10-06 |
| [D-097](decisions/D-097-a-team-template-starts-a-project-acc-ships-none-and-never-re.md) | A team template starts a project; acc ships none, and never re-applies one | 2026-10-06 |
| [D-098](decisions/D-098-research-stays-local-and-the-repo-depends-on-no-other-repo.md) | Research stays local, and the repo depends on no other repo | 2026-10-07 |
| [D-099](decisions/D-099-each-area-s-code-lives-in-its-own-module-and-registers.md) | Each area's code lives in its own module, and registers itself | 2026-10-07 |
| [D-100](decisions/D-100-a-folder-s-modules-are-near-what-loads-them-and-the-files.md) | A folder's modules are near what loads them, and the files every task touched follow the areas | 2026-10-07 |
| [D-101](decisions/D-101-settings-is-a-section-and-acc-s-pages-can-be-light-dark-or.md) | Settings is a section, and acc's pages can be Light, Dark or Match VSCode | 2026-10-07 |
| [D-102](decisions/D-102-every-command-gate-is-told-the-near-tests-an-index-named.md) | Every command gate is told the near tests, an index named index is found by its path, and per-area files reach the tests that read them | 2026-10-07 |
| [D-103](decisions/D-103-every-config-key-and-setting-is-read-and-described-checked.md) | Every config key and setting is read and described, checked both ways | 2026-10-07 |
| [D-104](decisions/D-104-how-agents-run-moves-to-settings-and-agents-keeps-per-token.md) | How agents run moves to Settings, and Agents keeps per-token billing | 2026-10-07 |
| [D-105](decisions/D-105-shared-rules-are-copied-in-with-where-they-came-from.md) | Shared rules are copied in, with where they came from | 2026-10-07 |
| [D-106](decisions/D-106-a-builder-ends-with-a-note-that-the-reviewer-the-next.md) | A builder ends with a note that the reviewer, the next builder and the pull request read | 2026-10-07 |
| [D-107](decisions/D-107-the-agents-page-is-grouped-by-repo-then-by-task-and-says.md) | The Agents page is grouped by repo, then by task, and says nothing twice | 2026-10-07 |
| [D-108](decisions/D-108-a-project-starts-from-an-epic-an-area-path-or-labels-picked.md) | A project starts from an epic, an area path or labels, picked on the Connect page | 2026-10-07 |
| [D-109](decisions/D-109-settings-lists-every-tracker-and-its-sign-in-and-acc-writes.md) | Settings lists every tracker and its sign-in, and acc writes a tracker | 2026-10-07 |
| [D-110](decisions/D-110-settings-raises-or-lowers-how-many-builders-run-at-once-with.md) | Settings raises or lowers how many builders run at once, with what it means; this machine can cap every repo's together | 2026-10-07 |
| [D-111](decisions/D-111-the-settings-check-matches-only-real-reads-variables-the.md) | The settings check matches only real reads: variables, the config's own reads, and the intake skill | 2026-10-08 |
| [D-112](decisions/D-112-a-test-check-counts-what-ran-none-run-or-more-skipped-needs.md) | A test check counts what ran; none run, or more skipped, needs a person | 2026-10-07 |
| [D-113](decisions/D-113-changes-that-add-scratch-files-root-files-big-files-or-data.md) | Changes that add scratch files, root files, big files or data exports fail a built-in check | 2026-10-08 |
| [D-114](decisions/D-114-every-project-s-rules-keep-parallel-work-mergeable-and-a.md) | Every project's rules keep parallel work mergeable, and a burst of merges offers a tidy-up | 2026-10-08 |
| [D-115](decisions/D-115-every-command-survives-junk-arguments.md) | Every command survives junk arguments | 2026-10-08 |
| [D-116](decisions/D-116-a-review-finding-that-keeps-coming-back-is-offered-as-a-rule.md) | A review finding that keeps coming back is offered as a rule, then as a check | 2026-10-08 |
| [D-117](decisions/D-117-the-ui-rules-in-claude-md-are-tests-an-icon-and-a-label.md) | The UI rules in CLAUDE.md are tests: an icon and a label, theme colours only, no overlaps | 2026-10-07 |
| [D-118](decisions/D-118-a-number-that-may-only-get-better-acc-raises-its-floor-and.md) | A number that may only get better: acc raises its floor, and only a person relaxes it | 2026-10-07 |
| [D-119](decisions/D-119-stop-finished-sessions-stops-only-a-session-whose-process.md) | Stop finished sessions stops only a session whose process still runs | 2026-10-08 |
| [D-120](decisions/D-120-settings-about-shows-the-versions-says-a-newer-release-and.md) | Settings' About shows the versions, says a newer release and an older plugin, and Setup's machine results are kept per version | 2026-10-08 |
| [D-121](decisions/D-121-slack-each-repo-s-github-account-and-the-command-center-s.md) | Slack, each repo's GitHub account and the Command Center's own preferences are in Settings; switching an account is a person's | 2026-10-08 |
| [D-122](decisions/D-122-a-relaxed-floor-counts-only-for-the-task-a-person-relaxed-it.md) | A relaxed floor counts only for the task a person relaxed it for | 2026-10-08 |
| [D-123](decisions/D-123-the-heavy-check-slots-find-machine-json-as-the-total-does.md) | The heavy-check slots find machine.json as the total does, and the CLI's tests are a file per command group | 2026-10-08 |
| [D-124](decisions/D-124-nothing-opens-on-its-own-the-command-center-s-first-open-in.md) | Nothing opens on its own: the Command Center's first open in a folder that isn't set up lands on Setup | 2026-10-08 |
| [D-125](decisions/D-125-machine-json-has-one-writer-under-a-lock-and-every-cli-test.md) | machine.json has one writer, under a lock, and every CLI test runs acc through cli() | 2026-10-09 |
| [D-126](decisions/D-126-a-github-project-s-card-follows-its-task-s-state-where-the.md) | A GitHub Project's card follows its task's state, where the tracker says edits | 2026-10-09 |
| [D-127](decisions/D-127-the-command-center-has-depth-wells-set-into-the-page-and.md) | The Command Center has depth: wells set into the page, and raised cards and panels on it | 2026-10-09 |
| [D-128](decisions/D-128-a-task-s-builder-effort-is-picked-like-its-model-and-haiku-5.md) | A task's builder effort is picked like its model, and Haiku 5.5 replaces Haiku 4.5 | 2026-10-09 |
| [D-129](decisions/D-129-a-board-click-opens-a-task-in-a-modal-the-tab-is-one-click.md) | A board click opens a task in a modal; the tab is one click away | 2026-10-09 |
| [D-130](decisions/D-130-every-test-file-names-an-edge-case-it-covers.md) | Every test file names an edge case it covers | 2026-10-09 |
| [D-131](decisions/D-131-the-overview-is-a-landing-page-one-line-per-item-detail-on-a.md) | The Overview is a landing page: one line per item, detail on a click | 2026-10-09 |
| [D-132](decisions/D-132-the-command-center-speaks-in-processes-not-commands.md) | The Command Center speaks in processes, not commands | 2026-10-09 |
| [D-133](decisions/D-133-the-screenshot-run-retries-a-drawing-chrome-didn-t-finish.md) | The screenshot run retries a drawing Chrome didn't finish, and measures a tab once it has settled | 2026-10-10 |
| [D-134](decisions/D-134-every-export-is-named-by-a-test.md) | Every export is named by a test | 2026-10-10 |
| [D-135](decisions/D-135-usage-is-spent-where-it-pays-medium-by-default-up-only-for.md) | Usage is spent where it pays: medium by default, up only for cause | 2026-10-10 |
| [D-136](decisions/D-136-the-modals-behaviour-is-checked-in-a-browser-and-each-case.md) | The modals' behaviour is checked in a browser, and each case is shown to catch a stub | 2026-10-10 |
| [D-137](decisions/D-137-a-test-run-removes-the-temp-folders-it-makes-and-b0-repo.md) | A test run removes the temp folders it makes, and B0.repo reads a crowded folder only in part | 2026-10-10 |
| [D-138](decisions/D-138-a-builder-s-screenshots-gate-checks-the-ui-was-shot-as-it-is.md) | A builder's screenshots gate checks the UI was shot as it is | 2026-10-10 |
| [D-139](decisions/D-139-every-rule-in-the-repo-s-own-rules-names-its-check.md) | Every rule in the repo's own rules names its check | 2026-10-10 |
| [D-140](decisions/D-140-cloud-builders-an-option-for-any-project-on-github-never-the.md) | Cloud builders: an option for any project on GitHub, never the default | 2026-10-09 |
| [D-141](decisions/D-141-requirements-are-written-in-simplified-technical-english-and.md) | Requirements are written in Simplified Technical English, and acc checks their wording | 2026-10-13 |
| [D-142](decisions/D-142-a-tab-that-is-opening-shows-a-loading-screen-at-its-center.md) | A tab that is opening shows a loading screen at its center | 2026-10-13 |
| [D-143](decisions/D-143-the-screenshot-run-loads-a-page-s-fonts-before-it-sends-the.md) | The screenshot run loads a page's fonts before it sends the model | 2026-10-14 |
| [D-144](decisions/D-144-every-builder-runs-the-repo-wide-rule-tests.md) | Every builder runs the repo-wide rule tests | 2026-10-14 |
| [D-145](decisions/D-145-slack-is-a-tracker-kind-a-channel-s-threads-are-its-tickets.md) | Slack is a tracker kind: a channel's threads are its tickets | 2026-10-14 |
| [D-146](decisions/D-146-a-slack-channel-connects-from-the-connect-page-with-its-app.md) | A Slack channel connects from the Connect page, with its app's bot token | 2026-10-14 |
| [D-147](decisions/D-147-the-page-obeys-reduce-motion-answers-a-press-at-once-leads.md) | The page obeys reduce motion, answers a press at once, leads only with what needs you, and follows the font size | 2026-10-14 |
| [D-148](decisions/D-148-a-slack-thread-is-tracked-by-pasting-its-link-on-the-tasks.md) | A Slack thread is tracked by pasting its link on the Tasks tab | 2026-10-14 |
| [D-149](decisions/D-149-a-suggested-rule-leaves-the-page-from-acc-s-reply-that-it.md) | A suggested rule leaves the page from acc's reply that it was accepted or dismissed | 2026-10-14 |
| [D-150](decisions/D-150-a-calm-overview-needs-you-first-every-other-list-a-quiet.md) | A calm Overview: Needs you first, every other list a quiet card that opens in full | 2026-10-14 |
| [D-151](decisions/D-151-the-overview-s-model-drops-the-stat-tiles-keeps-its-cards-in.md) | The Overview's model drops the stat tiles, keeps its cards in the host, and its card words agree with the header | 2026-10-14 |
| [D-152](decisions/D-152-a-tidy-up-counts-a-task-merged-in-git-not-only-one-merged-by.md) | A tidy-up counts a task merged in git, not only one merged by a pull request | 2026-10-15 |
| [D-153](decisions/D-153-every-tab-keeps-blue-for-what-needs-you-a-card-that-asks.md) | Every tab keeps blue for what needs you; a card that asks offers Answer; Agents names its stops alike | 2026-10-15 |
| [D-154](decisions/D-154-settings-opens-with-a-link-to-each-part-and-a-long.md) | Settings opens with a link to each part, and a long explanation folds away | 2026-10-15 |
| [D-155](decisions/D-155-a-project-names-its-folders-indexes-so-a-count-of-modules.md) | A project names its folders' indexes, so a count of modules doesn't decide its near tests | 2026-10-15 |
| [D-156](decisions/D-156-a-command-palette-searches-the-page-s-sections-settings.md) | A command palette searches the page's sections, Settings, tasks, agents and actions, and Enter runs the choice | 2026-10-15 |
| [D-157](decisions/D-157-the-task-page-shows-its-review-s-findings-each-with-its-file.md) | The task page shows its review's findings, each with its file, line and the lines around it | 2026-10-15 |
| [D-158](decisions/D-158-the-merge-cycle-runs-each-check-once.md) | The merge cycle runs each check once | 2026-10-15 |
| [D-159](decisions/D-159-the-tasks-boards-work-from-the-keyboard-arrows-between-cards.md) | The Tasks boards work from the keyboard: arrows between cards, Enter opens, Space picks a card up and moves it | 2026-10-15 |
| [D-160](decisions/D-160-the-screenshot-run-checks-every-drawing-with-axe-core-and.md) | The screenshot run checks every drawing with axe-core, and fails on a finding no exception excuses | 2026-10-15 |
| [D-161](decisions/D-161-every-control-s-name-holds-what-it-shows-and-faded-text.md) | Every control's name holds what it shows, and faded text still reads: the eight a11y follow-ups are fixed | 2026-10-15 |
| [D-162](decisions/D-162-a-burst-of-notices-shows-as-one-notification-that-counts.md) | A burst of notices shows as one notification that counts them | 2026-10-15 |
| [D-163](decisions/D-163-the-screenshot-run-draws-three-pages-at-once-each-job-in-its.md) | The screenshot run draws three pages at once, each job in its own Chrome | 2026-10-15 |
| [D-164](decisions/D-164-news-while-you-are-away-waits-on-the-overview-s-since-you.md) | News while you are away waits on the Overview's Since you last looked | 2026-10-15 |
| [D-165](decisions/D-165-the-slow-tests-start-their-processes-a-few-at-once-the.md) | The slow tests start their processes a few at once, the dispatch tests are three files, and the tests keep a compile cache | 2026-10-15 |
| [D-166](decisions/D-166-the-extension-finds-a-newer-release-by-itself-offers-it-in-a.md) | The extension finds a newer release by itself, offers it in a notification, and installs it, reloads and opens the Command Center | 2026-10-15 |
| [D-167](decisions/D-167-the-output-panel-shows-a-review-as-a-short-summary-that.md) | The output panel shows a review as a short summary that opens up, not as plain text | 2026-10-16 |
| [D-168](decisions/D-168-dispatch-asks-for-the-model-the-effort-and-where-it-runs-in.md) | Dispatch asks for the model, the effort and where it runs in one sheet, and a task's buttons share one size and place | 2026-10-16 |
| [D-169](decisions/D-169-every-run-in-the-output-panel-shows-as-rows-never-as-a-block.md) | Every run in the output panel shows as rows, never as a block of raw lines | 2026-10-16 |
| [D-170](decisions/D-170-history-groups-its-entries-under-a-line-for-each-day-and.md) | History groups its entries under a line for each day, and loads them a page at a time | 2026-10-16 |
| [D-171](decisions/D-171-acc-s-long-commands-report-their-steps-and-the-output-panel.md) | acc's long commands report their steps, and the output panel lists them | 2026-10-16 |
| [D-172](decisions/D-172-the-project-verifies-a-ui-change-with-the-pinned-headless.md) | The project verifies a UI change with the pinned headless shell, never the person's own browser | 2026-10-16 |
| [D-173](decisions/D-173-the-self-update-refuses-a-release-that-has-no-checksum-file.md) | The self-update refuses a release that has no checksum file | 2026-10-17 |
| [D-174](decisions/D-174-a-salesforce-project-can-say-it-doesn-t-use-source-tracking.md) | A Salesforce project can say it doesn't use source tracking | 2026-10-17 |
| [D-175](decisions/D-175-a-person-writes-a-task-in-a-full-sheet-and-edits-its-title.md) | A person writes a task in a full sheet, and edits its title, description and other fields later | 2026-10-19 |
| [D-176](decisions/D-176-each-tasks-board-filters-by-person-everyone-mine-unassigned.md) | Each Tasks board filters by person: everyone, mine, unassigned, or one person | 2026-10-20 |
| [D-177](decisions/D-177-a-person-s-own-edit-writes-to-the-ticket-where-the-tracker.md) | A person's own edit writes to the ticket where the tracker allows edits | 2026-10-20 |
| [D-178](decisions/D-178-a-jira-tracker-follows-the-active-sprint-or-one-named-sprint.md) | A Jira tracker follows the active sprint or one named sprint, and the Overview says when the sprint changes | 2026-10-20 |
| [D-179](decisions/D-179-acc-drafts-a-ticket-s-acceptance-criteria-test-steps-and.md) | acc drafts a ticket's acceptance criteria, test steps and edge cases, and a person edits and posts them | 2026-10-20 |
| [D-180](decisions/D-180-a-rework-a-person-sent-back-carries-the-passed-review-s.md) | A rework a person sent back carries the passed review's findings | 2026-10-19 |
| [D-181](decisions/D-181-a-slack-channel-s-messages-marked-with-a-reaction-are-a.md) | A Slack channel's messages marked with a reaction are a board on the Tasks tab | 2026-10-21 |
| [D-182](decisions/D-182-acc-verifies-a-developer-s-pull-request-for-a-tracked-ticket.md) | acc verifies a developer's pull request for a tracked ticket, and drafts a QA comment a person posts | 2026-10-21 |
| [D-183](decisions/D-183-a-failed-verification-leaves-no-worktree-and-a-dirty-one.md) | A failed verification leaves no worktree, and a dirty one says it wrote no receipt | 2026-10-21 |
| [D-184](decisions/D-184-cloud-reviewers-a-cloud-task-s-review-runs-in-the-cloud-too.md) | Cloud reviewers: a cloud task's review runs in the cloud too, where the project opts in | 2026-10-21 |
| [D-185](decisions/D-185-every-tracker-fills-what-it-has-in-one-normal-form.md) | Every tracker fills what it has, in one normal form | 2026-10-21 |
| [D-186](decisions/D-186-a-builder-that-never-started-needs-you-and-can-t-tell-is-a.md) | A builder that never started needs you, and "can't tell" is a state, not "fine" | 2026-10-21 |
| [D-187](decisions/D-187-tickets-look-considered-on-every-tracker-one-state-chip.md) | Tickets look considered on every tracker: one state chip, tinted labels and avatars | 2026-10-21 |
| [D-188](decisions/D-188-plain-words-for-someone-new-the-command-center-add-to-my.md) | Plain words for someone new: the Command Center, Add to my work, Make a plan, Build it | 2026-10-22 |
| [D-189](decisions/D-189-a-ticket-shows-planned-changes-then-changes-keeps-them-after.md) | A ticket shows Planned changes, then Changes, keeps them after merge, and names Salesforce metadata by type | 2026-10-22 |
| [D-190](decisions/D-190-record-changes-are-part-of-a-ticket-planned-recorded-when.md) | Record changes are part of a ticket: planned, recorded when made, kept, and stepped at promotion | 2026-10-22 |
| [D-191](decisions/D-191-a-salesforce-ticket-s-package-xml-is-built-by-salesforce-s.md) | A Salesforce ticket's package.xml is built by Salesforce's own CLI, checked against its org, and compared with the org's fresh copies | 2026-10-22 |
| [D-192](decisions/D-192-a-plan-offers-each-design-choice-as-options-keeps-its.md) | A plan offers each design choice as options, keeps its versions, and nothing is built until a person approves it | 2026-10-22 |
| [D-193](decisions/D-193-choose-a-board-by-seeing-it-cards-for-each-choice-and-the.md) | Choose a board by seeing it: cards for each choice, and the board before it is kept | 2026-10-22 |
| [D-194](decisions/D-194-tick-several-jira-epics-and-choose-a-github-project-from-its.md) | Tick several Jira epics, and choose a GitHub Project from its card | 2026-10-22 |
| [D-195](decisions/D-195-talk-a-plan-through-with-its-planning-agent-on-the-ticket.md) | Talk a plan through with its planning agent, on the ticket page or in Claude Code, and turn what you agree into the plan | 2026-10-22 |
| [D-196](decisions/D-196-a-tracker-s-changes-field-named-in-its-settings-drafted-as.md) | A tracker's changes field: named in its settings, drafted as an update when a ticket's changes change, saved by a person | 2026-10-22 |
| [D-197](decisions/D-197-parallel-work-merges-on-its-own.md) | Parallel work merges on its own: floors take the higher, pages and decisions are a line or a file each, numbered at merge | 2026-10-22 |
| [D-198](decisions/D-198-builders-work-as-a-team.md) | Builders work as a team: each knows the others in flight, is told when one lands, and takes it in early | 2026-10-22 |
| [D-199](decisions/D-199-a-plan-suggests-a-small-first-task-for-a-shared-shape.md) | A plan suggests a small first task for a shape other tasks build on, so they can start sooner | 2026-10-22 |
| [D-200](decisions/D-200-review-plan-one-step-at-a-time.md) | Review plan: a plan's choices and questions one at a time, in a sheet, as Claude Code asks its own | 2026-10-22 |
| [D-201](decisions/D-201-a-plan-reads-the-whole-ticket.md) | Make a plan reads the whole ticket: every comment, related tickets and the changes field, and says when new comments arrive | 2026-10-22 |
| [D-202](decisions/D-202-a-plan-starts-with-a-conversation-in-its-own-panel.md) | A plan starts with a conversation, and the conversation lives in its own panel beside the ticket | 2026-10-22 |
| [D-203](decisions/D-203-ci-runs-the-full-check.md) | GitHub Actions runs the full check and the screenshot run on every pull request, and autopilot waits for it | 2026-10-22 |
| [D-204](decisions/D-204-one-question-at-a-time.md) | Talking a plan through asks one question at a time, with answers to pick, and shows less at once | 2026-10-22 |
| [D-205](decisions/D-205-a-single-choice-offers-three-options-and-your-own-words.md) | A single choice offers at most three options and your own words, everywhere a person is asked | 2026-10-22 |
| [D-206](decisions/D-206-a-salesforce-builder-deploys-to-its-build-org.md) | A Salesforce builder deploys its work to its build org, verifies it and runs the tests there before it's done | 2026-10-23 |
| [D-207](decisions/D-207-report-a-problem.md) | Report a problem: a person drafts a GitHub issue from the Command Center, sees exactly what it says, and posts it | 2026-10-27 |
| [D-208](decisions/D-208-setup-without-production-access.md) | A person with no access to Production still sets up a Salesforce project and uses the Command Center | 2026-10-27 |
