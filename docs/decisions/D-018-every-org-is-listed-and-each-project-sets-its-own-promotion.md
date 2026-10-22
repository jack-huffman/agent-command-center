## D-018 Every org is listed, and each project sets its own promotion path (2026-10-01)

Clients run different pipelines: Dev → Full Copy → Production for a strict
release process, and Sandbox → Production for a small org. So the path isn't
fixed. `acc init` finds every org (Production's `SandboxInfo`, plus the
logged-in aliases on the same My Domain) and records each one's type. Each
environment's `promotesTo` lists where it may promote to, with the usual step
first. A person may pick any listed destination. When that skips an environment
on the usual path, `acc` says so in the warning and in the pull request.
