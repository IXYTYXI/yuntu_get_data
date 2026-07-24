const DATE_RANGE_INPUT_PLACEHOLDER = "开始时间 ~ 结束时间";

export function dateRangeInputSelector(): string {
  return `.content-ecom-yuntu-yuntu-date-picker input[placeholder="${DATE_RANGE_INPUT_PLACEHOLDER}"]`;
}

export function dateRangeQuickSelectLabel(days: number): string | null {
  if (days === 7) {
    return "过去 7 天";
  }
  if (days === 15) {
    return "过去 15 天";
  }
  if (days === 30) {
    return "过去 30 天";
  }

  return null;
}

export function parseDateRangeValue(
  value: string,
): { start: Date; end: Date } | null {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/);
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
