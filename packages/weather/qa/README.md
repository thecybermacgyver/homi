# Isolated Weather acceptance

Run only against a dedicated localhost acceptance stack (never a real household), with Weather
installed from the exact package under test, a fixture owner and a second fixture member, and
invented data. Supply the fixture account file through `HOMI_TEST_CREDENTIALS`
(`HOMI_BOOTSTRAP_EMAIL`, `HOMI_OWNER_PASSWORD`). Build the stack the way the other module
acceptances do (see [New module workflow](../../../docs/NEW_MODULE_WORKFLOW.md#5-isolated-acceptance)):
its own compose project name, volumes and loopback ports (3400 and 3401), the production Core and web
images, `docker compose --profile maintenance run --rm migrate`, the `bootstrap` command, the second member
added with an adapted copy of `packages/mealplanner/qa/seed-member.mjs` (run from `/app/apps/core` in a
`module-admin` container so its packages resolve), and Weather installed with `module-admin install`.

```sh
HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=<fresh dir> HOMI_QA_OUT=<output dir>/ HOMI_TEST_CHROME=/usr/bin/google-chrome \
  node packages/weather/qa/acceptance.mjs
```

It uses three browser profiles (two devices of the owner and the second member; the owner's devices are
given an invented position in a Toronto district, the second member none) and covers: the six Dashboard
cards and their empty state; the Current card with a precise position, and with none (an approximate
position, labelled as such); a place saved on one device reaching the other device and its cards in both
directions; privacy (the second member sees no place, cannot read one by id and cannot delete one); choosing
which place a card shows (a card holds one place at a time); the Celsius or Fahrenheit choice following the
member and not another member; Core's Add; a full restart while offline (places and last forecast load,
adding a place is disabled, changes queue and survive another restart); reconnect without conflicts; a stale
offline edit surfaced for review with the shared version kept; layout at 390, 768 and 1440 px (no overflow,
every card fills its box, no page errors); an axe pass (WCAG 2.0 and 2.1 A and AA) on nine screens including
the add-a-place sheet, the settings sheet and the remove confirmation; and removing a place everywhere.
`browser-acceptance.json` records the latest passing run.

Not applicable: Core Search (Weather declares `search: false`) and a module upgrade (0.1.5 is the first
published version). The outside weather services are real, so the test needs the stack's server to reach the
internet; it asserts structure and labels, not weather values.
