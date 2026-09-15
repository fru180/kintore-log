import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appBasePath = "/kintore-log";

export default defineConfig({
  base: `${appBasePath}/`,
  plugins: [react()],
  server: {
    proxy: {
      [`${appBasePath}/api`]: {
        target: "http://127.0.0.1:8787",
        rewrite: (path) => path.slice(appBasePath.length),
      },
    },
  },
});
