import {
  HOMI_BETTER_AUTH_SCHEMA,
  type HomiDatabase,
} from "@homi/db";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";

export interface HomiAuthOptions {
  database: HomiDatabase["db"];
  secret: string;
  baseURL: string;
}

export const HOMI_MIN_PASSWORD_LENGTH = 10;
export const HOMI_MAX_PASSWORD_LENGTH = 128;

export interface HomiPasswordChangeResult {
  readonly status: number;
  readonly code: string | null;
  // Session cookies issued to replace the caller's revoked sessions.
  readonly setCookies: readonly string[];
}

export interface HomiAuthRuntime {
  handler(request: Request): Promise<Response>;
  getAuthSubject(headers: Headers): Promise<string | null>;
  getEmail(authSubject: string): Promise<string | null>;
  changePassword(
    headers: Headers,
    currentPassword: string,
    newPassword: string,
  ): Promise<HomiPasswordChangeResult>;
  setPassword(authSubject: string, password: string): Promise<void>;
  emailInUse(email: string): Promise<boolean>;
  // Creates a sign-in account (never through the public HTTP routes, where
  // sign-up stays disabled) and returns its auth subject.
  createUser(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<string>;
  deleteUser(authSubject: string): Promise<void>;
}

export function createHomiAuth(
  options: HomiAuthOptions,
): HomiAuthRuntime {
  if (options.secret.length < 32) {
    throw new Error("HOMI_AUTH_SECRET must be at least 32 characters.");
  }

  let authOrigin: string;

  try {
    authOrigin = new URL(options.baseURL).origin;
  } catch {
    throw new Error("HOMI_AUTH_BASE_URL must be a valid absolute URL.");
  }

  const auth = betterAuth({
    appName: "Homi",
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: "/api/auth",
    trustedOrigins: [authOrigin],
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schemaName: "auth",
      schema: HOMI_BETTER_AUTH_SCHEMA,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: HOMI_MIN_PASSWORD_LENGTH,
      maxPasswordLength: HOMI_MAX_PASSWORD_LENGTH,
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    telemetry: {
      enabled: false,
    },
  });

  return {
    handler(request) {
      return auth.handler(request);
    },

    async getAuthSubject(headers) {
      const session = await auth.api.getSession({ headers });
      return session?.user.id ?? null;
    },

    async getEmail(authSubject) {
      const context = await auth.$context;
      const user = await context.internalAdapter.findUserById(authSubject);
      return user?.email ?? null;
    },

    // Verifies the current password, stores the new one, and revokes the
    // member's other sessions while keeping this one signed in.
    async changePassword(headers, currentPassword, newPassword) {
      const response = await auth.api.changePassword({
        headers,
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        asResponse: true,
      });
      let code: string | null = null;
      if (!response.ok) {
        const body = await response.json().catch(() => null) as
          | { code?: unknown }
          | null;
        code = typeof body?.code === "string" ? body.code : "PASSWORD_CHANGE_FAILED";
      }
      return {
        status: response.status,
        code,
        setCookies: response.headers.getSetCookie(),
      };
    },

    // Administrator reset: replaces the credential password and ends every
    // session so the member must sign in with the temporary password.
    async setPassword(authSubject, password) {
      if (
        password.length < HOMI_MIN_PASSWORD_LENGTH ||
        password.length > HOMI_MAX_PASSWORD_LENGTH
      ) {
        throw new Error("Temporary password length is outside the allowed range.");
      }
      const context = await auth.$context;
      const user = await context.internalAdapter.findUserById(authSubject);
      if (!user) throw new Error("The account to reset was not found.");
      const hash = await context.password.hash(password);
      const account =
        await context.internalAdapter.findCredentialAccount(authSubject);
      if (account) {
        await context.internalAdapter.updatePassword(authSubject, hash);
      } else {
        await context.internalAdapter.createAccount({
          userId: authSubject,
          providerId: "credential",
          accountId: authSubject,
          password: hash,
        });
      }
      await context.internalAdapter.deleteUserSessions(authSubject);
    },

    async emailInUse(email) {
      const context = await auth.$context;
      return (await context.internalAdapter.findUserByEmail(email)) !== null;
    },

    async createUser({ email, name, password }) {
      if (
        password.length < HOMI_MIN_PASSWORD_LENGTH ||
        password.length > HOMI_MAX_PASSWORD_LENGTH
      ) {
        throw new Error("Temporary password length is outside the allowed range.");
      }
      const context = await auth.$context;
      const user = await context.internalAdapter.createUser(
        { email, name, emailVerified: false },
        { method: "email-password" },
      );
      const hash = await context.password.hash(password);
      await context.internalAdapter.createAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hash,
      });
      return user.id;
    },

    async deleteUser(authSubject) {
      const context = await auth.$context;
      await context.internalAdapter.deleteUser(authSubject);
    },
  };
}
