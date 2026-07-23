# Yuntu UI Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript command-line collector that operates only through a logged-in Yuntu browser UI, captures page-visible material metadata, verifies visible video playback, and writes JSONL or CSV without reading or storing media URLs or session data.

**Architecture:** The CLI attaches to an already-open, manually authenticated Chromium instance over CDP and selects the existing Yuntu tab; it never opens a direct media URL or accesses browser storage. The UI adapter applies configured visible filter actions and reads only visible fields, while pure domain/output modules validate configuration, produce typed states, and serialize approved fields. A disabled `AuthorizedDownloader` creates a hard boundary until an official export mechanism is approved.

**Tech Stack:** Node.js 20+, TypeScript, Playwright, Node built-in test runner, npm.

---

## File structure

- `package.json` — npm scripts and runtime/development dependencies.
- `tsconfig.json` — strict TypeScript build settings for Node ESM output.
- `.gitignore` — omit dependencies, compiled code, local config, and collection output.
- `config.example.json` — a safe selector-driven configuration template; it contains no secrets or media locations.
- `src/domain.ts` — shared collection, record, playback, download, and error contracts.
- `src/config.ts` — JSON parsing and validation for safe, selector-driven collection configuration.
- `src/output.ts` — JSONL and CSV serialization and output-file writing.
- `src/download/authorized-downloader.ts` — explicitly disabled v1 download adapter.
- `src/ui/yuntu-page.ts` — visible filter application, material card navigation, and existing-tab selection.
- `src/ui/material-detail.ts` — visible detail extraction and player-progress verification.
- `src/cli.ts` — argument parsing and orchestration.
- `tests/config.test.ts` — configuration validation coverage.
- `tests/output.test.ts` — serializer coverage.
- `tests/authorized-downloader.test.ts` — no-download safety boundary coverage.
- `tests/material-detail.test.ts` — playback-state and visible-text extraction coverage.
- `README.md` — setup, manually authenticated CDP workflow, safe operation, and known limitations.

### Task 1: Bootstrap a strict TypeScript project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `config.example.json`

- [ ] **Step 1: Create the npm manifest with deterministic scripts**

```json
{
  "name": "yuntu-ui-collector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "npm run build && node --test dist/tests/*.test.js",
    "start": "npm run build && node dist/src/cli.js"
  },
  "dependencies": { "playwright": "^1.55.0" },
  "devDependencies": { "@types/node": "^22.15.0", "typescript": "^5.8.3" }
}
```

- [ ] **Step 2: Create strict compiler and ignore configuration**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

```gitignore
node_modules/
dist/
output/
config.json
.DS_Store
```

- [ ] **Step 3: Create a non-secret example configuration**

```json
{
  "pageUrlPrefix": "https://yuntu.oceanengine.com/",
  "resultLimit": 5,
  "output": { "format": "jsonl", "path": "output/materials.jsonl" },
  "filters": [
    {
      "triggerSelector": "[data-testid='industry-filter']",
      "optionSelector": "[role='option'][data-value='example-industry']"
    }
  ],
  "selectors": {
    "resultCard": "[data-testid='material-card']",
    "detailPanel": "[role='dialog']",
    "closeDetail": "[aria-label='关闭']",
    "player": "video",
    "playButton": ".xg-start",
    "fields": {
      "materialId": "[data-testid='material-id']",
      "title": "[data-testid='material-title']",
      "duration": "[data-testid='material-duration']",
      "launchDate": "[data-testid='launch-date']",
      "industry": "[data-testid='industry']",
      "touchpoints": "[data-testid='touchpoints']",
      "metrics": "[data-testid='performance-metrics']",
      "script": "[data-testid='script']",
      "analysis": "[data-testid='content-analysis']"
    }
  }
}
```

- [ ] **Step 4: Install dependencies and prove the empty build is wired correctly**

Run: `npm install && npm run build`

Expected: npm creates `package-lock.json`; TypeScript exits `0` after source files are added in later tasks.

- [ ] **Step 5: Commit the bootstrap**

```bash
git add package.json package-lock.json tsconfig.json .gitignore config.example.json
git commit -m "chore: bootstrap yuntu UI collector"
```

### Task 2: Define safe data contracts and configuration validation

**Files:**
- Create: `src/domain.ts`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing configuration tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseCollectionConfig } from "../src/config.js";

const validConfig = {
  pageUrlPrefix: "https://yuntu.oceanengine.com/",
  resultLimit: 2,
  output: { format: "jsonl", path: "output/materials.jsonl" },
  filters: [],
  selectors: {
    resultCard: ".material-card",
    detailPanel: ".detail-panel",
    player: "video",
    playButton: ".xg-start",
    fields: { materialId: ".id", title: ".title" }
  }
};

test("accepts a safe visible-UI configuration", () => {
  assert.equal(parseCollectionConfig(validConfig).resultLimit, 2);
});

test("rejects an invalid page URL prefix", () => {
  assert.throws(() => parseCollectionConfig({ ...validConfig, pageUrlPrefix: "not-a-url" }), /pageUrlPrefix/);
});

test("rejects a configuration that attempts to declare a direct download URL", () => {
  assert.throws(
    () => parseCollectionConfig({ ...validConfig, downloadUrl: "https://example.invalid/video.mp4" }),
    /unsupported key: downloadUrl/
  );
});
```

- [ ] **Step 2: Run the test to establish the initial failure**

Run: `npm run build && node --test dist/tests/config.test.js`

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 3: Implement the domain contract and parser**

```ts
export type OutputFormat = "jsonl" | "csv";
export type PlaybackState = "verified" | "not-confirmed" | "unavailable";
export type DownloadState = "not-authorized";
export type CollectorErrorCode =
  | "AUTH_REQUIRED"
  | "SELECTOR_NOT_FOUND"
  | "PLAYBACK_NOT_CONFIRMED"
  | "DOWNLOAD_NOT_AUTHORIZED";

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
  output: { format: OutputFormat; path: string };
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
```

`parseCollectionConfig` must require exactly the supported top-level keys, validate the Yuntu HTTPS prefix, require a positive integer `resultLimit`, require a relative output path, and validate every selector as a nonempty string. It must reject all undeclared top-level keys so no direct-download, cookie, header, or token setting can silently enter the tool.

- [ ] **Step 4: Run configuration tests and the full test command**

Run: `npm test`

Expected: PASS with three tests.

- [ ] **Step 5: Commit domain and configuration behavior**

```bash
git add src/domain.ts src/config.ts tests/config.test.ts
git commit -m "feat: validate safe collector configuration"
```

### Task 3: Install a hard disabled-download boundary

**Files:**
- Create: `src/download/authorized-downloader.ts`
- Create: `tests/authorized-downloader.test.ts`

- [ ] **Step 1: Write the failing safety-boundary test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DisabledAuthorizedDownloader } from "../src/download/authorized-downloader.js";

test("v1 never downloads a video", async () => {
  const result = await new DisabledAuthorizedDownloader().download({ materialId: "m-1", title: "visible title" });
  assert.deepEqual(result, { state: "not-authorized", code: "DOWNLOAD_NOT_AUTHORIZED" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/tests/authorized-downloader.test.js`

Expected: FAIL because the downloader module does not exist.

- [ ] **Step 3: Implement the only v1 downloader**

```ts
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
    return { state: "not-authorized", code: "DOWNLOAD_NOT_AUTHORIZED" };
  }
}
```

- [ ] **Step 4: Run the targeted and complete tests**

Run: `npm test`

Expected: PASS; the test proves no network or filesystem media retrieval is available in v1.

- [ ] **Step 5: Commit the download boundary**

```bash
git add src/download/authorized-downloader.ts tests/authorized-downloader.test.ts
git commit -m "feat: add disabled authorized downloader boundary"
```

### Task 4: Serialize only approved record fields

**Files:**
- Create: `src/output.ts`
- Create: `tests/output.test.ts`
- Modify: `src/domain.ts`

- [ ] **Step 1: Write failing JSONL and CSV tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { serializeCsv, serializeJsonl } from "../src/output.js";

const record = {
  materialId: "m-1",
  title: "A, visible title",
  playback: { state: "verified" as const },
  download: { state: "not-authorized" as const, code: "DOWNLOAD_NOT_AUTHORIZED" as const },
  metrics: { "点赞": "12" }
};

test("serializes one record as newline-terminated JSONL", () => {
  assert.equal(serializeJsonl([record]), `${JSON.stringify(record)}\\n`);
});

test("quotes commas in CSV cells", () => {
  assert.match(serializeCsv([record]), /"A, visible title"/);
  assert.doesNotMatch(serializeCsv([record]), /https?:\\/\\//);
});
```

- [ ] **Step 2: Run the failing serializer test**

Run: `npm run build && node --test dist/tests/output.test.js`

Expected: FAIL because `src/output.ts` does not exist.

- [ ] **Step 3: Add a closed material-record schema and serializer**

Add a `MaterialRecord` interface to `src/domain.ts` with only `materialId`, `title`, optional visible metadata, `metrics`, `script`, `analysis`, `playback`, `download`, and optional typed errors. Implement `serializeJsonl`, `serializeCsv`, and `writeOutput(records, output)` in `src/output.ts`. CSV columns must be a fixed allowlist, and `escapeCsv` must wrap values containing a comma, quote, CR, or LF in quotes while doubling embedded quotes. `writeOutput` must create the configured parent directory and append a final newline.

- [ ] **Step 4: Run serializer and complete test suite**

Run: `npm test`

Expected: PASS; output contains no property outside the `MaterialRecord` allowlist.

- [ ] **Step 5: Commit safe output serialization**

```bash
git add src/domain.ts src/output.ts tests/output.test.ts
git commit -m "feat: serialize visible material records"
```

### Task 5: Build the visible UI and playback adapters

**Files:**
- Create: `src/ui/yuntu-page.ts`
- Create: `src/ui/material-detail.ts`
- Create: `tests/material-detail.test.ts`

- [ ] **Step 1: Write failing playback classification tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { classifyPlayback } from "../src/ui/material-detail.js";

test("marks player progress as verified", () => {
  assert.deepEqual(
    classifyPlayback({ paused: true, currentTime: 0 }, { paused: false, currentTime: 0.8 }),
    { state: "verified" }
  );
});

test("does not guess success when current time does not advance", () => {
  assert.deepEqual(
    classifyPlayback({ paused: true, currentTime: 0 }, { paused: false, currentTime: 0 }),
    { state: "not-confirmed", code: "PLAYBACK_NOT_CONFIRMED" }
  );
});
```

- [ ] **Step 2: Run the test to verify the initial failure**

Run: `npm run build && node --test dist/tests/material-detail.test.js`

Expected: FAIL because the detail adapter does not exist.

- [ ] **Step 3: Implement visible-only browser interactions**

In `src/ui/yuntu-page.ts`, export `findYuntuPage(browser, pageUrlPrefix)` that scans only existing open pages and returns a matching `Page` or throws `AUTH_REQUIRED`; do not call `page.goto`, inspect cookies, or obtain storage state. `YuntuPage.applyVisibleFilters()` must click each configured trigger and option only after `locator.isVisible()` succeeds. `YuntuPage.openMaterial(index)` must scroll the configured result card into view, click it, and wait for a visible detail panel. `closeMaterial()` must click the configured close selector when provided.

In `src/ui/material-detail.ts`, implement:

```ts
export interface PlayerSnapshot { paused: boolean; currentTime: number; }

export function classifyPlayback(before: PlayerSnapshot, after: PlayerSnapshot) {
  return !after.paused && after.currentTime > before.currentTime + 0.25
    ? { state: "verified" as const }
    : { state: "not-confirmed" as const, code: "PLAYBACK_NOT_CONFIRMED" as const };
}
```

`MaterialDetail.collect()` must first ensure the configured detail panel and each field locator are visible, then read their text. It must never call `getAttribute("src")`, inspect request events, or access a network API. `verifyPlayback()` must click the visible configured play button, take `{ paused, currentTime }` snapshots from the visible `HTMLVideoElement`, wait 750 ms, and return `classifyPlayback(before, after)`.

- [ ] **Step 4: Run unit tests and compile browser adapter code**

Run: `npm test`

Expected: PASS; tests run without a browser and browser-only operations are isolated from pure playback logic.

- [ ] **Step 5: Commit UI adapters**

```bash
git add src/ui/yuntu-page.ts src/ui/material-detail.ts tests/material-detail.test.ts
git commit -m "feat: collect visible details and verify playback"
```

### Task 6: Wire the CLI and document the authorised workflow

**Files:**
- Create: `src/cli.ts`
- Create: `README.md`

- [ ] **Step 1: Add a CLI acceptance test fixture in the README**

Document this exact command as the supported manual-authentication path:

```bash
google-chrome --remote-debugging-port=9222
npm start -- --config config.json --cdp-url http://127.0.0.1:9222
```

The README must state that the user signs in interactively in the browser, locally adapts safe visible selectors in `config.json`, and confirms the intended result scope before running. It must explicitly state that v1 does not download videos, extract media locations, access cookies/storage, or write Feishu Base records.

- [ ] **Step 2: Implement CLI argument parsing and orchestration**

`src/cli.ts` must require `--config` and accept an optional `--cdp-url` defaulting to `http://127.0.0.1:9222`. It loads and validates configuration, calls `chromium.connectOverCDP`, finds the already-open Yuntu page, applies filters, and processes `min(resultLimit, visibleCardCount)` cards. For every card it collects a typed record, invokes only `DisabledAuthorizedDownloader`, closes the detail panel, then writes all records using `writeOutput`.

For a per-card selector or playback failure, the CLI must emit a record with a typed error and continue. For an absent authenticated Yuntu page it must report `AUTH_REQUIRED` and exit nonzero. All logging of browser locations must use `new URL(location).origin + new URL(location).pathname` so query strings are never printed.

- [ ] **Step 3: Run a command-line help and build check**

Run: `npm run build && node dist/src/cli.js --help`

Expected: exit `0` and print `--config`, `--cdp-url`, and the declared no-download limitation.

- [ ] **Step 4: Run the complete unit test suite**

Run: `npm test`

Expected: PASS with configuration, download, output, and playback tests.

- [ ] **Step 5: Commit CLI and documentation**

```bash
git add src/cli.ts README.md
git commit -m "feat: add authorised UI collector CLI"
```

### Task 7: Verify, commit the approved scope, and publish matching history

**Files:**
- Modify: all files created above only when verification uncovers a defect.

- [ ] **Step 1: Perform static safety checks**

Run: `rg -n "(request\\(|response\\(|getAttribute\\(\\\"src|storageState|cookies\\(|download\\()" src tests`

Expected: only the disabled downloader interface and test references remain; there must be no request interception, response inspection, `src` extraction, storage access, or direct media fetch.

- [ ] **Step 2: Verify clean build and tests**

Run: `npm test && git status --short`

Expected: tests PASS; status lists only intended project files before staging.

- [ ] **Step 3: Set both requested remotes**

```bash
git remote add origin https://github.com/IXYTYXI/yuntu_get_data.git
git remote add gitlab https://gitlab.yc345.tv/fengyang1/yuntu_get_data.git
```

- [ ] **Step 4: Create one final intentional commit if needed**

```bash
git add README.md docs/superpowers/specs/2026-07-21-yuntu-ui-collector-design.md docs/superpowers/plans/2026-07-21-yuntu-ui-collector.md
git commit -m "docs: add collector design and implementation plan"
```

- [ ] **Step 5: Push the same branch to both remotes**

```bash
git push -u origin codex/yuntu-ui-collector
git push -u gitlab codex/yuntu-ui-collector
```

Expected: both hosts contain the same commit history on `codex/yuntu-ui-collector`. Do not create a pull request unless the user asks for one.

## Self-review

**Spec coverage:** Task 2 validates configuration; Task 5 applies visible filters, opens detail panels, reads visible metadata, and verifies player advance; Task 3 prohibits download; Task 4 writes JSONL/CSV; Task 6 attaches only to a manually authenticated browser and continues on per-material errors; Task 7 checks that no direct-media, network, session-storage, Feishu Base, or bulk-download path was introduced and publishes both requested remotes.

**Placeholder scan:** This plan contains no unresolved implementation placeholder; each task names exact files, a test or executable verification command, and an expected result.

**Type consistency:** `CollectionConfig`, `MaterialRecord`, `AuthorizedDownloader`, `DownloadResult`, `PlayerSnapshot`, and `classifyPlayback` are introduced before later tasks consume them. The only v1 download state remains `not-authorized` with code `DOWNLOAD_NOT_AUTHORIZED`.
