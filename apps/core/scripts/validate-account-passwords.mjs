import assert from "node:assert/strict";
import { Client } from "pg";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { HOMI_BETTER_AUTH_SCHEMA, createHomiDatabase } from "@homi/db";
import { buildApp } from "../dist/app.js";
import { createHomiAuth } from "../dist/auth.js";
import { createHomiAuthorization } from "../dist/authorization.js";
import { createHomiRequestContextResolver } from "../dist/context.js";
import { createHomiAccountService } from "../dist/accounts.js";

// Self-service password change and administrator password reset against real
// PostgreSQL and Better Auth, through Core's HTTP routes.
const migratorUrl = process.env.HOMI_TEST_MIGRATOR_DATABASE_URL;
const appUrl = process.env.HOMI_TEST_APP_DATABASE_URL;
if (!migratorUrl || !appUrl) {
  throw new Error("HOMI_TEST_MIGRATOR_DATABASE_URL and HOMI_TEST_APP_DATABASE_URL are required.");
}
const BASE_URL = "http://localhost:3999";
const SECRET = "validate-account-passwords-secret-0123456789";
const HOUSEHOLD = "22222222-2222-4222-8222-222222222222";
const PASSWORDS = { admin: "admin-original-pass", member: "member-original-pass" };

const database = createHomiDatabase(appUrl);
const owner = new Client({ connectionString: migratorUrl });
await owner.connect();
await owner.query("SET ROLE homi_owner");

// Accounts are created with sign-up enabled, exactly as the bootstrap does.
const signUp = betterAuth({
  secret: SECRET, baseURL: BASE_URL,
  database: drizzleAdapter(database.db, { provider: "pg", schemaName: "auth", schema: HOMI_BETTER_AUTH_SCHEMA }),
  emailAndPassword: { enabled: true, autoSignIn: false },
  advanced: { database: { generateId: "uuid" } }, telemetry: { enabled: false },
});
const ids = {};
for (const [who, name] of [["admin", "Admin Person"], ["member", "Member Person"]]) {
  const created = await signUp.api.signUpEmail({ body: { name, email: `${who}@example.invalid`, password: PASSWORDS[who] } });
  const user = await owner.query(
    `INSERT INTO core.users (auth_subject, display_name) VALUES ($1, $2) RETURNING id::text AS id`,
    [created.user.id, name],
  );
  ids[who] = { authSubject: created.user.id, userId: user.rows[0].id };
}
await owner.query(
  `INSERT INTO core.households (id, name, default_locale, time_zone, created_by_user_id)
   VALUES ($1::uuid, 'Password Home', 'en-CA', 'America/Toronto', $2::uuid)`,
  [HOUSEHOLD, ids.admin.userId],
);
for (const who of ["admin", "member"]) {
  const membership = await owner.query(
    `INSERT INTO core.household_memberships (household_id, user_id, status)
     VALUES ($1::uuid, $2::uuid, 'active') RETURNING id::text AS id`,
    [HOUSEHOLD, ids[who].userId],
  );
  ids[who].membershipId = membership.rows[0].id;
  await owner.query(
    `INSERT INTO core.household_people (household_id, linked_membership_id, display_name, status)
     VALUES ($1::uuid, $2::uuid, $3, 'active')`,
    [HOUSEHOLD, ids[who].membershipId, who],
  );
}
await owner.query(
  `INSERT INTO core.membership_roles (membership_id, role_id, granted_by_user_id)
   SELECT $1::uuid, r.id, $2::uuid FROM core.roles r WHERE r.household_id IS NULL AND r.key = 'household-admin'`,
  [ids.admin.membershipId, ids.admin.userId],
);
await owner.query("RESET ROLE");

const auth = createHomiAuth({ database: database.db, secret: SECRET, baseURL: BASE_URL });
const provided = {
  checkDatabase: async () => {},
  auth,
  authBaseURL: BASE_URL,
  requestContext: createHomiRequestContextResolver(database.db, auth),
  authorization: createHomiAuthorization(database.db),
  accounts: createHomiAccountService(database.db, auth),
  modules: [],
};
// Services these routes never reach.
const dependencies = new Proxy(provided, {
  get: (target, key) => key in target ? target[key] : new Proxy(() => {}, { get: () => () => {} }),
});
const app = buildApp(dependencies);

function cookiesFrom(response) {
  const raw = response.headers["set-cookie"];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((cookie) => cookie.split(";")[0]).join("; ");
}
async function signIn(email, password) {
  const response = await app.inject({
    method: "POST", url: "/api/auth/sign-in/email",
    headers: { origin: BASE_URL, "content-type": "application/json" },
    payload: { email, password },
  });
  return { status: response.statusCode, cookie: cookiesFrom(response) };
}
async function call(cookie, method, url, payload) {
  const response = await app.inject({
    method, url,
    headers: { cookie, origin: BASE_URL, "x-homi-household-id": HOUSEHOLD, ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload } : {}),
  });
  const body = response.body ? JSON.parse(response.body) : null;
  return { status: response.statusCode, body, cookie: cookiesFrom(response) };
}
const code = (result) => result.body?.error?.code;

try {
  const admin = await signIn("admin@example.invalid", PASSWORDS.admin);
  const member = await signIn("member@example.invalid", PASSWORDS.member);
  assert.equal(admin.status, 200);
  assert.equal(member.status, 200);

  const members = await call(admin.cookie, "GET", "/api/v1/core/household/members");
  assert.equal(members.status, 200);
  assert.deepEqual(
    members.body.data.members.map((m) => [m.displayName, m.email, m.administrator, m.self, m.passwordChangeRequired]),
    [["Admin Person", "admin@example.invalid", true, true, false], ["Member Person", "member@example.invalid", false, false, false]],
  );
  assert.equal((await call(member.cookie, "GET", "/api/v1/core/household/members")).status, 403);
  assert.equal(code(await call(member.cookie, "POST", `/api/v1/core/household/members/${ids.admin.membershipId}/password-reset`, { temporaryPassword: "not-allowed-123" })), "PERMISSION_DENIED");

  const resetUrl = `/api/v1/core/household/members/${ids.member.membershipId}/password-reset`;
  assert.equal(code(await call(admin.cookie, "POST", resetUrl, { temporaryPassword: "short" })), "PASSWORD_LENGTH_INVALID");
  assert.equal(code(await call(admin.cookie, "POST", `/api/v1/core/household/members/${ids.admin.membershipId}/password-reset`, { temporaryPassword: "own-reset-pass" })), "OWN_PASSWORD_RESET_NOT_ALLOWED");
  const temporary = "temporary-pass-4827";
  assert.equal((await call(admin.cookie, "POST", resetUrl, { temporaryPassword: temporary })).status, 200);

  assert.equal((await call(member.cookie, "GET", "/api/v1/core/account")).status, 401, "reset must end existing sessions");
  assert.equal((await signIn("member@example.invalid", PASSWORDS.member)).status, 401, "old password must stop working");
  const temp = await signIn("member@example.invalid", temporary);
  assert.equal(temp.status, 200);
  assert.equal((await call(temp.cookie, "GET", "/api/v1/core/account")).body.data.passwordChangeRequired, true);
  assert.equal(code(await call(temp.cookie, "GET", "/api/v1/core/context")), "PASSWORD_CHANGE_REQUIRED");
  assert.equal(code(await call(temp.cookie, "GET", "/api/v1/core/permissions")), "PASSWORD_CHANGE_REQUIRED");

  const change = (cookie, currentPassword, newPassword) =>
    call(cookie, "POST", "/api/v1/core/account/password", { currentPassword, newPassword });
  assert.equal(code(await change(temp.cookie, temporary, temporary)), "PASSWORD_UNCHANGED");
  assert.equal(code(await change(temp.cookie, temporary, "too-short")), "PASSWORD_LENGTH_INVALID");
  assert.equal(code(await change(temp.cookie, "wrong-password-1", "member-chosen-pass")), "CURRENT_PASSWORD_INCORRECT");
  const chosen = "member-chosen-pass";
  const changed = await change(temp.cookie, temporary, chosen);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const renewed = changed.cookie || temp.cookie;
  assert.equal((await call(renewed, "GET", "/api/v1/core/context")).status, 200);
  assert.equal((await call(renewed, "GET", "/api/v1/core/account")).body.data.passwordChangeRequired, false);
  assert.equal((await signIn("member@example.invalid", temporary)).status, 401, "temporary password must stop working");
  assert.equal((await signIn("member@example.invalid", chosen)).status, 200);
  const afterMembers = await call(admin.cookie, "GET", "/api/v1/core/household/members");
  assert.equal(afterMembers.body.data.members.find((m) => !m.self).passwordChangeRequired, false);

  // Self-service change keeps this session and signs out the member's others.
  const adminSecond = await signIn("admin@example.invalid", PASSWORDS.admin);
  const adminChanged = await change(admin.cookie, PASSWORDS.admin, "admin-new-password");
  assert.equal(adminChanged.status, 200);
  assert.equal((await call(adminChanged.cookie || admin.cookie, "GET", "/api/v1/core/context")).status, 200);
  assert.equal((await call(adminSecond.cookie, "GET", "/api/v1/core/account")).status, 401, "other sessions must end");

  // Wrong current passwords are limited per account.
  const limited = await signIn("member@example.invalid", chosen);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(code(await change(limited.cookie, `wrong-${attempt}-password`, "another-password-1")), "CURRENT_PASSWORD_INCORRECT");
  }
  assert.equal(code(await change(limited.cookie, chosen, "another-password-1")), "PASSWORD_ATTEMPTS_EXCEEDED");

  await owner.query("SET ROLE homi_owner");
  const audit = await owner.query(
    `SELECT action, count(*)::int AS count FROM core.audit_log
     WHERE action IN ('core.member.password.reset', 'core.account.password.changed') GROUP BY action ORDER BY action`,
  );
  assert.deepEqual(audit.rows, [
    { action: "core.account.password.changed", count: 2 },
    { action: "core.member.password.reset", count: 1 },
  ]);
  console.log("PASS_CORE_ACCOUNT_PASSWORDS admin-reset=yes sessions-ended=yes forced-change=yes self-change=yes other-sessions-ended=yes rate-limited=yes audited=yes");
} finally {
  await app.close();
  await owner.end();
  await database.close();
}
