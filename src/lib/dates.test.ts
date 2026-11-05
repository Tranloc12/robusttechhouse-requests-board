import { describe, expect, it } from "vitest";
import {
  addDays,
  daysAgo,
  formatLocalDate,
  formatUnixInSiteZone,
  formatUtcInSiteZone,
  formatWallClockInSiteZone,
  isValidIsoDate,
  localDate,
  toApiDate,
} from "./dates";

describe("toApiDate", () => {
  it("turns an ISO date into the API's DD/MM/YYYY", () => {
    expect(toApiDate("2026-10-06")).toBe("06/10/2026");
  });

  it("refuses anything else", () => {
    expect(() => toApiDate("06/10/2026")).toThrow();
  });
});

describe("isValidIsoDate & addDays", () => {
  it("validates calendar dates and shifts across month boundaries", () => {
    expect(isValidIsoDate("2026-10-06")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("localDate", () => {
  it("is the next day in Sydney when it is still evening in UTC", () => {
    const instant = new Date("2026-10-06T15:30:00Z");
    expect(localDate(instant, "Australia/Sydney")).toBe("2026-10-07");
    expect(localDate(instant, "Asia/Singapore")).toBe("2026-10-06");
  });
});

describe("daysAgo", () => {
  it("counts back across a month boundary", () => {
    expect(daysAgo(30, new Date("2026-10-15T00:00:00Z"))).toBe("2026-09-15");
  });
});

describe("Rule 4 timezone formatting", () => {
  it("formats ISO 8601 UTC timestamps in the site's timezone and names the zone", () => {
    expect(formatUtcInSiteZone("2026-10-06T02:15:07Z", "Asia/Singapore")).toBe(
      "2026-10-06 10:15 (Asia/Singapore)",
    );
    expect(formatUtcInSiteZone("2026-10-06T15:30:00Z", "Australia/Sydney")).toBe(
      "2026-10-07 02:30 (Australia/Sydney)",
    );
  });

  it("formats Unix seconds in the site's timezone and names the zone", () => {
    // 2026-10-06T02:15:00Z = 1791252900
    expect(formatUnixInSiteZone(1791252900, "Asia/Jakarta")).toBe(
      "2026-10-06 09:15 (Asia/Jakarta)",
    );
  });

  it("formats event due_at as site-local wall-clock time without double-shifting", () => {
    expect(formatWallClockInSiteZone("07/10/2026 10:00", "Asia/Singapore")).toBe(
      "2026-10-07 10:00 (Asia/Singapore)",
    );
  });

  it("formats site-local due_on dates cleanly", () => {
    expect(formatLocalDate("2026-10-07", "Asia/Singapore")).toBe(
      "2026-10-07 (Asia/Singapore)",
    );
  });
});
