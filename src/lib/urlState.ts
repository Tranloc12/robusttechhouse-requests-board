import type { BoardFilters, SortDir, SortField, Status } from "../types";
import { daysAgo, isValidIsoDate } from "./dates";

const VALID_STATUSES = new Set<Status>(["pending", "processing", "complete"]);
const VALID_SORT_FIELDS = new Set<SortField>(["created", "due"]);
const VALID_SORT_DIRS = new Set<SortDir>(["asc", "desc"]);

export function getDefaultFilters(today = new Date()): BoardFilters {
  return {
    from: daysAgo(30, today),
    to: daysAgo(0, today),
    siteId: "all",
    status: "all",
    sortField: "created",
    sortDir: "desc",
    overdueOnly: false,
    search: "",
    selectedRequestId: null,
  };
}

export function parseFiltersFromSearch(
  searchString: string,
  today = new Date(),
): BoardFilters {
  const defaults = getDefaultFilters(today);
  const params = new URLSearchParams(searchString);

  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  let from = rawFrom && isValidIsoDate(rawFrom) ? rawFrom : defaults.from;
  let to = rawTo && isValidIsoDate(rawTo) ? rawTo : defaults.to;
  if (from > to) {
    [from, to] = [to, from];
  }

  const rawSite = params.get("site");
  const siteNum = rawSite ? Number(rawSite) : Number.NaN;
  const siteId = Number.isInteger(siteNum) && siteNum > 0 ? siteNum : "all";

  const rawStatus = params.get("status") as Status | null;
  const status =
    rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : "all";

  const rawSort = params.get("sort") as SortField | null;
  const sortField =
    rawSort && VALID_SORT_FIELDS.has(rawSort) ? rawSort : defaults.sortField;

  const rawDir = params.get("dir") as SortDir | null;
  const sortDir =
    rawDir && VALID_SORT_DIRS.has(rawDir) ? rawDir : defaults.sortDir;

  const overdueOnly = params.get("overdue") === "1" || params.get("overdue") === "true";
  const search = params.get("q") ?? "";

  const rawReq = params.get("request");
  const reqNum = rawReq ? Number(rawReq) : Number.NaN;
  const selectedRequestId =
    Number.isInteger(reqNum) && reqNum > 0 ? reqNum : null;

  return {
    from,
    to,
    siteId,
    status,
    sortField,
    sortDir,
    overdueOnly,
    search,
    selectedRequestId,
  };
}

export function serializeFiltersToSearch(filters: BoardFilters): string {
  const params = new URLSearchParams();
  params.set("from", filters.from);
  params.set("to", filters.to);
  if (filters.siteId !== "all") {
    params.set("site", String(filters.siteId));
  }
  if (filters.status !== "all") {
    params.set("status", filters.status);
  }
  params.set("sort", filters.sortField);
  params.set("dir", filters.sortDir);
  if (filters.overdueOnly) {
    params.set("overdue", "1");
  }
  if (filters.search.trim()) {
    params.set("q", filters.search.trim());
  }
  if (filters.selectedRequestId !== null) {
    params.set("request", String(filters.selectedRequestId));
  }
  const str = params.toString();
  return str ? `?${str}` : "";
}
