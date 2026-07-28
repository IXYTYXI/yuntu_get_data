import assert from "node:assert/strict";
import test from "node:test";

import {
  dateRangeQuickSelectLabel,
  dateRangeQuickSelectLabelCandidates,
  inclusiveDayCount,
  parseDateRangeValue,
} from "../src/ui/date-range.js";

test("maps supported day counts to Yuntu quick select labels", () => {
  assert.equal(dateRangeQuickSelectLabel(7), "过去 7 天");
  assert.equal(dateRangeQuickSelectLabel(15), "过去 15 天");
  assert.equal(dateRangeQuickSelectLabel(30), "过去 30 天");
  assert.equal(dateRangeQuickSelectLabel(14), null);
  assert.deepEqual(dateRangeQuickSelectLabelCandidates(7)[0], "过去 7 天");
});

test("parses the readonly range input format", () => {
  const parsed = parseDateRangeValue("2026-07-11 ~ 2026-07-17");
  assert.notEqual(parsed, null);
  assert.equal(inclusiveDayCount(parsed!.start, parsed!.end), 7);
  assert.notEqual(parseDateRangeValue("2026-07-16～2026-07-22"), null);
});

test("rejects malformed date range values", () => {
  assert.equal(parseDateRangeValue("invalid"), null);
  assert.equal(parseDateRangeValue("2026-07-17 ~ 2026-07-11"), null);
});
