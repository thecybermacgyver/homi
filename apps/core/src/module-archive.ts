import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  HomiModulePackageError,
  inspectHomiModulePackage,
  type HomiPreparedModulePackage,
} from "./module-package.js";

const MAX_PACKAGE_FILES = 4_096;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const TAR_BLOCK_SIZE = 512;
const USTAR_MAGIC = "ustar\0";
const USTAR_VERSION = "00";

export interface HomiPackedModuleArchive {
  readonly archivePath: string;
  readonly archiveDigest: string;
  readonly packageDigest: string;
  readonly moduleKey: string;
  readonly version: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export interface HomiUnpackedModuleArchive {
  readonly destinationDirectory: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

interface ParsedUstarHeader {
  readonly relativePath: string;
  readonly size: number;
  readonly typeflag: string;
}

function normalizeRelativePath(value: string): string {
  const parts = value.split(sep).join("/").replace(/^\/+/, "");
  if (parts.startsWith("./")) return parts.slice(2);
  return parts;
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
    "A module package path escaped the destination root.",
  );
}

function createUstarHeader(relativePath: string, size: number): Buffer {
  const buf = Buffer.alloc(TAR_BLOCK_SIZE, 0);

  let nameField = relativePath;
  let prefixField = "";
  if (relativePath.length > 100) {
    if (relativePath.length > 255) {
      throw new HomiModulePackageError(
        "MODULE_PACKAGE_PATH_TOO_LONG",
        `Relative path '${relativePath}' exceeds the 255-character ustar limit.`,
      );
    }
    const slashIndex = relativePath.lastIndexOf("/", 155);
    if (
      slashIndex < 0 ||
      relativePath.length - slashIndex - 1 > 100
    ) {
      throw new HomiModulePackageError(
        "MODULE_PACKAGE_PATH_TOO_LONG",
        `Relative path '${relativePath}' cannot be split into ustar prefix and name fields.`,
      );
    }
    prefixField = relativePath.slice(0, slashIndex);
    nameField = relativePath.slice(slashIndex + 1);
  }

  // 0: name (100)
  buf.write(nameField, 0, 100, "utf8");
  // 100: mode (8) - standard file permissions 0o644
  buf.write("0000644\0", 100, 8, "ascii");
  // 108: uid (8) - normalized to 0
  buf.write("0000000\0", 108, 8, "ascii");
  // 116: gid (8) - normalized to 0
  buf.write("0000000\0", 116, 8, "ascii");
  // 124: size (12) - octal string, 11 digits + null
  buf.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  // 136: mtime (12) - fixed epoch 0 for bit-for-bit reproducible archives
  buf.write("00000000000\0", 136, 12, "ascii");
  // 156: typeflag (1) - '0' for regular file
  buf.write("0", 156, 1, "ascii");
  // 257: magic (6) - "ustar\0"
  buf.write(USTAR_MAGIC, 257, 6, "ascii");
  // 263: version (2) - "00"
  buf.write(USTAR_VERSION, 263, 2, "ascii");
  // 345: prefix (155)
  if (prefixField) {
    buf.write(prefixField, 345, 155, "utf8");
  }

  // 148: chksum (8) - calculated with bytes 148-155 filled with ASCII spaces
  buf.fill(0x20, 148, 156);
  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i += 1) {
    checksum += buf[i] ?? 0;
  }
  buf.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

  return buf;
}

function parseUstarHeader(block: Buffer): ParsedUstarHeader | null {
  // Two consecutive zero blocks mark end of tar archive
  let isZero = true;
  for (let i = 0; i < TAR_BLOCK_SIZE; i += 1) {
    if (block[i] !== 0) {
      isZero = false;
      break;
    }
  }
  if (isZero) return null;

  // Verify checksum
  let computedChecksum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i += 1) {
    computedChecksum += (i >= 148 && i < 156) ? 0x20 : (block[i] ?? 0);
  }
  const rawChecksum = block
    .toString("ascii", 148, 156)
    .replace(/\0.*$/, "")
    .trim();
  const storedChecksum = parseInt(rawChecksum, 8);
  if (Number.isNaN(storedChecksum) || storedChecksum !== computedChecksum) {
    throw new HomiModulePackageError(
      "MODULE_ARCHIVE_CHECKSUM_INVALID",
      "Archive tar header checksum is invalid.",
    );
  }

  const magic = block.toString("ascii", 257, 263);
  if (!magic.startsWith("ustar")) {
    throw new HomiModulePackageError(
      "MODULE_ARCHIVE_FORMAT_INVALID",
      "Archive header is not in valid POSIX ustar format.",
    );
  }

  const nameRaw = block.toString("utf8", 0, 100).replace(/\0.*$/, "");
  const prefixRaw = block.toString("utf8", 345, 500).replace(/\0.*$/, "");
  const rawPath = prefixRaw.length > 0 ? `${prefixRaw}/${nameRaw}` : nameRaw;
  const relativePath = normalizeRelativePath(rawPath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    relativePath.includes("\0") ||
    relativePath.split("/").some((segment) => segment === "..")
  ) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_PATH_ESCAPE",
      `Archive contains forbidden path: '${rawPath}'.`,
    );
  }

  const rawSize = block
    .toString("ascii", 124, 136)
    .replace(/\0.*$/, "")
    .trim();
  const size = parseInt(rawSize, 8);
  if (Number.isNaN(size) || size < 0) {
    throw new HomiModulePackageError(
      "MODULE_ARCHIVE_FORMAT_INVALID",
      `Archive entry has invalid file size '${rawSize}'.`,
    );
  }

  const typeflag = block.toString("ascii", 156, 157);
  return Object.freeze({
    relativePath,
    size,
    typeflag,
  });
}

export async function packHomiModuleArchive(options: {
  readonly sourceDirectory: string;
  readonly outputArchiveFile?: string;
  readonly prepared?: HomiPreparedModulePackage;
}): Promise<HomiPackedModuleArchive> {
  const prepared =
    options.prepared ??
    (await inspectHomiModulePackage(options.sourceDirectory));

  const sortedFiles = [...prepared.files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for (const file of sortedFiles) {
    const fileContent = await readFile(file.absolutePath);
    if (fileContent.length !== file.size) {
      throw new HomiModulePackageError(
        "MODULE_PACKAGE_FILE_SIZE_CHANGED",
        `File '${file.relativePath}' size changed during packaging.`,
      );
    }

    const header = createUstarHeader(file.relativePath, file.size);
    chunks.push(header);
    chunks.push(fileContent);

    const padLength =
      (TAR_BLOCK_SIZE - (file.size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
    if (padLength > 0) {
      chunks.push(Buffer.alloc(padLength, 0));
    }
    totalBytes += file.size;
  }

  // End of tar archive marker: two 512-byte zero blocks
  chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2, 0));

  const uncompressedTar = Buffer.concat(chunks);

  // Deterministic gzip: level 9 compression with RFC 1952 MTIME=0 and OS=255
  const gzipped = gzipSync(uncompressedTar, { level: 9 });
  if (gzipped.length >= 10) {
    gzipped[4] = 0;
    gzipped[5] = 0;
    gzipped[6] = 0;
    gzipped[7] = 0;
    gzipped[9] = 255;
  }

  const archivePath =
    options.outputArchiveFile !== undefined
      ? resolve(options.outputArchiveFile)
      : resolve(
          options.sourceDirectory,
          `${prepared.manifest.moduleKey}-${prepared.manifest.version}.tar.gz`,
        );

  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, gzipped);

  const archiveDigest = `sha256:${createHash("sha256").update(gzipped).digest("hex")}`;

  return Object.freeze({
    archivePath,
    archiveDigest,
    packageDigest: prepared.packageDigest,
    moduleKey: prepared.manifest.moduleKey,
    version: prepared.manifest.version,
    fileCount: sortedFiles.length,
    totalBytes,
  });
}

export async function unpackHomiModuleArchive(
  archivePath: string,
  destinationDirectory: string,
): Promise<HomiUnpackedModuleArchive> {
  const targetRoot = resolve(destinationDirectory);
  const archiveFileStat = await lstat(archivePath).catch(() => null);
  if (!archiveFileStat?.isFile() || archiveFileStat.isSymbolicLink()) {
    throw new HomiModulePackageError(
      "MODULE_ARCHIVE_FILE_INVALID",
      `Archive file '${archivePath}' does not exist or is not a regular file.`,
    );
  }

  if (archiveFileStat.size > MAX_PACKAGE_BYTES) {
    throw new HomiModulePackageError(
      "MODULE_PACKAGE_TOO_LARGE",
      `Archive file exceeds the ${MAX_PACKAGE_BYTES} byte limit.`,
    );
  }

  const archiveContent = await readFile(archivePath);
  let uncompressedTar: Buffer;
  try {
    uncompressedTar = gunzipSync(archiveContent, {
      maxOutputLength: MAX_PACKAGE_BYTES,
    });
  } catch (error) {
    throw new HomiModulePackageError(
      "MODULE_ARCHIVE_DECOMPRESSION_FAILED",
      `Failed to decompress gzip archive: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  await mkdir(targetRoot, { recursive: true });

  let offset = 0;
  let fileCount = 0;
  let totalBytes = 0;

  while (offset < uncompressedTar.length) {
    if (offset + TAR_BLOCK_SIZE > uncompressedTar.length) {
      break;
    }

    const block = uncompressedTar.subarray(offset, offset + TAR_BLOCK_SIZE);
    offset += TAR_BLOCK_SIZE;

    const header = parseUstarHeader(block);
    if (!header) {
      // EOF marker reached
      break;
    }

    const destinationPath = join(targetRoot, header.relativePath);
    assertInsideRoot(targetRoot, destinationPath);

    // Directory entry
    if (
      header.typeflag === "5" ||
      (header.typeflag === "0" && header.relativePath.endsWith("/"))
    ) {
      await mkdir(destinationPath, { recursive: true });
      continue;
    }

    // Regular file entry ('0' or '\0' or empty)
    if (
      header.typeflag === "0" ||
      header.typeflag === "\0" ||
      header.typeflag === ""
    ) {
      fileCount += 1;
      totalBytes += header.size;

      if (fileCount > MAX_PACKAGE_FILES) {
        throw new HomiModulePackageError(
          "MODULE_PACKAGE_TOO_MANY_FILES",
          `Module archive exceeds the ${MAX_PACKAGE_FILES} file limit.`,
        );
      }

      if (totalBytes > MAX_PACKAGE_BYTES) {
        throw new HomiModulePackageError(
          "MODULE_PACKAGE_TOO_LARGE",
          `Module archive uncompressed content exceeds the ${MAX_PACKAGE_BYTES} byte limit.`,
        );
      }

      if (offset + header.size > uncompressedTar.length) {
        throw new HomiModulePackageError(
          "MODULE_ARCHIVE_TRUNCATED",
          `Archive is truncated while reading '${header.relativePath}'.`,
        );
      }

      const fileData = uncompressedTar.subarray(offset, offset + header.size);
      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, fileData, { mode: 0o644 });

      const padLength =
        (TAR_BLOCK_SIZE - (header.size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
      offset += header.size + padLength;
      continue;
    }

    if (header.typeflag === "2") {
      throw new HomiModulePackageError(
        "MODULE_PACKAGE_SYMLINK_FORBIDDEN",
        `Module archive contains symbolic link '${header.relativePath}'.`,
      );
    }

    throw new HomiModulePackageError(
      "MODULE_PACKAGE_ENTRY_TYPE_FORBIDDEN",
      `Module archive contains unsupported entry type '${header.typeflag}' for '${header.relativePath}'.`,
    );
  }

  return Object.freeze({
    destinationDirectory: targetRoot,
    fileCount,
    totalBytes,
  });
}

export async function isModuleArchiveFile(path: string): Promise<boolean> {
  const statResult = await stat(path).catch(() => null);
  if (!statResult?.isFile()) return false;

  const normalized = path.toLowerCase();
  if (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz")) {
    return true;
  }

  // Check gzip magic bytes (0x1f, 0x8b)
  try {
    const handle = await readFile(path);
    return handle.length >= 2 && handle[0] === 0x1f && handle[1] === 0x8b;
  } catch {
    return false;
  }
}
