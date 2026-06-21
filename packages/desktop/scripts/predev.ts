import { $ } from "bun"

// Icon regeneration uses macOS `sips` and `iconutil` (see generate-brand-icons.ts). On Linux and
// Windows, predev skips regeneration and copy-icons.ts stages the committed channel assets under
// packages/desktop/icons/{dev,beta,prod}. To refresh icons from the brand mark, run
// `bun ./scripts/generate-brand-icons.ts` on macOS and commit the updated PNG/ICNS/ICO files.
if (process.platform === "darwin") {
  await $`bun ./scripts/generate-brand-icons.ts`
} else {
  console.log("Skipping icon regeneration on non-macOS — using committed icons in packages/desktop/icons/")
}
// Vite 7 invalidates its dep-optimization cache automatically when bun.lock or
// vite.config.ts changes. Wiping it on every start forces a cold-cache run on
// every restart, which triggers a mandatory "optimized dependencies changed.
// reloading" full-reload ~8-11 s after the app first renders. Keep the cache.
await $`bun ./scripts/copy-icons.ts ${process.env.OPENLEGION_CHANNEL ?? "dev"}`

await $`cd ../openlegion && bun script/build-node.ts`
