import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "playwright";

import {
  CLI_HELP_TEXT,
  main,
  parseCliArgs,
  sanitizeBrowserLocation,
  withConnectedBrowser,
} from "../src/cli.js";

test("disconnects the CDP client after a successful operation", async () => {
  const events: string[] = [];
  const browser = {
    async close(): Promise<void> {
      events.push("close");
    },
  } as unknown as Browser;

  const result = await withConnectedBrowser(
    async (cdpUrl) => {
      events.push(`connect:${cdpUrl}`);
      return browser;
    },
    "http://127.0.0.1:9222",
    async (connectedBrowser) => {
      assert.equal(connectedBrowser, browser);
      events.push("operation");
      return "complete";
    },
  );

  assert.equal(result, "complete");
  assert.deepEqual(events, [
    "connect:http://127.0.0.1:9222",
    "operation",
    "close",
  ]);
});

test("disconnects the CDP client after an operation failure", async () => {
  let closeCalls = 0;
  const browser = {
    async close(): Promise<void> {
      closeCalls += 1;
    },
  } as unknown as Browser;

  await assert.rejects(
    () =>
      withConnectedBrowser(
        async () => browser,
        "http://127.0.0.1:9222",
        async () => {
          throw new Error("operation failed");
        },
      ),
    /operation failed/,
  );

  assert.equal(closeCalls, 1);
});

test("parses a configuration path with the default CDP URL", () => {
  assert.deepEqual(parseCliArgs(["--config", "config.json"]), {
    configPath: "config.json",
    cdpUrl: "http://127.0.0.1:9222",
    pageIndex: undefined,
    dryRun: false,
    help: false,
  });
});

test("parses an explicit CDP URL with dry-run enabled", () => {
  assert.deepEqual(
    parseCliArgs([
      "--config",
      "config.json",
      "--cdp-url",
      "http://127.0.0.1:9333",
      "--page-index",
      "2",
      "--dry-run",
    ]),
    {
      configPath: "config.json",
      cdpUrl: "http://127.0.0.1:9333",
      pageIndex: 2,
      dryRun: true,
      help: false,
    },
  );
});

test("rejects invalid target page indexes without echoing values", () => {
  for (const pageIndex of ["-1", "1.5", "not-a-number"]) {
    assert.throws(
      () =>
        parseCliArgs([
          "--config",
          "config.json",
          "--page-index",
          pageIndex,
        ]),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Invalid target page index" &&
        !error.message.includes(pageIndex),
    );
  }
});

test("accepts loopback CDP endpoints", () => {
  for (const cdpUrl of [
    "http://localhost:9222/",
    "http://[::1]:9222/",
  ]) {
    assert.equal(
      parseCliArgs(["--config", "config.json", "--cdp-url", cdpUrl])
        .cdpUrl,
      cdpUrl,
    );
  }
});

test("rejects non-local CDP endpoints without echoing them", () => {
  for (const cdpUrl of [
    "http://remote-secret.example.test:9222/",
    "https://127.0.0.1:9222/",
    "ws://127.0.0.1:9222/",
    "file:///private/secret",
    "http://operator:password@127.0.0.1:9222/",
    "http://127.0.0.1:9222/?token=redacted",
    "http://127.0.0.1:9222/#session=private",
    "http://127.0.0.1:9222/devtools",
  ]) {
    assert.throws(
      () => parseCliArgs(["--config", "config.json", "--cdp-url", cdpUrl]),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Invalid local CDP endpoint" &&
        !error.message.includes("remote-secret") &&
        !error.message.includes("password") &&
        !error.message.includes("redacted") &&
        !error.message.includes("private"),
    );
  }
});

test("rejects missing configuration and option values", () => {
  assert.throws(() => parseCliArgs([]), /--config is required/);
  assert.throws(
    () => parseCliArgs(["--config", "--dry-run"]),
    /--config requires a value/,
  );
  assert.throws(
    () => parseCliArgs(["--config", "config.json", "--cdp-url"]),
    /--cdp-url requires a value/,
  );
});

test("rejects an unknown argument without echoing it", () => {
  const unsafeArgument = "--session-token=secret";

  assert.throws(
    () => parseCliArgs(["--config", "config.json", unsafeArgument]),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Unknown command-line argument" &&
      !error.message.includes("secret"),
  );
});

test("does not log raw unknown CLI input", async () => {
  const messages: string[] = [];

  const exitCode = await main(["--session-token=secret"], {
    log: (message) => messages.push(message),
    error: (message) => messages.push(message),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(messages, ["Unknown command-line argument"]);
  assert.doesNotMatch(messages.join("\n"), /secret/);
});

test("does not log a rejected secret-bearing CDP endpoint", async () => {
  const messages: string[] = [];

  const exitCode = await main(
    [
      "--config",
      "config.json",
      "--cdp-url",
      "http://operator:password@remote-secret.example.test:9222/?token=redacted",
    ],
    {
      log: (message) => messages.push(message),
      error: (message) => messages.push(message),
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(messages, ["Invalid local CDP endpoint"]);
  assert.doesNotMatch(
    messages.join("\n"),
    /operator|password|remote-secret|redacted/,
  );
});

test("sanitizes a trusted browser location to its fixed origin", () => {
  const sanitized = sanitizeBrowserLocation(
    "https://yuntu.oceanengine.com/private/session-secret/video.mp4?token=redacted",
  );

  assert.equal(sanitized, "https://yuntu.oceanengine.com");
  assert.doesNotMatch(sanitized, /private|session-secret|video\.mp4|redacted/);
});

test("uses a fixed non-sensitive placeholder for untrusted browser locations", () => {
  for (const unsafeInput of [
    "javascript:token=private",
    "data:text/plain,session=private",
    "file:///private/secret.mp4",
    "https://example.com/creative-center?token=private",
    "http://yuntu.oceanengine.com/creative-center?token=private",
    "https://yuntu.oceanengine.com:8443/creative-center?token=private",
    "https://user:password@yuntu.oceanengine.com/creative-center?token=private",
    "not a URL?token=private",
  ]) {
    const sanitized = sanitizeBrowserLocation(unsafeInput);

    assert.equal(sanitized, "unavailable-browser-location");
    assert.doesNotMatch(sanitized, /private|secret|password|not a URL/);
  }
});

test("documents the v1 no-download limit in the help text", () => {
  assert.match(CLI_HELP_TEXT, /--config/);
  assert.match(CLI_HELP_TEXT, /--cdp-url/);
  assert.match(CLI_HELP_TEXT, /--page-index/);
  assert.match(CLI_HELP_TEXT, /--dry-run/);
  assert.match(CLI_HELP_TEXT, /does NOT download video/i);
  assert.match(CLI_HELP_TEXT, /extract media locations/i);
  assert.match(CLI_HELP_TEXT, /access cookies\/storage/i);
  assert.match(CLI_HELP_TEXT, /write Feishu Base/i);
});

test("allows help without a configuration path", () => {
  assert.deepEqual(parseCliArgs(["--help"]), {
    configPath: undefined,
    cdpUrl: "http://127.0.0.1:9222",
    pageIndex: undefined,
    dryRun: false,
    help: true,
  });
});
