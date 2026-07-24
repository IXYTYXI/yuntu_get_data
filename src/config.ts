import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CollectionConfig,
  CollectionCriteria,
  FieldSelectors,
  OutputFormat,
  VisibleFilterStep,
} from "./domain.js";

const topLevelKeys = [
  "pageUrlPrefix",
  "resultLimit",
  "output",
  "download",
  "criteria",
  "filters",
  "selectors",
] as const;

const outputKeys = ["format", "path"] as const;
const downloadKeys = ["directory", "filenameExtension"] as const;
const filterKeys = ["triggerSelector", "optionSelector"] as const;
const selectorKeys = [
  "resultCard",
  "detailPanel",
  "closeDetail",
  "player",
  "playButton",
  "fields",
] as const;
const requiredSelectorKeys = [
  "resultCard",
  "detailPanel",
  "player",
  "playButton",
  "fields",
] as const;
const fieldSelectorKeys = [
  "materialId",
  "title",
  "duration",
  "launchDate",
  "industry",
  "touchpoints",
  "metrics",
  "script",
  "analysis",
] as const;

const criteriaKeys = [
  "brands",
  "dateRangeDays",
  "maxResultsPerBrand",
  "minExposure",
  "minThreeSecondCompletionRate",
  "minCtr",
] as const;

export function parseCollectionConfig(raw: unknown): CollectionConfig {
  const config = requirePlainObject(raw, "configuration");
  requireExactKeys(config, topLevelKeys, "configuration", [
    "pageUrlPrefix",
    "resultLimit",
    "output",
    "download",
    "filters",
    "selectors",
  ]);

  const pageUrlPrefix = readNonEmptyString(
    config.pageUrlPrefix,
    "pageUrlPrefix",
  );
  validatePageUrlPrefix(pageUrlPrefix);

  return {
    pageUrlPrefix,
    resultLimit: readPositiveInteger(config.resultLimit, "resultLimit"),
    output: parseOutput(config.output),
    download: parseDownload(config.download),
    ...(Object.hasOwn(config, "criteria")
      ? { criteria: parseCriteria(config.criteria) }
      : {}),
    filters: parseFilters(config.filters),
    selectors: parseSelectors(config.selectors),
  };
}

export async function loadCollectionConfig(
  filePath: string,
): Promise<CollectionConfig> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  return parseCollectionConfig(raw);
}

function parseOutput(value: unknown): CollectionConfig["output"] {
  const output = requirePlainObject(value, "output");
  requireExactKeys(output, outputKeys, "output");

  const format = readNonEmptyString(output.format, "output.format");
  if (format !== "jsonl" && format !== "csv") {
    throw new Error("output.format must be jsonl or csv");
  }

  const outputPath = readNonEmptyString(output.path, "output.path");
  validateRelativePath(outputPath, "output.path");

  return { format: format as OutputFormat, path: outputPath };
}

function parseDownload(value: unknown): CollectionConfig["download"] {
  const download = requirePlainObject(value, "download");
  requireExactKeys(download, downloadKeys, "download", ["directory"]);

  const directory = readNonEmptyString(download.directory, "download.directory");
  validateRelativePath(directory, "download.directory");

  const filenameExtension =
    download.filenameExtension === undefined
      ? "mp4"
      : readNonEmptyString(
          download.filenameExtension,
          "download.filenameExtension",
        );
  if (!/^[a-z0-9]+$/i.test(filenameExtension)) {
    throw new Error("download.filenameExtension must be alphanumeric");
  }

  return { directory, filenameExtension };
}

function parseCriteria(value: unknown): CollectionCriteria {
  const criteria = requirePlainObject(value, "criteria");
  requireExactKeys(criteria, criteriaKeys, "criteria");

  const brands = criteria.brands;
  if (!Array.isArray(brands) || brands.length === 0) {
    throw new Error("criteria.brands must be a nonempty array");
  }

  return {
    brands: brands.map((brand, index) =>
      readNonEmptyString(brand, `criteria.brands[${index}]`),
    ),
    dateRangeDays: readPositiveInteger(
      criteria.dateRangeDays,
      "criteria.dateRangeDays",
    ),
    maxResultsPerBrand: readPositiveInteger(
      criteria.maxResultsPerBrand,
      "criteria.maxResultsPerBrand",
    ),
    minExposure: readPositiveInteger(
      criteria.minExposure,
      "criteria.minExposure",
    ),
    minThreeSecondCompletionRate: readRatio(
      criteria.minThreeSecondCompletionRate,
      "criteria.minThreeSecondCompletionRate",
    ),
    minCtr: readRatio(criteria.minCtr, "criteria.minCtr"),
  };
}

function readRatio(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative number`);
  }

  return value;
}

function validateRelativePath(outputPath: string, name: string): void {
  if (
    path.isAbsolute(outputPath) ||
    path.win32.isAbsolute(outputPath) ||
    path.win32.parse(outputPath).root !== "" ||
    outputPath.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`${name} must be a safe relative path`);
  }
}

function parseFilters(value: unknown): VisibleFilterStep[] {
  if (!Array.isArray(value)) {
    throw new Error("filters must be an array");
  }

  return value.map((step, index) => {
    const filter = requirePlainObject(step, `filters[${index}]`);
    requireExactKeys(filter, filterKeys, `filters[${index}]`);

    return {
      triggerSelector: readNonEmptyString(
        filter.triggerSelector,
        `filters[${index}].triggerSelector`,
      ),
      optionSelector: readNonEmptyString(
        filter.optionSelector,
        `filters[${index}].optionSelector`,
      ),
    };
  });
}

function parseSelectors(value: unknown): CollectionConfig["selectors"] {
  const rawSelectors = requirePlainObject(value, "selectors");
  requireExactKeys(
    rawSelectors,
    selectorKeys,
    "selectors",
    requiredSelectorKeys,
  );

  const selectors: CollectionConfig["selectors"] = {
    resultCard: readNonEmptyString(
      rawSelectors.resultCard,
      "selectors.resultCard",
    ),
    detailPanel: readNonEmptyString(
      rawSelectors.detailPanel,
      "selectors.detailPanel",
    ),
    player: readNonEmptyString(rawSelectors.player, "selectors.player"),
    playButton: readNonEmptyString(
      rawSelectors.playButton,
      "selectors.playButton",
    ),
    fields: parseFieldSelectors(rawSelectors.fields),
  };

  if (Object.hasOwn(rawSelectors, "closeDetail")) {
    selectors.closeDetail = readNonEmptyString(
      rawSelectors.closeDetail,
      "selectors.closeDetail",
    );
  }

  return selectors;
}

function parseFieldSelectors(value: unknown): FieldSelectors {
  const fields = requirePlainObject(value, "selectors.fields");
  requireExactKeys(fields, fieldSelectorKeys, "selectors.fields", []);

  const parsedFields: FieldSelectors = {};
  for (const key of fieldSelectorKeys) {
    if (Object.hasOwn(fields, key)) {
      parsedFields[key] = readNonEmptyString(
        fields[key],
        `selectors.fields.${key}`,
      );
    }
  }

  return parsedFields;
}

function requirePlainObject(value: unknown, name: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${name} must be a plain JSON object`);
  }

  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  supportedKeys: readonly string[],
  name: string,
  requiredKeys: readonly string[] = supportedKeys,
): void {
  for (const key of Object.keys(value)) {
    if (!supportedKeys.includes(key)) {
      throw new Error(`unsupported key: ${key}`);
    }
  }

  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${name}.${key} is required`);
    }
  }
}

function readNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a nonempty string`);
  }

  return value;
}

function readPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function validatePageUrlPrefix(value: string): void {
  if (value.includes("?") || value.includes("#")) {
    throw new Error("pageUrlPrefix must not contain a query or hash delimiter");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("pageUrlPrefix must be a trusted HTTPS URL");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "yuntu.oceanengine.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("pageUrlPrefix must be a trusted HTTPS URL without query or hash");
  }
}
