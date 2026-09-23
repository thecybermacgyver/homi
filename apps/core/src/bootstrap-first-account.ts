import { eq, sql } from "drizzle-orm";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import {
  HOMI_BETTER_AUTH_SCHEMA,
  createHomiDatabase,
  householdMemberships,
  householdPeople,
  households,
  users,
} from "@homi/db";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

const databaseUrl = requiredEnvironment("HOMI_DATABASE_URL");
const authSecret = requiredEnvironment("HOMI_AUTH_SECRET");
const email = requiredEnvironment("HOMI_BOOTSTRAP_EMAIL").toLowerCase();
const password = requiredEnvironment("HOMI_BOOTSTRAP_PASSWORD");
const displayName = requiredEnvironment("HOMI_BOOTSTRAP_NAME");
const householdName = requiredEnvironment("HOMI_BOOTSTRAP_HOUSEHOLD");
const preferredLocale =
  process.env.HOMI_BOOTSTRAP_LOCALE?.trim() || "en-CA";
const timeZone =
  process.env.HOMI_BOOTSTRAP_TIME_ZONE?.trim() || "UTC";

if (password.length < 8 || password.length > 128) {
  throw new Error(
    "HOMI_BOOTSTRAP_PASSWORD must be between 8 and 128 characters.",
  );
}

try {
  Intl.getCanonicalLocales(preferredLocale);
} catch {
  throw new Error("HOMI_BOOTSTRAP_LOCALE must be a valid locale.");
}

try {
  new Intl.DateTimeFormat("en", { timeZone }).format();
} catch {
  throw new Error("HOMI_BOOTSTRAP_TIME_ZONE must be a valid IANA timezone.");
}

const database = createHomiDatabase(databaseUrl);
const authUserTable = HOMI_BETTER_AUTH_SCHEMA.user;
const authAccountTable = HOMI_BETTER_AUTH_SCHEMA.account;
const authSessionTable = HOMI_BETTER_AUTH_SCHEMA.session;

let createdAuthUserId: string | undefined;

try {
  const [existingCoreUser] = await database.db
    .select({ id: users.id })
    .from(users)
    .limit(1);

  const [existingAuthUser] = await database.db
    .select({ id: authUserTable.id })
    .from(authUserTable)
    .limit(1);

  if (existingCoreUser || existingAuthUser) {
    throw new Error(
      "First-account bootstrap refused: Homi already contains a user.",
    );
  }

  const bootstrapAuth = betterAuth({
    appName: "Homi",
    secret: authSecret,
    baseURL: "http://127.0.0.1",
    basePath: "/api/auth",
    trustedOrigins: ["http://127.0.0.1"],
    database: drizzleAdapter(database.db, {
      provider: "pg",
      schemaName: "auth",
      schema: HOMI_BETTER_AUTH_SCHEMA,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
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

  const signup = await bootstrapAuth.api.signUpEmail({
    body: {
      name: displayName,
      email,
      password,
    },
  });

  createdAuthUserId = signup.user.id;

  const result = await database.db.transaction(async (tx) => {
    const [coreUser] = await tx
      .insert(users)
      .values({
        authSubject: createdAuthUserId!,
        displayName,
        preferredLocale,
        timeZone,
      })
      .returning({ id: users.id });

    if (!coreUser) {
      throw new Error("Failed to create the initial Homi Core user.");
    }

    const [household] = await tx
      .insert(households)
      .values({
        name: householdName,
        defaultLocale: preferredLocale,
        timeZone,
        createdByUserId: coreUser.id,
      })
      .returning({ id: households.id });

    if (!household) {
      throw new Error("Failed to create the initial Homi household.");
    }

    const [membership] = await tx
      .insert(householdMemberships)
      .values({
        householdId: household.id,
        userId: coreUser.id,
      })
      .returning({ id: householdMemberships.id });

    if (!membership) {
      throw new Error("Failed to create the initial household membership.");
    }

    const [person] = await tx
      .insert(householdPeople)
      .values({
        householdId: household.id,
        linkedMembershipId: membership.id,
        displayName,
      })
      .returning({ id: householdPeople.id });

    if (!person) {
      throw new Error("Failed to create the initial household person.");
    }

    const roleAssignment = await tx.execute(sql`
      INSERT INTO core.membership_roles (
        membership_id,
        role_id,
        granted_by_user_id
      )
      SELECT
        CAST(${membership.id} AS uuid),
        r.id,
        CAST(${coreUser.id} AS uuid)
      FROM core.roles AS r
      WHERE r.household_id IS NULL
        AND r.key = 'household-admin'
      ON CONFLICT DO NOTHING
    `);

    if (roleAssignment.rowCount !== 1) {
      throw new Error(
        "Failed to assign the initial Household Administrator role.",
      );
    }

    return {
      coreUserId: coreUser.id,
      householdId: household.id,
      membershipId: membership.id,
      householdPersonId: person.id,
    };
  });

  console.log("Homi first account bootstrap completed successfully.");
  console.log(`Email: ${email}`);
  console.log(`Core user: ${result.coreUserId}`);
  console.log(`Household: ${result.householdId}`);
  console.log(`Membership: ${result.membershipId}`);
  console.log(`Household person: ${result.householdPersonId}`);
} catch (error) {
  if (createdAuthUserId) {
    try {
      await database.db.transaction(async (tx) => {
        await tx
          .delete(authSessionTable)
          .where(eq(authSessionTable.userId, createdAuthUserId!));

        await tx
          .delete(authAccountTable)
          .where(eq(authAccountTable.userId, createdAuthUserId!));

        await tx
          .delete(authUserTable)
          .where(eq(authUserTable.id, createdAuthUserId!));
      });
    } catch (cleanupError) {
      console.error(
        "CRITICAL: Bootstrap failed and Better Auth cleanup also failed.",
        cleanupError,
      );
    }
  }

  throw error;
} finally {
  await database.close();
}
