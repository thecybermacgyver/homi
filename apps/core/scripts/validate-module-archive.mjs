import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HomiModulePackageError,
  inspectHomiModulePackage,
} from "../dist/module-package.js";
import {
  isModuleArchiveFile,
  packHomiModuleArchive,
  unpackHomiModuleArchive,
} from "../dist/module-archive.js";

const templateDirectory = fileURLToPath(
  new URL("../../../templates/homi-module-template/", import.meta.url),
);

const tempDir = await mkdtemp(join(tmpdir(), "homi-module-archive-test-"));

try {
  // 1. Inspect the original template module package
  const original = await inspectHomiModulePackage(templateDirectory);
  assert.equal(original.manifest.moduleKey, "starter");
  assert.equal(original.manifest.version, "0.1.0");
  assert.match(original.packageDigest, /^sha256:[0-9a-f]{64}$/);

  // 2. Test isModuleArchiveFile checks on non-archives
  assert.equal(await isModuleArchiveFile(templateDirectory), false);
  assert.equal(
    await isModuleArchiveFile(join(templateDirectory, "package.json")),
    false,
  );

  // 3. Pack the module archive
  const archivePath1 = join(tempDir, "starter-1.tar.gz");
  const packed1 = await packHomiModuleArchive({
    sourceDirectory: templateDirectory,
    outputArchiveFile: archivePath1,
    prepared: original,
  });

  assert.equal(packed1.archivePath, archivePath1);
  assert.equal(packed1.moduleKey, "starter");
  assert.equal(packed1.version, "0.1.0");
  assert.equal(packed1.packageDigest, original.packageDigest);
  assert.equal(packed1.fileCount, original.files.length);
  assert.match(packed1.archiveDigest, /^sha256:[0-9a-f]{64}$/);

  const archiveBytes1 = await readFile(archivePath1);
  const hash1 =
    "sha256:" + createHash("sha256").update(archiveBytes1).digest("hex");
  assert.equal(packed1.archiveDigest, hash1);
  assert.equal(await isModuleArchiveFile(archivePath1), true);

  // 4. Verify bit-for-bit reproducibility (packing again yields identical archive bytes)
  const archivePath2 = join(tempDir, "starter-2.tar.gz");
  const packed2 = await packHomiModuleArchive({
    sourceDirectory: templateDirectory,
    outputArchiveFile: archivePath2,
  });

  const archiveBytes2 = await readFile(archivePath2);
  assert.equal(Buffer.compare(archiveBytes1, archiveBytes2), 0);
  assert.equal(packed1.archiveDigest, packed2.archiveDigest);
  assert.equal(packed1.packageDigest, packed2.packageDigest);

  // 5. Unpack the module archive into a clean destination
  const unpackDir = join(tempDir, "unpacked");
  const unpacked = await unpackHomiModuleArchive(archivePath1, unpackDir);
  assert.equal(unpacked.fileCount, packed1.fileCount);
  assert.equal(unpacked.totalBytes, packed1.totalBytes);

  // 6. Inspect the unpacked package and verify that uncompressed files match original digest perfectly
  const inspectedUnpacked = await inspectHomiModulePackage(unpackDir);
  assert.equal(
    inspectedUnpacked.manifest.moduleKey,
    original.manifest.moduleKey,
  );
  assert.equal(inspectedUnpacked.manifest.version, original.manifest.version);
  assert.equal(inspectedUnpacked.packageDigest, original.packageDigest);
  assert.equal(inspectedUnpacked.files.length, original.files.length);

  // 7. Error cases
  // Non-existent archive file
  await assert.rejects(
    () =>
      unpackHomiModuleArchive(
        join(tempDir, "nonexistent.tar.gz"),
        join(tempDir, "out"),
      ),
    (error) =>
      error instanceof HomiModulePackageError &&
      error.code === "MODULE_ARCHIVE_FILE_INVALID",
  );

  // Corrupted gzip file
  const corruptFile = join(tempDir, "corrupt.tar.gz");
  await writeFile(corruptFile, Buffer.from("not-a-valid-gzip-file"));
  await assert.rejects(
    () =>
      unpackHomiModuleArchive(corruptFile, join(tempDir, "out-corrupt")),
    (error) =>
      error instanceof HomiModulePackageError &&
      error.code === "MODULE_ARCHIVE_DECOMPRESSION_FAILED",
  );

  console.log(
    "PASS_MODULE_ARCHIVE_ROUNDTRIP " +
      "deterministic=yes digest-matched=yes ustar-gz=yes",
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
