import { randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { Client } from "pg";
import { fetchGitHubReleaseAsset } from "./github-release-asset.js";
import {
  unpackHomiModuleArchive,
} from "./module-archive.js";
import {
  HomiModuleInstallError,
  installHomiModule,
} from "./module-installer.js";
import {
  HomiModulePackageError,
  inspectHomiModulePackage,
} from "./module-package.js";

const MAX_ARCHIVE_BYTES = 105 * 1024 * 1024;
const MODULE_KEY = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
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

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

interface InstallEntry {
  readonly moduleKey: string;
  readonly publisher: string;
  readonly latestVersion: string;
  readonly artifactUrl: string;
  readonly packageDigest: string;
  readonly revoked: false;
}
function parseEntry(body: unknown): InstallEntry {
  const entry =
    isObject(body) && isObject(body.entry)
      ? body.entry
      : undefined;
  if (
    !entry ||
    typeof entry.moduleKey !== "string" ||
    !MODULE_KEY.test(entry.moduleKey) ||
    typeof entry.publisher !== "string" ||
    entry.publisher.trim().length === 0 ||
    typeof entry.latestVersion !== "string" ||
    !VERSION.test(entry.latestVersion) ||
    typeof entry.artifactUrl !== "string" ||
    typeof entry.packageDigest !== "string" ||
    !DIGEST.test(entry.packageDigest) ||
    entry.revoked !== false
  ) {
    throw Object.assign(
      new Error("The signed module-directory entry is invalid."),
      { statusCode: 400, code: "MODULE_INSTALL_ENTRY_INVALID" },
    );
  }

  const url = new URL(entry.artifactUrl);
  if (
    url.protocol !== "https:" ||
    !["github.com", "objects.githubusercontent.com"].includes(
      url.hostname,
    )
  ) {
    throw Object.assign(
      new Error("The module artifact URL is not trusted."),
      { statusCode: 400, code: "MODULE_INSTALL_URL_UNTRUSTED" },
    );
  }

  return Object.freeze({
    moduleKey: entry.moduleKey,
    publisher: entry.publisher,
    latestVersion: entry.latestVersion,
    artifactUrl: url.toString(),
    packageDigest: entry.packageDigest,
    revoked: false,
  });
}

async function download(
  entry: InstallEntry,
  githubToken: string | undefined,
): Promise<Buffer> {
  const response = await fetchGitHubReleaseAsset({
    url: new URL(entry.artifactUrl),
    ...(githubToken ? { token: githubToken } : {}),
  });
  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Module download failed with HTTP ${response.status}.`,
      ),
      { statusCode: 502, code: "MODULE_DOWNLOAD_FAILED" },
    );
  }

  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number(contentLength) > MAX_ARCHIVE_BYTES
  ) {
    throw Object.assign(
      new Error("The module archive exceeds the size limit."),
      { statusCode: 413, code: "MODULE_ARCHIVE_TOO_LARGE" },
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_ARCHIVE_BYTES) {
    throw Object.assign(
      new Error("The module archive has an invalid size."),
      { statusCode: 413, code: "MODULE_ARCHIVE_TOO_LARGE" },
    );
  }
  return bytes;
}

async function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 8_000) stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(
        new Error(
          `${command} exited with ${code}: ${stderr.trim()}`,
        ),
      );
    });
  });
}

async function createBackup(options: {
  readonly backupsRoot: string;
  readonly installRoot: string;
  readonly databaseUrl: string;
  readonly operation: "install" | "uninstall";
  readonly moduleKey: string;
  readonly targetVersion?: string;
  readonly packageDigest?: string;
}): Promise<string> {
  const backupId =
    new Date().toISOString().replace(/[-:.TZ]/g, "") +
    "-" +
    randomUUID().slice(0, 8);
  const root = join(options.backupsRoot, backupId);
  await mkdir(root, { recursive: false });
  const database = new URL(options.databaseUrl);
  const password = decodeURIComponent(database.password);
  const username = decodeURIComponent(database.username);
  const databaseName = database.pathname.slice(1);
  const port = database.port || "5432";

  await run(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--host",
      database.hostname,
      "--port",
      port,
      "--username",
      username,
      "--file",
      join(root, "database.dump"),
      databaseName,
    ],
    { ...process.env, PGPASSWORD: password },
  );

  await cp(options.installRoot, join(root, "modules"), {
    recursive: true,
    force: false,
  });
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(
      {
        backupId,
        createdAt: new Date().toISOString(),
        reason: `pre-module-${options.operation}`,
        moduleKey: options.moduleKey,
        ...(options.targetVersion
          ? { targetVersion: options.targetVersion }
          : {}),
        ...(options.packageDigest
          ? { packageDigest: options.packageDigest }
          : {}),
      },
      null,
      2,
    ) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );

  const dump = await stat(join(root, "database.dump"));
  if (dump.size < 1) {
    throw new Error("The pre-module-change database backup is empty.");
  }
  return backupId;
}

const host = process.env.HOMI_MODULE_MANAGER_HOST ?? "0.0.0.0";
const port = Number.parseInt(
  process.env.HOMI_MODULE_MANAGER_PORT ?? "3002",
  10,
);
const secret = required("HOMI_MODULE_MANAGER_SECRET");
const databaseUrl = required("HOMI_MIGRATOR_DATABASE_URL");
const backupDatabaseUrl = required("HOMI_BACKUP_DATABASE_URL");
const installRoot = required("HOMI_MODULES_DIRECTORY");
const backupsRoot = required("HOMI_MODULE_BACKUPS_DIRECTORY");
const githubToken = process.env.HOMI_GITHUB_TOKEN?.trim();

if (secret.length < 32) {
  throw new Error(
    "HOMI_MODULE_MANAGER_SECRET must contain at least 32 characters.",
  );
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("HOMI_MODULE_MANAGER_PORT is invalid.");
}

await mkdir(installRoot, { recursive: true });
await mkdir(backupsRoot, { recursive: true });

const app = Fastify({ logger: true });
app.get("/health/live", async () => ({
  status: "ok",
  service: "homi-module-manager",
}));

app.post("/internal/modules/install", async (request, reply) => {
  const authorization = request.headers.authorization ?? "";
  if (!equal(authorization, `Bearer ${secret}`)) {
    return reply.code(401).send({
      error: {
        code: "MODULE_MANAGER_UNAUTHORIZED",
        message: "Module manager authentication failed.",
      },
    });
  }

  let temporaryRoot: string | undefined;
  try {
    const entry = parseEntry(request.body);
    const archive = await download(entry, githubToken);
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "homi-directory-install-"),
    );
    const archivePath = join(temporaryRoot, "module.homi-module");
    const packageDirectory = join(temporaryRoot, "package");
    await writeFile(archivePath, archive, { mode: 0o600 });
    await unpackHomiModuleArchive(archivePath, packageDirectory);

    const prepared =
      await inspectHomiModulePackage(packageDirectory);
    if (
      prepared.manifest.moduleKey !== entry.moduleKey ||
      prepared.manifest.publisher !== entry.publisher ||
      prepared.manifest.version !== entry.latestVersion ||
      !equal(prepared.packageDigest, entry.packageDigest)
    ) {
      throw Object.assign(
        new Error(
          "The downloaded package does not match the signed directory.",
        ),
        { statusCode: 409, code: "MODULE_PACKAGE_MISMATCH" },
      );
    }
    const backupId = await createBackup({
      backupsRoot,
      installRoot,
      databaseUrl: backupDatabaseUrl,
      operation: "install",
      moduleKey: entry.moduleKey,
      targetVersion: entry.latestVersion,
      packageDigest: entry.packageDigest,
    });
    const result = await installHomiModule({
      packageDirectory,
      installRoot,
      databaseUrl,
    });

    return {
      data: {
        moduleKey: result.moduleKey,
        version: result.version,
        status: result.status,
        fromVersion: result.fromVersion,
        packageDigest: result.packageDigest,
        backupId,
      },
    };
  } finally {
    if (temporaryRoot) {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  }
});

app.post("/internal/modules/uninstall", async (request, reply) => {
  const authorization = request.headers.authorization ?? "";
  if (!equal(authorization, `Bearer ${secret}`)) {
    return reply.code(401).send({
      error: {
        code: "MODULE_MANAGER_UNAUTHORIZED",
        message: "Module manager authentication failed.",
      },
    });
  }

  const moduleKey =
    isObject(request.body) && typeof request.body.moduleKey === "string"
      ? request.body.moduleKey
      : "";
  if (!MODULE_KEY.test(moduleKey)) {
    throw Object.assign(new Error("The module key is invalid."), {
      statusCode: 400,
      code: "MODULE_UNINSTALL_INVALID_INPUT",
    });
  }

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    await client.query("SET ROLE homi_owner");
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      `homi-module:${moduleKey}`,
    ]);
    const moduleResult = await client.query<{
      id: string;
      current_version: string;
    }>(
      `SELECT id, current_version
       FROM core.modules
       WHERE module_key = $1
       FOR UPDATE`,
      [moduleKey],
    );
    const installed = moduleResult.rows[0];
    if (!installed) {
      throw Object.assign(new Error("The module is not installed."), {
        statusCode: 404,
        code: "MODULE_NOT_INSTALLED",
      });
    }
    const enabledResult = await client.query<{ enabled: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM core.household_modules
         WHERE module_id = $1::uuid AND enabled = true
       ) AS enabled`,
      [installed.id],
    );
    if (enabledResult.rows[0]?.enabled) {
      throw Object.assign(
        new Error("Disable this module before uninstalling it."),
        { statusCode: 409, code: "MODULE_UNINSTALL_ENABLED" },
      );
    }

    const backupId = await createBackup({
      backupsRoot,
      installRoot,
      databaseUrl: backupDatabaseUrl,
      operation: "uninstall",
      moduleKey,
      targetVersion: installed.current_version,
    });
    await client.query(
      `UPDATE core.modules
       SET state = 'disabled', updated_at = now()
       WHERE id = $1::uuid`,
      [installed.id],
    );
    await rm(join(installRoot, moduleKey, installed.current_version), {
      recursive: true,
      force: true,
    });

    return {
      data: {
        moduleKey,
        version: installed.current_version,
        backupId,
        dataPreserved: true,
      },
    };
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext($1))",
      [`homi-module:${moduleKey}`],
    ).catch(() => undefined);
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const known =
    error instanceof HomiModuleInstallError ||
    error instanceof HomiModulePackageError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error);
  const code =
    known && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "MODULE_INSTALL_FAILED";
  const status =
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
  return reply.code(status).send({
    error: {
      code,
      message:
        status < 500 && error instanceof Error
          ? error.message
          : "The managed module operation failed.",
    },
  });
});

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
await app.listen({ host, port });
