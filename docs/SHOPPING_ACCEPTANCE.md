# Shopping 0.2.2 acceptance

Approved by the household operator on 2026-09-28 after server testing.

The module consumes the public working-cache/outbox SDK and the shared UI.
Core owns dependent offline writes, actual revision binding on first dispatch,
immutable retries, reviewable failed dependencies, and automatic delivery.

Passed: full workspace build/typecheck; manifest/isolation and exact operation
adapter/entity-handler registration; SDK and offline asset contracts; 12 Core
client regression tests; offline create/edit/check/uncheck/delete across full
browser restarts; automatic reconnect; two registered devices for one account;
a distinct authorized household user; targeted-recipient privacy; duplicate
replay and changed-request rejection; stale-revision conflict review; historical
delete materialization; 390/768/1440 responsive checks and zero page errors.

The published runtime package is the exact server-tested artifact.
Package digest: sha256:383dbafa77282ea16d061c74475b47582e9ced7c0b3b2a28e7ac449e3433f69c.

Requires the Core client synchronization fixes shipped with this source release.
Older Core clients must update before installing Shopping 0.2.2.
