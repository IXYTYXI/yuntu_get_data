export type OutputFormat = "jsonl" | "csv";

export type PlaybackState = "verified" | "not-confirmed" | "unavailable";

export type DownloadState = "downloaded" | "failed" | "skipped";

export type DownloadFailureCode =
  | "DOWNLOAD_FAILED"
  | "MEDIA_URL_UNAVAILABLE"
  | "UNSUPPORTED_MEDIA_URL"
  | "PLAYBACK_NOT_VERIFIED";

export type CollectorErrorCode =
  | "AUTH_REQUIRED"
  | "SELECTOR_NOT_FOUND"
  | "PLAYBACK_NOT_CONFIRMED"
  | "DOWNLOAD_NOT_AUTHORIZED";

export class CollectorFailure extends Error {
  readonly code: CollectorErrorCode;

  constructor(code: CollectorErrorCode, message: string = code) {
    super(message);
    this.name = "CollectorFailure";
    this.code = code;
  }
}

export interface PlaybackResult {
  state: PlaybackState;
  code?: "PLAYBACK_NOT_CONFIRMED";
}

export type DownloadStatus =
  | { state: "downloaded"; path: string }
  | { state: "failed"; code: DownloadFailureCode }
  | { state: "skipped"; code: "DRY_RUN" };

export interface CollectorError {
  code: CollectorErrorCode;
  message?: string;
}

export interface MaterialRecord {
  materialId: string;
  brandName?: string;
  title?: string;
  duration?: string;
  launchDate?: string;
  exposure?: string;
  threeSecondCompletionRate?: string;
  ctr?: string;
  industry?: string;
  touchpoints?: string;
  metrics: Record<string, string>;
  script?: string;
  transcript?: string;
  analysis?: string;
  playback: PlaybackResult;
  download: DownloadStatus;
  errors?: CollectorError[];
}

export interface CollectionCriteria {
  brands: string[];
  dateRangeDays: number;
  maxResultsPerBrand: number;
  minExposure: number;
  minThreeSecondCompletionRate: number;
  minCtr: number;
}

export interface VisibleFilterStep {
  triggerSelector: string;
  optionSelector: string;
}

export interface FieldSelectors {
  materialId?: string;
  title?: string;
  duration?: string;
  launchDate?: string;
  industry?: string;
  touchpoints?: string;
  metrics?: string;
  script?: string;
  analysis?: string;
}

export interface CollectionConfig {
  pageUrlPrefix: string;
  resultLimit: number;
  output: {
    format: OutputFormat;
    path: string;
  };
  download: {
    directory: string;
    filenameExtension: string;
  };
  criteria?: CollectionCriteria;
  filters: VisibleFilterStep[];
  selectors: {
    resultCard: string;
    detailPanel: string;
    closeDetail?: string;
    player: string;
    playButton: string;
    fields: FieldSelectors;
  };
}
