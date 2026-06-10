import { $ } from "bun"

// Regenerate dock/window/favicon assets from packages/ui brand mark on macOS, then clear
// Vite's dependency cache so a cold start cannot serve the old pre-bundled logo module.
if (process.platform === "darwin") {
  await $`bun ./scripts/generate-brand-icons.ts`
}
await $`rm -rf node_modules/.vite`
await $`bun ./scripts/copy-icons.ts ${process.env.OPENLEGION_CHANNEL ?? "dev"}`

await $`cd ../openlegion && bun script/build-node.ts`
