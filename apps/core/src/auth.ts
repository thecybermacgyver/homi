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

export interface HomiAuthRuntime {
  handler(request: Request): Promise<Response>;
  getAuthSubject(headers: Headers): Promise<string | null>;
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
  };
}
