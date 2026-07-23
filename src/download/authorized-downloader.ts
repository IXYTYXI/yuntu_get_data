export interface DownloadRequest {
  materialId: string;
  title?: string;
}

export interface DownloadResult {
  state: "not-authorized";
  code: "DOWNLOAD_NOT_AUTHORIZED";
}

export interface AuthorizedDownloader {
  download(request: DownloadRequest): Promise<DownloadResult>;
}

export class DisabledAuthorizedDownloader implements AuthorizedDownloader {
  async download(_request: DownloadRequest): Promise<DownloadResult> {
    return {
      state: "not-authorized",
      code: "DOWNLOAD_NOT_AUTHORIZED",
    };
  }
}
