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
await $`rm -rf node_modules/.vite`
await $`bun ./scripts/copy-icons.ts ${process.env.OPENLEGION_CHANNEL ?? "dev"}`

await $`cd ../openlegion && bun script/build-node.ts`
