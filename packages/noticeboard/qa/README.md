# Isolated Noticeboard acceptance

Run only against the dedicated localhost acceptance stack. Supply the fixture
account environment file through `HOMI_TEST_CREDENTIALS` (`HOMI_BOOTSTRAP_EMAIL`,
`HOMI_OWNER_PASSWORD`). Add the second member with `seed-member.mjs` (run inside a
module-admin container, as in the Homi server testing recipe). Never run it
against a real household.

```sh
HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=<fresh dir> HOMI_TEST_CHROME=/usr/bin/google-chrome \
  node packages/noticeboard/qa/acceptance.mjs
```

It covers three browser profiles (two devices of the owner and the second member): create with a
colour, list and a photo shrunk on the device; drag, overlap and bring to front; scaling across
widths; unpin and pin back; the module list; ticking; delete rights; Core Search and Add; offline
create, move and tick across restarts; reconnect; a stale offline edit; and layout at 390, 768 and
1440 px.
