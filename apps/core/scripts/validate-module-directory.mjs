import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  HomiModuleDirectoryError,
  createHomiModuleDirectoryService,
  verifyHomiModuleDirectory,
} from "../dist/module-directory.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const payload = JSON.stringify({
  schemaVersion: 1,
  generatedAt: "2026-09-21T18:00:00.000Z",
  entries: [{
    moduleKey: "calendar",
    name: "Calendar",
    publisher: "Homi",
    description: "Shared family calendar.",
    latestVersion: "0.6.3",
    moduleApiVersion: 1,
    artifactUrl: "https://github.com/thecybermacgyver/homi/releases/download/calendar-v0.6.3/calendar-0.6.3.tar.gz",
    packageDigest: "sha256:" + "a".repeat(64),
    sourceUrl: "https://github.com/thecybermacgyver/homi",
    requestedPermissions: ["calendar.event.read"],
    publishedAt: "2026-09-21T17:00:00.000Z",
    revoked: false,
  }],
});
const envelope = {
  payload,
  signature: {
    algorithm: "ed25519",
    keyId: "homi-directory-2026",
    value: sign(null, Buffer.from(payload), privateKey).toString("base64"),
  },
};
const trusted = new Map([["homi-directory-2026", publicPem]]);
const verified = verifyHomiModuleDirectory(envelope, trusted);
assert.equal(verified.keyId, "homi-directory-2026");
assert.equal(verified.entries[0]?.moduleKey, "calendar");
assert.equal(verified.entries[0]?.latestVersion, "0.6.3");

assert.throws(
  () => verifyHomiModuleDirectory({
    ...envelope,
    payload: payload.replace("0.6.3", "9.9.9"),
  }, trusted),
  (error) => error instanceof HomiModuleDirectoryError &&
    error.code === "MODULE_DIRECTORY_SIGNATURE_INVALID",
);
assert.throws(
  () => verifyHomiModuleDirectory(envelope, new Map()),
  (error) => error instanceof HomiModuleDirectoryError &&
    error.code === "MODULE_DIRECTORY_KEY_UNTRUSTED",
);

const unsafePayload = JSON.stringify({
  ...JSON.parse(payload),
  entries: [{
    ...JSON.parse(payload).entries[0],
    artifactUrl: "https://example.com/calendar.tar.gz",
  }],
});
const unsafeEnvelope = {
  payload: unsafePayload,
  signature: {
    ...envelope.signature,
    value: sign(null, Buffer.from(unsafePayload), privateKey).toString("base64"),
  },
};
assert.throws(
  () => verifyHomiModuleDirectory(unsafeEnvelope, trusted),
  (error) => error instanceof HomiModuleDirectoryError &&
    error.code === "MODULE_DIRECTORY_UNTRUSTED_URL",
);
const service = createHomiModuleDirectoryService({
  directoryUrl: "https://github.com/thecybermacgyver/homi/releases/download/module-directory/directory.json",
  trustedPublicKeys: trusted,
  fetch: async () => new Response(JSON.stringify(envelope), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});
assert.equal((await service.list()).entries.length, 1);

assert.throws(
  () => createHomiModuleDirectoryService({
    directoryUrl: "https://example.com/directory.json",
    trustedPublicKeys: trusted,
  }),
  (error) => error instanceof HomiModuleDirectoryError &&
    error.code === "MODULE_DIRECTORY_UNTRUSTED_URL",
);

console.log(
  "PASS_MODULE_DIRECTORY_TRUST " +
  "ed25519=yes digest-pinned=yes github-release-only=yes tamper-rejected=yes",
);
