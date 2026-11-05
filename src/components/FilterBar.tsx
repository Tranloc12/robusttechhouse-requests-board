import { useState } from "react";
import { daysAgo } from "../lib/dates";
import type { BoardFilters, Site, SortDir, SortField, Status, StatusOption } from "../types";

interface FilterBarProps {
  filters: BoardFilters;
  sites: Site[];
  statusOptions: StatusOption[];
  overdueCount: number;
  totalMatching: number;
  totalCountingInRange: number;
  onUpdateFilters: (patch: Partial<BoardFilters>) => void;
  onResetFilters: () => void;
  onDownloadCsv: () => void;
}

export function FilterBar({
  filters,
  sites,
  statusOptions,
  overdueCount,
  totalMatching,
  totalCountingInRange,
  onUpdateFilters,
  onResetFilters,
  onDownloadCsv,
}: FilterBarProps) {
  const [copied, setCopied] = useState(false);

  // Rule 1: Skip requests with status `canceled`
  const countingStatuses = statusOptions.filter((s) => s.value !== "canceled");

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for environments without clipboard API permission
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const applyPresetDays = (days: number) => {
    onUpdateFilters({
      from: daysAgo(days),
      to: daysAgo(0),
    });
  };

  return (
    <section className="filter-panel" aria-label="Filter and sort requests">
      <div className="filter-grid">
        <div className="filter-field">
          <label htmlFor="filter-from">From (site local date)</label>
          <input
            id="filter-from"
            type="date"
            value={filters.from}
            max={filters.to}
            onChange={(e) => {
              if (e.target.value) onUpdateFilters({ from: e.target.value });
            }}
          />
        </div>

        <div className="filter-field">
          <label htmlFor="filter-to">To (site local date)</label>
          <input
            id="filter-to"
            type="date"
            value={filters.to}
            min={filters.from}
            onChange={(e) => {
              if (e.target.value) onUpdateFilters({ to: e.target.value });
            }}
          />
        </div>

        <div className="filter-field">
          <label htmlFor="filter-site">Site</label>
          <select
            id="filter-site"
            value={filters.siteId === "all" ? "all" : String(filters.siteId)}
            onChange={(e) => {
              const val = e.target.value;
              onUpdateFilters({
                siteId: val === "all" ? "all" : Number(val),
              });
            }}
          >
            <option value="all">All sites ({sites.length || 3})</option>
            {sites.map((site) => (
              <option key={site.id} value={String(site.id)}>
                {site.name} ({site.timezone})
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="filter-status">Status</label>
          <select
            id="filter-status"
            value={filters.status}
            onChange={(e) =>
              onUpdateFilters({ status: e.target.value as Status | "all" })
            }
          >
            <option value="all">All active statuses</option>
            {(countingStatuses.length > 0
              ? countingStatuses
              : [
                  { value: "pending", label: "Pending" },
                  { value: "processing", label: "Processing" },
                  { value: "complete", label: "Complete" },
                ]
            ).map((st) => (
              <option key={st.value} value={st.value}>
                {st.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field filter-field-sort">
          <label htmlFor="filter-sort">Sort by</label>
          <div className="sort-inline">
            <select
              id="filter-sort"
              value={filters.sortField}
              onChange={(e) =>
                onUpdateFilters({ sortField: e.target.value as SortField })
              }
            >
              <option value="created">Created date</option>
              <option value="due">Due date</option>
            </select>
            <select
              id="filter-sort-dir"
              aria-label="Sort direction"
              value={filters.sortDir}
              onChange={(e) =>
                onUpdateFilters({ sortDir: e.target.value as SortDir })
              }
            >
              <option value="desc">
                {filters.sortField === "created" ? "Newest first" : "Latest due first"}
              </option>
              <option value="asc">
                {filters.sortField === "created" ? "Oldest first" : "Earliest due first"}
              </option>
            </select>
          </div>
        </div>

        <div className="filter-field">
          <label htmlFor="filter-search">Search</label>
          <input
            id="filter-search"
            type="search"
            placeholder="Ref, title, location, assignee…"
            value={filters.search}
            onChange={(e) => onUpdateFilters({ search: e.target.value })}
          />
        </div>
      </div>

      <div className="filter-actions-row">
        <div className="filter-chips">
          <button
            type="button"
            className="btn-chip"
            onClick={() => applyPresetDays(7)}
          >
            Last 7 days
          </button>
          <button
            type="button"
            className="btn-chip"
            onClick={() => applyPresetDays(30)}
          >
            Last 30 days
          </button>
          <label className="overdue-toggle">
            <input
              type="checkbox"
              checked={filters.overdueOnly}
              onChange={(e) =>
                onUpdateFilters({ overdueOnly: e.target.checked })
              }
            />
            <span>
              Overdue only ({overdueCount})
            </span>
          </label>
        </div>

        <div className="filter-summary-actions">
          <span className="results-summary" aria-live="polite">
            Showing <strong>{totalMatching}</strong> of{" "}
            <strong>{totalCountingInRange}</strong> counting requests
            {overdueCount > 0 && (
              <>
                {" "}
                · <span className="overdue-inline-count">{overdueCount} overdue</span>
              </>
            )}
          </span>

          <button
            type="button"
            className="btn-primary"
            onClick={onDownloadCsv}
            disabled={totalMatching === 0}
            title={`Download all ${totalMatching} matching requests as requests-${filters.from}-${filters.to}.csv`}
          >
            ⬇ Download CSV ({totalMatching})
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleCopyLink}
            title="Copy shareable link with range, filters, and sort"
          >
            {copied ? "✓ Link copied!" : "Copy shareable link"}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={onResetFilters}
          >
            Reset filters
          </button>
        </div>
      </div>
    </section>
  );
}
