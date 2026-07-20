import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0 so phones on the same Wi-Fi can reach the dev server.
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
