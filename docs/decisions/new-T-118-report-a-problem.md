## D-T-118 Report a problem: a person drafts a GitHub issue from the Command Center, sees exactly what it says, and posts it (2026-10-27)

T-118. People besides the author now use the Command Center. When something breaks they need one easy way to
tell the author, with what is needed to fix it, and nothing from their client work.

- **The command.** Report a problem is `acc.report` (`REPORT_COMMAND` in `extension/src/model/report.ts`): an
  id, a line saying what it takes (nothing, or a Setup step's id), and `enabled`, which says no, with why, while
  a report posts. VSCode's Command Palette lists it (`extension/commands/report-panel.json`); so do the Command
  Center's own palette (`action:report`), Settings' About (a row, Something wrong?, with the button) and each
  Setup step whose check failed, which passes its id. About's button and the palette's item are off with the
  command's reason while a report posts; the command then brings that report's tab forward instead of a new one.
- **The draft.** A tab of its own, "Report a problem" (`extension/src/report-panel.ts`, drawn by
  `extension/webview/report.ts`): a title, What happened and What you expected in the person's words, and
  What's attached, which the Command Center fills: the extension's, the command-line engine's and the plugin's
  versions, macOS's (from `sw_vers`) and VSCode's, the project's profile, each Setup step's id and result
  (pass, fail, unknown or skip, as the check says it), the step it was opened from with what its check said, and
  the last error the person saw: the last run in the output panel that failed since the window opened, with its last 12 lines, in
  process words (D-132). Each box can be changed, and is kept in the tab's memory as it's typed.
- **Nothing leaves without the person seeing it.** Opening the draft reads and attaches; it sends nothing. The
  attached block is scrubbed before the tab shows it (`extension/src/logic/scrub.ts`): every open project's root
  becomes `<project>` and the home folder `~`; then the repo's own secret patterns, a Salesforce session id and a
  named password or token become `<token>`; then the words each project's settings hold (its name, GitHub repo
  and account, commit name and email, each environment's org alias or username, each tracker's site, project,
  repo, organization, account, workspace, channel and team) and the machine's username become `<name>`,
  `<repo>`, `<user>`, `<email>`, `<org>` or `<site>`; then any URL's host, email, service site (Jira's,
  Salesforce's, monday's, Slack's, Azure DevOps'), ticket key (such as ABC-123) and word shaped like a token.
  The tab says what it replaced, in a line. Under the boxes, the whole issue shows as it will be posted, kept as
  the person types. Post to GitHub sends exactly that, and only on its click; it is off, with why, until there
  is a title and What happened.
- **Posting.** As gh's signed-in account (D-088: a token in the environment is left out), to the Command
  Center's own repo, `RELEASES_REPO`: `gh issue create --repo <it> --title <title> --body-file -`, the body on
  stdin, never in a URL. gh's answer is read by `parsePost`: the new issue's link, which the tab then shows;
  not signed in; can't reach the repo; gh not installed; or anything else, with gh's first line, scrubbed. Each
  failure says so in orange, with what to do, and offers Copy the issue text, which puts the title and body on
  the clipboard.
- **Issue templates.** `.github/ISSUE_TEMPLATE/bug.yml` has the draft's three sections as its fields, by id and
  label in the same order (`REPORT_SECTIONS` in `extension/webview/report-text.ts`), and the draft's body is
  written as GitHub's issue form writes one: each section a heading, then its text or `_No response_`.
  `config.yml` keeps blank issues allowed, for the tasks the author files by hand.
- **The checks.** `extension/test/scrub.test.ts` feeds a config and an error holding 26 details (paths, emails,
  hosts, ticket keys, org aliases and usernames, a username, tokens) and checks none survives, counting each.
  `extension/test/report.test.ts` (14 tests) covers the command, what's attached, gh's answers and the post with
  a stand-in gh: nothing runs before Post, Post runs once with the body on stdin, and each failure offers Copy.
  `extension/test/report-panel.test.ts` (3 tests) runs the built extension with a stand-in gh on PATH.
  `extension/test/report-page.test.ts` (5 tests) draws the page under Node. `extension/test/report-template.test.ts`
  (4 tests) checks the template's fields against the draft's sections. The behaviour run's report case types
  into the page in a browser, clicks Post and Copy, and two mutants (Post sending the attached block as it
  first was, and a draft sent as it's typed) must fail it.
- **Out of scope.** Attaching files or screenshots; a report from the command line; reading the issue's
  replies in the Command Center.
