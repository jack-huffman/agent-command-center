# Agent Command Center

Get projects ready for parallel Claude Code agents, then run and watch them from
VSCode.

## Setup walkthroughs

Open **Help → Welcome → Walkthroughs** or the Command Palette:

- **Agent Command Center: Set up this machine.** Tools and GitHub accounts.
- **Agent Command Center: Onboard this project.** Config, the repo's GitHub
  account, a branch per environment, source tracking and safe defaults.

Every step has buttons:

| Button | Does |
|---|---|
| **Check** | Runs that step's check now |
| **Do it** | Runs the fix in a terminal, so you see exactly what happens. Commands with `<placeholders>` are typed but not run, so you can fill them in |
| **Open in Salesforce** | Opens Setup in the right org, for clicks only you can make |
| **I've done this** | For steps nothing on this machine can check |
| **Read the guide** | Opens the onboarding guide |

A step ticks itself when its check passes. The status bar shows how many steps
are left, and clicking it opens the project walkthrough.

VSCode keeps a ticked step ticked even if its check later fails. The status bar
and **Agent Command Center: Check setup** always show the current state.

## The acc command

The extension adds `acc` to every VSCode terminal. Run `acc doctor` for every
check, or `acc onboard` for the next step to do. The walkthrough runs the same
checks.

## Requirements

git 2.40+, Node 20+, the GitHub CLI and Claude Code. Salesforce projects also
need the Salesforce CLI with Code Analyzer. The first walkthrough checks all of
these.
