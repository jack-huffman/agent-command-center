---
name: analyze
description: Analyze an acc task before anyone builds it. Works out the requirements, investigates the code and, on Salesforce, the orgs (read-only), and proposes the approach, refactors, risks and tests, with questions for a person. Use when someone asks to analyze, scope, investigate or plan a ticket, or before dispatching one.
---

# Analyze a task before it's built

A builder only knows what it's told. The analysis tells it: what the ticket really asks, what's already there, and how to build it.

1. **Run it:** `acc analyze <id>`. A fresh, read-only analyst agent reads the ticket and the repo. On a Salesforce project it also reads every org the project lists. It can run only these commands, and its hook refuses anything else:
   - git log, show, diff and grep
   - `sf org display`
   - `sf data query`, the Tooling API included
   - `sf sobject describe`
   - `sf org list metadata`
   - `sf limits`
   - `sf project retrieve start`, into a scratch project
   
   It never edits, writes or deploys.
2. **Read it:** `acc analysis <id>`. It gives:
   - the gist
   - its questions
   - the acceptance criteria
   - what's there now, with where each finding came from
   - the approach and the refactors needed first
   - the risks and the tests
   - a size

   The verdict is **ready**, **questions**, or **split**: too big for one task, with the smaller tasks it suggests.
3. **Answer its questions:** `acc analysis answer <id> <q> "<answer>"`. Only a person answers. Each question comes with a suggested answer. When the last one is answered, the task is ready to build.
4. **Build it:** `acc dispatch <id>`, or `acc dispatch <id> --model <m>` to pick the builder's model for this task. The size can help a person choose, but nothing picks a model by it. The builder's instructions include the whole analysis and the answers. Salesforce projects won't dispatch a task until it has an analysis with every question answered. Other projects can skip it. A person can override that with `--without-analysis`.

Analyzing again keeps the answers to questions it asks again.

## Reading an org safely

The analyst follows these rules on any org:

- **Know which org.** It runs `sf org display` and checks `Organization.IsSandbox`, and every finding says which org it came from.
- **Automation before code.** It looks at what already runs on an object, in save order: validation rules, before-save flows, triggers, then after-save flows. A change should join that, not add another layer.
- **Dependencies.** It queries `MetadataComponentDependency` to see what uses a component.
- **Volumes.** It checks record counts, since limits matter at the real data's size.
- **Records.** It reads a few to learn their shape, and never copies personal details into the analysis.
- **The repo against the org.** It says where the org has drifted from its branch.
