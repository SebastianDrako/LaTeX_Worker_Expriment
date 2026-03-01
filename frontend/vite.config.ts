import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In dev, proxy /api to the local Wrangler Worker
      "/api": {
        target: process.env.VITE_WORKER_URL ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
