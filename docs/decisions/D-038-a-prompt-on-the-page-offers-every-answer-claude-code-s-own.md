## D-038 A prompt on the page offers every answer Claude Code's own prompt does (2026-10-02)

Allow and Deny weren't the whole of Claude Code's prompt: it also offers "always
allow, from this project", "switch to auto mode", "Tab to amend", and Esc to
stop. Each one is now a numbered choice on the card, in Claude Code's order.
Press its number or click it, and hover for what it means.

| Choice | What the hook sends |
|---|---|
| Yes | allow |
| Yes, and always allow … in this session | allow, with the suggested rules for the session |
| Yes, and always allow … in this project | allow, with the rules saved to `.claude/settings.local.json` |
| Yes, and switch to auto mode | allow, with `setMode: auto` for the session |
| Edit the command, then allow… | deny, telling the agent to run your version, which is then approved once |
| No, and tell it what to do instead… | deny, with your words |
| No, and stop it | deny with `interrupt`: its turn ends, as Esc does |
| A plan: Yes, and auto-accept edits / approve each edit / keep planning… | allow with `setMode: acceptEdits` or `default`, or deny with your feedback |

- **Each was tried against a real session first.** The edited command ran
  instead of the original. Auto mode took over and asked nothing more. The
  stop ended the turn with "Request interrupted by user for tool use".
- **An edit isn't slipped in silently.** Allowing with `updatedInput` runs
  your version, but the agent never hears of it, and the test agent was
  puzzled by the result. So an edit is a "no, run exactly this instead". Your
  version is approved for that session's next run of exactly that command,
  within ten minutes.
- **The notification** offers Allow (when the whole command fits) and **All
  choices…**, which opens the full list in VSCode's own picker.
- **Never** a switch to `bypassPermissions`: the hook refuses it.
