import { timingSafeEqual } from "node:crypto";
import type { HomiModuleDirectoryEntry } from "./module-directory.js";

export interface HomiManagedModuleInstallResult {
  readonly moduleKey: string;
  readonly version: string;
  readonly status: "installed" | "already-installed";
  readonly fromVersion: string | null;
  readonly packageDigest: string;
  readonly backupId: string;
}

export interface HomiManagedModuleUninstallResult {
  readonly moduleKey: string;
  readonly version: string;
  readonly backupId: string;
  readonly dataPreserved: true;
}

export interface HomiModuleManager {
  install(
    entry: HomiModuleDirectoryEntry,
  ): Promise<HomiManagedModuleInstallResult>;
  uninstall(moduleKey: string): Promise<HomiManagedModuleUninstallResult>;
}

export class HomiModuleManagerError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HomiModuleManagerError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
function bearer(secret: string): string {
  return `Bearer ${secret}`;
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function parseResult(
  value: unknown,
): HomiManagedModuleInstallResult {
  if (!isObject(value) || !isObject(value.data)) {
    throw new HomiModuleManagerError(
      502,
      "MODULE_MANAGER_INVALID_RESPONSE",
      "The module manager returned an invalid response.",
    );
  }
  const data = value.data;
  if (
    typeof data.moduleKey !== "string" ||
    typeof data.version !== "string" ||
    (data.status !== "installed" &&
      data.status !== "already-installed") ||
    (typeof data.fromVersion !== "string" &&
      data.fromVersion !== null) ||
    typeof data.packageDigest !== "string" ||
    typeof data.backupId !== "string"
  ) {
    throw new HomiModuleManagerError(
      502,
      "MODULE_MANAGER_INVALID_RESPONSE",
      "The module manager returned invalid installation data.",
    );
  }

  return Object.freeze({
    moduleKey: data.moduleKey,
    version: data.version,
    status: data.status,
    fromVersion: data.fromVersion,
    packageDigest: data.packageDigest,
    backupId: data.backupId,
  });
}

export function createHomiModuleManagerClient(options: {
  readonly endpoint: string;
  readonly secret: string;
  readonly fetch?: typeof fetch;
}): HomiModuleManager {
  const endpoint = new URL(options.endpoint);
  if (
    endpoint.protocol !== "http:" ||
    !["module-manager", "127.0.0.1", "localhost"].includes(
      endpoint.hostname,
    )
  ) {
    throw new Error(
      "HOMI_MODULE_MANAGER_URL must use internal HTTP.",
    );
  }
  if (options.secret.length < 32) {
    throw new Error(
      "HOMI_MODULE_MANAGER_SECRET must contain at least 32 characters.",
    );
  }
  const fetcher = options.fetch ?? fetch;

  return Object.freeze({
    async install(entry: HomiModuleDirectoryEntry) {
      let response: Response;
      try {
        response = await fetcher(
          new URL("/internal/modules/install", endpoint),
          {
            method: "POST",
            headers: {
              authorization: bearer(options.secret),
              "content-type": "application/json",
            },
            body: JSON.stringify({ entry }),
          },
        );
      } catch (cause) {
        throw new HomiModuleManagerError(
          503,
          "MODULE_MANAGER_UNAVAILABLE",
          "The privileged module manager is unavailable.",
          { cause },
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw new HomiModuleManagerError(
          502,
          "MODULE_MANAGER_INVALID_RESPONSE",
          "The module manager response was not JSON.",
          { cause },
        );
      }

      if (!response.ok) {
        const error =
          isObject(body) && isObject(body.error)
            ? body.error
            : undefined;
        throw new HomiModuleManagerError(
          response.status >= 400 && response.status < 600
            ? response.status
            : 502,
          typeof error?.code === "string"
            ? error.code
            : "MODULE_INSTALL_FAILED",
          typeof error?.message === "string"
            ? error.message
            : "The managed module installation failed.",
        );
      }

      const result = parseResult(body);
      if (
        result.moduleKey !== entry.moduleKey ||
        result.version !== entry.latestVersion ||
        !sameSecret(result.packageDigest, entry.packageDigest)
      ) {
        throw new HomiModuleManagerError(
          502,
          "MODULE_MANAGER_RESULT_MISMATCH",
          "The installed module does not match the signed directory entry.",
        );
      }
      return result;
    },

    async uninstall(moduleKey: string) {
      let response: Response;
      try {
        response = await fetcher(
          new URL("/internal/modules/uninstall", endpoint),
          {
            method: "POST",
            headers: {
              authorization: bearer(options.secret),
              "content-type": "application/json",
            },
            body: JSON.stringify({ moduleKey }),
          },
        );
      } catch (cause) {
        throw new HomiModuleManagerError(
          503,
          "MODULE_MANAGER_UNAVAILABLE",
          "The privileged module manager is unavailable.",
          { cause },
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw new HomiModuleManagerError(
          502,
          "MODULE_MANAGER_INVALID_RESPONSE",
          "The module manager response was not JSON.",
          { cause },
        );
      }
      if (!response.ok) {
        const error = isObject(body) && isObject(body.error)
          ? body.error
          : undefined;
        throw new HomiModuleManagerError(
          response.status,
          typeof error?.code === "string"
            ? error.code
            : "MODULE_UNINSTALL_FAILED",
          typeof error?.message === "string"
            ? error.message
            : "The managed module uninstall failed.",
        );
      }
      const data = isObject(body) && isObject(body.data)
        ? body.data
        : undefined;
      if (
        !data ||
        data.moduleKey !== moduleKey ||
        typeof data.version !== "string" ||
        typeof data.backupId !== "string" ||
        data.dataPreserved !== true
      ) {
        throw new HomiModuleManagerError(
          502,
          "MODULE_MANAGER_INVALID_RESPONSE",
          "The module manager returned invalid uninstall data.",
        );
      }
      return Object.freeze({
        moduleKey,
        version: data.version,
        backupId: data.backupId,
        dataPreserved: true as const,
      });
    },
  });
}
