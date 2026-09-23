import {
  readFile,
  stat,
} from "node:fs/promises";
import {
  dirname,
  extname,
  relative,
  resolve,
} from "node:path";
import { sql } from "drizzle-orm";
import type { HomiDatabase } from "@homi/db";
import {
  HOMI_MODULE_API_VERSION,
  assertHomiModuleCompatibility,
  parseHomiModuleManifest,
} from "@homi/module-sdk";

const MODULE_KEY = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const CONTENT_TYPES = new Map<string, string>([
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

interface ModuleAssetRegistryRow {
  readonly state: string;
  readonly currentVersion: string;
  readonly manifest: unknown;
  readonly activeVersion: string | null;
}

export interface HomiModuleAsset {
  readonly body: Buffer;
  readonly contentType: string;
}

export interface HomiModuleAssetService {
  read(
    moduleKey: string,
    version: string,
    assetPath: string,
  ): Promise<HomiModuleAsset>;
}

export class HomiModuleAssetError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HomiModuleAssetError";
  }
}

function notFound(message: string): never {
  throw new HomiModuleAssetError(
    404,
    "MODULE_ASSET_NOT_FOUND",
    message,
  );
}

function safeAssetPath(value: string): string {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\")
  ) {
    notFound("The requested module asset does not exist.");
  }

  const parts = value.split("/");
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === "..",
    )
  ) {
    notFound("The requested module asset does not exist.");
  }

  const contentType = CONTENT_TYPES.get(
    extname(value).toLowerCase(),
  );
  if (!contentType) {
    notFound("The requested module asset type is not public.");
  }

  return value;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path === "" ||
    (!path.startsWith("..") &&
      !path.startsWith("/") &&
      !path.includes("\\"))
  );
}

export function createHomiModuleAssetService(
  database: HomiDatabase["db"],
  installRoot: string,
): HomiModuleAssetService {
  const root = resolve(installRoot);

  return Object.freeze({
    async read(
      moduleKey: string,
      version: string,
      requestedPath: string,
    ) {
      if (
        !MODULE_KEY.test(moduleKey) ||
        !VERSION.test(version)
      ) {
        notFound("The requested module asset does not exist.");
      }

      const assetPath = safeAssetPath(requestedPath);

      const result = await database.execute(sql`
        SELECT
          m.state,
          m.current_version AS "currentVersion",
          m.manifest,
          mv.version AS "activeVersion"
        FROM core.modules AS m
        LEFT JOIN core.module_versions AS mv
          ON mv.module_id = m.id
         AND mv.version = m.current_version
         AND mv.migration_state = 'applied'
         AND mv.retired_at IS NULL
        WHERE m.module_key = ${moduleKey}
        LIMIT 1
      `);

      const row = result.rows[0] as
        | ModuleAssetRegistryRow
        | undefined;

      if (
        !row ||
        row.state !== "installed" ||
        row.currentVersion !== version ||
        row.activeVersion !== version
      ) {
        notFound("The requested module asset is not active.");
      }

      let manifest;
      try {
        manifest = parseHomiModuleManifest(row.manifest);
        assertHomiModuleCompatibility(
          manifest,
          HOMI_MODULE_API_VERSION,
        );
      } catch {
        notFound("The requested module asset is incompatible.");
      }

      const webEntrypoint = manifest.entrypoints.web;
      if (!webEntrypoint) {
        notFound("The module does not provide a web entrypoint.");
      }

      const webDirectory = dirname(
        webEntrypoint.slice(2),
      );
      const allowedRoot = resolve(
        root,
        moduleKey,
        version,
        webDirectory,
      );
      const target = resolve(
        root,
        moduleKey,
        version,
        assetPath,
      );

      if (
        !inside(allowedRoot, target) ||
        target === allowedRoot
      ) {
        notFound("The requested module asset is outside the web bundle.");
      }

      const info = await stat(target).catch(() => null);
      if (!info?.isFile()) {
        notFound("The requested module asset does not exist.");
      }

      const contentType = CONTENT_TYPES.get(
        extname(target).toLowerCase(),
      );
      if (!contentType) {
        notFound("The requested module asset type is not public.");
      }

      return Object.freeze({
        body: await readFile(target),
        contentType,
      });
    },
  });
}
