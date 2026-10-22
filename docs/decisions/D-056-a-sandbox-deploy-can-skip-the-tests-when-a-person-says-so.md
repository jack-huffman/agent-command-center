## D-056 A sandbox deploy can skip the tests, when a person says so (2026-10-05)

T-1 was the first Avalign change to go all the way, merged into aleysian as
Aleysian/Avalign#1. `acc deploy` always ran local tests when Apex changed, so
the deploy would fail on the four `CaseResponseTimeTriggerHandlerTest`
methods. They fail on the org's holiday data, in Production too, whatever T-1
does. The author chose to let a sandbox deploy go without them.

- `acc deploy <env> --no-tests` deploys with NoTestRun. Salesforce allows that
  on a sandbox and never on production. acc refuses it for production and for
  any protected environment.
- It's a person's flag: autopilot and builders never deploy (D-011, D-055).
- A check-only validate is still how a change proves itself first (D-024).
  T-1's validate compiled the same 17 files in the Aleysian sandbox and ran
  the four test classes there.
