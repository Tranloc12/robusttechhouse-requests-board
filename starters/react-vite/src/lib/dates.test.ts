import { describe, expect, it } from "vitest";
import { daysAgo, localDate, toApiDate } from "./dates";

describe("toApiDate", () => {
  it("turns an ISO date into the API's DD/MM/YYYY", () => {
    expect(toApiDate("2026-10-06")).toBe("06/10/2026");
  });

  it("refuses anything else", () => {
    expect(() => toApiDate("06/10/2026")).toThrow();
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
