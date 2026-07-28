import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

import { loadCollectionConfig } from "./config.js";
import {
  CollectorFailure,
  type CollectionConfig,
  type CollectorError,
  type CollectorErrorCode,
  type DownloadStatus,
  type MaterialRecord,
} from "./domain.js";
import {
  mediaUnavailableDownloadStatus,
  playbackNotVerifiedDownloadStatus,
  skippedDownloadStatus,
} from "./download/authorized-downloader.js";
import { BrowserVideoDownloader } from "./download/browser-video-downloader.js";
import { writeOutput } from "./output.js";
import { MaterialDetail } from "./ui/material-detail.js";
import {
  filterVideoListRows,
  inferBrandNameFromTitle,
  readVideoListRows,
  type ParsedVideoListRow,
} from "./ui/video-list.js";
import { findYuntuPage, ensureCollectionPage, YuntuPage, isTaContentInsightPageUrl } from "./ui/yuntu-page.js";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const TRUSTED_YUNTU_ORIGIN = "https://yuntu.oceanengine.com";
const UNAVAILABLE_BROWSER_LOCATION = "unavailable-browser-location";
const INVALID_LOCAL_CDP_ENDPOINT = "Invalid local CDP endpoint";

const SAFE_ERROR_MESSAGES: Record<CollectorErrorCode, string> = {
  AUTH_REQUIRED: "Manual sign-in and an open Yuntu page are required",
  SELECTOR_NOT_FOUND: "Configured visible UI selector was not found",
  PLAYBACK_NOT_CONFIRMED: "Visible playback could not be confirmed",
  DOWNLOAD_NOT_AUTHORIZED: "Video download is not authorized in v1",
};

export const CLI_HELP_TEXT = [
  "Usage: npm start -- --config <path> [--cdp-url <url>] [--page-index <n>] [--dry-run]",
  "",
  "Options:",
  "  --config <path>    Required local JSON collection configuration.",
  `  --cdp-url <url>   Chrome DevTools endpoint (default: ${DEFAULT_CDP_URL}).`,
  "  --page-index <n>  Required when the debugging browser has multiple tabs.",
  "  --dry-run          Collect visible metadata without downloading videos.",
  "  --help             Show this help text.",
  "",
  "Downloads verified player media into the configured download.directory.",
  "Does not persist media URLs, access cookies/storage directly, or write Feishu Base.",
].join("\n");

export interface ParsedCliArgs {
  configPath?: string;
  cdpUrl: string;
  pageIndex?: number;
  dryRun: boolean;
  help: boolean;
}

export interface CliLogger {
  log(message: string): void;
  error(message: string): void;
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  let configPath: string | undefined;
  let cdpUrl = DEFAULT_CDP_URL;
  let pageIndex: number | undefined;
  let dryRun = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--config":
        configPath = readOptionValue(argv, index, "--config");
        index += 1;
        break;
      case "--cdp-url":
        cdpUrl = parseLocalCdpEndpoint(
          readOptionValue(argv, index, "--cdp-url"),
        );
        index += 1;
        break;
      case "--page-index":
        pageIndex = parsePageIndex(
          readOptionValue(argv, index, "--page-index"),
        );
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
        help = true;
        break;
      default:
        throw new Error("Unknown command-line argument");
    }
  }

  if (!help && configPath === undefined) {
    throw new Error("--config is required");
  }

  return { configPath, cdpUrl, pageIndex, dryRun, help };
}

export function sanitizeBrowserLocation(location: string): string {
  if (typeof location !== "string") {
    return UNAVAILABLE_BROWSER_LOCATION;
  }

  try {
    const url = new URL(location);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "yuntu.oceanengine.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return UNAVAILABLE_BROWSER_LOCATION;
    }

    return TRUSTED_YUNTU_ORIGIN;
  } catch {
    return UNAVAILABLE_BROWSER_LOCATION;
  }
}

export async function withConnectedBrowser<TResult>(
  connect: (cdpUrl: string) => Promise<Browser>,
  cdpUrl: string,
  operation: (browser: Browser) => Promise<TResult>,
): Promise<TResult> {
  const browser = await connect(cdpUrl);
  try {
    return await operation(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  logger: CliLogger = console,
): Promise<number> {
  let options: ParsedCliArgs;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    logger.error(formatArgumentError(error));
    return 1;
  }

  if (options.help) {
    logger.log(CLI_HELP_TEXT);
    return 0;
  }

  try {
    const config = await loadCollectionConfig(requireConfigPath(options));
    return await withConnectedBrowser(
      (cdpUrl) => chromium.connectOverCDP(cdpUrl),
      options.cdpUrl,
      async (browser) => {
        const page = findYuntuPage(
          browser,
          config.pageUrlPrefix,
          options.pageIndex,
        );
        await ensureCollectionPage(
          page,
          config.pageUrlPrefix,
          config.navigationQuery ?? {},
        );
        const yuntuPage = new YuntuPage(
          page,
          config.selectors,
          config.filters,
          config.pageUrlPrefix,
        );

        if (
          config.criteria !== undefined ||
          isTaContentInsightPageUrl(page.url()) ||
          isTaContentInsightPageUrl(config.pageUrlPrefix)
        ) {
          await yuntuPage.navigateToIndustryInspirationModule();
        }

        await yuntuPage.applyVisibleFilters();
        const records = config.criteria
          ? await collectMaterialsWithCriteria(
              page,
              yuntuPage,
              config,
              options.dryRun,
            )
          : await collectMaterials(
              page,
              yuntuPage,
              config,
              Math.min(
                config.resultLimit,
                await yuntuPage.visibleMaterialCount(),
              ),
              options.dryRun,
            );

        await writeOutput(records, config.output);
        return 0;
      },
    );
  } catch (error) {
    logger.error(formatCollectionError(error));
    return 1;
  }
}

async function collectMaterialsWithCriteria(
  page: Page,
  yuntuPage: YuntuPage,
  config: CollectionConfig,
  dryRun: boolean,
): Promise<MaterialRecord[]> {
  const criteria = config.criteria;
  if (criteria === undefined) {
    return [];
  }

  const records: MaterialRecord[] = [];
  await yuntuPage.applyDateRangeDays(criteria.dateRangeDays);
  if (criteria.extractionMethodLabel !== undefined) {
    await yuntuPage.applyExtractionMethod(criteria.extractionMethodLabel);
  }

  const brandSelectionMode = criteria.brandSelectionMode ?? "sequential";
  const rowLimit = Math.min(criteria.maxResultsPerBrand, config.resultLimit);

  if (brandSelectionMode === "combined") {
    await yuntuPage.searchCompetitorBrands(criteria.brands);
    const rows = filterVideoListRows(await readVideoListRows(page), {
      minExposure: criteria.minExposure,
      minThreeSecondCompletionRate: criteria.minThreeSecondCompletionRate,
      minCtr: criteria.minCtr,
      maxResults: rowLimit,
    });

    for (const row of rows) {
      records.push(
        await collectMaterial(
          page,
          yuntuPage,
          config,
          row.rowIndex,
          dryRun,
          dryRun ? undefined : new BrowserVideoDownloader(page, config.download),
          inferBrandNameFromTitle(row.title, criteria.brands),
          row,
        ),
      );
    }

    return records;
  }

  for (const brandName of criteria.brands) {
    await yuntuPage.searchCompetitorBrand(brandName);
    const rows = filterVideoListRows(await readVideoListRows(page), {
      minExposure: criteria.minExposure,
      minThreeSecondCompletionRate: criteria.minThreeSecondCompletionRate,
      minCtr: criteria.minCtr,
      maxResults: rowLimit,
    });

    for (const row of rows) {
      records.push(
        await collectMaterial(
          page,
          yuntuPage,
          config,
          row.rowIndex,
          dryRun,
          dryRun ? undefined : new BrowserVideoDownloader(page, config.download),
          brandName,
          row,
        ),
      );
    }
  }

  return records;
}

async function collectMaterials(
  page: Page,
  yuntuPage: YuntuPage,
  config: CollectionConfig,
  materialCount: number,
  dryRun: boolean,
): Promise<MaterialRecord[]> {
  const downloader = dryRun
    ? undefined
    : new BrowserVideoDownloader(page, config.download);
  const records: MaterialRecord[] = [];

  for (let index = 0; index < materialCount; index += 1) {
    records.push(
      await collectMaterial(
        page,
        yuntuPage,
        config,
        index,
        dryRun,
        downloader,
      ),
    );
  }

  return records;
}

async function collectMaterial(
  page: Page,
  yuntuPage: YuntuPage,
  config: CollectionConfig,
  index: number,
  dryRun: boolean,
  downloader: BrowserVideoDownloader | undefined,
  brandName?: string,
  listRow?: ParsedVideoListRow,
): Promise<MaterialRecord> {
  let opened = false;
  let record: MaterialRecord | undefined;
  let failure: unknown;

  try {
    await yuntuPage.openMaterial(index);
    opened = true;

    const detail = new MaterialDetail(
      page,
      config.selectors,
      config.pageUrlPrefix,
    );
    const visibleDetails = await detail.collect();
    const playback = await detail.verifyPlayback();
    const download = await collectVideoDownload(
      detail,
      playback,
      listRow === undefined
        ? visibleDetails.materialId
        : `${brandName ?? "brand"}-${listRow.rank}`,
      visibleDetails.title,
      dryRun,
      downloader,
    );

    record = {
      ...visibleDetails,
      ...(brandName === undefined ? {} : { brandName }),
      ...(listRow === undefined
        ? {}
        : {
            launchDate: listRow.launchDate,
            exposure: listRow.exposureText,
            threeSecondCompletionRate: listRow.threeSecondCompletionRateText,
            ctr: listRow.ctrText,
          }),
      playback,
      download,
    };
  } catch (error) {
    failure = error;
  } finally {
    if (opened) {
      try {
        await yuntuPage.closeMaterial();
      } catch (closeError) {
        if (failure !== undefined || record === undefined) {
          failure ??= closeError;
        }
      }
    }
  }

  return failure === undefined && record !== undefined
    ? record
    : unavailableMaterial(index, failure, dryRun);
}

async function collectVideoDownload(
  detail: MaterialDetail,
  playback: MaterialRecord["playback"],
  materialId: string,
  title: string | undefined,
  dryRun: boolean,
  downloader: BrowserVideoDownloader | undefined,
): Promise<DownloadStatus> {
  if (dryRun) {
    return skippedDownloadStatus();
  }

  if (playback.state !== "verified") {
    return playbackNotVerifiedDownloadStatus();
  }

  let videoUrl: string;
  try {
    videoUrl = await detail.getVideoSourceUrl();
  } catch {
    return mediaUnavailableDownloadStatus();
  }

  if (downloader === undefined) {
    return mediaUnavailableDownloadStatus();
  }

  return downloader.download({
    materialId,
    ...(title === undefined ? {} : { title }),
    videoUrl,
  });
}

function unavailableMaterial(
  index: number,
  error: unknown,
  dryRun: boolean,
): MaterialRecord {
  return {
    materialId: `unavailable-${index + 1}`,
    metrics: {},
    playback: { state: "unavailable" },
    download: dryRun
      ? skippedDownloadStatus()
      : mediaUnavailableDownloadStatus(),
    errors: [toSafeCollectorError(error)],
  };
}

function toSafeCollectorError(error: unknown): CollectorError {
  if (error instanceof CollectorFailure) {
    return {
      code: error.code,
      message: SAFE_ERROR_MESSAGES[error.code],
    };
  }

  return {
    code: "SELECTOR_NOT_FOUND",
    message: SAFE_ERROR_MESSAGES.SELECTOR_NOT_FOUND,
  };
}

function requireConfigPath(options: ParsedCliArgs): string {
  if (options.configPath === undefined) {
    throw new Error("--config is required");
  }

  return options.configPath;
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  option: "--config" | "--cdp-url" | "--page-index",
): string {
  const value = argv[index + 1];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }

  return value;
}

function parsePageIndex(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Invalid target page index");
  }

  const pageIndex = Number(value);
  if (!Number.isSafeInteger(pageIndex)) {
    throw new Error("Invalid target page index");
  }

  return pageIndex;
}

function parseLocalCdpEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(INVALID_LOCAL_CDP_ENDPOINT);
  }

  if (
    value.includes("?") ||
    value.includes("#") ||
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" &&
      url.hostname !== "localhost" &&
      url.hostname !== "[::1]") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/"
  ) {
    throw new Error(INVALID_LOCAL_CDP_ENDPOINT);
  }

  return value;
}

function formatArgumentError(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid CLI arguments";
}

function formatCollectionError(error: unknown): string {
  if (error instanceof CollectorFailure) {
    const fallback = SAFE_ERROR_MESSAGES[error.code];
    const detail =
      error.message.length > 0 &&
      error.message !== error.code &&
      error.message !== fallback
        ? redactErrorMessage(error.message)
        : fallback;
    return `${error.code}: ${detail}`;
  }

  if (error instanceof Error) {
    const message = redactErrorMessage(error.message);
    if (/ECONNREFUSED|connectOverCDP|Failed to connect/i.test(message)) {
      return (
        "COLLECTOR_FAILED: Cannot connect to Chrome DevTools at the configured " +
        "CDP URL. Start Google Chrome with --remote-debugging-port=9222 and a " +
        "dedicated --user-data-dir, then retry."
      );
    }

    if (message.length > 0) {
      return `COLLECTOR_FAILED: ${message}`;
    }
  }

  return "COLLECTOR_FAILED: Unable to collect visible material data";
}

function redactErrorMessage(message: string): string {
  return message
    .replace(/https:\/\/[^\s]+/g, "https://yuntu.oceanengine.com/[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    import.meta.url === pathToFileURL(resolve(entrypoint)).href
  );
}

if (isDirectExecution()) {
  void main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error("COLLECTOR_FAILED: CLI exited unexpectedly");
      process.exitCode = 1;
    });
}
