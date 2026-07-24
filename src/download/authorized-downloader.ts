import type { DownloadStatus } from "../domain.js";

export interface DownloadRequest {
  materialId: string;
  title?: string;
  videoUrl?: string;
}

export type DownloadResult = DownloadStatus;

export interface AuthorizedDownloader {
  download(request: DownloadRequest): Promise<DownloadResult>;
}

export function skippedDownloadStatus(): DownloadStatus {
  return {
    state: "skipped",
    code: "DRY_RUN",
  };
}

export function playbackNotVerifiedDownloadStatus(): DownloadStatus {
  return {
    state: "failed",
    code: "PLAYBACK_NOT_VERIFIED",
  };
}

export function mediaUnavailableDownloadStatus(): DownloadStatus {
  return {
    state: "failed",
    code: "MEDIA_URL_UNAVAILABLE",
  };
}
