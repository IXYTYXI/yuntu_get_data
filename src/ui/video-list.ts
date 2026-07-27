import type { Page } from "playwright";

export interface ParsedVideoListRow {
  rowIndex: number;
  rank: number;
  title: string;
  launchDate: string;
  exposureText: string;
  exposureValue: number | null;
  threeSecondCompletionRateText: string;
  threeSecondCompletionRate: number | null;
  ctrText: string;
  ctr: number | null;
}

export interface VideoListCriteria {
  minExposure: number;
  minThreeSecondCompletionRate: number;
  minCtr: number;
  maxResults: number;
}

export function parseExposureText(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  const rangeMatch = normalized.match(/^(\d+(?:\.\d+)?)(?:万|w)?(?:[-~](\d+(?:\.\d+)?)(?:万|w)?)?$/i);
  if (rangeMatch !== null) {
    const lower = Number(rangeMatch[1]);
    if (!Number.isFinite(lower)) {
      return null;
    }

    const unitMultiplier = /万|w/i.test(normalized) ? 10_000 : 1;
    return lower * unitMultiplier;
  }

  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)(万|w)?$/i);
  if (numericMatch === null) {
    return null;
  }

  const amount = Number(numericMatch[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  return numericMatch[2] === undefined ? amount : amount * 10_000;
}

export function parsePercentText(value: string): number | null {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized.endsWith("%")) {
    return null;
  }

  const amount = Number(normalized.slice(0, -1));
  return Number.isFinite(amount) ? amount / 100 : null;
}

export function filterVideoListRows(
  rows: ParsedVideoListRow[],
  criteria: VideoListCriteria,
): ParsedVideoListRow[] {
  return rows
    .filter((row) => {
      if (row.exposureValue === null || row.exposureValue < criteria.minExposure) {
        return false;
      }

      if (
        row.threeSecondCompletionRate === null ||
        row.threeSecondCompletionRate < criteria.minThreeSecondCompletionRate
      ) {
        return false;
      }

      if (row.ctr === null || row.ctr < criteria.minCtr) {
        return false;
      }

      return true;
    })
    .slice(0, criteria.maxResults);
}

export function inferBrandNameFromTitle(
  title: string,
  brands: readonly string[],
): string | undefined {
  for (const brand of brands) {
    if (title.includes(brand)) {
      return brand;
    }
  }

  return undefined;
}

export async function readVideoListRows(page: Page): Promise<ParsedVideoListRow[]> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr.content-ecom-Table-Row")];
    return rows.map((row, rowIndex) => {
      const cells = [...row.children].map((cell) =>
        (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
      );
      const rank = Number(cells[0] ?? "");
      const titleCell = cells[1] ?? "";
      const title = titleCell.replace(/视频时长：.+$/u, "").trim();

      return {
        rowIndex,
        rank: Number.isFinite(rank) ? rank : rowIndex + 1,
        title,
        launchDate: cells[2] ?? "",
        exposureText: cells[4] ?? "",
        threeSecondCompletionRateText: cells[6] ?? "",
        ctrText: cells[8] ?? "",
      };
    });
  }).then((rows) =>
    rows.map((row) => ({
      ...row,
      exposureValue: parseExposureText(row.exposureText),
      threeSecondCompletionRate: parsePercentText(row.threeSecondCompletionRateText),
      ctr: parsePercentText(row.ctrText),
    })),
  );
}
