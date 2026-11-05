import { describe, expect, it } from "vitest";
import { buildRequestsCsv, escapeCsvField, getCsvFilename } from "./csv";
import type { EnrichedBoardRow } from "./rules";

describe("CSV export for finance team (client message)", () => {
  it("formats filename as requests-<from>-<to>.csv", () => {
    expect(getCsvFilename("2026-10-06", "2026-11-05")).toBe(
      "requests-2026-10-06-2026-11-05.csv",
    );
  });

  it("quotes values containing commas, quotes, or newlines and leaves null empty", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField("Simple")).toBe("Simple");
    expect(escapeCsvField("Room 4, North Wing")).toBe('"Room 4, North Wing"');
    expect(escapeCsvField('Lift "B" stuck')).toBe('"Lift ""B"" stuck"');
    expect(escapeCsvField("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
  });

  it("builds CSV with exact header and columns in current sort order", () => {
    const rows: EnrichedBoardRow[] = [
      {
        request: {
          id: 1,
          ref: "WO-100",
          title: 'AC "noisy", room warm',
          location: "L3",
          site_id: 11,
          status: "processing",
          priority: "High",
          created_at: "2026-10-06T02:15:07Z",
          updated_at: "2026-10-06T03:00:00Z",
          due_on: "2026-10-07",
          assignee: { id: 353, name: "Grace Ong" },
          deleted_at: null,
          merged_into_id: null,
        },
        site: undefined,
        siteTimezone: "Asia/Singapore",
        siteName: "Robusttechhouse Tower Singapore",
        assigneeName: "Grace Ong-Wee",
        isOverdue: true,
        createdLocalDate: "2026-10-06",
      },
      {
        request: {
          id: 2,
          ref: "WO-101",
          title: "Wet floor",
          location: "L1",
          site_id: 12,
          status: "pending",
          priority: null,
          created_at: "2026-10-06T15:30:00Z",
          updated_at: "2026-10-06T15:30:00Z",
          due_on: null,
          assignee: null,
          deleted_at: null,
          merged_into_id: null,
        },
        site: undefined,
        siteTimezone: "Australia/Sydney",
        siteName: "Robusttechhouse Court Sydney",
        assigneeName: null,
        isOverdue: false,
        createdLocalDate: "2026-10-07",
      },
    ];

    const csv = buildRequestsCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "ref,site,title,priority,status,assignee,created_at,due_on,overdue",
    );
    expect(lines[1]).toBe(
      'WO-100,Robusttechhouse Tower Singapore,"AC ""noisy"", room warm",High,processing,Grace Ong-Wee,"06 Oct 2026, 10:15 (Asia/Singapore)",2026-10-07,true',
    );
    expect(lines[2]).toBe(
      'WO-101,Robusttechhouse Court Sydney,Wet floor,,pending,,"07 Oct 2026, 02:30 (Australia/Sydney)",,false',
    );
  });
});
