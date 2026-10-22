## D-025 The Salesforce format gate checks Apex and LWC code, never metadata XML (2026-10-01)

`format` runs `prettier --check` only on changed Apex (`.cls`, `.trigger`) and
LWC JavaScript, HTML and CSS, including LWC tests. It skips metadata XML, an
LWC bundle's `.js-meta.xml`, JSON, Markdown, Aura and Visualforce.

**Why.** The first version checked every type the SFDX template's prettier
script lists, including XML. Salesforce writes metadata XML in its own layout,
and every retrieve rewrites it that way. Prettier's layout differs, so
formatting it only produces whole-file diffs, then drift on the next retrieve.
On the pilot, 3,527 of 3,535 source files failed prettier, nearly all of them
XML. Apex and LWC code is written by people and kept as written, so formatting
it sticks. A project can still replace the gate with its own command under
`gates.commands.format`.
