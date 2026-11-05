// A resilient client for the helpdesk API. Extend it; don't scatter fetch calls through components.

import { addDays, toApiDate } from "./lib/dates";
import { deduplicateRequests } from "./lib/rules";
import type {
  ChangesResponse,
  HelpdeskRequest,
  Holiday,
  Page,
  RequestEvent,
  Site,
  Staff,
  StatusOption,
} from "./types";

const BASE = (import.meta.env.HELPDESK_URL ?? "").replace(/\/$/, "");
const TOKEN = import.meta.env.HELPDESK_TOKEN ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RetryNotice {
  status: number;
  message: string;
  retryAfterSeconds: number;
  attempt: number;
}

type RetryListener = (notice: RetryNotice | null) => void;
const retryListeners = new Set<RetryListener>();

export function subscribeApiRetryStatus(listener: RetryListener): () => void {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

function notifyRetry(notice: RetryNotice | null) {
  for (const listener of retryListeners) {
    listener(notice);
  }
}

export function configured(): boolean {
  return Boolean(BASE && TOKEN);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export interface RequestOptions {
  signal?: AbortSignal;
  maxRetries?: number;
}

export async function get<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  options: RequestOptions = {},
): Promise<T> {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const maxRetries = options.maxRetries ?? 4;
  let attempt = 0;

  while (true) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        signal: options.signal,
      });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      if (attempt < maxRetries) {
        attempt++;
        const waitSec = Math.min(2 ** attempt, 8);
        notifyRetry({
          status: 0,
          message: "Network hiccup reaching helpdesk",
          retryAfterSeconds: waitSec,
          attempt,
        });
        await sleep(waitSec * 1000, options.signal);
        continue;
      }
      notifyRetry(null);
      throw err;
    }

    if (response.ok) {
      if (attempt > 0) notifyRetry(null);
      return (await response.json()) as T;
    }

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;

    const isRateLimited = response.status === 429;
    const isTransientServerError =
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504;

    if ((isRateLimited || isTransientServerError) && attempt < maxRetries) {
      attempt++;
      const waitSec =
        retryAfterSeconds && retryAfterSeconds > 0
          ? retryAfterSeconds
          : Math.min(attempt * 1.5, 6);
      notifyRetry({
        status: response.status,
        message: isRateLimited
          ? "Helpdesk API is busy (rate-limited)"
          : "Helpdesk API is briefly unavailable",
        retryAfterSeconds: Math.ceil(waitSec),
        attempt,
      });
      await sleep(waitSec * 1000 + 150, options.signal);
      continue;
    }

    notifyRetry(null);
    throw new ApiError(
      response.status,
      body.error ?? response.statusText,
      retryAfterSeconds,
    );
  }
}

export const listRequests = (
  params: {
    page?: number;
    per_page?: number;
    created_from?: string;
    created_to?: string;
    status?: string;
  },
  options?: RequestOptions,
) => get<Page<HelpdeskRequest>>("/v1/requests", params, options);

export const getRequest = (id: number, options?: RequestOptions) =>
  get<HelpdeskRequest>(`/v1/requests/${id}`, {}, options);

export const listEvents = (id: number, page = 1, options?: RequestOptions) =>
  get<Page<RequestEvent>>(`/v1/requests/${id}/events`, { page }, options);

export const listSites = (options?: RequestOptions) =>
  get<{ data: Site[] }>("/v1/sites", {}, options);

export const listHolidays = (siteId: number, options?: RequestOptions) =>
  get<{ data: Holiday[] }>(`/v1/sites/${siteId}/holidays`, {}, options);

export const listStaff = (options?: RequestOptions) =>
  get<{ data: Staff[] }>("/v1/staff", {}, options);

export const listStatuses = (options?: RequestOptions) =>
  get<{ data: StatusOption[] }>("/v1/statuses", {}, options);

export const listChanges = (
  params: { cursor?: string; limit?: number } = {},
  options?: RequestOptions,
) => get<ChangesResponse>("/v1/changes", params, options);

const COUNTING_STATUS_FILTER = JSON.stringify([
  "pending",
  "processing",
  "complete",
]);

/**
 * Fetches all pages of requests for a site-local date range `[fromIso, toIso]`.
 * Queries the API with a ±1 day buffer (`fromIso - 1` to `toIso + 1`) because the
 * server's `created_from` / `created_to` filters operate on UTC dates while Rule 1
 * evaluates `created_at` in each site's local timezone.
 * Also deduplicates across pages to handle the API's boundary item overlap.
 */
export async function fetchAllRequestsForRange(
  fromIso: string,
  toIso: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (
      loadedPages: number,
      totalPages: number,
      partialMap: Map<number, HelpdeskRequest>,
    ) => void;
  } = {},
): Promise<Map<number, HelpdeskRequest>> {
  const bufferedFrom = toApiDate(addDays(fromIso, -1));
  const bufferedTo = toApiDate(addDays(toIso, 1));

  const firstPage = await listRequests(
    {
      page: 1,
      per_page: 100,
      created_from: bufferedFrom,
      created_to: bufferedTo,
      status: COUNTING_STATUS_FILTER,
    },
    { signal: options.signal },
  );

  const totalPages = Math.max(1, firstPage.total_pages ?? 1);
  const requestsMap = deduplicateRequests(firstPage.data ?? []);
  let loadedPages = 1;
  options.onProgress?.(loadedPages, totalPages, new Map(requestsMap));

  if (totalPages <= 1) {
    return requestsMap;
  }

  const remainingPages: number[] = [];
  for (let p = 2; p <= totalPages; p++) {
    remainingPages.push(p);
  }

  const concurrency = 3;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < remainingPages.length) {
      if (options.signal?.aborted) return;
      const pageNum = remainingPages[nextIdx++];
      const pageData = await listRequests(
        {
          page: pageNum,
          per_page: 100,
          created_from: bufferedFrom,
          created_to: bufferedTo,
          status: COUNTING_STATUS_FILTER,
        },
        { signal: options.signal },
      );
      for (const req of pageData.data ?? []) {
        requestsMap.set(req.id, req);
      }
      loadedPages++;
      options.onProgress?.(loadedPages, totalPages, new Map(requestsMap));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, remainingPages.length) }, () =>
      worker(),
    ),
  );

  return requestsMap;
}

/**
 * Fetches all pages of events for a single request (`has_more` pagination)
 * and deduplicates by `event.id`.
 */
export async function fetchAllEventsForRequest(
  requestId: number,
  options: RequestOptions = {},
): Promise<RequestEvent[]> {
  const byId = new Map<number, RequestEvent>();
  let page = 1;

  while (page <= 20) {
    const res = await listEvents(requestId, page, options);
    const items = res.data ?? [];
    for (const ev of items) {
      byId.set(ev.id, ev);
    }
    if (!res.has_more || items.length === 0) {
      break;
    }
    page++;
  }

  return Array.from(byId.values());
}
