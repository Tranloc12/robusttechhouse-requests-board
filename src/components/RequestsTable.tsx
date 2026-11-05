import { useEffect, useState } from "react";
import { formatUtcInSiteZone } from "../lib/dates";
import type { EnrichedBoardRow } from "../lib/rules";
import type { SortDir, SortField, Status, StatusOption } from "../types";

interface RequestsTableProps {
  rows: EnrichedBoardRow[];
  statusOptions: StatusOption[];
  sortField: SortField;
  sortDir: SortDir;
  selectedRequestId: number | null;
  recentlyUpdatedIds: ReadonlySet<number>;
  onToggleSort: (field: SortField) => void;
  onSelectRequest: (id: number) => void;
  onResetFilters: () => void;
}

const STATUS_LABELS_FALLBACK: Record<Status, string> = {
  pending: "Pending",
  processing: "Processing",
  complete: "Complete",
  canceled: "Cancelled",
};

export function RequestsTable({
  rows,
  statusOptions,
  sortField,
  sortDir,
  selectedRequestId,
  recentlyUpdatedIds,
  onToggleSort,
  onSelectRequest,
  onResetFilters,
}: RequestsTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);

  // Reset to page 1 when filtered row set changes significantly
  useEffect(() => {
    setPage(1);
  }, [rows.length, sortField, sortDir]);

  const statusLabelMap = new Map<Status, string>(
    statusOptions.map((s) => [s.value, s.label]),
  );

  const getStatusLabel = (st: Status) =>
    statusLabelMap.get(st) ?? STATUS_LABELS_FALLBACK[st] ?? st;

  if (rows.length === 0) {
    return (
      <div className="empty-state" role="status" aria-live="polite">
        <h2>No requests match these filters</h2>
        <p className="muted">
          Try widening the date range, clearing the search box, or resetting the
          site and status filters.
        </p>
        <button type="button" className="btn-primary" onClick={onResetFilters}>
          Reset filters to default (last 30 days)
        </button>
      </div>
    );
  }

  const totalPages =
    pageSize === 0 ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows =
    pageSize === 0
      ? rows
      : rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const createdAriaSort =
    sortField === "created"
      ? sortDir === "asc"
        ? "ascending"
        : "descending"
      : "none";

  const dueAriaSort =
    sortField === "due"
      ? sortDir === "asc"
        ? "ascending"
        : "descending"
      : "none";

  return (
    <div className="table-section">
      <div className="table-wrapper">
        <table className="requests-table">
          <caption className="sr-only">
            Helpdesk requests board. Click or press Enter on any row to view full
            request details and event history in the site&apos;s local timezone.
          </caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Ref</th>
              <th scope="col">Title &amp; Location</th>
              <th scope="col">Priority</th>
              <th scope="col">Status</th>
              <th scope="col">Assignee</th>
              <th scope="col" aria-sort={createdAriaSort}>
                <button
                  type="button"
                  className={`th-sort-btn ${sortField === "created" ? "active" : ""}`}
                  onClick={() => onToggleSort("created")}
                >
                  Created (Site Local){" "}
                  <span aria-hidden="true">
                    {sortField === "created"
                      ? sortDir === "asc"
                        ? "↑"
                        : "↓"
                      : "↕"}
                  </span>
                </button>
              </th>
              <th scope="col" aria-sort={dueAriaSort}>
                <button
                  type="button"
                  className={`th-sort-btn ${sortField === "due" ? "active" : ""}`}
                  onClick={() => onToggleSort("due")}
                >
                  Due Date{" "}
                  <span aria-hidden="true">
                    {sortField === "due"
                      ? sortDir === "asc"
                        ? "↑"
                        : "↓"
                      : "↕"}
                  </span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const { request: r } = row;
              const isSelected = selectedRequestId === r.id;
              const isRecentlyUpdated = recentlyUpdatedIds.has(r.id);
              const statusLabel = getStatusLabel(r.status);
              const priorityLabel = r.priority ?? "—";
              const assigneeDisplay = row.assigneeName ?? "Unassigned";
              const createdDisplay = formatUtcInSiteZone(
                r.created_at,
                row.siteTimezone,
              );
              const dueDisplay = r.due_on ?? "—";

              return (
                <tr
                  key={r.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`${r.ref}: ${r.title}, Site ${row.siteName}, Status ${statusLabel}, Priority ${priorityLabel}, Assignee ${assigneeDisplay}, Due ${dueDisplay}${row.isOverdue ? ", Overdue" : ""}`}
                  aria-selected={isSelected}
                  className={[
                    "request-row",
                    row.isOverdue ? "row-overdue" : "",
                    isSelected ? "row-selected" : "",
                    isRecentlyUpdated ? "row-live-updated" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onSelectRequest(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectRequest(r.id);
                    }
                  }}
                >
                  <td data-label="Site">
                    <div className="cell-site-name">{row.siteName}</div>
                    <div className="cell-tz">{row.siteTimezone}</div>
                  </td>
                  <td data-label="Ref" className="cell-ref">
                    <span className="ref-code">{r.ref}</span>
                    {isRecentlyUpdated && (
                      <span className="badge badge-live" title="Updated live">
                        Live
                      </span>
                    )}
                  </td>
                  <td data-label="Title">
                    <div className="cell-title">{r.title}</div>
                    <div className="cell-location">{r.location}</div>
                  </td>
                  <td data-label="Priority">
                    {r.priority ? (
                      <span
                        className={`badge priority-${r.priority.toLowerCase()}`}
                      >
                        {r.priority}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td data-label="Status">
                    <span className={`badge status-${r.status}`}>
                      {statusLabel}
                    </span>
                  </td>
                  <td data-label="Assignee">
                    {row.assigneeName ? (
                      <span>{row.assigneeName}</span>
                    ) : (
                      <span className="muted">Unassigned</span>
                    )}
                  </td>
                  <td data-label="Created" className="cell-datetime">
                    {createdDisplay}
                  </td>
                  <td data-label="Due Date" className="cell-due">
                    <div className="due-wrapper">
                      <span>{dueDisplay}</span>
                      {row.isOverdue && (
                        <span
                          className="badge badge-overdue"
                          aria-label="Overdue"
                        >
                          Overdue
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav
        className="pagination-bar"
        aria-label="Board table pagination"
      >
        <div className="pagination-info">
          Showing{" "}
          <strong>
            {pageSize === 0
              ? `all ${rows.length}`
              : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, rows.length)} of ${rows.length}`}
          </strong>{" "}
          requests
        </div>
        <div className="pagination-controls">
          <label htmlFor="page-size-select" className="page-size-label">
            Rows per view:
          </label>
          <select
            id="page-size-select"
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="250">250</option>
            <option value="0">All ({rows.length})</option>
          </select>

          {pageSize !== 0 && totalPages > 1 && (
            <>
              <button
                type="button"
                className="btn-chip"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span className="page-indicator">
                Page {safePage} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-chip"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </>
          )}
        </div>
      </nav>
    </div>
  );
}
