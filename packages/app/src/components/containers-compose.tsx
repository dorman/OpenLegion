import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"

export function ContainersComposePanel() {
  return (
    <section class="flex flex-col gap-3 rounded-md border border-base bg-v2-background-bg-base p-4">
      <h2 class="text-center">Choose one of the Quick Launch Recipes below to get started.</h2>
      <div class="flex flex-wrap gap-3 text-sm">
        <ButtonV2>Create Ubuntu Linux VM</ButtonV2>
        <ButtonV2>n8n workflow</ButtonV2>
        <ButtonV2>Django app</ButtonV2>
        <ButtonV2>Spin up Jenkins</ButtonV2>
        <ButtonV2>Svelte + Tailwind</ButtonV2>
        <ButtonV2>Spin up Ghidra</ButtonV2>
        <ButtonV2>Start a Notion container</ButtonV2>
      </div>
    </section>
  )
}
