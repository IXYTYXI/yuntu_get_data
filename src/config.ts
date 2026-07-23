import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CollectionConfig,
  FieldSelectors,
  OutputFormat,
  VisibleFilterStep,
} from "./domain.js";

const topLevelKeys = [
  "pageUrlPrefix",
  "resultLimit",
  "output",
  "filters",
  "selectors",
] as const;

const outputKeys = ["format", "path"] as const;
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

export function parseCollectionConfig(raw: unknown): CollectionConfig {
  const config = requirePlainObject(raw, "configuration");
  requireExactKeys(config, topLevelKeys, "configuration");

  const pageUrlPrefix = readNonEmptyString(
    config.pageUrlPrefix,
    "pageUrlPrefix",
  );
  validatePageUrlPrefix(pageUrlPrefix);

  return {
    pageUrlPrefix,
    resultLimit: readPositiveInteger(config.resultLimit, "resultLimit"),
    output: parseOutput(config.output),
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
  if (
    path.isAbsolute(outputPath) ||
    path.win32.isAbsolute(outputPath) ||
    path.win32.parse(outputPath).root !== "" ||
    outputPath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("output.path must be a safe relative path");
  }

  return { format: format as OutputFormat, path: outputPath };
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
