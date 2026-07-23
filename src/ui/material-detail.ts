import type { Locator, Page } from "playwright";

import {
  CollectorFailure,
  type CollectionConfig,
  type FieldSelectors,
  type PlaybackResult,
} from "../domain.js";
import {
  assertTrustedPage,
  DEFAULT_YUNTU_PAGE_PREFIX,
} from "./yuntu-page.js";

const PLAYBACK_INITIAL_DELAY_MS = 750;
const PLAYBACK_POLL_DELAY_MS = 250;
const PLAYBACK_POLL_ATTEMPTS = 4;

export interface PlayerSnapshot {
  paused: boolean;
  currentTime: number;
}

export function classifyPlayback(
  before: PlayerSnapshot,
  after: PlayerSnapshot,
): PlaybackResult {
  if (
    before.paused &&
    !after.paused &&
    after.currentTime > before.currentTime + 0.25
  ) {
    return { state: "verified" };
  }

  return {
    state: "not-confirmed",
    code: "PLAYBACK_NOT_CONFIRMED",
  };
}

export interface VisibleMaterialDetails {
  materialId: string;
  title?: string;
  duration?: string;
  launchDate?: string;
  industry?: string;
  touchpoints?: string;
  metrics: Record<string, string>;
  script?: string;
  analysis?: string;
}

export class MaterialDetail {
  private readonly panel: Locator;

  constructor(
    private readonly page: Page,
    private readonly selectors: CollectionConfig["selectors"],
    private readonly pageUrlPrefix = DEFAULT_YUNTU_PAGE_PREFIX,
  ) {
    this.panel = page.locator(selectors.detailPanel);
  }

  async collect(): Promise<VisibleMaterialDetails> {
    this.assertCurrentPageTrusted();
    await this.requireVisible(this.panel, "detail panel");

    const materialId = await this.readRequiredField("materialId");
    const title = await this.readOptionalField("title");
    const duration = await this.readOptionalField("duration");
    const launchDate = await this.readOptionalField("launchDate");
    const industry = await this.readOptionalField("industry");
    const touchpoints = await this.readOptionalField("touchpoints");
    const metrics = await this.readOptionalField("metrics");
    const script = await this.readOptionalField("script");
    const analysis = await this.readOptionalField("analysis");

    return {
      materialId,
      ...(title === undefined ? {} : { title }),
      ...(duration === undefined ? {} : { duration }),
      ...(launchDate === undefined ? {} : { launchDate }),
      ...(industry === undefined ? {} : { industry }),
      ...(touchpoints === undefined ? {} : { touchpoints }),
      metrics: metrics === undefined ? {} : { visibleText: metrics },
      ...(script === undefined ? {} : { script }),
      ...(analysis === undefined ? {} : { analysis }),
    };
  }

  async verifyPlayback(): Promise<PlaybackResult> {
    this.assertCurrentPageTrusted();
    await this.requireVisible(this.panel, "detail panel");

    const player = this.panel.locator(this.selectors.player);
    const playButton = this.panel.locator(this.selectors.playButton);
    await this.requireVisible(player, "player");
    await this.requireVisible(playButton, "play button");

    const before = await this.snapshotPlayer(player);
    await this.clickVisible(playButton, "play button");
    await this.waitForPlaybackDelay(PLAYBACK_INITIAL_DELAY_MS);

    let result = classifyPlayback(before, await this.snapshotPlayer(player));
    for (
      let attempt = 0;
      result.state !== "verified" && attempt < PLAYBACK_POLL_ATTEMPTS;
      attempt += 1
    ) {
      await this.waitForPlaybackDelay(PLAYBACK_POLL_DELAY_MS);
      result = classifyPlayback(before, await this.snapshotPlayer(player));
    }

    return result;
  }

  private async readRequiredField(
    name: keyof FieldSelectors,
  ): Promise<string> {
    const value = await this.readOptionalField(name);
    if (value === undefined) {
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        `Configured ${name} field is not available`,
      );
    }

    return value;
  }

  private async readOptionalField(
    name: keyof FieldSelectors,
  ): Promise<string | undefined> {
    const selector = this.selectors.fields[name];
    if (selector === undefined) {
      return undefined;
    }

    const field = this.panel.locator(selector);
    await this.requireVisible(field, `${name} field`);
    try {
      return await this.guardedDomOperation(() => field.innerText());
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        `Visible ${name} field could not be read`,
      );
    }
  }

  private async snapshotPlayer(player: Locator): Promise<PlayerSnapshot> {
    await this.requireVisible(player, "player");

    let snapshot: PlayerSnapshot | null;
    try {
      snapshot = await this.guardedDomOperation(() =>
        player.evaluate((element): PlayerSnapshot | null => {
          if (!(element instanceof HTMLVideoElement)) {
            return null;
          }

          return {
            paused: element.paused,
            currentTime: element.currentTime,
          };
        }),
      );
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Visible player could not be read",
      );
    }

    if (snapshot === null) {
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        "Visible player is not a video element",
      );
    }

    return snapshot;
  }

  private async clickVisible(locator: Locator, name: string): Promise<void> {
    await this.requireVisible(locator, name);
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

  private async requireVisible(locator: Locator, name: string): Promise<void> {
    let visible: boolean;
    try {
      visible = await this.guardedDomOperation(() => locator.isVisible());
    } catch (error) {
      this.rethrowCollectorFailure(error);
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        `Configured ${name} selector is not available`,
      );
    }

    if (!visible) {
      throw new CollectorFailure(
        "SELECTOR_NOT_FOUND",
        `Configured ${name} selector is not visible`,
      );
    }
  }

  private async waitForPlaybackDelay(milliseconds: number): Promise<void> {
    await this.guardedDomOperation(() => this.page.waitForTimeout(milliseconds));
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
