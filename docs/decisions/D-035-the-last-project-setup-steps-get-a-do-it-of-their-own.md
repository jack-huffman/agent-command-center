## D-035 The last project setup steps get a Do it of their own (2026-10-02)

B5, B6, B9 and B10 were terminal recipes in ONBOARDING.md. Each is now an
`acc setup` command that the walkthrough's **Do it** runs in the output panel
(D-030).

- **`acc setup baseline` (B5)** runs `sf project generate manifest` on every
  environment branch, in throwaway worktrees, and writes the union to
  `manifest/baseline-package.xml`: sorted, at the newest API version.
- **`acc setup branches` (B6)** makes each missing branch.
  - Production's comes first, from this checkout, retrieved from its org.
  - Each sandbox's starts from production's with its source cleared, so what
    exists only in Production shows as a difference. It's then retrieved from
    its own org.
  - The orgs are only read. A branch whose retrieve fails is removed again, so
    the next try starts clean. Nothing is pushed without `--push`.
- **`acc setup lists` (B9)** drafts both lists from how each sandbox's branch
  differs from production's.
  - Org configuration goes to environment-specific: email services, named and
    external credentials, SSO, remote sites, and the email, security and
    domain settings.
  - App logos go to known drift, and so does any file whose two versions have
    the same lines in another order: Salesforce's ordering noise, measured
    rather than guessed by file type. On Avalign that's 3 object files, where
    "every object file" would have been 52.
  - It names the differences neither list explains, and never overwrites a
    list you have.
- **`acc setup readme` (B10)** writes the environments table, the promotion
  flow and the environment-specific rule between `<!-- acc:environments -->`
  markers. Running it again replaces just that part.

None of them commits to an existing branch. A person reads the drafts and
commits them on each environment's branch.
