import { generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  packHomiModuleArchive,
  unpackHomiModuleArchive,
} from "./module-archive.js";
import {
  HomiModuleDirectoryError,
  signHomiModuleDirectory,
  verifyHomiModuleDirectory,
} from "./module-directory.js";
import { HomiModulePackageError } from "./module-package.js";

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  module-package-cli pack <package-directory> [--output=<archive-file>]",
      "  module-package-cli unpack <archive-file> <destination-directory>",
      "  module-package-cli generate-test-key [--out-prefix=<prefix>]",
      "  module-package-cli sign-directory <catalogue-file> --key-file=<private-key-file> --key-id=<key-id> [--output=<envelope-file>]",
      "  module-package-cli verify-directory <envelope-file> --key-file=<public-key-file> --key-id=<key-id>",
    ].join("\n"),
  );
}

function parseNamedArg(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of args) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim();
    }
  }
  return undefined;
}

function parsePositionalArgs(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith("--"));
}

const [, , command, ...args] = process.argv;

try {
  if (command === "pack") {
    const positional = parsePositionalArgs(args);
    const packageDirectory = positional[0];
    const outputArchiveFile = parseNamedArg(args, "output") ?? positional[1];

    if (!packageDirectory) usage();

    const result = await packHomiModuleArchive({
      sourceDirectory: resolve(packageDirectory),
      ...(outputArchiveFile ? { outputArchiveFile: resolve(outputArchiveFile) } : {}),
    });

    console.log(JSON.stringify({
      action: "pack",
      ...result,
    }, null, 2));
  } else if (command === "unpack") {
    const positional = parsePositionalArgs(args);
    const archiveFile = positional[0];
    const destinationDirectory = positional[1];

    if (!archiveFile || !destinationDirectory) usage();

    const result = await unpackHomiModuleArchive(
      resolve(archiveFile),
      resolve(destinationDirectory),
    );

    console.log(JSON.stringify({
      action: "unpack",
      ...result,
    }, null, 2));
  } else if (command === "generate-test-key") {
    const outPrefix = parseNamedArg(args, "out-prefix") ?? parsePositionalArgs(args)[0];
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
    const publicPem = publicKey.export({ type: "spki", format: "pem" });

    if (outPrefix) {
      const privateKeyPath = resolve(`${outPrefix}.private.pem`);
      const publicKeyPath = resolve(`${outPrefix}.public.pem`);
      await writeFile(privateKeyPath, privatePem, { mode: 0o600 });
      await writeFile(publicKeyPath, publicPem, { mode: 0o644 });
      console.log(JSON.stringify({
        action: "generate-test-key",
        note: "Test key pair for local testing and development only.",
        privateKeyPath,
        publicKeyPath,
      }, null, 2));
    } else {
      console.log(JSON.stringify({
        action: "generate-test-key",
        note: "Test key pair for local testing and development only.",
        privateKey: String(privatePem),
        publicKey: String(publicPem),
      }, null, 2));
    }
  } else if (command === "sign-directory") {
    const catalogueFile = parsePositionalArgs(args)[0];
    const keyFile = parseNamedArg(args, "key-file");
    const keyId = parseNamedArg(args, "key-id");
    const outputFile = parseNamedArg(args, "output");

    if (!catalogueFile || !keyFile || !keyId) usage();

    const payload = await readFile(resolve(catalogueFile), "utf8");
    const privateKey = await readFile(resolve(keyFile), "utf8");

    const envelope = signHomiModuleDirectory({
      payload,
      privateKey,
      keyId,
    });

    const envelopeJson = JSON.stringify(envelope, null, 2) + "\n";
    if (outputFile) {
      const resolvedOutput = resolve(outputFile);
      await writeFile(resolvedOutput, envelopeJson, "utf8");
      console.log(JSON.stringify({
        action: "sign-directory",
        keyId,
        outputFile: resolvedOutput,
      }, null, 2));
    } else {
      process.stdout.write(envelopeJson);
    }
  } else if (command === "verify-directory") {
    const envelopeFile = parsePositionalArgs(args)[0];
    const keyFile = parseNamedArg(args, "key-file");
    const keyId = parseNamedArg(args, "key-id");

    if (!envelopeFile || !keyFile || !keyId) usage();

    const rawEnvelope = JSON.parse(await readFile(resolve(envelopeFile), "utf8"));
    const publicKey = await readFile(resolve(keyFile), "utf8");
    const trustedKeys = new Map([[keyId, publicKey]]);

    const verified = verifyHomiModuleDirectory(rawEnvelope, trustedKeys);

    console.log(JSON.stringify({
      action: "verify-directory",
      status: "verified",
      keyId: verified.keyId,
      generatedAt: verified.generatedAt,
      entryCount: verified.entries.length,
      entries: verified.entries.map((entry) => ({
        moduleKey: entry.moduleKey,
        version: entry.latestVersion,
        digest: entry.packageDigest,
        artifactUrl: entry.artifactUrl,
      })),
    }, null, 2));
  } else {
    usage();
  }
} catch (error) {
  const details =
    error instanceof HomiModulePackageError ||
    error instanceof HomiModuleDirectoryError
      ? {
          code: error.code,
          message: error.message,
        }
      : {
          code: "MODULE_PACKAGE_CLI_FAILED",
          message:
            error instanceof Error
              ? error.message
              : String(error),
        };

  console.error(JSON.stringify({ error: details }, null, 2));
  process.exitCode = 1;
}
