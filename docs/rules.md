# The rules

These six rules are all of them; nothing is hidden. They use the field names from `docs/api.md`. Times
are local to the request's site (`/v1/sites` gives each site's IANA timezone).

1. **Which requests count.** `created_at`, converted to the site's local date, is from `from` to
   `to` inclusive. Skip requests with status `canceled`, with `deleted_at` set, or with
   `merged_into_id` set. Note that the API's `created_from`/`created_to` filters take `DD/MM/YYYY`.
2. **Overdue.** Status is `pending` or `processing`, and `due_on` (a site-local date) is before
   today's date in the site's timezone. `due_on: null` is never overdue.
3. **Names.** Look people up by id in `/v1/staff` (`assignee.id`, `actor_id`). Do not display
   `assignee.name` or `actor_name` from a request or event: they can be stale.
4. **Times.** `created_at` and `updated_at` are ISO 8601 UTC; an event's `at` is Unix seconds;
   `due_at` on an event is site-local wall-clock time. Display all of them in the site's timezone
   and name the zone.
5. **Undone events.** An event with `reverts_id` undoes the event it points at. Hide both from the
   timeline by default.
6. **First response.** The earliest event (by `at`) with status `processing` and an `actor_id`
   (System events have `actor_id: null`). Show that person's current name and the time.
