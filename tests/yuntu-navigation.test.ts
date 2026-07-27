import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";

import { CollectorFailure } from "../src/domain.js";
import {
  buildCollectionPageUrl,
  ensureCollectionPage,
  findYuntuPage,
  isTrustedYuntuOrigin,
} from "../src/ui/yuntu-page.js";

class NavigatingFakePage {
  navigatedTo: string | undefined;
  readonly waits: number[] = [];

  constructor(private location: string) {}

  url(): string {
    return this.location;
  }

  async goto(destination: string): Promise<void> {
    this.navigatedTo = destination;
    this.location = destination;
  }

  async waitForTimeout(milliseconds: number): Promise<void> {
    this.waits.push(milliseconds);
  }
}

test("detects the trusted Yuntu origin", () => {
  assert.equal(
    isTrustedYuntuOrigin(
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/home/overview?aadvid=1",
    ),
    true,
  );
  assert.equal(isTrustedYuntuOrigin("https://example.invalid/"), false);
  assert.equal(
    isTrustedYuntuOrigin("blob:https://yuntu.oceanengine.com/uuid"),
    false,
  );
});

test("buildCollectionPageUrl keeps query params from the active tab", () => {
  assert.equal(
    buildCollectionPageUrl(
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/ta_content",
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/home/overview?aadvid=1767299333797891",
    ),
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/ta_content?aadvid=1767299333797891",
  );
});

test("findYuntuPage accepts a signed-in overview tab before navigation", () => {
  const overview = {
    url: () =>
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/home/overview?aadvid=1",
  } as unknown as Page;
  const browser = {
    contexts: () => [{ pages: () => [overview] }],
  };

  assert.equal(
    findYuntuPage(
      browser as never,
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/ta_content",
      0,
    ),
    overview,
  );
});

test("ensureCollectionPage navigates to the configured collection URL", async () => {
  const page = new NavigatingFakePage(
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/home/overview?aadvid=1767299333797891",
  );
  const prefix =
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/ta_content";

  await ensureCollectionPage(page as unknown as Page, prefix);

  assert.equal(
    page.navigatedTo,
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/ta_content?aadvid=1767299333797891",
  );
});

test("ensureCollectionPage skips navigation when already on target path", async () => {
  const prefix =
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/ta_content";
  const page = new NavigatingFakePage(
    `${prefix}?aadvid=1767299333797891`,
  );

  await ensureCollectionPage(page as unknown as Page, prefix);

  assert.equal(page.navigatedTo, undefined);
});

test("ensureCollectionPage rejects non-Yuntu tabs", async () => {
  const page = new NavigatingFakePage("https://example.invalid/");

  await assert.rejects(
    () =>
      ensureCollectionPage(
        page as unknown as Page,
        "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/ta_content",
      ),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
});
