/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "./",
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
