import { describe, expect, it } from "vitest";
import { parseFiltersFromSearch, serializeFiltersToSearch } from "./urlState";

describe("URL state serialization and parsing", () => {
  const fixedToday = new Date("2026-11-05T12:00:00Z");

  it("defaults to last 30 days, all sites, all statuses, created desc", () => {
    const parsed = parseFiltersFromSearch("", fixedToday);
    expect(parsed).toEqual({
      from: "2026-10-06",
      to: "2026-11-05",
      siteId: "all",
      status: "all",
      sortField: "created",
      sortDir: "desc",
      overdueOnly: false,
      search: "",
      selectedRequestId: null,
    });
  });

  it("round-trips range, filters, sort, and selected request id through query params", () => {
    const original = {
      from: "2026-10-10",
      to: "2026-11-01",
      siteId: 12 as const,
      status: "processing" as const,
      sortField: "due" as const,
      sortDir: "asc" as const,
      overdueOnly: true,
      search: "lift",
      selectedRequestId: 65127,
    };

    const query = serializeFiltersToSearch(original);
    const restored = parseFiltersFromSearch(query, fixedToday);
    expect(restored).toEqual(original);
  });

  it("swaps inverted date ranges and ignores invalid status values like canceled", () => {
    const parsed = parseFiltersFromSearch(
      "?from=2026-11-05&to=2026-10-06&status=canceled&site=abc",
      fixedToday,
    );
    expect(parsed.from).toBe("2026-10-06");
    expect(parsed.to).toBe("2026-11-05");
    expect(parsed.status).toBe("all");
    expect(parsed.siteId).toBe("all");
  });
});
