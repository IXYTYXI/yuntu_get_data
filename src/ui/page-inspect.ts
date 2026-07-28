import type { Frame, Page } from "playwright";

export interface PageInspection {
  pathname: string;
  title: string;
  frameCount: number;
  markersFound: string[];
  markersMissing: string[];
  requiresSignIn: boolean;
  onIndustryContentPath: boolean;
  onTaContentPath: boolean;
  textExcerpt: string;
}

const MARKER_DEFINITIONS = [
  { id: "指定品牌", pattern: /指定\s*品牌/ },
  { id: "竞品品牌", pattern: /竞品\s*品牌/ },
  { id: "截取方式", pattern: /截取\s*方式/ },
  { id: "细分筛选", pattern: /细分\s*筛选/ },
  { id: "行业内容榜", pattern: /行业内容榜/ },
  { id: "行业灵感激发", pattern: /行业灵感激发/ },
  { id: "开始时间", pattern: /开始时间\s*~\s*结束时间/ },
  { id: "曝光", pattern: /曝光/ },
  { id: "登录提示", pattern: /请登录|扫码登录|登录云图|重新登录/ },
  { id: "暂无数据", pattern: /暂无数据|无数据|没有数据/ },
] as const;

const EXPECTED_FILTER_MARKERS = ["细分筛选", "截取方式"] as const;

export async function inspectYuntuPage(page: Page): Promise<PageInspection> {
  let pathname = safePathname(page.url());
  let title = "";
  try {
    title = await page.title();
  } catch {
    title = "";
  }

  const frameTexts: string[] = [];
  for (const frame of page.frames()) {
    const chunk = await readFrameText(frame).catch(() => "");
    if (chunk.length > 0) {
      frameTexts.push(chunk);
    }
  }

  const combined = frameTexts.join("\n");
  const markersFound: string[] = [];
  for (const marker of MARKER_DEFINITIONS) {
    if (marker.pattern.test(combined)) {
      markersFound.push(marker.id);
    }
  }

  const markersMissing = EXPECTED_FILTER_MARKERS.filter(
    (marker) => !markersFound.includes(marker),
  );

  return {
    pathname,
    title: title.trim().slice(0, 120),
    frameCount: page.frames().length,
    markersFound,
    markersMissing,
    requiresSignIn:
      markersFound.includes("登录提示") &&
      !markersFound.includes("细分筛选") &&
      !markersFound.includes("截取方式"),
    onIndustryContentPath: pathname.includes(
      "/content_lab/inspiration/industryContent",
    ),
    onTaContentPath: pathname.includes("/ta_content"),
    textExcerpt: normalizeExcerpt(combined),
  };
}

export function formatPageInspectionSummary(
  inspection: PageInspection,
): string {
  const parts = [
    `path=${inspection.pathname}`,
    `frames=${inspection.frameCount}`,
    `markers=${inspection.markersFound.join(",") || "none"}`,
    `missing=${inspection.markersMissing.join(",") || "none"}`,
  ];
  if (inspection.textExcerpt.length > 0) {
    parts.push(`excerpt=${inspection.textExcerpt}`);
  }
  return parts.join("; ");
}

export function hasSubdivisionFilters(inspection: PageInspection): boolean {
  if (
    inspection.markersFound.includes("指定品牌") ||
    inspection.markersFound.includes("竞品品牌")
  ) {
    return true;
  }

  return (
    inspection.markersFound.includes("细分筛选") &&
    inspection.markersFound.includes("截取方式")
  );
}

async function readFrameText(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const root = document.body;
    if (root === null) {
      return "";
    }

    return (root.innerText ?? "").slice(0, 12_000);
  });
}

function safePathname(location: string): string {
  try {
    return new URL(location).pathname;
  } catch {
    return "[invalid-url]";
  }
}

function normalizeExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 320);
}
