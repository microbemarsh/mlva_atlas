import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: process.env.BASE_PATH || "./",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(echarts|zrender)\//.test(id)) return "charts";
          if (id.includes("node_modules/leaflet/")) return "maps";
        },
      },
    },
  },
});
