## D-016 Environment-specific files are never edited by a task, deployed or promoted (2026-10-01)

Some metadata differs by design in every org: email service addresses,
Email-to-Case routing, SSO and org settings. Copying one environment's version
into another breaks things. Each repo lists these files (`environmentSpecific`).
Builders can't edit them, deploys and promotions leave them out, and drift
checks ignore them.

A second list (`knownDrift`) covers files that differ for less important
reasons, such as features a sandbox lacks or ordering noise. Drift checks ignore
these too, but they can still be changed and promoted.
