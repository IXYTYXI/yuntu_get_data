import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { APIRequestContext, APIResponse, Page } from "playwright";

import { BrowserVideoDownloader } from "../src/download/browser-video-downloader.js";
import {
  mediaUnavailableDownloadStatus,
  playbackNotVerifiedDownloadStatus,
  skippedDownloadStatus,
} from "../src/download/authorized-downloader.js";

test("returns a dry-run skipped download status", () => {
  assert.deepEqual(skippedDownloadStatus(), {
    state: "skipped",
    code: "DRY_RUN",
  });
});

test("returns a playback-not-verified download status", () => {
  assert.deepEqual(playbackNotVerifiedDownloadStatus(), {
    state: "failed",
    code: "PLAYBACK_NOT_VERIFIED",
  });
});

test("returns a media-unavailable download status", () => {
  assert.deepEqual(mediaUnavailableDownloadStatus(), {
    state: "failed",
    code: "MEDIA_URL_UNAVAILABLE",
  });
});

test("downloads an https video into the configured directory", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "yuntu-download-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const page = {
    request: {
      async get(url: string): Promise<APIResponse> {
        assert.equal(url, "https://cdn.example.invalid/video.mp4");
        return {
          ok: () => true,
          body: async () => Buffer.from("video-bytes"),
        } as unknown as APIResponse;
      },
    },
    evaluate: async () => {
      throw new Error("blob download should not run");
    },
  } as unknown as Page;

  const downloader = new BrowserVideoDownloader(
    page,
    { directory: "videos", filenameExtension: "mp4" },
    rootDir,
  );

  const result = await downloader.download({
    materialId: "material-123",
    title: "Campaign video",
    videoUrl: "https://cdn.example.invalid/video.mp4",
  });

  assert.deepEqual(result, {
    state: "downloaded",
    path: "videos/material-123.mp4",
  });
  assert.equal(
    (await readFile(path.join(rootDir, "videos/material-123.mp4"))).toString(),
    "video-bytes",
  );
});

test("downloads a blob video through the page context", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "yuntu-download-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const page = {
    request: {
      get: async () => {
        throw new Error("https download should not run");
      },
    } as unknown as APIRequestContext,
    evaluate: async () => [1, 2, 3, 4],
  } as unknown as Page;

  const downloader = new BrowserVideoDownloader(
    page,
    { directory: "videos", filenameExtension: "mp4" },
    rootDir,
  );

  const result = await downloader.download({
    materialId: "blob-material",
    videoUrl: "blob:https://yuntu.oceanengine.com/abc-123",
  });

  assert.deepEqual(result, {
    state: "downloaded",
    path: "videos/blob-material.mp4",
  });
  assert.deepEqual(
    [...(await readFile(path.join(rootDir, "videos/blob-material.mp4")))],
    [1, 2, 3, 4],
  );
});

test("rejects unsupported hls media urls", async () => {
  const page = {
    request: { get: async () => ({ ok: () => true, body: async () => Buffer.alloc(0) }) },
    evaluate: async () => [],
  } as unknown as Page;

  const downloader = new BrowserVideoDownloader(
    page,
    { directory: "videos", filenameExtension: "mp4" },
    process.cwd(),
  );

  const result = await downloader.download({
    materialId: "hls-material",
    videoUrl: "https://cdn.example.invalid/stream.m3u8",
  });

  assert.deepEqual(result, {
    state: "failed",
    code: "UNSUPPORTED_MEDIA_URL",
  });
});

test("reports failed downloads without leaking request errors", async () => {
  const page = {
    request: {
      async get(): Promise<APIResponse> {
        throw new Error("network secret=private");
      },
    },
    evaluate: async () => [],
  } as unknown as Page;

  const downloader = new BrowserVideoDownloader(
    page,
    { directory: "videos", filenameExtension: "mp4" },
    process.cwd(),
  );

  const result = await downloader.download({
    materialId: "failed-material",
    videoUrl: "https://cdn.example.invalid/video.mp4",
  });

  assert.deepEqual(result, {
    state: "failed",
    code: "DOWNLOAD_FAILED",
  });
});
