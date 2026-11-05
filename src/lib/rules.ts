import type {
  BoardFilters,
  ChangeItem,
  HelpdeskRequest,
  RequestEvent,
  Site,
  Staff,
} from "../types";
import { formatUnixInSiteZone, localDate } from "./dates";

/**
 * Rule 1: Which requests count.
 * `created_at`, converted to the site's local date, is from `from` to `to` inclusive.
 * Skip requests with status `canceled`, with `deleted_at` set, or with `merged_into_id` set.
 */
export function doesRequestCount(
  req: HelpdeskRequest,
  siteTimezone: string,
  from: string,
  to: string,
): boolean {
  if (req.status === "canceled") return false;
  if (req.deleted_at !== null) return false;
  if (req.merged_into_id !== null) return false;

  const createdLocal = localDate(new Date(req.created_at), siteTimezone);
  return createdLocal >= from && createdLocal <= to;
}

/**
 * Rule 2: Overdue.
 * Status is `pending` or `processing`, and `due_on` (a site-local date) is before
 * today's date in the site's timezone. `due_on: null` is never overdue.
 */
export function isRequestOverdue(
  req: HelpdeskRequest,
  siteTimezone: string,
  now: Date = new Date(),
): boolean {
  if (req.due_on === null) return false;
  if (req.status !== "pending" && req.status !== "processing") return false;
  const siteToday = localDate(now, siteTimezone);
  return req.due_on < siteToday;
}

/**
 * Rule 3: Names.
 * Look people up by id in `/v1/staff` (`assignee.id`, `actor_id`).
 * Do not display `assignee.name` or `actor_name` from a request or event: they can be stale.
 */
export function resolveAssigneeName(
  assignee: { id: number; name?: string } | null,
  staffById: ReadonlyMap<number, string>,
): string | null {
  if (!assignee) return null;
  return staffById.get(assignee.id) ?? `Staff #${assignee.id}`;
}

export function resolveActorName(
  actorId: number | null,
  staffById: ReadonlyMap<number, string>,
): string {
  if (actorId === null) return "System";
  return staffById.get(actorId) ?? `Staff #${actorId}`;
}

export interface TimelineEventItem {
  event: RequestEvent;
  isUndone: boolean;
  revertedByEventId: number | null;
}

/**
 * Rule 5: Undone events.
 * An event with `reverts_id` undoes the event it points at.
 * Hide both from the timeline by default.
 */
export function analyzeEvents(events: readonly RequestEvent[]): {
  visibleEvents: RequestEvent[];
  undoneEvents: RequestEvent[];
  allAnnotated: TimelineEventItem[];
} {
  // Deduplicate by event.id in case of overlapping pages or duplicate change feed items
  const uniqueById = new Map<number, RequestEvent>();
  for (const ev of events) {
    uniqueById.set(ev.id, ev);
  }
  const deduplicated = Array.from(uniqueById.values());

  // Sort newest first by `at`, then `id` descending
  deduplicated.sort((a, b) => (b.at !== a.at ? b.at - a.at : b.id - a.id));

  // Map target event id -> reverting event id
  const revertedByMap = new Map<number, number>();
  const revertingIds = new Set<number>();

  for (const ev of deduplicated) {
    if (ev.reverts_id !== null) {
      revertingIds.add(ev.id);
      revertedByMap.set(ev.reverts_id, ev.id);
    }
  }

  const visibleEvents: RequestEvent[] = [];
  const undoneEvents: RequestEvent[] = [];
  const allAnnotated: TimelineEventItem[] = [];

  for (const ev of deduplicated) {
    const isReverting = revertingIds.has(ev.id);
    const revertedByEventId = revertedByMap.get(ev.id) ?? null;
    const isUndone = isReverting || revertedByEventId !== null;

    if (isUndone) {
      undoneEvents.push(ev);
    } else {
      visibleEvents.push(ev);
    }

    allAnnotated.push({
      event: ev,
      isUndone,
      revertedByEventId,
    });
  }

  return { visibleEvents, undoneEvents, allAnnotated };
}

export interface FirstResponseInfo {
  event: RequestEvent;
  actorName: string;
  formattedTime: string;
}

/**
 * Rule 6: First response.
 * The earliest event (by `at`) with status `processing` and an `actor_id`
 * (System events have `actor_id: null`). Show that person's current name and the time.
 * Note: Undone events (Rule 5) are excluded so an accidentally set and reverted
 * processing status does not count as the first response.
 */
export function findFirstResponse(
  events: readonly RequestEvent[],
  staffById: ReadonlyMap<number, string>,
  siteTimezone: string,
): FirstResponseInfo | null {
  const { visibleEvents } = analyzeEvents(events);
  const candidates = visibleEvents.filter(
    (ev) => ev.status === "processing" && ev.actor_id !== null,
  );
  if (candidates.length === 0) return null;

  // Earliest by `at` (and `id` asc on ties)
  candidates.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id - b.id));
  const earliest = candidates[0];

  return {
    event: earliest,
    actorName: resolveActorName(earliest.actor_id, staffById),
    formattedTime: formatUnixInSiteZone(earliest.at, siteTimezone),
  };
}

/**
 * Deduplicate an array of requests by `id` (handling the API's pagination boundary overlap).
 */
export function deduplicateRequests(
  requests: readonly HelpdeskRequest[],
): Map<number, HelpdeskRequest> {
  const map = new Map<number, HelpdeskRequest>();
  for (const r of requests) {
    map.set(r.id, r);
  }
  return map;
}

/**
 * Apply items from `/v1/changes` idempotently to in-memory state.
 */
export function applyChangeItems(
  state: {
    requestsById: ReadonlyMap<number, HelpdeskRequest>;
    staffById: ReadonlyMap<number, string>;
    eventsByRequestId: ReadonlyMap<number, RequestEvent[]>;
  },
  changes: readonly ChangeItem[],
): {
  requestsById: Map<number, HelpdeskRequest>;
  staffById: Map<number, string>;
  eventsByRequestId: Map<number, RequestEvent[]>;
  changedRequestIds: Set<number>;
  staffUpdated: boolean;
} {
  const requestsById = new Map(state.requestsById);
  const staffById = new Map(state.staffById);
  const eventsByRequestId = new Map(state.eventsByRequestId);
  const changedRequestIds = new Set<number>();
  let staffUpdated = false;

  for (const item of changes) {
    if (item.type === "request.created" || item.type === "request.updated") {
      requestsById.set(item.request.id, item.request);
      changedRequestIds.add(item.request.id);
    } else if (item.type === "staff.updated") {
      if (staffById.get(item.staff.id) !== item.staff.name) {
        staffById.set(item.staff.id, item.staff.name);
        staffUpdated = true;
      }
    } else if (item.type === "event.created") {
      const existing = eventsByRequestId.get(item.request_id);
      if (existing) {
        const exists = existing.some((e) => e.id === item.event.id);
        if (!exists) {
          eventsByRequestId.set(item.request_id, [item.event, ...existing]);
          changedRequestIds.add(item.request_id);
        }
      }
    }
  }

  return {
    requestsById,
    staffById,
    eventsByRequestId,
    changedRequestIds,
    staffUpdated,
  };
}

export interface EnrichedBoardRow {
  request: HelpdeskRequest;
  site: Site | undefined;
  siteTimezone: string;
  siteName: string;
  assigneeName: string | null;
  isOverdue: boolean;
  createdLocalDate: string;
}

/**
 * Filters and sorts requests for the board according to Rules 1, 2, 3 and user filters.
 */
export function selectBoardRows(
  requestsById: ReadonlyMap<number, HelpdeskRequest>,
  sitesById: ReadonlyMap<number, Site>,
  staffById: ReadonlyMap<number, string>,
  filters: BoardFilters,
  now: Date = new Date(),
): {
  rows: EnrichedBoardRow[];
  totalCountingInRange: number;
  overdueInFiltered: number;
} {
  const countingRows: EnrichedBoardRow[] = [];

  for (const req of requestsById.values()) {
    const site = sitesById.get(req.site_id);
    const siteTimezone = site?.timezone ?? "UTC";
    if (!doesRequestCount(req, siteTimezone, filters.from, filters.to)) {
      continue;
    }

    const assigneeName = resolveAssigneeName(req.assignee, staffById);
    const isOverdue = isRequestOverdue(req, siteTimezone, now);
    const createdLocalDate = localDate(new Date(req.created_at), siteTimezone);

    countingRows.push({
      request: req,
      site,
      siteTimezone,
      siteName: site?.name ?? `Site #${req.site_id}`,
      assigneeName,
      isOverdue,
      createdLocalDate,
    });
  }

  const totalCountingInRange = countingRows.length;

  const searchLower = filters.search.trim().toLowerCase();

  const filtered = countingRows.filter((row) => {
    if (filters.siteId !== "all" && row.request.site_id !== filters.siteId) {
      return false;
    }
    if (filters.status !== "all" && row.request.status !== filters.status) {
      return false;
    }
    if (filters.overdueOnly && !row.isOverdue) {
      return false;
    }
    if (searchLower) {
      const refMatch = row.request.ref.toLowerCase().includes(searchLower);
      const titleMatch = row.request.title.toLowerCase().includes(searchLower);
      const locMatch = row.request.location.toLowerCase().includes(searchLower);
      const assigneeMatch = (row.assigneeName ?? "unassigned")
        .toLowerCase()
        .includes(searchLower);
      if (!refMatch && !titleMatch && !locMatch && !assigneeMatch) {
        return false;
      }
    }
    return true;
  });

  const overdueInFiltered = filtered.filter((r) => r.isOverdue).length;

  const dirMultiplier = filters.sortDir === "asc" ? 1 : -1;

  filtered.sort((a, b) => {
    if (filters.sortField === "due") {
      // Requests without a due date always sort after requests with a due date
      if (a.request.due_on === null && b.request.due_on !== null) return 1;
      if (a.request.due_on !== null && b.request.due_on === null) return -1;
      if (
        a.request.due_on !== null &&
        b.request.due_on !== null &&
        a.request.due_on !== b.request.due_on
      ) {
        return a.request.due_on < b.request.due_on
          ? -1 * dirMultiplier
          : 1 * dirMultiplier;
      }
    }

    // Sort by created_at (or tie-break by created_at)
    const tA = Date.parse(a.request.created_at);
    const tB = Date.parse(b.request.created_at);
    if (tA !== tB) {
      return filters.sortField === "created"
        ? (tA - tB) * dirMultiplier
        : tB - tA;
    }
    return (a.request.id - b.request.id) * dirMultiplier;
  });

  return {
    rows: filtered,
    totalCountingInRange,
    overdueInFiltered,
  };
}

export function buildStaffMap(staffList: readonly Staff[]): Map<number, string> {
  return new Map(staffList.map((s) => [s.id, s.name]));
}

export function buildSiteMap(sites: readonly Site[]): Map<number, Site> {
  return new Map(sites.map((s) => [s.id, s]));
}
