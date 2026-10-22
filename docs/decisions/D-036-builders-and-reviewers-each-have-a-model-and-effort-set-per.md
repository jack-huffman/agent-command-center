## D-036 Builders and reviewers each have a model and effort, set per clone or per project (2026-10-02)

Agents ran on whatever Claude Code defaulted to, which is its heaviest model at
high effort. That's right for some work and wasteful for a quick review. Each
kind of agent now has a profile: a model (an alias such as `opus`, `sonnet` or
`fable`, or a full name), an effort from `low` to `max` (how hard it thinks),
and a fallback model for when the first is overloaded.

- **Two places to set it, like the GitHub account (D-028).** This clone's
  choice lives in git config (`acc.builder.model`, `acc.reviewer.effort`, …),
  and nobody else sees it. The project's default lives in `.acc/config.json`
  under `agents.builder` and `agents.reviewer`, for a team to share. A clone's
  choice wins, part by part. Anything unset is Claude Code's own default.
- **They're Claude Code's own flags.** `--model`, `--effort` and
  `--fallback-model`, on the builder's background session, the reviewer's
  `claude -p`, and free-form agents started from the page, which run like
  builders.
- **On the page:** the Agents section opens with **How agents run**. Each
  profile shows every part and where it's set, and **Change…** walks through
  model, effort or fallback, then asks whether it's for this clone or the
  project. An agent's page shows the model its answers came from, read from
  the transcript.
- **What they bill.** Under the profiles, the setup check `A1.claude-billing`
  (GH-9) says whether agents use your Claude subscription, or would bill per
  token through an API key.
- **`acc agents` and `acc agents set`** do the same from a terminal. A project
  change edits only that part of `.acc/config.json`.

Also: builders may now run their tests and builds under `nice -n 15` without a
prompt, as this repo's own rules ask. The first real run of GH-9 stopped on
exactly that.
