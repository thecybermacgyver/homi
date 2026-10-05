# Isolated Meal Planner acceptance

Run only against the dedicated localhost acceptance stack. Supply the fixture account
environment file through `HOMI_TEST_CREDENTIALS` (`HOMI_BOOTSTRAP_EMAIL`, `HOMI_OWNER_PASSWORD`).
Add the second member with `seed-member.mjs` (run inside a module-admin container, as in the Homi
server testing recipe), install Meal Planner, and install the test-only `recipes-fixture`
(build it with `pnpm exec esbuild qa/recipes-fixture/src/server.ts --bundle --platform=node --format=esm --target=node24 --outfile=qa/recipes-fixture/dist/server.js`
and package `dist homi.module.json locales migrations package.json`). Never run it against a real household.

```sh
HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=<fresh dir> HOMI_TEST_CHROME=/usr/bin/google-chrome \
  node packages/mealplanner/qa/acceptance.mjs
```

It covers three browser profiles (two devices of the owner and the second member): the default card
(Monday to Friday in the mock-up's colours); planning from the page and from the card; marking cooked;
choosing other days, a colour, long names and a breakfast slot with the card following on every device;
repeating weekly and deleting later repeats; copying a meal and a week; meal ideas (save, suggest, plan);
the recipe link (hidden until a Recipes module is enabled, then searched and linked); Core Search and Add;
offline planning across restarts and reconnect; a stale offline edit; and layout at 390, 768 and 1440 px.
