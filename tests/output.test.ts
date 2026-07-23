import assert from "node:assert/strict";
import {
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { MaterialRecord } from "../src/domain.js";
import {
  serializeCsv,
  serializeJsonl,
  writeOutput,
} from "../src/output.js";

const record: MaterialRecord = {
  materialId: "material-1",
  title: "Visible, material",
  duration: "00:30",
  launchDate: "2026-07-21",
  industry: "Retail",
  touchpoints: "Feed",
  metrics: { visibleText: "12" },
  script: "Visible script",
  analysis: "Visible analysis",
  playback: { state: "verified" },
  download: {
    state: "not-authorized",
    code: "DOWNLOAD_NOT_AUTHORIZED",
  },
  errors: [{ code: "PLAYBACK_NOT_CONFIRMED" }],
};

const recordWithNullOptionalValues = {
  ...record,
  materialId: "material-runtime-empty-optional",
  title: null,
  errors: [{ code: "PLAYBACK_NOT_CONFIRMED", message: null }],
} as unknown as MaterialRecord;

const recordWithNullErrors = {
  ...record,
  materialId: "material-runtime-empty-errors",
  title: null,
  errors: null,
} as unknown as MaterialRecord;

const recordWithNullPlaybackCode = {
  ...record,
  materialId: "material-runtime-empty-playback-code",
  playback: { state: "verified", code: null },
} as unknown as MaterialRecord;

const recordWithUnsafeVisibleValues: MaterialRecord = {
  materialId: "https://example.invalid/material",
  title: "token=opaque-token",
  duration: "file:opaque-file",
  launchDate: "DATA:opaque-data",
  industry: "session=opaque-session",
  touchpoints: "cookie=opaque-cookie",
  metrics: {
    visibleText: "javascript:generic-visible-metric",
    directMediaUrl: "unexpected-media-location",
  },
  script: "signature=opaque-signature",
  analysis: "authorization=opaque-authorization",
  playback: { state: "verified" },
  download: {
    state: "not-authorized",
    code: "DOWNLOAD_NOT_AUTHORIZED",
  },
  errors: [
    {
      code: "SELECTOR_NOT_FOUND",
      message: "HTTPS://example.invalid/error?token=opaque-error",
    },
  ],
};

const recordWithFormulaTitle: MaterialRecord = {
  ...record,
  materialId: "formula-material",
  title: "=SUM(1,1)",
};

const recordWithAuthLikeValues: MaterialRecord = {
  ...record,
  materialId: "auth=review-secret",
  title: "authentication=review-authentication",
  metrics: { visibleText: "bearer=review-bearer" },
  errors: [
    {
      code: "SELECTOR_NOT_FOUND",
      message: "AUTH=review-error",
    },
  ],
};

const recordsWithWhitespaceFormulaTitles: MaterialRecord[] = [
  { ...record, materialId: "formula-tab", title: "\t=1+1" },
  { ...record, materialId: "formula-space", title: "  +1" },
  { ...record, materialId: "formula-bom", title: "\uFEFF@value" },
];

const recordWithMaliciousRuntimeStatuses = {
  ...record,
  materialId: "safe-material",
  playback: {
    state: "session=playback-secret",
    code: "https://example.invalid/playback-code",
  },
  download: {
    state: null,
    code: "auth=download-secret",
  },
  errors: [
    {
      code: "bearer=error-secret",
      message: "safe error message",
    },
    {
      code: null,
      message: "second safe error message",
    },
  ],
} as unknown as MaterialRecord;

const recordWithProtocolRelativeUrl = {
  ...record,
  materialId: "protocol-relative-material",
  title: "//cdn.example.invalid/video.mp4?x=1",
  metrics: { visibleText: "//cdn.example.invalid/video.mp4?x=1" },
  errors: [
    {
      code: "SELECTOR_NOT_FOUND",
      message: "//cdn.example.invalid/video.mp4?x=1",
    },
  ],
} as unknown as MaterialRecord;

const recordWithAdditionalCredentialValues = {
  ...record,
  materialId: "sid=generic-sid-value",
  title: "jwt=generic-jwt-value",
  duration: "api_key=generic-api-key-value",
  launchDate: "api-key=generic-api-key-dash-value",
  industry: "session_id=generic-session-id-value",
  metrics: { visibleText: "Bearer generic-bearer-credential" },
  errors: [
    {
      code: "SELECTOR_NOT_FOUND",
      message: "sid=generic-error-sid-value",
    },
  ],
} as unknown as MaterialRecord;

const recordWithSeparatedApiKeyValues = {
  ...record,
  title: "api key=review-marker",
  metrics: { visibleText: "api.key=review-marker" },
  errors: [
    {
      code: "SELECTOR_NOT_FOUND",
      message: "api\tkey=review-marker",
    },
  ],
} as unknown as MaterialRecord;

test("serializes one material record as newline-terminated JSONL", () => {
  assert.equal(
    serializeJsonl([record]),
    `${JSON.stringify(record)}\n`,
  );
});

test("quotes a CSV title containing a comma", () => {
  const csv = serializeCsv([record]);

  assert.match(csv, /"Visible, material"/);
});

test("excludes unexpected runtime properties from JSONL and CSV", () => {
  const recordWithUnexpectedProperty = {
    ...record,
    directMediaUrl: "unexpected-media-location",
  };

  const jsonl = serializeJsonl([recordWithUnexpectedProperty]);
  const csv = serializeCsv([recordWithUnexpectedProperty]);

  assert.doesNotMatch(jsonl, /directMediaUrl|unexpected-media-location/);
  assert.doesNotMatch(csv, /directMediaUrl|unexpected-media-location/);
});

test("redacts unsafe visible values and drops arbitrary metrics", () => {
  const jsonl = serializeJsonl([recordWithUnsafeVisibleValues]);
  const csv = serializeCsv([recordWithUnsafeVisibleValues]);
  const serialized = JSON.parse(jsonl) as Record<string, unknown>;

  assert.equal(serialized.materialId, "[redacted]");
  assert.equal(serialized.title, "[redacted]");
  assert.equal(serialized.duration, "[redacted]");
  assert.equal(serialized.launchDate, "[redacted]");
  assert.equal(serialized.industry, "[redacted]");
  assert.equal(serialized.touchpoints, "[redacted]");
  assert.equal(serialized.script, "[redacted]");
  assert.equal(serialized.analysis, "[redacted]");
  assert.deepEqual(serialized.metrics, { visibleText: "[redacted]" });
  assert.deepEqual(serialized.errors, [
    { code: "SELECTOR_NOT_FOUND", message: "[redacted]" },
  ]);

  for (const rawFragment of [
    "example.invalid",
    "opaque-token",
    "opaque-file",
    "opaque-data",
    "opaque-session",
    "opaque-cookie",
    "generic-visible-metric",
    "unexpected-media-location",
    "opaque-signature",
    "opaque-authorization",
    "opaque-error",
    "directMediaUrl",
  ]) {
    assert.equal(jsonl.includes(rawFragment), false);
    assert.equal(csv.includes(rawFragment), false);
  }
});

test("neutralizes formula-like CSV cells before quoting", () => {
  const csv = serializeCsv([recordWithFormulaTitle]);

  assert.match(csv, /"'=SUM\(1,1\)"/);
  assert.doesNotMatch(csv, /"=SUM\(1,1\)"/);
});

test("redacts auth-like assignment values in JSONL and CSV", () => {
  const jsonl = serializeJsonl([recordWithAuthLikeValues]);
  const csv = serializeCsv([recordWithAuthLikeValues]);
  const serialized = JSON.parse(jsonl) as Record<string, unknown>;

  assert.equal(serialized.materialId, "[redacted]");
  assert.equal(serialized.title, "[redacted]");
  assert.deepEqual(serialized.metrics, { visibleText: "[redacted]" });
  assert.deepEqual(serialized.errors, [
    { code: "SELECTOR_NOT_FOUND", message: "[redacted]" },
  ]);

  for (const rawFragment of [
    "review-secret",
    "review-authentication",
    "review-bearer",
    "review-error",
  ]) {
    assert.equal(jsonl.includes(rawFragment), false);
    assert.equal(csv.includes(rawFragment), false);
  }
});

test("redacts protocol-relative URLs in visible output values", () => {
  const jsonl = serializeJsonl([recordWithProtocolRelativeUrl]);
  const csv = serializeCsv([recordWithProtocolRelativeUrl]);
  const serialized = JSON.parse(jsonl) as Record<string, unknown>;

  assert.equal(serialized.title, "[redacted]");
  assert.deepEqual(serialized.metrics, { visibleText: "[redacted]" });
  assert.deepEqual(serialized.errors, [
    { code: "SELECTOR_NOT_FOUND", message: "[redacted]" },
  ]);

  for (const rawFragment of ["cdn.example.invalid", "video.mp4", "x=1"]) {
    assert.equal(jsonl.includes(rawFragment), false);
    assert.equal(csv.includes(rawFragment), false);
  }
});

test("redacts common credential assignment and bearer forms", () => {
  const jsonl = serializeJsonl([recordWithAdditionalCredentialValues]);
  const csv = serializeCsv([recordWithAdditionalCredentialValues]);
  const serialized = JSON.parse(jsonl) as Record<string, unknown>;

  assert.equal(serialized.materialId, "[redacted]");
  assert.equal(serialized.title, "[redacted]");
  assert.equal(serialized.duration, "[redacted]");
  assert.equal(serialized.launchDate, "[redacted]");
  assert.equal(serialized.industry, "[redacted]");
  assert.deepEqual(serialized.metrics, { visibleText: "[redacted]" });
  assert.deepEqual(serialized.errors, [
    { code: "SELECTOR_NOT_FOUND", message: "[redacted]" },
  ]);

  for (const rawFragment of [
    "sid=",
    "generic-sid-value",
    "jwt=",
    "generic-jwt-value",
    "api_key=",
    "generic-api-key-value",
    "api-key=",
    "generic-api-key-dash-value",
    "session_id=",
    "generic-session-id-value",
    "Bearer",
    "generic-bearer-credential",
    "generic-error-sid-value",
  ]) {
    assert.equal(jsonl.includes(rawFragment), false);
    assert.equal(csv.includes(rawFragment), false);
  }
});

test("redacts api key forms with whitespace and punctuation separators", () => {
  const jsonl = serializeJsonl([recordWithSeparatedApiKeyValues]);
  const csv = serializeCsv([recordWithSeparatedApiKeyValues]);
  const serialized = JSON.parse(jsonl) as Record<string, unknown>;

  assert.equal(serialized.title, "[redacted]");
  assert.deepEqual(serialized.metrics, { visibleText: "[redacted]" });
  assert.deepEqual(serialized.errors, [
    { code: "SELECTOR_NOT_FOUND", message: "[redacted]" },
  ]);

  for (const rawFragment of [
    "api key=review-marker",
    "api.key=review-marker",
    "api\tkey=review-marker",
    "review-marker",
  ]) {
    assert.equal(jsonl.includes(rawFragment), false);
    assert.equal(csv.includes(rawFragment), false);
  }
});

test("neutralizes formulas preceded by whitespace or a BOM", () => {
  const csv = serializeCsv(recordsWithWhitespaceFormulaTitles);

  assert.match(csv, /formula-tab,'\t=1\+1,/);
  assert.match(csv, /formula-space,'  \+1,/);
  assert.match(csv, /formula-bom,'\uFEFF@value,/);
  assert.doesNotMatch(csv, /formula-tab,\t=1\+1,/);
  assert.doesNotMatch(csv, /formula-space,  \+1,/);
  assert.doesNotMatch(csv, /formula-bom,\uFEFF@value,/);
});

test("normalizes malicious runtime statuses and codes", () => {
  const jsonl = serializeJsonl([recordWithMaliciousRuntimeStatuses]);
  const csv = serializeCsv([recordWithMaliciousRuntimeStatuses]);
  const serialized = JSON.parse(jsonl) as Record<string, unknown>;

  assert.deepEqual(serialized.playback, { state: "unavailable" });
  assert.deepEqual(serialized.download, {
    state: "not-authorized",
    code: "DOWNLOAD_NOT_AUTHORIZED",
  });
  assert.deepEqual(serialized.errors, [
    { code: "SELECTOR_NOT_FOUND", message: "safe error message" },
    { code: "SELECTOR_NOT_FOUND", message: "second safe error message" },
  ]);

  for (const rawFragment of [
    "playback-secret",
    "example.invalid",
    "download-secret",
    "error-secret",
  ]) {
    assert.equal(jsonl.includes(rawFragment), false);
    assert.equal(csv.includes(rawFragment), false);
  }
});

test("omits runtime null optional values while retaining an error code", () => {
  const jsonl = serializeJsonl([recordWithNullOptionalValues]);
  const csv = serializeCsv([recordWithNullOptionalValues]);
  const serialized = JSON.parse(jsonl) as Record<string, unknown>;

  assert.equal(Object.hasOwn(serialized, "title"), false);
  assert.deepEqual(serialized.errors, [{ code: "PLAYBACK_NOT_CONFIRMED" }]);
  assert.doesNotMatch(jsonl, /:\s*null\b/);
  assert.doesNotMatch(csv, /\bnull\b/);
  assert.match(csv, /PLAYBACK_NOT_CONFIRMED/);
});

test("omits null error arrays from JSONL and CSV", () => {
  const jsonl = serializeJsonl([recordWithNullErrors]);
  const csv = serializeCsv([recordWithNullErrors]);
  const serialized = JSON.parse(jsonl) as Record<string, unknown>;

  assert.equal(Object.hasOwn(serialized, "title"), false);
  assert.equal(Object.hasOwn(serialized, "errors"), false);
  assert.doesNotMatch(jsonl, /:\s*null\b/);
  assert.doesNotMatch(csv, /\bnull\b/);
});

test("omits runtime null playback codes from JSONL and CSV", () => {
  const jsonl = serializeJsonl([recordWithNullPlaybackCode]);
  const csv = serializeCsv([recordWithNullPlaybackCode]);
  const serialized = JSON.parse(jsonl) as {
    playback: Record<string, unknown>;
  };

  assert.deepEqual(serialized.playback, { state: "verified" });
  assert.doesNotMatch(jsonl, /:\s*null\b/);
  assert.doesNotMatch(csv, /\bnull\b/);
});

test("writes serialized output in a newly created nested directory", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yuntu-output-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const outputPath = path.join("new", "nested", "materials.jsonl");
  await writeOutput(
    [record],
    { format: "jsonl", path: outputPath },
    directory,
  );

  assert.equal(
    await readFile(path.join(directory, outputPath), "utf8"),
    serializeJsonl([record]),
  );
});

test("replaces a hard-linked output target without modifying its external link", async (t) => {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "yuntu-output-root-"),
  );
  const externalDirectory = await mkdtemp(
    path.join(os.tmpdir(), "yuntu-output-external-"),
  );
  const externalPath = path.join(externalDirectory, "external.txt");
  const outputPath = path.join(rootDirectory, "materials.jsonl");
  t.after(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
    await rm(externalDirectory, { recursive: true, force: true });
  });

  await writeFile(externalPath, "external original content", "utf8");
  await link(externalPath, outputPath);

  await writeOutput(
    [record],
    { format: "jsonl", path: "materials.jsonl" },
    rootDirectory,
  );

  assert.equal(await readFile(externalPath, "utf8"), "external original content");
  assert.equal(await readFile(outputPath, "utf8"), serializeJsonl([record]));
});

test("rejects output paths that escape the configured root", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yuntu-output-root-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      writeOutput(
        [record],
        { format: "jsonl", path: "../materials.jsonl" },
        directory,
      ),
    /output root/,
  );
});

test("rejects output paths with an existing symlink component", async (t) => {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "yuntu-output-root-"),
  );
  const linkedTargetDirectory = await mkdtemp(
    path.join(os.tmpdir(), "yuntu-output-target-"),
  );
  t.after(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
    await rm(linkedTargetDirectory, { recursive: true, force: true });
  });

  await symlink(linkedTargetDirectory, path.join(rootDirectory, "linked"));

  await assert.rejects(
    () =>
      writeOutput(
        [record],
        { format: "jsonl", path: path.join("linked", "materials.jsonl") },
        rootDirectory,
      ),
    /symlink/,
  );
});

test("rejects a symlink output root before writing", async (t) => {
  const rootLinkParent = await mkdtemp(
    path.join(os.tmpdir(), "yuntu-output-root-link-"),
  );
  const linkedTargetDirectory = await mkdtemp(
    path.join(os.tmpdir(), "yuntu-output-root-target-"),
  );
  const linkedRoot = path.join(rootLinkParent, "linked-root");
  const targetOutputPath = path.join(linkedTargetDirectory, "materials.jsonl");
  t.after(async () => {
    await rm(rootLinkParent, { recursive: true, force: true });
    await rm(linkedTargetDirectory, { recursive: true, force: true });
  });

  await symlink(linkedTargetDirectory, linkedRoot);

  await assert.rejects(
    () =>
      writeOutput(
        [record],
        { format: "jsonl", path: "materials.jsonl" },
        linkedRoot,
      ),
    /symlink/,
  );
  await assert.rejects(() => readFile(targetOutputPath, "utf8"), /ENOENT/);
});

test("rejects a non-directory output root", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yuntu-output-root-"));
  const rootFile = path.join(directory, "output-root-file");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  await writeFile(rootFile, "not a directory", "utf8");
  await assert.rejects(
    () =>
      writeOutput(
        [record],
        { format: "jsonl", path: "materials.jsonl" },
        rootFile,
      ),
    /output root/,
  );
});
