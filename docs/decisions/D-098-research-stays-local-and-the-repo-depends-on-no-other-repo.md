## D-098 Research stays local, and the repo depends on no other repo (2026-10-07)

The author's rule: research and supporting notes are for building the tool, not
part of it.

- `docs/research/` is gitignored. The 1 October landscape review is untracked
  and kept on disk, and D-001 now says what it found instead of linking to it.
  Earlier copies stay in git history. That includes the PhotoCraft review,
  which 3af9b78 committed by mistake and 204ce9b untracked.
- Nothing committed links to a local-only note. Issues, packets and docs carry
  their own reasoning.
- The repo depends on no other repo for tools, and other repos shouldn't depend
  on this one's files. Anything taken from elsewhere is copied in, with a note
  of where it came from and when. It's updated only when a person chooses.
  GH-80's team templates already work this way, and GH-108 makes shared rules
  work the same way. This extends D-002 from skills to everything.
