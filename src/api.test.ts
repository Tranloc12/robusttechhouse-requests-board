import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RetryNotice,
  fetchAllEventsForRequest,
  fetchAllRequestsForRange,
  get,
  subscribeApiRetryStatus,
} from "./api";

describe("api resilience and pagination helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries automatically on 429 using Retry-After header and notifies listeners", async () => {
    const notices: Array<RetryNotice | null> = [];
    const unsubscribe = subscribeApiRetryStatus((n) => notices.push(n));

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
          headers: { "Retry-After": "0.05" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 1, name: "Test" }] }), {
          status: 200,
        }),
      );

    const res = await get<{ data: Array<{ id: number; name: string }> }>(
      "/v1/staff",
    );
    unsubscribe();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.data[0].name).toBe("Test");
    expect(notices[0]?.status).toBe(429);
    expect(notices[notices.length - 1]).toBeNull();
  });

  it("deduplicates overlapping page boundaries in fetchAllRequestsForRange and pads date range by ±1 day", async () => {
    const calledUrls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const urlStr = String(input);
      calledUrls.push(urlStr);
      const url = new URL(urlStr);
      const page = Number(url.searchParams.get("page") || "1");

      if (page === 1) {
        return new Response(
          JSON.stringify({
            page: 1,
            per_page: 100,
            total_pages: 2,
            total: 3,
            data: [
              { id: 101, ref: "WO-101" },
              { id: 102, ref: "WO-102" },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          page: 2,
          per_page: 100,
          total_pages: 2,
          total: 3,
          data: [
            // 102 repeated due to server off-by-one boundary overlap
            { id: 102, ref: "WO-102" },
            { id: 103, ref: "WO-103" },
          ],
        }),
        { status: 200 },
      );
    });

    const map = await fetchAllRequestsForRange("2026-10-06", "2026-11-05");
    expect(map.size).toBe(3);
    expect(calledUrls[0]).toContain("created_from=05%2F10%2F2026");
    expect(calledUrls[0]).toContain("created_to=06%2F11%2F2026");
  });

  it("fetches all pages in fetchAllEventsForRequest when has_more is true", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            page: 1,
            per_page: 50,
            has_more: true,
            data: [{ id: 1, status: "processing", at: 200 }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            page: 2,
            per_page: 50,
            has_more: false,
            data: [{ id: 2, status: "pending", at: 100 }],
          }),
          { status: 200 },
        ),
      );

    const events = await fetchAllEventsForRequest(999);
    expect(events.map((e) => e.id)).toEqual([1, 2]);
  });
});
