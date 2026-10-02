# Isolated web acceptance

Run only against dedicated localhost acceptance stacks with fixture accounts and
invented data. Never use a real household database.

- `board-layout-acceptance.mjs`, `password-acceptance.mjs`: Family Board arranging and password flows.
- `pwa-update-acceptance.mjs`: PWA install and update. One persistent browser
  profile acts as an installed device and is never cleared. The script checks
  the manifest and Chrome's installability report, then upgrades the stack
  over ssh while the device is offline and again online, and finally swaps the
  web container to a candidate shell with a new service-worker cache. Set
  `HOMI_TEST_CREDENTIALS`, `HOMI_TEST_PROFILES`, `HOMI_TEST_SSH`,
  `HOMI_PWA_UPGRADE_CMD` (install newer module packages and restart Core) and
  `HOMI_PWA_SHELL_CMD` (point the web service at the candidate image). The
  stack must start at Calendar 0.6.14 and Chequebook 0.1.15 on a production
  shell image. `pwa-update-acceptance.json` records the latest passing run.
