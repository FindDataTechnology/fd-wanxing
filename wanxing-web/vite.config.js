import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev proxy mirrors the nginx reverse proxy in the image (Dockerfile.web):
// same-origin API, no CORS anywhere.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/wanxing": "http://127.0.0.1:3891",
      "/api/fleet": "http://127.0.0.1:3892",
    },
  },
});
