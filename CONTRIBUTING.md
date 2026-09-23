# Contributing to Homi

Homi welcomes Core, documentation, and independently packaged module contributions while the project remains pre-1.0.

## Before changing code

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_PROTOCOL.md`, and the requirements document for the component being changed. Homi is a clean-sheet project: do not introduce OpenFamily code, names, dependencies, or private module-to-Core paths.

Feature modules must use the public SDK, manifest, shared UI, broker, synchronization, lifecycle, and module-owned `mod_<module_key>` schema contracts. A module must not import private Core/Web code or another module.

## Required validation

Run `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm audit --prod --audit-level high`, and the component-specific validators documented in its package. Run `git diff --check` and review the complete changed-file set.

Never commit secrets, `.env`, signing private keys, production data, database dumps, backups, or personal information. Use synthetic fixtures.

## Changes and releases

Keep changes focused and explain the user-visible behavior, tests, migration impact, and recovery path. Schema changes require transactional migrations. Module releases are immutable and versioned; changing released bytes requires a new version and digest.

By contributing, you agree that your contribution is licensed under AGPL-3.0.