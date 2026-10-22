## D-017 One list of onboarding steps drives the CLI, the walkthrough and the docs (2026-10-01)

The user wants every setup step remembered and available as a GUI walkthrough.
Steps are data in `core`: id, why, the profiles they apply to, a check, and a
fix. `acc doctor` and `acc onboard` run them in a terminal. The VSCode
walkthrough shows them as steps that tick themselves when their check passes.
ONBOARDING.md is the manual version for now and will be generated from the list
later. With one source, the three can't disagree.

The walkthrough moves up to M2. It's the first GUI, and it needs only the
onboarding checks from M1.
