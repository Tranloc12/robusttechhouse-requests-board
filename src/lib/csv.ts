import { formatUtcInSiteZone } from "./dates";
import type { EnrichedBoardRow } from "./rules";

export const CSV_HEADER =
  "ref,site,title,priority,status,assignee,created_at,due_on,overdue";

/**
 * Escapes a single CSV field according to standard CSV rules:
 * - `null` or `undefined` becomes an empty field `""`
 * - Values containing a comma, double-quote, or line break are wrapped in
 *   double-quotes with internal double-quotes doubled (`""`).
 */
export function escapeCsvField(
  value: string | boolean | number | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[,"\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds the CSV string for all matching board rows in their current sort order.
 * Header: `ref,site,title,priority,status,assignee,created_at,due_on,overdue`
 */
export function buildRequestsCsv(rows: readonly EnrichedBoardRow[]): string {
  const lines: string[] = [CSV_HEADER];

  for (const row of rows) {
    const r = row.request;
    const createdAtLocal = formatUtcInSiteZone(r.created_at, row.siteTimezone);

    const fields = [
      escapeCsvField(r.ref),
      escapeCsvField(row.siteName),
      escapeCsvField(r.title),
      escapeCsvField(r.priority), // null -> empty field
      escapeCsvField(r.status),
      escapeCsvField(row.assigneeName), // null -> empty field, current name from /v1/staff
      escapeCsvField(createdAtLocal),
      escapeCsvField(r.due_on), // null -> empty field
      escapeCsvField(row.isOverdue ? "true" : "false"),
    ];

    lines.push(fields.join(","));
  }

  return lines.join("\n");
}

export function getCsvFilename(fromIso: string, toIso: string): string {
  return `requests-${fromIso}-${toIso}.csv`;
}

export function triggerCsvDownload(
  rows: readonly EnrichedBoardRow[],
  fromIso: string,
  toIso: string,
): void {
  const csvContent = buildRequestsCsv(rows);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getCsvFilename(fromIso, toIso);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
