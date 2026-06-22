import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@openlegion-ai/app/vite"
import * as fs from "node:fs/promises"

const OPENLEGION_SERVER_DIST = "../openlegion/dist/node"

const channel = (() => {
  const raw = process.env.OPENLEGION_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENLEGION_CHANNEL === "latest") return "prod"
  return "dev"
})()

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENLEGION_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "openlegion:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "openlegion:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:openlegion-server") return this.resolve(`${OPENLEGION_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "openlegion:copy-server-assets",
        async writeBundle() {
          await fs.mkdir("./out/main/chunks", { recursive: true })
          for (const l of await fs.readdir(OPENLEGION_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENLEGION_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    server: {
      warmup: {
        // Pre-transform the default view and its direct deps before the Electron
        // window opens. Without this, on-demand Vite compilation races with the
        // renderer's first render cycle and causes HMR-triggered double reloads.
        // Paths are relative to the renderer Vite root (src/renderer/).
        clientFiles: [
          "./index.tsx",
          "./i18n/index.ts",
          "../../../app/src/index.ts",
          "../../../app/src/app.tsx",
          "../../../app/src/pages/containers.tsx",
          "../../../app/src/pages/home.tsx",
          "../../../app/src/components/containers-compose.tsx",
        ],
      },
    },
    optimizeDeps: {
      // Workspace UI sources (incl. logo assets) must rebundle on every cold dev start.
      exclude: ["@openlegion-ai/ui", "@openlegion-ai/ui/logo"],
      // Pre-bundle ALL npm packages that the renderer touches on startup.
      // Without these, Vite discovers them mid-session and forces a full page
      // reload when optimization completes (~10 s after first render).
      //
      // The first cold start after a config change will take 30-60 s while Vite
      // bundles everything — this is expected and only happens ONCE. Subsequent
      // starts reuse the cache (predev.ts no longer wipes node_modules/.vite).
      include: [
        "solid-js",
        "solid-js/web",
        "@solidjs/router",
        "@solidjs/meta",
        "@tanstack/solid-query",
        "effect",
        "@solid-primitives/i18n",
        "shiki",
        "@shikijs/transformers",
        "katex",
        "marked",
        "marked-katex-extension",
        "marked-shiki",
        "@pierre/diffs",
        "motion",
        "motion-dom",
        "motion-utils",
        "dompurify",
        "morphdom",
        "fuzzysort",
        "luxon",
        "diff",
      ],
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
