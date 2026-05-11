import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const rootDir = __dirname;
const distDir = resolve(rootDir, "dist");

function copyManifestPlugin(): Plugin {
  return {
    name: "copy-extension-manifest",
    closeBundle() {
      const manifestPath = resolve(rootDir, "manifest.json");
      const targetPath = resolve(distDir, "manifest.json");

      if (!existsSync(manifestPath)) {
        return;
      }

      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(manifestPath, targetPath);
    }
  };
}

export default defineConfig({
  plugins: [react(), copyManifestPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "chrome120",
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(rootDir, "sidepanel.html"),
        background: resolve(rootDir, "src/background/index.ts"),
        content: resolve(rootDir, "src/content/index.ts")
      },
      output: {
        entryFileNames(chunkInfo) {
          if (chunkInfo.name === "background") {
            return "background.js";
          }

          if (chunkInfo.name === "content") {
            return "content.js";
          }

          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
