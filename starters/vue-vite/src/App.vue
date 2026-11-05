<script setup lang="ts">
// A first slice of level 1: one page of requests for the last 30 days.
// Everything below is yours to restructure. Check the rules in the brief before trusting these rows.
import { onMounted, ref } from "vue";
import { ApiError, configured, listRequests } from "./api";
import { daysAgo, toApiDate } from "./lib/dates";
import type { HelpdeskRequest } from "./types";

const rows = ref<HelpdeskRequest[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
const from = daysAgo(30);
const to = daysAgo(0);
const ready = configured();

onMounted(async () => {
  if (!ready) return;
  loading.value = true;
  try {
    const page = await listRequests({ created_from: toApiDate(from), created_to: toApiDate(to), per_page: 100 });
    rows.value = page.data;
  } catch (e: unknown) {
    error.value = e instanceof ApiError ? `${e.status}: ${e.message}` : String(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <p v-if="!ready">
    Save <code>HELPDESK_URL</code> and <code>HELPDESK_TOKEN</code> in <code>.env</code>, then restart <code>npm run dev</code>.
  </p>
  <main v-else>
    <h1>Requests board</h1>
    <p class="muted">{{ from }} to {{ to }}. {{ loading ? "Loading…" : `${rows.length} rows (first page only).` }}</p>
    <p v-if="error" role="alert">Could not load requests: {{ error }}</p>
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
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.ref }}</td>
          <td>{{ r.title }}</td>
          <td>{{ r.status }}</td>
          <td>{{ r.priority ?? "—" }}</td>
          <td>{{ r.assignee?.name ?? "—" }}</td>
          <td>{{ r.due_on ?? "—" }}</td>
        </tr>
      </tbody>
    </table>
  </main>
</template>
