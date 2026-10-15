import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { HomiDatabase } from "@homi/db";
import type { HomiRequestContext } from "./context.js";

// Notifications are written by modules (through the notifications capability)
// into core.notifications. This service is the other half: it lets a member
// read and clear their own, and delivers each one to their devices with Web
// Push so a reminder arrives even when Homi is not open.

export interface HomiNotificationView {
  readonly id: string;
  readonly sourceModuleKey: string;
  readonly notificationType: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface HomiPushSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface HomiNotificationService {
  list(
    context: HomiRequestContext,
    limit?: number,
  ): Promise<{ items: readonly HomiNotificationView[]; unread: number }>;
  markRead(context: HomiRequestContext, id: string): Promise<boolean>;
  markAllRead(context: HomiRequestContext): Promise<number>;
  dismiss(context: HomiRequestContext, id: string): Promise<boolean>;
  publicKey(): Promise<string>;
  subscribe(
    context: HomiRequestContext,
    input: HomiPushSubscriptionInput,
  ): Promise<void>;
  unsubscribe(
    context: HomiRequestContext,
    endpoint: string,
  ): Promise<void>;
  hasSubscription(
    context: HomiRequestContext,
    endpoint: string,
  ): Promise<boolean>;
  deliverPending(): Promise<number>;
  start(): void;
  stop(): void;
}

export class HomiNotificationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiNotificationError";
  }
}

const b64u = (value: Buffer | Uint8Array): string =>
  Buffer.from(value).toString("base64url");
const fromB64u = (value: string): Buffer => Buffer.from(value, "base64url");

// ---- Web Push (RFC 8291 payload encryption, RFC 8292 VAPID) -----------------

export interface VapidKeys {
  readonly publicKey: string; // base64url, uncompressed P-256 point
  readonly privateKey: string; // base64url, 32-byte scalar
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: b64u(ecdh.getPublicKey()),
    privateKey: b64u(ecdh.getPrivateKey()),
  };
}

export function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  subject: string,
  now = Date.now(),
): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const pub = fromB64u(keys.publicKey);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

// aes128gcm content coding for a single record.
export function encryptPushPayload(
  payload: Buffer,
  userPublicKey: string,
  userAuthSecret: string,
  fixed?: { salt: Buffer; privateKey: Buffer },
): Buffer {
  const ua = fromB64u(userPublicKey);
  const auth = fromB64u(userAuthSecret);
  if (ua.length !== 65 || ua[0] !== 0x04 || auth.length !== 16) {
    throw new HomiNotificationError(400, "PUSH_SUBSCRIPTION_INVALID", "The push subscription keys are invalid.");
  }
  const server = createECDH("prime256v1");
  if (fixed) server.setPrivateKey(fixed.privateKey);
  else server.generateKeys();
  const serverPublic = server.getPublicKey();
  const shared = server.computeSecret(ua);
  const salt = fixed?.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    ua,
    serverPublic,
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the last (here the only) record.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverPublic.length, 20);
  return Buffer.concat([header, serverPublic, body]);
}

// ---- Text -----------------------------------------------------------------

function interpolate(template: string, args: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = args[name];
    return typeof value === "string" || typeof value === "number" ? String(value) : whole;
  });
}

function humanise(key: string): string {
  const last = key.split(".").pop() ?? key;
  const text = last.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface NotificationRow {
  id: string;
  householdId: string;
  userId: string;
  sourceModuleKey: string;
  notificationType: string;
  titleKey: string;
  bodyKey: string;
  arguments: Record<string, unknown>;
  data: Record<string, unknown>;
  createdAt: string | Date;
  readAt: string | Date | null;
}

const iso = (value: string | Date): string => new Date(value).toISOString();

export interface HomiNotificationServiceOptions {
  readonly database: HomiDatabase["db"];
  // Where installed modules live; used to read a module's own strings.
  readonly moduleInstallRoot?: string | undefined;
  // https URL or mailto: that identifies this server to push services.
  readonly pushSubject: string;
  readonly intervalMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (message: string, detail?: unknown) => void;
}

export function createHomiNotificationService(
  options: HomiNotificationServiceOptions,
): HomiNotificationService {
  const { database, moduleInstallRoot, pushSubject } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => undefined);
  const strings = new Map<string, Record<string, string> | null>();
  let keys: VapidKeys | null = null;
  let timer: NodeJS.Timeout | null = null;
  let busy = false;

  async function vapid(): Promise<VapidKeys> {
    if (keys) return keys;
    const existing = await database.execute(
      sql`SELECT public_key AS "publicKey", private_key AS "privateKey" FROM core.push_server_keys WHERE id = 1`,
    );
    const row = existing.rows[0] as VapidKeys | undefined;
    if (row) return (keys = row);
    const fresh = generateVapidKeys();
    // Two cores starting together must agree on one key pair.
    await database.execute(sql`
      INSERT INTO core.push_server_keys (id, public_key, private_key)
      VALUES (1, ${fresh.publicKey}, ${fresh.privateKey})
      ON CONFLICT (id) DO NOTHING`);
    const stored = await database.execute(
      sql`SELECT public_key AS "publicKey", private_key AS "privateKey" FROM core.push_server_keys WHERE id = 1`,
    );
    return (keys = stored.rows[0] as unknown as VapidKeys);
  }

  // A module's own strings, in the household's language, then English.
  async function moduleStrings(
    moduleKey: string,
    locale: string,
  ): Promise<Array<Record<string, string>>> {
    if (!moduleInstallRoot) return [];
    const meta = await database.execute(sql`
      SELECT current_version AS "version",
             manifest #>> '{localization,resources}' AS "resources"
      FROM core.modules WHERE module_key = ${moduleKey} LIMIT 1`);
    const row = meta.rows[0] as { version: string | null; resources: string | null } | undefined;
    if (!row?.version || !row.resources || !/^\.\/[A-Za-z0-9_./-]+$/.test(row.resources) || row.resources.includes("..")) {
      return [];
    }
    const wanted = [...new Set([locale, locale.split("-")[0] ?? "", "en"])].filter((v) => /^[A-Za-z-]{2,12}$/.test(v));
    const found: Array<Record<string, string>> = [];
    for (const name of wanted) {
      const cacheKey = `${moduleKey}@${row.version}/${name}`;
      if (!strings.has(cacheKey)) {
        try {
          const file = resolve(moduleInstallRoot, moduleKey, row.version, row.resources, `${name}.json`);
          const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
          strings.set(
            cacheKey,
            typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
              ? (parsed as Record<string, string>)
              : null,
          );
        } catch {
          strings.set(cacheKey, null);
        }
      }
      const entry = strings.get(cacheKey);
      if (entry) found.push(entry);
    }
    return found;
  }

  async function render(row: NotificationRow, locale: string) {
    const catalogues = await moduleStrings(row.sourceModuleKey, locale);
    const lookup = (key: string): string | undefined => {
      for (const c of catalogues) if (typeof c[key] === "string") return c[key];
      return undefined;
    };
    const args = row.arguments ?? {};
    const titleTemplate = lookup(row.titleKey);
    const bodyTemplate = lookup(row.bodyKey);
    const title = titleTemplate !== undefined
      ? interpolate(titleTemplate, args)
      : typeof args.title === "string" && args.title !== ""
        ? args.title
        : humanise(row.titleKey);
    const body = bodyTemplate !== undefined
      ? interpolate(bodyTemplate, args)
      : typeof args.body === "string"
        ? args.body
        : "";
    return { title, body };
  }

  async function householdLocale(householdId: string): Promise<string> {
    const result = await database.execute(
      sql`SELECT default_locale AS "locale" FROM core.households WHERE id = ${householdId}::uuid`,
    );
    return (result.rows[0] as { locale?: string } | undefined)?.locale ?? "en";
  }

  function view(row: NotificationRow, text: { title: string; body: string }): HomiNotificationView {
    return Object.freeze({
      id: row.id,
      sourceModuleKey: row.sourceModuleKey,
      notificationType: row.notificationType,
      title: text.title,
      body: text.body,
      data: row.data ?? {},
      createdAt: iso(row.createdAt),
      readAt: row.readAt === null ? null : iso(row.readAt),
    });
  }

  const SELECT = sql`
    n.id::text AS "id", n.household_id::text AS "householdId", n.user_id::text AS "userId",
    n.source_module_key AS "sourceModuleKey", n.notification_type AS "notificationType",
    n.title_key AS "titleKey", n.body_key AS "bodyKey", n.arguments AS "arguments", n.data AS "data",
    n.created_at AS "createdAt", n.read_at AS "readAt"`;

  async function push(row: NotificationRow, subscription: { id: string; endpoint: string; p256dh: string; auth: string }, payload: Buffer) {
    const k = await vapid();
    const response = await doFetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(k, subscription.endpoint, pushSubject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "normal",
        Topic: row.id.replaceAll("-", "").slice(0, 32),
      },
      body: new Uint8Array(encryptPushPayload(payload, subscription.p256dh, subscription.auth)),
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  }

  const service: HomiNotificationService = {
    async list(context, limit = 50) {
      const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
      const locale = await householdLocale(context.householdId);
      const rows = await database.execute(sql`
        SELECT ${SELECT}
        FROM core.notifications AS n
        WHERE n.user_id = ${context.userId}::uuid
          AND n.household_id = ${context.householdId}::uuid
          AND n.dismissed_at IS NULL
          AND (n.expires_at IS NULL OR n.expires_at > now())
        ORDER BY n.created_at DESC, n.id
        LIMIT ${bounded}`);
      const unread = await database.execute(sql`
        SELECT count(*)::int AS "count" FROM core.notifications
        WHERE user_id = ${context.userId}::uuid AND household_id = ${context.householdId}::uuid
          AND dismissed_at IS NULL AND read_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())`);
      const items: HomiNotificationView[] = [];
      for (const raw of rows.rows as unknown as NotificationRow[]) {
        items.push(view(raw, await render(raw, locale)));
      }
      return {
        items,
        unread: (unread.rows[0] as { count: number } | undefined)?.count ?? 0,
      };
    },

    async markRead(context, id) {
      const result = await database.execute(sql`
        UPDATE core.notifications
        SET read_at = COALESCE(read_at, now()), revision = revision + 1
        WHERE id = ${id}::uuid AND user_id = ${context.userId}::uuid
          AND household_id = ${context.householdId}::uuid
        RETURNING id`);
      return result.rows.length > 0;
    },

    async markAllRead(context) {
      const result = await database.execute(sql`
        UPDATE core.notifications
        SET read_at = now(), revision = revision + 1
        WHERE user_id = ${context.userId}::uuid AND household_id = ${context.householdId}::uuid
          AND read_at IS NULL AND dismissed_at IS NULL
        RETURNING id`);
      return result.rows.length;
    },

    async dismiss(context, id) {
      const result = await database.execute(sql`
        UPDATE core.notifications
        SET dismissed_at = now(), read_at = COALESCE(read_at, now()), revision = revision + 1
        WHERE id = ${id}::uuid AND user_id = ${context.userId}::uuid
          AND household_id = ${context.householdId}::uuid
        RETURNING id`);
      return result.rows.length > 0;
    },

    async publicKey() {
      return (await vapid()).publicKey;
    },

    async subscribe(context, input) {
      let origin: URL;
      try {
        origin = new URL(input.endpoint);
      } catch {
        throw new HomiNotificationError(400, "PUSH_SUBSCRIPTION_INVALID", "The push endpoint is invalid.");
      }
      if (origin.protocol !== "https:") {
        throw new HomiNotificationError(400, "PUSH_SUBSCRIPTION_INVALID", "The push endpoint must be https.");
      }
      if (fromB64u(input.p256dh).length !== 65 || fromB64u(input.auth).length !== 16) {
        throw new HomiNotificationError(400, "PUSH_SUBSCRIPTION_INVALID", "The push subscription keys are invalid.");
      }
      // A browser's endpoint is unique; if it moved to another member, it
      // now belongs to whoever signed in on it.
      await database.execute(sql`
        INSERT INTO core.push_subscriptions (user_id, client_id, endpoint, p256dh, auth)
        VALUES (${context.userId}::uuid,
                ${context.clientId ?? null}::uuid,
                ${input.endpoint}, ${input.p256dh}, ${input.auth})
        ON CONFLICT (endpoint) DO UPDATE
          SET user_id = EXCLUDED.user_id, client_id = EXCLUDED.client_id,
              p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, revoked_at = NULL`);
    },

    async unsubscribe(context, endpoint) {
      await database.execute(sql`
        UPDATE core.push_subscriptions SET revoked_at = now()
        WHERE endpoint = ${endpoint} AND user_id = ${context.userId}::uuid AND revoked_at IS NULL`);
    },

    async hasSubscription(context, endpoint) {
      const result = await database.execute(sql`
        SELECT 1 FROM core.push_subscriptions
        WHERE endpoint = ${endpoint} AND user_id = ${context.userId}::uuid AND revoked_at IS NULL`);
      return result.rows.length > 0;
    },

    // Pushes every notification not yet pushed. Each is claimed first so that
    // two cores never send the same one, then marked whatever happens: a
    // reminder that cannot be delivered is still in the inbox.
    async deliverPending() {
      const claimed = await database.execute(sql`
        UPDATE core.notifications AS n
        SET push_sent_at = now()
        WHERE n.id IN (
          SELECT id FROM core.notifications
          WHERE push_sent_at IS NULL AND dismissed_at IS NULL
            AND created_at > now() - interval '1 day'
          ORDER BY created_at
          LIMIT 50
          FOR UPDATE SKIP LOCKED)
        RETURNING ${SELECT}`);
      // Anything older than a day is closed off without a push.
      await database.execute(sql`
        UPDATE core.notifications SET push_sent_at = now()
        WHERE push_sent_at IS NULL AND created_at <= now() - interval '1 day'`);
      let sent = 0;
      for (const raw of claimed.rows as unknown as NotificationRow[]) {
        const subs = await database.execute(sql`
          SELECT id::text AS "id", endpoint, p256dh, auth
          FROM core.push_subscriptions
          WHERE user_id = ${raw.userId}::uuid AND revoked_at IS NULL`);
        if (subs.rows.length === 0) continue;
        const text = await render(raw, await householdLocale(raw.householdId));
        const payload = Buffer.from(
          JSON.stringify({
            title: text.title,
            body: text.body,
            tag: raw.id,
            url: "/",
            moduleKey: raw.sourceModuleKey,
          }),
        );
        for (const sub of subs.rows as unknown as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
          try {
            const status = await push(raw, sub, payload);
            if (status === 404 || status === 410) {
              await database.execute(sql`UPDATE core.push_subscriptions SET revoked_at = now() WHERE id = ${sub.id}::uuid`);
            } else if (status >= 200 && status < 300) {
              sent += 1;
              await database.execute(sql`UPDATE core.push_subscriptions SET last_used_at = now() WHERE id = ${sub.id}::uuid`);
            } else {
              log("push service refused a notification", { status });
            }
          } catch (error) {
            log("push delivery failed", { message: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      return sent;
    },

    start() {
      if (timer) return;
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          await service.deliverPending();
        } catch (error) {
          log("notification delivery tick failed", { message: error instanceof Error ? error.message : String(error) });
        } finally {
          busy = false;
        }
      };
      timer = setInterval(() => void tick(), options.intervalMs ?? 10_000);
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
  return Object.freeze(service);
}
