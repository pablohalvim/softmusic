import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: string };
const appVersion = process.env.VITE_APP_VERSION || pkg.version || "0.0.1";

function writeVersionFile(dir: string) {
  if (!fs.existsSync(dir)) return;
  const payload = JSON.stringify({ version: appVersion, builtAt: new Date().toISOString() }, null, 2);
  fs.writeFileSync(path.join(dir, "version.json"), payload, "utf8");
}

function pwaVersionPlugin(): Plugin {
  const publicDir = path.join(rootDir, "public");
  return {
    name: "softmusic-pwa-version",
    configureServer() {
      writeVersionFile(publicDir);
    },
    buildStart() {
      writeVersionFile(publicDir);
    },
    closeBundle() {
      writeVersionFile(path.join(rootDir, "build", "client"));
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), pwaVersionPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      "^/(songs|jobs|dashboard|health|metrics)": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
