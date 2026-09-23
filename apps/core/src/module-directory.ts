import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { HOMI_MODULE_API_VERSION } from "@homi/module-sdk";
import { fetchGitHubReleaseAsset } from "./github-release-asset.js";

const KEY = /^[a-z][a-z0-9-]{1,63}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PERMISSION = /^[a-z][a-z0-9.-]{1,127}$/;
const GITHUB_HOSTS = new Set(["github.com", "objects.githubusercontent.com"]);

export class HomiModuleDirectoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HomiModuleDirectoryError";
    this.code = code;
  }
}

export interface HomiModuleDirectoryEntry {
  readonly moduleKey: string;
  readonly name: string;
  readonly publisher: string;
  readonly description: string;
  readonly latestVersion: string;
  readonly moduleApiVersion: number;
  readonly artifactUrl: string;
  readonly packageDigest: string;
  readonly sourceUrl: string;
  readonly requestedPermissions: readonly string[];
  readonly publishedAt: string;
  readonly revoked: boolean;
}

export interface HomiVerifiedModuleDirectory {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly entries: readonly HomiModuleDirectoryEntry[];
  readonly keyId: string;
}

export interface HomiSignedModuleDirectoryEnvelope {
  readonly payload: string;
  readonly signature: {
    readonly algorithm: "ed25519";
    readonly keyId: string;
    readonly value: string;
  };
}

type SignedEnvelope = HomiSignedModuleDirectoryEnvelope;

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, field: string, keys: readonly string[]): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `${field} contains unknown field '${key}'.`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `${field} is missing '${key}'.`);
    }
  }
}

function string(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || (pattern && !pattern.test(value))) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `${field} must be an ISO timestamp.`);
  }
  return parsed;
}

function url(value: unknown, field: string, artifact: boolean): string {
  const raw = string(value, field);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `${field} must be an absolute URL.`);
  }
  if (parsed.protocol !== "https:" || !GITHUB_HOSTS.has(parsed.hostname)) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_UNTRUSTED_URL", `${field} must use HTTPS on an approved GitHub host.`);
  }
  if (artifact && parsed.hostname === "github.com" && !parsed.pathname.includes("/releases/download/")) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_UNTRUSTED_URL", `${field} must identify an immutable GitHub release asset.`);
  }
  return parsed.toString();
}

function parseEntry(value: unknown, index: number): HomiModuleDirectoryEntry {
  const input = object(value, `entries[${index}]`);
  exactKeys(input, `entries[${index}]`, [
    "moduleKey", "name", "publisher", "description", "latestVersion",
    "moduleApiVersion", "artifactUrl", "packageDigest", "sourceUrl",
    "requestedPermissions", "publishedAt", "revoked",
  ]);
  if (!Number.isSafeInteger(input.moduleApiVersion) || input.moduleApiVersion !== HOMI_MODULE_API_VERSION) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INCOMPATIBLE", `entries[${index}].moduleApiVersion is not supported.`);
  }
  if (!Array.isArray(input.requestedPermissions)) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `entries[${index}].requestedPermissions must be an array.`);
  }
  const permissions = input.requestedPermissions.map((item, permissionIndex) =>
    string(item, `entries[${index}].requestedPermissions[${permissionIndex}]`, PERMISSION),
  );
  if (new Set(permissions).size !== permissions.length) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `entries[${index}].requestedPermissions contains duplicates.`);
  }

  if (typeof input.revoked !== "boolean") {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", `entries[${index}].revoked must be boolean.`);
  }
  return Object.freeze({
    moduleKey: string(input.moduleKey, `entries[${index}].moduleKey`, KEY),
    name: string(input.name, `entries[${index}].name`),
    publisher: string(input.publisher, `entries[${index}].publisher`),
    description: string(input.description, `entries[${index}].description`),
    latestVersion: string(input.latestVersion, `entries[${index}].latestVersion`, SEMVER),
    moduleApiVersion: input.moduleApiVersion,
    artifactUrl: url(input.artifactUrl, `entries[${index}].artifactUrl`, true),
    packageDigest: string(input.packageDigest, `entries[${index}].packageDigest`, DIGEST),
    sourceUrl: url(input.sourceUrl, `entries[${index}].sourceUrl`, false),
    requestedPermissions: Object.freeze(permissions),
    publishedAt: timestamp(input.publishedAt, `entries[${index}].publishedAt`),
    revoked: input.revoked,
  });
}

export function verifyHomiModuleDirectory(
  rawEnvelope: unknown,
  trustedPublicKeys: ReadonlyMap<string, string>,
): HomiVerifiedModuleDirectory {
  const envelope = object(rawEnvelope, "directory envelope");
  exactKeys(envelope, "directory envelope", ["payload", "signature"]);
  const payload = string(envelope.payload, "payload");
  const signature = object(envelope.signature, "signature");
  exactKeys(signature, "signature", ["algorithm", "keyId", "value"]);
  if (signature.algorithm !== "ed25519") {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_SIGNATURE_INVALID", "Only Ed25519 directory signatures are accepted.");
  }
  const keyId = string(signature.keyId, "signature.keyId", KEY);
  const publicKey = trustedPublicKeys.get(keyId);
  if (!publicKey) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_KEY_UNTRUSTED", `Directory signing key '${keyId}' is not trusted.`);
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(string(signature.value, "signature.value"), "base64");
    if (signatureBytes.length !== 64) throw new Error("invalid length");
  } catch (error) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_SIGNATURE_INVALID", "Directory signature is not valid base64 Ed25519 data.", { cause: error });
  }
  let verified = false;
  try {
    verified = verify(null, Buffer.from(payload, "utf8"), createPublicKey(publicKey), signatureBytes);
  } catch (error) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_KEY_INVALID", "Trusted directory public key is invalid.", { cause: error });
  }
  if (!verified) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_SIGNATURE_INVALID", "Directory signature verification failed.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch (error) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", "Signed directory payload is not valid JSON.", { cause: error });
  }
  const catalog = object(decoded, "payload");
  exactKeys(catalog, "payload", ["schemaVersion", "generatedAt", "entries"]);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", "Directory schema version or entries are invalid.");
  }
  const entries = catalog.entries.map(parseEntry);
  const keys = entries.map((entry) => entry.moduleKey);
  if (new Set(keys).size !== keys.length) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_INVALID", "Directory contains duplicate module keys.");
  }
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: timestamp(catalog.generatedAt, "generatedAt"),
    entries: Object.freeze(entries),
    keyId,
  });
}

export interface HomiModuleDirectoryService {
  list(): Promise<HomiVerifiedModuleDirectory>;
}

export function createHomiModuleDirectoryService(options: {
  readonly directoryUrl: string;
  readonly trustedPublicKeys: ReadonlyMap<string, string>;
  readonly githubToken?: string;
  readonly fetch?: typeof fetch;
}): HomiModuleDirectoryService {
  const endpoint = new URL(options.directoryUrl);
  if (endpoint.protocol !== "https:" || !GITHUB_HOSTS.has(endpoint.hostname)) {
    throw new HomiModuleDirectoryError("MODULE_DIRECTORY_UNTRUSTED_URL", "Directory URL must use HTTPS on an approved GitHub host.");
  }
  const fetcher = options.fetch ?? fetch;
  return Object.freeze({
    async list(): Promise<HomiVerifiedModuleDirectory> {
      const response = await fetchGitHubReleaseAsset({
        url: endpoint,
        ...(options.githubToken
          ? { token: options.githubToken }
          : {}),
        fetcher,
      });
      if (!response.ok) {
        throw new HomiModuleDirectoryError("MODULE_DIRECTORY_UNAVAILABLE", `Directory request failed with HTTP ${response.status}.`);
      }
      return verifyHomiModuleDirectory(await response.json(), options.trustedPublicKeys);
    },
  });
}

export function signHomiModuleDirectory(options: {
  readonly payload: string;
  readonly privateKey: string;
  readonly keyId: string;
}): HomiSignedModuleDirectoryEnvelope {
  const payload = string(options.payload, "payload");
  const keyId = string(options.keyId, "keyId", KEY);

  let privateKeyObj;
  try {
    privateKeyObj = createPrivateKey(options.privateKey);
  } catch (error) {
    throw new HomiModuleDirectoryError(
      "MODULE_DIRECTORY_KEY_INVALID",
      "Directory signing private key is invalid.",
      { cause: error },
    );
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = sign(null, Buffer.from(payload, "utf8"), privateKeyObj);
  } catch (error) {
    throw new HomiModuleDirectoryError(
      "MODULE_DIRECTORY_SIGNATURE_FAILED",
      "Failed to generate directory signature.",
      { cause: error },
    );
  }

  return Object.freeze({
    payload,
    signature: Object.freeze({
      algorithm: "ed25519",
      keyId,
      value: signatureBytes.toString("base64"),
    }),
  });
}
