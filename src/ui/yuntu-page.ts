import type { Browser, Locator, Page } from "playwright";

import {
  CollectorFailure,
  type CollectionConfig,
  type VisibleFilterStep,
} from "../domain.js";
import {
  dateRangeInputSelector,
  dateRangeQuickSelectLabel,
  inclusiveDayCount,
  parseDateRangeValue,
} from "./date-range.js";

export const DEFAULT_YUNTU_PAGE_PREFIX = "https://yuntu.oceanengine.com/";
export const TRUSTED_PAGE_FAILURE_MESSAGE =
  "Configured Yuntu page is outside the trusted scope";
const TARGET_PAGE_SELECTION_FAILURE_MESSAGE =
  "Sign in to Yuntu in the debugging Chrome window and select a Yuntu tab";
const TRUSTED_YUNTU_ORIGIN = "https://yuntu.oceanengine.com";

export function isTrustedYuntuOrigin(location: string): boolean {
  try {
    const candidate = new URL(location);
    return (
      candidate.protocol === "https:" &&
      candidate.hostname === "yuntu.oceanengine.com" &&
      candidate.port === "" &&
      candidate.username === "" &&
      candidate.password === ""
    );
  } catch {
    return false;
  }
}

export function buildCollectionPageUrl(
  pageUrlPrefix: string,
  referenceLocation: string,
): string {
  const target = new URL(pageUrlPrefix);
  if (target.search !== "" || target.hash !== "") {
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      "pageUrlPrefix must not contain a query or hash delimiter",
    );
  }

  const reference = new URL(referenceLocation);
  if (target.search === "" && reference.search !== "") {
    target.search = reference.search;
  }

  return target.toString();
}

export async function ensureCollectionPage(
  page: Page,
  pageUrlPrefix: string,
): Promise<void> {
  let location: string;
  try {
    location = page.url();
  } catch {
    throw targetPageSelectionFailure();
  }

  if (!isTrustedYuntuOrigin(location)) {
    throw targetPageSelectionFailure();
  }

  if (isTrustedPageUrl(location, pageUrlPrefix)) {
    return;
  }

  const destination = buildCollectionPageUrl(pageUrlPrefix, location);
  if (!isTrustedPageUrl(destination, pageUrlPrefix)) {
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      TRUSTED_PAGE_FAILURE_MESSAGE,
    );
  }

  try {
    await page.goto(destination, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message.replace(/\s+/g, " ").trim().slice(0, 160)
        : "navigation failed";
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      `Collection page navigation failed: ${detail}`,
    );
  }

  try {
    await page.waitForURL(
      (url) => isTrustedPageUrl(url.toString(), pageUrlPrefix),
      { timeout: 60_000 },
    );
  } catch {
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      "Collection page URL did not reach the configured prefix after navigation",
    );
  }

  const dateInput = page.locator(dateRangeInputSelector()).first();
  try {
    await dateInput.waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      "Collection page date filter did not become visible after navigation",
    );
  }

  await page.waitForTimeout(1500);

  if (!isTrustedPageUrl(page.url(), pageUrlPrefix)) {
    throw targetPageSelectionFailure();
  }
}

export function isTrustedPageUrl(
  location: string,
  pageUrlPrefix: string,
): boolean {
  try {
    const candidate = new URL(location);
    const prefix = new URL(pageUrlPrefix);
    if (
      prefix.search !== "" ||
      prefix.hash !== "" ||
      candidate.origin !== prefix.origin
    ) {
      return false;
    }

    const prefixPath = normalizedPrefixPath(prefix.pathname);
    return (
      prefixPath === "/" ||
      candidate.pathname === prefixPath ||
      candidate.pathname.startsWith(`${prefixPath}/`)
    );
  } catch {
    return false;
  }
}

export function assertTrustedPage(page: Page, pageUrlPrefix: string): void {
  let location: string;
  try {
    location = page.url();
  } catch {
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      TRUSTED_PAGE_FAILURE_MESSAGE,
    );
  }

  if (!isTrustedPageUrl(location, pageUrlPrefix)) {
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      TRUSTED_PAGE_FAILURE_MESSAGE,
    );
  }
}

export function findYuntuPage(
  browser: Browser,
  pageUrlPrefix: string,
  pageIndex?: number,
): Page {
  let contexts;
  try {
    contexts = browser.contexts();
  } catch {
    throw targetPageSelectionFailure();
  }

  if (contexts.length !== 1) {
    throw targetPageSelectionFailure();
  }

  let pages: Page[];
  try {
    pages = contexts[0].pages();
  } catch {
    throw targetPageSelectionFailure();
  }

  const selectedPage = selectTargetPage(pages, pageIndex);
  assertTrustedYuntuSessionPage(selectedPage);

  return selectedPage;
}

function assertTrustedYuntuSessionPage(page: Page): void {
  let location: string;
  try {
    location = page.url();
  } catch {
    throw targetPageSelectionFailure();
  }

  if (!isTrustedYuntuOrigin(location)) {
    throw targetPageSelectionFailure();
  }
}

function selectTargetPage(pages: Page[], pageIndex: number | undefined): Page {
  if (pageIndex === undefined) {
    if (pages.length !== 1) {
      throw targetPageSelectionFailure();
    }

    return pages[0];
  }

  if (
    !Number.isSafeInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= pages.length
  ) {
    throw targetPageSelectionFailure();
  }

  return pages[pageIndex];
}

function targetPageSelectionFailure(): CollectorFailure {
  return new CollectorFailure(
    "AUTH_REQUIRED",
    TARGET_PAGE_SELECTION_FAILURE_MESSAGE,
  );
}

export class YuntuPage {
  constructor(
    private readonly page: Page,
    private readonly selectors: CollectionConfig["selectors"],
    private readonly filters: readonly VisibleFilterStep[],
    private readonly pageUrlPrefix = DEFAULT_YUNTU_PAGE_PREFIX,
  ) {}

  async applyVisibleFilters(): Promise<void> {
    this.assertCurrentPageTrusted();

    for (const filter of this.filters) {
      await this.clickVisible(
        this.page.locator(filter.triggerSelector),
        "filter trigger",
      );
      await this.clickVisible(
        this.page.locator(filter.optionSelector),
        "filter option",
      );
    }
  }

  async applyDateRangeDays(days: number): Promise<void> {
    this.assertCurrentPageTrusted();
    const quickSelectLabel = dateRangeQuickSelectLabel(days);
    if (quickSelectLabel === null) {
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Configured date range days is not supported by the Yuntu quick select",
      );
    }

    const picker = this.page.locator(".content-ecom-yuntu-yuntu-date-picker").first();
    const dateInput = this.page.locator(dateRangeInputSelector()).first();
    await this.waitForVisible(dateInput, "date range input");
    await this.guardedDomOperation(() => picker.scrollIntoViewIfNeeded());

    const beforeValue = await this.guardedDomOperation(() => dateInput.inputValue());
    await this.selectDateRangeQuickOption(picker, quickSelectLabel);
    await this.page.waitForTimeout(1500);

    const afterValue = await this.guardedDomOperation(() => dateInput.inputValue());
    if (afterValue !== beforeValue) {
      await this.page.waitForTimeout(1000);
      return;
    }

    await this.selectDateRangeQuickOption(picker, quickSelectLabel);
    await this.page.waitForTimeout(2000);

    const retriedValue = await this.guardedDomOperation(() => dateInput.inputValue());
    if (retriedValue === beforeValue) {
      const parsed = parseDateRangeValue(retriedValue);
      if (
        parsed !== null &&
        inclusiveDayCount(parsed.start, parsed.end) === days
      ) {
        return;
      }

      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Date range quick select did not update the configured range",
      );
    }
  }

  async searchCompetitorBrand(brandName: string): Promise<void> {
    this.assertCurrentPageTrusted();
    const searchInput = this.page.locator("input.brand_main-input").first();
    await this.waitForVisible(searchInput, "brand search input");
    await this.guardedDomOperation(async () => {
      await searchInput.fill("");
      await searchInput.fill(brandName);
      await searchInput.press("Enter");
    });
    await this.page.waitForTimeout(2500);
  }

  async visibleMaterialCount(): Promise<number> {
    this.assertCurrentPageTrusted();
    return (await this.visibleCards()).length;
  }

  async openMaterial(index: number): Promise<void> {
    this.assertCurrentPageTrusted();
    await this.dismissBlockingOverlays();

    if (!Number.isSafeInteger(index) || index < 0) {
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Material card index is not valid",
      );
    }

    const card = (await this.visibleCards())[index];
    if (card === undefined) {
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Visible material card was not found",
      );
    }

    await this.waitForVisible(card, "material card");
    try {
      await this.guardedDomOperation(() => card.scrollIntoViewIfNeeded());
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Visible material card could not be scrolled into view",
      );
    }
    await this.clickVisible(card, "material card");

    const detailPanel = this.page.locator(this.selectors.detailPanel);
    try {
      await this.guardedDomOperation(() =>
        detailPanel.waitFor({ state: "visible" }),
      );
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Configured detail panel did not become visible",
      );
    }
    await this.requireVisible(detailPanel, "detail panel");
  }

  async closeMaterial(): Promise<void> {
    this.assertCurrentPageTrusted();

    if (this.selectors.closeDetail === undefined) {
      return;
    }
    const detailPanel = this.page.locator(this.selectors.detailPanel);
    await this.waitForVisible(detailPanel, "detail panel");
    await this.clickVisible(
      detailPanel.locator(this.selectors.closeDetail).first(),
      "detail close button",
    );

    try {
      await this.guardedDomOperation(() =>
        detailPanel.waitFor({ state: "hidden", timeout: 3000 }),
      );
    } catch (error) {
      this.rethrowCollectorFailure(error);
      return;
    }
  }

  private async selectDateRangeQuickOption(
    picker: Locator,
    quickSelectLabel: string,
  ): Promise<void> {
    const suffix = picker
      .locator(".content-ecom-date-picker .content-ecom-input-suffix")
      .first();
    await this.waitForVisible(suffix, "date range picker trigger");
    await this.guardedDomOperation(() => suffix.click({ force: true }));

    const popover = this.page.locator(
      ".oc-content-ecom-daterange-picker__pop.content-ecom-popover-show",
    );
    try {
      await this.guardedDomOperation(() =>
        popover.waitFor({ state: "visible", timeout: 5000 }),
      );
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Date range picker popover did not open",
      );
    }

    const quickOption = popover
      .locator("a.content-ecom-link")
      .filter({ hasText: quickSelectLabel })
      .first();
    await this.waitForVisible(quickOption, "date range quick select option");
    await this.guardedDomOperation(() => quickOption.click());
    await this.guardedDomOperation(() =>
      popover.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined),
    );
  }

  private async visibleCards(): Promise<Locator[]> {
    const cards = this.page.locator(this.selectors.resultCard);
    let count: number;
    try {
      count = await this.guardedDomOperation(() => cards.count());
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Configured material card selector is not available",
      );
    }

    const visibleCards: Locator[] = [];
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      if (await this.isVisible(card, "material card")) {
        visibleCards.push(card);
      }
    }

    return visibleCards;
  }

  private async clickVisible(locator: Locator, name: string): Promise<void> {
    await this.waitForVisible(locator, name);
    try {
      await this.guardedDomOperation(() => locator.click({ timeout: 5000 }));
    } catch (error) {
      this.rethrowCollectorFailure(error);
      try {
        await this.guardedDomOperation(() => locator.click({ force: true, timeout: 5000 }));
        return;
      } catch (forcedError) {
        this.rethrowCollectorFailure(forcedError);
      }
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        `Visible ${name} could not be clicked`,
      );
    }

  }

  private assertCurrentPageTrusted(): void {
    assertTrustedPage(this.page, this.pageUrlPrefix);
  }

  private async waitForVisible(locator: Locator, name: string): Promise<void> {
    try {
      await this.guardedDomOperation(() =>
        locator.waitFor({ state: "visible" }),
      );
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        `Configured ${name} selector did not become visible`,
      );
    }

    await this.requireVisible(locator, name);
  }

  private async requireVisible(locator: Locator, name: string): Promise<void> {
    if (!(await this.isVisible(locator, name))) {
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        `Configured ${name} selector is not visible`,
      );
    }
  }

  private async isVisible(locator: Locator, name: string): Promise<boolean> {
    try {
      return await this.guardedDomOperation(() => locator.isVisible());
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        `Configured ${name} selector is not available`,
      );
    }
  }

  private async guardedDomOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    this.assertCurrentPageTrusted();

    let result: T;
    try {
      result = await operation();
    } catch (error) {
      this.assertCurrentPageTrusted();
      throw error;
    }

    this.assertCurrentPageTrusted();
    return result;
  }

  private rethrowCollectorFailure(error: unknown): void {
    if (error instanceof CollectorFailure) {
      throw error;
    }
  }

  private async dismissBlockingOverlays(): Promise<void> {
    if (this.selectors.closeDetail !== undefined) {
      const detailPanel = this.page.locator(this.selectors.detailPanel);
      const closeButton = detailPanel.locator(this.selectors.closeDetail);
      if (
        (await detailPanel.isVisible().catch(() => false)) &&
        (await closeButton.isVisible().catch(() => false))
      ) {
        await this.clickVisible(closeButton, "detail close button");
      }
    }

    for (const selector of [".guide-close"]) {
      const overlayClose = this.page.locator(selector);
      if (await overlayClose.isVisible().catch(() => false)) {
        await this.clickVisible(overlayClose, "overlay close button");
      }
    }

    await this.page.keyboard.press("Escape").catch(() => undefined);
  }
}

function normalizedPrefixPath(pathname: string): string {
  if (pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/+$/, "");
}
