// A thin client for the helpdesk API. Extend it; don't scatter fetch calls through components.

import type { HelpdeskRequest, Page, RequestEvent, Site, Staff } from "./types";

const BASE = (import.meta.env.HELPDESK_URL ?? "").replace(/\/$/, "");
const TOKEN = import.meta.env.HELPDESK_TOKEN ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export function configured(): boolean {
  return Boolean(BASE && TOKEN);
}

export async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    const retryAfter = response.headers.get("Retry-After");
    throw new ApiError(response.status, body.error ?? response.statusText, retryAfter ? Number(retryAfter) : null);
  }
  return (await response.json()) as T;
}

export const listRequests = (params: { page?: number; per_page?: number; created_from?: string; created_to?: string; status?: string }) =>
  get<Page<HelpdeskRequest>>("/v1/requests", params);

export const getRequest = (id: number) => get<HelpdeskRequest>(`/v1/requests/${id}`);

export const listEvents = (id: number, page = 1) => get<Page<RequestEvent>>(`/v1/requests/${id}/events`, { page });

export const listSites = () => get<{ data: Site[] }>("/v1/sites");

export const listStaff = () => get<{ data: Staff[] }>("/v1/staff");
