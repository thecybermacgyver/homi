import assert from "node:assert/strict";
import { discoverAppleCalendars } from "../dist/providers.js";

const originalFetch = globalThis.fetch;
let calls = 0;

try {
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("fetch must not run for an untrusted initial URL");
  };

  await assert.rejects(
    discoverAppleCalendars(
      "release-test",
      "not-a-real-secret",
      "http://127.0.0.1/internal",
    ),
    /trusted iCloud CalDAV host/,
  );
  await assert.rejects(
    discoverAppleCalendars(
      "release-test",
      "not-a-real-secret",
      "https://caldav.icloud.com.attacker.invalid/",
    ),
    /trusted iCloud CalDAV host/,
  );
  assert.equal(calls, 0);

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: {
        location: "http://169.254.169.254/latest/meta-data/",
      },
    });
  };

  await assert.rejects(
    discoverAppleCalendars(
      "release-test",
      "not-a-real-secret",
      "https://caldav.icloud.com/",
    ),
    /trusted iCloud CalDAV host/,
  );
  assert.equal(calls, 1);

  console.log(
    "PASS_CALENDAR_PROVIDER_SECURITY initial-ssrf=blocked redirect-ssrf=blocked credential-forwarding=icloud-only",
  );
} finally {
  globalThis.fetch = originalFetch;
}
