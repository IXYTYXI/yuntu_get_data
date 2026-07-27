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
  navigationQuery: Record<string, string> = {},
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

  for (const [key, value] of Object.entries(navigationQuery)) {
    target.searchParams.set(key, value);
  }

  return target.toString();
}

export function matchesNavigationQuery(
  location: string,
  navigationQuery: Record<string, string>,
): boolean {
  if (Object.keys(navigationQuery).length === 0) {
    return true;
  }

  try {
    const url = new URL(location);
    return Object.entries(navigationQuery).every(
      ([key, value]) => url.searchParams.get(key) === value,
    );
  } catch {
    return false;
  }
}

async function waitForCollectionPageReady(page: Page): Promise<void> {
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
}

export async function ensureCollectionPage(
  page: Page,
  pageUrlPrefix: string,
  navigationQuery: Record<string, string> = {},
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

  if (
    isTrustedPageUrl(location, pageUrlPrefix) &&
    matchesNavigationQuery(location, navigationQuery)
  ) {
    await waitForCollectionPageReady(page);
    return;
  }

  const destination = buildCollectionPageUrl(
    pageUrlPrefix,
    location,
    navigationQuery,
  );
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

  await waitForCollectionPageReady(page);

  if (!isTrustedPageUrl(page.url(), pageUrlPrefix)) {
    throw targetPageSelectionFailure();
  }

  if (!matchesNavigationQuery(page.url(), navigationQuery)) {
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      "Collection page navigation query did not match the configured module",
    );
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

  async applyExtractionMethod(label: string): Promise<void> {
    this.assertCurrentPageTrusted();
    await this.ensureIndustryInspirationSection();
    await this.ensureIndustryContentLeaderboardTab();

    const row = this.subdivisionFilterRow();
    const trigger =
      this.selectors.extractionMethodTrigger === undefined
        ? row
            .getByText("截取方式", { exact: true })
            .locator(
              "xpath=ancestor::*[contains(@class,'content-ecom-select')][1]",
            )
            .locator(".content-ecom-popper-trigger")
            .first()
        : this.page.locator(this.selectors.extractionMethodTrigger).first();

    await this.clickVisible(trigger, "extraction method trigger");
    await this.page.waitForTimeout(600);

    const option = this.page
      .locator(".content-ecom-select-popover-show, .content-ecom-popover-show")
      .last()
      .getByText(label, { exact: true })
      .first();
    await this.clickVisible(option, "extraction method option");
    await this.page.waitForTimeout(2000);
  }

  async searchCompetitorBrands(brandNames: readonly string[]): Promise<void> {
    this.assertCurrentPageTrusted();
    await this.ensureIndustryInspirationSection();
    await this.ensureIndustryContentLeaderboardTab();
    await this.clearSpecifiedBrandTags();
    for (const brandName of brandNames) {
      await this.addSpecifiedBrandInSubdivisionFilter(brandName);
    }
  }

  async searchCompetitorBrand(brandName: string): Promise<void> {
    await this.searchCompetitorBrands([brandName]);
  }

  private subdivisionFilterRow(): Locator {
    return this.page
      .locator("div, section, form, [class*='filter']")
      .filter({ hasText: "细分筛选" })
      .filter({ hasText: "指定品牌" })
      .first();
  }

  private specifiedBrandTrigger(): Locator {
    if (this.selectors.subdivisionBrandTrigger !== undefined) {
      return this.page.locator(this.selectors.subdivisionBrandTrigger).first();
    }

    const row = this.subdivisionFilterRow();
    return row
      .getByText("指定品牌", { exact: true })
      .locator("xpath=ancestor::*[contains(@class,'content-ecom-select')][1]")
      .locator(".content-ecom-popper-trigger")
      .first()
      .or(row.locator(".content-ecom-select .content-ecom-popper-trigger").first());
  }

  private async clearSpecifiedBrandTags(): Promise<void> {
    const row = this.subdivisionFilterRow();
    const closeButtons = row.locator(
      ".content-ecom-tag-close, [class*='tag-close'], span.i-icon-close",
    );
    let count = await this.guardedDomOperation(() => closeButtons.count());
    while (count > 0) {
      await this.clickVisible(closeButtons.first(), "specified brand tag close");
      await this.page.waitForTimeout(300);
      count = await closeButtons.count();
    }
  }

  private async addSpecifiedBrandInSubdivisionFilter(
    brandName: string,
  ): Promise<void> {
    const row = this.subdivisionFilterRow();
    if (
      await row
        .getByText(brandName, { exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      return;
    }

    const trigger = this.specifiedBrandTrigger();
    await this.clickVisible(trigger, "specified brand filter trigger");
    await this.page.waitForTimeout(600);

    const popover = this.page
      .locator(".content-ecom-select-popover-show.content-ecom-popover-show")
      .last();
    await this.waitForVisible(popover, "specified brand filter popover");

    if (this.selectors.subdivisionBrandSearchInput !== undefined) {
      const searchInput = popover
        .locator(this.selectors.subdivisionBrandSearchInput)
        .first();
      await this.waitForVisible(searchInput, "specified brand search input");
      await this.guardedDomOperation(async () => {
        await searchInput.fill("");
        await searchInput.fill(brandName);
      });
      await this.page.waitForTimeout(800);
    } else {
      const genericSearch = popover.locator("input").first();
      if (await genericSearch.isVisible().catch(() => false)) {
        await genericSearch.fill(brandName);
        await this.page.waitForTimeout(800);
      }
    }

    const option = popover.getByText(brandName, { exact: true }).first();
    await this.clickVisible(option, "specified brand option");
    await this.page.keyboard.press("Escape").catch(() => undefined);
    await this.page.waitForTimeout(1200);
  }

  private async selectSpecifiedBrandInSubdivisionFilter(
    brandName: string,
  ): Promise<void> {
    await this.addSpecifiedBrandInSubdivisionFilter(brandName);
  }

  private async ensureIndustryContentLeaderboardTab(): Promise<void> {
    if (this.selectors.industryContentLeaderboardTab !== undefined) {
      await this.clickVisible(
        this.page.locator(this.selectors.industryContentLeaderboardTab).first(),
        "industry content leaderboard tab",
      );
      await this.page.waitForTimeout(1500);
      return;
    }

    const tabCandidates = this.page
      .locator(".content-ecom-tabs-tab, [role='tab']")
      .filter({ hasText: "行业内容榜" });
    const count = await this.guardedDomOperation(() => tabCandidates.count());
    for (let index = 0; index < count; index += 1) {
      const tab = tabCandidates.nth(index);
      if (!(await this.isVisible(tab, "industry content leaderboard tab"))) {
        continue;
      }
      const className =
        (await tab.getAttribute("class").catch(() => null)) ?? "";
      if (className.includes("active") || className.includes("checked")) {
        return;
      }
      await this.clickVisible(tab, "industry content leaderboard tab");
      await this.page.waitForTimeout(1500);
      return;
    }
  }

  private async ensureIndustryInspirationSection(): Promise<void> {
    if (this.selectors.industryInspirationTab !== undefined) {
      await this.clickVisible(
        this.page.locator(this.selectors.industryInspirationTab).first(),
        "industry inspiration tab",
      );
      await this.page.waitForTimeout(1500);
      return;
    }

    const tabCandidates = this.page
      .locator(
        ".content-ecom-tabs-tab, [role='tab'], .content-ecom-radio-button",
      )
      .filter({ hasText: "行业灵感激发" });
    const count = await this.guardedDomOperation(() => tabCandidates.count());
    for (let index = 0; index < count; index += 1) {
      const tab = tabCandidates.nth(index);
      if (!(await this.isVisible(tab, "industry inspiration tab"))) {
        continue;
      }
      const className =
        (await tab.getAttribute("class").catch(() => null)) ?? "";
      if (className.includes("active") || className.includes("checked")) {
        return;
      }
      await this.clickVisible(tab, "industry inspiration tab");
      await this.page.waitForTimeout(1500);
      return;
    }
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
