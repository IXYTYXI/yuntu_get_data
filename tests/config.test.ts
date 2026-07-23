import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCollectionConfig,
  parseCollectionConfig,
} from "../src/config.js";

const validConfig = () => ({
  pageUrlPrefix: "https://yuntu.oceanengine.com/creative-center",
  resultLimit: 12,
  output: {
    format: "jsonl",
    path: "output/collection.jsonl",
  },
  filters: [
    {
      triggerSelector: "[data-testid=industry-filter]",
      optionSelector: "[data-testid=industry-option]",
    },
  ],
  selectors: {
    resultCard: "[data-testid=result-card]",
    detailPanel: "[data-testid=detail-panel]",
    closeDetail: "[data-testid=close-detail]",
    player: "video",
    playButton: "[data-testid=play-button]",
    fields: {
      materialId: "[data-testid=material-id]",
      title: "[data-testid=title]",
      duration: "[data-testid=duration]",
      launchDate: "[data-testid=launch-date]",
      industry: "[data-testid=industry]",
      touchpoints: "[data-testid=touchpoints]",
      metrics: "[data-testid=metrics]",
      script: "[data-testid=script]",
      analysis: "[data-testid=analysis]",
    },
  },
});

test("accepts a valid configuration and preserves resultLimit", () => {
  const config = parseCollectionConfig(validConfig());

  assert.equal(config.resultLimit, 12);
});

test("rejects page URL prefixes outside the trusted HTTPS origin", () => {
  for (const pageUrlPrefix of [
    "http://yuntu.oceanengine.com/creative-center",
    "https://example.com/creative-center",
    "https://yuntu.oceanengine.com/creative-center?tab=all",
    "https://yuntu.oceanengine.com/creative-center#materials",
    "https://yuntu.oceanengine.com/creative-center?",
    "https://yuntu.oceanengine.com/creative-center#",
  ]) {
    const config = validConfig();
    config.pageUrlPrefix = pageUrlPrefix;

    assert.throws(() => parseCollectionConfig(config), /pageUrlPrefix/);
  }
});

test("rejects undeclared top-level keys", () => {
  const config = {
    ...validConfig(),
    downloadUrl: "https://media.example/video.mp4",
  };

  assert.throws(
    () => parseCollectionConfig(config),
    /unsupported key: downloadUrl/,
  );
});

test("rejects absolute and traversal output paths", () => {
  for (const outputPath of [
    "/tmp/collection.jsonl",
    "../collection.jsonl",
    "output/../collection.jsonl",
  ]) {
    const config = validConfig();
    config.output.path = outputPath;

    assert.throws(() => parseCollectionConfig(config), /output/);
  }
});

test("rejects Windows drive-relative output paths", () => {
  const config = validConfig();
  config.output.path = "C:collection.jsonl";

  assert.throws(
    () => parseCollectionConfig(config),
    /output\.path must be a safe relative path/,
  );
});

test("accepts only plain JSON objects with a positive integer result limit", () => {
  for (const raw of [null, [], new Date()]) {
    assert.throws(() => parseCollectionConfig(raw), /configuration/);
  }

  for (const resultLimit of [0, -1, 1.5, Number.NaN, "12"]) {
    assert.throws(
      () => parseCollectionConfig({ ...validConfig(), resultLimit }),
      /resultLimit/,
    );
  }
});

test("requires only a supported output format and output keys", () => {
  assert.throws(
    () =>
      parseCollectionConfig({
        ...validConfig(),
        output: { format: "xml", path: "output/collection.xml" },
      }),
    /output.format/,
  );

  assert.throws(
    () =>
      parseCollectionConfig({
        ...validConfig(),
        output: { format: "csv", path: "" },
      }),
    /output.path/,
  );

  assert.throws(
    () =>
      parseCollectionConfig({
        ...validConfig(),
        output: {
          format: "csv",
          path: "output/collection.csv",
          storage: "s3",
        },
      }),
    /unsupported key: storage/,
  );
});

test("requires each filter step to contain only nonempty visible selectors", () => {
  assert.throws(
    () => parseCollectionConfig({ ...validConfig(), filters: {} }),
    /filters/,
  );

  assert.throws(
    () =>
      parseCollectionConfig({
        ...validConfig(),
        filters: [{ triggerSelector: "", optionSelector: "[data-option]" }],
      }),
    /filters\[0\]\.triggerSelector/,
  );

  assert.throws(
    () =>
      parseCollectionConfig({
        ...validConfig(),
        filters: [
          {
            triggerSelector: "[data-filter]",
            optionSelector: "[data-option]",
            downloadUrl: "https://media.example/video.mp4",
          },
        ],
      }),
    /unsupported key: downloadUrl/,
  );
});

test("requires visible selectors and permits an omitted close detail selector", () => {
  const config = validConfig();
  const { resultCard: _resultCard, ...withoutResultCard } = config.selectors;
  assert.throws(
    () => parseCollectionConfig({ ...config, selectors: withoutResultCard }),
    /selectors\.resultCard/,
  );

  assert.throws(
    () =>
      parseCollectionConfig({
        ...validConfig(),
        selectors: {
          ...validConfig().selectors,
          closeDetail: "",
        },
      }),
    /selectors\.closeDetail/,
  );

  const withCloseDetail = validConfig();
  const { closeDetail: _closeDetail, ...withoutCloseDetail } =
    withCloseDetail.selectors;
  assert.equal(
    parseCollectionConfig({
      ...withCloseDetail,
      selectors: withoutCloseDetail,
    }).selectors.closeDetail,
    undefined,
  );
});

test("permits only nonempty supported field selector values", () => {
  assert.throws(
    () =>
      parseCollectionConfig({
        ...validConfig(),
        selectors: {
          ...validConfig().selectors,
          fields: { materialId: "" },
        },
      }),
    /selectors\.fields\.materialId/,
  );

  assert.throws(
    () =>
      parseCollectionConfig({
        ...validConfig(),
        selectors: {
          ...validConfig().selectors,
          fields: { accessToken: "secret" },
        },
      }),
    /unsupported key: accessToken/,
  );

  const config = parseCollectionConfig({
    ...validConfig(),
    selectors: {
      ...validConfig().selectors,
      fields: {},
    },
  });
  assert.deepEqual(config.selectors.fields, {});
});

test("loads UTF-8 JSON and delegates validation to the parser", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yuntu-config-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const validPath = path.join(directory, "valid.json");
  await writeFile(validPath, JSON.stringify(validConfig()), "utf8");
  assert.equal((await loadCollectionConfig(validPath)).resultLimit, 12);

  const invalidPath = path.join(directory, "invalid.json");
  await writeFile(
    invalidPath,
    JSON.stringify({ ...validConfig(), downloadUrl: "https://media.example/video.mp4" }),
    "utf8",
  );
  await assert.rejects(
    () => loadCollectionConfig(invalidPath),
    /unsupported key: downloadUrl/,
  );
});
