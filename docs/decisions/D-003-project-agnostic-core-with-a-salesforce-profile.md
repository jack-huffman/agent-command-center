## D-003 Project-agnostic core with a Salesforce profile (2026-10-01)

Salesforce is the first and most important target, but it is one profile. The
ledger, dispatch, review and extension know nothing about Salesforce. The
`salesforce` profile adds deploy validation, static analysis and org-aware
checks.
