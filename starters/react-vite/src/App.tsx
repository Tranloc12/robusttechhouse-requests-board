import { useEffect, useState } from "react";
import { ApiError, configured, listRequests } from "./api";
import { daysAgo, toApiDate } from "./lib/dates";
import type { HelpdeskRequest } from "./types";

// A first slice of level 1: one page of requests for the last 30 days.
// Everything below is yours to restructure. Check the rules in the brief before trusting these rows.
export default function App() {
  const [rows, setRows] = useState<HelpdeskRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const from = daysAgo(30);
  const to = daysAgo(0);

  useEffect(() => {
    if (!configured()) return;
    setLoading(true);
    listRequests({ created_from: toApiDate(from), created_to: toApiDate(to), per_page: 100 })
      .then((page) => setRows(page.data))
      .catch((e: unknown) => setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e)))
      .finally(() => setLoading(false));
  }, [from, to]);

  if (!configured()) {
    return <p>Save <code>HELPDESK_URL</code> and <code>HELPDESK_TOKEN</code> in <code>.env</code>, then restart <code>npm run dev</code>.</p>;
  }

  return (
    <main>
      <h1>Requests board</h1>
      <p className="muted">
        {from} to {to}. {loading ? "Loading…" : `${rows.length} rows (first page only).`}
      </p>
      {error && <p role="alert">Could not load requests: {error}</p>}
      <table>
        <thead>
          <tr>
            <th>Ref</th>
            <th>Title</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.ref}</td>
              <td>{r.title}</td>
              <td>{r.status}</td>
              <td>{r.priority ?? "—"}</td>
              <td>{r.assignee?.name ?? "—"}</td>
              <td>{r.due_on ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
