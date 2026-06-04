import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENLEGION_CHANNEL ?? "dev"}`

await $`cd ../openlegion && bun script/build-node.ts`
