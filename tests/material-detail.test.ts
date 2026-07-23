import assert from "node:assert/strict";
import test from "node:test";
import type { Browser, Locator, Page } from "playwright";

import type { CollectionConfig } from "../src/domain.js";
import { CollectorFailure } from "../src/domain.js";
import {
  classifyPlayback,
  MaterialDetail,
  type PlayerSnapshot,
} from "../src/ui/material-detail.js";
import {
  findYuntuPage,
  TRUSTED_PAGE_FAILURE_MESSAGE,
  YuntuPage,
} from "../src/ui/yuntu-page.js";

const TRUSTED_PAGE_PREFIX = "https://yuntu.oceanengine.com/";
const TRUSTED_PAGE_URL = "https://yuntu.oceanengine.com/materials";

class FakeLocator {
  readonly children = new Map<string, FakeLocator>();
  readonly items: FakeLocator[] = [];
  readonly waitStates: Array<"visible" | "hidden" | undefined> = [];
  clicks = 0;
  scrolls = 0;
  waits = 0;
  textReads = 0;
  evaluations = 0;
  onClick?: () => void;
  onCount?: () => void;
  onVisible?: () => void;
  onScroll?: () => void;
  onWait?: (state: "visible" | "hidden" | undefined) => void;
  onInnerText?: () => void;
  snapshot: PlayerSnapshot | null = null;

  constructor(
    public visible = true,
    public text = "",
  ) {}

  locator(selector: string): Locator {
    return (this.children.get(selector) ?? new FakeLocator(false)) as unknown as Locator;
  }

  nth(index: number): Locator {
    return (this.items[index] ?? new FakeLocator(false)) as unknown as Locator;
  }

  async count(): Promise<number> {
    this.onCount?.();
    return this.items.length;
  }

  async isVisible(): Promise<boolean> {
    this.onVisible?.();
    return this.visible;
  }

  async click(): Promise<void> {
    this.clicks += 1;
    this.onClick?.();
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    this.scrolls += 1;
    this.onScroll?.();
  }

  async waitFor(options?: {
    state?: "visible" | "hidden";
  }): Promise<void> {
    this.waits += 1;
    const state = options?.state;
    this.waitStates.push(state);
    this.onWait?.(state);
    if (state === "visible" && !this.visible) {
      throw new Error("not visible");
    }
    if (state === "hidden" && this.visible) {
      throw new Error("not hidden");
    }
  }

  async innerText(): Promise<string> {
    this.textReads += 1;
    this.onInnerText?.();
    return this.text;
  }

  async evaluate(): Promise<PlayerSnapshot | null> {
    this.evaluations += 1;
    return this.snapshot === null ? null : { ...this.snapshot };
  }
}

class FakePage {
  readonly locators = new Map<string, FakeLocator>();
  readonly waits: number[] = [];
  onWait?: (milliseconds: number) => void;

  constructor(private location = TRUSTED_PAGE_URL) {}

  locator(selector: string): Locator {
    return (this.locators.get(selector) ?? new FakeLocator(false)) as unknown as Locator;
  }

  url(): string {
    return this.location;
  }

  setLocation(location: string): void {
    this.location = location;
  }

  async waitForTimeout(milliseconds: number): Promise<void> {
    this.waits.push(milliseconds);
    this.onWait?.(milliseconds);
  }
}

class TrackingPage extends FakePage {
  urlReads = 0;

  constructor(
    location: string,
    private readonly throwWhenUrlRead = false,
  ) {
    super(location);
  }

  override url(): string {
    this.urlReads += 1;
    if (this.throwWhenUrlRead) {
      throw new Error("external page URL must not be read");
    }
    return super.url();
  }
}

const selectors: CollectionConfig["selectors"] = {
  resultCard: ".card",
  detailPanel: ".detail",
  closeDetail: ".close",
  player: ".player",
  playButton: ".play",
  fields: {
    materialId: ".material-id",
    title: ".title",
    duration: ".duration",
    launchDate: ".launch-date",
    industry: ".industry",
    touchpoints: ".touchpoints",
    metrics: ".metrics",
    script: ".script",
    analysis: ".analysis",
  },
};

function addField(
  panel: FakeLocator,
  selector: string,
  text: string,
  visible = true,
): FakeLocator {
  const field = new FakeLocator(visible, text);
  panel.children.set(selector, field);
  return field;
}

async function assertFailure(
  operation: () => Promise<unknown>,
  code: "AUTH_REQUIRED" | "SELECTOR_NOT_FOUND",
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    return error instanceof CollectorFailure && error.code === code;
  });
}

async function assertUntrustedPageFailure(
  operation: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    return (
      error instanceof CollectorFailure &&
      error.code === "SELECTOR_NOT_FOUND" &&
      error.message === TRUSTED_PAGE_FAILURE_MESSAGE
    );
  });
}

test("classifies an actively advancing player as verified", () => {
  const result = classifyPlayback(
    { paused: true, currentTime: 12 },
    { paused: false, currentTime: 12.26 },
  );

  assert.deepEqual(result, { state: "verified" });
});

test("does not confirm an already-playing player even when its time advances", () => {
  const result = classifyPlayback(
    { paused: false, currentTime: 12 },
    { paused: false, currentTime: 12.5 },
  );

  assert.deepEqual(result, {
    state: "not-confirmed",
    code: "PLAYBACK_NOT_CONFIRMED",
  });
});

test("does not confirm a player with no playback progress", () => {
  const result = classifyPlayback(
    { paused: false, currentTime: 12 },
    { paused: false, currentTime: 12 },
  );

  assert.deepEqual(result, {
    state: "not-confirmed",
    code: "PLAYBACK_NOT_CONFIRMED",
  });
});

test("requires progress strictly greater than the playback threshold", () => {
  const result = classifyPlayback(
    { paused: false, currentTime: 12 },
    { paused: false, currentTime: 12.25 },
  );

  assert.deepEqual(result, {
    state: "not-confirmed",
    code: "PLAYBACK_NOT_CONFIRMED",
  });
});

test("preserves a typed collector failure code", () => {
  const failure = new CollectorFailure(
    "SELECTOR_NOT_FOUND",
    "Visible play button was not found",
  );

  assert.ok(failure instanceof Error);
  assert.equal(failure.name, "CollectorFailure");
  assert.equal(failure.code, "SELECTOR_NOT_FOUND");
});

test("collects visible detail text from the configured panel", async () => {
  const page = new FakePage();
  const panel = new FakeLocator();
  page.locators.set(selectors.detailPanel, panel);
  page.locators.set(".title", new FakeLocator(true, "outside detail"));
  addField(panel, ".material-id", "material-123");
  addField(panel, ".title", "Summer launch");
  addField(panel, ".duration", "00:30");
  addField(panel, ".launch-date", "2026-07-21");
  addField(panel, ".industry", "Retail");
  addField(panel, ".touchpoints", "Feed");
  addField(panel, ".metrics", "CTR: 4.2%");
  addField(panel, ".script", "Visible script");
  addField(panel, ".analysis", "Visible analysis");

  const detail = new MaterialDetail(page as unknown as Page, selectors);

  assert.deepEqual(await detail.collect(), {
    materialId: "material-123",
    title: "Summer launch",
    duration: "00:30",
    launchDate: "2026-07-21",
    industry: "Retail",
    touchpoints: "Feed",
    metrics: { visibleText: "CTR: 4.2%" },
    script: "Visible script",
    analysis: "Visible analysis",
  });
});

test("rejects a hidden configured detail field", async () => {
  const page = new FakePage();
  const panel = new FakeLocator();
  page.locators.set(selectors.detailPanel, panel);
  addField(panel, ".material-id", "material-123", false);

  const detail = new MaterialDetail(page as unknown as Page, {
    ...selectors,
    fields: { materialId: ".material-id" },
  });

  await assertFailure(() => detail.collect(), "SELECTOR_NOT_FOUND");
});

test("verifies playback after the visible player advances", async () => {
  const page = new FakePage();
  const panel = new FakeLocator();
  const player = new FakeLocator();
  const button = new FakeLocator();
  player.snapshot = { paused: true, currentTime: 4 };
  panel.children.set(selectors.player, player);
  panel.children.set(selectors.playButton, button);
  page.locators.set(selectors.detailPanel, panel);
  page.onWait = (milliseconds) => {
    assert.equal(milliseconds, 750);
    player.snapshot = { paused: false, currentTime: 4.3 };
  };

  const detail = new MaterialDetail(page as unknown as Page, selectors);

  assert.deepEqual(await detail.verifyPlayback(), { state: "verified" });
  assert.equal(button.clicks, 1);
  assert.deepEqual(page.waits, [750]);
});

test("does not confirm playback when the visible player stalls", async () => {
  const page = new FakePage();
  const panel = new FakeLocator();
  const player = new FakeLocator();
  player.snapshot = { paused: false, currentTime: 4 };
  panel.children.set(selectors.player, player);
  panel.children.set(selectors.playButton, new FakeLocator());
  page.locators.set(selectors.detailPanel, panel);

  const detail = new MaterialDetail(page as unknown as Page, selectors);

  assert.deepEqual(await detail.verifyPlayback(), {
    state: "not-confirmed",
    code: "PLAYBACK_NOT_CONFIRMED",
  });
});

test("rejects a non-video visible player", async () => {
  const page = new FakePage();
  const panel = new FakeLocator();
  panel.children.set(selectors.player, new FakeLocator());
  panel.children.set(selectors.playButton, new FakeLocator());
  page.locators.set(selectors.detailPanel, panel);

  const detail = new MaterialDetail(page as unknown as Page, selectors);

  await assertFailure(() => detail.verifyPlayback(), "SELECTOR_NOT_FOUND");
});

test("finds the only already-open page with the configured Yuntu prefix", () => {
  const matching = new FakePage("https://yuntu.oceanengine.com/materials");
  const browser = {
    contexts: () => [{ pages: () => [matching] }],
  } as unknown as Browser;

  assert.equal(
    findYuntuPage(browser, "https://yuntu.oceanengine.com/"),
    matching,
  );
});

test("reads only an explicitly selected target page URL", () => {
  const external = new TrackingPage(
    "https://example.invalid/materials",
    true,
  );
  const matching = new TrackingPage(
    "https://yuntu.oceanengine.com/materials",
  );
  const browser = {
    contexts: () => [{ pages: () => [external, matching] }],
  } as unknown as Browser;

  assert.equal(
    findYuntuPage(browser, "https://yuntu.oceanengine.com/", 1),
    matching,
  );
  assert.equal(external.urlReads, 0);
  assert.equal(matching.urlReads, 1);
});

test("requires an explicit target page when multiple pages are open", () => {
  const first = new TrackingPage("https://example.invalid/", true);
  const second = new TrackingPage("https://yuntu.oceanengine.com/materials");
  const browser = {
    contexts: () => [{ pages: () => [first, second] }],
  } as unknown as Browser;

  assert.throws(
    () => findYuntuPage(browser, "https://yuntu.oceanengine.com/"),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
  assert.equal(first.urlReads, 0);
  assert.equal(second.urlReads, 0);
});

test("requires exactly one context before reading a target page URL", () => {
  const first = new TrackingPage("https://example.invalid/", true);
  const second = new TrackingPage("https://yuntu.oceanengine.com/materials");
  const browser = {
    contexts: () => [
      { pages: () => [first] },
      { pages: () => [second] },
    ],
  } as unknown as Browser;

  assert.throws(
    () => findYuntuPage(browser, "https://yuntu.oceanengine.com/", 0),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
  assert.equal(first.urlReads, 0);
  assert.equal(second.urlReads, 0);
});

test("rejects an invalid or untrusted explicitly selected page", () => {
  const untrusted = new TrackingPage("https://example.invalid/materials");
  const trusted = new TrackingPage("https://yuntu.oceanengine.com/materials");
  const browser = {
    contexts: () => [{ pages: () => [untrusted, trusted] }],
  } as unknown as Browser;

  assert.throws(
    () => findYuntuPage(browser, "https://yuntu.oceanengine.com/", -1),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
  assert.throws(
    () => findYuntuPage(browser, "https://yuntu.oceanengine.com/", 2),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
  assert.throws(
    () => findYuntuPage(browser, "https://yuntu.oceanengine.com/", 0),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
  assert.equal(trusted.urlReads, 0);
});

test("rejects hostname lookalikes and invalid existing page locations", () => {
  for (const location of [
    "https://yuntu.oceanengine.com.evil.invalid/materials",
    "https://yuntu.oceanengine.com:bad/materials",
  ]) {
    const browser = {
      contexts: () => [{ pages: () => [new FakePage(location)] }],
    } as unknown as Browser;

    assert.throws(
      () => findYuntuPage(browser, "https://yuntu.oceanengine.com"),
      (error: unknown) =>
        error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
    );
  }
});

test("matches an exact trusted path and descendants but not a sibling path", () => {
  const prefix = "https://yuntu.oceanengine.com/foo";
  const exact = new FakePage("https://yuntu.oceanengine.com/foo");
  const descendant = new FakePage("https://yuntu.oceanengine.com/foo/materials");

  assert.equal(
    findYuntuPage(
      { contexts: () => [{ pages: () => [exact] }] } as unknown as Browser,
      prefix,
    ),
    exact,
  );
  assert.equal(
    findYuntuPage(
      { contexts: () => [{ pages: () => [descendant] }] } as unknown as Browser,
      prefix,
    ),
    descendant,
  );
  assert.throws(
    () =>
      findYuntuPage(
        {
          contexts: () => [
            {
              pages: () => [
                new FakePage("https://yuntu.oceanengine.com/foo-bar/materials"),
              ],
            },
          ],
        } as unknown as Browser,
        prefix,
      ),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
});

test("reports authentication when no existing page has the configured prefix", () => {
  const browser = {
    contexts: () => [{ pages: () => [new FakePage("https://example.invalid/")] }],
  } as unknown as Browser;

  assert.throws(
    () => findYuntuPage(browser, "https://yuntu.oceanengine.com/"),
    (error: unknown) =>
      error instanceof CollectorFailure && error.code === "AUTH_REQUIRED",
  );
});

test("applies visible filters and navigates only visible result cards", async () => {
  const page = new FakePage();
  const trigger = new FakeLocator();
  const option = new FakeLocator();
  const cards = new FakeLocator();
  const visibleCard = new FakeLocator();
  const hiddenCard = new FakeLocator(false);
  const panel = new FakeLocator(false);
  const close = new FakeLocator();
  const outsideClose = new FakeLocator();
  cards.items.push(visibleCard, hiddenCard);
  visibleCard.onClick = () => {
    panel.visible = true;
  };
  close.onClick = () => {
    panel.visible = false;
  };
  page.locators.set(".filter-trigger", trigger);
  page.locators.set(".filter-option", option);
  page.locators.set(selectors.resultCard, cards);
  page.locators.set(selectors.detailPanel, panel);
  page.locators.set(".close", outsideClose);
  panel.children.set(".close", close);

  const yuntu = new YuntuPage(page as unknown as Page, selectors, [
    { triggerSelector: ".filter-trigger", optionSelector: ".filter-option" },
  ]);

  await yuntu.applyVisibleFilters();
  assert.equal(trigger.clicks, 1);
  assert.equal(option.clicks, 1);
  assert.equal(await yuntu.visibleMaterialCount(), 1);
  await yuntu.openMaterial(0);
  assert.equal(visibleCard.scrolls, 1);
  assert.equal(visibleCard.clicks, 1);
  assert.equal(panel.waits, 1);
  await yuntu.closeMaterial();
  assert.equal(close.clicks, 1);
  assert.equal(outsideClose.clicks, 0);
});

test("rejects a hidden configured filter control", async () => {
  const page = new FakePage();
  page.locators.set(".filter-trigger", new FakeLocator(false));

  const yuntu = new YuntuPage(page as unknown as Page, selectors, [
    { triggerSelector: ".filter-trigger", optionSelector: ".filter-option" },
  ]);

  await assertFailure(() => yuntu.applyVisibleFilters(), "SELECTOR_NOT_FOUND");
});

test("opens the first visible material when an earlier card is hidden", async () => {
  const page = new FakePage();
  const cards = new FakeLocator();
  const hiddenCard = new FakeLocator(false);
  const visibleCard = new FakeLocator();
  const panel = new FakeLocator(false);
  cards.items.push(hiddenCard, visibleCard);
  visibleCard.onClick = () => {
    panel.visible = true;
  };
  page.locators.set(selectors.resultCard, cards);
  page.locators.set(selectors.detailPanel, panel);

  const yuntu = new YuntuPage(page as unknown as Page, selectors, []);

  await yuntu.openMaterial(0);

  assert.equal(hiddenCard.clicks, 0);
  assert.equal(visibleCard.scrolls, 1);
  assert.equal(visibleCard.clicks, 1);
});

test("waits for a delayed visible filter option before clicking", async () => {
  const page = new FakePage();
  const trigger = new FakeLocator();
  const option = new FakeLocator(false);
  option.onWait = (state) => {
    if (state === "visible") {
      option.visible = true;
    }
  };
  page.locators.set(".filter-trigger", trigger);
  page.locators.set(".filter-option", option);

  const yuntu = new YuntuPage(page as unknown as Page, selectors, [
    { triggerSelector: ".filter-trigger", optionSelector: ".filter-option" },
  ]);

  await yuntu.applyVisibleFilters();

  assert.deepEqual(trigger.waitStates, ["visible"]);
  assert.deepEqual(option.waitStates, ["visible"]);
  assert.equal(option.clicks, 1);
});

test("waits for the detail panel to close after clicking its close control", async () => {
  const page = new FakePage();
  const panel = new FakeLocator();
  const close = new FakeLocator();
  panel.onWait = (state) => {
    if (state === "hidden") {
      panel.visible = false;
    }
  };
  page.locators.set(selectors.detailPanel, panel);
  panel.children.set(".close", close);

  const yuntu = new YuntuPage(page as unknown as Page, selectors, []);

  await yuntu.closeMaterial();

  assert.equal(close.clicks, 1);
  assert.deepEqual(panel.waitStates, ["visible", "hidden"]);
});

test("continues polling after the initial playback sample has not advanced", async () => {
  const page = new FakePage();
  const panel = new FakeLocator();
  const player = new FakeLocator();
  player.snapshot = { paused: true, currentTime: 4 };
  panel.children.set(selectors.player, player);
  panel.children.set(selectors.playButton, new FakeLocator());
  page.locators.set(selectors.detailPanel, panel);
  let waitCount = 0;
  page.onWait = () => {
    waitCount += 1;
    player.snapshot =
      waitCount === 1
        ? { paused: false, currentTime: 4 }
        : { paused: false, currentTime: 4.3 };
  };

  const detail = new MaterialDetail(page as unknown as Page, selectors);

  assert.deepEqual(await detail.verifyPlayback(), { state: "verified" });
  assert.equal(page.waits[0], 750);
  assert.ok(page.waits.length > 1);
});

test("does not begin a filter workflow from an untrusted scoped page", async () => {
  const prefix = "https://yuntu.oceanengine.com/materials";
  const page = new FakePage("https://yuntu.oceanengine.com/materials-other");
  const trigger = new FakeLocator();
  const option = new FakeLocator();
  page.locators.set(".filter-trigger", trigger);
  page.locators.set(".filter-option", option);

  const yuntu = new YuntuPage(page as unknown as Page, selectors, [
    { triggerSelector: ".filter-trigger", optionSelector: ".filter-option" },
  ], prefix);

  await assertUntrustedPageFailure(() => yuntu.applyVisibleFilters());
  assert.equal(trigger.clicks, 0);
  assert.equal(option.clicks, 0);
});

test("stops a filter workflow when a click leaves the trusted scope", async () => {
  const prefix = "https://yuntu.oceanengine.com/materials";
  const page = new FakePage("https://yuntu.oceanengine.com/materials/list");
  const trigger = new FakeLocator();
  const option = new FakeLocator();
  trigger.onClick = () => {
    page.setLocation("https://yuntu.oceanengine.com/materials-other");
  };
  page.locators.set(".filter-trigger", trigger);
  page.locators.set(".filter-option", option);

  const yuntu = new YuntuPage(page as unknown as Page, selectors, [
    { triggerSelector: ".filter-trigger", optionSelector: ".filter-option" },
  ], prefix);

  await assertUntrustedPageFailure(() => yuntu.applyVisibleFilters());
  assert.equal(trigger.clicks, 1);
  assert.equal(option.clicks, 0);
});

test("does not collect visible fields from an untrusted scoped page", async () => {
  const prefix = "https://yuntu.oceanengine.com/materials";
  const page = new FakePage("https://yuntu.oceanengine.com/materials-other");
  const panel = new FakeLocator();
  page.locators.set(selectors.detailPanel, panel);
  addField(panel, ".material-id", "material-123");

  const detail = new MaterialDetail(page as unknown as Page, {
    ...selectors,
    fields: { materialId: ".material-id" },
  }, prefix);

  await assertUntrustedPageFailure(() => detail.collect());
});

test("stops playback verification when the play control leaves the trusted scope", async () => {
  const prefix = "https://yuntu.oceanengine.com/materials";
  const page = new FakePage("https://yuntu.oceanengine.com/materials/item");
  const panel = new FakeLocator();
  const player = new FakeLocator();
  const button = new FakeLocator();
  player.snapshot = { paused: true, currentTime: 4 };
  button.onClick = () => {
    page.setLocation("https://yuntu.oceanengine.com/materials-other");
  };
  panel.children.set(selectors.player, player);
  panel.children.set(selectors.playButton, button);
  page.locators.set(selectors.detailPanel, panel);

  const detail = new MaterialDetail(page as unknown as Page, selectors, prefix);

  await assertUntrustedPageFailure(() => detail.verifyPlayback());
  assert.equal(button.clicks, 1);
  assert.deepEqual(page.waits, []);
});

test("stops counting cards when the count leaves the trusted scope", async () => {
  const prefix = "https://yuntu.oceanengine.com/materials";
  const page = new FakePage("https://yuntu.oceanengine.com/materials/list");
  const cards = new FakeLocator();
  cards.onCount = () => {
    page.setLocation("https://outside.invalid/materials");
  };
  page.locators.set(selectors.resultCard, cards);

  const yuntu = new YuntuPage(page as unknown as Page, selectors, [], prefix);

  await assertUntrustedPageFailure(() => yuntu.visibleMaterialCount());
});

test("stops collection before reading a later field after text reading leaves trusted scope", async () => {
  const prefix = "https://yuntu.oceanengine.com/materials";
  const page = new FakePage("https://yuntu.oceanengine.com/materials/item");
  const panel = new FakeLocator();
  const materialId = addField(panel, ".material-id", "material-123");
  const title = addField(panel, ".title", "external title");
  materialId.onInnerText = () => {
    page.setLocation("https://outside.invalid/materials");
  };
  page.locators.set(selectors.detailPanel, panel);

  const detail = new MaterialDetail(page as unknown as Page, {
    ...selectors,
    fields: { materialId: ".material-id", title: ".title" },
  }, prefix);

  await assertUntrustedPageFailure(() => detail.collect());
  assert.equal(materialId.textReads, 1);
  assert.equal(title.textReads, 0);
});

test("stops playback polling before an extra snapshot when a delay leaves trusted scope", async () => {
  const prefix = "https://yuntu.oceanengine.com/materials";
  const page = new FakePage("https://yuntu.oceanengine.com/materials/item");
  const panel = new FakeLocator();
  const player = new FakeLocator();
  player.snapshot = { paused: true, currentTime: 4 };
  panel.children.set(selectors.player, player);
  panel.children.set(selectors.playButton, new FakeLocator());
  page.locators.set(selectors.detailPanel, panel);
  let waitCount = 0;
  page.onWait = () => {
    waitCount += 1;
    if (waitCount === 1) {
      player.snapshot = { paused: false, currentTime: 4 };
    } else {
      page.setLocation("https://outside.invalid/materials");
    }
  };

  const detail = new MaterialDetail(page as unknown as Page, selectors, prefix);

  await assertUntrustedPageFailure(() => detail.verifyPlayback());
  assert.equal(player.evaluations, 2);
  assert.equal(page.waits.length, 2);
});
