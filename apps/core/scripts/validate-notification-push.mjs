import assert from "node:assert/strict";
import {
  createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify,
} from "node:crypto";
import {
  encryptPushPayload, generateVapidKeys, vapidAuthorization,
} from "../dist/notifications.js";

const b64u = (v) => Buffer.from(v).toString("base64url");
const fromB64u = (v) => Buffer.from(v, "base64url");

// A browser's side of RFC 8291: decrypt what the server sent.
function decrypt(body, uaPrivate, uaPublic, auth) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const serverPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(serverPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, serverPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 0x02, "last record delimiter");
  return plain.subarray(0, plain.length - 1);
}

const ua = createECDH("prime256v1");
ua.generateKeys();
const auth = randomBytes(16);
const message = JSON.stringify({ title: "Dentist", body: "Starts in 15 minutes", unicode: "café ☕ 日本" });
const body = encryptPushPayload(Buffer.from(message), b64u(ua.getPublicKey()), b64u(auth));
assert.equal(decrypt(body, ua.getPrivateKey(), ua.getPublicKey(), auth).toString(), message);

// Wrong keys must not decrypt, and bad subscription keys must be refused.
assert.throws(() => decrypt(body, createECDH("prime256v1").generateKeys() && ua.getPrivateKey(), ua.getPublicKey(), randomBytes(16)));
assert.throws(() => encryptPushPayload(Buffer.from("x"), "AAAA", b64u(auth)), /invalid/i);

const keys = generateVapidKeys();
assert.equal(fromB64u(keys.publicKey).length, 65);
const header = vapidAuthorization(keys, "https://push.example/send/abc", "https://homi.example", Date.UTC(2026, 9, 15));
const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
assert.ok(m, "authorization header shape");
const claims = JSON.parse(fromB64u(m[2]).toString());
assert.equal(claims.aud, "https://push.example");
assert.equal(claims.sub, "https://homi.example");
assert.ok(claims.exp > Date.UTC(2026, 9, 15) / 1000);
assert.equal(m[4], keys.publicKey);
const pub = fromB64u(keys.publicKey);
const key = createPublicKey({
  key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
  format: "jwk",
});
assert.ok(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, fromB64u(m[3])));

console.log("PASS_HOMI_NOTIFICATION_PUSH");
