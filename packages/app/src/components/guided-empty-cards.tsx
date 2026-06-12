import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { For } from "solid-js"
import { useLanguage } from "@/context/language"

export type GuidedEmptyAction = {
  titleKey: string
  descriptionKey: string
  actionKey: string
  onClick: () => void
  disabled?: boolean
}

export function GuidedEmptyCards(props: { actions: GuidedEmptyAction[] }) {
  const language = useLanguage()

  return (
    <div class="grid gap-3 sm:grid-cols-3">
      <For each={props.actions}>
        {(action) => (
          <article class="desktop-container-card flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <h3 class="text-sm font-medium text-v2-text-text-base">{language.t(action.titleKey)}</h3>
              <p class="text-xs leading-relaxed text-v2-text-text-muted">{language.t(action.descriptionKey)}</p>
            </div>
            <ButtonV2 variant="neutral" size="normal" onClick={action.onClick} disabled={action.disabled}>
              {language.t(action.actionKey)}
            </ButtonV2>
          </article>
        )}
      </For>
    </div>
  )
}
