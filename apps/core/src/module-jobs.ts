import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { HomiDatabase } from "@homi/db";
import type {
  HomiModuleJobHandler,
  HomiRequestContext,
} from "@homi/module-sdk";
import type { HomiRuntimeModule } from "./module-host.js";

interface ClaimedJob {
  readonly id: string;
  readonly moduleId: string;
  readonly householdId: string;
  readonly jobType: string;
  readonly payload: unknown;
  readonly context: unknown;
  readonly attemptCount: number;
}

function isContext(value: unknown): value is HomiRequestContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return (
    typeof input.requestId === "string" &&
    typeof input.userId === "string" &&
    typeof input.householdId === "string" &&
    typeof input.membershipId === "string" &&
    typeof input.householdPersonId === "string" &&
    (input.clientId === undefined || typeof input.clientId === "string") &&
    typeof input.locale === "string" &&
    typeof input.timeZone === "string"
  );
}

function isPayload(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export interface HomiModuleJobRunner {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
}

export function createHomiModuleJobRunner(
  database: HomiDatabase["db"],
  modules: readonly HomiRuntimeModule[],
  intervalMs = 1000,
): HomiModuleJobRunner {
  const handlers = new Map<
    string,
    {
      readonly module: HomiRuntimeModule;
      readonly handler: HomiModuleJobHandler;
    }
  >();

  for (const module of modules) {
    for (const handler of module.jobHandlers ?? []) {
      const key = `${module.moduleKey}:${handler.jobType}`;
      if (handlers.has(key)) {
        throw new Error(
          `Duplicate module job handler '${key}'.`,
        );
      }
      handlers.set(key, { module, handler });
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let active = false;

  async function claimOne(): Promise<
    (ClaimedJob & { readonly moduleKey: string }) | null
  > {
    const result = await database.execute(sql`
      WITH candidate AS (
        SELECT j.id
        FROM core.module_jobs AS j
        JOIN core.modules AS m
          ON m.id = j.module_id
        JOIN core.household_modules AS hm
          ON hm.module_id = j.module_id
         AND hm.household_id = j.household_id
        WHERE j.status = 'pending'
          AND j.run_at <= now()
          AND m.state = 'installed'
          AND hm.enabled = true
        ORDER BY j.run_at, j.created_at, j.id
        FOR UPDATE OF j SKIP LOCKED
        LIMIT 1
      ),
      claimed AS (
        UPDATE core.module_jobs AS j
        SET
          status = 'running',
          locked_at = now(),
          attempt_count = j.attempt_count + 1,
          updated_at = now()
        FROM candidate
        WHERE j.id = candidate.id
        RETURNING
          j.id::text AS id,
          j.module_id::text AS "moduleId",
          j.household_id::text AS "householdId",
          j.job_type AS "jobType",
          j.payload,
          j.context,
          j.attempt_count AS "attemptCount"
      )
      SELECT
        c.*,
        m.module_key AS "moduleKey"
      FROM claimed AS c
      JOIN core.modules AS m
        ON m.id = CAST(c."moduleId" AS uuid)
    `);

    return (
      result.rows[0] as
        | (ClaimedJob & { readonly moduleKey: string })
        | undefined
    ) ?? null;
  }

  async function complete(jobId: string): Promise<void> {
    await database.execute(sql`
      UPDATE core.module_jobs
      SET
        status = 'complete',
        completed_at = now(),
        locked_at = null,
        last_error = null,
        updated_at = now()
      WHERE id = CAST(${jobId} AS uuid)
        AND status = 'running'
    `);
  }

  async function fail(
    job: ClaimedJob,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error
        ? error.message.slice(0, 4000)
        : String(error).slice(0, 4000);
    if (job.attemptCount >= 5) {
      await database.execute(sql`
        UPDATE core.module_jobs
        SET
          status = 'failed',
          completed_at = now(),
          locked_at = null,
          last_error = ${message},
          updated_at = now()
        WHERE id = CAST(${job.id} AS uuid)
          AND status = 'running'
      `);
      return;
    }

    const delaySeconds = Math.min(
      3600,
      60 * 2 ** Math.max(0, job.attemptCount - 1),
    );
    const retryAt = new Date(
      Date.now() + delaySeconds * 1000,
    ).toISOString();

    await database.execute(sql`
      UPDATE core.module_jobs
      SET
        status = 'pending',
        run_at = ${retryAt}::timestamptz,
        locked_at = null,
        last_error = ${message},
        updated_at = now()
      WHERE id = CAST(${job.id} AS uuid)
        AND status = 'running'
    `);
  }

  async function tick(): Promise<void> {
    if (active) return;
    active = true;
    try {
      for (let count = 0; count < 20; count += 1) {
        const job = await claimOne();
        if (!job) break;

        const registration = handlers.get(
          `${job.moduleKey}:${job.jobType}`,
        );

        try {
          if (!registration) {
            throw new Error(
              `No handler is registered for module job '${job.moduleKey}:${job.jobType}'.`,
            );
          }
          if (!isContext(job.context)) {
            throw new Error(
              "Stored module job context is invalid.",
            );
          }
          if (!isPayload(job.payload)) {
            throw new Error(
              "Stored module job payload is invalid.",
            );
          }

          const context: HomiRequestContext = {
            ...job.context,
            requestId: randomUUID(),
          };
          await registration.handler.handle(
            context,
            job.payload,
          );
          await complete(job.id);
        } catch (error) {
          await fail(job, error);
        }
      }
    } finally {
      active = false;
    }
  }

  return Object.freeze({
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
      void tick();
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    tick,
  });
}
