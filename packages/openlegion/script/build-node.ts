#!/usr/bin/env bun

import { Script } from "@openlegion-ai/script"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

// Node/ESM build of the server used as the desktop app's sidecar
// (packages/desktop bundles ./dist/node/node.js via electron-vite). Unlike the
// compiled single-file binary produced by build.ts, this is a plain ESM bundle
// with native deps left external. The OPENLEGION_* defines are optional — the
// source guards each with `typeof … === "undefined"` and falls back (models are
// fetched over the network, version/channel default to "local") — so a dev
// build with no MODELS_DEV_API_JSON still works.
await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    OPENLEGION_CHANNEL: `'${Script.channel}'`,
    OPENLEGION_VERSION: `'${Script.version}'`,
    ...(generated.modelsData ? { OPENLEGION_MODELS_DEV: generated.modelsData } : {}),
  },
  // The desktop app serves the web UI from vite in dev and embeds it at package
  // time, so the node bundle only needs this import specifier to resolve.
  files: {
    "openlegion-web-ui.gen.ts": "",
  },
})

console.log("Build complete")
