import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import type {
  CollectionConfig,
  CollectorError,
  MaterialRecord,
} from "./domain.js";

const csvHeader = [
  "materialId",
  "brandName",
  "title",
  "launchDate",
  "exposure",
  "threeSecondCompletionRate",
  "ctr",
  "duration",
  "industry",
  "touchpoints",
  "metrics",
  "script",
  "transcript",
  "analysis",
  "playbackState",
  "playbackCode",
  "downloadState",
  "downloadCode",
  "downloadPath",
  "errorCodes",
] as const;

const redactedValue = "[redacted]";
const unsafeVisibleValuePattern =
  /\b(?:https?|file|data|javascript)\s*:|\/\/|auth(?:entication|orization)?|bearer|token|session|cookie|signature|\b(?:sid|jwt|api[\s._-]*key)\b/i;

export function serializeJsonl(records: MaterialRecord[]): string {
  if (records.length === 0) {
    return "";
  }

  return `${records.map((record) => JSON.stringify(projectRecord(record))).join("\n")}\n`;
}

export function serializeCsv(records: MaterialRecord[]): string {
  const rows = records.map((record) => {
    const projected = projectRecord(record);
    return [
      projected.materialId,
      projected.brandName ?? "",
      projected.title ?? "",
      projected.launchDate ?? "",
      projected.exposure ?? "",
      projected.threeSecondCompletionRate ?? "",
      projected.ctr ?? "",
      projected.duration ?? "",
      projected.industry ?? "",
      projected.touchpoints ?? "",
      JSON.stringify(projected.metrics),
      projected.script ?? "",
      projected.transcript ?? "",
      projected.analysis ?? "",
      projected.playback.state,
      projected.playback.code ?? "",
      projected.download.state,
      downloadCode(projected.download),
      downloadPath(projected.download),
      projected.errors?.map((error) => error.code).join(",") ?? "",
    ]
      .map(escapeCsv)
      .join(",");
  });

  return `${[csvHeader.join(","), ...rows].join("\n")}\n`;
}

export async function writeOutput(
  records: MaterialRecord[],
  output: CollectionConfig["output"],
  rootDir = process.cwd(),
): Promise<void> {
  const outputRoot = path.resolve(rootDir);
  await assertValidOutputRoot(outputRoot);
  const outputPath = resolveOutputPath(output.path, outputRoot);

  await assertNoSymlinkComponents(outputRoot, outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await assertNoSymlinkComponents(outputRoot, outputPath);

  await writeOutputAtomically(
    outputPath,
    output.format === "jsonl"
      ? serializeJsonl(records)
      : serializeCsv(records),
  );
}

function projectRecord(record: MaterialRecord): MaterialRecord {
  return {
    materialId: sanitizeVisibleString(record.materialId),
    ...(typeof record.brandName === "string"
      ? { brandName: sanitizeVisibleString(record.brandName) }
      : {}),
    ...(typeof record.title === "string"
      ? { title: sanitizeVisibleString(record.title) }
      : {}),
    ...(typeof record.launchDate === "string"
      ? { launchDate: sanitizeVisibleString(record.launchDate) }
      : {}),
    ...(typeof record.exposure === "string"
      ? { exposure: sanitizeVisibleString(record.exposure) }
      : {}),
    ...(typeof record.threeSecondCompletionRate === "string"
      ? {
          threeSecondCompletionRate: sanitizeVisibleString(
            record.threeSecondCompletionRate,
          ),
        }
      : {}),
    ...(typeof record.ctr === "string"
      ? { ctr: sanitizeVisibleString(record.ctr) }
      : {}),
    ...(typeof record.duration === "string"
      ? { duration: sanitizeVisibleString(record.duration) }
      : {}),
    ...(typeof record.industry === "string"
      ? { industry: sanitizeVisibleString(record.industry) }
      : {}),
    ...(typeof record.touchpoints === "string"
      ? { touchpoints: sanitizeVisibleString(record.touchpoints) }
      : {}),
    metrics: projectMetrics(record.metrics),
    ...(typeof record.script === "string"
      ? { script: sanitizeVisibleString(record.script) }
      : {}),
    ...(typeof record.transcript === "string"
      ? { transcript: sanitizeVisibleString(record.transcript) }
      : {}),
    ...(typeof record.analysis === "string"
      ? { analysis: sanitizeVisibleString(record.analysis) }
      : {}),
    playback: projectPlayback(record.playback),
    download: projectDownload(record.download),
    ...(Array.isArray(record.errors)
      ? { errors: record.errors.map(projectError) }
      : {}),
  };
}

function projectError(error: CollectorError): CollectorError {
  return {
    code: isCollectorErrorCode(error?.code)
      ? error.code
      : "SELECTOR_NOT_FOUND",
    ...(typeof error?.message === "string"
      ? { message: sanitizeVisibleString(error.message) }
      : {}),
  };
}

function projectPlayback(
  playback: MaterialRecord["playback"],
): MaterialRecord["playback"] {
  return {
    state: isPlaybackState(playback?.state)
      ? playback.state
      : "unavailable",
    ...(playback?.code === "PLAYBACK_NOT_CONFIRMED"
      ? { code: "PLAYBACK_NOT_CONFIRMED" }
      : {}),
  };
}

function projectDownload(
  download: MaterialRecord["download"],
): MaterialRecord["download"] {
  if (download?.state === "downloaded") {
    return {
      state: "downloaded",
      path: sanitizeVisibleString(download.path),
    };
  }

  if (download?.state === "skipped" && download.code === "DRY_RUN") {
    return { state: "skipped", code: "DRY_RUN" };
  }

  if (download?.state === "failed") {
    return {
      state: "failed",
      code: isDownloadFailureCode(download.code)
        ? download.code
        : "DOWNLOAD_FAILED",
    };
  }

  return {
    state: "failed",
    code: "DOWNLOAD_FAILED",
  };
}

function downloadCode(download: MaterialRecord["download"]): string {
  return download.state === "failed" || download.state === "skipped"
    ? download.code
    : "";
}

function downloadPath(download: MaterialRecord["download"]): string {
  return download.state === "downloaded" ? download.path : "";
}

function isDownloadFailureCode(
  value: unknown,
): value is Extract<MaterialRecord["download"], { state: "failed" }>["code"] {
  return (
    value === "DOWNLOAD_FAILED" ||
    value === "MEDIA_URL_UNAVAILABLE" ||
    value === "UNSUPPORTED_MEDIA_URL" ||
    value === "PLAYBACK_NOT_VERIFIED"
  );
}

function isPlaybackState(
  value: unknown,
): value is MaterialRecord["playback"]["state"] {
  return (
    value === "verified" ||
    value === "not-confirmed" ||
    value === "unavailable"
  );
}

function isCollectorErrorCode(value: unknown): value is CollectorError["code"] {
  return (
    value === "AUTH_REQUIRED" ||
    value === "SELECTOR_NOT_FOUND" ||
    value === "PLAYBACK_NOT_CONFIRMED" ||
    value === "DOWNLOAD_NOT_AUTHORIZED"
  );
}

function projectMetrics(metrics: Record<string, string>): Record<string, string> {
  const visibleText = metrics?.visibleText;
  return typeof visibleText === "string"
    ? { visibleText: sanitizeVisibleString(visibleText) }
    : {};
}

function sanitizeVisibleString(value: string): string {
  return unsafeVisibleValuePattern.test(value) ? redactedValue : value;
}

function escapeCsv(value: string): string {
  const neutralized = /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(neutralized)
    ? `"${neutralized.replaceAll('"', '""')}"`
    : neutralized;
}

async function assertValidOutputRoot(outputRoot: string): Promise<void> {
  const rootEntry = await lstat(outputRoot);
  if (rootEntry.isSymbolicLink()) {
    throw new Error("output root must not be a symlink");
  }

  if (!rootEntry.isDirectory()) {
    throw new Error("output root must be a directory");
  }
}

function resolveOutputPath(outputPath: string, outputRoot: string): string {
  if (
    path.isAbsolute(outputPath) ||
    path.win32.isAbsolute(outputPath) ||
    path.win32.parse(outputPath).root !== "" ||
    outputPath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("output path must remain within the output root");
  }

  const resolvedOutputPath = path.resolve(outputRoot, outputPath);
  const relativePath = path.relative(outputRoot, resolvedOutputPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("output path must remain within the output root");
  }

  return resolvedOutputPath;
}

async function assertNoSymlinkComponents(
  outputRoot: string,
  outputPath: string,
): Promise<void> {
  const relativePath = path.relative(outputRoot, outputPath);
  let componentPath = outputRoot;

  for (const component of relativePath.split(path.sep)) {
    if (component.length === 0) {
      continue;
    }

    componentPath = path.join(componentPath, component);
    try {
      if ((await lstat(componentPath)).isSymbolicLink()) {
        throw new Error("output path must not contain symlink components");
      }
    } catch (error: unknown) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function writeOutputAtomically(
  outputPath: string,
  content: string,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${randomUUID()}.tmp`,
  );
  let temporaryFileCreated = false;

  try {
    const temporaryFile = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    temporaryFileCreated = true;

    try {
      await temporaryFile.writeFile(content, "utf8");
    } finally {
      await temporaryFile.close();
    }

    await rename(temporaryPath, outputPath);
    temporaryFileCreated = false;
  } catch (error) {
    if (temporaryFileCreated) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (!isMissingPathError(cleanupError)) {
          throw cleanupError;
        }
      }
    }

    throw error;
  }
}
