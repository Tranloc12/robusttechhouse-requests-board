/// <reference types="vitest/config" />
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  // Expose HELPDESK_URL and HELPDESK_TOKEN from .env as import.meta.env.HELPDESK_*.
  // They end up in the browser bundle: fine for the practice API, worth a line in DECISIONS.md.
  envPrefix: ["VITE_", "HELPDESK_"],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
