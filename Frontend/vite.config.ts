/// <reference types="vitest/config" />
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // Object form keeps the browser's Host, so Rails' Origin check sees the Vite origin.
    // The string shorthand sets changeOrigin: true and Rails rejects every POST
    // (Backend/docs/auth/browser-foundations.md §4).
    // API_PROXY_TARGET points a second Vite at the browser-check Rails (Backend/README.md "Browser checks").
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    // Each file's first test pays the cold import of every route (~1.5 s alone), which passed 5 s
    // on a loaded machine. Still short enough to catch a real hang.
    testTimeout: 15_000,
  },
})
