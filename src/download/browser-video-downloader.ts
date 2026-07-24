import { constants } from "node:fs";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import type { CollectionConfig, DownloadStatus } from "../domain.js";

export interface VideoDownloadRequest {
  materialId: string;
  title?: string;
  videoUrl: string;
}

export interface VideoDownloader {
  download(request: VideoDownloadRequest): Promise<DownloadStatus>;
}

const HLS_URL_PATTERN = /\.m3u8(?:[/?#]|$)/i;

export class BrowserVideoDownloader implements VideoDownloader {
  constructor(
    private readonly page: Page,
    private readonly downloadConfig: CollectionConfig["download"],
    private readonly rootDir = process.cwd(),
  ) {}

  async download(request: VideoDownloadRequest): Promise<DownloadStatus> {
    if (HLS_URL_PATTERN.test(request.videoUrl)) {
      return {
        state: "failed",
        code: "UNSUPPORTED_MEDIA_URL",
      };
    }

    const outputPath = this.resolveOutputPath(
      request.materialId,
      request.title,
    );

    try {
      await mkdir(path.dirname(outputPath), { recursive: true });

      if (request.videoUrl.startsWith("blob:")) {
        await this.downloadBlobUrl(request.videoUrl, outputPath);
      } else if (this.isAllowedHttpsUrl(request.videoUrl)) {
        await this.downloadHttpsUrl(request.videoUrl, outputPath);
      } else {
        return {
          state: "failed",
          code: "UNSUPPORTED_MEDIA_URL",
        };
      }

      return {
        state: "downloaded",
        path: path.relative(this.rootDir, outputPath),
      };
    } catch {
      return {
        state: "failed",
        code: "DOWNLOAD_FAILED",
      };
    }
  }

  private resolveOutputPath(materialId: string, title?: string): string {
    const directory = this.resolveDownloadDirectory();
    const filename = `${sanitizeFilenameSegment(materialId || title || "material")}.${this.downloadConfig.filenameExtension}`;
    return path.join(directory, filename);
  }

  private resolveDownloadDirectory(): string {
    const relativeDirectory = this.downloadConfig.directory;
    if (
      path.isAbsolute(relativeDirectory) ||
      path.win32.isAbsolute(relativeDirectory) ||
      relativeDirectory.split(/[\\/]/).includes("..")
    ) {
      throw new Error("download directory must remain within the project root");
    }

    return path.resolve(this.rootDir, relativeDirectory);
  }

  private isAllowedHttpsUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.username === "" && url.password === "";
    } catch {
      return false;
    }
  }

  private async downloadHttpsUrl(videoUrl: string, outputPath: string): Promise<void> {
    const response = await this.page.request.get(videoUrl);
    if (!response.ok()) {
      throw new Error("video download request failed");
    }

    const body = await response.body();
    await writeFileAtomic(outputPath, body);
  }

  private async downloadBlobUrl(videoUrl: string, outputPath: string): Promise<void> {
    const bytes = await this.page.evaluate(async (blobUrl) => {
      const response = await fetch(blobUrl);
      if (!response.ok) {
        throw new Error("blob fetch failed");
      }

      const buffer = await response.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    }, videoUrl);

    await writeFileAtomic(outputPath, Buffer.from(bytes));
  }
}

function sanitizeFilenameSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return sanitized.length > 0 ? sanitized : "material";
}

async function writeFileAtomic(
  outputPath: string,
  content: Buffer,
): Promise<void> {
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  const temporaryFile = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL,
    0o600,
  );

  try {
    await temporaryFile.writeFile(content);
  } finally {
    await temporaryFile.close();
  }

  try {
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
