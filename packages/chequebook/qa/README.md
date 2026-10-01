# Isolated Chequebook multi-device acceptance

Run only against a dedicated localhost acceptance stack with Chequebook
installed, enabled for the fixture household and set up, plus the fixture owner
and one second household member (`chq-second@example.invalid`, same password).
Never use a real household database. All data is invented.

```sh
HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=... node packages/chequebook/qa/acceptance.mjs
```

`HOMI_TEST_CREDENTIALS` is a file with `HOMI_BOOTSTRAP_EMAIL` and
`HOMI_BOOTSTRAP_PASSWORD`; `HOMI_TEST_PROFILES` is a scratch directory for the
browser profiles; `HOMI_TEST_URL` defaults to `http://localhost:3400`.

The script drives three browser profiles (two devices of one member, plus a
second member) and proves automatic propagation, offline create/edit/delete
across full browser restarts, reconnect without self-conflicts, balances that
equal the server's on every device, reviewable stale-edit conflicts, and
responsive layout. `browser-acceptance.json` records the latest passing run.
`replay-deleted-acceptance.mjs` is the separate deleted-history replay check.
