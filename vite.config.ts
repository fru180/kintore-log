import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appBasePath = "/kintore-log";

export default defineConfig({
  base: `${appBasePath}/`,
  plugins: [react()],
  server: {
    proxy: {
      [`${appBasePath}/oauth`]: {
        target: "http://127.0.0.1:8787",
        rewrite: (path) => path.slice(appBasePath.length),
      },
      "/.well-known/oauth-authorization-server/kintore-log": {
        target: "http://127.0.0.1:8787",
      },
      [`${appBasePath}/api`]: {
        target: "http://127.0.0.1:8787",
        rewrite: (path) => path.slice(appBasePath.length),
      },
    },
  },
});
