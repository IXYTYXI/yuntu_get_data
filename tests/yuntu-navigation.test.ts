import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";

import { CollectorFailure } from "../src/domain.js";
import {
  buildCollectionPageUrl,
  ensureCollectionPage,
  findYuntuPage,
  isTaContentInsightPageUrl,
  isIndustryInspirationPageUrl,
  isTrustedYuntuOrigin,
  INDUSTRY_INSPIRATION_PAGE_PREFIX,
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

  async waitForURL(
    predicate: (url: URL) => boolean,
    _options?: { timeout?: number },
  ): Promise<void> {
    if (!predicate(new URL(this.location))) {
      throw new Error("url mismatch");
    }
  }

  locator(_selector: string): {
    first: () => { waitFor: (_options?: { state?: string; timeout?: number }) => Promise<void> };
  } {
    return {
      first: () => ({
        waitFor: async () => undefined,
      }),
    };
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

test("detects TA content insight URLs", () => {
  assert.equal(
    isTaContentInsightPageUrl(
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/ta_content?aadvid=1",
    ),
    true,
  );
  assert.equal(
    isTaContentInsightPageUrl(INDUSTRY_INSPIRATION_PAGE_PREFIX),
    false,
  );
});

test("detects industry inspiration URLs", () => {
  assert.equal(
    isIndustryInspirationPageUrl(
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/content_lab/inspiration/industryContent?aadvid=1",
    ),
    true,
  );
  assert.equal(
    isIndustryInspirationPageUrl(INDUSTRY_INSPIRATION_PAGE_PREFIX),
    true,
  );
});

test("buildCollectionPageUrl keeps query params from the active tab", () => {
  assert.equal(
    buildCollectionPageUrl(
      INDUSTRY_INSPIRATION_PAGE_PREFIX,
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/home/overview?aadvid=1767299333797891",
    ),
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/content_lab/inspiration/industryContent?aadvid=1767299333797891",
  );
});

test("buildCollectionPageUrl applies navigationQuery for content module", () => {
  assert.equal(
    buildCollectionPageUrl(
      INDUSTRY_INSPIRATION_PAGE_PREFIX,
      "https://yuntu.oceanengine.com/yuntu_brand/ecom/home/overview?aadvid=1767299333797891",
      { crowd_tab: "industry_intention" },
    ),
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/content_lab/inspiration/industryContent?aadvid=1767299333797891&crowd_tab=industry_intention",
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
      INDUSTRY_INSPIRATION_PAGE_PREFIX,
      0,
    ),
    overview,
  );
});

test("ensureCollectionPage navigates to the configured collection URL", async () => {
  const page = new NavigatingFakePage(
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/home/overview?aadvid=1767299333797891",
  );
  const prefix = INDUSTRY_INSPIRATION_PAGE_PREFIX;

  await ensureCollectionPage(page as unknown as Page, prefix);

  assert.equal(
    page.navigatedTo,
    "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/content_lab/inspiration/industryContent?aadvid=1767299333797891",
  );
});

test("ensureCollectionPage skips navigation when already on target path", async () => {
  const prefix = INDUSTRY_INSPIRATION_PAGE_PREFIX;
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
        INDUSTRY_INSPIRATION_PAGE_PREFIX,
      ),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
});
