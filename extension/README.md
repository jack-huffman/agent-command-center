# Agent Command Center

Get projects ready for parallel Claude Code agents, then run and watch them from
VSCode.

## Setup walkthroughs

Open **Help → Welcome → Walkthroughs**, or run the command beside each in the
Command Palette:

- **Agent Command Center: set up this machine** (**Agent Command Center: Set up
  this machine**). Tools, GitHub accounts, agents' billing, and the acc plugin
  in Claude Code.
- **Agent Command Center: onboard a project** (**Agent Command Center: Onboard
  this project**). Config, the repo's GitHub account, a branch per environment,
  source tracking, safe defaults and the ticket source.

Neither opens by itself. The first time you open the Command Center in a
folder that isn't set up, it opens on its **Setup** page: a walkthrough of the
same steps, one on each screen, that asks what kind of project it is. The
Command Palette opens these.

Every step has buttons:

| Button | Does |
|---|---|
| **Check** | Runs that step's check now |
| **Do it** | Runs the fix in a terminal or an output panel, so you see exactly what happens. Commands with `<placeholders>` are typed but not run, so you can fill them in |
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

macOS, on Apple Silicon or Intel. git 2.40 or later, the GitHub CLI, and Claude
Code's terminal CLI. Salesforce projects also need Node 20 or later and the
Salesforce CLI with Code Analyzer. acc itself needs no Node: it runs on VSCode's
own runtime. The machine walkthrough checks all of these, and installs the acc
plugin in Claude Code.
