import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(
  new URL(".", import.meta.url),
);

export default defineConfig(({ command }) => {
  const serving = command === "serve";

  const imports = serving
    ? {
        react: "/src/module-runtime/react.mjs",
        "react/jsx-runtime":
          "/src/module-runtime/react-jsx-runtime.ts",
        "@homi/module-sdk":
          "/src/module-runtime/module-sdk.ts",
        "@homi/ui": "/src/module-runtime/ui.ts",
      }
    : {
        react: "/module-runtime/react.js",
        "react/jsx-runtime":
          "/module-runtime/react-jsx-runtime.js",
        "@homi/module-sdk":
          "/module-runtime/module-sdk.js",
        "@homi/ui": "/module-runtime/ui.js",
      };

  return {
    plugins: [
      react(),
      {
        name: "homi-module-import-map",
        transformIndexHtml() {
          return [
            {
              tag: "script",
              attrs: { type: "importmap" },
              children: JSON.stringify({ imports }),
              injectTo: "head-prepend",
            },
          ];
        },
      },
    ],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": "http://127.0.0.1:3001",
        "/health": "http://127.0.0.1:3001",
      },
    },
    build: {
      rollupOptions: {
        preserveEntrySignatures: "strict",
        input: {
          index: resolve(root, "index.html"),
          "module-runtime-react": resolve(
            root,
            "src/module-runtime/react.mjs",
          ),
          "module-runtime-react-jsx-runtime": resolve(
            root,
            "src/module-runtime/react-jsx-runtime.ts",
          ),
          "module-runtime-module-sdk": resolve(
            root,
            "src/module-runtime/module-sdk.ts",
          ),
          "module-runtime-ui": resolve(
            root,
            "src/module-runtime/ui.ts",
          ),
        },
        output: {
          entryFileNames(chunk) {
            const prefix = "module-runtime-";
            if (chunk.name.startsWith(prefix)) {
              return (
                "module-runtime/" +
                chunk.name.slice(prefix.length) +
                ".js"
              );
            }
            return "assets/[name]-[hash].js";
          },
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  };
});
