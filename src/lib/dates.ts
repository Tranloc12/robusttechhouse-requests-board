// Date helpers. The API wants DD/MM/YYYY; the rules talk about each site's local date.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_CLOCK_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/** "2026-10-06" -> "06/10/2026" (the format the API's created_from/created_to expect). */
export function toApiDate(isoDate: string): string {
  const match = ISO_DATE_RE.exec(isoDate);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${isoDate}`);
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** Shift a YYYY-MM-DD calendar date by `deltaDays` (positive or negative). */
export function addDays(isoDate: string, deltaDays: number): string {
  const match = ISO_DATE_RE.exec(isoDate);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${isoDate}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return d.toISOString().slice(0, 10);
}

/** The YYYY-MM-DD date of an instant in a given IANA timezone. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today's date, as YYYY-MM-DD, minus `days` days (UTC arithmetic on the calendar date). */
export function daysAgo(days: number, today = new Date()): string {
  const date = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - days),
  );
  return date.toISOString().slice(0, 10);
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Formats an instant in the site's IANA timezone and explicitly names the zone (Rule 4).
 * Example: "06 Oct 2026, 10:15 (Asia/Singapore)"
 */
export function formatInstantInSiteZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("day")} ${get("month")} ${get("year")}, ${hour}:${get("minute")} (${timeZone})`;
}

/**
 * Rule 4: `created_at` and `updated_at` are ISO 8601 UTC.
 * Display in the site's timezone and name the zone.
 */
export function formatUtcInSiteZone(isoUtc: string, timeZone: string): string {
  const instant = new Date(isoUtc);
  if (Number.isNaN(instant.getTime())) return `${isoUtc} (${timeZone})`;
  return formatInstantInSiteZone(instant, timeZone);
}

/**
 * Rule 4: An event's `at` is Unix seconds.
 * Display in the site's timezone and name the zone.
 */
export function formatUnixInSiteZone(unixSeconds: number, timeZone: string): string {
  return formatInstantInSiteZone(new Date(unixSeconds * 1000), timeZone);
}

/**
 * Rule 4: `due_at` on an event is ALREADY site-local wall-clock time ("DD/MM/YYYY HH:MM").
 * Do not apply a second timezone shift; format clearly and name the site's timezone.
 */
export function formatWallClockInSiteZone(dueAt: string, timeZone: string): string {
  const match = WALL_CLOCK_RE.exec(dueAt.trim());
  if (!match) return `${dueAt} (${timeZone})`;
  const [, day, monthStr, year, hour, minute] = match;
  const monthIdx = Number(monthStr) - 1;
  const monthName = MONTHS_SHORT[monthIdx] ?? monthStr;
  return `${day} ${monthName} ${year}, ${hour}:${minute} (${timeZone})`;
}

/**
 * Formats a site-local `YYYY-MM-DD` date (`due_on`) for display, optionally naming the zone.
 */
export function formatLocalDate(isoDate: string, timeZone?: string): string {
  const match = ISO_DATE_RE.exec(isoDate);
  if (!match) return timeZone ? `${isoDate} (${timeZone})` : isoDate;
  const [, year, monthStr, day] = match;
  const monthIdx = Number(monthStr) - 1;
  const monthName = MONTHS_SHORT[monthIdx] ?? monthStr;
  const formatted = `${day} ${monthName} ${year}`;
  return timeZone ? `${formatted} (${timeZone})` : formatted;
}
