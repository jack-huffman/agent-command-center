## D-T-171 A deploy pick or typed yes that a builder's own code writes is never a yes (2026-10-31)

T-171. The security review of T-156 (D-239) left a gap: the deploy guide can't write a pick or a typed yes, but a
builder runs the project's own code (its tests, its build scripts), which runs as the same user as acc and can write
any file under acc's state directory, where the pick (`deploy-picks/<task>.json`) and the typed yes
(`deploy-yes/<task>.json`) live. The guard reads a builder's commands; it can't read what a test does when it runs.
Production and a protected org take a deploy only on the name the person types (D-235, D-239), and that yes has to
come from the person, not from a file any process of the same user can write.

It amends D-239 (and D-235's yes): a pick, a typed yes and a relaxed floor are signed with the person's key, and a
record without that signature, or signed for another task, environment or chat, reads as no record, with why. The
person's steps don't change: no new prompt, no new click. Everything else D-235 and D-239 say stands.

- **What acc reads as the person's word, under `stateDir`** (the git directory's `acc/`), and what a forged one could do:
  - `deploy-picks/<task>.json`, the pick (D-239): for a sandbox that isn't protected, the yes itself. Forged, it
    sends the guide's deploy to that sandbox with no person behind it, when the guide runs `acc deploy` and the
    person approves the command; for production or a protected org it fixes where, so a forged one points a deploy.
    **Signed here.**
  - `deploy-yes/<task>.json`, the typed yes (D-235): the name the person typed in the guide's chat. Forged, it
    deploys to production in the person's own open chat without their having typed the name: the skill tells the
    guide to run the deploy only after the name is typed, but the guide's word isn't acc's check. **Signed here.**
  - `relaxed.jsonl`, a relaxed floor (GH-99, GH-130): a person's word that a task's branch may hold a worse floor.
    Forged for its own task, a builder lowers a quality floor in `.acc/floors.json` and its checks pass; merged, the
    floor stays lower for every task after it. **Signed here.**
  - A receipt with `waived` (`receipts/`, D-031): a person's waiver of a check on a commit. Forged, a required
    check is skipped. Not signed here, and signing it alone would stop nothing: a receipt is also what a builder's
    own `acc gate run` writes, and a forged receipt that says `pass` needs no waiver. The receipts are a later task.
  - The ledger (`ledger.json`): a plan a person approved, their answers to an analysis's questions, who moved a
    task and when. Forged, a plan reads as approved or a task as done. acc writes it for everyone, so it isn't
    signed here; a later task.
  - `task-deploys/<task>.json`, the kept check, and the ledger's `deploys` and `promotions`: acc's own record of
    what passed and where a ticket is, not a person's word. A forged kept check names a job the org doesn't know;
    a forged deploy record moves where a ticket reads as being, and so what the person is offered to pick. Not
    signed here: the person still picks and types.
  - `rules/`, `updates/`, `tickets/`, `boards.json`, `where/`, `team/`: what a person did, or what acc read,
    kept to show again and not to ask twice. None is read as a yes to anything with an effect outside the repo.
- **The key** (`packages/core/src/person-key.ts`). One Ed25519 pair per account on this machine, made by the
  first person's command that signs (`signingKey` with `create`), never by an agent's process. Its private half
  is read only to sign: by `acc deploy --guide` (the pick), `acc gate relax` (the relaxed floor) and the
  UserPromptSubmit hook of the guide's chat (the typed yes), which is the one process that sees what the person
  types. Its public half is a second item in the same store, and is all a reader needs: the guide's `acc deploy`
  and a builder's `acc gate run` verify without ever loading the private key (`verifier`). A record signs its
  kind and its fields in a fixed order (`canonical`, `signedBody`), so a signed pick is no signed yes, and the
  task, the environment and the chat are under the signature (`PICK_SIGNED`, `TYPED_YES_SIGNED`,
  `RELAX_SIGNED`). The pick's `used` mark is outside it: the guide's deploy sets it and holds no key.
- **Where the key lives: the system's own secret store, read by acc at the moment it signs or verifies**
  (`personStore`). Not VS Code's secret storage, though it was the first thought: the hook that keeps the typed
  yes runs inside the guide's Claude Code, which must not hold the key, and a hook can't read what VS Code
  keeps; so the key is where a command-line process can reach it, and the extension holds nothing.
  - **A Mac:** the login keychain, through `security`, as the cloud token is kept (T-145): the private half on
    `security -i`'s stdin, never on a command line (`keychainStore`). The keychain is encrypted with the login
    password and locks with the session. What it doesn't protect: an item made by `security` lets `security`
    read it with no prompt, so any process of the same user that runs `security find-generic-password` reads
    the key while the keychain is unlocked; another program asking through the keychain's own API gets the
    keychain's prompt.
  - **Windows, with no WSL:** a file under `%LOCALAPPDATA%\acc\acc-person-key`, encrypted by DPAPI in the user's
    scope through PowerShell, the file's name and the value in its environment, never on its command line
    (`dpapiStore`). Another account on the machine, and a copy of the file taken off it, can't decrypt it. What
    it doesn't protect: any process running as the user decrypts it.
  - **Elsewhere (Linux, CI):** a file under `~/.config/acc/acc-person-key`, readable by its owner alone, which is
    no secret store, and says so (`kind: 'file'`).
  - **Tests and CI** point acc at a folder of their own with `ACC_PERSON_STORE`, so no test touches this
    machine's keychain or DPAPI files; a person's own acc never sets it. One test runs the real store, under a
    name of its own, on whichever system runs it, so Windows CI exercises DPAPI and a Mac the keychain.
- **A record without the person's signature reads as no record, with why.** The deploy's reasons name what was
  found and what to do: "The pick kept for T-1 is no pick: it isn't signed. Only a person's own acc deploy
  --guide makes one. No one picked where T-1 goes…"; "The yes kept for T-1 is no yes: it isn't signed by this
  machine's person key. Only what the person types in this chat is their yes. Ask the person to type it…"; a
  machine with no key: "This machine has no person key yet, so nothing can be read as the person's word. A
  person's own acc deploy --guide, or acc gate relax, makes one." A signed yes for another chat ("The person
  typed it in another chat, not this one") or another environment ("The person typed it in a chat for uat, not
  Production") is refused too, which closes D-235's "two guide chats for one ticket share it". A failing ratchet
  names the relax record it refused and why. A refused yes is used up as any yes is, so it is never read
  twice; a refused pick stays where it is, and is no pick each time it is read. The skill lists the new
  refusals (`plugin/skills/deploy/SKILL.md`).
- **Builders never get the key.** No agent's environment holds it: a builder's is its task, its role and its
  PATH, a reviewer's and an analyst's add their role, the deploy guide's is pinned whole (`ACC_ROLE`,
  `ACC_TASK`, `ACC_DEPLOY_TO`). `signingKey` refuses a builder, a reviewer and an analyst by role, whatever they
  claim. The hook signs as a child of the guide's Claude Code, which can't run it (`acc hook` is denied, and the
  guard refuses the word). A test pins which modules call `signingKey` and which name the private item, so a
  launch that handed the key on would have to name one of them.
- **Not covered:**
  - A process of the same user that reads the store: `security` on a Mac while the keychain is unlocked, DPAPI
    on Windows while the user is logged in. It can sign a forged record as the person, and it could replace the
    key, after which the person's own records fail to verify until a person's command signs with the new one.
  - A process that starts acc itself as the deployer, with an environment of its choosing (`ACC_ROLE`,
    `ACC_PERSON_STORE`, a store of its own): acc trusts the environment it was started with, as before this
    change. Closing that needs the deploy to run in a process a person started, such as the Command Center; a
    later task.
  - The pick's `used` mark isn't signed: a process that clears it lets a sandbox deploy go again on the same
    pick within its 15 minutes, with the person approving the guide's command in the chat as before. For
    production the typed name is used up, and can't be made again.
  - The value passes through a short-lived process's environment (PowerShell) or stdin (`security`): a process
    listing another's environment in that moment could read it.
  - MCP tools in the guide's chat, as D-235 says; a receipt, the ledger and the kept check, as above.
  - A machine with no key: the first `acc deploy --guide` or `acc gate relax` makes one, and a guide chat opened
    before that on a machine with none keeps no yes until it is reopened.
- **Checked by** `packages/core/test/person-key.test.ts` (9: each store's round trip, the real store under a
  test's own name on this system, `security` with the value on stdin, PowerShell with the value in its
  environment and the file renamed into place, which store each system gets, the pair made once by a person's
  command and never by the hook, the roles that never sign, what a signature covers, and no agent's
  environment holding the key with the signers pinned), `packages/core/test/deploy-pick.test.ts` (3 more: an
  unsigned pick, another key, a changed field and a machine with no key; a yes from another chat or
  environment; a mutant that accepts an unsigned pick, caught), `packages/core/test/deploy-guide.test.ts` (2
  more: an unsigned, forged or re-keyed yes, and a yes for another environment or chat; the hook test now
  checks the signed record and a machine with no key), `packages/core/test/gates.test.ts` (1 more: a forged
  relax record backs nothing and the ratchet and the stored floor say why, by each form),
  `packages/core/test/task-deploy.test.ts` (the two guided deploys and both mutants on signed records), and
  `packages/cli/test/deploy-guide.test.ts` (acc's own `--guide` signs the pick, read back through the tests'
  store). Two mutants are caught: one that accepts an unsigned pick (run by the test), and one, run by hand, that hands a key to a builder's
  environment (the builder's settings given an `ACC_PERSON_KEY`: the launch test fails on the name; a module other
  than the three signers calling `signingKey` fails the pin).
