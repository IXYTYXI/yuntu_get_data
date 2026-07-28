import type { Browser, Frame, Locator, Page } from "playwright";

import {
  CollectorFailure,
  type CollectionConfig,
  type VisibleFilterStep,
} from "../domain.js";
import {
  dateRangeInputSelector,
  dateRangeQuickSelectLabel,
  dateRangeQuickSelectLabelCandidates,
  dateRangeQuickSelectPattern,
  inclusiveDayCount,
  parseDateRangeValue,
} from "./date-range.js";
import {
  formatPageInspectionSummary,
  hasSubdivisionFilters,
  inspectYuntuPage,
} from "./page-inspect.js";

export const DEFAULT_YUNTU_PAGE_PREFIX = "https://yuntu.oceanengine.com/";
/** 内容 → 灵感激发 → 行业灵感激发 / 行业内容（真实落地 path，不是 ta_content） */
export const INDUSTRY_INSPIRATION_PAGE_PREFIX =
  "https://yuntu.oceanengine.com/yuntu_brand/ecom/content_new/creative/content_lab/inspiration/industryContent";
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

export function isTaContentInsightPageUrl(location: string): boolean {
  try {
    return new URL(location).pathname.includes("/ta_content");
  } catch {
    return false;
  }
}

export function isIndustryInspirationPageUrl(location: string): boolean {
  try {
    return new URL(location).pathname.includes(
      "/content_lab/inspiration/industryContent",
    );
  } catch {
    return false;
  }
}

function safePagePath(location: string): string {
  try {
    return new URL(location).pathname;
  } catch {
    return "[invalid-url]";
  }
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
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);

  const dateInput = page.locator(dateRangeInputSelector()).first();
  try {
    await dateInput.waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      "Collection page date filter did not become visible after navigation",
    );
  }

  if (isIndustryInspirationPageUrl(page.url())) {
    await page.waitForTimeout(5000);
  } else {
    await page.waitForTimeout(2000);
  }
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
      waitUntil: "load",
      timeout: 90_000,
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
  private filterScope: Page | Frame | null = null;

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

  async navigateToIndustryInspirationModule(): Promise<void> {
    this.assertCurrentPageTrusted();
    await this.prepareIndustryContentView();
  }

  async debugPageInspection(): Promise<string> {
    return formatPageInspectionSummary(await inspectYuntuPage(this.page));
  }

  private async prepareIndustryContentView(): Promise<void> {
    await this.dismissBlockingOverlays();
    await this.page
      .waitForLoadState("networkidle", { timeout: 45_000 })
      .catch(() => undefined);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inspection = await inspectYuntuPage(this.page);
      if (inspection.requiresSignIn) {
        throw new CollectorFailure(
          "AUTH_REQUIRED",
          "Sign in to Yuntu in the debugging Chrome window and select a Yuntu tab",
        );
      }

      if (
        hasSubdivisionFilters(inspection) ||
        (await this.anyFilterLabelVisible())
      ) {
        try {
          const row = await this.waitForSubdivisionFilterRow();
          await this.guardedDomOperation(() => row.scrollIntoViewIfNeeded());
          await this.page.waitForTimeout(500);
          return;
        } catch {
          // fall through to navigation / scroll retries
        }
      }

      if (isIndustryInspirationPageUrl(this.page.url())) {
        await this.ensureIndustryContentLeaderboardTab();
        await this.expandSubdivisionFiltersIfCollapsed();
        await this.page.waitForTimeout(2500);
        await this.guardedDomOperation(async () => {
          await this.page.evaluate(() => {
            window.scrollBy(0, Math.max(500, window.innerHeight * 0.5));
          });
        });
        await this.page.waitForTimeout(1500);
        continue;
      }

      try {
        await this.clickIndustryInspirationEntry();
      } catch {
        // menu navigation may fail when already on target module shell
      }
      await this.page.waitForTimeout(2500);
    }

    await this.failWithPageInspection(
      "无法在页面上定位行业内容榜筛选区（指定品牌 / 截取方式）",
    );
  }

  private async failWithPageInspection(baseMessage: string): Promise<never> {
    const inspection = await inspectYuntuPage(this.page);
    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      `${baseMessage} | ${formatPageInspectionSummary(inspection)}`,
    );
  }

  async applyDateRangeDays(days: number): Promise<void> {
    this.assertCurrentPageTrusted();
    const quickSelectLabels = dateRangeQuickSelectLabelCandidates(days);
    if (quickSelectLabels.length === 0) {
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Configured date range days is not supported by the Yuntu quick select",
      );
    }

    await this.ensureSubdivisionFiltersReady();

    const picker = await this.resolveDateRangePicker();
    const dateInput = this.dateInputInPicker(picker);
    await this.waitForVisible(dateInput, "date range input");
    await this.guardedDomOperation(() => picker.scrollIntoViewIfNeeded());

    const beforeValue = await this.guardedDomOperation(() => dateInput.inputValue());
    await this.selectDateRangeQuickOption(picker, quickSelectLabels, days);
    await this.page.waitForTimeout(1500);

    const afterValue = await this.guardedDomOperation(() => dateInput.inputValue());
    if (afterValue !== beforeValue) {
      await this.page.waitForTimeout(1000);
      return;
    }

    await this.selectDateRangeQuickOption(picker, quickSelectLabels, days);
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

  private async resolveDateRangePicker(): Promise<Locator> {
    const row = this.subdivisionFilterRow();
    const pickerSelectors = [
      ".content-ecom-yuntu-yuntu-date-picker",
      ".content-ecom-date-picker",
      "[class*='yuntu-date-picker']",
    ];

    if (await row.isVisible().catch(() => false)) {
      for (const selector of pickerSelectors) {
        const scoped = row.locator(selector).first();
        if (await scoped.isVisible().catch(() => false)) {
          return scoped;
        }
      }
    }

    for (const selector of pickerSelectors) {
      const candidate = this.page.locator(selector).first();
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }

    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      "Date range picker not found on 行业内容榜; confirm pageUrlPrefix is industryContent",
    );
  }

  private dateInputInPicker(picker: Locator): Locator {
    return picker
      .locator(`input[placeholder="开始时间 ~ 结束时间"]`)
      .first()
      .or(picker.locator("input").first());
  }

  async applyExtractionMethod(label: string): Promise<void> {
    this.assertCurrentPageTrusted();
    await this.ensureSubdivisionFiltersReady();

    const row = this.subdivisionFilterRow();
    const trigger =
      this.selectors.extractionMethodTrigger === undefined
        ? this.subdivisionSelectTrigger(row, "截取方式").or(
            this.contentRoot()
              .locator(".content-ecom-select, [class*='content-ecom-select']")
              .filter({ hasText: /截取\s*方式/ })
              .locator(".content-ecom-popper-trigger, [class*='popper-trigger']")
              .first(),
          )
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
    await this.ensureSubdivisionFiltersReady();
    await this.clearSpecifiedBrandTags();
    for (const brandName of brandNames) {
      await this.addSpecifiedBrandInSubdivisionFilter(brandName);
    }
    await this.submitIndustryContentQuery();
  }

  async searchCompetitorBrand(brandName: string): Promise<void> {
    await this.searchCompetitorBrands([brandName]);
  }

  private contentRoot(): Page | Frame {
    return this.filterScope ?? this.page;
  }

  private static readonly filterLabelPatterns: RegExp[] = [
    /指定\s*品牌/,
    /截取\s*方式/,
    /细分\s*筛选/,
    /竞品\s*品牌/,
  ];

  private async resolveFilterScope(): Promise<Page | Frame> {
    for (const frame of this.page.frames()) {
      for (const pattern of YuntuPage.filterLabelPatterns) {
        const candidate = frame.getByText(pattern).first();
        if (await candidate.isVisible().catch(() => false)) {
          this.filterScope = frame;
          return frame;
        }
      }
    }

    this.filterScope = this.page;
    return this.page;
  }

  private async anyFilterLabelVisible(): Promise<boolean> {
    await this.resolveFilterScope();
    for (const pattern of YuntuPage.filterLabelPatterns) {
      if (
        await this.contentRoot()
          .getByText(pattern)
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        return true;
      }
    }

    for (const frame of this.page.frames()) {
      for (const pattern of YuntuPage.filterLabelPatterns) {
        if (
          await frame
            .getByText(pattern)
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          this.filterScope = frame;
          return true;
        }
      }
    }

    return false;
  }

  private subdivisionFilterRow(): Locator {
    const root = this.contentRoot();
    const container = "div, section, form, [class*='filter'], [class*='Filter']";
    const subdivisionAndMethod = root
      .locator(container)
      .filter({ hasText: /细分\s*筛选/ })
      .filter({ hasText: /截取\s*方式/ })
      .first();
    const withHeader = root
      .locator(container)
      .filter({ hasText: /细分\s*筛选/ })
      .filter({ hasText: /指定\s*品牌/ })
      .first();
    const brandAndMethod = root
      .locator(container)
      .filter({ hasText: /指定\s*品牌/ })
      .filter({ hasText: /截取\s*方式/ })
      .first();
    const brandOnly = root
      .locator(container)
      .filter({ hasText: /指定\s*品牌/ })
      .first();
    const competitorBrand = root
      .locator(container)
      .filter({ hasText: /竞品\s*品牌/ })
      .first();

    return subdivisionAndMethod
      .or(withHeader)
      .or(brandAndMethod)
      .or(brandOnly)
      .or(competitorBrand);
  }

  private subdivisionSelectTrigger(row: Locator, label: string): Locator {
    const pattern =
      label === "指定品牌"
        ? /指定\s*品牌/
        : label === "截取方式"
          ? /截取\s*方式/
          : label;

    return row
      .locator(".content-ecom-select, [class*='content-ecom-select']")
      .filter({ hasText: pattern })
      .locator(".content-ecom-popper-trigger, [class*='popper-trigger']")
      .first();
  }

  private specifiedBrandTrigger(): Locator {
    if (this.selectors.subdivisionBrandTrigger !== undefined) {
      return this.page.locator(this.selectors.subdivisionBrandTrigger).first();
    }

    const row = this.subdivisionFilterRow();
    const byLabel = this.subdivisionSelectTrigger(row, "指定品牌");
    const byStructure = row
      .locator(".content-ecom-select, [class*='content-ecom-select']")
      .filter({ hasNotText: /截取\s*方式/ })
      .filter({ hasNotText: /核心人群/ })
      .filter({ hasNotText: /年龄/ })
      .filter({ hasNotText: /性别/ })
      .filter({ hasNotText: /八大人群/ })
      .locator(".content-ecom-popper-trigger, [class*='popper-trigger']")
      .first();
    const pageWide = this.contentRoot()
      .locator(".content-ecom-select, [class*='content-ecom-select']")
      .filter({ hasText: /指定\s*品牌|竞品\s*品牌/ })
      .locator(".content-ecom-popper-trigger, [class*='popper-trigger']")
      .first();

    return byLabel.or(byStructure).or(pageWide);
  }

  async submitIndustryContentQuery(): Promise<void> {
    this.assertCurrentPageTrusted();
    const queryButton = this.contentRoot()
      .getByRole("button", { name: "查询" })
      .first()
      .or(this.contentRoot().getByText("查询", { exact: true }).first());
    if (await queryButton.isVisible().catch(() => false)) {
      await this.clickVisible(queryButton, "industry content query button");
      await this.page.waitForTimeout(3000);
    }
  }

  private async expandSubdivisionFiltersIfCollapsed(): Promise<void> {
    for (const label of ["展开筛选", "更多筛选", "高级筛选", "展开"]) {
      const trigger = this.page.getByText(label, { exact: true }).first();
      if (await trigger.isVisible().catch(() => false)) {
        await this.clickVisible(trigger, "subdivision filter expand");
        await this.page.waitForTimeout(800);
        return;
      }
    }
  }

  private async waitForSubdivisionFilterRow(): Promise<Locator> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const inspection = await inspectYuntuPage(this.page);
      if (inspection.requiresSignIn) {
        throw new CollectorFailure(
          "AUTH_REQUIRED",
          "Sign in to Yuntu in the debugging Chrome window and select a Yuntu tab",
        );
      }

      await this.resolveFilterScope();
      const row = this.subdivisionFilterRow();
      if (await row.isVisible().catch(() => false)) {
        return row;
      }

      if (hasSubdivisionFilters(inspection) || (await this.anyFilterLabelVisible())) {
        try {
          await row.waitFor({ state: "visible", timeout: 5000 });
          return row;
        } catch {
          // continue polling
        }
      }

      await this.page.waitForTimeout(1500);
    }

    return await this.failWithPageInspection(
      "Timed out waiting for subdivision filters",
    );
  }

  private async ensureSubdivisionFiltersReady(): Promise<void> {
    const inspection = await inspectYuntuPage(this.page);
    if (
      hasSubdivisionFilters(inspection) ||
      (await this.anyFilterLabelVisible())
    ) {
      try {
        const row = await this.waitForSubdivisionFilterRow();
        await this.guardedDomOperation(() => row.scrollIntoViewIfNeeded());
        await this.page.waitForTimeout(500);
        return;
      } catch {
        // continue with full page preparation
      }
    }

    await this.prepareIndustryContentView();
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
    if (await this.subdivisionFilterRow().isVisible().catch(() => false)) {
      return;
    }

    if (isIndustryInspirationPageUrl(this.page.url())) {
      await this.page.waitForTimeout(1500);
      if (await this.subdivisionFilterRow().isVisible().catch(() => false)) {
        return;
      }
    }

    if (this.selectors.industryContentLeaderboardTab !== undefined) {
      await this.clickVisible(
        this.page.locator(this.selectors.industryContentLeaderboardTab).first(),
        "industry content leaderboard tab",
      );
      await this.page.waitForTimeout(1500);
      return;
    }

    const tabCandidates = this.page
      .locator(
        ".content-ecom-tabs-tab, [role='tab'], .content-ecom-radio-button, [class*='tabs-tab']",
      )
      .filter({ hasText: "行业内容榜" });
    const count = await this.guardedDomOperation(() => tabCandidates.count());
    if (count === 0) {
      if (isIndustryInspirationPageUrl(this.page.url())) {
        return;
      }
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "行业内容榜 tab not found; open 内容 → 行业灵感激发 first",
      );
    }

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

    if (isIndustryInspirationPageUrl(this.page.url())) {
      return;
    }

    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      "行业内容榜 tab is not visible on the current page",
    );
  }

  private industryInspirationSidebarLink(): Locator {
    if (this.selectors.industryInspirationNav !== undefined) {
      return this.page.locator(this.selectors.industryInspirationNav).first();
    }
    if (this.selectors.industryInspirationTab !== undefined) {
      return this.page.locator(this.selectors.industryInspirationTab).first();
    }

    return this.page
      .locator(
        "aside, [class*='sidebar'], [class*='SideMenu'], [class*='side-menu'], [class*='layout-menu']",
      )
      .getByText("行业灵感激发", { exact: true })
      .first();
  }

  private async clickIndustryInspirationEntry(): Promise<void> {
    if (this.selectors.industryInspirationNav !== undefined) {
      await this.clickVisible(
        this.page.locator(this.selectors.industryInspirationNav).first(),
        "industry inspiration nav",
      );
      return;
    }

    const sidebarLink = this.industryInspirationSidebarLink();
    if (await sidebarLink.isVisible().catch(() => false)) {
      await this.clickVisible(sidebarLink, "industry inspiration sidebar");
      return;
    }

    const linkCandidates = this.page.locator("a, [role='menuitem']").filter({
      hasText: "行业灵感激发",
    });
    const count = await this.guardedDomOperation(() => linkCandidates.count());
    for (let index = 0; index < count; index += 1) {
      const candidate = linkCandidates.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      const box = await candidate.boundingBox().catch(() => null);
      if (box !== null && box.x > 480) {
        continue;
      }
      await this.clickVisible(candidate, "industry inspiration sidebar");
      return;
    }

    await this.openContentMenuAndClickIndustryInspiration();
  }

  private async openContentMenuAndClickIndustryInspiration(): Promise<void> {
    const header = this.page.locator("header, [class*='header']").first();
    const contentNav = header.getByText("内容", { exact: true }).first();
    await this.waitForVisible(contentNav, "top content navigation");
    await this.guardedDomOperation(() => contentNav.hover());
    await this.page.waitForTimeout(500);
    if (
      !(await this.page
        .getByText("行业灵感激发", { exact: true })
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      await this.clickVisible(contentNav, "top content navigation");
      await this.page.waitForTimeout(500);
    }

    const menuLink = this.page
      .locator(
        "[class*='dropdown'], [class*='submenu'], [class*='popover'], [class*='mega']",
      )
      .getByText("行业灵感激发", { exact: true })
      .first();
    await this.clickVisible(menuLink, "content menu industry inspiration link");
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
    quickSelectLabels: readonly string[],
    days: number,
  ): Promise<void> {
    await this.openDateRangePopover(picker);
    const popover = await this.findVisibleDateRangePopover();

    const pattern = dateRangeQuickSelectPattern(days);
    if (pattern !== null) {
      const patternOption = popover.getByText(pattern).first();
      if (await patternOption.isVisible().catch(() => false)) {
        await this.guardedDomOperation(() => patternOption.click());
        await this.guardedDomOperation(() =>
          popover
            .waitFor({ state: "hidden", timeout: 10_000 })
            .catch(() => undefined),
        );
        return;
      }
    }

    for (const label of quickSelectLabels) {
      const quickOption = popover
        .locator("a.content-ecom-link, a, button, span, div")
        .filter({ hasText: label })
        .first();
      if (await quickOption.isVisible().catch(() => false)) {
        await this.guardedDomOperation(() => quickOption.click());
        await this.guardedDomOperation(() =>
          popover
            .waitFor({ state: "hidden", timeout: 10_000 })
            .catch(() => undefined),
        );
        return;
      }
    }

    for (const label of quickSelectLabels) {
      const pageOption = this.page
        .locator(".content-ecom-popover-show, [class*='popover-show']")
        .getByText(label, { exact: true })
        .first();
      if (await pageOption.isVisible().catch(() => false)) {
        await this.guardedDomOperation(() => pageOption.click());
        return;
      }
    }

    if (pattern !== null) {
      const pagePatternOption = this.page.getByText(pattern).first();
      if (await pagePatternOption.isVisible().catch(() => false)) {
        await this.guardedDomOperation(() => pagePatternOption.click());
        return;
      }
    }

    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      `Date range quick select not found (tried: ${quickSelectLabels.join(", ")}). Update collector code and open the date picker manually once to verify shortcuts exist.`,
    );
  }

  private async openDateRangePopover(picker: Locator): Promise<void> {
    const suffix = picker
      .locator(
        ".content-ecom-date-picker .content-ecom-input-suffix, .content-ecom-input-suffix",
      )
      .first();
    const dateInput = this.dateInputInPicker(picker);

    if (await suffix.isVisible().catch(() => false)) {
      await this.guardedDomOperation(() => suffix.click({ force: true }));
    } else {
      await this.waitForVisible(dateInput, "date range input");
      await this.guardedDomOperation(() => dateInput.click({ force: true }));
    }

    try {
      await this.findVisibleDateRangePopover();
    } catch {
      await this.guardedDomOperation(() => picker.click({ force: true }).catch(() => undefined));
      await this.findVisibleDateRangePopover();
    }
  }

  private async findVisibleDateRangePopover(): Promise<Locator> {
    const selectors = [
      ".oc-content-ecom-daterange-picker__pop.content-ecom-popover-show",
      ".content-ecom-date-picker-popover.content-ecom-popover-show",
      ".content-ecom-popover-show:has(a.content-ecom-link)",
      ".content-ecom-popover-show",
    ];

    for (const selector of selectors) {
      const popover = this.page.locator(selector).last();
      try {
        await this.guardedDomOperation(() =>
          popover.waitFor({ state: "visible", timeout: 5000 }),
        );
        return popover;
      } catch {
        continue;
      }
    }

    throw new CollectorFailure(
      "SELECTOR_NOT_FOUND",
      "Date range picker popover did not open",
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
