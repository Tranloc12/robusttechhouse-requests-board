import { describe, expect, it } from "vitest";
import type { HelpdeskRequest, RequestEvent, Site } from "../types";
import {
  analyzeEvents,
  applyChangeItems,
  buildSiteMap,
  buildStaffMap,
  deduplicateRequests,
  doesRequestCount,
  findFirstResponse,
  isRequestOverdue,
  resolveActorName,
  resolveAssigneeName,
  selectBoardRows,
} from "./rules";

const SITES: Site[] = [
  {
    id: 11,
    name: "Robusttechhouse Tower Singapore",
    timezone: "Asia/Singapore",
    business_hours: {},
  },
  {
    id: 12,
    name: "Robusttechhouse Court Sydney",
    timezone: "Australia/Sydney",
    business_hours: {},
  },
  {
    id: 13,
    name: "Robusttechhouse Plaza Jakarta",
    timezone: "Asia/Jakarta",
    business_hours: {},
  },
];

function makeReq(overrides: Partial<HelpdeskRequest> = {}): HelpdeskRequest {
  return {
    id: 100,
    ref: "WO-100",
    title: "Room too warm",
    location: "North Wing / Lobby",
    site_id: 11,
    status: "processing",
    priority: "High",
    created_at: "2026-10-06T02:15:07Z",
    updated_at: "2026-10-06T03:40:00Z",
    due_on: "2026-10-07",
    assignee: { id: 353, name: "Grace Ong (Stale)" },
    deleted_at: null,
    merged_into_id: null,
    ...overrides,
  };
}

describe("Rule 1: Which requests count (doesRequestCount)", () => {
  it("counts requests whose site-local created_at date falls within [from, to] inclusive", () => {
    // 2026-10-05T15:30:00Z is 2026-10-06 in Sydney (UTC+11) but still 2026-10-05 in Jakarta (UTC+7)
    const req = makeReq({ created_at: "2026-10-05T15:30:00Z" });
    expect(doesRequestCount(req, "Australia/Sydney", "2026-10-06", "2026-11-05")).toBe(true);
    expect(doesRequestCount(req, "Asia/Jakarta", "2026-10-06", "2026-11-05")).toBe(false);
  });

  it("skips canceled, deleted, and merged requests", () => {
    expect(
      doesRequestCount(
        makeReq({ status: "canceled" }),
        "Asia/Singapore",
        "2026-10-01",
        "2026-10-31",
      ),
    ).toBe(false);
    expect(
      doesRequestCount(
        makeReq({ deleted_at: "2026-10-10T00:00:00Z" }),
        "Asia/Singapore",
        "2026-10-01",
        "2026-10-31",
      ),
    ).toBe(false);
    expect(
      doesRequestCount(
        makeReq({ merged_into_id: 99 }),
        "Asia/Singapore",
        "2026-10-01",
        "2026-10-31",
      ),
    ).toBe(false);
  });
});

describe("Rule 2: Overdue (isRequestOverdue)", () => {
  it("marks pending/processing requests as overdue only when due_on < today in the site's timezone", () => {
    // At 2026-11-05T15:30:00Z:
    // - Sydney (UTC+11) is already 2026-11-06
    // - Singapore (UTC+8) is still 2026-11-05
    const now = new Date("2026-11-05T15:30:00Z");
    const reqDueNov5 = makeReq({ status: "pending", due_on: "2026-11-05" });

    expect(isRequestOverdue(reqDueNov5, "Australia/Sydney", now)).toBe(true);
    expect(isRequestOverdue(reqDueNov5, "Asia/Singapore", now)).toBe(false);
  });

  it("never marks complete, canceled, or due_on: null requests as overdue", () => {
    const now = new Date("2026-11-05T15:30:00Z");
    expect(
      isRequestOverdue(
        makeReq({ status: "complete", due_on: "2026-10-01" }),
        "Asia/Singapore",
        now,
      ),
    ).toBe(false);
    expect(
      isRequestOverdue(
        makeReq({ status: "processing", due_on: null }),
        "Asia/Singapore",
        now,
      ),
    ).toBe(false);
  });
});

describe("Rule 3: Names (resolveAssigneeName & resolveActorName)", () => {
  const staffMap = buildStaffMap([
    { id: 353, name: "Grace Ong-Wee" },
    { id: 368, name: "Marcus Lee" },
    { id: 371, name: "Marcus Lee" },
  ]);

  it("resolves current name from /v1/staff by id and ignores stale embedded names", () => {
    expect(
      resolveAssigneeName({ id: 353, name: "Grace Ong" }, staffMap),
    ).toBe("Grace Ong-Wee");
    expect(resolveAssigneeName(null, staffMap)).toBeNull();
    expect(resolveActorName(353, staffMap)).toBe("Grace Ong-Wee");
    expect(resolveActorName(null, staffMap)).toBe("System");
  });
});

describe("Rule 5 & Rule 6: Undone events and First response", () => {
  const staffMap = buildStaffMap([
    { id: 347, name: "Elaine Ng" },
    { id: 353, name: "Grace Ong-Wee" },
  ]);

  const sampleEvents: RequestEvent[] = [
    {
      id: 300675,
      status: "complete",
      at: 1777681778,
      actor_id: 347,
      actor_name: "Elaine Ng",
      assignee_name: null,
      due_at: null,
      note: null,
      reverts_id: null,
    },
    {
      id: 300396,
      status: "processing",
      at: 1777631367,
      actor_id: 353,
      actor_name: "Grace Ong", // Stale name on event!
      assignee_name: null,
      due_at: null,
      note: null,
      reverts_id: null,
    },
    {
      id: 300258,
      status: "pending",
      at: 1777617597,
      actor_id: 347,
      actor_name: "Elaine Ng",
      assignee_name: null,
      due_at: null,
      note: "Status changed in error",
      reverts_id: 300252, // Undoes 300252!
    },
    {
      id: 300252,
      status: "processing",
      at: 1777616958,
      actor_id: 347,
      actor_name: "Elaine Ng",
      assignee_name: null,
      due_at: null,
      note: null,
      reverts_id: null,
    },
    {
      id: 300240,
      status: "processing",
      at: 1777616000,
      actor_id: null, // System event — does NOT count as first response!
      actor_name: "System",
      assignee_name: null,
      due_at: null,
      note: "Auto-assigned by workflow",
      reverts_id: null,
    },
  ];

  it("hides both the reverting event and the reverted event by default (Rule 5)", () => {
    const { visibleEvents, undoneEvents } = analyzeEvents(sampleEvents);
    expect(visibleEvents.map((e) => e.id)).toEqual([300675, 300396, 300240]);
    expect(undoneEvents.map((e) => e.id)).toEqual([300258, 300252]);
  });

  it("computes First response from earliest non-undone processing event with non-null actor_id using current staff name (Rule 6)", () => {
    const first = findFirstResponse(sampleEvents, staffMap, "Asia/Singapore");
    expect(first).not.toBeNull();
    // 300240 is System (actor_id: null); 300252 was undone by 300258; so 300396 is the true first response!
    expect(first?.event.id).toBe(300396);
    expect(first?.actorName).toBe("Grace Ong-Wee");
    expect(first?.formattedTime).toContain("(Asia/Singapore)");
  });
});

describe("Pagination deduplication & change feed application", () => {
  it("deduplicates overlapping page boundaries by request id", () => {
    const r1 = makeReq({ id: 1, title: "First" });
    const r2 = makeReq({ id: 2, title: "Boundary item" });
    const r2Dup = makeReq({ id: 2, title: "Boundary item" });
    const r3 = makeReq({ id: 3, title: "Third" });
    const map = deduplicateRequests([r1, r2, r2Dup, r3]);
    expect(map.size).toBe(3);
  });

  it("applies request, event, and staff changes idempotently", () => {
    const r1 = makeReq({ id: 10, status: "pending" });
    const initial = {
      requestsById: new Map([[10, r1]]),
      staffById: new Map([[353, "Grace Ong"]]),
      eventsByRequestId: new Map<number, RequestEvent[]>([[10, []]]),
    };

    const next = applyChangeItems(initial, [
      {
        seq: 1,
        type: "staff.updated",
        at: "2026-11-02T02:08:00Z",
        staff: { id: 353, name: "Grace Ong-Wee" },
      },
      {
        seq: 2,
        type: "request.updated",
        at: "2026-11-02T02:10:00Z",
        request: { ...r1, status: "processing" },
      },
      {
        seq: 3,
        type: "event.created",
        at: "2026-11-02T02:10:00Z",
        request_id: 10,
        event: {
          id: 901,
          status: "processing",
          at: 1793585400,
          actor_id: 353,
          actor_name: "Grace Ong",
          assignee_name: null,
          due_at: null,
          note: null,
          reverts_id: null,
        },
      },
      // Duplicate event delivery
      {
        seq: 3,
        type: "event.created",
        at: "2026-11-02T02:10:00Z",
        request_id: 10,
        event: {
          id: 901,
          status: "processing",
          at: 1793585400,
          actor_id: 353,
          actor_name: "Grace Ong",
          assignee_name: null,
          due_at: null,
          note: null,
          reverts_id: null,
        },
      },
    ]);

    expect(next.staffById.get(353)).toBe("Grace Ong-Wee");
    expect(next.requestsById.get(10)?.status).toBe("processing");
    expect(next.eventsByRequestId.get(10)?.length).toBe(1);
  });
});

describe("selectBoardRows filtering and sorting", () => {
  const sitesMap = buildSiteMap(SITES);
  const staffMap = buildStaffMap([{ id: 353, name: "Grace Ong-Wee" }]);

  const reqA = makeReq({
    id: 1,
    ref: "WO-1",
    site_id: 11,
    status: "pending",
    created_at: "2026-10-10T05:00:00Z",
    due_on: "2026-10-15",
  });
  const reqB = makeReq({
    id: 2,
    ref: "WO-2",
    site_id: 12,
    status: "processing",
    created_at: "2026-10-20T05:00:00Z",
    due_on: "2026-10-12",
  });
  const reqC = makeReq({
    id: 3,
    ref: "WO-3",
    site_id: 11,
    status: "complete",
    created_at: "2026-10-25T05:00:00Z",
    due_on: null,
  });

  const requestsMap = deduplicateRequests([reqA, reqB, reqC]);

  it("sorts by due date asc while keeping null due_on at the end", () => {
    const { rows } = selectBoardRows(
      requestsMap,
      sitesMap,
      staffMap,
      {
        from: "2026-10-01",
        to: "2026-10-31",
        siteId: "all",
        status: "all",
        sortField: "due",
        sortDir: "asc",
        overdueOnly: false,
        search: "",
        selectedRequestId: null,
      },
      new Date("2026-11-05T00:00:00Z"),
    );

    expect(rows.map((r) => r.request.ref)).toEqual(["WO-2", "WO-1", "WO-3"]);
  });
});
