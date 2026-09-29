# Homi Development Protocol

## Source of truth

Use, in order:
1. positively validated repository checkpoints
2. current repository code
3. validated database/API behavior
4. targeted inspection when an exact fact is genuinely unknown

Do not replace confirmed facts with assumptions.

## Root-cause policy

When something fails:
1. read the exact error
2. identify the failing layer
3. gather the smallest missing evidence
4. fix the cause
5. rerun the affected validation

Do not:
- weaken types just to compile
- suppress errors
- invent schema fields
- add compatibility shims without a demonstrated requirement
- perform broad rewrites before the failing behavior is understood

## Continuous execution

Implementation work is continuous by default.

After work begins, proceed through inspect -> change -> validate -> root-cause fix -> revalidate -> diff review -> checkpoint -> push -> cleanup -> next active substep without pausing for routine confirmation.

Stop only when:
- the user explicitly instructs a stop/pause
- an unresolved product or architecture choice genuinely requires the user
- required access, credentials, privilege, or physical action is unavailable and only the user can provide it
- targeted root-cause investigation reaches a blocker that cannot be resolved with current repository evidence or authorized tools

Do not stop merely because:
- a test/build/command batch finished
- a commit or push succeeded
- a substep completed and the roadmap already defines the next substep
- a tool call failed but the failure is diagnosable
- a process, timeout, execution turn, or tool interaction ended
- an intermediate result is worth reporting

Routine tool failures are engineering work, not user blockers: read the exact error, fix the cause, rerun validation, and continue.

Never describe normal turn/tool execution boundaries as a "tool window" the user must open. There is no user-facing tool window required for normal Homi development.

Do not claim background execution after an assistant response. Continuous execution means continuing tool work within the active implementation turn until a valid stop condition exists.

## Change discipline

Keep changes scoped to the active substep.

Before a checkpoint:
- run the relevant build/test
- run `git diff --check`
- inspect `git status --short`
- inspect `git diff --stat`
- review the actual diff for architectural drift

Generated files must be expected and reviewed.

## Checkpoint discipline

A Git commit becomes authoritative only after its intended behavior is validated.

A later experimental commit does not erase an earlier proven state. If an experiment is premature or wrong, remove or revert it cleanly.

### Database-backed Core validators

`apps/core/scripts/validate-*.mjs` scripts that read `HOMI_TEST_*` URLs run
against real PostgreSQL. Each creates its own fixture and must start from a
fresh database with only Core migrations applied (`packages/db` migrate), so
run each one on its own new database; never against a real household database.
Build the workspace first (`pnpm -r build`) so the template and module
artifacts they install exist. They are not in CI, so run them whenever Core
lifecycle, sync, installer, or module-contract code changes:

- `HOMI_TEST_MIGRATOR_DATABASE_URL` and `HOMI_TEST_APP_DATABASE_URL` for all;
  `HOMI_TEST_DATABASE_URL` (app role) for household-module-service;
  `HOMI_TEST_MODULES_DIRECTORY` (empty directory) for module-runtime-56 and
  module-runtime-assets-56, which runs module-runtime-56 first on a fresh fixture.

Validators derive module versions and sync cardinality from the packages in the
repository and schedule time-dependent fixtures relative to the run date, so
they do not go stale as modules are released.

## Synchronization-specific rules

- Server remains authoritative.
- Cursor advancement must follow successful local application.
- Mutation retries reuse the original client mutation ID.
- Same mutation ID plus identical contents returns the stored result.
- Same mutation ID plus different contents is rejected.
- Conflict results include authoritative server state.
- Client storage must remain household-scoped.
- Generic sync infrastructure must not encode one module/entity's business shape.
- PostgreSQL BIGINT protocol values remain decimal strings in browser persistence.

## Deployment discipline

Laptop development repository:
`~/Homi`

Server repository:
`~/Homi`

Server currently runs Homi through Docker Compose.

Do not disturb unrelated services, especially OpenFamily.

Avoid full-repository extraction over protected deployment files when only application files need updating. Prefer Git-based deployment or narrowly scoped file updates once the workflow is migrated.

## Codex discipline

Codex should work on a branch for implementation tasks.

The first Codex task after onboarding must be read-only:
- read project instructions
- inspect repository/history
- identify the validated checkpoint
- identify current Master Step/Substep
- describe the next required synchronization work
- make no changes

Only after that audit agrees with `docs/CURRENT_STATE.md` should implementation begin.
