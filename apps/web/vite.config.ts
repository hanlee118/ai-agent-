import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts")) return "vendor-charts";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("motion")) return "vendor-motion";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    watch: {
      // Generated artifacts are updated by backend jobs; ignoring them prevents
      // Vite from triggering full-page reload loops while users view ProjectRoom.
      ignored: ["**/public/generated/**", "**/site/generated/**"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    }
  }
});
