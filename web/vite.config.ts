/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "./",
  // dev server of `make reader`: the API and the catalogue come from the local reader server
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/catalogue.json": "http://127.0.0.1:8765",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        ...(mode === "reader" ? { reader: "reader.html" } : {}),
      },
    },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
}));
