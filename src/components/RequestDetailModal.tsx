import { useEffect, useId, useRef, useState } from "react";
import { ApiError, fetchAllEventsForRequest, getRequest } from "../api";
import {
  formatLocalDate,
  formatUnixInSiteZone,
  formatUtcInSiteZone,
  formatWallClockInSiteZone,
  localDate,
} from "../lib/dates";
import {
  analyzeEvents,
  findFirstResponse,
  isRequestOverdue,
  resolveActorName,
  resolveAssigneeName,
} from "../lib/rules";
import type {
  HelpdeskRequest,
  RequestEvent,
  Site,
  Status,
  StatusOption,
} from "../types";

interface RequestDetailModalProps {
  requestId: number;
  cachedRequest?: HelpdeskRequest;
  cachedEvents?: RequestEvent[];
  sitesById: ReadonlyMap<number, Site>;
  staffById: ReadonlyMap<number, string>;
  statusOptions: StatusOption[];
  onCacheEvents: (requestId: number, events: RequestEvent[]) => void;
  onCacheRequest: (request: HelpdeskRequest) => void;
  onClose: () => void;
}

const STATUS_LABELS_FALLBACK: Record<Status, string> = {
  pending: "Pending",
  processing: "Processing",
  complete: "Complete",
  canceled: "Cancelled",
};

/**
 * Resolves `event.assignee_name` (which does not carry an id in the API) against
 * the request's current assignee id or any hyphenated/updated name in `/v1/staff`.
 */
function resolveEventAssigneeDisplay(
  rawAssigneeName: string,
  request: HelpdeskRequest,
  staffById: ReadonlyMap<number, string>,
): string {
  if (request.assignee) {
    const currentFromId = staffById.get(request.assignee.id);
    if (
      currentFromId &&
      (request.assignee.name === rawAssigneeName ||
        currentFromId.startsWith(`${rawAssigneeName}-`))
    ) {
      return currentFromId;
    }
  }
  for (const currentName of staffById.values()) {
    if (currentName === rawAssigneeName) return currentName;
    if (currentName.startsWith(`${rawAssigneeName}-`)) return currentName;
  }
  return rawAssigneeName;
}

export function RequestDetailModal({
  requestId,
  cachedRequest,
  cachedEvents,
  sitesById,
  staffById,
  statusOptions,
  onCacheEvents,
  onCacheRequest,
  onClose,
}: RequestDetailModalProps) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [request, setRequest] = useState<HelpdeskRequest | null>(
    cachedRequest ?? null,
  );
  const [events, setEvents] = useState<RequestEvent[]>(cachedEvents ?? []);
  const [loadingReq, setLoadingReq] = useState(!cachedRequest);
  const [loadingEvents, setLoadingEvents] = useState(!cachedEvents);
  const [error, setError] = useState<string | null>(null);
  const [showUndone, setShowUndone] = useState(false);
  const [chronological, setChronological] = useState(false);

  // Sync when parent live-updates cachedRequest or cachedEvents
  useEffect(() => {
    if (cachedRequest) setRequest(cachedRequest);
  }, [cachedRequest]);

  useEffect(() => {
    if (cachedEvents) setEvents(cachedEvents);
  }, [cachedEvents]);

  // Focus management and Escape key handling
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const loadDetailsAndEvents = (force = false) => {
    const controller = new AbortController();
    setError(null);

    if (!cachedRequest || force) {
      setLoadingReq(true);
      getRequest(requestId, { signal: controller.signal })
        .then((reqData) => {
          setRequest(reqData);
          onCacheRequest(reqData);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(
            err instanceof ApiError
              ? `${err.status}: ${err.message}`
              : String(err),
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingReq(false);
        });
    }

    setLoadingEvents(true);
    fetchAllEventsForRequest(requestId, { signal: controller.signal })
      .then((evList) => {
        setEvents(evList);
        onCacheEvents(requestId, evList);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : String(err),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingEvents(false);
      });

    return () => controller.abort();
  };

  useEffect(() => {
    setShowUndone(false);
    return loadDetailsAndEvents(false);
  }, [requestId]);

  const statusLabelMap = new Map<Status, string>(
    statusOptions.map((s) => [s.value, s.label]),
  );
  const getStatusLabel = (st: Status) =>
    statusLabelMap.get(st) ?? STATUS_LABELS_FALLBACK[st] ?? st;

  const site = request ? sitesById.get(request.site_id) : undefined;
  const siteTimezone = site?.timezone ?? "UTC";
  const siteName =
    site?.name ?? (request ? `Site #${request.site_id}` : "Loading site…");

  const overdue = request ? isRequestOverdue(request, siteTimezone) : false;
  const assigneeName = request
    ? resolveAssigneeName(request.assignee, staffById)
    : null;
  const siteToday = localDate(new Date(), siteTimezone);

  const { visibleEvents, undoneEvents, allAnnotated } = analyzeEvents(events);
  const firstResponse = findFirstResponse(events, staffById, siteTimezone);

  const displayedTimeline = showUndone
    ? allAnnotated
    : allAnnotated.filter((item) => !item.isUndone);

  const orderedTimeline = chronological
    ? [...displayedTimeline].reverse()
    : displayedTimeline;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <div>
            <div className="modal-badges-row">
              <span className="ref-code-lg">
                {request ? request.ref : `Request #${requestId}`}
              </span>
              {request && (
                <span className={`badge status-${request.status}`}>
                  {getStatusLabel(request.status)}
                </span>
              )}
              {request?.priority && (
                <span
                  className={`badge priority-${request.priority.toLowerCase()}`}
                >
                  {request.priority} Priority
                </span>
              )}
              {overdue && (
                <span className="badge badge-overdue">Overdue</span>
              )}
            </div>
            <h2 id={titleId} className="modal-title">
              {request ? request.title : "Loading request details…"}
            </h2>
          </div>

          <div className="modal-header-actions">
            <button
              type="button"
              className="btn-chip"
              onClick={() => loadDetailsAndEvents(true)}
              disabled={loadingEvents || loadingReq}
              title="Refresh this request and its events"
            >
              {loadingEvents || loadingReq ? "Refreshing…" : "↻ Refresh"}
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close request details"
            >
              ✕ Close
            </button>
          </div>
        </header>

        <div className="modal-body">
          {error && (
            <div className="alert-error" role="alert">
              <span>Could not load full request data: {error}</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => loadDetailsAndEvents(true)}
              >
                Retry
              </button>
            </div>
          )}

          {request &&
            (request.status === "canceled" ||
              request.deleted_at !== null ||
              request.merged_into_id !== null) && (
              <div className="alert-warning" role="status">
                <strong>Excluded from active board (Rule 1):</strong>{" "}
                {request.deleted_at
                  ? `Deleted at ${formatUtcInSiteZone(request.deleted_at, siteTimezone)}.`
                  : request.merged_into_id
                    ? `Merged as duplicate into request #${request.merged_into_id}.`
                    : "Status is Cancelled."}
              </div>
            )}

          {loadingReq && !request ? (
            <p className="loading-box" role="status">
              Loading request #{requestId}…
            </p>
          ) : (
            request && (
              <>
                <section
                  className="detail-grid"
                  aria-label="Request metadata in site local time"
                >
                  <div className="detail-card">
                    <span className="detail-label">Site &amp; Timezone</span>
                    <strong className="detail-value">{siteName}</strong>
                    <span className="detail-sub">
                      Zone: <code>{siteTimezone}</code> · Site today:{" "}
                      <code>{siteToday}</code>
                    </span>
                  </div>

                  <div className="detail-card">
                    <span className="detail-label">Location</span>
                    <strong className="detail-value">{request.location}</strong>
                  </div>

                  <div className="detail-card">
                    <span className="detail-label">
                      Current Assignee (from /v1/staff)
                    </span>
                    <strong className="detail-value">
                      {assigneeName ?? "Unassigned"}
                    </strong>
                  </div>

                  <div className="detail-card">
                    <span className="detail-label">Due Date (Site Local)</span>
                    <strong className="detail-value">
                      {request.due_on
                        ? formatLocalDate(request.due_on, siteTimezone)
                        : "None (Never overdue)"}
                    </strong>
                    {overdue && (
                      <span className="overdue-inline-count">
                        Overdue (before {siteToday} in {siteTimezone})
                      </span>
                    )}
                  </div>

                  <div className="detail-card">
                    <span className="detail-label">Created At (Site Local)</span>
                    <strong className="detail-value">
                      {formatUtcInSiteZone(request.created_at, siteTimezone)}
                    </strong>
                  </div>

                  <div className="detail-card">
                    <span className="detail-label">Updated At (Site Local)</span>
                    <strong className="detail-value">
                      {formatUtcInSiteZone(request.updated_at, siteTimezone)}
                    </strong>
                  </div>
                </section>

                <section
                  className={`first-response-box ${firstResponse ? "has-response" : "no-response"}`}
                  aria-label="First response summary"
                >
                  <div className="first-response-header">
                    <span className="first-response-title">
                      First Response (Rule 6)
                    </span>
                    <span className="first-response-rule-hint">
                      Earliest non-undone <code>processing</code> event by a
                      staff member
                    </span>
                  </div>
                  {loadingEvents && events.length === 0 ? (
                    <p className="muted">Checking event history…</p>
                  ) : firstResponse ? (
                    <div className="first-response-content">
                      <div>
                        <span className="detail-label">Responded by:</span>{" "}
                        <strong>{firstResponse.actorName}</strong>
                      </div>
                      <div>
                        <span className="detail-label">Time (Site Local):</span>{" "}
                        <strong>{firstResponse.formattedTime}</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="muted">
                      No staff first response recorded yet (only pending events
                      or automated System events so far).
                    </p>
                  )}
                </section>
              </>
            )
          )}

          <section
            className="timeline-section"
            aria-label="Request events history"
          >
            <div className="timeline-header">
              <div>
                <h3>
                  Event History ({visibleEvents.length} active
                  {undoneEvents.length > 0
                    ? `, ${undoneEvents.length} undone`
                    : ""}
                  )
                </h3>
                <p className="muted timeline-subtitle">
                  All event timestamps and deadlines are shown in{" "}
                  <strong>{siteTimezone}</strong> local time.
                </p>
              </div>

              <div className="timeline-controls">
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => setChronological((prev) => !prev)}
                >
                  {chronological ? "Oldest first ↑" : "Newest first ↓"}
                </button>

                {undoneEvents.length > 0 && (
                  <button
                    type="button"
                    className={`btn-chip ${showUndone ? "active" : ""}`}
                    onClick={() => setShowUndone((prev) => !prev)}
                  >
                    {showUndone
                      ? `Hide ${undoneEvents.length} undone events`
                      : `Show ${undoneEvents.length} undone events (Rule 5)`}
                  </button>
                )}
              </div>
            </div>

            {loadingEvents && events.length === 0 ? (
              <p className="loading-box" role="status">
                Loading event history…
              </p>
            ) : orderedTimeline.length === 0 ? (
              <p className="muted">No visible events for this request.</p>
            ) : (
              <ol className="timeline-list">
                {orderedTimeline.map(({ event: ev, isUndone, revertedByEventId }) => {
                  const actorDisplay = resolveActorName(ev.actor_id, staffById);
                  const isFirstResp = firstResponse?.event.id === ev.id;
                  const eventTimeDisplay = formatUnixInSiteZone(
                    ev.at,
                    siteTimezone,
                  );
                  const dueAtDisplay = ev.due_at
                    ? formatWallClockInSiteZone(ev.due_at, siteTimezone)
                    : null;
                  const assignedDisplay =
                    ev.assignee_name && request
                      ? resolveEventAssigneeDisplay(
                          ev.assignee_name,
                          request,
                          staffById,
                        )
                      : ev.assignee_name;

                  return (
                    <li
                      key={ev.id}
                      className={[
                        "timeline-item",
                        isFirstResp ? "timeline-first-response" : "",
                        isUndone ? "timeline-undone" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="timeline-item-top">
                        <div className="timeline-actor-group">
                          <strong className="timeline-actor">
                            {actorDisplay}
                          </strong>
                          {ev.actor_id === null && (
                            <span className="badge badge-system">Automated</span>
                          )}
                          <span className={`badge status-${ev.status}`}>
                            {getStatusLabel(ev.status)}
                          </span>
                          {isFirstResp && (
                            <span className="badge badge-first-response">
                              ★ First Response
                            </span>
                          )}
                          {isUndone && (
                            <span className="badge badge-undone">
                              {ev.reverts_id !== null
                                ? `Reverts event #${ev.reverts_id}`
                                : `Undone by event #${revertedByEventId}`}
                            </span>
                          )}
                        </div>
                        <time className="timeline-time">
                          {eventTimeDisplay}
                        </time>
                      </div>

                      <div className="timeline-details">
                        {assignedDisplay && (
                          <div className="timeline-meta-line">
                            <span className="detail-label">Assigned to:</span>{" "}
                            <strong>{assignedDisplay}</strong>
                          </div>
                        )}
                        {dueAtDisplay && (
                          <div className="timeline-meta-line">
                            <span className="detail-label">
                              Deadline set (site local):
                            </span>{" "}
                            <strong>{dueAtDisplay}</strong>
                          </div>
                        )}
                        {ev.note && (
                          <p className="timeline-note">&ldquo;{ev.note}&rdquo;</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
