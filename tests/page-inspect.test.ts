import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPageInspectionSummary,
  hasSubdivisionFilters,
  type PageInspection,
} from "../src/ui/page-inspect.js";

function sampleInspection(
  overrides: Partial<PageInspection> = {},
): PageInspection {
  return {
    pathname: "/yuntu_brand/ecom/content_new/creative/content_lab/inspiration/industryContent",
    title: "巨量云图",
    frameCount: 1,
    markersFound: [],
    markersMissing: ["指定品牌", "截取方式"],
    requiresSignIn: false,
    onIndustryContentPath: true,
    onTaContentPath: false,
    textExcerpt: "",
    ...overrides,
  };
}

test("detects subdivision filters from marker hits", () => {
  assert.equal(
    hasSubdivisionFilters(
      sampleInspection({ markersFound: ["指定品牌"], markersMissing: ["截取方式"] }),
    ),
    true,
  );
  assert.equal(
    hasSubdivisionFilters(sampleInspection({ markersFound: ["曝光"] })),
    false,
  );
});

test("formats inspection summary for error messages", () => {
  const summary = formatPageInspectionSummary(
    sampleInspection({
      markersFound: ["曝光", "开始时间"],
      textExcerpt: "行业内容 曝光 排行",
    }),
  );
  assert.match(summary, /path=/);
  assert.match(summary, /markers=曝光,开始时间/);
  assert.match(summary, /missing=指定品牌,截取方式/);
});
