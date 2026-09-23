import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isModuleArchiveFile,
  packHomiModuleArchive,
  unpackHomiModuleArchive,
} from "./module-archive.js";
import {
  HomiModuleInstallError,
  adoptLegacyHomiModule,
  installHomiModule,
  recoverFailedHomiModuleUpdate,
} from "./module-installer.js";
import { HomiModulePackageError } from "./module-package.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  module-installer pack <package-directory> [output-archive-file]",
      "  module-installer unpack <archive-file> <destination-directory>",
      "  module-installer install <package-directory-or-archive>",
      "  module-installer adopt-legacy <prepared-package-directory>",
      "  module-installer recover <module-key> <target-version>",
      "",
      "Required environment:",
      "  HOMI_MIGRATOR_DATABASE_URL (install, adopt-legacy, recover)",
      "  HOMI_MODULES_DIRECTORY (install only)",
    ].join("\n"),
  );
}

const [, , command, ...args] = process.argv;

try {
  if (command === "pack") {
    let packageDirectory: string | undefined;
    let outputArchiveFile: string | undefined;

    for (const arg of args) {
      if (arg.startsWith("--output=")) {
        outputArchiveFile = arg.slice("--output=".length).trim();
      } else if (!packageDirectory) {
        packageDirectory = arg;
      } else if (!outputArchiveFile) {
        outputArchiveFile = arg;
      } else {
        usage();
      }
    }

    if (!packageDirectory) usage();

    const result = await packHomiModuleArchive({
      sourceDirectory: packageDirectory,
      ...(outputArchiveFile ? { outputArchiveFile } : {}),
    });

    console.log(JSON.stringify({
      action: "pack",
      ...result,
    }, null, 2));
  } else if (command === "unpack") {
    const [archiveFile, destinationDirectory, ...extra] = args;
    if (!archiveFile || !destinationDirectory || extra.length > 0) usage();

    const result = await unpackHomiModuleArchive(
      archiveFile,
      destinationDirectory,
    );

    console.log(JSON.stringify({
      action: "unpack",
      ...result,
    }, null, 2));
  } else if (command === "install") {
    const [packageSource, ...extra] = args;
    if (!packageSource || extra.length > 0) usage();

    const installRoot = requiredEnvironment(
      "HOMI_MODULES_DIRECTORY",
    );
    const databaseUrl = requiredEnvironment(
      "HOMI_MIGRATOR_DATABASE_URL",
    );

    let packageDirectory = packageSource;
    let temporaryUnpackDir: string | undefined;

    try {
      if (await isModuleArchiveFile(packageSource)) {
        temporaryUnpackDir = await mkdtemp(
          join(tmpdir(), "homi-install-archive-"),
        );
        await unpackHomiModuleArchive(packageSource, temporaryUnpackDir);
        packageDirectory = temporaryUnpackDir;
      }

      const result = await installHomiModule({
        packageDirectory,
        installRoot,
        databaseUrl,
      });

      console.log(JSON.stringify({
        action: "install",
        ...result,
      }, null, 2));
    } finally {
      if (temporaryUnpackDir) {
        await rm(temporaryUnpackDir, { recursive: true, force: true });
      }
    }
  } else if (command === "adopt-legacy") {
    const [packageDirectory, ...extra] = args;
    if (!packageDirectory || extra.length > 0) usage();

    const databaseUrl = requiredEnvironment(
      "HOMI_MIGRATOR_DATABASE_URL",
    );

    const result = await adoptLegacyHomiModule({
      packageDirectory,
      databaseUrl,
    });

    console.log(JSON.stringify({
      action: "adopt-legacy",
      ...result,
    }, null, 2));
  } else if (command === "recover") {
    const [moduleKey, targetVersion, ...extra] = args;
    if (!moduleKey || !targetVersion || extra.length > 0) {
      usage();
    }

    const databaseUrl = requiredEnvironment(
      "HOMI_MIGRATOR_DATABASE_URL",
    );

    const result = await recoverFailedHomiModuleUpdate({
      moduleKey,
      targetVersion,
      databaseUrl,
    });

    console.log(JSON.stringify({
      action: "recover",
      ...result,
    }, null, 2));
  } else {
    usage();
  }
} catch (error) {
  const details =
    error instanceof HomiModuleInstallError ||
    error instanceof HomiModulePackageError
      ? {
          code: error.code,
          message: error.message,
        }
      : {
          code: "MODULE_INSTALLER_FAILED",
          message:
            error instanceof Error
              ? error.message
              : String(error),
        };

  console.error(JSON.stringify({ error: details }, null, 2));
  process.exitCode = 1;
}
