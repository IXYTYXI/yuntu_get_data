import assert from "node:assert/strict";
import test from "node:test";

import {
  filterVideoListRows,
  inferBrandNameFromTitle,
  parseExposureText,
  parsePercentText,
  type ParsedVideoListRow,
} from "../src/ui/video-list.js";

test("parses wan-based exposure ranges", () => {
  assert.equal(parseExposureText("1000-2000w"), 10_000_000);
  assert.equal(parseExposureText("10w"), 100_000);
});

test("parses percent metrics", () => {
  assert.ok(Math.abs(parsePercentText("56.60%")! - 0.566) < 0.0001);
  assert.equal(parsePercentText("1.27%"), 0.0127);
});

test("infers brand name from video title when brands are combined", () => {
  assert.equal(
    inferBrandNameFromTitle("猿辅导暑期课", ["学而思", "猿辅导"]),
    "猿辅导",
  );
  assert.equal(inferBrandNameFromTitle("无品牌标题", ["学而思"]), undefined);
});

test("filters rows by exposure, 3s completion, and ctr thresholds", () => {
  const rows: ParsedVideoListRow[] = [
    {
      rowIndex: 0,
      rank: 1,
      title: "A",
      launchDate: "2026-07-07",
      exposureText: "1000-2000w",
      exposureValue: 10_000_000,
      threeSecondCompletionRateText: "56.60%",
      threeSecondCompletionRate: 0.566,
      ctrText: "2.12%",
      ctr: 0.0212,
    },
    {
      rowIndex: 1,
      rank: 2,
      title: "B",
      launchDate: "2026-07-08",
      exposureText: "5w",
      exposureValue: 50_000,
      threeSecondCompletionRateText: "40.00%",
      threeSecondCompletionRate: 0.4,
      ctrText: "2.00%",
      ctr: 0.02,
    },
  ];

  const filtered = filterVideoListRows(rows, {
    minExposure: 100_000,
    minThreeSecondCompletionRate: 0.3,
    minCtr: 0.015,
    maxResults: 30,
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.title, "A");
});
