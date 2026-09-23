import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  HOMI_MODULE_API_VERSION,
  assertHomiModuleCompatibility,
  parseHomiModuleManifest,
  type HomiModuleManifest,
} from "@homi/module-sdk";

const MAX_PACKAGE_FILES = 4_096;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MIGRATION_NAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
]);

export class HomiModulePackageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HomiModulePackageError";
    this.code = code;
  }
}

export interface HomiModuleMigration {
  readonly id: string;
  readonly absolutePath: string;
  readonly checksum: string;
  readonly sql: string;
}

export interface HomiModulePackageFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly size: number;
}

export interface HomiPreparedModulePackage {
  readonly sourceDirectory: string;
  readonly manifest: Readonly<HomiModuleManifest>;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageDigest: string;
  readonly files: readonly HomiModulePackageFile[];
  readonly migrations: readonly HomiModuleMigration[];
}

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly type: "module";
}

function normalizePackageRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function assertInsideRoot(root: string, path: string): void {
  const rel = relative(root, path);
  if (
    rel === "" ||
    (!rel.startsWith("..") && !isAbsolute(rel))
  ) {
    return;
  }

  throw new HomiModulePackageError(
    "MODULE_PACKAGE_PATH_ESCAPE",
    "A module package path escaped the package root.",
  );
}

async function readJsonFile(path: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_FILE_MISSING",
      `${label} could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_JSON_INVALID",
      `${label} is not valid JSON.`,
    );
  }
}

function parsePackageJson(value: unknown): PackageJson {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_JSON_INVALID",
      "package.json must contain an object.",
    );
  }

  const input = value as Record<string, unknown>;
  const name = input.name;
  const version = input.version;
  const type = input.type;

  if (
    typeof name !== "string" ||
    name.trim() !== name ||
    name.length === 0
  ) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_NAME_INVALID",
      "package.json name must be a non-empty trimmed string.",
    );
  }

  if (
    typeof version !== "string" ||
    version.trim() !== version ||
    version.length === 0
  ) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_VERSION_INVALID",
      "package.json version must be a non-empty trimmed string.",
    );
  }

  if (type !== "module") {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_TYPE_INVALID",
      "package.json type must be 'module'.",
    );
  }

  return Object.freeze({ name, version, type });
}

async function collectPackageFiles(
  root: string,
  directory: string,
  output: HomiModulePackageFile[],
): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  let totalBytes = 0;

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      IGNORED_DIRECTORY_NAMES.has(entry.name)
    ) {
      continue;
    }

    const absolutePath = join(directory, entry.name);
    assertInsideRoot(root, absolutePath);

    if (entry.isSymbolicLink()) {
      throw new HomiModulePackageError(
        "MODULE_PACKAGE_SYMLINK_FORBIDDEN",
        `Module packages may not contain symbolic links: ${normalizePackageRelativePath(relative(root, absolutePath))}`,
      );
    }

    if (entry.isDirectory()) {
      totalBytes += await collectPackageFiles(
        root,
        absolutePath,
        output,
      );
      if (totalBytes > MAX_PACKAGE_BYTES) {
        throw new HomiModulePackageError(
          "MODULE_PACKAGE_TOO_LARGE",
          `Module package exceeds the ${MAX_PACKAGE_BYTES} byte limit.`,
        );
      }
      continue;
    }

    if (!entry.isFile()) {
      throw new HomiModulePackageError(
        "MODULE_PACKAGE_FILE_TYPE_FORBIDDEN",
        `Unsupported package entry type: ${normalizePackageRelativePath(relative(root, absolutePath))}`,
      );
    }

    const fileStat = await stat(absolutePath);
    const relativePath = normalizePackageRelativePath(
      relative(root, absolutePath),
    );

    output.push(Object.freeze({
      relativePath,
      absolutePath,
      size: fileStat.size,
    }));
    totalBytes += fileStat.size;

    if (output.length > MAX_PACKAGE_FILES) {
      throw new HomiModulePackageError(
        "MODULE_PACKAGE_TOO_MANY_FILES",
        `Module package exceeds the ${MAX_PACKAGE_FILES} file limit.`,
      );
    }

    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new HomiModulePackageError(
        "MODULE_PACKAGE_TOO_LARGE",
        `Module package exceeds the ${MAX_PACKAGE_BYTES} byte limit.`,
      );
    }
  }

  return totalBytes;
}

async function packageDigest(
  files: readonly HomiModulePackageFile[],
): Promise<string> {
  const hash = createHash("sha256");

  for (const file of [...files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  )) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(await readFile(file.absolutePath));
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

function stripSqlCommentsAndStrings(sql: string): string {
  let output = "";
  let index = 0;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (current === "-" && next === "-") {
      output += "  ";
      index += 2;
      while (index < sql.length && sql[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "*" && sql[index + 1] === "/") {
          output += "  ";
          index += 2;
          closed = true;
          break;
        }
        output += sql[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (!closed) {
        throw new HomiModulePackageError(
          "MODULE_MIGRATION_SQL_INVALID",
          "Module migration contains an unterminated block comment.",
        );
      }
      continue;
    }

    if (current === "'") {
      output += " ";
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          output += "  ";
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          output += " ";
          index += 1;
          closed = true;
          break;
        }
        output += sql[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (!closed) {
        throw new HomiModulePackageError(
          "MODULE_MIGRATION_SQL_INVALID",
          "Module migration contains an unterminated string literal.",
        );
      }
      continue;
    }

    if (current === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
        sql.slice(index),
      );
      if (match) {
        const tag = match[0];
        output += " ".repeat(tag.length);
        index += tag.length;
        const closeAt = sql.indexOf(tag, index);
        if (closeAt < 0) {
          throw new HomiModulePackageError(
            "MODULE_MIGRATION_SQL_INVALID",
            "Module migration contains an unterminated dollar-quoted string.",
          );
        }
        while (index < closeAt) {
          output += sql[index] === "\n" ? "\n" : " ";
          index += 1;
        }
        output += " ".repeat(tag.length);
        index += tag.length;
        continue;
      }
    }

    output += current;
    index += 1;
  }

  return output;
}

export function validateModuleMigrationSql(
  sql: string,
  ownedSchema: string,
  migrationId: string,
): void {
  if (!sql.trim()) {
    throw new HomiModulePackageError(
      "MODULE_MIGRATION_EMPTY",
      `Migration '${migrationId}' is empty.`,
    );
  }

  const sanitized = stripSqlCommentsAndStrings(sql);
  const forbiddenSchema = /(?:"?(?:core|auth|jobs|public)"?)\s*\./i;
  if (forbiddenSchema.test(sanitized)) {
    throw new HomiModulePackageError(
      "MODULE_MIGRATION_SCHEMA_VIOLATION",
      `Migration '${migrationId}' references a Homi-owned schema.`,
    );
  }

  const moduleSchemaRefs =
    sanitized.match(/"?mod_[a-z0-9_]+"?\s*\./gi) ?? [];
  for (const reference of moduleSchemaRefs) {
    const normalized = reference
      .replaceAll('"', "")
      .replace(/\s*\.$/, "")
      .toLowerCase();
    if (normalized !== ownedSchema.toLowerCase()) {
      throw new HomiModulePackageError(
        "MODULE_MIGRATION_CROSS_MODULE_REFERENCE",
        `Migration '${migrationId}' references module schema '${normalized}' instead of '${ownedSchema}'.`,
      );
    }
  }

  const forbiddenStatement = new RegExp(
    [
      "\\b(?:begin|commit|rollback|savepoint)\\b",
      "\\brelease\\s+savepoint\\b",
      "\\b(?:set|reset)\\s+(?:local\\s+)?(?:role|session|search_path)\\b",
      "\\bset_config\\s*\\(",
      "\\b(?:create|alter|drop)\\s+schema\\b",
      "\\b(?:create|alter|drop)\\s+(?:role|user|database)\\b",
      "\\bcreate\\s+extension\\b",
      "\\balter\\s+system\\b",
      "\\b(?:grant|revoke)\\b",
      "\\balter\\s+default\\s+privileges\\b",
      "\\bcopy\\b",
      "\\b(?:do|call)\\b",
      "\\bcreate\\s+(?:or\\s+replace\\s+)?(?:function|procedure)\\b",
      "\\bsecurity\\s+definer\\b",
      "\\bset\\s+schema\\b",
      "\\bowner\\s+to\\b",
      "\\b(?:drop|reassign)\\s+owned\\b",
      "\\bcreate\\s+(?:foreign\\s+table|server|user\\s+mapping)\\b",
    ].join("|"),
    "i",
  );

  const statement = forbiddenStatement.exec(sanitized);
  if (statement) {
    throw new HomiModulePackageError(
      "MODULE_MIGRATION_OPERATION_FORBIDDEN",
      `Migration '${migrationId}' contains installer-owned or unsafe SQL near '${statement[0]}'.`,
    );
  }
}

async function readMigrations(
  root: string,
  manifest: Readonly<HomiModuleManifest>,
): Promise<readonly HomiModuleMigration[]> {
  if (!manifest.database) return Object.freeze([]);

  const migrationDirectory = resolve(
    root,
    manifest.database.migrations,
  );
  assertInsideRoot(root, migrationDirectory);

  let entries;
  try {
    entries = await readdir(migrationDirectory, {
      withFileTypes: true,
    });
  } catch (error) {
    throw new HomiModulePackageError(
      "MODULE_MIGRATION_DIRECTORY_MISSING",
      `Migration directory could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const unexpected = entries.filter(
    (entry) =>
      !entry.isFile() ||
      !MIGRATION_NAME.test(entry.name),
  );
  if (unexpected.length > 0) {
    throw new HomiModulePackageError(
      "MODULE_MIGRATION_FILE_INVALID",
      `Migration directory contains unsupported entry '${unexpected[0]?.name ?? "unknown"}'.`,
    );
  }

  const migrations: HomiModuleMigration[] = [];

  for (const entry of [...entries].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const absolutePath = join(migrationDirectory, entry.name);
    const sql = await readFile(absolutePath, "utf8");
    validateModuleMigrationSql(
      sql,
      manifest.database.schema,
      entry.name,
    );

    migrations.push(Object.freeze({
      id: entry.name,
      absolutePath,
      checksum: `sha256:${createHash("sha256").update(sql).digest("hex")}`,
      sql,
    }));
  }

  return Object.freeze(migrations);
}

async function assertServerRuntimeImports(
  root: string,
  packageFiles: ReadonlyMap<string, HomiModulePackageFile>,
  entrypoint: string | undefined,
): Promise<void> {
  if (entrypoint === undefined) return;
  const entryPath = resolve(root, entrypoint);
  const source = await readFile(entryPath, "utf8");
  const specifiers = new Set<string>();
  const staticImportPattern =
    /(?:^|\n)\s*(?:import\s+(?:(?:[\s\S]*?\s+from\s+)?|)|export\s+[\s\S]*?\s+from\s+)["']([^"']+)["']/g;
  const dynamicImportPattern =
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) specifiers.add(specifier);
    }
  }

  for (const specifier of specifiers) {
    if (specifier.startsWith("node:")) continue;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const target = resolve(dirname(entryPath), specifier);
      assertInsideRoot(root, target);
      const relativeTarget = normalizePackageRelativePath(
        relative(root, target),
      );
      if (!packageFiles.has(relativeTarget)) {
        throw new HomiModulePackageError(
          "MODULE_SERVER_IMPORT_MISSING",
          `Server entrypoint imports '${specifier}', but that file is not present in the prepared package.`,
        );
      }
      continue;
    }
    throw new HomiModulePackageError(
      "MODULE_SERVER_BARE_IMPORT_FORBIDDEN",
      `Server entrypoint imports bare package '${specifier}'. Managed server artifacts must be self-contained apart from Node built-ins.`,
    );
  }
}

async function assertDeclaredPathExists(
  root: string,
  packageFiles: ReadonlyMap<string, HomiModulePackageFile>,
  value: string | undefined,
  label: string,
): Promise<void> {
  if (value === undefined) return;

  const absolutePath = resolve(root, value);
  assertInsideRoot(root, absolutePath);

  const rel = normalizePackageRelativePath(relative(root, absolutePath));
  if (!packageFiles.has(rel)) {
    throw new HomiModulePackageError(
      "MODULE_ENTRYPOINT_MISSING",
      `${label} '${value}' does not exist in the prepared package.`,
    );
  }

  const entryStat = await lstat(absolutePath);
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
    throw new HomiModulePackageError(
      "MODULE_ENTRYPOINT_INVALID",
      `${label} must resolve to a regular file.`,
    );
  }
}

export async function inspectHomiModulePackage(
  sourceDirectory: string,
): Promise<HomiPreparedModulePackage> {
  const root = resolve(sourceDirectory);
  const rootStat = await lstat(root).catch(() => null);

  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_DIRECTORY_INVALID",
      "Module package source must be a real directory.",
    );
  }

  const manifest = parseHomiModuleManifest(
    await readJsonFile(
      join(root, "homi.module.json"),
      "homi.module.json",
    ),
  );
  assertHomiModuleCompatibility(
    manifest,
    HOMI_MODULE_API_VERSION,
  );

  const packageJson = parsePackageJson(
    await readJsonFile(join(root, "package.json"), "package.json"),
  );

  if (packageJson.version !== manifest.version) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_VERSION_MISMATCH",
      `package.json version '${packageJson.version}' does not match manifest version '${manifest.version}'.`,
    );
  }

  const files: HomiModulePackageFile[] = [];
  await collectPackageFiles(root, root, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const packageFiles = new Map(
    files.map((file) => [file.relativePath, file] as const),
  );

  if (!packageFiles.has("homi.module.json")) {
    throw new HomiModulePackageError(
      "MODULE_MANIFEST_MISSING",
      "Prepared package does not contain homi.module.json.",
    );
  }

  if (!packageFiles.has("package.json")) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_JSON_MISSING",
      "Prepared package does not contain package.json.",
    );
  }

  await assertDeclaredPathExists(
    root,
    packageFiles,
    manifest.entrypoints.server,
    "Server entrypoint",
  );
  await assertDeclaredPathExists(
    root,
    packageFiles,
    manifest.entrypoints.web,
    "Web entrypoint",
  );
  await assertServerRuntimeImports(
    root,
    packageFiles,
    manifest.entrypoints.server,
  );

  if (manifest.localization) {
    const localizationDirectory = resolve(
      root,
      manifest.localization.resources,
    );
    assertInsideRoot(root, localizationDirectory);
    const localizationStat = await lstat(localizationDirectory).catch(
      () => null,
    );
    if (!localizationStat?.isDirectory()) {
      throw new HomiModulePackageError(
        "MODULE_LOCALIZATION_MISSING",
        "Declared localization resource directory does not exist.",
      );
    }
  }

  const migrations = await readMigrations(root, manifest);

  return Object.freeze({
    sourceDirectory: root,
    manifest,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    packageDigest: await packageDigest(files),
    files: Object.freeze(files),
    migrations,
  });
}

export async function installPreparedModuleArtifact(
  prepared: HomiPreparedModulePackage,
  installRoot: string,
): Promise<string> {
  const root = resolve(installRoot);
  const moduleDirectory = join(root, prepared.manifest.moduleKey);
  const destination = join(
    moduleDirectory,
    prepared.manifest.version,
  );
  assertInsideRoot(root, destination);

  const existing = await lstat(destination).catch(() => null);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new HomiModulePackageError(
        "MODULE_ARTIFACT_DESTINATION_INVALID",
        "Existing module artifact destination is not a real directory.",
      );
    }

    const installed = await inspectHomiModulePackage(destination);
    if (installed.packageDigest !== prepared.packageDigest) {
      throw new HomiModulePackageError(
        "MODULE_VERSION_DIGEST_MISMATCH",
        `Module '${prepared.manifest.moduleKey}' version '${prepared.manifest.version}' already exists with a different package digest.`,
      );
    }
    return destination;
  }

  await mkdir(moduleDirectory, { recursive: true });

  const stage = join(
    moduleDirectory,
    `.staging-${randomUUID()}`,
  );
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  try {
    for (const file of prepared.files) {
      const destinationFile = join(stage, file.relativePath);
      assertInsideRoot(stage, destinationFile);
      await mkdir(dirname(destinationFile), { recursive: true });
      await copyFile(file.absolutePath, destinationFile);
    }

    const staged = await inspectHomiModulePackage(stage);
    if (staged.packageDigest !== prepared.packageDigest) {
      throw new HomiModulePackageError(
        "MODULE_ARTIFACT_DIGEST_MISMATCH",
        "Staged module artifact digest does not match the inspected package.",
      );
    }

    try {
      await rename(stage, destination);
    } catch (error) {
      const raced = await lstat(destination).catch(() => null);
      if (!raced?.isDirectory()) throw error;

      const installed = await inspectHomiModulePackage(destination);
      if (installed.packageDigest !== prepared.packageDigest) {
        throw new HomiModulePackageError(
          "MODULE_VERSION_DIGEST_MISMATCH",
          `Module '${prepared.manifest.moduleKey}' version '${prepared.manifest.version}' was installed concurrently with a different digest.`,
        );
      }
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }

  return destination;
}
