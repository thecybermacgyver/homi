# Security policy

## Supported versions

Homi is currently pre-1.0. Security fixes are applied to the latest commit on `main`; older development snapshots are not supported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature for this repository. Include the affected component and version, reproduction conditions, impact, and any proposed mitigation.

Do not include real household data, credentials, private signing keys, access tokens, database dumps, or production logs containing personal information.

## Deployment expectations

Homi must be deployed behind HTTPS. PostgreSQL and the internal module-manager service must not be exposed publicly. Operators must generate independent secrets, retain tested backups, apply supported dependency updates, and review third-party modules before trusting their signing publisher.

Module packages are untrusted until their signed directory entry, immutable release URL, digest, manifest, API compatibility, migrations, and requested permissions pass Homi's validation.