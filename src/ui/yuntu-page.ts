import type { Browser, Locator, Page } from "playwright";

import {
  CollectorFailure,
  type CollectionConfig,
  type VisibleFilterStep,
} from "../domain.js";

export const DEFAULT_YUNTU_PAGE_PREFIX = "https://yuntu.oceanengine.com/";
export const TRUSTED_PAGE_FAILURE_MESSAGE =
  "Configured Yuntu page is outside the trusted scope";
const TARGET_PAGE_SELECTION_FAILURE_MESSAGE =
  "Select one authenticated Yuntu page before collecting";

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
  try {
    assertTrustedPage(selectedPage, pageUrlPrefix);
  } catch {
    throw targetPageSelectionFailure();
  }

  return selectedPage;
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

  async visibleMaterialCount(): Promise<number> {
    this.assertCurrentPageTrusted();
    return (await this.visibleCards()).length;
  }

  async openMaterial(index: number): Promise<void> {
    this.assertCurrentPageTrusted();

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
      detailPanel.locator(this.selectors.closeDetail),
      "detail close button",
    );

    try {
      await this.guardedDomOperation(() =>
        detailPanel.waitFor({ state: "hidden" }),
      );
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Configured detail panel did not close",
      );
    }
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
      await this.guardedDomOperation(() => locator.click());
    } catch (error) {
      this.rethrowCollectorFailure(error);
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
}

function normalizedPrefixPath(pathname: string): string {
  if (pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/+$/, "");
}
