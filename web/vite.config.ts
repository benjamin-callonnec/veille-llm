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
    // pdf.js alone is ~500 kB and cannot be split further; the viewer loads it anyway
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // the reader is one big page (PDF viewer, markdown, maths): keep each heavy library in its own chunk
        manualChunks(id) {
          if (id.includes("node_modules/pdfjs-dist")) return "pdfjs";
          if (id.includes("node_modules/katex")) return "katex";
          return undefined;
        },
      },
      input: {
        main: "index.html",
        ...(mode === "reader" ? { reader: "reader.html" } : {}),
      },
    },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
}));
