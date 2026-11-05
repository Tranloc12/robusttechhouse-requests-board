import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type RetryNotice,
  configured,
  fetchAllEventsForRequest,
  fetchAllRequestsForRange,
  getRequest,
  listChanges,
  listRequests,
  listSites,
  listStaff,
  listStatuses,
  subscribeApiRetryStatus,
} from "./api";
import { FilterBar } from "./components/FilterBar";
import { RequestDetailModal } from "./components/RequestDetailModal";
import { RequestsTable } from "./components/RequestsTable";
import { triggerCsvDownload } from "./lib/csv";
import { addDays, toApiDate } from "./lib/dates";
import {
  applyChangeItems,
  buildSiteMap,
  buildStaffMap,
  selectBoardRows,
} from "./lib/rules";
import {
  getDefaultFilters,
  parseFiltersFromSearch,
  serializeFiltersToSearch,
} from "./lib/urlState";
import type {
  BoardFilters,
  ChangeItem,
  HelpdeskRequest,
  RequestEvent,
  Site,
  SortField,
  StatusOption,
} from "./types";

const LIVE_POLL_INTERVAL_MS = 20_000;

export default function App() {
  const [filters, setFilters] = useState<BoardFilters>(() =>
    parseFiltersFromSearch(window.location.search),
  );

  const [sites, setSites] = useState<Site[]>([]);
  const [staffById, setStaffById] = useState<Map<number, string>>(new Map());
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [requestsById, setRequestsById] = useState<
    Map<number, HelpdeskRequest>
  >(new Map());
  const [eventsByRequestId, setEventsByRequestId] = useState<
    Map<number, RequestEvent[]>
  >(new Map());

  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [syncingLive, setSyncingLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<RetryNotice | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [nowTick, setNowTick] = useState<Date>(() => new Date());
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState<Set<number>>(
    new Set(),
  );
  const [showDemoTools, setShowDemoTools] = useState(false);

  const changesCursorRef = useRef<string | undefined>(undefined);
  const changesCaughtUpRef = useRef<boolean>(false);

  // Subscribe to API retry notices (429 rate-limit / 503 service unavailable)
  useEffect(() => {
    return subscribeApiRetryStatus((notice) => {
      setRetryNotice(notice);
    });
  }, []);

  // Keep relative "last updated" clock ticking every 5s
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(new Date());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Sync filters state -> URL query string
  useEffect(() => {
    const nextSearch = serializeFiltersToSearch(filters);
    if (window.location.search !== nextSearch) {
      const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
      window.history.replaceState(null, "", nextUrl);
    }
  }, [filters]);

  // Listen to browser Back/Forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setFilters(parseFiltersFromSearch(window.location.search));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const updateFilters = useCallback((patch: Partial<BoardFilters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      if (next.from > next.to) {
        if (patch.from) next.to = patch.from;
        else if (patch.to) next.from = patch.to;
      }
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFilters((prev) => ({
      ...getDefaultFilters(),
      selectedRequestId: prev.selectedRequestId,
    }));
  }, []);

  const handleToggleSort = useCallback((field: SortField) => {
    setFilters((prev) => {
      if (prev.sortField === field) {
        return { ...prev, sortDir: prev.sortDir === "asc" ? "desc" : "asc" };
      }
      return {
        ...prev,
        sortField: field,
        sortDir: field === "created" ? "desc" : "asc",
      };
    });
  }, []);

  // Initial load of reference endpoints (/v1/sites, /v1/staff, /v1/statuses)
  useEffect(() => {
    if (!configured()) return;
    const controller = new AbortController();

    Promise.all([
      listSites({ signal: controller.signal }),
      listStaff({ signal: controller.signal }),
      listStatuses({ signal: controller.signal }),
    ])
      .then(([sitesRes, staffRes, statusesRes]) => {
        setSites(sitesRes.data ?? []);
        setStaffById(buildStaffMap(staffRes.data ?? []));
        setStatusOptions(statusesRes.data ?? []);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : String(err),
        );
      });

    return () => controller.abort();
  }, []);

  // Load all requests for the active [from, to] date range
  const loadRangeRequests = useCallback(
    (fromIso: string, toIso: string, signal?: AbortSignal) => {
      if (!configured()) return Promise.resolve();
      setLoadingInitial(true);
      setError(null);

      return fetchAllRequestsForRange(fromIso, toIso, {
        signal,
        onProgress: (loaded, total, partialMap) => {
          setLoadingProgress({ loaded, total });
          setRequestsById((prev) => {
            const merged = new Map(prev);
            for (const [id, req] of partialMap) {
              merged.set(id, req);
            }
            return merged;
          });
        },
      })
        .then((fullMap) => {
          if (signal?.aborted) return;
          setRequestsById(fullMap);
          setLastUpdatedAt(new Date());
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          setError(
            err instanceof ApiError
              ? `${err.status}: ${err.message}`
              : String(err),
          );
        })
        .finally(() => {
          if (!signal?.aborted) {
            setLoadingInitial(false);
            setLoadingProgress(null);
          }
        });
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadRangeRequests(filters.from, filters.to, controller.signal);
    return () => controller.abort();
  }, [filters.from, filters.to, loadRangeRequests]);

  // Live synchronization (Level 3):
  // Polls /v1/changes with cursor (handling 410 expiration) and refreshes latest staff/requests
  // so any change appears well within 1 minute without reloading the page.
  const performLiveSync = useCallback(
    async (signal?: AbortSignal) => {
      if (!configured()) return;
      setSyncingLive(true);
      try {
        // 1. Poll /v1/changes (up to 3 batches per tick so we respect rate limits)
        let batches = 0;
        const maxBatches = changesCaughtUpRef.current ? 3 : 2;
        const accumulatedChanges: ChangeItem[] = [];

        while (batches < maxBatches) {
          batches++;
          try {
            const changesRes = await listChanges(
              { cursor: changesCursorRef.current, limit: 500 },
              { signal },
            );
            changesCursorRef.current = changesRes.next_cursor;
            if (changesRes.data?.length) {
              accumulatedChanges.push(...changesRes.data);
            }
            if (!changesRes.has_more) {
              changesCaughtUpRef.current = true;
              break;
            }
          } catch (err) {
            if (err instanceof ApiError && err.status === 410) {
              // Rule from docs/api.md: Cursors expire after 15 minutes (410); start again without one.
              changesCursorRef.current = undefined;
              changesCaughtUpRef.current = false;
              break;
            }
            throw err;
          }
        }

        if (accumulatedChanges.length > 0 && changesCaughtUpRef.current) {
          setRequestsById((prevReqs) => {
            const applied = applyChangeItems(
              {
                requestsById: prevReqs,
                staffById,
                eventsByRequestId,
              },
              accumulatedChanges,
            );
            if (applied.staffUpdated) {
              setStaffById(applied.staffById);
            }
            if (applied.changedRequestIds.size > 0) {
              setEventsByRequestId(applied.eventsByRequestId);
              setRecentlyUpdatedIds((prev) => {
                const next = new Set(prev);
                for (const id of applied.changedRequestIds) next.add(id);
                return next;
              });
            }
            return applied.requestsById;
          });
        }

        // 2. Also refresh /v1/staff and the latest page of /v1/requests so live mutations
        // show up immediately even before initial historical /v1/changes catch-up finishes.
        const [freshStaff, latestReqsPage] = await Promise.all([
          listStaff({ signal }),
          listRequests(
            {
              page: 1,
              per_page: 100,
              created_from: toApiDate(addDays(filters.from, -1)),
              created_to: toApiDate(addDays(filters.to, 1)),
            },
            { signal },
          ),
        ]);

        if (signal?.aborted) return;

        setStaffById(buildStaffMap(freshStaff.data ?? []));

        const newlyChangedIds = new Set<number>();
        setRequestsById((prev) => {
          const next = new Map(prev);
          for (const req of latestReqsPage.data ?? []) {
            const old = prev.get(req.id);
            if (
              !old ||
              old.updated_at !== req.updated_at ||
              old.status !== req.status ||
              old.deleted_at !== req.deleted_at ||
              old.merged_into_id !== req.merged_into_id ||
              old.due_on !== req.due_on ||
              old.assignee?.id !== req.assignee?.id
            ) {
              if (prev.size > 0) newlyChangedIds.add(req.id);
            }
            next.set(req.id, req);
          }
          return next;
        });

        if (newlyChangedIds.size > 0) {
          setRecentlyUpdatedIds((prev) => {
            const next = new Set(prev);
            for (const id of newlyChangedIds) next.add(id);
            return next;
          });
        }

        // If a request detail modal is currently open, keep its details & events fresh too
        if (filters.selectedRequestId !== null) {
          const openId = filters.selectedRequestId;
          const [openReq, openEvents] = await Promise.all([
            getRequest(openId, { signal }),
            fetchAllEventsForRequest(openId, { signal }),
          ]);
          if (!signal?.aborted) {
            setRequestsById((prev) => new Map(prev).set(openReq.id, openReq));
            setEventsByRequestId((prev) =>
              new Map(prev).set(openId, openEvents),
            );
          }
        }

        setLastUpdatedAt(new Date());
        setNowTick(new Date());
        setError(null);
      } catch (err) {
        if (signal?.aborted) return;
        // Keep existing board data visible on background sync hiccup
        if (requestsById.size === 0) {
          setError(
            err instanceof ApiError
              ? `${err.status}: ${err.message}`
              : String(err),
          );
        }
      } finally {
        if (!signal?.aborted) {
          setSyncingLive(false);
        }
      }
    },
    [
      eventsByRequestId,
      filters.from,
      filters.selectedRequestId,
      filters.to,
      requestsById.size,
      staffById,
    ],
  );

  useEffect(() => {
    if (!configured()) return;
    const controller = new AbortController();
    const interval = setInterval(() => {
      performLiveSync(controller.signal);
    }, LIVE_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [performLiveSync]);

  const sitesById = useMemo(() => buildSiteMap(sites), [sites]);

  const { rows, totalCountingInRange, overdueInFiltered } = useMemo(
    () =>
      selectBoardRows(
        requestsById,
        sitesById,
        staffById,
        filters,
        nowTick,
      ),
    [requestsById, sitesById, staffById, filters, nowTick],
  );

  const handleCacheEvents = useCallback(
    (reqId: number, evs: RequestEvent[]) => {
      setEventsByRequestId((prev) => new Map(prev).set(reqId, evs));
    },
    [],
  );

  const handleCacheRequest = useCallback((req: HelpdeskRequest) => {
    setRequestsById((prev) => new Map(prev).set(req.id, req));
  }, []);

  if (!configured()) {
    return (
      <main className="app-shell">
        <div className="alert-error" role="alert">
          Save <code>HELPDESK_URL</code> and <code>HELPDESK_TOKEN</code> in{" "}
          <code>.env</code>, then restart <code>npm run dev</code>.
        </div>
      </main>
    );
  }

  const secondsSinceUpdate = lastUpdatedAt
    ? Math.max(0, Math.floor((nowTick.getTime() - lastUpdatedAt.getTime()) / 1000))
    : null;

  return (
    <div className="app-shell">
      <a href="#board-main" className="skip-link">
        Skip to requests board
      </a>

      <header className="top-header">
        <div className="brand-block">
          <div className="brand-eyebrow">Robusttechhouse Properties</div>
          <h1>Helpdesk Requests Board</h1>
          <p className="muted header-sub">
            Singapore (Asia/Singapore) · Sydney (Australia/Sydney) · Jakarta
            (Asia/Jakarta) — All dates &amp; times in each site&apos;s local
            timezone
          </p>
        </div>

        <div className="live-status-panel" aria-live="polite">
          <div className="live-indicator">
            <span
              className={`live-dot ${syncingLive || loadingInitial ? "pulsing" : "online"}`}
              aria-hidden="true"
            />
            <span>
              {loadingInitial
                ? loadingProgress
                  ? `Loading pages (${loadingProgress.loaded}/${loadingProgress.total})…`
                  : "Loading requests…"
                : syncingLive
                  ? "Syncing live changes…"
                  : lastUpdatedAt
                    ? `Last updated: ${lastUpdatedAt.toLocaleTimeString()} (${secondsSinceUpdate}s ago)`
                    : "Waiting for first sync…"}
            </span>
          </div>

          <div className="live-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={loadingInitial || syncingLive}
              onClick={() => performLiveSync()}
            >
              {syncingLive ? "Syncing…" : "↻ Update now"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowDemoTools((v) => !v)}
              aria-expanded={showDemoTools}
            >
              {showDemoTools ? "Hide resilience demo" : "Resilience & QA tools"}
            </button>
          </div>
        </div>
      </header>

      {showDemoTools && (
        <aside
          className="demo-toolbar"
          aria-label="Resilience and edge-case verification tools"
        >
          <div className="demo-toolbar-group">
            <strong>Test UI States (Level 4):</strong>
            <button
              type="button"
              className="btn-chip"
              onClick={() =>
                setRetryNotice({
                  status: 429,
                  message: "Helpdesk API is busy (rate-limited)",
                  retryAfterSeconds: 3,
                  attempt: 1,
                })
              }
            >
              Simulate 429 Busy
            </button>
            <button
              type="button"
              className="btn-chip"
              onClick={() =>
                setRetryNotice({
                  status: 503,
                  message: "Helpdesk API is briefly unavailable",
                  retryAfterSeconds: 2,
                  attempt: 1,
                })
              }
            >
              Simulate 503 Down
            </button>
            <button
              type="button"
              className="btn-chip"
              onClick={() =>
                setError("503: Simulated fatal outage — click Retry to recover")
              }
            >
              Simulate Error Alert
            </button>
            <button
              type="button"
              className="btn-chip"
              onClick={() => {
                setRetryNotice(null);
                setError(null);
              }}
            >
              Clear Alerts
            </button>
          </div>

          <div className="demo-toolbar-group">
            <strong>Inspect Rule Edge Cases:</strong>
            <button
              type="button"
              className="btn-chip"
              onClick={() => updateFilters({ selectedRequestId: 64893 })}
            >
              Open WO-64893 (Undone event — Rule 5)
            </button>
            <button
              type="button"
              className="btn-chip"
              onClick={() => updateFilters({ selectedRequestId: 65122 })}
            >
              Open WO-65122 (System processing — Rule 6)
            </button>
            <button
              type="button"
              className="btn-chip"
              onClick={() => updateFilters({ selectedRequestId: 41214 })}
            >
              Open WO-41214 (Reverted processing before real First Response)
            </button>
          </div>
        </aside>
      )}

      {retryNotice && (
        <div className="alert-busy" role="status" aria-live="polite">
          <div>
            <strong>
              {retryNotice.status === 429
                ? "Helpdesk is busy (HTTP 429)"
                : `Helpdesk briefly unavailable (HTTP ${retryNotice.status || "Network"})`}
              :
            </strong>{" "}
            {retryNotice.message}. Automatically retrying in{" "}
            {retryNotice.retryAfterSeconds}s (attempt {retryNotice.attempt})…
            Existing board data remains visible.
          </div>
          <button
            type="button"
            className="btn-chip"
            onClick={() => setRetryNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="alert-error" role="alert">
          <div>
            <strong>Could not load requests:</strong> {error}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setError(null);
              loadRangeRequests(filters.from, filters.to);
            }}
          >
            Retry now
          </button>
        </div>
      )}

      <main id="board-main">
        <FilterBar
          filters={filters}
          sites={sites}
          statusOptions={statusOptions}
          overdueCount={overdueInFiltered}
          totalMatching={rows.length}
          totalCountingInRange={totalCountingInRange}
          onUpdateFilters={updateFilters}
          onResetFilters={resetFilters}
          onDownloadCsv={() =>
            triggerCsvDownload(rows, filters.from, filters.to)
          }
        />

        {loadingInitial && requestsById.size === 0 ? (
          <div className="loading-state" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <h2>Loading helpdesk requests…</h2>
            <p className="muted">
              Fetching requests across Singapore, Sydney, and Jakarta for{" "}
              {filters.from} to {filters.to}…
            </p>
          </div>
        ) : (
          <RequestsTable
            rows={rows}
            statusOptions={statusOptions}
            sortField={filters.sortField}
            sortDir={filters.sortDir}
            selectedRequestId={filters.selectedRequestId}
            recentlyUpdatedIds={recentlyUpdatedIds}
            onToggleSort={handleToggleSort}
            onSelectRequest={(id) =>
              updateFilters({ selectedRequestId: id })
            }
            onResetFilters={resetFilters}
          />
        )}
      </main>

      {filters.selectedRequestId !== null && (
        <RequestDetailModal
          requestId={filters.selectedRequestId}
          cachedRequest={requestsById.get(filters.selectedRequestId)}
          cachedEvents={eventsByRequestId.get(filters.selectedRequestId)}
          sitesById={sitesById}
          staffById={staffById}
          statusOptions={statusOptions}
          onCacheEvents={handleCacheEvents}
          onCacheRequest={handleCacheRequest}
          onClose={() => updateFilters({ selectedRequestId: null })}
        />
      )}
    </div>
  );
}
