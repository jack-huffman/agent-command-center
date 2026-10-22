## D-073 A tracker is connected on one page in the Command Center, drawn from its description (2026-10-06)

Connecting a tracker went through prompts at the top of VSCode: an input box
for the site, another for the email and token, then a quick pick for each of
the project, board and place (D-027, D-072). The author wanted it GUI driven
and easier, and chose one page in the Command Center (GH-51).

- **The Connect page is a view inside the Command Center tab**, not a rail
  item and not a tab of its own (a person decided). It opens over the section
  it came from, with Back to it: from Connect Jira on the Tasks tab, Add a
  tracker on the Overview, Setup's B14 Do it, New work, and the Add a tracker
  command. With no project named and several open, it starts with a project to
  choose. Leaving it, or closing the tab, drops what was on it.
- **Every Sign in to Jira or Azure DevOps opens it at that tracker's sign-in**
  (a person decided): the board's error, the ticket page, Needs you, B14 and
  the Sign in to a tracker command. The input-box sign-ins are gone. Sign out
  stays a command.
- **An existing tracker can change only its place, board, team and sign-in**
  (a person decided). Its site, organization or repo, and its project, show as
  fixed text: another project is another tracker. Each board's Change opens it.
  Save replaces it where it is in the list, keeping keys the page doesn't
  manage (skipLabels, edits, prefix), and an epic that's done since stays
  chosen though Jira no longer lists it.
- **Each tracker's part of the page comes from a description** beside its
  client in core (`trackers/connect.ts`): its host field and how to read a
  pasted link, its ways to sign in, how to check a sign-in, its lists in order
  with what each depends on and its "whole project" choice, and how it's
  written to and read from `.acc/config.json`. The page has no tracker of its
  own, so monday.com later is a client and a description, not another page.
  Signing in is one of three kinds a description names: fields typed on the
  page (Jira's email and API token, an Azure DevOps personal access token),
  VSCode's Microsoft sign-in, or gh as the project's account (D-007). The
  extension carries out the last two.
- **The page reaches no tracker itself**: its CSP stays `default-src 'none'`,
  and every check and list runs in the extension, which sends back only words.
  A token travels from the page once, with Test connection, and goes to
  VSCode's secret storage under the repo's own key (D-027). It's never in the
  page's model, the tab's saved state, the log or `.acc/config.json`. It's kept
  once the test succeeds, because the lists need it, as before.
- **Errors sit beside what they're about**: a site or organization that can't
  be reached beside it, a refused token beside the token, a list that can't be
  read beside that list, which still offers the whole project. Every state has
  an icon and words: blue for signed in, loading and saving, orange for what's
  wrong.
- **Jira's email comes from the repo's `git config user.email`**, and the board
  id is written whenever a board is picked, not only when there are several.
  A late answer for a choice since changed is dropped.
- **A board list that can't be read doesn't hold Save** for Jira, which shows
  the project's first board without one. Once signed in, the token typed is
  forgotten by the page.
- **Setup's Sign in, with several Jira or Azure DevOps trackers,** still asks
  which one with a quick pick, then opens the page at it.
- Not chosen: a page per tracker; a separate editor tab, like a ticket's;
  changing an existing tracker's project on the page; a GitHub Project picker
  (an existing `board` is kept as it is).
- This replaces D-027's "Add a tracker… sets a repo up from VSCode" prompts
  and D-072's "Add a tracker ends with the place" quick picks. What they write
  is unchanged.
