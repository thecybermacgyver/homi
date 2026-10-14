# Isolated Shopping acceptance

Run only against the dedicated localhost acceptance stack. Supply the generated
fixture account environment file through HOMI_TEST_CREDENTIALS. Never use a real
household database to seed fixture accounts or run mutating acceptance tests.

```sh
pnpm --filter @homi/shopping exec esbuild src/web.tsx --bundle --platform=node --format=esm --packages=external --outfile=qa/web-contract.mjs
node packages/shopping/qa/contract.mjs
node packages/shopping/qa/acceptance.mjs
node packages/shopping/qa/api-tests.mjs
```

The 0.3.0 store-counts acceptance seeds items under the production build with
Shopping 0.2.2 (plus Calendar and Chequebook), then verifies after the upgrade. Supply a fresh profile directory per stack:

```sh
HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=... PHASE=seed node packages/shopping/qa/store-counts-acceptance.mjs
# move the same isolated stack to the candidate Core/web images, run Core
# migrations, install the 0.3.0 package, and restart its Core
HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=... PHASE=verify node packages/shopping/qa/store-counts-acceptance.mjs
```

Core dependency/retry/isolation regression tests run with
`pnpm --filter @homi/web test`. The generated browser and API reports record the
September 28 candidate acceptance. The public release uses the recovered exact
server-installed artifact, not a rebuild of the QA directory.

The 0.4.1 notepad acceptance checks the Dashboard card as drawn: the pad under
the card title with its coils over the paper's top edge and filling the card,
items on the ruled lines with the box to tick in the margin, ticking, nine items
with "+ N more" for a longer list, the title and Open list opening the page, the
counts style on the same paper, and the card at 390, 768 and 1440 px:

```sh
HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=... HOMI_TEST_URL=http://localhost:3400 node packages/shopping/qa/notepad-acceptance.mjs
```

