const DATE_RANGE_INPUT_PLACEHOLDER = "开始时间 ~ 结束时间";

export function dateRangeInputSelector(): string {
  return `.content-ecom-yuntu-yuntu-date-picker input[placeholder="${DATE_RANGE_INPUT_PLACEHOLDER}"]`;
}

export function dateRangeQuickSelectLabel(days: number): string | null {
  const candidates = dateRangeQuickSelectLabelCandidates(days);
  return candidates[0] ?? null;
}

export function dateRangeQuickSelectLabelCandidates(
  days: number,
): readonly string[] {
  if (days === 7) {
    return ["过去 7 天", "过去7天", "近7天", "最近7天"];
  }
  if (days === 15) {
    return ["过去 15 天", "过去15天", "近15天", "最近15天"];
  }
  if (days === 30) {
    return ["过去 30 天", "过去30天", "近30天", "最近30天"];
  }

  return [];
}

export function dateRangeQuickSelectPattern(days: number): RegExp | null {
  if (days === 7) {
    return /(?:过去|近|最近)\s*7\s*天/;
  }
  if (days === 15) {
    return /(?:过去|近|最近)\s*15\s*天/;
  }
  if (days === 30) {
    return /(?:过去|近|最近)\s*30\s*天/;
  }

  return null;
}

export function normalizeDateRangeDisplay(value: string): string | null {
  const match = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})\s*[~～〜∼]\s*(\d{4}-\d{2}-\d{2})$/);
  if (match === null) {
    return null;
  }

  return `${match[1]} ~ ${match[2]}`;
}

export function parseDateRangeValue(
  value: string,
): { start: Date; end: Date } | null {
  const normalized = normalizeDateRangeDisplay(value) ?? value.trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s*[~～〜∼]\s*(\d{4}-\d{2}-\d{2})$/);
  if (match === null) {
    return null;
  }

  const start = parseLocalDate(match[1]);
  const end = parseLocalDate(match[2]);
  if (start === null || end === null || start.getTime() > end.getTime()) {
    return null;
  }

  return { start, end };
}

export function inclusiveDayCount(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000) + 1;
}

function parseLocalDate(value: string): Date | null {
  const parts = value.split("-").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}
