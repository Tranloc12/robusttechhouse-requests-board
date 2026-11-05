// Shapes of the helpdesk API (docs/api.md). Keep them honest: the data has nulls where the docs say so.

export type Status = "pending" | "processing" | "complete" | "canceled";
export type Priority = "Low" | "Medium" | "High" | null;

export interface Staff {
  id: number;
  name: string;
}

export interface Site {
  id: number;
  name: string;
  timezone: string; // IANA name, e.g. "Australia/Sydney"
  business_hours: Record<string, { open: string; close: string } | null>;
}

export interface HelpdeskRequest {
  id: number;
  ref: string;
  title: string;
  location: string;
  site_id: number;
  status: Status;
  priority: Priority;
  created_at: string; // ISO 8601, UTC
  updated_at: string;
  due_on: string | null; // YYYY-MM-DD, site local
  assignee: Staff | null;
  deleted_at: string | null;
  merged_into_id: number | null;
}

export interface RequestEvent {
  id: number;
  status: Status;
  at: number; // Unix seconds
  actor_id: number | null;
  actor_name: string; // the name at the time; System events have actor_id null
  assignee_name: string | null;
  due_at: string | null; // "DD/MM/YYYY HH:MM", site local
  note: string | null;
  reverts_id: number | null;
}

export interface Page<T> {
  data: T[];
  page: number;
  per_page: number;
  total_pages?: number;
  total?: number;
  has_more?: boolean;
}
